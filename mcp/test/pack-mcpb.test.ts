// scripts/check-server.mjs: the check pack-mcpb.mjs runs on the server of the packed .mcpb
// bundle, the only gate that runs the bundle's own code. Here it runs against servers in this
// process: this one, and stand-ins whose tools fail as a bundling fault could make them fail.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer } from '../src/server.js';
import { PKG } from './helpers.js';

const manifest = JSON.parse(readFileSync(join(PKG, 'manifest.json'), 'utf8'));
// Plain JavaScript with no type declarations, so import it untyped.
const checkServer = async (client: Client): Promise<string> =>
  (await import(pathToFileURL(join(PKG, 'scripts', 'check-server.mjs')).href)).checkServer(client, manifest);

async function check(factory: () => McpServer): Promise<string> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(factory, { transport: serverSide });
  const client = new Client({ name: 'pack-mcpb-test', version: '0.0.0' });
  await client.connect(clientSide);
  try {
    return await checkServer(client);
  } finally {
    await client.close();
    await handle.close();
  }
}

type Handler = () => { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown> };

/** A server with the manifest's tools and an enhance prompt; each tool answers with its handler, or with plain text. */
function standIn(handlers: Record<string, Handler> = {}): McpServer {
  const server = new McpServer({ name: 'stand-in', version: '0.0.0' });
  for (const { name } of manifest.tools as Array<{ name: string }>) {
    server.registerTool(name, { description: name, inputSchema: z.object({}).passthrough() }, async () =>
      (handlers[name] ?? (() => ({ content: [{ type: 'text' as const, text: `${name}: coding` }] })))(),
    );
  }
  server.registerPrompt('enhance', { description: 'enhance' }, () => ({ messages: [] }));
  return server;
}

describe("pack-mcpb.mjs's check of the packed server", () => {
  it('passes this server, and says it called every tool', async () => {
    expect(await check(() => createServer())).toMatch(/and answers get_checklist, check_prompt, enhance_prompt and ask_user$/);
  });

  it('fails a server whose tools only list', async () => {
    const throws: Handler = () => {
      throw new Error('bundle-only fault');
    };
    await expect(check(() => standIn({ get_checklist: throws }))).rejects.toThrow(/get_checklist \{domain: "coding"\} returned .*bundle-only fault/);
    // check_prompt answers, but without the structured report it promises.
    await expect(check(() => standIn())).rejects.toThrow(/check_prompt returned/);
    await expect(check(() => standIn({ check_prompt: throws }))).rejects.toThrow(/check_prompt returned .*bundle-only fault/);
    // The tools before them answer as this server's do.
    const report: Handler = () => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { dimensions: [], issues: [] } });
    const brief: Handler = () => ({ content: [{ type: 'text', text: 'Prompt Engine brief from the prompt-engine MCP server (v0.0.0).\nRequested mode: quick' }] });
    await expect(check(() => standIn({ check_prompt: report, enhance_prompt: throws }))).rejects.toThrow(/enhance_prompt \{mode: "quick"\} returned .*bundle-only fault/);
    // enhance_prompt answers, but not with the brief for the mode it was given.
    await expect(check(() => standIn({ check_prompt: report }))).rejects.toThrow(/enhance_prompt \{mode: "quick"\} returned/);
    await expect(check(() => standIn({ check_prompt: report, enhance_prompt: brief, ask_user: throws }))).rejects.toThrow(/ask_user returned .*bundle-only fault/);
    // ask_user answers, but not with the questions to ask in the chat, which a client without forms gets.
    await expect(check(() => standIn({ check_prompt: report, enhance_prompt: brief }))).rejects.toThrow(/ask_user returned/);
  });

  it("fails a server whose tools aren't the manifest's", async () => {
    const extra = () => {
      const server = standIn();
      server.registerTool('extra_tool', { description: 'extra' }, async () => ({ content: [] }));
      return server;
    };
    await expect(check(extra)).rejects.toThrow(/lists tools .*extra_tool.*; manifest.json declares/);
  });
});
