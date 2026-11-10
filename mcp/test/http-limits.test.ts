// The --http server's limits on connections, requests in flight and slow
// clients, against the built CLI. Each test starts its own server, and they
// run concurrently because the timeout tests wait 10-15 s and 30-35 s.

import { connect, type Socket } from 'node:net';
import { describe, it } from 'vitest';
import { ENV, keepSending, send, sleep, startHttp, startUpload, TOOLS_LIST, waitFor } from './cli-helpers.js';

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
 * It resolves for a refused upload too, whose 503 follows the 100 Continue: to
 * know which were admitted, check what else each one's text holds.
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

/** A 2025-era POST to /mcp with this body, written out for a raw socket. */
function post(port: number, body: string, extraHeaders = ''): string {
  return (
    `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\n` +
    `MCP-Protocol-Version: 2025-11-25\r\n${extraHeaders}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  );
}

/** A batch of 100 get_checklist calls, whose answer (2.2 MB) is more than the socket buffers hold. */
const BATCH = JSON.stringify(
  Array.from({ length: 100 }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name: 'get_checklist', arguments: { domain: 'image-video' } } })),
);

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
      // A client still sending its body reads the 503, rather than a reset connection.
      expect(await keepSending(server.port, hostname, 1_000_000)).toEqual({ head: expect.stringMatching(/^HTTP\/1\.1 503 /), error: undefined });
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

  it('reads and discards a refused body while the client sends it, and closes the connection after 2 s without data', async ({ expect }) => {
    const server = await startHttp();
    const sock = connect({ port: server.port, host: '127.0.0.1', allowHalfOpen: true });
    let text = '';
    let error: string | undefined;
    sock.on('data', (d) => (text += d));
    sock.on('error', (e: NodeJS.ErrnoException) => (error ??= e.code ?? e.message));
    const kilobyte = 'a'.repeat(1024);
    try {
      // A foreign Host, with most of the body it announces still to come.
      sock.write(`POST /mcp HTTP/1.1\r\nHost: evil.example.com\r\nContent-Type: application/json\r\nContent-Length: 3000000\r\n\r\n${kilobyte}`);
      await waitFor(() => text.includes('\r\n\r\n'), () => text, 5_000);
      expect(text).toMatch(/^HTTP\/1\.1 403 /);
      // A kilobyte every half second keeps it open, past the 2 s.
      for (let i = 0; i < 6; i++) {
        await sleep(500);
        sock.write(kilobyte);
      }
      await sleep(200);
      expect(error).toBeUndefined();
      // After 2 s without data the server closes it, so what the client sends later gets a reset.
      await sleep(4_000);
      for (let i = 0; i < 2; i++) {
        sock.write(kilobyte);
        await sleep(300);
      }
      expect(error).toMatch(/^(EPIPE|ECONNRESET)$/);
    } finally {
      sock.destroy();
      server.proc.kill('SIGTERM');
    }
  });

  // The idle timer alone would keep it open for good: llhttp skips empty lines between requests,
  // so they start no header or request timeout, and each one resets the timer. The client only
  // sees the close when its next empty line gets a reset, up to a second later.
  it('closes a refused connection about 30 s after the answer while the client keeps sending empty lines', { timeout: 90_000 }, async ({ expect }) => {
    const server = await startHttp();
    const sock = connect({ port: server.port, host: '127.0.0.1', allowHalfOpen: true });
    let text = '';
    let closedAt: number | undefined;
    sock.on('data', (d) => (text += d));
    sock.on('error', () => {});
    sock.on('close', () => (closedAt = Date.now()));
    const crlf = setInterval(() => sock.writable && sock.write('\r\n'), 1_000);
    try {
      await new Promise((resolve) => sock.once('connect', resolve));
      sock.write(post(server.port, TOOLS_LIST, 'Origin: http://evil.example.com\r\n'));
      await waitFor(() => text.includes('\r\n\r\n'), () => text, 5_000);
      const answered = Date.now();
      expect(text).toMatch(/^HTTP\/1\.1 403 /);
      await waitFor(() => closedAt !== undefined, () => `still open after ${(Date.now() - answered) / 1000} s`, 40_000);
      const seconds = (closedAt! - answered) / 1000;
      expect(seconds).toBeGreaterThanOrEqual(29.5);
      expect(seconds).toBeLessThan(35);
    } finally {
      clearInterval(crlf);
      sock.destroy();
      server.proc.kill('SIGTERM');
    }
  });

  it('closes a connection once a refusal is written, when requests admitted behind it can never be answered', async ({ expect }) => {
    const server = await startHttp();
    const held: Held[] = [];
    // On one connection, all sent at once: the batch, a request refused for its Origin, and 127
    // pings. While the batch's answer waits for the client, the refusal waits behind it and the
    // pings behind that are admitted. Their answers can't be sent once the refusal's answer has
    // closed the connection, and the client sends an empty line each second, which would keep
    // resetting an idle timer.
    const sock = connect({ port: server.port, host: '127.0.0.1', allowHalfOpen: true });
    let text = '';
    let closed = false;
    sock.on('data', (d: Buffer) => (text += d.toString('latin1')));
    sock.on('error', () => {});
    sock.on('close', () => (closed = true));
    sock.pause();
    const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const crlf = setInterval(() => sock.writable && sock.write('\r\n'), 1_000);
    try {
      await new Promise((resolve) => sock.once('connect', resolve));
      sock.write(post(server.port, BATCH) + post(server.port, TOOLS_LIST, 'Origin: http://evil.example.com\r\n') + post(server.port, ping).repeat(127));
      await sleep(500);
      sock.resume();
      await waitFor(() => closed, () => `still open; answers: ${text.match(/^HTTP\/1\.1 \d+/gm)?.join(', ')}`, 5_000);
      expect(text.match(/^HTTP\/1\.1 \d+/gm)).toEqual(['HTTP/1.1 200', 'HTTP/1.1 403']);
      // Every slot is free again: 128 uploads are all still waiting for their bodies.
      for (let i = 0; i < 128; i++) await holdUpload(server.port, held);
      await sleep(100);
      expect(held.filter((h) => h.sock.destroyed || !/^HTTP\/1\.1 100 Continue\r\n\r\n$/.test(h.text)).length).toBe(0);
    } finally {
      clearInterval(crlf);
      sock.destroy();
      for (const { sock: upload } of held) upload.destroy();
      server.proc.kill('SIGTERM');
    }
  });

  it('takes five of 32 dense batches of the largest size offered at once, and stays up with a 512 MB heap while they arrive', async ({ expect }) => {
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
    // An answer cut off by a crash never closes its connection, so race them against the exit.
    const exited = new Promise<string>((resolve) =>
      server.proc.on('exit', (code, signal) => resolve(`server exited (${code ?? signal}): ${/FATAL ERROR[^\n]*/.exec(server.stderr())?.[0] ?? ''}`)),
    );
    const clients: Array<Held & { closed: Promise<void> }> = [];
    try {
      // Every head goes first, asking for 100 Continue, so the server decides before any body
      // arrives: it takes the five whose bodies fit in 8,000,000 bytes and refuses the rest. Node
      // writes 100 Continue to each before the server's handler runs, so a refused one gets its
      // 503 right after it.
      for (let i = 0; i < 32; i++) {
        const sock = connect(server.port, '127.0.0.1');
        const client = { sock, text: '', closed: new Promise<void>((resolve) => sock.on('close', () => resolve())) };
        sock.on('data', (d) => (client.text += d));
        sock.on('error', () => {});
        sock.write(
          `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\n` +
            `MCP-Protocol-Version: 2025-11-25\r\nExpect: 100-continue\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n`,
        );
        clients.push(client);
      }
      await waitFor(() => clients.every((c) => c.text.startsWith('HTTP/1.1 100 Continue\r\n\r\n')), () => clients.map((c) => c.text.slice(0, 40)).join('\n'));
      await sleep(200);
      const admitted = clients.filter((c) => c.text === 'HTTP/1.1 100 Continue\r\n\r\n');
      const neither = clients.filter((c) => !admitted.includes(c) && !/^HTTP\/1\.1 100 Continue\r\n\r\nHTTP\/1\.1 503 /.test(c.text));
      expect(neither.map((c) => c.text.slice(0, 60))).toEqual([]);
      expect(admitted.length).toBe(5);
      // Then the five send their bodies at once.
      for (const c of admitted) c.sock.write(body);
      expect(await Promise.race([Promise.all(admitted.map((c) => c.closed)).then(() => 'all answered'), exited])).toBe('all answered');
      for (const c of admitted) expect(c.text.slice(0, 60)).toMatch(/^HTTP\/1\.1 100 Continue\r\n\r\nHTTP\/1\.1 200 /);
      await sleep(200);
      expect(server.proc.exitCode ?? server.proc.signalCode, server.stderr()).toBeNull();
      expect((await send(server.port, host)).status).toBe(200);
    } finally {
      for (const { sock } of clients) sock.destroy();
      server.proc.kill('SIGTERM');
    }
  });

  it('closes a connection whose answers the client stops reading after 15-20 s, which frees their slots', async ({ expect }) => {
    const server = await startHttp();
    const host = { host: `127.0.0.1:${server.port}` };
    // A batch whose answer (2.2 MB) is more than the socket buffers hold, then 127 tools/list
    // behind it on the same connection, all sent at once: the one connection takes every slot.
    const sock = connect(server.port, '127.0.0.1');
    sock.on('error', () => {});
    sock.pause(); // never reads
    try {
      await new Promise((resolve) => sock.once('connect', resolve));
      const started = Date.now();
      sock.write(post(server.port, BATCH) + post(server.port, TOOLS_LIST).repeat(127));
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

  // The answer leaves the socket in bursts, as the operating system's buffers make room, and
  // each burst refills the socket's buffer to the same length. A check that compared that
  // length every 5 s closed this reader after about 35 s, with 75 of the 100 answers.
  it('lets a client that reads a 2.2 MB answer steadily at 50 KB/s read all of it', { timeout: 90_000 }, async ({ expect }) => {
    const server = await startHttp();
    const sock = connect(server.port, '127.0.0.1');
    let text = '';
    let closed = false;
    sock.on('error', () => {});
    sock.on('close', () => (closed = true));
    sock.pause();
    // 5,000 bytes every 100 ms, and what is left once fewer than 2,048 bytes wait.
    const reader = setInterval(() => {
      for (let n = 0, chunk: Buffer | null; n < 5_000 && (chunk = sock.read(Math.min(2_048, 5_000 - n))) !== null; n += chunk.length) text += chunk.toString('latin1');
      if (sock.readableLength < 2_048) text += sock.read()?.toString('latin1') ?? '';
    }, 100);
    try {
      await new Promise((resolve) => sock.once('connect', resolve));
      sock.write(post(server.port, BATCH, 'Connection: close\r\n'));
      await waitFor(() => closed, () => `still reading, ${text.length} bytes so far`, 80_000);
      expect(text.match(/^data: /gm)?.length, `${text.length} bytes read`).toBe(100);
      expect(text).toMatch(/\r\n0\r\n\r\n$/);
    } finally {
      clearInterval(reader);
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

  // The request timeout is what frees the slot a stalled upload holds. It can take up to 5 s past
  // its 30 s; the bound leaves room for a loaded machine, and Node's default of 300 s fails it.
  it('answers 408 and closes a connection whose body stalls, after 30-35 s', { timeout: 90_000 }, async ({ expect }) => {
    const server = await startHttp();
    try {
      const started = Date.now();
      const sock = connect(server.port, '127.0.0.1');
      let text = '';
      sock.on('data', (d) => (text += d));
      // A tools/list POST that announces 100,000 bytes and sends the first kilobyte.
      sock.write(
        `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\n` +
          `MCP-Protocol-Version: 2025-11-25\r\nContent-Length: 100000\r\n\r\n${'a'.repeat(1024)}`,
      );
      const closed = await closesWithin(sock, 40_000);
      const seconds = (Date.now() - started) / 1000;
      sock.destroy();
      expect(closed, `still open after ${seconds} s`).toBe(true);
      expect(text).toMatch(/^HTTP\/1\.1 408 /);
      expect(seconds).toBeGreaterThanOrEqual(29.5);
      expect(seconds).toBeLessThan(40);
      // The cut-off upload may be logged, as the README says, but nothing that quotes it.
      expect(server.stderr().split('\n').slice(1).filter((line) => line && line !== '[prompt-engine-mcp] Error: aborted')).toEqual([]);
    } finally {
      server.proc.kill('SIGTERM');
    }
  });
});
