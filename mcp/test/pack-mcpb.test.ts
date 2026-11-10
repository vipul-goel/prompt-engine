// scripts/check-server.mjs: the check pack-mcpb.mjs runs on the server of the packed .mcpb
// bundle, the only gate that runs the bundle's own code. Here it runs against servers in this
// process: this one, and stand-ins whose parts fail as a bundling fault could make them fail.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { completable, InMemoryTransport, McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
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
/** The brief for a mode other than the one asked for. */
const OTHER_BRIEF = BRIEF.replace('mode: quick', 'mode: standard');
const fault = (): never => {
  throw new Error('bundle-only fault');
};

/** What a stand-in's prompt, completions and resources answer with. A read answers with its text, or with a URI and text. */
interface Parts {
  prompt: () => PromptAnswer;
  /** Completes the enhance prompt's mode argument. */
  modes: (value: string) => string[];
  method: () => string | { uri: string; text: string };
  questions: () => string;
  checklist: () => string;
  /** The domains the checklist template lists. */
  checklists: () => string[];
  /** Completes the checklist template's domain argument. */
  domains: (value: string) => string[];
}

/** Parts that answer as this server's do, so the check gets past them. */
const answeringParts: Parts = {
  prompt: () => ({ messages: [{ role: 'user', content: { type: 'text', text: `${BRIEF}\nImprove the rough prompt.` } }] }),
  modes: (value) => ['quick', 'standard', 'deep'].filter((m) => m.startsWith(value)),
  method: () => BRIEF,
  questions: () => '# Asking clarifying questions\n\nGood questions are the main tool.',
  checklist: () => '# Coding checklist',
  checklists: () => ['coding', 'writing'],
  domains: (value) => ['coding', 'writing'].filter((d) => d.startsWith(value)),
};

/**
 * A server with the manifest's tools, an enhance prompt, prompt-engine://method,
 * prompt-engine://questions and the checklist template. Each tool answers with its handler, or
 * with plain text; the other parts answer with `parts`, by default as this server's do.
 */
function standIn(handlers: Record<string, Handler> = {}, parts: Partial<Parts> = {}): McpServer {
  const { prompt, modes, method, questions, checklist, checklists, domains } = { ...answeringParts, ...parts };
  const server = new McpServer({ name: 'stand-in', version: '0.0.0' });
  for (const { name } of manifest.tools as Array<{ name: string }>) {
    server.registerTool(name, { description: name, inputSchema: z.object({}).passthrough() }, async () =>
      (handlers[name] ?? (() => ({ content: [{ type: 'text' as const, text: `${name}: coding` }] })))(),
    );
  }
  server.registerPrompt('enhance', { description: 'enhance', argsSchema: z.object({ mode: completable(z.string(), (value) => modes(value ?? '')).optional() }) }, prompt);
  const read = (answer: () => string | { uri: string; text: string }) => (uri: URL) => {
    const got = answer();
    return { contents: [{ mimeType: 'text/markdown', ...(typeof got === 'string' ? { uri: uri.href, text: got } : got) }] };
  };
  server.registerResource('method', 'prompt-engine://method', { description: 'method' }, read(method));
  server.registerResource('questions', 'prompt-engine://questions', { title: 'Asking clarifying questions', description: 'questions' }, read(questions));
  server.registerResource(
    'checklists',
    new ResourceTemplate('prompt-engine://checklists/{domain}', {
      list: () => ({ resources: checklists().map((domain) => ({ uri: `prompt-engine://checklists/${domain}`, name: domain })) }),
      complete: { domain: (value) => domains(value) },
    }),
    { description: 'checklists' },
    read(checklist),
  );
  return server;
}

/** Tool handlers that answer as this server's do, so the check gets past the tools. */
const answering: Record<string, Handler> = {
  check_prompt: () => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { dimensions: [], issues: [] } }),
  enhance_prompt: () => ({ content: [{ type: 'text', text: BRIEF }] }),
  ask_user: () => ({ content: [{ type: 'text', text: 'Who is the prompt for?' }], structuredContent: { status: 'ask_in_chat', questionsText: 'Who is the prompt for?' } }),
};

describe("pack-mcpb.mjs's check of the packed server", () => {
  it('passes this server, and says it called every tool, fetched the prompt, asked for completions, listed the resources and read three', async () => {
    expect(await check(() => createServer())).toMatch(
      /and answers get_checklist, check_prompt, enhance_prompt and ask_user, the enhance prompt, completions of its mode and of a checklist's domain, resources\/list, and reads of prompt-engine:\/\/method, prompt-engine:\/\/questions and prompt-engine:\/\/checklists\/coding$/,
    );
    // So does a stand-in that answers each of these as this server does.
    await expect(check(() => standIn(answering))).resolves.toMatch(/the enhance prompt/);
  });

  // The bundle's prompt handler, the completions (the prompt's needs its completable() wrapper),
  // the resource template's list and its matching, and the resource reads run in no other gate.
  it('fails a server whose enhance prompt, completions or resources fail', async () => {
    // The prompt answers without the brief, with the brief for another mode, or throws.
    await expect(check(() => standIn(answering, { prompt: () => ({ messages: [] }) }))).rejects.toThrow(/enhance prompt \{mode: "quick"\} returned/);
    const otherMode = (): PromptAnswer => ({ messages: [{ role: 'user', content: { type: 'text', text: `${OTHER_BRIEF}\nImprove the rough prompt.` } }] });
    await expect(check(() => standIn(answering, { prompt: otherMode }))).rejects.toThrow(/enhance prompt \{mode: "quick"\} returned/);
    await expect(check(() => standIn(answering, { prompt: fault }))).rejects.toThrow(/enhance prompt \{mode: "quick"\} failed: .*bundle-only fault/);
    // The prompt's mode doesn't complete, or its completion throws.
    await expect(check(() => standIn(answering, { modes: () => [] }))).rejects.toThrow(/completion\/complete of the enhance prompt's mode "q" returned/);
    await expect(check(() => standIn(answering, { modes: fault }))).rejects.toThrow(/completion\/complete of the enhance prompt's mode "q" failed: .*bundle-only fault/);
    // The template lists no coding checklist, or its list throws.
    await expect(check(() => standIn(answering, { checklists: () => [] }))).rejects.toThrow(/resources\/list doesn't list prompt-engine:\/\/checklists\/coding/);
    await expect(check(() => standIn(answering, { checklists: fault }))).rejects.toThrow(/resources\/list failed: .*bundle-only fault/);
    // A checklist's domain doesn't complete, or its completion throws.
    await expect(check(() => standIn(answering, { domains: () => [] }))).rejects.toThrow(/completion\/complete of the checklist template's domain "c" returned/);
    await expect(check(() => standIn(answering, { domains: fault }))).rejects.toThrow(/completion\/complete of the checklist template's domain "c" failed: .*bundle-only fault/);
    // Reads that throw, and answers that aren't the resource.
    await expect(check(() => standIn(answering, { method: fault }))).rejects.toThrow(/prompt-engine:\/\/method failed: .*bundle-only fault/);
    await expect(check(() => standIn(answering, { questions: fault }))).rejects.toThrow(/prompt-engine:\/\/questions failed: .*bundle-only fault/);
    await expect(check(() => standIn(answering, { checklist: fault }))).rejects.toThrow(/prompt-engine:\/\/checklists\/coding failed: .*bundle-only fault/);
    await expect(check(() => standIn(answering, { method: () => 'not the brief' }))).rejects.toThrow(/prompt-engine:\/\/method returned/);
    // The brief, but as another resource.
    await expect(check(() => standIn(answering, { method: () => ({ uri: 'prompt-engine://questions', text: BRIEF }) }))).rejects.toThrow(/prompt-engine:\/\/method returned/);
    // A reference whose heading isn't its listed title.
    await expect(check(() => standIn(answering, { questions: () => '# Output format\n\nThe reply.' }))).rejects.toThrow(/prompt-engine:\/\/questions returned/);
    await expect(check(() => standIn(answering, { checklist: () => '# Writing' }))).rejects.toThrow(/prompt-engine:\/\/checklists\/coding returned/);
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
    const otherMode = (): ReturnType<Handler> => ({ content: [{ type: 'text', text: OTHER_BRIEF }] });
    await expect(check(() => standIn({ check_prompt: report!, enhance_prompt: otherMode }))).rejects.toThrow(/enhance_prompt \{mode: "quick"\} returned/);
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
