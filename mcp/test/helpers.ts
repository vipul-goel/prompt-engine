// Shared helpers: in-process clients for both protocol eras.

import { Client, StreamableHTTPClientTransport, type ClientCapabilities, type ElicitResult } from '@modelcontextprotocol/client';
import { createMcpHandler, InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';

export type Era = 'legacy' | 'modern';
export const ERAS: Era[] = ['legacy', 'modern'];

export const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = join(PKG, '..');

export interface ElicitCall {
  message: string;
  requestedSchema: { type: 'object'; properties: Record<string, Record<string, unknown>>; required?: string[] };
}

export interface ConnectOptions {
  /** Answers form elicitations; when set, the client declares elicitation.form. */
  elicit?: (params: ElicitCall) => ElicitResult | Promise<ElicitResult>;
}

export interface Connected {
  client: Client;
  elicitCalls: ElicitCall[];
  close: () => Promise<void>;
}

function makeClient(era: Era, options: ConnectOptions) {
  const capabilities: ClientCapabilities = options.elicit ? { elicitation: { form: {} } } : {};
  const client = new Client(
    { name: 'prompt-engine-tests', version: '0.0.0' },
    { capabilities, ...(era === 'modern' ? { versionNegotiation: { mode: 'auto' as const } } : {}) },
  );
  const elicitCalls: ElicitCall[] = [];
  const { elicit } = options;
  if (elicit) {
    client.setRequestHandler('elicitation/create', async (request) => {
      const params = request.params as unknown as ElicitCall;
      elicitCalls.push(params);
      return elicit(params);
    });
  }
  return { client, elicitCalls };
}

/** A client talking to createMcpHandler in-process (stateless HTTP serving, as a deployment would). */
export async function connectHttp(era: Era, options: ConnectOptions = {}): Promise<Connected> {
  const handler = createMcpHandler(() => createServer());
  const { client, elicitCalls } = makeClient(era, options);
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  if (client.getProtocolEra() !== era) throw new Error(`expected the ${era} era, got ${client.getProtocolEra()}`);
  return {
    client,
    elicitCalls,
    close: async () => {
      await client.close();
      await handler.close();
    },
  };
}

/** A client talking to serveStdio over an in-memory pipe (a stateful connection, like stdio). */
export async function connectStdioInProcess(era: Era, options: ConnectOptions = {}): Promise<Connected> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(() => createServer(), { transport: serverSide });
  const { client, elicitCalls } = makeClient(era, options);
  await client.connect(clientSide);
  if (client.getProtocolEra() !== era) throw new Error(`expected the ${era} era, got ${client.getProtocolEra()}`);
  return {
    client,
    elicitCalls,
    close: async () => {
      await client.close();
      await handle.close();
    },
  };
}

const ajv = new AjvJsonSchemaValidator();

/** Validates data against a JSON Schema with the SDK's Ajv provider; returns the error message or undefined. */
export function schemaErrors(schema: object, data: unknown): string | undefined {
  const result = ajv.getValidator(schema as Parameters<typeof ajv.getValidator>[0])(data);
  return result.valid ? undefined : result.errorMessage;
}

export function textOf(result: { content?: unknown }): string {
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
}

export const SAMPLE_QUESTIONS = [
  {
    id: 'audience',
    header: 'Audience',
    question: 'Who will read it?',
    options: [{ label: 'Employees' }, { label: 'Team managers', description: 'They set policy' }, { label: 'Job seekers' }],
    recommended: 1,
    why: 'they decide remote-work policy',
  },
  {
    id: 'length',
    header: 'Length',
    question: 'How long should it be?',
    options: [{ label: 'About 600 words' }, { label: 'About 1,200 words' }, { label: '2,000+ words' }],
    recommended: 1,
    why: 'room for examples',
  },
];
