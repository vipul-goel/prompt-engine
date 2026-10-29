// End-to-end tests against the built CLI (dist/cli.js): stdio in both eras and
// real Streamable HTTP with Host/Origin checks. `npm test` builds first.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../src/generated/content.js';
import { PKG, SAMPLE_QUESTIONS, textOf } from './helpers.js';

const CLI = join(PKG, 'dist', 'cli.js');
if (!existsSync(CLI)) throw new Error('dist/cli.js is missing; run npm run build (npm test does it for you)');

const TOOLS = ['ask_user', 'check_prompt', 'enhance_prompt', 'get_checklist'];

function stdioClient(era: 'legacy' | 'modern', elicit?: () => { action: 'accept'; content: Record<string, string> }) {
  const client = new Client(
    { name: 'prompt-engine-e2e', version: '0.0.0' },
    { capabilities: elicit ? { elicitation: { form: {} } } : {}, ...(era === 'modern' ? { versionNegotiation: { mode: 'auto' as const } } : {}) },
  );
  if (elicit) client.setRequestHandler('elicitation/create', async () => elicit());
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI], stderr: 'pipe' });
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
    const bad = spawnSync(process.execPath, [CLI, '--nope'], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/Unknown option/);
    expect(bad.stdout).toBe('');
  });
});

describe('stdio', () => {
  it('legacy era: lists tools, returns the brief, and asks in text mode without elicitation', async () => {
    const { client, transport } = stdioClient('legacy');
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
});

describe('Streamable HTTP (--http)', () => {
  let proc: ChildProcess;
  let base: URL;

  beforeAll(async () => {
    proc = spawn(process.execPath, [CLI, '--http', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    base = await new Promise<URL>((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${stderr}`)), 20_000);
      proc.stderr!.on('data', (d) => {
        stderr += d;
        const m = stderr.match(/listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)/);
        if (m) {
          clearTimeout(timer);
          resolve(new URL(m[1]!));
        }
      });
      proc.on('exit', (code) => reject(new Error(`server exited with ${code}:\n${stderr}`)));
    });
  });

  afterAll(() => {
    proc?.kill('SIGTERM');
  });

  function raw(path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: base.hostname,
          port: base.port,
          path,
          method: 'POST',
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
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  it('binds to 127.0.0.1 by default and serves tools/list to a real client', async () => {
    expect(base.hostname).toBe('127.0.0.1');
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
});

describe('--allowed-hosts', () => {
  it('replaces the localhost defaults', async () => {
    const proc = spawn(process.execPath, [CLI, '--http', '--port', '0', '--allowed-hosts', 'mcp.example.com'], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const port = await new Promise<string>((resolve, reject) => {
        let stderr = '';
        const timer = setTimeout(() => reject(new Error(stderr)), 20_000);
        proc.stderr!.on('data', (d) => {
          stderr += d;
          const m = stderr.match(/listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp \(allowed hosts: mcp\.example\.com\)/);
          if (m) {
            clearTimeout(timer);
            resolve(m[1]!);
          }
        });
      });
      const status = (host: string) =>
        new Promise<number>((resolve, reject) => {
          const req = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { host, 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          });
          req.on('error', reject);
          req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
        });
      expect(await status('mcp.example.com')).toBe(200);
      expect(await status(`localhost:${port}`)).toBe(403);
    } finally {
      proc.kill('SIGTERM');
    }
  });
});
