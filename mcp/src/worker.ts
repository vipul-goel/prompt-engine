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
import { parseAllowedHosts, portsIgnoredWarning } from './hosts.js';
import { createServer } from './server.js';

export interface Env {
  /** Comma-separated Host header names to accept, without ports, for example "prompt-engine.example.workers.dev". */
  ALLOWED_HOSTS?: string;
}

const MCP_PATH = '/mcp';

// Build the wire schemas during isolate start-up rather than in the first request.
preloadSchemas();

const jsonSchemaValidator = new CfWorkerJsonSchemaValidator();
const mcp = createMcpHandler(() => createServer({ jsonSchemaValidator }));

// ALLOWED_HOSTS doesn't change within an isolate, so parse it (and warn about ports) once.
let parsed: { value: string | undefined; hosts: string[] } | undefined;
function allowedHosts(value: string | undefined): string[] {
  if (!parsed || parsed.value !== value) {
    const { hosts, portsIgnored } = parseAllowedHosts(value);
    if (portsIgnored.length) console.warn(`prompt-engine-mcp: ${portsIgnoredWarning('ALLOWED_HOSTS', portsIgnored)}`);
    parsed = { value, hosts };
  }
  return parsed.hosts;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== MCP_PATH) return json(404, { error: `Not found. The MCP endpoint is ${MCP_PATH}.` });
    const hosts = allowedHosts(env.ALLOWED_HOSTS);
    if (!hosts.length) return json(500, { error: 'ALLOWED_HOSTS is not set. Set it to the hostnames clients use, such as your workers.dev name.' });
    // createMcpHandler validates neither Host nor Origin; a request without an Origin header passes.
    return hostHeaderValidationResponse(request, hosts) ?? originValidationResponse(request, hosts) ?? mcp.fetch(request);
  },
};
