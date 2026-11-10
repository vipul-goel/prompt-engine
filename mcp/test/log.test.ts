// The CLI's stderr lines: request-controlled text never reaches the log.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeError } from '../src/log.js';

describe('describeError', () => {
  it('logs a rejected request as a fixed phrase and the SDK reason code only', () => {
    expect(
      describeError(new Error('Rejected inbound request (method-header-missing): Bad Request: the body names method LEAK/secret but the required Mcp-Method header is absent')),
    ).toBe('rejected a request (method-header-missing)');
    expect(describeError(new Error('Rejected 2025-era request on a modern-only endpoint (legacy-rejected): LEAK'))).toBe('rejected a request (legacy-rejected)');
    expect(describeError(new Error('Unsupported Media Type: Content-Type must be application/json'))).toBe('rejected a request (unsupported-media-type)');
  });

  it('names protocol errors by code, never by message', () => {
    const unsupported = Object.assign(new Error('Unsupported protocol version: LEAK'), { name: 'ProtocolError', code: -32022 });
    expect(describeError(unsupported)).toBe('rejected a request (unsupported-protocol-version)');
    const other = Object.assign(new Error('Invalid params: LEAK'), { name: 'ProtocolError', code: -32602 });
    expect(describeError(other)).toBe('rejected a request (protocol error -32602)');
  });

  it('logs unreadable messages without their content', () => {
    const parsed = z.object({ jsonrpc: z.literal('2.0') }).strict().safeParse({ jsonrpc: '1', LEAK: 'secret' });
    expect(parsed.success).toBe(false);
    expect(describeError(parsed.error)).toBe('ignored a message that is not valid JSON-RPC (invalid-message)');
    let syntax: unknown;
    try {
      JSON.parse('{"LEAK": secret');
    } catch (error) {
      syntax = error;
    }
    expect(describeError(syntax)).toBe('ignored a message that is not valid JSON (parse-error)');
  });

  it("logs serveStdio's notices about a dropped notification without the notification's text", () => {
    // The SDK's messages, as serveStdio reports them.
    expect(describeError(new Error('Discarded a notification claiming unsupported protocol revision LEAK-1\u001b[31m'))).toBe(
      'ignored a notification (unsupported-protocol-version)',
    );
    expect(
      describeError(
        new Error(
          'Discarded a notification with a malformed envelope: Invalid _meta envelope for protocol revision 2026-07-28: io.modelcontextprotocol/clientCapabilities.experimental.LEAK-2 key text: Invalid input: exp',
        ),
      ),
    ).toBe('ignored a notification (invalid-envelope)');
  });

  it("logs the SDK's messages that quote a header, a request id or a message as a fixed phrase", () => {
    // The 2025-era HTTP transport's and the protocol layer's messages, with request text in them.
    const cases: Array<[string, string]> = [
      ['Bad Request: Unsupported protocol version: LEAK-1 (supported versions: 2025-11-25)', 'rejected a request (unsupported-protocol-version)'],
      ['Not Acceptable: Client must accept both application/json and text/event-stream', 'rejected a request (not-acceptable)'],
      ['Invalid Request: Batch must not exceed 100 messages', 'rejected a request (batch-too-large)'],
      ['Invalid Request: Only one initialization request is allowed', 'rejected a request (invalid-request)'],
      ['Response for request ID LEAK-2 is undeliverable: per-request stream is disconnected and no eventStore is configured', 'dropped a response (client-disconnected)'],
      ['No connection established for request ID: LEAK-3', 'dropped a response (unknown-or-duplicate-request-id)'],
      // The protocol layer wraps the transport's errors when it sends an answer.
      ['Failed to send response: Error: No connection established for request ID: LEAK-5', 'dropped a response (unknown-or-duplicate-request-id)'],
      ['Failed to send an error response: Error: No connection established for request ID: LEAK-6', 'dropped a response (unknown-or-duplicate-request-id)'],
      ['Failed to send response: Error: Response for request ID LEAK-7 is undeliverable: per-request stream is disconnected', 'dropped a response (client-disconnected)'],
      ['Received a response for an unknown message ID: {"jsonrpc":"2.0","id":987654321,"result":{"LEAK":987654321}}', 'ignored a response (unknown-request-id)'],
      ['Received a response for an unknown request id: LEAK-4', 'ignored a response (unknown-request-id)'],
      ['Received a progress notification for an unknown token: {"method":"notifications/progress","params":{"progressToken":987654321}}', 'ignored a notification (unknown-progress-token)'],
      ['Unknown message type: {"LEAK":987654321}', 'ignored a message that is not valid JSON-RPC (invalid-message)'],
    ];
    for (const [message, line] of cases) expect(describeError(new Error(message)), message).toBe(line);
  });

  it("logs fetch's refusal of a URL built from a bad Host header without the URL", () => {
    expect(describeError(new TypeError('Failed to parse URL from http://LEAK-1 LEAK-2/mcp?api_key=LEAK-3'))).toBe('rejected a request (invalid-host-header)');
    expect(describeError(new TypeError('Request cannot be constructed from a URL that includes credentials: http://LEAK-4:LEAK-5@127.0.0.1/mcp'))).toBe(
      'rejected a request (invalid-host-header)',
    );
  });

  it('replaces control characters and line separators in other errors', () => {
    const [ls, ps] = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
    expect(describeError(new Error(`a\u001b[31mb\u0085c${ls}d${ps}e\u0007f\u009bg`))).toBe('Error: a [31mb c d e f g');
  });

  it('keeps other errors readable but drops quoted text and caps the length', () => {
    expect(describeError(new Error('listen EADDRINUSE: address already in use 127.0.0.1:8787'))).toBe('Error: listen EADDRINUSE: address already in use 127.0.0.1:8787');
    expect(describeError(new Error('Failed to send response: Error: write EPIPE'))).toBe('Error: Failed to send response: Error: write EPIPE');
    expect(describeError(new TypeError('bad "LEAK-1" and \'LEAK-2\' here'))).toBe('TypeError: bad … and … here');
    expect(describeError(new Error('unclosed "LEAK-3 and more'))).toBe('Error: unclosed …');
    expect(describeError(new Error(`x${' y'.repeat(500)}`)).length).toBeLessThanOrEqual(207);
    expect(describeError('a string')).toBe('Error: a string');
  });
});
