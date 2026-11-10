// The --http server's limits on connections, requests in flight and slow
// clients, against the built CLI. Each test starts its own server, and they
// run concurrently because the timeout tests wait 10-15 s and 30-35 s.

import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'vitest';
import { ENV, keepSending, send, sleep, startHttp, startUpload, TOOLS_LIST, waitFor } from './cli-helpers.js';
import { PKG } from './helpers.js';

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

/** A get_checklist call whose answer is about 23 KB. */
const CHECKLIST_CALL = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_checklist', arguments: { domain: 'image-video' } } };

/** A batch of 100 get_checklist calls, whose answer (2.2 MB) is more than the socket buffers hold on macOS. */
const BATCH = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ ...CHECKLIST_CALL, id: i + 1 })));

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
      // A body declared past the 1,500,000-byte cap counts as 1,500,000 bytes, since the SDK
      // refuses it with 413 before reading it: it gets 413 rather than 503, whatever length it
      // declares, while the budget has room for 1,500,000 bytes.
      expect(await startUpload(server.port, hostname, 9_000_000)).toMatch(/^HTTP\/1\.1 413 /);
      for (let i = 0; i < 4; i++) await holdUpload(server.port, held, 1_500_000);
      expect(await startUpload(server.port, hostname, 3_000_000)).toMatch(/^HTTP\/1\.1 413 /);
      await sleep(100);
      // Five bodies of the largest size fit; a sixth doesn't, and neither does a chunked upload
      // or one declared past the cap, which count as the largest size. A small request still fits.
      await holdUpload(server.port, held, 1_500_000);
      const before = server.stderr().length;
      expect(await startUpload(server.port, hostname, 1_500_000)).toMatch(/^HTTP\/1\.1 503 [^]*\r\nretry-after: 1\r\n/i);
      expect(await startUpload(server.port, hostname, 1_000_000)).toMatch(/^HTTP\/1\.1 503 /);
      expect(await startUpload(server.port, hostname, 'chunked')).toMatch(/^HTTP\/1\.1 503 /);
      expect(await startUpload(server.port, hostname, 9_000_000)).toMatch(/^HTTP\/1\.1 503 /);
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

  // A 2025-era batch can hold a notifications/cancelled for one of its own requests, before or
  // after it. The MCP SDK sends no answer for a cancelled request, and its transport ends a batch's
  // answer only once every request in the batch has one, so that answer never ended: it wrote a
  // keep-alive line every 15 s, which the stall check never saw waiting, and held its slot, and
  // those of the requests behind it, for as long as the client kept the connection. Each request
  // over HTTP gets a server of its own, so such a cancel can only name a request in the same body,
  // which every handler answers at once; the server ignores it, as the protocol allows.
  it('answers batches that cancel their own request, so 128 of them on one connection hold no slot', async ({ expect }) => {
    const server = await startHttp();
    const host = { host: `127.0.0.1:${server.port}` };
    const sock = connect(server.port, '127.0.0.1');
    let text = '';
    sock.on('data', (d: Buffer) => (text += d.toString('latin1')));
    sock.on('error', () => {});
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const cancel = { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } };
    const answers = () => text.match(/^HTTP\/1\.1 \d+/gm) ?? [];
    const results = () => text.match(/^data: \{"result":/gm)?.length ?? 0;
    try {
      await new Promise((resolve) => sock.once('connect', resolve));
      sock.write(post(server.port, JSON.stringify([request, cancel])).repeat(64) + post(server.port, JSON.stringify([cancel, request])).repeat(64));
      await waitFor(
        () => results() === 128,
        () => `${answers().length} answer(s), ${results()} result(s), ${text.match(/^: keepalive/gm)?.length ?? 0} keep-alive line(s)`,
        10_000,
      );
      expect(new Set(answers())).toEqual(new Set(['HTTP/1.1 200']));
      expect((await send(server.port, host)).status).toBe(200);
      expect(server.stderr().split('\n').slice(1).join('')).toBe('');
    } finally {
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
      // Then the five send their bodies at once. The server closes each connection after its
      // answer, and a crash would close them too, so whether it is still up is checked after.
      for (const c of admitted) c.sock.write(body);
      await Promise.all(admitted.map((c) => c.closed));
      await sleep(200);
      expect(server.proc.exitCode ?? server.proc.signalCode, server.stderr()).toBeNull();
      for (const c of admitted) expect(c.text.slice(0, 60)).toMatch(/^HTTP\/1\.1 100 Continue\r\n\r\nHTTP\/1\.1 200 /);
      expect((await send(server.port, host)).status).toBe(200);
    } finally {
      for (const { sock } of clients) sock.destroy();
      server.proc.kill('SIGTERM');
    }
  });

  // Answers smaller than the socket's 64 KiB high-water mark: once the operating system's buffers
  // are full, the one being written waits in the socket's buffer below the mark, where Node never
  // sets writableNeedDrain. How many answers those buffers take differs between systems (about 11
  // of these on macOS), and each one they take gives its slot back, so stalled uploads take the
  // slots the connection doesn't hold; those refused show that every slot was taken. The client
  // writes an empty line every second, so it sees the close as a reset.
  it('closes a connection whose answers the client stops reading, however small they are, which frees their slots', { timeout: 90_000 }, async ({ expect }) => {
    const server = await startHttp();
    const host = { host: `127.0.0.1:${server.port}` };
    const held: Held[] = [];
    const admitted = () => held.filter((h) => /^HTTP\/1\.1 100 Continue\r\n\r\n$/.test(h.text)).length;
    // Each answer is a batch of as many image-video checklists as fit in 56,000 bytes, so that the
    // requests that fit in one read ask for more than the operating system's buffers hold.
    const one = Buffer.byteLength((await send(server.port, host, { body: JSON.stringify(CHECKLIST_CALL) })).body);
    const body = JSON.stringify(Array.from({ length: Math.max(1, Math.floor(56_000 / one)) }, (_, i) => ({ ...CHECKLIST_CALL, id: i + 1 })));
    expect(Buffer.byteLength((await send(server.port, host, { body })).body)).toBeLessThan(60_000);
    const sock = connect(server.port, '127.0.0.1');
    let closedAt: number | undefined;
    sock.on('error', () => {});
    sock.on('close', () => (closedAt = Date.now()));
    sock.pause(); // never reads
    const crlf = setInterval(() => sock.writable && sock.write('\r\n'), 1_000);
    try {
      await new Promise((resolve) => sock.once('connect', resolve));
      const started = Date.now();
      // As many requests as fit in one read of the socket, so the server has them all before it
      // stops reading: a request cut in two would be closed by the 10 s header timeout instead.
      const request = post(server.port, body);
      sock.write(request.repeat(Math.floor(60_000 / Buffer.byteLength(request))));
      await sleep(2_000);
      for (let i = 0; i < 128; i++) await holdUpload(server.port, held);
      await sleep(300);
      const left = 128 - admitted();
      expect(left, 'the operating system took every answer, so the connection holds no slot').toBeGreaterThan(0);
      // 15-20 s after the answer stopped moving. On macOS the operating system has been seen to take
      // one more of these answers 1-5 s in, which starts the 15 s again.
      await waitFor(() => closedAt !== undefined, () => `still open after ${(Date.now() - started) / 1000} s`, 30_000);
      const seconds = (closedAt! - started) / 1000;
      expect(seconds).toBeGreaterThanOrEqual(14);
      expect(seconds).toBeLessThan(30);
      // The slots it held are free: as many uploads are admitted, while the first ones, which
      // started 2 s in, still wait for the 30 s request timeout.
      await sleep(300);
      for (let i = 0; i < left; i++) await holdUpload(server.port, held);
      await sleep(300);
      expect(admitted()).toBe(128);
    } finally {
      clearInterval(crlf);
      sock.destroy();
      for (const { sock: upload } of held) upload.destroy();
      server.proc.kill('SIGTERM');
    }
  });

  // On Node 22 (and on 24 before 24.16, 25 and 26.0), a response that waits behind another never
  // gets 'close' when its connection closes (nodejs/node#62534), so the server closes those itself.
  // Without that, their slots stayed taken for good, and so did the memory of each answer over
  // 64 KiB, whose MCP SDK handler waited for good to write the rest. This server acts as Node 22
  // does on any version, and reports the answers it hasn't ended
  // (fixtures/leave-queued-responses-open.mjs).
  it('frees the slots of requests waiting behind an answer when the client drops the connection, and ends their answers, where Node leaves them open', async ({ expect }) => {
    const preload = pathToFileURL(join(PKG, 'test', 'fixtures', 'leave-queued-responses-open.mjs')).href;
    const server = await startHttp([], { ...ENV, NODE_OPTIONS: `--import=${preload}` });
    const held: Held[] = [];
    const admitted = () => held.filter((h) => /^HTTP\/1\.1 100 Continue\r\n\r\n$/.test(h.text)).length;
    const unended = () => Number([...server.stderr().matchAll(/^\[test\] unended answers: (\d+)$/gm)].at(-1)?.[1] ?? 0);
    const sock = connect(server.port, '127.0.0.1');
    sock.on('error', () => {});
    sock.pause(); // never reads
    try {
      await new Promise((resolve) => sock.once('connect', resolve));
      // Batches of ten image-video checklists, whose answers (230 KB each) add up to more than the
      // operating system's buffers hold, as many as fit in one read of the socket.
      const request = post(server.port, JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ ...CHECKLIST_CALL, id: i + 1 }))));
      sock.write(request.repeat(Math.floor(60_000 / Buffer.byteLength(request))));
      await sleep(2_000);
      for (let i = 0; i < 128; i++) await holdUpload(server.port, held);
      await sleep(300);
      const left = 128 - admitted();
      expect(left, 'the operating system took every answer, so the connection holds no slot').toBeGreaterThan(0);
      expect(unended(), 'no answer waits behind the one being written').toBeGreaterThan(1);
      sock.destroy();
      await waitFor(() => unended() === 0, () => `${unended()} answers not ended`, 5_000);
      for (let i = 0; i < left; i++) await holdUpload(server.port, held);
      await sleep(300);
      expect(admitted()).toBe(128);
    } finally {
      sock.destroy();
      for (const { sock: upload } of held) upload.destroy();
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
