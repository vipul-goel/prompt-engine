// The --http server's limits on connections, requests in flight and slow
// clients, against the built CLI. Each test starts its own server, and they
// run concurrently because the timeout test waits 10-15 s.

import { connect, type Socket } from 'node:net';
import { describe, it } from 'vitest';
import { send, sleep, startHttp } from './cli-helpers.js';

/** Opens a TCP connection to the server that sends nothing; resolves once it's connected. */
function openIdle(port: number, sockets: Socket[]): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1', () => resolve(sock));
    sock.on('error', reject);
    sockets.push(sock);
  });
}

/** Resolves true if the socket closes within `ms`. */
function closesWithin(sock: Socket | undefined, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!sock || sock.destroyed) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    sock.on('error', () => {});
    sock.on('close', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

interface Held {
  sock: Socket;
  /** What the server has sent on this connection. */
  text: string;
}

/**
 * Starts a tools/list POST that announces a 100,000-byte body and sends 1 KB
 * of it. It asks for 100 Continue, which Node writes just before it hands the
 * request to the server's handler, so once that arrives the handler has seen it.
 */
function holdUpload(port: number, held: Held[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const entry: Held = { sock: connect(port, '127.0.0.1'), text: '' };
    held.push(entry);
    entry.sock.on('error', reject);
    entry.sock.on('data', (d) => {
      const first = !entry.text;
      entry.text += d;
      if (!first) return;
      if (entry.text.startsWith('HTTP/1.1 100 ')) {
        entry.sock.write('a'.repeat(1024));
        resolve();
      } else {
        reject(new Error(`expected 100 Continue, got: ${entry.text.split('\r\n')[0]}`));
      }
    });
    entry.sock.write(
      `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\n` +
        'MCP-Protocol-Version: 2025-11-25\r\nExpect: 100-continue\r\nContent-Length: 100000\r\n\r\n',
    );
  });
}

describe.concurrent('--http limits', () => {
  it('keeps serving while many connections send nothing, and closes connections past 1024 at once', async ({ expect }) => {
    const server = await startHttp();
    const sockets: Socket[] = [];
    const host = { host: `127.0.0.1:${server.port}` };
    try {
      // Connections that send nothing take no request slot.
      for (let i = 0; i < 300; i++) await openIdle(server.port, sockets);
      expect((await send(server.port, host)).status).toBe(200);
      // The socket backstop. Opened in batches, well within the 10 s header timeout.
      while (sockets.length < 1024) await Promise.all(Array.from({ length: Math.min(64, 1024 - sockets.length) }, () => openIdle(server.port, sockets)));
      await sleep(200);
      const extra = await openIdle(server.port, sockets).catch(() => undefined);
      expect(await closesWithin(extra, 3_000)).toBe(true);
      for (const sock of sockets) sock.destroy();
      await sleep(300);
      expect((await send(server.port, host)).status).toBe(200);
      expect(server.stderr().split('\n').slice(1).join('')).toBe('');
    } finally {
      for (const sock of sockets) sock.destroy();
      server.proc.kill('SIGTERM');
    }
  });

  it('serves at most 128 requests at once, and answers 503 past that before reading the body', async ({ expect }) => {
    const server = await startHttp();
    const held: Held[] = [];
    const host = { host: `127.0.0.1:${server.port}` };
    try {
      // Finished requests give their slot back.
      for (let i = 0; i < 140; i++) expect((await send(server.port, host)).status).toBe(200);
      for (let i = 0; i < 128; i++) await holdUpload(server.port, held);
      const before = server.stderr().length;
      const busy = await send(server.port, host);
      // All 128 are still waiting for their body: none was answered or closed.
      expect(held.filter((h) => h.sock.destroyed || !/^HTTP\/1\.1 100 Continue\r\n\r\n$/.test(h.text)).length).toBe(0);
      expect(busy.status).toBe(503);
      expect(busy.headers['retry-after']).toBe('1');
      expect(busy.headers.connection).toBe('close');
      expect(JSON.parse(busy.body)).toEqual({ jsonrpc: '2.0', error: { code: -32000, message: 'Server busy. Try again shortly.' }, id: null });
      // A foreign Host is still refused as such.
      expect((await send(server.port, { host: 'evil.example.com' })).status).toBe(403);
      await sleep(100);
      expect(server.stderr().slice(before)).toBe('');
      // Dropped uploads give their slot back too.
      for (const { sock } of held) sock.destroy();
      let status = 0;
      for (const end = Date.now() + 5_000; status !== 200 && Date.now() < end; await sleep(50)) status = (await send(server.port, host)).status;
      expect(status).toBe(200);
    } finally {
      for (const { sock } of held) sock.destroy();
      server.proc.kill('SIGTERM');
    }
  });

  it('answers 408 and closes a connection whose headers stall, after 10-15 s', async ({ expect }) => {
    const server = await startHttp();
    try {
      const started = Date.now();
      const sock = connect(server.port, '127.0.0.1');
      let text = '';
      sock.on('data', (d) => (text += d));
      sock.write('POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n');
      const closed = await closesWithin(sock, 17_000);
      const seconds = (Date.now() - started) / 1000;
      sock.destroy();
      expect(closed, `still open after ${seconds} s`).toBe(true);
      expect(text).toMatch(/^HTTP\/1\.1 408 /);
      expect(seconds).toBeGreaterThanOrEqual(9.5);
      expect(seconds).toBeLessThan(17);
      expect(server.stderr().split('\n').slice(1).join('')).toBe('');
    } finally {
      server.proc.kill('SIGTERM');
    }
  });
});
