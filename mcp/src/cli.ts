#!/usr/bin/env node
// prompt-engine-mcp: serves Prompt Engine over stdio (default) or Streamable HTTP.
// stdout is the protocol channel in stdio mode, so everything else goes to stderr.
// Nothing here logs request bodies or prompt text.

import { createServer as createHttpServer } from 'node:http';
import { parseArgs } from 'node:util';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { VERSION } from './generated/content.js';
import { createServer } from './server.js';

const NAME = 'prompt-engine-mcp';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const MCP_PATH = '/mcp';

const USAGE = `${NAME} ${VERSION}: Prompt Engine as an MCP server (no API key, no network calls).

Usage:
  ${NAME}                     serve over stdio (what MCP clients launch)
  ${NAME} --http [options]    serve Streamable HTTP at http://<host>:<port>${MCP_PATH}

Options:
  --http                   serve HTTP instead of stdio
  --host <address>         address to bind (default ${DEFAULT_HOST})
  --port <number>          port to listen on (default ${DEFAULT_PORT}; 0 picks a free port)
  --allowed-hosts <a,b>    Host header names to accept, comma-separated (default:
                           localhost, 127.0.0.1, [::1]; env PROMPT_ENGINE_ALLOWED_HOSTS)
  -v, --version            print the version
  -h, --help               print this help

Browser requests must come from an allowed host too; requests without an Origin header are accepted.`;

const log = (message: string) => process.stderr.write(`[${NAME}] ${message}\n`);

/** Error messages can quote request bodies (JSON parse errors do), so drop quoted text and cap the length. */
function describeError(error: unknown): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const message = e.message.replace(/(["'`])(?:(?!\1)[\s\S])*\1/g, '$1…$1').replace(/\s+/g, ' ').slice(0, 200);
  return `${e.name}: ${message}`;
}

/** Hostnames for the Host/Origin allowlists: lower-cased, IPv6 in brackets. */
function parseAllowedHosts(value: string | undefined): string[] {
  if (!value?.trim()) return localhostAllowedHostnames();
  return [
    ...new Set(
      value
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
        .map((h) => (h.includes(':') && !h.startsWith('[') ? `[${h}]` : h)),
    ),
  ];
}

function fail(message: string): never {
  process.stderr.write(`${NAME}: ${message}\n\n${USAGE}\n`);
  process.exit(2);
}

function parseCli(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      options: {
        http: { type: 'boolean', default: false },
        host: { type: 'string' },
        port: { type: 'string' },
        'allowed-hosts': { type: 'string' },
        version: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
      strict: true,
    }).values;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function serveOverStdio(): void {
  const handle = serveStdio(() => createServer(), { onerror: (error) => log(describeError(error)) });
  const stop = () => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function serveOverHttp(host: string, port: number, allowedHosts: string[]): void {
  const onerror = (error: Error) => log(describeError(error));
  const mcp = createMcpHandler(() => createServer(), { onerror });
  // createMcpHandler validates neither Host nor Origin, so guard it here
  // (DNS rebinding protection). A request without an Origin header passes.
  const guarded = {
    fetch: async (request: Request) =>
      hostHeaderValidationResponse(request, allowedHosts) ?? originValidationResponse(request, allowedHosts) ?? mcp.fetch(request),
  };
  const nodeHandler = toNodeHandler(guarded, { onerror });

  const httpServer = createHttpServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path !== MCP_PATH) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Not found. The MCP endpoint is ${MCP_PATH}.` }));
      return;
    }
    void nodeHandler(req, res);
  });
  httpServer.on('error', (error) => {
    log(`cannot listen on ${host}:${port}: ${describeError(error)}`);
    process.exit(1);
  });
  httpServer.listen(port, host, () => {
    const address = httpServer.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const shownHost = host.includes(':') ? `[${host}]` : host;
    log(`${VERSION} listening on http://${shownHost}:${actualPort}${MCP_PATH} (allowed hosts: ${allowedHosts.join(', ')})`);
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
    const onlyLocalNames = allowedHosts.every((h) => localhostAllowedHostnames().includes(h));
    if (!loopback && onlyLocalNames) log('note: only localhost Host headers are accepted; pass --allowed-hosts with the name clients use to reach this server');
  });

  const stop = () => {
    httpServer.close();
    void mcp.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function main(): void {
  const args = parseCli(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!args.http) {
    if (args.host !== undefined || args.port !== undefined || args['allowed-hosts'] !== undefined) {
      fail('--host, --port and --allowed-hosts only apply with --http');
    }
    serveOverStdio();
    return;
  }
  // Accept IPv6 written either way (::1 or [::1]); listen() wants it bare.
  const host = args.host?.trim().replace(/^\[(.*)\]$/, '$1') || DEFAULT_HOST;
  const port = args.port === undefined ? DEFAULT_PORT : Number(args.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`--port must be an integer from 0 to 65535 (got ${args.port})`);
  const allowedHosts = parseAllowedHosts(args['allowed-hosts'] ?? process.env.PROMPT_ENGINE_ALLOWED_HOSTS);
  serveOverHttp(host, port, allowedHosts);
}

main();
