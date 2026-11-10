// The one stderr line the CLI writes per error. Requests are untrusted, so no
// text from a request reaches the log: rejected HTTP requests and unreadable
// messages are logged as a fixed phrase and a reason code. Pure and SDK-free.

/** The SDK's rejection messages: "Rejected inbound request (<reason code>): <detail that quotes the request>". */
const REJECTED = /^Rejected (?:inbound|2025-era) request[^(]{0,60}\(([a-z0-9-]{1,64})\)/;

/** Protocol error codes the HTTP entry reports when it refuses a request, by name. */
const PROTOCOL_ERRORS: Record<number, string> = {
  [-32022]: 'unsupported-protocol-version',
  [-32021]: 'missing-client-capability',
};

/**
 * The SDK's other messages that carry request text (a header value, a request id, a message
 * as JSON), by how they start, with the line logged instead. The 2025-era HTTP transport and
 * the protocol layer report them, the latter as JSON whose numbers survive the quote removal.
 * The transport's "No connection established" comes from a batch that repeats a request id: the
 * second answer has no stream left to go to.
 */
const SDK_MESSAGES: Array<[RegExp, string]> = [
  [/^Bad Request: Unsupported protocol version/, 'rejected a request (unsupported-protocol-version)'],
  [/^Not Acceptable/, 'rejected a request (not-acceptable)'],
  [/^Invalid Request: Batch must not exceed/, 'rejected a request (batch-too-large)'],
  [/^Invalid Request/, 'rejected a request (invalid-request)'],
  [/^Response for request ID/, 'dropped a response (client-disconnected)'],
  [/^No connection established for request ID/, 'dropped a response (unknown-or-duplicate-request-id)'],
  [/^Received a response for an unknown/, 'ignored a response (unknown-request-id)'],
  [/^Received a progress notification for an unknown token/, 'ignored a notification (unknown-progress-token)'],
  [/^Unknown message type/, 'ignored a message that is not valid JSON-RPC (invalid-message)'],
];

/**
 * How the protocol layer wraps an error the transport throws while it sends an answer ("Failed
 * to send response: Error: <message>"); SDK_MESSAGES are matched with it removed.
 */
const SEND_FAILURE = /^Failed to send (?:an error )?response: (?:\w{1,40}: )?/;

/** Describes an error for the log without request-controlled text. */
export function describeError(error: unknown): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const message = e.message.slice(0, 2_000);
  const rejected = REJECTED.exec(message);
  if (rejected) return `rejected a request (${rejected[1]})`;
  if (message.startsWith('Unsupported Media Type')) return 'rejected a request (unsupported-media-type)';
  // serveStdio's notices about a notification it drops before the era is
  // settled quote the notification's _meta.
  if (message.startsWith('Discarded a notification claiming')) return 'ignored a notification (unsupported-protocol-version)';
  if (message.startsWith('Discarded a notification')) return 'ignored a notification (invalid-envelope)';
  // The HTTP entry builds a URL from the Host header and the path; when fetch's
  // Request can't parse it, or it has user:password@, the error quotes it.
  if (/^(?:Failed to parse URL from|Request cannot be constructed from a URL)/.test(message)) return 'rejected a request (invalid-host-header)';
  const unwrapped = message.replace(SEND_FAILURE, '');
  const known = SDK_MESSAGES.find(([start]) => start.test(unwrapped));
  if (known) return known[1];
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'number' && Number.isInteger(code)) return `rejected a request (${PROTOCOL_ERRORS[code] ?? `protocol error ${code}`})`;
  // Valid JSON that isn't a JSON-RPC message (a schema error quotes the message's keys).
  if (e.name === 'ZodError' || Array.isArray((e as { issues?: unknown }).issues)) return 'ignored a message that is not valid JSON-RPC (invalid-message)';
  if (e instanceof SyntaxError) return 'ignored a message that is not valid JSON (parse-error)';
  // Anything else comes from the server or the system (sockets, streams), not
  // from a request body. Drop control characters and line separators (no
  // terminal escapes, no forged lines), quoted text (and everything after a
  // quote that isn't closed), and cap the length.
  const detail = message
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/(["'`])(?:(?!\1)[\s\S]){0,400}\1/g, '…')
    .replace(/["'`][\s\S]*$/, '…')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  return `${/^\w{1,40}$/.test(e.name) ? e.name : 'Error'}: ${detail}`;
}
