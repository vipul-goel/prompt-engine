#!/usr/bin/env node
// Release gates run through the official MCP Inspector CLI against the built
// server (dist/cli.js over stdio), in both protocol eras. Exits 1 on any failure.
// Inspector v2 needs Node >= 22.19.
//
//   npm run test:inspector

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  console.error(`The MCP Inspector CLI needs Node >= 22.19 (this is ${process.versions.node}).`);
  process.exit(1);
}

const launcher = join(dirname(createRequire(import.meta.url).resolve('@modelcontextprotocol/inspector/package.json')), 'clients', 'launcher', 'build', 'index.js');
const server = ['node', join(pkg, 'dist', 'cli.js')];
// Keep the Inspector's catalog and client config out of the user's home folder.
const home = mkdtempSync(join(tmpdir(), 'pe-inspector-'));
const env = { ...process.env, MCP_CATALOG_PATH: join(home, 'mcp.json'), MCP_CLIENT_CONFIG_PATH: join(home, 'client.json') };

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `\n     ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Runs one Inspector CLI call and parses its JSON result ({ result } or an error envelope). */
function inspect(era, args, { quiet = true } = {}) {
  const r = spawnSync(process.execPath, [launcher, '--cli', ...server, '--protocol-era', era, '--format', 'json', ...(quiet ? ['-q'] : []), ...args], {
    cwd: pkg,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, result: json?.result };
}

const textOf = (result) => (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const promptText = (result) => result?.messages?.[0]?.content?.text ?? '';
const SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
const ANNOTATIONS = JSON.stringify({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const TOOLS = 'ask_user,check_prompt,enhance_prompt,get_checklist';

try {
  for (const era of ['modern', 'legacy']) {
    console.log(`\n# protocol era: ${era}`);

    const list = inspect(era, ['--method', 'tools/list', '--strict'], { quiet: false });
    check(list.code === 0, 'tools/list --strict reports no schema portability errors', `exit ${list.code}: ${list.stderr.slice(-1500)}`);
    const tools = list.result?.tools ?? [];
    check(tools.map((t) => t.name).sort().join(',') === TOOLS, 'tools/list returns the four tools', tools.map((t) => t.name).join(','));
    check(tools.every((t) => JSON.stringify(t.annotations) === ANNOTATIONS), 'every tool is annotated read-only, non-destructive, idempotent, closed-world');
    // Some clients and model APIs are reported to reject or cut tool descriptions over 1,024 characters.
    check(tools.every((t) => t.description.length <= 1024), 'every tool description is 1,024 characters or fewer', tools.map((t) => `${t.name}: ${t.description.length}`).join(', '));

    const prompts = inspect(era, ['--method', 'prompts/list']);
    const enhance = prompts.result?.prompts?.find((p) => p.name === 'enhance');
    check(
      prompts.code === 0 && enhance?.arguments?.length === 1 && enhance.arguments[0].name === 'mode' && !enhance.arguments[0].required,
      'prompts/list has enhance with one optional mode argument',
      prompts.stdout.slice(0, 500),
    );

    const plain = inspect(era, ['--method', 'prompts/get', '--prompt-name', 'enhance']);
    check(plain.code === 0 && promptText(plain.result).includes('## How to use this server') && promptText(plain.result).includes('Improve the rough prompt in my previous message'), 'prompts/get enhance returns the brief and the request', plain.stderr.slice(-500));
    const quick = inspect(era, ['--method', 'prompts/get', '--prompt-name', 'enhance', '--prompt-args', 'mode=quick']);
    check(quick.code === 0 && promptText(quick.result).includes('Requested mode: quick'), 'prompts/get enhance mode=quick echoes the mode', quick.stderr.slice(-500));
    const stamped = Boolean(quick.result?._meta?.[SERVER_INFO]);
    check(stamped === (era === 'modern'), `the ${era} era was negotiated (serverInfo is ${era === 'modern' ? '' : 'not '}stamped on results)`);

    const resources = inspect(era, ['--method', 'resources/list']);
    check(resources.code === 0 && resources.result?.resources?.length === 10, 'resources/list returns 5 references and 5 checklists', resources.stdout.slice(0, 300));
    const templates = inspect(era, ['--method', 'resources/templates/list']);
    check(templates.result?.resourceTemplates?.[0]?.uriTemplate === 'prompt-engine://checklists/{domain}', 'resources/templates/list returns the checklist template');
    const method = inspect(era, ['--method', 'resources/read', '--uri', 'prompt-engine://method']);
    check(method.code === 0 && method.result?.contents?.[0]?.text?.includes('## How to use this server'), 'resources/read prompt-engine://method');
    const media = inspect(era, ['--method', 'resources/read', '--uri', 'prompt-engine://checklists/image-video']);
    check(media.code === 0 && media.result?.contents?.[0]?.text?.includes('# Media targets'), 'resources/read prompt-engine://checklists/image-video includes the media targets');

    const brief = inspect(era, ['--method', 'tools/call', '--tool-name', 'enhance_prompt', '--tool-args-json', '{"mode":"deep","target":"Claude Code"}']);
    check(brief.code === 0 && textOf(brief.result).includes('Requested target: Claude Code'), 'tools/call enhance_prompt');
    const checklist = inspect(era, ['--method', 'tools/call', '--tool-name', 'get_checklist', '--tool-arg', 'domain=research']);
    check(checklist.code === 0 && textOf(checklist.result).startsWith('# Domain pack: research'), 'tools/call get_checklist');
    const lint = inspect(era, ['--method', 'tools/call', '--tool-name', 'check_prompt', '--tool-args-json', '{"prompt":"You MUST write a poem about [[topic]]."}']);
    const ids = (lint.result?.structuredContent?.issues ?? []).map((i) => i.id).join(',');
    check(lint.code === 0 && ids === 'pressure-words,open-placeholder', 'tools/call check_prompt returns structured lint findings', ids || lint.stdout.slice(0, 500));
    const asked = inspect(era, ['--method', 'tools/call', '--tool-name', 'ask_user', '--tool-args-json', JSON.stringify({ questions: [{ id: 'tone', question: 'Which tone?', options: [{ label: 'Formal' }, { label: 'Friendly' }], recommended: 1, why: 'suits a newsletter' }] })]);
    check(asked.code === 0 && asked.result?.structuredContent?.status === 'ask_in_chat' && textOf(asked.result).includes('b) Friendly ★ (suits a newsletter)'), 'tools/call ask_user without elicitation returns the text batch', asked.stdout.slice(0, 500));
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} Inspector gate(s) failed`);
  process.exit(1);
}
console.log('\nall Inspector gates passed');
