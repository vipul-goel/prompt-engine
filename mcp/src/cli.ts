#!/usr/bin/env node
// prompt-engine-mcp: serves Prompt Engine over stdio (default) or Streamable HTTP.
// stdout is the protocol channel in stdio mode, so everything else goes to stderr:
// the start-up line, warnings, and one line per error, which never quotes a
// request (see log.ts).

import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { parseArgs } from 'node:util';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  originValidationResponse,
  validateHostHeader,
  validateOriginHeader,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { PROMPT_MAX_CHARS } from './check.js';
import { VERSION } from './generated/content.js';
import { canonicalHostname, parseAllowedHosts, portsIgnoredWarning, unusableWarning } from './hosts.js';
import { describeError } from './log.js';
import { createServer } from './server.js';

const NAME = 'prompt-engine-mcp';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const MCP_PATH = '/mcp';
// The largest valid request is a check_prompt draft of PROMPT_MAX_CHARS code
// points, and JSON can spell each one as a 12-byte escaped surrogate pair:
// 1.2 MB for 100,000. Bodies are capped at that plus 300 KB, 1.5 MB in all
// (the SDK's default is 4 MiB).
const MAX_BODY_BYTES = PROMPT_MAX_CHARS * 12 + 300_000;
// The SDK reads each request's body, up to MAX_BODY_BYTES, into memory before
// it answers, so at most this many requests are passed to it at once. Past
// that, a request gets 503 before its body is read. A connection that hasn't
// sent a request, or whose request was refused, takes no slot. Stalled uploads
// still hold their slots until the 30 s request timeout, so a client that
// keeps 128 of them open can shut out every other client.
const MAX_REQUESTS = 128;
// A backstop on open sockets: connections past it are closed at once.
// Connections that send nothing count until the header timeout closes them,
// 10 to 15 s later, so a client that keeps this many open shuts out every
// other client. A network deployment needs a proxy that limits connections
// per client.
const MAX_CONNECTIONS = 1024;
// The methods the SDK answers itself: POST, and 405 for GET, DELETE and
// OPTIONS. Any other gets 405 here, since the SDK's fetch Request throws for
// some of them, such as TRACE.
const SDK_METHODS = ['POST', 'GET', 'DELETE', 'OPTIONS'];

const USAGE = `${NAME} ${VERSION}: Prompt Engine as an MCP server (no API key, no network calls).

Usage:
  ${NAME}                     serve over stdio (what MCP clients launch)
  ${NAME} --http [options]    serve Streamable HTTP at http://<host>:<port>${MCP_PATH}

Options:
  --http                   serve HTTP instead of stdio
  --host <address>         address to bind (default ${DEFAULT_HOST})
  --port <number>          port to listen on (default ${DEFAULT_PORT}; 0 picks a free port)
  --allowed-hosts <a,b>    Host header names to accept, comma-separated, without ports
                           (default: localhost, 127.0.0.1, [::1]; env PROMPT_ENGINE_ALLOWED_HOSTS)
  -v, --version            print the version
  -h, --help               print this help

A request with an Origin header must come from an allowed host. Browser clients
aren't supported: there is no CORS, so a browser's preflight request fails (403
from an origin that isn't allowed, 405 otherwise).`;

const log = (message: string) => process.stderr.write(`[${NAME}] ${message}\n`);

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
  // The SDK adds an error listener to stdout for each message it writes, and a
  // drain listener while the pipe is full, removing both once the write is
  // done. More than 10 at a time is normal for a slow reader, not a leak, so
  // don't let Node warn about it on stderr.
  process.stdout.setMaxListeners(0);
  const handle = serveStdio(() => createServer(), { onerror: (error) => log(describeError(error)) });
  const stop = () => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

/** Whether fetch can build a request URL from this Host header: it parses, and has no user:password@. */
function usableHost(host: string): boolean {
  try {
    const url = new URL(`http://${host}`);
    return !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Why a request to /mcp is refused before the SDK sees it, or undefined to
 * serve it. The SDK reads the whole body before its own checks, and builds a
 * fetch Request from the Host header and the method, which throws (with an
 * error that quotes the URL) for a Host the URL parser rejects or that has
 * user:password@, and for some methods, such as TRACE.
 */
function refusal(req: IncomingMessage, allowedHosts: string[]): { status: number; message: string } | undefined {
  const { host, origin } = req.headers;
  if (host !== undefined && !usableHost(host)) return { status: 403, message: 'Invalid Host header' };
  const hostCheck = validateHostHeader(host, allowedHosts);
  if (!hostCheck.ok) return { status: 403, message: hostCheck.message };
  const originCheck = validateOriginHeader(origin, allowedHosts);
  if (!originCheck.ok) return { status: 403, message: originCheck.message };
  if (!SDK_METHODS.includes(req.method ?? '')) return { status: 405, message: 'Method not allowed.' };
  return undefined;
}

function serveOverHttp(host: string, port: number, allowedHosts: string[]): void {
  const onerror = (error: Error) => log(describeError(error));
  const mcp = createMcpHandler(() => createServer(), { onerror, maxRequestBodySize: MAX_BODY_BYTES });
  // createMcpHandler validates neither Host nor Origin. The request listener
  // checks both (DNS rebinding protection), and so does this, in case a
  // request ever reaches the handler another way. A request without an Origin
  // header passes.
  const guarded = {
    fetch: async (request: Request) =>
      hostHeaderValidationResponse(request, allowedHosts) ?? originValidationResponse(request, allowedHosts) ?? mcp.fetch(request),
  };
  const nodeHandler = toNodeHandler(guarded, { onerror, maxRequestBodySize: MAX_BODY_BYTES });
  let inFlight = 0;

  // Slow or stalled uploads are cut off: the headers must arrive within 10 s
  // and the whole request within 30 s (Node's defaults are 60 s and 300 s),
  // checked every 5 s (Node's default is every 30 s).
  const timeouts = { headersTimeout: 10_000, requestTimeout: 30_000, connectionsCheckingInterval: 5_000 };
  const httpServer = createHttpServer(timeouts, (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path !== MCP_PATH) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Not found. The MCP endpoint is ${MCP_PATH}.` }));
      return;
    }
    // Answered in the SDK guard's format, without a log line, and the
    // connection is closed rather than the rest of the body read.
    const refused = refusal(req, allowedHosts) ?? (inFlight >= MAX_REQUESTS ? { status: 503, message: 'Server busy. Try again shortly.' } : undefined);
    if (refused) {
      const extra = refused.status === 405 ? { allow: 'POST' } : refused.status === 503 ? { 'retry-after': '1' } : {};
      res.writeHead(refused.status, { 'content-type': 'application/json', connection: 'close', ...extra });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: refused.message }, id: null }));
      return;
    }
    // 'close' follows both a finished response and a dropped connection.
    inFlight++;
    res.once('close', () => inFlight--);
    void nodeHandler(req, res);
  });
  httpServer.maxConnections = MAX_CONNECTIONS;
  httpServer.on('error', (error) => {
    log(`cannot listen on ${host}:${port}: ${describeError(error)}`);
    process.exit(1);
  });
  httpServer.listen(port, host, () => {
    const address = httpServer.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const shownHost = host.includes(':') ? `[${host}]` : host;
    log(`${VERSION} listening on http://${shownHost}:${actualPort}${MCP_PATH} (allowed hosts: ${allowedHosts.join(', ')})`);
    // Compared in canonical form, so LOCALHOST and 0:0:0:0:0:0:0:1 count too.
    const loopback = localhostAllowedHostnames().includes(canonicalHostname(host) ?? host);
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
  const fromFlag = args['allowed-hosts'] !== undefined;
  const setting = fromFlag ? '--allowed-hosts' : 'PROMPT_ENGINE_ALLOWED_HOSTS';
  const { hosts, portsIgnored, unusable } = parseAllowedHosts(fromFlag ? args['allowed-hosts'] : process.env.PROMPT_ENGINE_ALLOWED_HOSTS);
  if (portsIgnored.length) log(portsIgnoredWarning(setting, portsIgnored));
  if (unusable.length) log(unusableWarning(setting, unusable));
  serveOverHttp(host, port, hosts.length ? hosts : localhostAllowedHostnames());
}

main();
