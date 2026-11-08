// Checks the eval cases under evals/ for free, before a billed `claude plugin eval` run: the
// keys, values and referenced files of each case.yaml, prompt.md and graders/*.md. claude plugin
// eval drops an unknown case.yaml key and skips a grader file without front matter, both without
// a message; a missing baseline_file or a pattern that doesn't compile fails only after the
// billed agent run; and `claude plugin validate` doesn't read evals/. checkSuiteRules adds this
// repo's rules for how the cases run and score, and checkConversations its rules for the history
// cases' recordings and the graders that depend on them, and for the request text that any
// rubric quotes. scripts/validate.mjs runs all three. Zero dependencies.
//
// The rules follow claude plugin eval's code (read in versions 2.1.312, 2.1.317, 2.1.318 and
// 2.1.319) and code.claude.com/docs/en/plugin-evals. Messages that end in "(repo rule)" are
// stricter than the CLI. The files are read with a small YAML subset (parseYaml below) that
// fails closed: any other line is an error naming file:line, so a case file can't mean one thing
// here and another to the CLI's YAML parser. Patterns compile with Node's regex engine, while
// Claude Code runs JavaScriptCore (Bun), so a rare pattern can compile in one and not the other.

import { readFileSync, readdirSync, statSync, lstatSync, existsSync } from 'node:fs';
import { join, isAbsolute, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalize } from './build.mjs';

// ---------- YAML subset ----------
// Lines: blank, "# comment", "key: value" at indent 0, and under a "key:" line with no value
// either "  key: value" lines or "  - item" lines. Values: 'single-quoted', "double-quoted"
// with the escapes in ESCAPES, | and > blocks (with - or + chomping), one-level [a, b] and
// {k: v} flows, and plain text, whole numbers, decimals, true, false and null (also ~ or
// nothing). Keys are letters, digits, _ and -, starting with a letter or _, and appear once.
// Spaces only: YAML refuses tabs in indentation.

// Characters that some YAML parsers refuse and others read, some as a line break (U+0085, U+2028
// and U+2029 among them).
const CONTROL = /[\x00-\x08\x0B-\x1F\x7F-\x9F\u{2028}\u{2029}\u{FEFF}\u{FFFE}\u{FFFF}]/u;
// The escapes YAML 1.1 and 1.2 parsers read alike. Others are refused: YAML reads "\b" as a
// backspace, for example, where a regex means a word boundary.
const ESCAPES = { '\\': '\\', '"': '"', '/': '/', n: '\n', t: '\t', r: '\r', 0: '\0' };
// Plain words that YAML 1.1 parsers (Psych, the yaml package in 1.1 mode) or YAML 1.2 parsers
// (the yaml package, js-yaml) read as a boolean, null, number or date, in a form this subset
// doesn't read the same way.
const NOT_TEXT = new RegExp(`^(?:${[
  'y|n|yes|no|on|off|true|false|null', // in any letter case but the lowercase true, false and null read below
  '[-+]?\\.(?:inf|nan)',
  '[-+]?0[xob][\\da-f_,]*', // hexadecimal, octal and binary numbers
  '[-+]?[\\d.][\\d_.,:e+-]*', // other numbers, and 1_000, 1,000, 1:30 or a lone dot, which some YAML 1.1 parsers read as numbers
  '\\d{4}-\\d\\d?-\\d\\d?(?:[t\\s].*)?', // dates and times
  'e[-+]?\\d+', // read as a number by the yaml package in YAML 1.1 mode
  '<<|=', // YAML 1.1's merge and value keys
].join('|')})$`, 'i');

// YAML 1.1 parsers read a key such as on or y as a boolean.
const checkKey = (key, where) => {
  if (NOT_TEXT.test(key)) throw new Error(`${where}: YAML parsers read the key ${key} as a boolean or null, and not all alike`);
};
// An own property even for a key such as __proto__.
const set = (obj, key, value) => Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
const spaces = (line) => line.match(/^ */)[0].length;
const blank = (line) => /^ *$/.test(line);
// YAML separates with spaces (and tabs, refused here), so a value's own edges keep any other
// white space, such as a no-break or ideographic space; String.prototype.trim would drop it and
// read "regex\u{A0}" as regex.
const trimSp = (s) => s.replace(/^ +| +$/g, '');

function quoted(v, where) {
  if (v[0] === "'") {
    const m = v.match(/^'((?:[^']|'')*)'(?: +#.*)?$/);
    if (!m) throw new Error(`${where}: a single-quoted value must end on its line, followed by nothing or a # comment: ${v}`);
    return m[1].replace(/''/g, "'");
  }
  const m = v.match(/^"((?:[^"\\]|\\.)*)"(?: +#.*)?$/);
  if (!m) throw new Error(`${where}: a double-quoted value must end on its line, followed by nothing or a # comment: ${v}`);
  return m[1].replace(/\\(?:x([\da-fA-F]{2})|u([\da-fA-F]{4})|(.))/g, (s, x, u, c) => {
    if (x) return String.fromCharCode(parseInt(x, 16));
    if (u) {
      const code = parseInt(u, 16);
      if (code >= 0xd800 && code <= 0xdfff) throw new Error(`${where}: unsupported escape ${s} (a surrogate half)`);
      return String.fromCharCode(code);
    }
    if (!Object.hasOwn(ESCAPES, c)) throw new Error(`${where}: unsupported escape ${s}; YAML reads it differently from a regex, so write \\\\ for a backslash`);
    return ESCAPES[c];
  });
}

// One-level [a, b] or {k: v} on one line: entries split at commas outside quotes, a trailing
// comma allowed.
function flow(v, where) {
  const close = v[0] === '[' ? ']' : '}';
  const entries = [];
  let cur = '';
  let q = null;
  let i = 1;
  for (; i < v.length; i++) {
    const ch = v[i];
    if (q) {
      cur += ch;
      if (q === '"' && ch === '\\') cur += v[++i] ?? '';
      else if (ch === q && q === "'" && v[i + 1] === "'") cur += v[++i];
      else if (ch === q) q = null;
      continue;
    }
    if (ch === close) break;
    if ((ch === "'" || ch === '"') && trimSp(cur) === '') q = ch;
    else if ('[]{}'.includes(ch)) throw new Error(`${where}: nested [ ] or { } isn't supported; quote the entry: ${v}`);
    // YAML reads the rest of the line, closing bracket included, as a comment.
    else if (ch === '#' && (cur === '' || /\s$/.test(cur))) throw new Error(`${where}: a # comment inside ${v[0]} ${close}: ${v}`);
    if (ch === ',') { entries.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (q || i >= v.length) throw new Error(`${where}: ${v[0]} without its closing ${close} on the same line: ${v}`);
  if (!/^(?: +#.*)?$/.test(v.slice(i + 1))) throw new Error(`${where}: text after the closing ${close}: ${v}`);
  if (trimSp(cur) !== '') entries.push(cur);
  else if (!entries.length) return close === ']' ? [] : {};
  if (entries.some((e) => trimSp(e) === '')) throw new Error(`${where}: an empty entry in ${v[0]} ${close}: ${v}`);
  if (close === ']') return entries.map((e) => scalar(e, where));
  const map = {};
  for (const e of entries) {
    const kv = trimSp(e).match(/^([A-Za-z_][\w-]*): +(\S.*)$/);
    if (!kv) throw new Error(`${where}: write each { } entry as key: value: ${trimSp(e)}`);
    checkKey(kv[1], where);
    if (Object.hasOwn(map, kv[1])) throw new Error(`${where}: duplicate key ${kv[1]}`);
    set(map, kv[1], scalar(kv[2], where));
  }
  return map;
}

function scalar(raw, where) {
  const v = trimSp(raw);
  if (v[0] === "'" || v[0] === '"') return quoted(v, where);
  if (v[0] === '[' || v[0] === '{') return flow(v, where);
  if (/^[&*!|>%@`#]/.test(v)) throw new Error(`${where}: unsupported YAML value ${v}`);
  const plain = v.replace(/ +#.*$/, '');
  // A nested mapping, a list entry or a flow indicator to YAML, or an error; Psych reads :x as a
  // Ruby symbol.
  if (/:( |$)/.test(plain) || /^[-?,]( |$)/.test(plain) || /^[:\]},]/.test(plain)) throw new Error(`${where}: quote the value "${plain}"`);
  if (plain === '' || plain === '~' || plain === 'null') return null;
  if (plain === 'true' || plain === 'false') return plain === 'true';
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(plain)) return Number(plain);
  if (NOT_TEXT.test(plain)) throw new Error(`${where}: quote the value "${plain}" (YAML parsers read it as a number, boolean, null or date, and not all alike)`);
  return plain;
}

// The text of a | or > block from its lines. Indentation is the first non-blank line's, as in
// YAML. Trailing blank lines are not text: chomping keeps one final line break (clip), none (-)
// or all of them (+). A trailing line of more spaces than that indentation is text to YAML (the
// spaces past it), which this subset refuses.
function block(lines, style, chomp, where) {
  let end = lines.length;
  while (end > 0 && blank(lines[end - 1])) end--;
  const trailing = '\n'.repeat(lines.length - end);
  const body = lines.slice(0, end);
  if (!body.length) return chomp === '+' ? trailing : '';
  const first = body.findIndex((l) => !blank(l));
  const n = spaces(body[first]);
  if (body.slice(0, first).some((l) => l.length > n)) throw new Error(`${where}: a blank line before the block's first line has more spaces than that line`);
  if (lines.slice(end).some((l) => l.length > n)) throw new Error(`${where}: a line of spaces after the block's last line has more spaces than its first line`);
  if (body.some((l) => !blank(l) && spaces(l) < n)) throw new Error(`${where}: a line of the block is indented less than its first line`);
  const text = body.map((l) => l.slice(n));
  let value;
  if (style === '|') value = text.join('\n');
  else {
    // Folding: a line break between two lines becomes a space; n blank lines become n breaks.
    // YAML keeps the breaks around more-indented lines, which this subset refuses instead.
    if (text.some((l) => l.startsWith(' '))) throw new Error(`${where}: a more-indented line in a > block; use a | block`);
    value = '';
    let breaks = 0;
    let started = false;
    for (const l of text) {
      if (l === '') { breaks++; continue; }
      value += !started ? '\n'.repeat(breaks) + l : breaks ? '\n'.repeat(breaks) + l : ` ${l}`;
      started = true;
      breaks = 0;
    }
  }
  if (chomp === '-') return value;
  return chomp === '+' ? `${value}\n${trailing}` : `${value}\n`;
}

// Parses text in the subset. firstLine is the file line that the text starts on, for messages.
export function parseYaml(text, file, firstLine = 1) {
  const lines = normalize(text).split('\n');
  if (lines.at(-1) === '') lines.pop();
  const at = (i) => `${file}:${firstLine + i}`;
  // Checked first, since a block's lines are read below as a whole.
  lines.forEach((line, i) => {
    if (line.includes('\t')) throw new Error(`${at(i)}: a tab; indent with spaces, and write \\t for a tab inside a double-quoted value`);
    const c = line.match(CONTROL);
    if (c) throw new Error(`${at(i)}: control character U+${c[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  });
  const root = {};
  let open = null; // the indent-0 key whose nested lines are being read
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^ *(?:#.*)?$/.test(line)) continue;
    const indent = spaces(line);
    let target = root;
    if (indent === 0) open = null;
    else if (indent === 2 && open !== null) {
      const item = line.match(/^ {2}- (.*)$/);
      if (item) {
        if (root[open] === null) set(root, open, []);
        if (!Array.isArray(root[open])) throw new Error(`${at(i)}: a list entry among the keys of ${open}`);
        root[open].push(scalar(item[1], at(i)));
        continue;
      }
      if (root[open] === null) set(root, open, {});
      if (Array.isArray(root[open])) throw new Error(`${at(i)}: a key among the list entries of ${open}`);
      target = root[open];
    } else throw new Error(`${at(i)}: unsupported indentation (keys at the start of a line, and keys or "- " entries 2 spaces in under a key with no value)`);
    const m = line.slice(indent).match(/^([A-Za-z_][\w-]*):(?: +(.*))?$/);
    if (!m) throw new Error(`${at(i)}: unsupported line: ${line.trim()}`);
    const key = m[1];
    const rest = trimSp(m[2] ?? '');
    checkKey(key, at(i));
    if (Object.hasOwn(target, key)) throw new Error(`${at(i)}: duplicate key ${key}`);
    const b = rest.match(/^([|>])([-+]?)(?: +#.*)?$/);
    if (b) {
      const start = i;
      while (i + 1 < lines.length && (blank(lines[i + 1]) || spaces(lines[i + 1]) > indent)) i++;
      set(target, key, block(lines.slice(start + 1, i + 1), b[1], b[2], at(start)));
      if (indent === 0) open = null;
    } else if (rest === '' || rest[0] === '#') {
      set(target, key, null);
      if (indent === 0) open = key; // a nested key with no value stays null: one level only
    } else {
      set(target, key, scalar(rest, at(i)));
      if (indent === 0) open = null;
    }
  }
  return root;
}

// Front matter as claude plugin eval cuts it: after a leading BOM, a first line of "---", then
// everything up to the next "---" anywhere, even in the middle of a line. Returns { data, body }
// with data null when the text has no front matter, and body as the CLI reads it (trimmed).
const FRONT = /^---\s*\n([\s\S]*?)---\s*\n?/;
export function frontmatter(text, file) {
  const t = normalize(text);
  const m = t.match(FRONT);
  if (!m) {
    if (/^---\s*\n/.test(t)) throw new Error(`${file}: front matter without its closing "---"`);
    return { data: null, body: t.trim() };
  }
  if (m[1] !== '' && !m[1].endsWith('\n')) throw new Error(`${file}: "---" inside the front matter, where claude plugin eval ends it; keep "---" out of values and comments`);
  const opening = t.match(/^---\s*\n/)[0];
  return { data: parseYaml(m[1], file, opening.split('\n').length), body: t.slice(m[0].length).trim() };
}

// ---------- case files ----------
const TOP = ['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'expected_outcome'];
const EXEC = ['model', 'max_turns', 'timeout_seconds', 'allowed_tools', 'disallowed_tools', 'append_system_prompt', 'env'];
const CASE_KEYS = new Set([...TOP, 'context', 'execution']);
const CONTEXT_KEYS = new Set(['scaffold_script', 'history_file', 'add_dirs']);
const EXECUTION_KEYS = new Set([...EXEC, 'prompt']);
const PROMPT_KEYS = new Set([...TOP, ...EXEC]);
// Keys the CLI accepts that this repo doesn't use.
const UNDOCUMENTED = new Set(['artifact_publish', 'growthbook_overrides']);
const UNDOCUMENTED_RULE = "not used in this repo; claude plugin eval accepts it, but its docs don't list it (repo rule)";
// Types in the CLI's case schema; a value of another type makes it refuse the case.
const STRING_KEYS = new Set(['description', 'expected_outcome', 'model', 'append_system_prompt', 'prompt', 'scaffold_script', 'history_file']);
const LIST_KEYS = new Set(['tags', 'plugins', 'allowed_tools', 'disallowed_tools', 'add_dirs']);

const GRADER_TYPES = {
  regex: ['pattern', 'flags', 'match', 'target'],
  tool_used: ['tool', 'input_match', 'min', 'max'],
  tool_order: ['before', 'after'],
  file_exists: ['path', 'exists'],
  llm: ['criteria', 'focus'],
  baseline: ['baseline_file', 'criteria'],
};
const VIEWS = new Set(['trace', 'last_message', 'files', 'mock_calls']);

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isMapping = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const compileError = (pattern, flags = '') => { try { new RegExp(pattern, flags); return null; } catch (e) { return e.message; } };
// A relative path inside the case folder on any platform (D10 runs the checks on Windows too).
const inside = (rel) => typeof rel === 'string' && rel !== '' && !isAbsolute(rel) && !win32.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..');
// The CLI takes a plain file with one name. It also follows a link whose target stays in the
// case folder; this check doesn't, since a link doesn't survive every checkout.
const isPlainFile = (p) => { try { const s = lstatSync(p); return s.isFile() && s.nlink === 1; } catch { return false; } };

// Values that sit at the top of prompt.md, and at the top of case.yaml or under its execution:
// or context: (top, exec and ctx are those mappings, execKeys the keys allowed in exec). Only
// allowed keys are checked, since another key is reported as unknown. Types and limits from the
// CLI's case schema.
function checkValues(err, where, top, exec, ctx, execKeys) {
  const known = (o, keys) => Object.entries(o).filter(([k]) => keys.has(k));
  for (const [k, v] of [...known(top, new Set(TOP)), ...known(exec, execKeys), ...known(ctx, CONTEXT_KEYS)]) {
    if (STRING_KEYS.has(k) && typeof v !== 'string') err(`${where}: ${k} must be a string`);
    if (LIST_KEYS.has(k) && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) err(`${where}: ${k} must be a list of strings, such as [a, b]`);
  }
  if (Object.hasOwn(top, 'runs') && !whole(top.runs, 1, 50)) err(`${where}: runs must be a whole number from 1 to 50`);
  if (Object.hasOwn(exec, 'max_turns') && !whole(exec.max_turns, 1, 200)) err(`${where}: max_turns must be a whole number from 1 to 200`);
  if (Object.hasOwn(exec, 'timeout_seconds') && !whole(exec.timeout_seconds, 1, 3600)) err(`${where}: timeout_seconds must be a whole number from 1 to 3600`);
  if (Object.hasOwn(exec, 'env')) {
    if (!isMapping(exec.env)) err(`${where}: env must be a mapping of EVAL_* names to strings`);
    else {
      for (const [k, v] of Object.entries(exec.env)) {
        if (!/^EVAL_[A-Z0-9_]*$/.test(k)) err(`${where}: env key "${k}" must match EVAL_[A-Z0-9_]* (other keys fail the run)`);
        if (typeof v !== 'string') err(`${where}: env value of ${k} must be a string`);
      }
    }
  }
}

function checkSchemaVersion(err, where, v) {
  if (typeof v !== 'string' || !/^1(?:\.\d+)*$/.test(v)) err(`${where}: schema_version must be a quoted 1.x string, such as "1.1"`);
}

function checkGrader(err, where, g, abs, referenced, dir) {
  const d = g.data;
  if (!Object.hasOwn(GRADER_TYPES, d.type)) { err(`${where}: type must be one of ${Object.keys(GRADER_TYPES).join(', ')}`); return; }
  for (const k of Object.keys(d)) {
    if (k === 'name') err(`${where}: name: the file name is the grader's name; don't override it (repo rule)`);
    else if (!['type', 'weight', 'arm', ...GRADER_TYPES[d.type]].includes(k)) err(`${where}: key "${k}" is not a ${d.type} grader option`);
  }
  if (d.weight !== undefined && !(typeof d.weight === 'number' && d.weight > 0)) err(`${where}: weight must be a number above 0`);
  if (d.arm !== undefined && d.arm !== 'with-only' && d.arm !== 'both') err(`${where}: arm must be with-only or both`);
  // target and focus: what the grader reads.
  const view = (k) => {
    const v = d[k];
    if (v === undefined || VIEWS.has(v)) return;
    if (isMapping(v) && v.source === 'file' && inside(v.path) && Object.keys(v).length === 2) return;
    err(`${where}: ${k} must be trace, last_message, files, mock_calls or {source: file, path: <a relative path>}`);
  };
  const pattern = (k, v) => {
    if (v === undefined) return;
    if (typeof v !== 'string') { err(`${where}: ${k} must be a string`); return; }
    const e = compileError(v);
    if (e) err(`${where}: ${k}: ${e}`);
  };
  const tool = (k) => {
    const v = d[k];
    if (typeof v === 'string' && v !== '') return;
    if (isMapping(v) && typeof v.tool === 'string' && v.tool !== '' && Object.keys(v).every((x) => x === 'tool' || x === 'input_match')) { pattern(`${k}.input_match`, v.input_match); return; }
    err(`${where}: ${k} must be a tool name or {tool, input_match}`);
  };
  // The CLI fills a missing pattern or criteria from the file's body.
  const fromBody = (k) => (d[k] === undefined && g.body !== '' ? g.body : d[k]);
  switch (d.type) {
    case 'regex': {
      const p = fromBody('pattern');
      const flags = d.flags === undefined ? '' : d.flags;
      if (typeof p !== 'string' || p === '') err(`${where}: needs a pattern (the pattern key, or the file's body)`);
      else if (typeof flags !== 'string' || !/^[dgimsuvy]*$/.test(flags)) err(`${where}: flags may use only d g i m s u v y`);
      else { const e = compileError(p, flags); if (e) err(`${where}: pattern: ${e}`); }
      if (d.match !== undefined && !(typeof d.match === 'string' && /^(?:contains|not_contains|count:\d+)$/.test(d.match))) err(`${where}: match must be contains, not_contains or count:N`);
      view('target');
      break;
    }
    case 'tool_used': {
      if (typeof d.tool !== 'string' || d.tool === '') err(`${where}: needs tool`);
      pattern('input_match', d.input_match);
      for (const k of ['min', 'max']) if (d[k] !== undefined && !whole(d[k], 0, Infinity)) err(`${where}: ${k} must be a whole number of 0 or more`);
      // The CLI counts calls from min (1 when unset) to max: a max below that never passes.
      const min = d.min ?? 1;
      if (whole(min, 0, Infinity) && whole(d.max, 0, Infinity) && min > d.max) err(`${where}: min (${d.min === undefined ? '1 when unset' : min}) is above max (${d.max}), so the grader never passes`);
      break;
    }
    case 'tool_order': tool('before'); tool('after'); break;
    case 'file_exists':
      if (typeof d.path !== 'string' || d.path === '') err(`${where}: needs path`);
      if (d.exists !== undefined && typeof d.exists !== 'boolean') err(`${where}: exists must be true or false`);
      break;
    case 'llm':
    case 'baseline': {
      const c = fromBody('criteria');
      if (typeof c !== 'string' || c.trim() === '') err(`${where}: needs criteria (the criteria key, or the file's body)`);
      if (d.type === 'llm') view('focus');
      else if (!inside(d.baseline_file) || !isPlainFile(join(abs, d.baseline_file))) err(`${where}: baseline_file "${d.baseline_file}" is not a plain file in the case folder`);
      else referenced.add(`${dir}/${d.baseline_file}`);
      break;
    }
  }
}

// Checks every case under root/evals and calls err(message) for each problem. Returns the cases
// it found, for other checks to reuse: { name, dir, caseYaml, prompt: { data, body }, graders:
// [{ name, file, data, body }] }, where caseYaml or prompt is null when the file is missing or
// didn't parse, graders lists the files with front matter that parsed, and bodies are trimmed.
export function checkEvalCases(root, err) {
  const cases = [];
  if (!isDir(join(root, 'evals'))) return cases;
  const referenced = new Set();
  for (const name of readdirSync(join(root, 'evals')).sort()) {
    const dir = `evals/${name}`;
    const abs = join(root, dir);
    if (name === 'results' || !isDir(abs)) continue; // results/: claude plugin eval's output
    if (name === 'mocks') { err(`${dir}: suite-wide mocks aren't used in this repo, and validate.mjs doesn't check them (repo rule)`); continue; }
    const hasCase = isFile(join(abs, 'case.yaml'));
    const hasPrompt = isFile(join(abs, 'prompt.md'));
    // claude plugin eval also reads cases from subfolders of a folder without them (a group).
    if (!hasCase && !hasPrompt) { err(`${dir}: needs prompt.md or case.yaml; cases sit directly under evals/, because scripts/build.mjs refreshes only evals/<case>/history.jsonl (repo rule)`); continue; }
    const c = { name, dir, caseYaml: null, prompt: null, graders: [] };
    cases.push(c);
    let caseParsed = !hasCase;
    if (hasCase) {
      const file = `${dir}/case.yaml`;
      const text = normalize(readFileSync(join(abs, 'case.yaml'), 'utf8'));
      // Named before parsing, since the subset can't read a list of mappings.
      if (/^graders:/m.test(text)) err(`${file}: graders: write each grader as graders/<name>.md, which validate.mjs checks (repo rule)`);
      else {
        try { c.caseYaml = parseYaml(text, file); caseParsed = true; } catch (e) { err(e.message); }
      }
    }
    if (hasPrompt) {
      try { c.prompt = frontmatter(readFileSync(join(abs, 'prompt.md'), 'utf8'), `${dir}/prompt.md`); } catch (e) { err(e.message); }
    }

    const cy = c.caseYaml;
    // claude plugin eval reads a case.yaml with nothing but comments as no file (Bun.YAML.parse
    // gives null), and fills in schema_version and name, so its checks don't apply.
    if (cy && Object.keys(cy).length) {
      const file = `${dir}/case.yaml`;
      for (const k of Object.keys(cy)) if (!CASE_KEYS.has(k)) err(`${file}: unknown key "${k}" (claude plugin eval drops it without a message)`);
      for (const [section, allowed] of [['context', CONTEXT_KEYS], ['execution', EXECUTION_KEYS]]) {
        if (cy[section] === undefined) continue;
        if (!isMapping(cy[section])) { err(`${file}: ${section} must be a mapping`); continue; }
        for (const k of Object.keys(cy[section])) {
          if (section === 'execution' && UNDOCUMENTED.has(k)) err(`${file}: execution.${k}: ${UNDOCUMENTED_RULE}`);
          else if (!allowed.has(k)) err(`${file}: unknown key "${section}.${k}" (claude plugin eval drops it without a message)`);
        }
      }
      checkSchemaVersion(err, file, cy.schema_version);
      // prompt.md's name, when set, wins over case.yaml's.
      if (cy.name === undefined && c.prompt?.data?.name === undefined) err(`${file}: name is required (claude plugin eval refuses the case without it)`);
      else if (cy.name !== undefined && cy.name !== name) err(`${file}: name "${cy.name}" must equal the folder name (repo rule)`);
      const exec = isMapping(cy.execution) ? cy.execution : {};
      const ctx = isMapping(cy.context) ? cy.context : {};
      checkValues(err, file, cy, exec, ctx, EXECUTION_KEYS);
      for (const k of ['scaffold_script', 'history_file']) {
        if (typeof ctx[k] !== 'string') continue;
        if (!inside(ctx[k]) || !isPlainFile(join(abs, ctx[k]))) err(`${file}: context.${k} "${ctx[k]}" is not a plain file in the case folder`);
        else referenced.add(`${dir}/${ctx[k]}`);
      }
      if (ctx.history_file !== undefined && ctx.history_file !== 'history.jsonl') err(`${file}: context.history_file must be history.jsonl, the only name scripts/build.mjs refreshes (repo rule)`);
      // The CLI refuses an add_dir that is the case folder itself or covers its graders/ or mocks/.
      for (const d of Array.isArray(ctx.add_dirs) ? ctx.add_dirs : []) {
        const first = typeof d === 'string' ? d.split(/[\\/]/).find((s) => s !== '' && s !== '.') : undefined;
        if (!inside(d) || first === undefined || first === 'graders' || first === 'mocks' || !isDir(join(abs, d))) err(`${file}: add_dirs entry "${d}" is not a fixture folder in the case folder (one that isn't the case folder, graders/ or mocks/)`);
      }
    }
    const fm = c.prompt;
    if (fm) {
      const file = `${dir}/prompt.md`;
      const data = fm.data ?? {};
      for (const k of Object.keys(data)) {
        if (UNDOCUMENTED.has(k)) err(`${file}: ${k}: ${UNDOCUMENTED_RULE}`);
        else if (!PROMPT_KEYS.has(k)) err(`${file}: unknown front matter key "${k}" (claude plugin eval refuses to load the case)`);
      }
      if (data.schema_version !== undefined) checkSchemaVersion(err, file, data.schema_version);
      if (data.name !== undefined && data.name !== name) err(`${file}: name "${data.name}" must equal the folder name (repo rule)`);
      checkValues(err, file, data, data, {}, new Set(EXEC));
    }
    // The prompt is prompt.md's body, else execution.prompt in case.yaml.
    const execPrompt = typeof cy?.execution?.prompt === 'string' ? cy.execution.prompt.trim() : '';
    if (fm && fm.body === '' && execPrompt === '' && caseParsed) err(`${dir}/prompt.md: the body (the prompt) is empty`);
    else if (!hasPrompt && cy && execPrompt === '') err(`${dir}: no prompt (a prompt.md body, or execution.prompt in case.yaml)`);

    const gdir = join(abs, 'graders');
    const files = isDir(gdir) ? readdirSync(gdir).filter((f) => f.endsWith('.md')).sort() : [];
    let count = 0;
    for (const f of files) {
      const where = `${dir}/graders/${f}`;
      let g;
      try { g = frontmatter(readFileSync(join(gdir, f), 'utf8'), where); } catch (e) { err(e.message); count++; continue; }
      if (!g.data) { err(`${where}: no front matter at the top, so claude plugin eval skips this file`); continue; }
      count++;
      c.graders.push({ name: f.slice(0, -3), file: where, data: g.data, body: g.body });
      checkGrader(err, where, g, abs, referenced, dir);
    }
    if (!count) err(`${dir}: needs at least one grader in graders/ with front matter`);
  }

  // A referenced fixture that git ignores works here but is missing from a clean checkout. Only
  // files that exist are asked about, since check-ignore also lists a missing path that matches
  // a pattern. Exit 0: some are ignored; 1: none; 128 or no git at all: skipped. Tracked files
  // are never listed, which is right: a clean checkout has them.
  if (referenced.size && existsSync(join(root, '.git'))) {
    const r = spawnSync('git', ['-C', root, 'check-ignore', '--stdin', '-z'], { input: `${[...referenced].join('\0')}\0`, encoding: 'utf8' });
    if (r.status === 0) for (const p of r.stdout.split('\0').filter(Boolean)) err(`${p}: ignored by .gitignore, so a clean checkout lacks it (git check-ignore -v ${p} names the rule)`);
  }
  return cases;
}

// ---------- this repo's rules for runs ----------
// True when a file of the case didn't read (it didn't parse, or a grader has no front matter).
// checkEvalCases has reported that file, and the rules below would misread the case without it.
function unread(root, c) {
  const abs = join(root, c.dir);
  const gdir = join(abs, 'graders');
  const graders = isDir(gdir) ? readdirSync(gdir).filter((f) => f.endsWith('.md')).length : 0;
  return (isFile(join(abs, 'prompt.md')) && !c.prompt) || (isFile(join(abs, 'case.yaml')) && !c.caseYaml) || graders !== c.graders.length;
}

// A case's settings as claude plugin eval resolves them: a key in prompt.md's front matter wins
// over the same key in case.yaml, which holds model and allowed_tools under execution: and the
// fixtures under context:.
function settings(c) {
  const fm = c.prompt?.data ?? {};
  const cy = c.caseYaml ?? {};
  const exec = isMapping(cy.execution) ? cy.execution : {};
  const ctx = isMapping(cy.context) ? cy.context : {};
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    tags: strings(fm.tags ?? cy.tags),
    allowed: strings(fm.allowed_tools ?? exec.allowed_tools),
    model: fm.model ?? exec.model,
    modelFile: fm.model != null ? 'prompt.md' : 'case.yaml',
    scaffold: ctx.scaffold_script,
    history: ctx.history_file,
  };
}

// The tools a run allows when the case lists them in allowed_tools. Any other tool needs
// --allow-tools, which grants it to every case in the run (plugin-evals docs, "Grant tools"; the
// same set in 2.1.319's code).
const READ_ONLY = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'Skill', 'AskUserQuestion', 'Agent', 'TodoWrite',
  'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskStop']);
// The tool an allowed_tools entry names, without a pattern such as the one in Bash(npm test *).
const toolName = (t) => t.replace(/\(.*$/s, '');
// Whether a run allows an allowed_tools entry without --allow-tools, as 2.1.319's code decides
// it: a read-only tool, also with a rule such as Skill(prompt-engine) or Read(./src/**), unless it
// is Read, Glob or Grep with a rule that starts with /, ~, \ or a drive letter, or has a ".."
// segment. Not modeled, since no case here uses one: a tool on a mocked MCP server, which needs no
// grant either (docs).
function allowedUngranted(entry) {
  const name = toolName(entry);
  const rule = entry.match(/^[^(]*\(([\s\S]*)\)$/)?.[1];
  if (!READ_ONLY.has(name)) return false;
  if (rule === undefined || !['Read', 'Glob', 'Grep'].includes(name)) return true;
  return !/^[/~\\]|^[A-Za-z]:/.test(rule) && !rule.split(/[\\/]/).includes('..');
}
// A regex grader that fails unless the trace's tool list, the init line's "tools":[...], names
// the tool: target trace, a pattern holding "tools" and the tool in double quotes, match contains
// (the default), and not arm: with-only, which two-arm runs leave out of the score.
function requiresGrant(g, tool) {
  const d = g.data;
  const p = d.pattern ?? (g.body !== '' ? g.body : undefined);
  return d.type === 'regex' && d.target === 'trace' && (d.match === undefined || d.match === 'contains') && d.arm !== 'with-only'
    && typeof p === 'string' && p.includes('"tools"') && p.includes(`"${tool}"`);
}

// A recorded conversation (a history case's history.jsonl) as the rules read it. Each line is one
// row; a line that isn't a JSON object is skipped, since scripts/build.mjs fails on it. Returns:
// - models: the models of the assistant messages. Claude Code writes <synthetic> as the model of
//   a message it makes itself (read in 2.1.319's code), so a value in angle brackets doesn't count;
// - assistantTexts: the text parts of the assistant messages, in order;
// - userTexts: what the user typed, from user rows that Claude Code didn't mark isMeta (it marks
//   the skill text it injects), without tool results;
// - dialogLines: the lines that call AskUserQuestion, or ToolSearch with an input that names it;
// - last: the last assistant row, as { line, row };
// - messageIds: the ids of the recorded API messages.
function readRecording(file) {
  const rows = [];
  normalize(readFileSync(file, 'utf8')).split('\n').forEach((text, i) => {
    let row;
    try { row = JSON.parse(text); } catch { return; }
    if (isMapping(row)) rows.push({ line: i + 1, row });
  });
  const parts = (row) => (Array.isArray(row.message?.content) ? row.message.content.filter(isMapping) : []);
  const texts = (row) => parts(row).filter((p) => p.type === 'text' && typeof p.text === 'string').map((p) => p.text);
  const assistant = rows.filter(({ row }) => row.type === 'assistant');
  const dialog = (p) => p.type === 'tool_use' && (p.name === 'AskUserQuestion' || (p.name === 'ToolSearch' && JSON.stringify(p.input ?? null).includes('AskUserQuestion')));
  return {
    models: new Set(assistant.map(({ row }) => row.message?.model).filter((m) => typeof m === 'string' && !m.startsWith('<'))),
    assistantTexts: assistant.flatMap(({ row }) => texts(row)),
    userTexts: rows.filter(({ row }) => row.type === 'user' && !row.isMeta)
      .flatMap(({ row }) => (typeof row.message?.content === 'string' ? [row.message.content] : texts(row))),
    dialogLines: assistant.filter(({ row }) => parts(row).some(dialog)).map(({ line }) => line),
    last: assistant.at(-1),
    messageIds: new Set(rows.map(({ row }) => row.message?.id).filter((id) => typeof id === 'string')),
  };
}

// This repo's rules for how the cases run and score, which claude plugin eval doesn't require.
// cases is checkEvalCases's result; a case with a file that didn't read is skipped.
export function checkSuiteRules(root, cases, err) {
  const byModel = new Map(); // model -> the cases that pin it
  for (const c of cases) {
    if (unread(root, c)) continue;
    const s = settings(c);
    // Two-arm runs leave every tool_used grader on Skill out of the score unless it sets arm:
    // both, so a trigger case would pass even when the skill never fires (D27). Requiring the
    // grader keeps a deleted one from dropping the check without a message.
    if (s.tags.includes('trigger')) {
      const skill = c.graders.filter((g) => g.data.type === 'tool_used' && g.data.tool === 'Skill');
      if (!skill.length) err(`${c.dir}: a case tagged trigger needs a tool_used grader on Skill (repo rule)`);
      // checkGrader reports an arm value other than with-only or both.
      for (const g of skill) {
        if (g.data.arm === undefined || g.data.arm === 'with-only') err(`${g.file}: a trigger case's Skill grader needs arm: both; without it, two-arm runs leave it out of the score (repo rule)`);
      }
    }
    // Every case pins the agent under test, and all pin the same one, so the scores of a run
    // compare across cases and runs (D28). checkValues reports a model that isn't a string.
    if (s.model == null || s.model === '') {
      const where = c.prompt ? `${c.dir}/prompt.md: set model:` : `${c.dir}/case.yaml: set execution.model`;
      err(`${where} to pin the agent under test; without it, the model comes from --model, ANTHROPIC_MODEL or Claude Code's default (repo rule)`);
    } else if (typeof s.model === 'string') {
      byModel.set(s.model, [...(byModel.get(s.model) ?? []), c.name]);
      // A history case resumes a conversation recorded on one model; run on another, it tests
      // a mix of the two.
      const history = join(root, c.dir, 'history.jsonl');
      if (s.history === 'history.jsonl' && isPlainFile(history)) {
        for (const m of readRecording(history).models) {
          if (m !== s.model) err(`${c.dir}/history.jsonl: recorded on ${m}, but ${s.modelFile} pins ${s.model}; record it again on ${s.model} (repo rule)`);
        }
      }
    }
    // A case that needs a granted tool or its scaffold script is tagged needs-write, so one
    // command with --tag needs-write, --allow-tools and --scaffold runs all of them (D32).
    const gated = s.allowed.filter((t) => !allowedUngranted(t));
    const needs = [];
    if (gated.length) needs.push(`allowed_tools lists ${gated.join(', ')}, which only --allow-tools grants`);
    if (s.scaffold != null) needs.push('context.scaffold_script runs only with --scaffold');
    if (needs.length && !s.tags.includes('needs-write')) err(`${c.dir}: ${needs.join(', and ')}; tag it needs-write (repo rule)`);
    // A tool_used grader with min: 0, such as a max: 0 check, passes with zero calls, which is
    // all a run can make of a tool it doesn't grant. Listed in allowed_tools, the tool shows as
    // not granted in the progress output; a grader that requires it in the trace fails the case.
    for (const g of c.graders) {
      const { type, tool, min } = g.data;
      if (type !== 'tool_used' || typeof tool !== 'string' || READ_ONLY.has(tool) || min !== 0) continue;
      if (!s.allowed.some((t) => toolName(t) === tool)) err(`${g.file}: list ${tool} in allowed_tools, so that the progress output names it as not granted when --allow-tools leaves it out (repo rule)`);
      if (!c.graders.some((h) => requiresGrant(h, tool))) err(`${g.file}: with min: 0 this check passes when ${tool} isn't granted, with zero calls; add a tools-granted regex grader (target: trace) that requires "${tool}" (repo rule)`);
    }
  }
  if (byModel.size > 1) {
    // The most common model by count, the others by case name.
    const list = [...byModel].sort(([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : 1))
      .map(([m, names], i) => `${m} in ${i === 0 && names.length > 1 ? `${names.length} cases` : names.join(', ')}`);
    err(`evals: cases pin different models (${list.join('; ')}); pin one agent model in every case (repo rule)`);
  }
}

// ---------- history cases ----------
// A history case resumes a conversation recorded with scripts/eval/record-history.mjs
// (context.history_file). scripts/build.mjs keeps the skill text and the reference reads in the
// recording current, but never what the model said, and the case's graders were written against
// that recording. checkConversations keeps the three in step (findings 54, 55 and 56). It reads
// English recordings: one in another language needs its translated reply line and headings here
// (D3). In every case, it also holds the request text that a rubric quotes to the case's own
// (finding 50).
const FULL = 'Full prompt';
const SHORT = 'Short version';
const NEXT = 'What next?';
const SAVE = 'Save to file';

// Until step 1d records it again (D34), save-to-file's recording holds the old skill's search for
// AskUserQuestion and a repeated menu (lines 10-12). The recording checks only warn about it while
// the repeated menu's message is in it, so a copy cut by hand loses the exemption. Delete the entry
// in the commit that records the case again.
const KNOWN_STALE_RECORDINGS = { 'save-to-file': 'msg_011CgWkHqm4wmTHWit6mebGp' };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A heading as the method writes it: "### Full prompt".
const headingRe = (h) => new RegExp(`#+[ \\t]*${esc(h)}`);
// The text of the fenced block right after a heading, closed by a fence as long as its opener;
// null when no fenced block follows the heading.
const fencedAfter = (text, h) => text.match(new RegExp(`#+[ \\t]*${esc(h)}[^\\n]*\\n\\s*(\`{3,})[^\\n]*\\n([\\s\\S]*?)\\n\\1[ \\t]*(?:\\n|$)`))?.[2] ?? null;
// Quoted text and the text it is looked up in, in one form: NFKC, dashes as -, no ` or * (code
// and emphasis marks), curly quotes straight, each run of white space as one space, lowercase.
const normalizeQuote = (s) => s.normalize('NFKC').replace(/[\u{2010}-\u{2015}\u{2212}]/gu, '-').replace(/[`*]/g, '')
  .replace(/[\u{2018}\u{2019}]/gu, "'").replace(/[\u{201C}\u{201D}]/gu, '"').replace(/\s+/g, ' ').trim().toLowerCase();

// The options of a question round in the text format, as [{ q, letter, text, star }]. A line that
// starts with a number (after an optional heading mark or **) starts question q. On that line and
// the ones after it, "x) " at the start or after a space starts option x, so the options read
// whether each has a line of its own or they share one.
function roundOptions(round) {
  const options = [];
  let q = null;
  for (const line of round.split('\n')) {
    const m = line.match(/^\s*(?:#+\s*|\*\*)?(\d+)[.)]/);
    if (m) q = m[1];
    if (q === null) continue;
    const parts = (m ? line.slice(m[0].length) : line).split(/(?:^|\s)([a-z])\)\s/);
    for (let i = 1; i < parts.length; i += 2) options.push({ q, letter: parts[i], text: parts[i + 1], star: parts[i + 1].includes('★') });
  }
  return options;
}
// Whether a reply picks option q+letter, written as "2c" or "2: c".
const picks = (reply, { q, letter }) => new RegExp(`(?:^|[^0-9a-z])${q}\\s*:?\\s*${letter}\\b`, 'i').test(reply);
// The prompt a case sends: prompt.md's body, else execution.prompt in case.yaml.
const promptOf = (c) => c.prompt?.body || (isMapping(c.caseYaml?.execution) && typeof c.caseYaml.execution.prompt === 'string' ? c.caseYaml.execution.prompt.trim() : '');
// An llm grader's criteria: the criteria key, else the file's body, as the CLI reads them.
const criteriaOf = (g) => (g.data.type === 'llm' ? g.data.criteria ?? (g.body !== '' ? g.body : undefined) : undefined);
// The two ways a rubric quotes the user's request: in <original_prompt> tags, and as the first
// quoted string after "The user's whole request" (so "The user's whole request, in Spanish, was
// "..."" counts too). Straight or curly quotes and apostrophe.
const ORIGINAL_PROMPT = /<original_prompt>([\s\S]*?)<\/original_prompt>/g;
const WHOLE_REQUEST = /The user['\u{2019}]s whole request\b[^"\u{201C}\n]*["\u{201C}]([^"\u{201D}\n]+)["\u{201D}]/gu;

// This repo's checks on each case's conversation, as described above. contract is
// data/contract.json. The recording checks call warn instead of err for a case in
// KNOWN_STALE_RECORDINGS. A case with a file that didn't read is skipped.
export function checkConversations(root, cases, { err, warn, contract }) {
  const required = contract?.required ?? {};
  const replyLine = Array.isArray(required.replyLine) ? required.replyLine[0] : undefined;
  const missing = [FULL, SHORT, NEXT].filter((h) => !(required.headings ?? []).includes(h)).map((h) => `the heading "${h}"`);
  if (!(required.menu ?? []).includes(SAVE)) missing.push(`the menu entry "${SAVE}"`);
  if (typeof replyLine !== 'string' || replyLine === '') missing.push('a replyLine');
  if (missing.length) err(`data/contract.json: required lacks ${missing.join(', ')}, which the history checks in scripts/eval-cases.mjs look for; change the two together`);
  const full = headingRe(FULL);
  const next = headingRe(NEXT);
  const savePathRe = new RegExp(`${esc(NEXT)}[\\s\\S]*?${esc(SAVE)}[^\\n]*?\`([^\`\\n]+)\``);
  for (const c of cases) {
    if (unread(root, c)) continue;
    const s = settings(c);
    const file = join(root, c.dir, 'history.jsonl');
    const rec = s.history === 'history.jsonl' && isPlainFile(file) ? readRecording(file) : null;
    const reply = promptOf(c);

    // The request text a rubric quotes (finding 50), in every case. An llm judge sees only its
    // criteria and the reply, so a rubric that judges against the request quotes it, and the quote
    // must be the case's own, word for word: in prompt.md's body or, in a history case, in what the
    // user typed in the recording. Only the text inside the tags or quotes counts, so a gloss next
    // to it doesn't. A misquoted request is reported here only, not by the history quote rule below.
    const typed = [reply, ...(rec?.userTexts ?? [])];
    const source = rec ? 'prompt.md or a recorded user message' : 'prompt.md';
    const misquoted = new Set(); // grader file + "\0" + quote
    for (const g of c.graders) {
      const criteria = criteriaOf(g);
      if (typeof criteria !== 'string') continue;
      for (const m of criteria.matchAll(ORIGINAL_PROMPT)) {
        if (!typed.some((t) => t.includes(m[1].trim()))) err(`${g.file}: the <original_prompt> text isn't in ${source} word for word (repo rule)`);
      }
      for (const [, quote] of criteria.matchAll(WHOLE_REQUEST)) {
        if (typed.some((t) => t.includes(quote))) continue;
        err(`${g.file}: the quoted request "${quote}" isn't in ${source} word for word (repo rule)`);
        misquoted.add(`${g.file}\0${quote}`);
      }
    }
    if (rec === null || missing.length) continue;
    const where = `${c.dir}/history.jsonl`;
    const stale = Object.hasOwn(KNOWN_STALE_RECORDINGS, c.name) && rec.messageIds.has(KNOWN_STALE_RECORDINGS[c.name]);
    const report = stale ? (m) => warn(`${m} (known; step 1d re-records this case, D34)`) : err;

    // The recording against the method (finding 56). Eval runs have no AskUserQuestion, and
    // SKILL.md says to use the text format straight away then, not to search for the tool. A turn
    // ends with one message, a question round or the output with its menu, and the last assistant
    // row ends its turn: Claude Code's session-resume code compares that row's stop_reason with
    // end_turn to tell a finished turn from an interrupted one (read in its 2.1.318 and 2.1.319
    // code; what an eval run does with an interrupted turn wasn't tried).
    for (const line of rec.dialogLines) report(`${where}: line ${line} calls AskUserQuestion or searches for it; eval runs have no dialog tool, and SKILL.md says to use the text format straight away, so record it again (repo rule)`);
    const last = rec.assistantTexts.at(-1) ?? '';
    if (!last.includes(replyLine) && !(full.test(last) && next.test(last))) report(`${where}: the last recorded assistant text is neither a question round (with "${replyLine}") nor an output with its ${FULL} and ${NEXT} headings in one message; record it again (repo rule)`);
    const stop = rec.last?.row.message?.stop_reason;
    if (rec.last && stop !== 'end_turn') report(`${where}: line ${rec.last.line}, the last assistant row, has stop_reason ${stop ?? '(none)'}, not end_turn, so the recorded turn didn't end; record it again (repo rule)`);

    // What the rubrics quote (finding 54). In a history case, double quotes in an llm grader mark
    // text from the recorded conversation (what the model wrote and what the user typed) or from
    // prompt.md, compared in normalizeQuote's form. A quoted option of the last recorded question
    // round must be its ★ answer or one the reply in prompt.md picks.
    const said = normalizeQuote([...rec.assistantTexts, ...rec.userTexts, reply].join('\n'));
    const replied = normalizeQuote(reply);
    const round = rec.assistantTexts.findLast((t) => t.includes(replyLine));
    const options = round ? roundOptions(round).map((o) => ({ ...o, norm: normalizeQuote(o.text) })) : [];
    for (const g of c.graders) {
      const criteria = criteriaOf(g);
      if (typeof criteria !== 'string') continue;
      for (const m of criteria.matchAll(/"([^"\n]+)"|\u{201C}([^\u{201D}\n]+)\u{201D}/gu)) {
        const quote = m[1] ?? m[2];
        if (misquoted.has(`${g.file}\0${quote}`)) continue;
        const q = normalizeQuote(quote);
        if (!said.includes(q)) {
          err(`${g.file}: quotes "${quote}", which isn't in the recorded conversation or prompt.md; in a history case's rubric, double quotes mark verbatim text (repo rule)`);
          continue;
        }
        if (replied.includes(q)) continue;
        const hits = options.filter((o) => o.norm.includes(q));
        if (hits.length && !hits.some((o) => o.star || picks(reply, o))) err(`${g.file}: quotes option ${hits.map((o) => `${o.q}${o.letter}`).join(', ')} ("${quote}"), which is neither the ★ answer nor one the reply in prompt.md picks (repo rule)`);
      }
    }

    // A regex grader on the file that the recorded menu offers to save (finding 55) must tell the
    // recorded Full prompt from the Short version: a contains pattern matches the Full prompt and
    // not the Short version, and a not_contains pattern doesn't match the Full prompt (count:N
    // isn't checked). A case with a scaffold_script is skipped, since the scaffold can put other
    // text at that path; so are graders on other paths.
    if (s.scaffold != null) continue;
    const output = rec.assistantTexts.findLast((t) => full.test(t));
    const savePath = output?.match(savePathRe)?.[1];
    const fileGraders = c.graders.filter((g) => g.data.type === 'regex' && isMapping(g.data.target) && g.data.target.source === 'file');
    if (fileGraders.length && savePath === undefined) err(`${c.dir}: ${fileGraders.map((g) => `${g.name}.md`).join(', ')} read a saved file, but the recording shows no output whose ${NEXT} menu names a save path to check them against (repo rule)`);
    for (const g of fileGraders) {
      if (savePath === undefined || g.data.target.path !== savePath) continue;
      const fullPrompt = fencedAfter(output, FULL);
      if (fullPrompt === null) {
        err(`${g.file}: reads the saved file, but the recorded output has no fenced ${FULL} to check it against (repo rule)`);
        continue;
      }
      const pattern = g.data.pattern ?? (g.body !== '' ? g.body : undefined);
      const flags = g.data.flags ?? '';
      if (typeof pattern !== 'string' || typeof flags !== 'string' || compileError(pattern, flags)) continue; // checkGrader reports it
      const matches = (text) => new RegExp(pattern, flags).test(text);
      const match = g.data.match ?? 'contains';
      const shortVersion = fencedAfter(output, SHORT);
      if (match === 'not_contains' && matches(fullPrompt)) err(`${g.file}: not_contains pattern matches the recorded ${FULL}, so a correct save would fail; derive it again from history.jsonl (repo rule)`);
      if (match === 'contains' && !matches(fullPrompt)) err(`${g.file}: pattern doesn't match the recorded ${FULL}, so a correct save would fail; derive it again from history.jsonl (repo rule)`);
      if (match === 'contains' && shortVersion !== null && matches(shortVersion)) err(`${g.file}: pattern also matches the recorded ${SHORT}, so it can't tell the two apart (repo rule)`);
    }
  }
}
