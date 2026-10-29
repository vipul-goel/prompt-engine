// The one stderr line the CLI writes per error. Requests are untrusted, so no
// text from a request reaches the log: rejected HTTP requests and unreadable
// messages are logged as a fixed phrase and the SDK's reason code. Pure and SDK-free.

/** The SDK's rejection messages: "Rejected inbound request (<reason code>): <detail that quotes the request>". */
const REJECTED = /^Rejected (?:inbound|2025-era) request[^(]{0,60}\(([a-z0-9-]{1,64})\)/;

/** Protocol error codes the HTTP entry reports when it refuses a request, by name. */
const PROTOCOL_ERRORS: Record<number, string> = {
  [-32022]: 'unsupported-protocol-version',
  [-32021]: 'missing-client-capability',
};

/** Describes an error for the log without request-controlled text. */
export function describeError(error: unknown): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const message = e.message.slice(0, 2_000);
  const rejected = REJECTED.exec(message);
  if (rejected) return `rejected a request (${rejected[1]})`;
  if (message.startsWith('Unsupported Media Type')) return 'rejected a request (unsupported-media-type)';
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'number' && Number.isInteger(code)) return `rejected a request (${PROTOCOL_ERRORS[code] ?? `protocol error ${code}`})`;
  // Valid JSON that isn't a JSON-RPC message (a schema error quotes the message's keys).
  if (e.name === 'ZodError' || Array.isArray((e as { issues?: unknown }).issues)) return 'ignored a message that is not valid JSON-RPC (invalid-message)';
  if (e instanceof SyntaxError) return 'ignored a message that is not valid JSON (parse-error)';
  // Anything else comes from the server or the system (sockets, streams), not
  // from a request body. Drop quoted text anyway (and everything after a quote
  // that isn't closed), and cap the length.
  const detail = message
    .replace(/(["'`])(?:(?!\1)[\s\S]){0,400}\1/g, '…')
    .replace(/["'`][\s\S]*$/, '…')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  return `${/^\w{1,40}$/.test(e.name) ? e.name : 'Error'}: ${detail}`;
}
