// The --http server's limits on connections, requests in flight and slow
// clients, against the built CLI. Each test starts its own server, and they
// run concurrently because the timeout test waits 10-15 s.

import { connect, type Socket } from 'node:net';
import { describe, it } from 'vitest';
import { ENV, send, sleep, startHttp, startUpload, TOOLS_LIST } from './cli-helpers.js';

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
 * Starts a tools/list POST that announces a body of `length` bytes and sends
 * 1 KB of it. It asks for 100 Continue, which Node writes just before it hands
 * the request to the server's handler, so once that arrives the handler has seen it.
 */
function holdUpload(port: number, held: Held[], length = 50_000): Promise<void> {
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
        `MCP-Protocol-Version: 2025-11-25\r\nExpect: 100-continue\r\nContent-Length: ${length}\r\n\r\n`,
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

  it('admits requests while their bodies add up to at most 8,000,000 bytes, and answers 503 past that before reading the body', async ({ expect }) => {
    const server = await startHttp();
    const held: Held[] = [];
    const hostname = `127.0.0.1:${server.port}`;
    const waiting = () => held.filter((h) => h.sock.destroyed || !/^HTTP\/1\.1 100 Continue\r\n\r\n$/.test(h.text)).length;
    try {
      // Five bodies of the largest size fit; a sixth doesn't, and neither does a chunked
      // upload, which counts as the largest size. A small request still fits.
      for (let i = 0; i < 5; i++) await holdUpload(server.port, held, 1_500_000);
      const before = server.stderr().length;
      expect(await startUpload(server.port, hostname, 1_500_000)).toMatch(/^HTTP\/1\.1 503 [^]*\r\nretry-after: 1\r\n/i);
      expect(await startUpload(server.port, hostname, 1_000_000)).toMatch(/^HTTP\/1\.1 503 /);
      expect(await startUpload(server.port, hostname, 'chunked')).toMatch(/^HTTP\/1\.1 503 /);
      expect((await send(server.port, { host: hostname })).status).toBe(200);
      await sleep(100);
      expect(waiting()).toBe(0);
      expect(server.stderr().slice(before)).toBe('');
      // Dropped uploads give their bytes back.
      for (const { sock } of held.splice(0)) sock.destroy();
      await sleep(300);
      for (let i = 0; i < 5; i++) await holdUpload(server.port, held, 1_500_000);
      await sleep(100);
      expect(waiting()).toBe(0);
    } finally {
      for (const { sock } of held) sock.destroy();
      server.proc.kill('SIGTERM');
    }
  });

  it('stays up with a 512 MB heap while 32 clients send dense batches of the largest size at once', async ({ expect }) => {
    // Each call's _meta nests arrays thousands deep: about 28 bytes of heap for each byte of
    // the body while the request is in flight (about 40 MiB for this 1.5 MB body, measured
    // in Node 24), so 128 of them at once would need about 5 GiB.
    const depth = 7_400;
    const call = (id: number) =>
      `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"get_checklist","arguments":{"domain":"image-video"},"_meta":{"pad":${'['.repeat(depth)}${']'.repeat(depth)}}}}`;
    const body = `[${Array.from({ length: 100 }, (_, i) => call(i + 1)).join(',')}]`;
    expect(body.length).toBeGreaterThan(1_480_000);
    expect(body.length).toBeLessThanOrEqual(1_500_000);
    const server = await startHttp([], { ...ENV, NODE_OPTIONS: '--max-old-space-size=512' });
    const host = { host: `127.0.0.1:${server.port}` };
    // A response cut off by a crash never settles send(), so race the requests against the exit.
    const exited = new Promise<string>((resolve) =>
      server.proc.on('exit', (code, signal) => resolve(`server exited (${code ?? signal}): ${/FATAL ERROR[^\n]*/.exec(server.stderr())?.[0] ?? ''}`)),
    );
    try {
      // A refused upload gets 503 and its connection is closed before the body is read, so a
      // client still sending may see the connection reset instead: 'reset' here.
      const all = Promise.all(Array.from({ length: 32 }, () => send(server.port, host, { body }).then((r) => r.status, () => 'reset')));
      expect(await Promise.race([all.then(() => 'all answered'), exited])).toBe('all answered');
      const statuses = await all;
      expect(statuses.filter((s) => s !== 200 && s !== 503 && s !== 'reset'), statuses.join()).toEqual([]);
      expect(statuses, statuses.join()).toContain(200);
      expect(statuses.filter((s) => s !== 200).length, statuses.join()).toBeGreaterThan(0);
      await sleep(200);
      expect(server.proc.exitCode ?? server.proc.signalCode, server.stderr()).toBeNull();
      expect((await send(server.port, host)).status).toBe(200);
    } finally {
      server.proc.kill('SIGTERM');
    }
  });

  it('closes a connection whose answers the client stops reading after 15-20 s, which frees their slots', async ({ expect }) => {
    const server = await startHttp();
    const host = { host: `127.0.0.1:${server.port}` };
    // A batch whose answer (2.2 MB) is more than the socket buffers hold, then 127 tools/list
    // behind it on the same connection, all sent at once: the one connection takes every slot.
    const batch = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name: 'get_checklist', arguments: { domain: 'image-video' } } })),
    );
    const post = (body: string) =>
      `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\n` +
      `MCP-Protocol-Version: 2025-11-25\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const sock = connect(server.port, '127.0.0.1');
    sock.on('error', () => {});
    sock.pause(); // never reads
    try {
      await new Promise((resolve) => sock.once('connect', resolve));
      const started = Date.now();
      sock.write(post(batch) + post(TOOLS_LIST).repeat(127));
      await sleep(2_000);
      expect((await send(server.port, host)).status).toBe(503);
      let status = 503;
      while (status === 503 && Date.now() - started < 30_000) {
        await sleep(500);
        status = (await send(server.port, host)).status;
      }
      const seconds = (Date.now() - started) / 1000;
      expect(status, `slots still held after ${seconds} s`).toBe(200);
      expect(seconds).toBeGreaterThanOrEqual(14);
      expect(seconds).toBeLessThan(25);
    } finally {
      sock.destroy();
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
