// Parses the Host-header allowlist for the HTTP entries: --allowed-hosts and
// PROMPT_ENGINE_ALLOWED_HOSTS (cli.ts) and ALLOWED_HOSTS (worker.ts). The SDK's
// Host and Origin checks compare hostnames only, without ports, with IPv6 in
// brackets. Pure and SDK-free.

export interface AllowedHosts {
  /** Lower-cased hostnames, IPv6 in brackets, without ports, deduplicated. */
  hosts: string[];
  /** Entries that carried a port, as given; the port was dropped. */
  portsIgnored: string[];
}

/** Splits a comma-separated list into hostnames the SDK's Host and Origin checks can match. */
export function parseAllowedHosts(value: string | undefined): AllowedHosts {
  const hosts = new Set<string>();
  const portsIgnored: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    let host = entry;
    const bracketed = /^(\[[^\]]*\])(?::(\d*))?$/.exec(entry);
    if (bracketed) {
      host = bracketed[1]!;
      if (bracketed[2] !== undefined) portsIgnored.push(raw.trim());
    } else if (entry.split(':').length > 2) {
      // Two or more colons: a bare IPv6 address such as ::1.
      host = `[${entry}]`;
    } else {
      const withPort = /^([^:]*):(\d*)$/.exec(entry);
      if (withPort) {
        host = withPort[1]!;
        portsIgnored.push(raw.trim());
      }
    }
    if (host) hosts.add(host);
  }
  return { hosts: [...hosts], portsIgnored };
}

/** The one-line warning for entries that carried a port. */
export function portsIgnoredWarning(setting: string, portsIgnored: readonly string[]): string {
  return `warning: ${setting} takes hostnames without ports, so the port was ignored in: ${portsIgnored.join(', ')}`;
}
