// Cloudflare Workers entry: the same server, served statelessly over Streamable
// HTTP at /mcp. Deploy with `npx wrangler deploy` from mcp/ (see README.md), and
// set ALLOWED_HOSTS to the hostnames clients use, such as your workers.dev name.

import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
  preloadSchemas,
} from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { PROMPT_MAX_CHARS } from './check.js';
import { parseAllowedHosts, portsIgnoredWarning, unusableWarning } from './hosts.js';
import { createServer } from './server.js';

export interface Env {
  /**
   * Comma-separated Host header names to accept, without ports, for example "prompt-engine.example.workers.dev".
   * Wrangler's vars can also hold JSON values, so it can arrive as a list or another value.
   */
  ALLOWED_HOSTS?: unknown;
}

const MCP_PATH = '/mcp';
// The same body cap as the CLI (see cli.ts): the largest valid request, a
// check_prompt draft with every character escaped, plus 300 KB; 1.5 MB in all.
const MAX_BODY_BYTES = PROMPT_MAX_CHARS * 12 + 300_000;

// Build the wire schemas during isolate start-up rather than in the first request.
preloadSchemas();

const jsonSchemaValidator = new CfWorkerJsonSchemaValidator();
const mcp = createMcpHandler(() => createServer({ jsonSchemaValidator }), { maxRequestBodySize: MAX_BODY_BYTES });

// ALLOWED_HOSTS doesn't change within an isolate, so parse it (and warn about its entries) once.
let parsed: { value: string | undefined; hosts: string[] } | undefined;
function allowedHosts(value: string | undefined): string[] {
  if (!parsed || parsed.value !== value) {
    const { hosts, portsIgnored, unusable } = parseAllowedHosts(value);
    if (portsIgnored.length) console.warn(`prompt-engine-mcp: ${portsIgnoredWarning('ALLOWED_HOSTS', portsIgnored)}`);
    if (unusable.length) console.warn(`prompt-engine-mcp: ${unusableWarning('ALLOWED_HOSTS', unusable)}`);
    parsed = { value, hosts };
  }
  return parsed.hosts;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** What kind of JSON value a setting that isn't a string is. */
const jsonKind = (value: unknown) => (Array.isArray(value) ? 'list' : typeof value === 'object' ? 'object' : typeof value);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== MCP_PATH) return json(404, { error: `Not found. The MCP endpoint is ${MCP_PATH}.` });
    const setting = env.ALLOWED_HOSTS;
    if (setting !== undefined && setting !== null && typeof setting !== 'string') {
      const error = `ALLOWED_HOSTS is a JSON ${jsonKind(setting)}, not a string. Set it to the hostnames clients use as one comma-separated string, such as "mcp.example.com,localhost".`;
      return json(500, { error });
    }
    const value = typeof setting === 'string' ? setting : undefined;
    const hosts = allowedHosts(value);
    if (!hosts.length) {
      const problem = value?.trim() ? 'names no usable hostname' : 'is not set';
      return json(500, { error: `ALLOWED_HOSTS ${problem}. Set it to the hostnames clients use, such as your workers.dev name.` });
    }
    // createMcpHandler validates neither Host nor Origin; a request without an Origin header passes.
    return hostHeaderValidationResponse(request, hosts) ?? originValidationResponse(request, hosts) ?? mcp.fetch(request);
  },
};
