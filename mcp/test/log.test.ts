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

  it('keeps other errors readable but drops quoted text and caps the length', () => {
    expect(describeError(new Error('listen EADDRINUSE: address already in use 127.0.0.1:8787'))).toBe('Error: listen EADDRINUSE: address already in use 127.0.0.1:8787');
    expect(describeError(new TypeError('bad "LEAK-1" and \'LEAK-2\' here'))).toBe('TypeError: bad … and … here');
    expect(describeError(new Error('unclosed "LEAK-3 and more'))).toBe('Error: unclosed …');
    expect(describeError(new Error(`x${' y'.repeat(500)}`)).length).toBeLessThanOrEqual(207);
    expect(describeError('a string')).toBe('Error: a string');
  });
});
