// Shared helpers for the tests that run the built CLI (dist/cli.js) as a child
// process: e2e.test.ts and http-limits.test.ts. `npm test` builds first.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { PKG } from './helpers.js';

export const CLI = join(PKG, 'dist', 'cli.js');
if (!existsSync(CLI)) throw new Error('dist/cli.js is missing; run npm run build (npm test does it for you)');

export const TOOLS_LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

// The servers run without PROMPT_ENGINE_ALLOWED_HOSTS unless a test sets it,
// so a developer's shell setting can't change what they accept.
export const ENV: NodeJS.ProcessEnv = { ...process.env };
delete ENV.PROMPT_ENGINE_ALLOWED_HOSTS;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until done() is true, or throws after `ms` with what() as the detail. */
export async function waitFor(done: () => boolean, what: () => string, ms = 15_000): Promise<void> {
  for (const end = Date.now() + ms; !done(); await sleep(25)) if (Date.now() > end) throw new Error(`timed out:\n${what()}`);
}

/** Starts `cli.js --http --port 0 ...args`; resolves once the start-up line names the port. */
export async function startHttp(args: string[] = [], env: NodeJS.ProcessEnv = ENV) {
  const proc = spawn(process.execPath, [CLI, '--http', '--port', '0', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let stderr = '';
  proc.stderr!.on('data', (d) => (stderr += d));
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${stderr}`)), 20_000);
    proc.stderr!.on('data', () => {
      const m = stderr.match(/listening on http:\/\/(?:\[[^\]]+\]|[^:/]+):(\d+)\/mcp/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on('exit', (code) => reject(new Error(`server exited with ${code}:\n${stderr}`)));
  });
  return { proc, port, stderr: () => stderr };
}

/** Sends one request to 127.0.0.1:port (by default a 2025-era tools/list POST to /mcp), on its own connection. */
export function send(
  port: number,
  headers: Record<string, string>,
  { body = TOOLS_LIST, path = '/mcp', method = 'POST' } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        agent: false,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
          'content-length': String(Buffer.byteLength(body)),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Sends a POST head that announces a body of `contentLength` bytes, then only
 * its first kilobyte; resolves with the response head, or 'no response' if the
 * server is still waiting for the body after 5 s.
 */
export function startUpload(port: number, host: string, contentLength: number, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1');
    let text = '';
    const done = (result: string) => {
      clearTimeout(timer);
      sock.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => done('no response'), 5_000);
    sock.on('data', (d) => {
      text += d;
      if (text.includes('\r\n\r\n')) done(text.slice(0, text.indexOf('\r\n\r\n')));
    });
    sock.on('error', () => done(text || 'socket error'));
    const extra = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('');
    sock.write(
      `POST /mcp HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\n` +
        `MCP-Protocol-Version: 2025-11-25\r\n${extra}Content-Length: ${contentLength}\r\n\r\n${'a'.repeat(1024)}`,
    );
  });
}
