#!/usr/bin/env node
// Checks the Cloudflare Workers build without deploying anything:
//   1. `wrangler deploy --dry-run` bundles src/worker.ts;
//   2. `wrangler dev` serves it locally, and raw JSON-RPC POSTs (tools/list,
//      tools/call enhance_prompt) succeed, a foreign Host header gets 403, and a
//      2026-07-28 client gets ask_user's form answers back.
// Needs Node >= 22 and network access to fetch the pinned Wrangler.
//
//   npm run test:worker

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const WRANGLER = 'wrangler@4.155.0';
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Runs the pinned Wrangler through npm's own CLI when started by npm (portable), else through npx. */
function wrangler(...args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && /npm-cli\.js$/.test(npmCli)) return [process.execPath, [npmCli, 'exec', '--yes', `--package=${WRANGLER}`, '--', 'wrangler', ...args]];
  return ['npx', ['-y', WRANGLER, ...args]];
}

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** POST a JSON-RPC message the way a 2025-era client does, optionally with a custom Host header. */
function post(port, body, host) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          host: host ?? `127.0.0.1:${port}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
          'content-length': Buffer.byteLength(data),
        },
        timeout: 15000,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'] ?? '', text }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

/** A JSON body, or the last `data:` line of an SSE body. */
function parseRpc(res) {
  if (res.contentType.includes('text/event-stream')) {
    const data = res.text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
    return JSON.parse(data.at(-1) ?? 'null');
  }
  return JSON.parse(res.text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Dry-run deploy.
const outdir = mkdtempSync(join(tmpdir(), 'pe-worker-'));
const dry = spawnSync(...wrangler('deploy', '--dry-run', '--outdir', outdir), { cwd: pkg, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
check(dry.status === 0, 'wrangler deploy --dry-run', dry.status === 0 ? (dry.stdout.match(/Total Upload: [^\n]+/)?.[0] ?? '') : (dry.stderr || dry.stdout).slice(-800));
rmSync(outdir, { recursive: true, force: true });

// 2. Local dev server.
const port = await freePort();
const dev = spawn(...wrangler('dev', '--ip', '127.0.0.1', '--port', String(port), '--log-level', 'warn'), {
  cwd: pkg,
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});
let devLog = '';
dev.stdout.on('data', (d) => (devLog += d));
dev.stderr.on('data', (d) => (devLog += d));
const stopDev = () => {
  try {
    if (process.platform === 'win32') dev.kill();
    else process.kill(-dev.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stopDev);

try {
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  let ready = false;
  for (let i = 0; i < 120 && !ready && dev.exitCode === null; i++) {
    try {
      const res = await post(port, list);
      ready = res.status === 200;
    } catch {}
    if (!ready) await sleep(1000);
  }
  check(ready, `wrangler dev answered on 127.0.0.1:${port}`, ready ? '' : devLog.slice(-800));
  if (ready) {
    const tools = parseRpc(await post(port, list));
    const names = (tools.result?.tools ?? []).map((t) => t.name).sort();
    check(names.join(',') === 'ask_user,check_prompt,enhance_prompt,get_checklist', 'tools/list returns the four tools', names.join(','));

    const call = parseRpc(await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'enhance_prompt', arguments: { mode: 'quick', target: 'Midjourney' } } }));
    const brief = call.result?.content?.[0]?.text ?? '';
    check(!call.result?.isError && brief.includes('Requested mode: quick') && brief.includes('get_checklist'), 'tools/call enhance_prompt returns the brief', `${brief.length} chars`);

    const foreign = await post(port, list, 'evil.example.com');
    check(foreign.status === 403, 'a foreign Host header is rejected', `HTTP ${foreign.status}`);

    // A 2026-07-28 client answering ask_user's form through multi-round-trip results.
    try {
      const client = new Client({ name: 'worker-smoke', version: '0.0.0' }, { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: 'auto' } });
      client.setRequestHandler('elicitation/create', async () => ({ action: 'accept', content: { tone: 'Formal' } }));
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      const asked = await client.callTool({
        name: 'ask_user',
        arguments: { questions: [{ id: 'tone', question: 'Which tone?', options: [{ label: 'Formal' }, { label: 'Friendly' }], recommended: 1 }] },
      });
      check(client.getProtocolEra() === 'modern' && asked.structuredContent?.status === 'answered' && asked.structuredContent.answers?.[0]?.answer === 'Formal', 'a 2026-07-28 client gets a form and its answers back', JSON.stringify(asked.structuredContent));
      await client.close();
    } catch (error) {
      check(false, 'a 2026-07-28 client gets a form and its answers back', String(error));
    }
  }
} finally {
  stopDev();
  await sleep(500);
}

if (failures) {
  console.error(`\n${failures} worker check(s) failed`);
  process.exit(1);
}
console.log('\nworker checks passed');
