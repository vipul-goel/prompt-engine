// End-to-end tests against the built CLI (dist/cli.js): stdio in both eras and
// real Streamable HTTP with Host/Origin checks. `npm test` builds first.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport, type ElicitResult } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROMPT_MAX_CHARS } from '../src/check.js';
import { VERSION } from '../src/generated/content.js';
import { CLI, ENV, keepSending, send, sleep, startHttp, startUpload, TOOLS_LIST, waitFor } from './cli-helpers.js';
import { PKG, SAMPLE_QUESTIONS, textOf } from './helpers.js';

const TOOLS = ['ask_user', 'check_prompt', 'enhance_prompt', 'get_checklist'];

/** `elicit` answers forms; its signal aborts when the server cancels the form's request. */
function stdioClient(era: 'legacy' | 'modern', elicit?: (signal: AbortSignal) => ElicitResult | Promise<ElicitResult>, stderr: 'pipe' | 'ignore' = 'ignore') {
  const client = new Client(
    { name: 'prompt-engine-e2e', version: '0.0.0' },
    { capabilities: elicit ? { elicitation: { form: {} } } : {}, ...(era === 'modern' ? { versionNegotiation: { mode: 'auto' as const } } : {}) },
  );
  if (elicit) client.setRequestHandler('elicitation/create', async (_request, ctx) => elicit(ctx.mcpReq.signal));
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI], stderr });
  return { client, transport };
}

describe('the built CLI', () => {
  it('starts with a node shebang and prints its version and help', () => {
    expect(readFileSync(CLI, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    const version = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(VERSION);
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/--http/);
    expect(help.stdout).toMatch(/--allowed-hosts/);
    expect(help.stdout).toMatch(/preflight request fails \(403\s+from an origin that isn't allowed, 405 otherwise\)/);
    const bad = spawnSync(process.execPath, [CLI, '--nope'], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/Unknown option/);
    expect(bad.stdout).toBe('');
  });

  it('refuses a --port that is not written in digits, an empty one included', () => {
    // An empty value is what --port "$PORT" gives when PORT is unset. A value the CLI took
    // would start a server, which the timeout then stops, so the status would not be 2.
    const cases = [['', ['--port', '']], ...['', ' ', '0x0', '1e0', '+0', '8080.0', '-1', '65536'].map((v) => [v, [`--port=${v}`]] as const)] as const;
    for (const [value, args] of cases) {
      const run = spawnSync(process.execPath, [CLI, '--http', ...args], { encoding: 'utf8', env: ENV, timeout: 5_000 });
      expect(run.status, args.join(' ')).toBe(2);
      expect(run.stderr, args.join(' ')).toContain(`--port must be an integer from 0 to 65535 (got ${JSON.stringify(value)})`);
      expect(run.stderr, args.join(' ')).not.toMatch(/listening on|cannot listen/);
    }
  });
});

describe('stdio', () => {
  it('legacy era: lists tools, returns the brief, and asks in text mode without elicitation', async () => {
    const { client, transport } = stdioClient('legacy', undefined, 'pipe');
    let stderr = '';
    transport.stderr?.on('data', (d) => (stderr += d));
    await client.connect(transport);
    try {
      expect(client.getProtocolEra()).toBe('legacy');
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
      const brief = await client.callTool({ name: 'enhance_prompt', arguments: { mode: 'quick' } });
      expect(textOf(brief)).toContain('Requested mode: quick —');
      const asked = await client.callTool({ name: 'ask_user', arguments: { questions: SAMPLE_QUESTIONS } });
      expect(asked.structuredContent).toMatchObject({ status: 'ask_in_chat' });
      expect(textOf(asked)).toContain('Reply `ok` to accept every ★');
      // Nothing about the call (and no prompt text) is logged.
      const check = await client.callTool({ name: 'check_prompt', arguments: { prompt: 'SECRET-PROMPT-TEXT write a poem' } });
      expect(check.isError).toBeFalsy();
      expect(stderr).not.toContain('SECRET-PROMPT-TEXT');
    } finally {
      await client.close();
    }
  });

  it('legacy era: a client with form elicitation gets a real elicitation/create request', async () => {
    const { client, transport } = stdioClient('legacy', () => ({ action: 'accept', content: { audience: 'Employees', length: 'About 600 words' } }));
    await client.connect(transport);
    try {
      const asked = await client.callTool({ name: 'ask_user', arguments: { questions: SAMPLE_QUESTIONS } });
      expect(asked.structuredContent).toMatchObject({ status: 'answered', answers: [{ answer: 'Employees', source: 'chosen' }, { answer: 'About 600 words', source: 'chosen' }] });
    } finally {
      await client.close();
    }
  });

  it('modern era: negotiates 2026-07-28 and elicits through multi-round-trip results', async () => {
    const { client, transport } = stdioClient('modern', () => ({ action: 'accept', content: { audience: 'Job seekers', length: '2,000+ words' } }));
    await client.connect(transport);
    try {
      expect(client.getProtocolEra()).toBe('modern');
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
      const asked = await client.callTool({ name: 'ask_user', arguments: { questions: SAMPLE_QUESTIONS } });
      expect(asked.structuredContent).toMatchObject({ status: 'answered', answers: [{ answer: 'Job seekers' }, { answer: '2,000+ words' }] });
    } finally {
      await client.close();
    }
  });

  for (const era of ['legacy', 'modern'] as const) {
    it(`${era} era: a declined form gives the ★ answers, a closed one asks in the chat`, async () => {
      for (const [action, status] of [['decline', 'declined'], ['cancel', 'ask_in_chat']] as const) {
        const { client, transport } = stdioClient(era, () => ({ action }));
        await client.connect(transport);
        try {
          const asked = await client.callTool({ name: 'ask_user', arguments: { questions: SAMPLE_QUESTIONS } });
          expect(asked.structuredContent, action).toMatchObject({ status });
        } finally {
          await client.close();
        }
      }
    });
  }

  // The stdio server has to act on notifications/cancelled, which servers made per HTTP request
  // ignore (see the stopped-call tests in integration.test.ts), so this checks how cli.ts makes it.
  it('legacy era: stopping a call cancels its open form, and the server goes on serving', async () => {
    let opened: (signal: AbortSignal) => void = () => {};
    const formOpen = new Promise<AbortSignal>((resolve) => (opened = resolve));
    const { client, transport } = stdioClient('legacy', (signal) => {
      opened(signal);
      // No answer until the server cancels the form's request.
      return new Promise<ElicitResult>((resolve) => signal.addEventListener('abort', () => resolve({ action: 'cancel' }), { once: true }));
    });
    await client.connect(transport);
    try {
      const stop = new AbortController();
      const call = client.callTool({ name: 'ask_user', arguments: { questions: SAMPLE_QUESTIONS } }, { signal: stop.signal });
      const form = await formOpen;
      const stopped = expect(call).rejects.toThrow('the user stopped the call');
      stop.abort('the user stopped the call');
      await stopped;
      await waitFor(() => form.aborted, () => 'the form was still open 5 s after the call was stopped', 5_000);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    } finally {
      await client.close();
    }
  });

  it('logs a reason code, never the content, for messages it cannot read', async () => {
    const proc = spawn(process.execPath, [CLI], { stdio: ['pipe', 'pipe', 'pipe'], env: ENV });
    let stderr = '';
    let stdout = '';
    proc.stderr!.on('data', (d) => (stderr += d));
    proc.stdout!.on('data', (d) => (stdout += d));
    try {
      const lines = [
        'SECRET-A this line is not JSON',
        '{"SECRET-B":"SECRET-C","jsonrpc":"2.0"}',
        '{"jsonrpc":"2.0","id":"SECRET-D","method":7}',
        '[1,"SECRET-E"]',
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"SECRET-F","version":"1"}}}',
      ];
      for (const line of lines) proc.stdin!.write(`${line}\n`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no initialize result:\n${stdout}\n${stderr}`)), 15_000);
        proc.stdout!.on('data', () => {
          if (stdout.includes('"id":1')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      await sleep(200);
      // The server still answers after the bad lines, and logs a fixed phrase per unreadable message.
      expect(stdout).toContain('"serverInfo"');
      expect(stderr).toContain('ignored a message that is not valid JSON-RPC (invalid-message)');
      expect(stderr).not.toMatch(/SECRET/);
      for (const line of stderr.trim().split('\n')) expect(line).toMatch(/^\[prompt-engine-mcp\] ignored a message that is not valid JSON-RPC \(invalid-message\)$/);
    } finally {
      proc.kill('SIGTERM');
    }
  });

  it('logs a fixed phrase, without its text, for an opening notification it drops', async () => {
    const proc = spawn(process.execPath, [CLI], { stdio: ['pipe', 'ignore', 'pipe'], env: ENV });
    let stderr = '';
    proc.stderr!.on('data', (d) => (stderr += d));
    try {
      // The envelope claims a protocol revision the server doesn't support, with a terminal escape in it.
      const meta = { 'io.modelcontextprotocol/protocolVersion': 'LEAK\u001b[31m', 'io.modelcontextprotocol/clientCapabilities': {} };
      proc.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: { _meta: meta } })}\n`);
      await waitFor(() => stderr.includes('\n'), () => stderr);
      await sleep(200);
      expect(stderr).toBe('[prompt-engine-mcp] ignored a notification (unsupported-protocol-version)\n');
    } finally {
      proc.kill('SIGTERM');
    }
  });

  it('writes nothing to stderr while a slow reader leaves many results waiting', async () => {
    const proc = spawn(process.execPath, [CLI], { stdio: ['pipe', 'pipe', 'pipe'], env: ENV });
    let stderr = '';
    proc.stderr!.on('data', (d) => (stderr += d));
    try {
      // stdout is not read yet, so once the pipe is full the results wait in the server.
      const rpc = (message: Record<string, unknown>) => `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`;
      proc.stdin!.write(rpc({ id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } } }));
      proc.stdin!.write(rpc({ method: 'notifications/initialized' }));
      for (let id = 1; id <= 60; id++) proc.stdin!.write(rpc({ id, method: 'tools/call', params: { name: 'get_checklist', arguments: { domain: 'image-video' } } }));
      await sleep(1_000);
      let stdout = '';
      proc.stdout!.on('data', (d) => (stdout += d));
      await waitFor(() => stdout.includes('"id":60'), () => stdout.slice(-500));
      expect(stderr).toBe('');
    } finally {
      proc.kill('SIGTERM');
    }
  });
});

describe('Streamable HTTP (--http)', () => {
  let server: Awaited<ReturnType<typeof startHttp>>;
  let base: URL;

  beforeAll(async () => {
    server = await startHttp();
    base = new URL(`http://127.0.0.1:${server.port}/mcp`);
  });

  afterAll(() => {
    server?.proc.kill('SIGTERM');
  });

  const raw = (path: string, headers: Record<string, string>, body?: string) => send(server.port, headers, { path, ...(body === undefined ? {} : { body }) });

  it('binds to 127.0.0.1 by default and serves tools/list to a real client', async () => {
    expect(server.stderr()).toMatch(/listening on http:\/\/127\.0\.0\.1:\d+\/mcp/);
    for (const era of ['legacy', 'modern'] as const) {
      const client = new Client({ name: 'prompt-engine-e2e', version: '0.0.0' }, era === 'modern' ? { versionNegotiation: { mode: 'auto' } } : {});
      await client.connect(new StreamableHTTPClientTransport(base));
      try {
        expect(client.getProtocolEra()).toBe(era);
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
      } finally {
        await client.close();
      }
    }
  });

  it('accepts requests without an Origin header and rejects a disallowed Host or Origin', async () => {
    const ok = await raw('/mcp', { host: `localhost:${base.port}` });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('enhance_prompt');
    const badHost = await raw('/mcp', { host: 'evil.example.com' });
    expect(badHost.status).toBe(403);
    const badOrigin = await raw('/mcp', { host: `127.0.0.1:${base.port}`, origin: 'https://evil.example.com' });
    expect(badOrigin.status).toBe(403);
    const goodOrigin = await raw('/mcp', { host: `127.0.0.1:${base.port}`, origin: `http://localhost:${base.port}` });
    expect(goodOrigin.status).toBe(200);
  });

  it('answers 404 outside /mcp', async () => {
    const res = await raw('/other', { host: `127.0.0.1:${base.port}` });
    expect(res.status).toBe(404);
  });

  it("doesn't support browser clients: a preflight gets 403 or 405 and no CORS headers", async () => {
    const preflight = (origin: string) =>
      send(server.port, { host: `localhost:${base.port}`, origin, 'access-control-request-method': 'POST' }, { method: 'OPTIONS', body: '' });
    const corsHeaders = (headers: IncomingHttpHeaders) => Object.keys(headers).filter((h) => h.startsWith('access-control-'));
    const allowed = await preflight(`http://localhost:${base.port}`);
    expect(allowed.status).toBe(405);
    expect(corsHeaders(allowed.headers)).toEqual([]);
    const other = await preflight('https://app.example.com');
    expect(other.status).toBe(403);
    expect(corsHeaders(other.headers)).toEqual([]);
  });

  it('refuses a Host header it cannot parse with 403, and logs nothing from the request', async () => {
    const before = server.stderr().length;
    for (const [host, path] of [
      ['a b', '/mcp?LEAK-1'],
      ['u:LEAK-2@127.0.0.1', '/mcp'],
      ['127.0.0.1:99999', '/mcp?LEAK-3'],
    ] as const) {
      const res = await send(server.port, { host }, { path });
      expect(res.status, host).toBe(403);
      expect(JSON.parse(res.body), host).toEqual({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid Host header' }, id: null });
    }
    await sleep(200);
    expect(server.stderr().slice(before)).toBe('');
  });

  it('refuses a foreign Host or Origin before reading the body, and caps the body size', async () => {
    // Without these the server waits for the whole body (up to 4 MiB) first.
    const foreign = await startUpload(server.port, 'evil.example.com', 4_000_000);
    expect(foreign).toMatch(/^HTTP\/1\.1 403 /);
    // The answer closes the connection, which tells the client to stop sending.
    expect(foreign).toMatch(/^connection: close$/im);
    const foreignOrigin = await startUpload(server.port, `127.0.0.1:${server.port}`, 1_400_000, { Origin: 'https://evil.example' });
    expect(foreignOrigin).toMatch(/^HTTP\/1\.1 403 /);
    expect(foreignOrigin).toMatch(/^connection: close$/im);
    expect(await startUpload(server.port, `127.0.0.1:${server.port}`, 1_600_000)).toMatch(/^HTTP\/1\.1 413 /);
  });

  it('lets a client still sending its body read the refusal, without resetting the connection', async () => {
    // Node closes a socket as soon as it has written an answer with Connection: close. What the
    // client sent next then got a TCP reset, which could reach it before it had read the answer.
    const local = `127.0.0.1:${server.port}`;
    for (const [status, host, headers] of [
      [403, 'evil.example.com', {}],
      [403, local, { Origin: 'https://evil.example' }],
      [413, local, {}],
    ] as const) {
      const { head, error } = await keepSending(server.port, host, 3_000_000, headers);
      expect(head, `${status} ${host}`).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `));
      expect(error, `${status} ${host}`).toBeUndefined();
    }
  });

  it('closes the connection at once when the client sends another request after the refusal', async () => {
    // The server has closed its side, so that request couldn't be answered. Serving it would
    // keep it in flight, holding a request slot, for as long as the client goes on sending.
    const sock = connect({ port: server.port, host: '127.0.0.1', allowHalfOpen: true });
    let text = '';
    let error: string | undefined;
    sock.on('data', (d) => (text += d));
    sock.on('error', (e: NodeJS.ErrnoException) => (error ??= e.code ?? e.message));
    const post = (host: string) =>
      `POST /mcp HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\n` +
      `MCP-Protocol-Version: 2025-11-25\r\nContent-Length: ${Buffer.byteLength(TOOLS_LIST)}\r\n\r\n${TOOLS_LIST}`;
    try {
      sock.write(post('evil.example.com'));
      await waitFor(() => text.includes('\r\n\r\n'), () => text, 5_000);
      sock.write(post(`127.0.0.1:${server.port}`));
      // Then a third request, a line at a time: a connection still open would read these and wait.
      for (const line of ['POST /mcp HTTP/1.1\r\n', ...Array.from({ length: 7 }, (_, i) => `X-${i}: 1\r\n`)]) {
        await sleep(250);
        if (!sock.destroyed) sock.write(line);
      }
      await sleep(300);
      expect(text.match(/^HTTP\/1\.1 \d+/gm)).toEqual(['HTTP/1.1 403']);
      expect(error).toMatch(/^(EPIPE|ECONNRESET)$/);
    } finally {
      sock.destroy();
    }
  });

  it('serves the largest valid request', async () => {
    // The schema counts code points, so the longest prompt is PROMPT_MAX_CHARS
    // characters outside the BMP; here each is written as an escaped surrogate pair.
    const astral = '\u{1D400}';
    const escaped = [0, 1].map((i) => `\\u${astral.charCodeAt(i).toString(16)}`).join('');
    const body = `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check_prompt","arguments":{"prompt":"${escaped.repeat(PROMPT_MAX_CHARS)}"}}}`;
    expect(body.length).toBeGreaterThan(1_200_000);
    const res = await send(server.port, { host: `127.0.0.1:${server.port}` }, { body });
    expect(res.status).toBe(200);
    expect(res.body).toContain('"result"');
    expect(res.body).not.toContain('"isError":true');
  });

  it("takes JSON-RPC batches as the README's limits say: up to 100 messages, from 2025-era clients", async () => {
    // These rules are the MCP SDK's, so an SDK update that changes them fails here.
    const readme = readFileSync(join(PKG, 'README.md'), 'utf8');
    const limits = readme.slice(readme.indexOf("The HTTP server's own limits:"), readme.indexOf('### Cloudflare Workers'));
    const stated = Number(/batches of up to ([\d,]+) messages/.exec(limits)?.[1]?.replace(/,/g, ''));
    expect(stated).toBeGreaterThan(1);
    const host = `127.0.0.1:${base.port}`;
    const ping = (id: number, meta?: object) => ({ jsonrpc: '2.0', id, method: 'ping', ...(meta ? { params: { _meta: meta } } : {}) });
    const batch = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ping(i + 1)));
    const full = await raw('/mcp', { host }, batch(stated));
    expect(full.status).toBe(200);
    expect(full.body.split('data: ').length - 1).toBe(stated);
    const over = await raw('/mcp', { host }, batch(stated + 1));
    expect(over.status).toBe(400);
    expect(over.body).toContain(`Batch must not exceed ${stated} messages`);
    expect(limits).toMatch(/a batch that holds a 2026-07-28 request, gets `400`/);
    const envelope = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'e2e', version: '0' },
      'io.modelcontextprotocol/clientCapabilities': {},
    };
    const modern = await raw('/mcp', { host, 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'ping' }, JSON.stringify([ping(1, envelope), ping(2, envelope)]));
    expect(modern.status).toBe(400);
    expect(modern.body).toContain('batches may not contain requests for protocol revision 2026-07-28');
  });

  it("logs the errors the SDK's 2025-era transport reports, as one line each, without the request", async () => {
    const host = `127.0.0.1:${base.port}`;
    const logged = async (headers: Record<string, string>, body: string) => {
      const before = server.stderr().length;
      const res = await raw('/mcp', { host, ...headers }, body);
      await sleep(200);
      return { res, line: server.stderr().slice(before) };
    };
    // A URI over the SDK's 1,000,000-character limit fails before the resource handler runs:
    // the SDK answers 500, without the request's id, and reports the error to the server.
    const prefix = 'prompt-engine://checklists/';
    const uri = `${prefix}${'LEAK'.repeat(250_001)}`.slice(0, 1_000_001);
    const long = await logged({}, JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri } }));
    expect(long.res.status).toBe(500);
    expect(JSON.parse(long.res.body)).toEqual({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    expect(long.line).toBe('[prompt-engine-mcp] Error: URI exceeds maximum length of 1000000 characters (got 1000001)\n');
    // The SDK's messages for these quote a header value, a request id or the message as JSON.
    const ping = JSON.stringify({ jsonrpc: '2.0', id: 'LEAK-1', method: 'ping' });
    // In a batch whose requests share an id, the answer to the second can't be sent, and the
    // message quotes the id: once for a result, once for an error.
    const twice = (message: object) => JSON.stringify([message, message]);
    for (const [headers, body, line] of [
      [{}, twice({ jsonrpc: '2.0', id: 'LEAK-3 \u{202E}', method: 'ping' }), 'dropped a response (unknown-or-duplicate-request-id)'],
      [{}, twice({ jsonrpc: '2.0', id: 'LEAK-4 \u{202E}', method: 'no/such/method' }), 'dropped a response (unknown-or-duplicate-request-id)'],
      [{ 'mcp-protocol-version': '1999-01-01' }, ping, 'rejected a request (unsupported-protocol-version)'],
      [{ accept: 'application/json' }, ping, 'rejected a request (not-acceptable)'],
      [{}, JSON.stringify(Array.from({ length: 101 }, (_, i) => ({ jsonrpc: '2.0', id: `LEAK-${i}`, method: 'ping' }))), 'rejected a request (batch-too-large)'],
      [{}, JSON.stringify({ jsonrpc: '2.0', id: 987654321, result: { LEAK: 987654321 } }), 'ignored a response (unknown-request-id)'],
      [{}, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'LEAK-2', progress: 987654321 } }), 'ignored a notification (unknown-progress-token)'],
    ] as const) {
      const { res, line: got } = await logged(headers, body);
      expect(res.status, line).toBeGreaterThanOrEqual(200);
      expect(got, line).toBe(`[prompt-engine-mcp] ${line}\n`);
    }
  });

  it('answers other methods, such as TRACE, with 405 and logs nothing', async () => {
    const before = server.stderr().length;
    const res = await send(server.port, { host: `127.0.0.1:${server.port}` }, { method: 'TRACE', body: '' });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
    await sleep(200);
    expect(server.stderr().slice(before)).toBe('');
  });

  it('logs rejected and unreadable requests by reason code only, never their content', async () => {
    const host = `127.0.0.1:${base.port}`;
    const envelope = (extra: Record<string, unknown> = {}) => ({
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'LEAK-A', version: '1' },
      'io.modelcontextprotocol/clientCapabilities': {},
      ...extra,
    });
    const before = server.stderr().length;
    const rejected = [
      // A modern request without its Mcp-Method header; the body names a made-up method.
      await raw('/mcp', { host, 'mcp-protocol-version': '2026-07-28' }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'LEAK-B/secret-method', params: { _meta: envelope() } })),
      // A modern header without the per-request envelope.
      await raw('/mcp', { host, 'mcp-protocol-version': 'LEAK-C' }, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'check_prompt', arguments: { prompt: 'LEAK-D' } } })),
      // An envelope with an invalid clientInfo.
      await raw('/mcp', { host, 'mcp-protocol-version': '2026-07-28' }, JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_prompt', arguments: { prompt: 'LEAK-E' }, _meta: envelope({ 'io.modelcontextprotocol/clientInfo': 'LEAK-F' }) } })),
      // Not JSON at all, and the wrong content type.
      await raw('/mcp', { host }, '{"jsonrpc": "2.0", LEAK-G'),
      await raw('/mcp', { host, 'content-type': 'text/plain' }, 'LEAK-H'),
    ];
    for (const res of rejected) expect(res.status).toBeGreaterThanOrEqual(400);
    await sleep(200);
    const logged = server.stderr().slice(before);
    expect(logged).toMatch(/rejected a request \(method-header-missing\)/);
    expect(logged).toMatch(/rejected a request \(unsupported-media-type\)/);
    expect(logged).not.toMatch(/LEAK/);
    const lines = logged.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) expect(line).toMatch(/^\[prompt-engine-mcp\] rejected a request \([a-z0-9-]+\)$/);
  });
});

describe('--allowed-hosts', () => {
  it('ignores a port in an entry, with a warning, and still matches the hostname', async () => {
    const server = await startHttp(['--allowed-hosts', 'MCP.Example.com:8080,::1,a b']);
    try {
      expect(server.stderr()).toMatch(/listening on http:\/\/127\.0\.0\.1:\d+\/mcp \(allowed hosts: mcp\.example\.com, \[::1\]\)/);
      expect(server.stderr()).toContain('warning: --allowed-hosts takes hostnames without ports, so the port was ignored in: MCP.Example.com:8080');
      expect(server.stderr()).toContain('warning: --allowed-hosts takes exact hostnames, so these entries were ignored: a b');
      const status = async (host: string) => (await send(server.port, { host })).status;
      expect(await status('mcp.example.com:8080')).toBe(200);
      expect(await status(`[::1]:${server.port}`)).toBe(200);
      expect(await status(`localhost:${server.port}`)).toBe(403);
    } finally {
      server.proc.kill('SIGTERM');
    }
  });

  it('replaces the localhost defaults, and wins over PROMPT_ENGINE_ALLOWED_HOSTS', async () => {
    const server = await startHttp(['--allowed-hosts', 'mcp.example.com'], { ...ENV, PROMPT_ENGINE_ALLOWED_HOSTS: 'env.example.com' });
    try {
      expect(server.stderr()).toMatch(/\(allowed hosts: mcp\.example\.com\)/);
      const status = async (host: string) => (await send(server.port, { host })).status;
      expect(await status('mcp.example.com')).toBe(200);
      expect(await status(`localhost:${server.port}`)).toBe(403);
      expect(await status('env.example.com')).toBe(403);
    } finally {
      server.proc.kill('SIGTERM');
    }
  });

  it('reads PROMPT_ENGINE_ALLOWED_HOSTS without the flag, and names it in the warning', async () => {
    const server = await startHttp([], { ...ENV, PROMPT_ENGINE_ALLOWED_HOSTS: 'MCP.Example.com:8080' });
    try {
      expect(server.stderr()).toContain('warning: PROMPT_ENGINE_ALLOWED_HOSTS takes hostnames without ports, so the port was ignored in: MCP.Example.com:8080');
      expect(server.stderr()).toMatch(/\(allowed hosts: mcp\.example\.com\)/);
      const status = async (host: string) => (await send(server.port, { host })).status;
      expect(await status('mcp.example.com:8080')).toBe(200);
      expect(await status(`localhost:${server.port}`)).toBe(403);
    } finally {
      server.proc.kill('SIGTERM');
    }
  });

  it('gives no localhost-only note for a loopback bind written another way', async () => {
    const server = await startHttp(['--host', 'LOCALHOST']);
    try {
      await sleep(100);
      expect(server.stderr()).not.toMatch(/note:/);
    } finally {
      server.proc.kill('SIGTERM');
    }
  });
});
