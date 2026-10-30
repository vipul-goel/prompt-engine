// The Host allowlist parser shared by the CLI (--allowed-hosts,
// PROMPT_ENGINE_ALLOWED_HOSTS) and the Worker (ALLOWED_HOSTS), checked against
// the SDK's own Host validation.

import { validateHostHeader } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { canonicalHostname, parseAllowedHosts, portsIgnoredWarning, unusableWarning } from '../src/hosts.js';

const accepted = (hosts: string[], host: string) => validateHostHeader(host, hosts).ok;

describe('parseAllowedHosts', () => {
  it('lower-cases, trims, drops empty entries and duplicates', () => {
    expect(parseAllowedHosts(' MCP.Example.com , ,mcp.example.com,localhost ')).toEqual({ hosts: ['mcp.example.com', 'localhost'], portsIgnored: [], unusable: [] });
    expect(parseAllowedHosts(undefined)).toEqual({ hosts: [], portsIgnored: [], unusable: [] });
    expect(parseAllowedHosts('  ')).toEqual({ hosts: [], portsIgnored: [], unusable: [] });
  });

  it('brackets bare IPv6 addresses (two or more colons) and keeps bracketed ones', () => {
    expect(parseAllowedHosts('::1,[::1],fe80::1,2001:db8::8a2e:370:7334').hosts).toEqual(['[::1]', '[fe80::1]', '[2001:db8::8a2e:370:7334]']);
  });

  it('strips a port from a hostname, an IPv4 address or a bracketed IPv6 address, and reports it', () => {
    expect(parseAllowedHosts('mcp.example.com:8080, 127.0.0.1:8787,[::1]:3000,plain.example')).toEqual({
      hosts: ['mcp.example.com', '127.0.0.1', '[::1]', 'plain.example'],
      portsIgnored: ['mcp.example.com:8080', '127.0.0.1:8787', '[::1]:3000'],
      unusable: [],
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

  it('reads a pasted URL as its hostname, reporting a port', () => {
    expect(parseAllowedHosts('http://mcp.example.com:8080')).toEqual({ hosts: ['mcp.example.com'], portsIgnored: ['http://mcp.example.com:8080'], unusable: [] });
    expect(parseAllowedHosts('https://prompt-engine-mcp.x.workers.dev/, http://[::1]:8787/mcp?x=1')).toEqual({
      hosts: ['prompt-engine-mcp.x.workers.dev', '[::1]'],
      portsIgnored: ['http://[::1]:8787/mcp?x=1'],
      unusable: [],
    });
    expect(accepted(parseAllowedHosts('http://mcp.example.com:8080').hosts, 'mcp.example.com:8080')).toBe(true);
    expect(accepted(parseAllowedHosts('https://prompt-engine-mcp.x.workers.dev/').hosts, 'prompt-engine-mcp.x.workers.dev')).toBe(true);
  });

  it('trims the hostname and the port left after splitting them', () => {
    const parsed = parseAllowedHosts('mcp.example.com :8080, other.example: 8080, http:// third.example');
    expect(parsed).toEqual({
      hosts: ['mcp.example.com', 'other.example', 'third.example'],
      portsIgnored: ['mcp.example.com :8080', 'other.example: 8080'],
      unusable: [],
    });
    expect(accepted(parsed.hosts, 'mcp.example.com')).toBe(true);
  });

  it('writes entries the way the SDK reads the Host header, so other spellings of the same name match', () => {
    // [entry, a Host header a client sends for it]
    const spellings: [string, string][] = [
      ['0:0:0:0:0:0:0:1', '[::1]:8787'],
      ['0:0:0:0:0:0:0:1', '[0:0:0:0:0:0:0:1]:8787'],
      ['::FFFF:127.0.0.1', '[::ffff:127.0.0.1]'],
      ['2001:0db8::1', '[2001:db8::1]'],
      ['[2001:0DB8::1]:443', '[2001:0db8::1]:1'],
      ['bücher.example', 'xn--bcher-kva.example'],
      ['127.000.000.001', '127.0.0.1:8787'],
    ];
    for (const [entry, host] of spellings) {
      const { hosts, unusable } = parseAllowedHosts(entry);
      expect(unusable, entry).toEqual([]);
      expect(accepted(hosts, host), `${entry} vs Host ${host}`).toBe(true);
    }
    expect(parseAllowedHosts('0:0:0:0:0:0:0:1,::FFFF:127.0.0.1,2001:0db8::1,bücher.example').hosts).toEqual(['[::1]', '[::ffff:7f00:1]', '[2001:db8::1]', 'xn--bcher-kva.example']);
  });

  it('reports entries that name no hostname instead of keeping them', () => {
    expect(parseAllowedHosts(':8080, a b, user@mcp.example.com, u:p@mcp.example.com, localhost:abc, [::1, ok.example')).toEqual({
      hosts: ['ok.example'],
      portsIgnored: [],
      unusable: [':8080', 'a b', 'user@mcp.example.com', 'u:p@mcp.example.com', 'localhost:abc', '[::1'],
    });
  });

  it("keeps the SDK's <scheme>://* Origin entries", () => {
    expect(parseAllowedHosts('MOZ-Extension://*,localhost')).toEqual({ hosts: ['moz-extension://*', 'localhost'], portsIgnored: [], unusable: [] });
  });

  it('words the warnings plainly', () => {
    expect(portsIgnoredWarning('ALLOWED_HOSTS', ['a.example:1', 'b.example:2'])).toBe(
      'warning: ALLOWED_HOSTS takes hostnames without ports, so the port was ignored in: a.example:1, b.example:2',
    );
    expect(unusableWarning('--allowed-hosts', [':8080', 'a b'])).toBe('warning: --allowed-hosts takes hostnames, so these entries were ignored: :8080, a b');
  });
});

describe('canonicalHostname', () => {
  it('gives the form the SDK compares, or undefined for text that is not a hostname', () => {
    expect(canonicalHostname('LOCALHOST')).toBe('localhost');
    expect(canonicalHostname('0:0:0:0:0:0:0:1')).toBe('[::1]');
    expect(canonicalHostname('::1')).toBe('[::1]');
    expect(canonicalHostname('[::1]')).toBe('[::1]');
    expect(canonicalHostname('127.0.0.1')).toBe('127.0.0.1');
    for (const name of ['', 'a b', 'a:1', 'u@h', 'a/b', 'a?b']) expect(canonicalHostname(name), name).toBeUndefined();
  });
});
