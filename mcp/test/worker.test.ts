// The Cloudflare Worker entry, called in-process with a fake env: the same
// ALLOWED_HOSTS parsing as the CLI (ports ignored with one warning).

import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker.js';

const toolsList = (host: string) =>
  new Request(`http://${host}/mcp`, {
    method: 'POST',
    headers: { host, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

describe('worker entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts hosts from ALLOWED_HOSTS, ignoring a port with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { ALLOWED_HOSTS: 'MCP.Example.com:8080' };
    expect((await worker.fetch(toolsList('mcp.example.com:8080'), env)).status).toBe(200);
    expect((await worker.fetch(toolsList('mcp.example.com'), env)).status).toBe(200);
    expect((await worker.fetch(toolsList('evil.example.com'), env)).status).toBe(403);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/ALLOWED_HOSTS takes hostnames without ports, so the port was ignored in: MCP\.Example\.com:8080/);
  });

  it('brackets a bare IPv6 address and refuses to serve without ALLOWED_HOSTS', async () => {
    expect((await worker.fetch(toolsList('[::1]:8787'), { ALLOWED_HOSTS: '::1' })).status).toBe(200);
    expect((await worker.fetch(toolsList('localhost'), {})).status).toBe(500);
    expect((await worker.fetch(new Request('http://localhost/other'), { ALLOWED_HOSTS: 'localhost' })).status).toBe(404);
  });
});
