// Checks the eval cases under evals/ for free, before a billed `claude plugin eval` run: the
// keys, values and referenced files of each case.yaml, prompt.md and graders/*.md. claude plugin
// eval drops an unknown case.yaml key and skips a grader file without front matter, both without
// a message; a missing baseline_file or a pattern that doesn't compile fails only after the
// billed agent run; and `claude plugin validate` doesn't read evals/. checkSuiteRules adds this
// repo's rules for how the cases run and score. scripts/validate.mjs runs both. Zero dependencies.
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
    if ((ch === "'" || ch === '"') && cur.trim() === '') q = ch;
    else if ('[]{}'.includes(ch)) throw new Error(`${where}: nested [ ] or { } isn't supported; quote the entry: ${v}`);
    // YAML reads the rest of the line, closing bracket included, as a comment.
    else if (ch === '#' && (cur === '' || /\s$/.test(cur))) throw new Error(`${where}: a # comment inside ${v[0]} ${close}: ${v}`);
    if (ch === ',') { entries.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (q || i >= v.length) throw new Error(`${where}: ${v[0]} without its closing ${close} on the same line: ${v}`);
  if (!/^(?: +#.*)?$/.test(v.slice(i + 1))) throw new Error(`${where}: text after the closing ${close}: ${v}`);
  if (cur.trim() !== '') entries.push(cur);
  else if (!entries.length) return close === ']' ? [] : {};
  if (entries.some((e) => e.trim() === '')) throw new Error(`${where}: an empty entry in ${v[0]} ${close}: ${v}`);
  if (close === ']') return entries.map((e) => scalar(e, where));
  const map = {};
  for (const e of entries) {
    const kv = e.trim().match(/^([A-Za-z_][\w-]*): +(\S.*)$/);
    if (!kv) throw new Error(`${where}: write each { } entry as key: value: ${e.trim()}`);
    checkKey(kv[1], where);
    if (Object.hasOwn(map, kv[1])) throw new Error(`${where}: duplicate key ${kv[1]}`);
    set(map, kv[1], scalar(kv[2], where));
  }
  return map;
}

function scalar(raw, where) {
  const v = raw.trim();
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
// or all of them (+).
function block(lines, style, chomp, where) {
  let end = lines.length;
  while (end > 0 && blank(lines[end - 1])) end--;
  const trailing = '\n'.repeat(lines.length - end);
  const body = lines.slice(0, end);
  if (!body.length) return chomp === '+' ? trailing : '';
  const first = body.findIndex((l) => !blank(l));
  const n = spaces(body[first]);
  if (body.slice(0, first).some((l) => l.length > n)) throw new Error(`${where}: a blank line before the block's first line has more spaces than that line`);
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
    const rest = (m[2] ?? '').trim();
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
    if (cy) {
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
// over the same key in case.yaml.
function settings(c) {
  const fm = c.prompt?.data ?? {};
  const cy = c.caseYaml ?? {};
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return { tags: strings(fm.tags ?? cy.tags) };
}

// This repo's rules for how the cases run and score, which claude plugin eval doesn't require.
// cases is checkEvalCases's result; a case with a file that didn't read is skipped.
export function checkSuiteRules(root, cases, err) {
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
  }
}
