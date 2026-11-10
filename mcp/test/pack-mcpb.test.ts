// scripts/check-server.mjs: the check pack-mcpb.mjs runs on the server of the packed .mcpb
// bundle, the only gate that runs the bundle's own code. Here it runs against servers in this
// process: this one, and stand-ins whose tools fail as a bundling fault could make them fail.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
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
type PromptAnswer = { messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> };

const BRIEF = 'Prompt Engine brief from the prompt-engine MCP server (v0.0.0).\nRequested mode: quick';
const fault = (): never => {
  throw new Error('bundle-only fault');
};

/**
 * A server with the manifest's tools and an enhance prompt; each tool answers with its handler, or
 * with plain text, and the prompt with `prompt`. `resources` adds prompt-engine://method and the
 * checklist template, whose reads answer with these texts.
 */
function standIn(
  handlers: Record<string, Handler> = {},
  { prompt = () => ({ messages: [] }), resources }: { prompt?: () => PromptAnswer; resources?: { method: () => string; checklist: () => string } } = {},
): McpServer {
  const server = new McpServer({ name: 'stand-in', version: '0.0.0' });
  for (const { name } of manifest.tools as Array<{ name: string }>) {
    server.registerTool(name, { description: name, inputSchema: z.object({}).passthrough() }, async () =>
      (handlers[name] ?? (() => ({ content: [{ type: 'text' as const, text: `${name}: coding` }] })))(),
    );
  }
  server.registerPrompt('enhance', { description: 'enhance', argsSchema: z.object({ mode: z.string().optional() }) }, prompt);
  if (resources) {
    const read = (text: () => string) => (uri: URL) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: text() }] });
    server.registerResource('method', 'prompt-engine://method', { description: 'method' }, read(resources.method));
    server.registerResource('checklists', new ResourceTemplate('prompt-engine://checklists/{domain}', { list: undefined }), { description: 'checklists' }, read(resources.checklist));
  }
  return server;
}

/** Tool handlers that answer as this server's do, so the check gets past the tools. */
const answering: Record<string, Handler> = {
  check_prompt: () => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { dimensions: [], issues: [] } }),
  enhance_prompt: () => ({ content: [{ type: 'text', text: BRIEF }] }),
  ask_user: () => ({ content: [{ type: 'text', text: 'Who is the prompt for?' }], structuredContent: { status: 'ask_in_chat', questionsText: 'Who is the prompt for?' } }),
};
const promptAnswer = (): PromptAnswer => ({ messages: [{ role: 'user', content: { type: 'text', text: `${BRIEF}\nImprove the rough prompt.` } }] });
const resourcesAnswer = { method: () => BRIEF, checklist: () => '# Coding checklist' };

describe("pack-mcpb.mjs's check of the packed server", () => {
  it('passes this server, and says it called every tool, fetched the prompt and read two resources', async () => {
    expect(await check(() => createServer())).toMatch(
      /and answers get_checklist, check_prompt, enhance_prompt and ask_user, the enhance prompt, and reads of prompt-engine:\/\/method and prompt-engine:\/\/checklists\/coding$/,
    );
    // So does a stand-in that answers each of these as this server does.
    await expect(check(() => standIn(answering, { prompt: promptAnswer, resources: resourcesAnswer }))).resolves.toMatch(/the enhance prompt/);
  });

  // The bundle's prompt handler (with its completable argument), its resource template matching
  // and its resource reads run in no other gate.
  it('fails a server whose enhance prompt or resources fail', async () => {
    // The prompt answers without the brief, or throws.
    await expect(check(() => standIn(answering, { resources: resourcesAnswer }))).rejects.toThrow(/enhance prompt \{mode: "quick"\} returned/);
    await expect(check(() => standIn(answering, { prompt: fault, resources: resourcesAnswer }))).rejects.toThrow(/enhance prompt \{mode: "quick"\} failed: .*bundle-only fault/);
    // No resources, resources that throw, and a checklist that isn't one.
    await expect(check(() => standIn(answering, { prompt: promptAnswer }))).rejects.toThrow(/prompt-engine:\/\/method failed/);
    await expect(check(() => standIn(answering, { prompt: promptAnswer, resources: { ...resourcesAnswer, method: fault } }))).rejects.toThrow(
      /prompt-engine:\/\/method failed: .*bundle-only fault/,
    );
    await expect(check(() => standIn(answering, { prompt: promptAnswer, resources: { ...resourcesAnswer, checklist: fault } }))).rejects.toThrow(
      /prompt-engine:\/\/checklists\/coding failed: .*bundle-only fault/,
    );
    await expect(check(() => standIn(answering, { prompt: promptAnswer, resources: { ...resourcesAnswer, method: () => 'not the brief' } }))).rejects.toThrow(
      /prompt-engine:\/\/method returned/,
    );
    await expect(check(() => standIn(answering, { prompt: promptAnswer, resources: { ...resourcesAnswer, checklist: () => '# Writing' } }))).rejects.toThrow(
      /prompt-engine:\/\/checklists\/coding returned/,
    );
  });

  it('fails a server whose tools only list', async () => {
    await expect(check(() => standIn({ get_checklist: fault }))).rejects.toThrow(/get_checklist \{domain: "coding"\} returned .*bundle-only fault/);
    // check_prompt answers, but without the structured report it promises.
    await expect(check(() => standIn())).rejects.toThrow(/check_prompt returned/);
    await expect(check(() => standIn({ check_prompt: fault }))).rejects.toThrow(/check_prompt returned .*bundle-only fault/);
    // The tools before them answer as this server's do.
    const { check_prompt: report, enhance_prompt: brief } = answering;
    await expect(check(() => standIn({ check_prompt: report!, enhance_prompt: fault }))).rejects.toThrow(/enhance_prompt \{mode: "quick"\} returned .*bundle-only fault/);
    // enhance_prompt answers, but not with the brief for the mode it was given.
    await expect(check(() => standIn({ check_prompt: report! }))).rejects.toThrow(/enhance_prompt \{mode: "quick"\} returned/);
    await expect(check(() => standIn({ check_prompt: report!, enhance_prompt: brief!, ask_user: fault }))).rejects.toThrow(/ask_user returned .*bundle-only fault/);
    // ask_user answers, but not with the questions to ask in the chat, which a client without forms gets.
    await expect(check(() => standIn({ check_prompt: report!, enhance_prompt: brief! }))).rejects.toThrow(/ask_user returned/);
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
