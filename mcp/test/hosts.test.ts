// The Host allowlist parser shared by the CLI (--allowed-hosts,
// PROMPT_ENGINE_ALLOWED_HOSTS) and the Worker (ALLOWED_HOSTS), checked against
// the SDK's own Host validation.

import { hostHeaderValidationResponse } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { parseAllowedHosts, portsIgnoredWarning } from '../src/hosts.js';

const accepted = (hosts: string[], host: string) =>
  hostHeaderValidationResponse(new Request('http://x/mcp', { headers: { host } }), hosts) === undefined;

describe('parseAllowedHosts', () => {
  it('lower-cases, trims, drops empty entries and duplicates', () => {
    expect(parseAllowedHosts(' MCP.Example.com , ,mcp.example.com,localhost ')).toEqual({ hosts: ['mcp.example.com', 'localhost'], portsIgnored: [] });
    expect(parseAllowedHosts(undefined)).toEqual({ hosts: [], portsIgnored: [] });
    expect(parseAllowedHosts('  ')).toEqual({ hosts: [], portsIgnored: [] });
  });

  it('brackets bare IPv6 addresses (two or more colons) and keeps bracketed ones', () => {
    expect(parseAllowedHosts('::1,[::1],fe80::1,2001:db8::8a2e:370:7334').hosts).toEqual(['[::1]', '[fe80::1]', '[2001:db8::8a2e:370:7334]']);
  });

  it('strips a port from a hostname, an IPv4 address or a bracketed IPv6 address, and reports it', () => {
    expect(parseAllowedHosts('mcp.example.com:8080, 127.0.0.1:8787,[::1]:3000,plain.example')).toEqual({
      hosts: ['mcp.example.com', '127.0.0.1', '[::1]', 'plain.example'],
      portsIgnored: ['mcp.example.com:8080', '127.0.0.1:8787', '[::1]:3000'],
    });
  });

  it('gives hostnames that the SDK Host check matches, with or without a port in the request', () => {
    const { hosts } = parseAllowedHosts('mcp.example.com:8080,::1,127.0.0.1');
    expect(accepted(hosts, 'mcp.example.com:8080')).toBe(true);
    expect(accepted(hosts, 'MCP.example.com')).toBe(true);
    expect(accepted(hosts, '[::1]:8787')).toBe(true);
    expect(accepted(hosts, '127.0.0.1:1')).toBe(true);
    expect(accepted(hosts, 'evil.example.com:8080')).toBe(false);
  });

  it('words the warning plainly', () => {
    expect(portsIgnoredWarning('ALLOWED_HOSTS', ['a.example:1', 'b.example:2'])).toBe(
      'warning: ALLOWED_HOSTS takes hostnames without ports, so the port was ignored in: a.example:1, b.example:2',
    );
  });
});
