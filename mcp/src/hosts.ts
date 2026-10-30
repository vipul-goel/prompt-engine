// Parses the Host-header allowlist for the HTTP entries: --allowed-hosts and
// PROMPT_ENGINE_ALLOWED_HOSTS (cli.ts) and ALLOWED_HOSTS (worker.ts). The SDK's
// Host and Origin checks read the header with the URL parser and compare the
// hostname, without its port, to each entry as written, so entries are put in
// the same form. Pure and SDK-free.

export interface AllowedHosts {
  /** Hostnames as the URL parser writes them (lower case, IPv6 compressed and in brackets, punycode), and any "<scheme>://*" entries, deduplicated. */
  hosts: string[];
  /** Entries that carried a port, as given; the port was dropped. */
  portsIgnored: string[];
  /** Entries that name no hostname (such as ":8080", "a b" or "user@host"), as given; they were dropped. */
  unusable: string[];
}

/** The SDK's Origin check reads "<scheme>://*" (such as moz-extension://*) as every origin of that scheme. */
const SCHEME_WILDCARD = /^[a-z][a-z0-9+.-]*:\/\/\*$/i;

/**
 * A hostname in the form the SDK's Host check compares: what the URL parser
 * makes of it (lower case, IPv6 compressed and in brackets, IDNs in punycode).
 * Undefined if the name is not a hostname, for example if it has a space, a
 * port, user:password@ or a path.
 */
export function canonicalHostname(name: string): string | undefined {
  // Two or more colons and no brackets: a bare IPv6 address such as ::1.
  const bracketed = !name.startsWith('[') && name.split(':').length > 2 ? `[${name}]` : name;
  try {
    const url = new URL(`http://${bracketed}`);
    return url.href === `http://${url.hostname}/` ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

/** Splits a comma-separated list into hostnames the SDK's Host and Origin checks can match. */
export function parseAllowedHosts(value: string | undefined): AllowedHosts {
  const hosts = new Set<string>();
  const portsIgnored: string[] = [];
  const unusable: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (SCHEME_WILDCARD.test(entry)) {
      hosts.add(entry.toLowerCase());
      continue;
    }
    // A pasted URL: drop the scheme, and anything from the path on.
    const rest = entry.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
    // A port follows the one colon after a hostname or an IPv4 address, or the colon after a bracketed IPv6 address.
    const withPort = /^(\[[^\]]*\]|[^:]*):([^:]*)$/.exec(rest);
    const validPort = !withPort || /^\d*$/.test(withPort[2]!.trim());
    const hostname = validPort ? canonicalHostname((withPort ? withPort[1]! : rest).trim()) : undefined;
    if (hostname === undefined) {
      unusable.push(entry);
      continue;
    }
    if (withPort) portsIgnored.push(entry);
    hosts.add(hostname);
  }
  return { hosts: [...hosts], portsIgnored, unusable };
}

/** The one-line warning for entries that carried a port. */
export function portsIgnoredWarning(setting: string, portsIgnored: readonly string[]): string {
  return `warning: ${setting} takes hostnames without ports, so the port was ignored in: ${portsIgnored.join(', ')}`;
}

/** The one-line warning for entries that name no hostname. */
export function unusableWarning(setting: string, unusable: readonly string[]): string {
  return `warning: ${setting} takes hostnames, so these entries were ignored: ${unusable.join(', ')}`;
}
