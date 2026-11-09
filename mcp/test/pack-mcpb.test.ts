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
  it('passes this server, and says it called two tools', async () => {
    expect(await check(() => createServer())).toMatch(/and answers get_checklist and check_prompt$/);
  });

  it('fails a server whose tools only list', async () => {
    const throws: Handler = () => {
      throw new Error('bundle-only fault');
    };
    await expect(check(() => standIn({ get_checklist: throws }))).rejects.toThrow(/get_checklist \{domain: "coding"\} returned .*bundle-only fault/);
    // check_prompt answers, but without the structured report it promises.
    await expect(check(() => standIn())).rejects.toThrow(/check_prompt returned/);
    await expect(check(() => standIn({ check_prompt: throws }))).rejects.toThrow(/check_prompt returned .*bundle-only fault/);
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
