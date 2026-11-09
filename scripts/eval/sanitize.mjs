// Turns a raw Claude Code session transcript into a history fixture for `claude plugin eval`
// (`context.history_file`), and scans text for data that looks private. record-history.mjs
// uses both before it writes a fixture; validate.mjs runs the same scan on every committed
// evals/*/history.jsonl. It is a module of its own so that tests and validate.mjs can import
// it without running the recorder. Zero dependencies, and nothing runs on import.
//
// sanitize() keeps only the user and assistant events, and only the fields in KEEP_KEYS. In
// every string except thinking blocks, it rewrites the plugin folder to /plugin, the working
// folder to /workspace and the home folder to ~, each with the rest of its path, and the
// original session ID to FIXED_SESSION. Then it scans the result and throws, listing
// "line N: kind", if anything still looks private. No scan recognises every secret or
// another machine's name, so read a fixture before you commit it.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const FIXED_SESSION = '00000000-0000-4000-8000-000000000001';
const KEEP_KEYS = ['type', 'uuid', 'parentUuid', 'isSidechain', 'message', 'toolUseResult', 'sourceToolAssistantUUID', 'isMeta', 'timestamp', 'version', 'userType'];

// [kind, pattern]. Every pattern runs in time linear in the line's length: the e-mail one starts
// only where a local part can start and caps it at 64 characters, and the JWT one starts at the
// start of a run of [\w-] characters, or right after a "-" with its first part capped at 1,000
// characters. Without the cap, each eyJ in a long run such as eyJ-eyJ-… scanned to the run's end:
// 200,000 such characters took 18 s in Node.
export const PRIVATE_PATTERNS = [
  ['Anthropic or OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}/g],
  ['Stripe key', /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{20,})/g],
  ['GitLab token', /\bglpat-[\w-]{20,}/g],
  ['Slack token', /\bxox[abprs]-[\w-]{10,}/g],
  ['AWS key ID', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/g],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/g],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{30,}/g],
  ['JWT', /(?:(?<![\w-])eyJ[\w-]{10,}|(?<=-)eyJ[\w-]{10,1000})\.[\w-]{10,}\./g],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  // A Windows path in any letter case and with either separator, since Windows ignores case;
  // /Users and /home only as written, so that a URL path such as /users/42 passes.
  ['home folder path', /\/(?:Users|home)\/[^/\s"\\]+|[A-Za-z]:(?:\\{1,2}|\/)[Uu][Ss][Ee][Rr][Ss](?:\\{1,2}|\/)[^\\/\s"]+/g],
  ['claude.ai session ID', /\bsession_[A-Za-z0-9]{20,}/g],
  ['e-mail address', /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu],
];
// Public by design: the commit-trailer address, the reserved example domains and git's SSH remotes.
const ALLOWED = [/^noreply@anthropic\.com$/i, /@(?:[\w-]+\.)*example\.(?:com|org|net)$/i, /^git@(?:github|gitlab|bitbucket)\.(?:com|org)$/i];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Committed text that is public by design: each evals/<case>/prompt.md (such as the fake key a
 * safety case pastes) and the skill's own Markdown files, which build.mjs copies into the
 * histories. A match that appears verbatim in this text is not reported.
 */
export function publicText(root) {
  const files = [];
  const evals = join(root, 'evals');
  if (existsSync(evals)) for (const c of readdirSync(evals)) files.push(join(evals, c, 'prompt.md'));
  const skill = join(root, 'skills', 'prompt-engine');
  files.push(join(skill, 'SKILL.md'));
  const refs = join(skill, 'references');
  if (existsSync(refs)) for (const f of readdirSync(refs)) if (f.endsWith('.md')) files.push(join(refs, f));
  return files.filter((p) => existsSync(p)).map((p) => readFileSync(p, 'utf8')).join('\n');
}

/**
 * Patterns for one machine: its home folder, at a path boundary (in any letter case for a
 * Windows drive path, as sanitize() rewrites it), and its name (os.hostname() and the part
 * before the first dot) when that has 6 or more characters, so it doesn't match ordinary words.
 * The name is only looked for, never replaced: replacing a short one such as "mac" would turn
 * "macOS" into something else.
 */
export function machinePatterns({ home, host } = {}) {
  const extra = [];
  if (home) {
    const boundary = '(?![\\w-]|\\.\\w)';
    const flags = /^[A-Za-z]:[\\/]/.test(home) ? 'gi' : 'g';
    extra.push(["this machine's home folder", new RegExp(`${esc(home)}${boundary}|${esc(JSON.stringify(home).slice(1, -1))}${boundary}`, flags)]);
  }
  for (const name of new Set([host, host?.split('.')[0]])) {
    if (name && name.length >= 6 && name.toLowerCase() !== 'localhost') extra.push(["this machine's name", new RegExp(esc(name), 'gi')]);
  }
  return extra;
}

// Escapes that end in a letter or digit, so that a token right after one has no word boundary
// where it starts: a colour code (its escape character as itself or written out), a backslash
// escape written out (\n, \t, \a, an octal one such as \012, \x3d, and \u or \U with four or
// eight hex digits; in a deeper JSON level its backslash is escaped too, and the last backslash
// still matches) and a %XX escape. Each part is matched without backtracking into a long run,
// so the scan stays linear.
const ESCAPES = /(?:\x1b|\\(?:u001[bB]|x1[bB]|0?33|e))\[[0-9;?]*[ -/]*[@-~]|\\(?:[nrtfvba]|[0-7]{1,3}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|x[0-9a-fA-F]{2})|%[0-9A-Fa-f]{2}/g;

// The texts the patterns run on for one line. For a line of JSON, such as a history row,
// every key and string value as decoded text; for any other line, the line itself. Each text
// that holds an escape from ESCAPES is read twice: as it is, and with each escape turned into
// a space, so that an escape just before a token can't hide where the token starts, whether
// it is a JSON escape of the row, one in a pasted snippet or first message, or one in text
// that a tool printed.
function textsOf(line) {
  const texts = [];
  const add = (t) => {
    texts.push(t);
    const opened = t.replace(ESCAPES, ' ');
    if (opened !== t) texts.push(opened);
  };
  let value;
  if (/^\s*[[{]/.test(line)) try { value = JSON.parse(line); } catch { value = undefined; }
  if (value === undefined) {
    add(line);
    return texts;
  }
  // With a list of values still to read rather than recursion: JSON.parse reads a row nested
  // tens of thousands of levels deep, and a recursive walk overflowed the call stack on it.
  const pending = [value];
  while (pending.length) {
    const v = pending.pop();
    if (typeof v === 'string') add(v);
    else if (Array.isArray(v)) for (const x of v) pending.push(x);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { add(k); pending.push(x); }
  }
  return texts;
}

/**
 * Lines that look private, as "line N: kind", one entry per line and kind. The matched text is
 * never included: it may be a secret, and validate.mjs prints these lines in public CI logs.
 * `extra` adds [kind, pattern] pairs (each pattern with the g flag); a match that appears
 * verbatim in `allowText` is not reported.
 */
export function scanText(text, { extra = [], allowText = '' } = {}) {
  const allowed = (m) => ALLOWED.some((a) => a.test(m)) || (allowText !== '' && allowText.includes(m));
  // Every match counts, so an allowed first match doesn't hide a second one.
  const found = (t, re) => {
    for (const m of t.matchAll(re)) if (!allowed(m[0])) return true;
    return false;
  };
  const hits = [];
  text.split('\n').forEach((line, i) => {
    const texts = textsOf(line);
    for (const [kind, re] of [...PRIVATE_PATTERNS, ...extra]) {
      if (texts.some((t) => found(t, re))) hits.push(`line ${i + 1}: ${kind}`);
    }
  });
  return hits;
}

// One folder's rewrite. The folder matches with either separator (and in any case, for a
// Windows drive path), and only at a path boundary, so /home/al doesn't rewrite /home/alex.
// It becomes `to` followed by the rest of its path; for a Windows path, the rest's
// backslashes become "/", so build.mjs recognises a /plugin/... Read.
function prefixRule(prefix, to) {
  const folder = prefix.length > 1 ? prefix.replace(/[\\/]+$/, '') : prefix;
  const windows = /^[A-Za-z]:[\\/]/.test(folder);
  const source = folder.split(/[\\/]/).map(esc).join('[\\\\/]');
  const re = new RegExp(`${source}((?:[\\\\/][^\\s"'<>|*?]*)?)(?![\\w-]|\\.\\w)`, windows ? 'gi' : 'g');
  return (s) => s.replace(re, (_, rest) => to + (windows ? rest.replaceAll('\\', '/') : rest));
}

/**
 * The fixture for a raw transcript (one JSON event per line). `repo` is the plugin folder,
 * `cwd` the folder the session ran in, `home` and `host` this machine's home folder and name,
 * and `allowText` the text from publicText(). Throws if the result still looks private.
 */
export function sanitize(raw, { cwd, repo, home, host, allowText = '' } = {}) {
  const events = raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const original = events.find((e) => typeof e.sessionId === 'string' && e.sessionId)?.sessionId;
  const kept = new Set(events.filter((e) => e.type === 'user' || e.type === 'assistant').map((e) => e.uuid));
  const byUuid = new Map(events.map((e) => [e.uuid, e]));
  // Re-link each kept event to its nearest kept ancestor, skipping dropped attachments.
  const nearestKept = (uuid) => {
    let cur = uuid;
    while (cur && !kept.has(cur)) cur = byUuid.get(cur)?.parentUuid ?? null;
    return cur ?? null;
  };
  // A path realpath reports under /private/var (macOS) may also appear in its /var form.
  const forms = (p) => (!p ? [] : p.startsWith('/private/') ? [p, p.slice('/private'.length)] : [p]);
  // The repository usually sits under the home folder, so the repository and the working
  // folder are rewritten first.
  const rules = [
    ...forms(repo).map((p) => prefixRule(p, '/plugin')),
    ...forms(cwd).map((p) => prefixRule(p, '/workspace')),
    ...forms(home).map((p) => prefixRule(p, '~')),
  ];
  const fix = (s) => {
    for (const rule of rules) s = rule(s);
    return original ? s.split(original).join(FIXED_SESSION) : s;
  };
  const walk = (v) => {
    if (typeof v === 'string') return fix(v);
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    // Anthropic's documentation says the API rejects a thinking block that was changed, so
    // thinking blocks stay as recorded; the scan below refuses one that holds private data.
    if (v.type === 'thinking' || v.type === 'redacted_thinking') return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  };
  const lines = [];
  for (const e of events) {
    if (!kept.has(e.uuid)) continue;
    const o = {};
    for (const k of KEEP_KEYS) if (k in e) o[k] = walk(e[k]);
    o.parentUuid = nearestKept(e.parentUuid);
    o.sessionId = FIXED_SESSION;
    o.cwd = '/workspace';
    lines.push(JSON.stringify(o));
  }
  const text = `${lines.join('\n')}\n`;
  const hits = scanText(text, { extra: machinePatterns({ home, host }), allowText });
  if (hits.length) throw new Error(`refusing to write the history; it still contains what looks like private data:\n  ${hits.join('\n  ')}`);
  return text;
}
