// The Cloudflare Worker entry, called in-process with a fake env: the same
// ALLOWED_HOSTS parsing as the CLI (ports ignored with one warning) and the
// same body cap.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROMPT_MAX_CHARS } from '../src/check.js';
import worker from '../src/worker.js';

const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

const post = (host: string, body = LIST) =>
  new Request(`http://${host}/mcp`, {
    method: 'POST',
    headers: { host, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body,
  });

/** A check_prompt call whose prompt is given as JSON text. */
const checkPrompt = (promptJson: string) =>
  `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check_prompt","arguments":{"prompt":${promptJson}}}}`;

/** JSON text for a string with every UTF-16 unit written as an escape: the longest way to send it. */
const escapedJson = (s: string) => `"${Array.from({ length: s.length }, (_, i) => `\\u${s.charCodeAt(i).toString(16).padStart(4, '0')}`).join('')}"`;

/** Reads a response's body for up to `ms`; says whether it ended, and cancels it if it didn't. */
async function readFor(res: Response, ms: number): Promise<{ text: string; ended: boolean }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + ms;
  let text = '';
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()))));
    const next = await Promise.race([reader.read(), timeout]);
    clearTimeout(timer);
    if (next === 'timeout') {
      await reader.cancel();
      return { text, ended: false };
    }
    if (next.done) return { text, ended: true };
    text += decoder.decode(next.value, { stream: true });
  }
}

describe('worker entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts hosts from ALLOWED_HOSTS, ignoring a port with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { ALLOWED_HOSTS: 'MCP.Example.com:8080' };
    expect((await worker.fetch(post('mcp.example.com:8080'), env)).status).toBe(200);
    expect((await worker.fetch(post('mcp.example.com'), env)).status).toBe(200);
    expect((await worker.fetch(post('evil.example.com'), env)).status).toBe(403);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/ALLOWED_HOSTS takes hostnames without ports, so the port was ignored in: MCP\.Example\.com:8080/);
  });

  it('brackets a bare IPv6 address and refuses to serve without ALLOWED_HOSTS', async () => {
    expect((await worker.fetch(post('[::1]:8787'), { ALLOWED_HOSTS: '::1' })).status).toBe(200);
    const unset = await worker.fetch(post('localhost'), {});
    expect(unset.status).toBe(500);
    expect(await unset.json()).toEqual({ error: 'ALLOWED_HOSTS is not set. Set it to the hostnames clients use, such as your workers.dev name.' });
    expect((await worker.fetch(new Request('http://localhost/other'), { ALLOWED_HOSTS: 'localhost' })).status).toBe(404);
  });

  it('accepts the hostname of a pasted URL', async () => {
    const env = { ALLOWED_HOSTS: 'https://prompt-engine-mcp.example.workers.dev/' };
    expect((await worker.fetch(post('prompt-engine-mcp.example.workers.dev'), env)).status).toBe(200);
  });

  it('says so, with a warning, when ALLOWED_HOSTS names no usable hostname', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await worker.fetch(post('localhost:8787'), { ALLOWED_HOSTS: ':8787, a b' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'ALLOWED_HOSTS names no usable hostname. Set it to the hostnames clients use, such as your workers.dev name.' });
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(['prompt-engine-mcp: warning: ALLOWED_HOSTS takes exact hostnames, so these entries were ignored: :8787, a b']);
  });

  it('says so, rather than throwing on every request, when ALLOWED_HOSTS is not a string', async () => {
    // Wrangler's vars take JSON values too, so a list written as one arrives as an array.
    const values: Array<[unknown, string]> = [[['localhost', '127.0.0.1'], 'list'], [8787, 'number'], [{ host: 'localhost' }, 'object'], [true, 'boolean']];
    for (const [value, kind] of values) {
      const res = await worker.fetch(post('localhost'), { ALLOWED_HOSTS: value });
      expect(res.status, kind).toBe(500);
      expect(await res.json(), kind).toEqual({
        error: `ALLOWED_HOSTS is a JSON ${kind}, not a string. Set it to the hostnames clients use as one comma-separated string, such as "mcp.example.com,localhost".`,
      });
    }
    // null counts as not set.
    const unset = await worker.fetch(post('localhost'), { ALLOWED_HOSTS: null });
    expect(await unset.json()).toEqual({ error: 'ALLOWED_HOSTS is not set. Set it to the hostnames clients use, such as your workers.dev name.' });
  });

  it('serves the largest valid request and refuses a larger body with 413', async () => {
    const env = { ALLOWED_HOSTS: 'localhost' };
    // The schema counts code points, so the longest prompt is PROMPT_MAX_CHARS
    // characters outside the BMP; here each is written as an escaped surrogate pair.
    const largest = checkPrompt(escapedJson('\u{1D400}'.repeat(PROMPT_MAX_CHARS)));
    expect(largest.length).toBeGreaterThan(1_200_000);
    const served = await worker.fetch(post('localhost', largest), env);
    expect(served.status).toBe(200);
    const text = await served.text();
    expect(text).toContain('"result"');
    expect(text).not.toContain('"isError":true');
    const tooLarge = await worker.fetch(post('localhost', checkPrompt(JSON.stringify('a'.repeat(1_600_000)))), env);
    expect(tooLarge.status).toBe(413);
  });

  // As in the CLI (see the cancelled-batch test in http-limits.test.ts): the MCP SDK sends no
  // answer for a cancelled request and ends a batch's answer only once each request in it has one,
  // so without the server ignoring such a cancel, this answer never ended.
  it('answers a 2025-era batch that cancels its own request, and ends the answer', async () => {
    const env = { ALLOWED_HOSTS: 'localhost' };
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const cancel = { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } };
    for (const batch of [[request, cancel], [cancel, request]]) {
      const res = await worker.fetch(post('localhost', JSON.stringify(batch)), env);
      expect(res.status).toBe(200);
      const { text, ended } = await readFor(res, 3_000);
      expect(ended, `${batch[0]!.method} first: ${JSON.stringify(text.slice(0, 200))}`).toBe(true);
      expect(text.match(/^data: \{"result":/gm)).toHaveLength(1);
    }
  });

  it('takes JSON-RPC batches of up to 100 messages, as the CLI does', async () => {
    const env = { ALLOWED_HOSTS: 'localhost' };
    const pings = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'ping' })));
    const full = await worker.fetch(post('localhost', pings(100)), env);
    expect(full.status).toBe(200);
    expect((await full.text()).split('data: ').length - 1).toBe(100);
    const over = await worker.fetch(post('localhost', pings(101)), env);
    expect(over.status).toBe(400);
    expect(await over.text()).toContain('Batch must not exceed 100 messages');
  });
});
