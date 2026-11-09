#!/usr/bin/env node
// Validates the repository: Agent Skill format and portability rules, the shared
// output contract, size budgets, plugin-root hygiene, data files, manifests,
// eval cases (the keys, values and referenced files of case.yaml, prompt.md and
// graders/*.md, this repo's rules for how the cases run and score, the history cases'
// recordings, and what graders quote from a case's request or recording, see
// scripts/eval-cases.mjs, and the recorder's private-data scan of every committed
// history.jsonl) and generated-file freshness. Zero dependencies (Node >= 22.19).
//
//   node scripts/validate.mjs        # exit 1 on any error; warnings are printed
//
// The rules come from the platforms' documentation (see docs/sources.md):
// claude.ai and the Skills API reject unknown frontmatter keys, Codex rejects
// `compatibility`, Claude Code substitutes $ARGUMENTS/$N/${CLAUDE_*}/!`cmd`
// inside skill text, and a plugin root must not hold package.json + lockfile,
// bin/, CLAUDE.md or .mcp.json. The eval-case rules follow claude plugin eval's code
// (read in versions 2.1.312, 2.1.317, 2.1.318 and 2.1.319) and its documentation;
// messages that end in "(repo rule)" are stricter than the CLI.

import { readFileSync, readdirSync, statSync, lstatSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, basename } from 'node:path';
import { buildAll, root, normalize, readJson, splitFrontmatter, OS_JUNK, KNOWLEDGE_ORDER } from './build.mjs';
import { checkEvalCases, checkSuiteRules, checkConversations } from './eval-cases.mjs';
import { scanText, publicText } from './eval/sanitize.mjs';

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const read = (p) => normalize(readFileSync(join(root, p), 'utf8'));
const exists = (p) => existsSync(join(root, p));
const chars = (s) => [...s].length;
const isMapping = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The end of every run: the warnings, then the errors, if any, with exit 1.
function report() {
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`\n${errors.length} error(s)`);
    process.exit(1);
  }
}
// A backstop for a throw that the checks below don't foresee: it ends the error list with one
// line instead of a stack trace, and keeps the errors found before it, which a stack trace lost.
process.on('uncaughtException', (e) => {
  err(`validate.mjs stopped: ${e?.message ?? e}; the checks after this point didn't run`);
  report();
});

// The JSON files validate.mjs reads, each an object. One that doesn't parse (a merge-conflict
// marker, a trailing comma) or holds something else is reported with its name, and the checks
// that need it are skipped: it returns undefined.
function readObject(p) {
  let v;
  try { v = readJson(p); } catch (e) { err(e.message); return undefined; }
  if (!isMapping(v)) { err(`${p}: must hold a JSON object`); return undefined; }
  return v;
}

const contract = readObject('data/contract.json');
// The budgets, each checked before it is used: one missing or of the wrong type turned its check
// off without a word, or stopped validate.mjs. B has only the good ones, so a bad one's check is
// skipped after its error.
const B = {};
const BUDGET_NUMBERS = ['skillBodyMaxChars', 'skillBodyMaxLines', 'skillKeySectionsWithinChars', 'universalCoreMaxChars',
  'descriptionMaxChars', 'descriptionHardMaxChars', 'skillFolderMaxFiles', 'skillFolderMaxBytes', 'skillFileMaxBytes'];
if (contract && !isMapping(contract.budgets)) err('data/contract.json: budgets must map each budget to its limit');
else if (contract) {
  for (const k of BUDGET_NUMBERS) {
    if (Number.isFinite(contract.budgets[k]) && contract.budgets[k] >= 0) B[k] = contract.budgets[k];
    else err(`data/contract.json: budgets.${k} must be a number of 0 or more`);
  }
  const sections = contract.budgets.skillKeySections;
  if (Array.isArray(sections) && sections.every((s) => typeof s === 'string' && s !== '')) B.skillKeySections = sections;
  else err('data/contract.json: budgets.skillKeySections must be a list of headings');
}
const SKILL_DIR = 'skills/prompt-engine';
const SKILL = `${SKILL_DIR}/SKILL.md`;

// ---------- frontmatter ----------
// The block ends where Claude Code ends it too: at a line of exactly "---", with no other "---"
// before it (splitFrontmatter in build.mjs, which build.mjs and version.mjs use as well). In it,
// a small YAML subset that strict YAML parsers and Claude Code read the same way:
// `key: value` lines, one level of `  key: value` lines under a bare `key:` line, no
// duplicate keys, and every value either a "double-quoted string" with no " or \ inside,
// or a single bare word. Single-quoted values are valid YAML but refused, to keep one
// form (scripts/version.mjs writes the version in double quotes). No tabs outside a quoted
// string, and no control characters.
// After a frontmatter error, the other checks read the body from the line after the first line
// that starts with "---" (past the opening one), so that one error doesn't bring others that
// say nothing new.
const BODY_AFTER_ERROR = /^---[^\n]*\n[\s\S]*?\n---[^\n]*(?:\n|$)/;
const QUOTED = /^"[^"\\]*"$/;
const BARE = /^[A-Za-z][\w./+-]*$/;
// Words that don't read as strings, refused as values and as keys: YAML 1.1 reads the first
// nine as booleans or null, and the yaml package's YAML 1.1 mode reads e1, E-2 and the like
// as numbers.
const NOT_A_STRING = /^(?:y|n|yes|no|true|false|on|off|null|e[-+]?\d+)$/i;
// A nested key must start with a letter: 0x1, 012 or 1e5 read as numbers.
const KEY = /^[A-Za-z][\w-]*$/;
// Control characters, refused anywhere. In a quoted string, js-yaml and PyYAML read a CR as a
// line break and refuse the other C0 ones; PyYAML also reads U+0085 as a line break and refuses
// DEL, the other C1 ones, U+FFFE and U+FFFF.
const CONTROL = /[\x00-\x08\x0B-\x1F\x7F-\x9F\uFFFE\uFFFF]/;
// A line in a message: a JSON string, with the characters JSON.stringify leaves as they are (DEL,
// the C1 range, U+FFFE and U+FFFF) escaped too, so that each one shows.
const shown = (line) => JSON.stringify(line).replace(/[\x7F-\x9F\uFFFE\uFFFF]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
function scalar(value, line) {
  if (QUOTED.test(value)) return value.slice(1, -1);
  if (BARE.test(value) && !NOT_A_STRING.test(value)) return value;
  throw new Error(`frontmatter value must be a "double-quoted string" without " or \\ inside, or a single bare word: ${line}`);
}
export function parseFrontmatter(text) {
  const split = splitFrontmatter(text);
  if (!split) return { data: null, body: text };
  // Maps without a prototype, so that a __proto__ key is an ordinary key, reported as not portable,
  // instead of going to Object.prototype's setter (which drops it, or makes its mapping the prototype).
  const data = Object.create(null);
  let parent = null;
  for (const line of split.front.split('\n')) {
    if (/^ *$/.test(line)) continue;
    if (CONTROL.test(line)) throw new Error(`frontmatter must not contain control characters: ${shown(line)}`);
    // PyYAML refuses a tab between a key and its value, at the end of a line and on a blank line.
    if (line.replace(/"[^"\\]*"/, '').includes('\t')) throw new Error(`frontmatter must not contain tabs outside a "double-quoted string": ${shown(line)}`);
    const nested = line.match(/^ {2}([\w-]+): +(.*?) *$/);
    const top = line.match(/^([\w-]+):(?: +(.*?))? *$/);
    if (nested && parent) {
      if (!KEY.test(nested[1]) || NOT_A_STRING.test(nested[1])) throw new Error(`frontmatter key must start with a letter and not read as a YAML boolean, null or number: ${line}`);
      if (Object.hasOwn(data[parent], nested[1])) throw new Error(`duplicate frontmatter key: ${parent}.${nested[1]}`);
      data[parent][nested[1]] = scalar(nested[2], line);
    } else if (top) {
      if (Object.hasOwn(data, top[1])) throw new Error(`duplicate frontmatter key: ${top[1]}`);
      if (!top[2]) { data[top[1]] = Object.create(null); parent = top[1]; }
      else { data[top[1]] = scalar(top[2], line); parent = null; }
    } else {
      throw new Error(`unsupported frontmatter line: ${line}`);
    }
  }
  return { data, body: split.body };
}

const skillText = read(SKILL);
// read() drops a leading byte-order mark, and Claude Code's frontmatter reader strips one too (read
// in 2.1.319's code), but skill-creator's quick_validate.py reads the file as it is and refuses one
// that doesn't start with "---". Whether claude.ai and the Skills API accept one wasn't checked.
if (readFileSync(join(root, SKILL), 'utf8').charCodeAt(0) === 0xfeff) err(`${SKILL}: starts with a byte-order mark, which some skill validators refuse; save it as UTF-8 without one`);
let front;
let skillBody;
let frontError = false;
try {
  ({ data: front, body: skillBody } = parseFrontmatter(skillText));
} catch (e) {
  // Report only the parse error: the field checks below would fail after it for no new reason.
  err(`${SKILL}: ${e.message}`);
  frontError = true;
  front = null;
  skillBody = skillText.replace(BODY_AFTER_ERROR, '');
}
if (!front) {
  if (!frontError) err(`${SKILL}: missing YAML frontmatter`);
} else {
  const allowed = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata']);
  for (const k of Object.keys(front)) {
    if (!allowed.has(k)) err(`${SKILL}: frontmatter key "${k}" is not portable (claude.ai/Skills API reject it; allowed: ${[...allowed].join(', ')})`);
  }
  const name = front.name ?? '';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) err(`${SKILL}: name "${name}" must be 1-64 chars of a-z, 0-9 and single hyphens`);
  if (name !== basename(SKILL_DIR)) err(`${SKILL}: name "${name}" must equal the folder name "${basename(SKILL_DIR)}"`);
  if (/anthropic|claude/.test(name) || name === 'synced') err(`${SKILL}: name "${name}" uses a reserved word`);
  const desc = front.description ?? '';
  if (typeof desc !== 'string' || !desc.trim()) err(`${SKILL}: description is required`);
  else {
    if (/[<>]/.test(desc)) err(`${SKILL}: description must not contain < or >`);
    if (/^[|>]/.test(desc)) err(`${SKILL}: description must be a single-line string, not a YAML block scalar`);
    if (chars(desc) > B.descriptionHardMaxChars) err(`${SKILL}: description is ${chars(desc)} chars (hard limit ${B.descriptionHardMaxChars})`);
    if (chars(desc) > B.descriptionMaxChars) err(`${SKILL}: description is ${chars(desc)} chars (current cap ${B.descriptionMaxChars}; see data/contract.json)`);
  }
  if (front.license !== 'MIT') err(`${SKILL}: license should be MIT`);
  if (front['allowed-tools'] !== undefined && front['allowed-tools'] !== 'Read') err(`${SKILL}: allowed-tools should be exactly "Read"`);
  const meta = front.metadata ?? {};
  if (typeof meta !== 'object') err(`${SKILL}: metadata must be a mapping`);
  if (!/^\d+\.\d+\.\d+$/.test(meta.version ?? '')) err(`${SKILL}: metadata.version must be semver`);
}

// ---------- skill folder ----------
const walk = (dir) => readdirSync(join(root, dir)).filter((f) => !OS_JUNK.has(f)).flatMap((f) => {
  const p = `${dir}/${f}`;
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});
const skillFiles = walk(SKILL_DIR);
if (skillFiles.length > B.skillFolderMaxFiles) err(`${SKILL_DIR}: ${skillFiles.length} files (max ${B.skillFolderMaxFiles})`);
let total = 0;
for (const f of skillFiles) {
  const size = statSync(join(root, f)).size;
  total += size;
  if (size > B.skillFileMaxBytes) err(`${f}: ${size} bytes (max ${B.skillFileMaxBytes} per file)`);
  if (!f.endsWith('.md')) err(`${f}: only Markdown files belong in the skill folder (scripts behave differently on claude.ai, the API and Claude Code)`);
  if (basename(f) === 'SKILL.md' && f !== SKILL) err(`${f}: a skill must contain exactly one SKILL.md`);
}
if (total > B.skillFolderMaxBytes) err(`${SKILL_DIR}: ${total} bytes (max ${B.skillFolderMaxBytes})`);

// Claude Code substitutes these inside skill text; they would corrupt the skill there.
const SUBSTITUTIONS = [
  [/\$ARGUMENTS/, '$ARGUMENTS'], [/\$\d/, '$N (e.g. "$1")'], [/\$\{CLAUDE_/, '${CLAUDE_...}'],
  [/(^|\s)!`/m, '!`command`'], [/```!/, '```! fence'],
];
for (const f of skillFiles) {
  const t = read(f);
  for (const [re, label] of SUBSTITUTIONS) if (re.test(t)) err(`${f}: contains ${label}, which Claude Code substitutes in skill text`);
}

// Instruction text the models read directly: every Markdown file in the skill folder (SKILL.md and
// the references, which the skill reads as instructions and build.mjs copies into the knowledge
// file and the MCP server's content) and the universal core. Lint rules marked selfCheck in
// data/lint-rules.json (pressure words, requests to expose reasoning) must not occur in them.
const lint = readObject('data/lint-rules.json');
const lintRulesOk = Array.isArray(lint?.rules) && lint.rules.every(isMapping);
if (lint && !lintRulesOk) err('data/lint-rules.json: rules must be a list of rules, each an object');
// A rule whose pattern doesn't compile is reported here and skipped below, so a broken
// self-check rule can't stop validation before the error list is printed.
const compiles = (r) => {
  try { new RegExp(r.pattern, r.flags); return true; } catch (e) { err(`data/lint-rules.json ${r.id}: bad pattern (${e.message})`); return false; }
};
const selfCheckRules = (lintRulesOk ? lint.rules : []).filter(compiles).filter((r) => r.selfCheck);
const INSTRUCTION_FILES = [...skillFiles.filter((f) => f.endsWith('.md')), 'universal/prompt-engine.md'];
// Text in `code spans` names a pattern, often to warn against it; it is not an instruction.
// Double-quoted text and fenced example prompts are still checked (D11).
const unquoted = (t) => t.replace(/`[^`\n]*`/g, ' ');
for (const f of INSTRUCTION_FILES) {
  const t = unquoted(read(f));
  for (const r of selfCheckRules) {
    const m = t.match(new RegExp(r.pattern, r.flags));
    if (m) err(`${f}: "${m[0]}" (${r.id}): ${r.message}`);
  }
}

// Budgets
if (chars(skillBody) > B.skillBodyMaxChars) err(`${SKILL}: body is ${chars(skillBody)} chars (max ${B.skillBodyMaxChars})`);
if (skillBody.split('\n').length > B.skillBodyMaxLines) err(`${SKILL}: body is ${skillBody.split('\n').length} lines (max ${B.skillBodyMaxLines})`);
for (const h of B.skillKeySections ?? []) {
  const i = skillBody.indexOf(h);
  if (i < 0) err(`${SKILL}: missing section "${h}"`);
  else if (i > B.skillKeySectionsWithinChars) err(`${SKILL}: section "${h}" starts at char ${i}; keep it within the first ${B.skillKeySectionsWithinChars} so it survives context compaction`);
}
const core = read('universal/prompt-engine.md');
if (chars(core) > B.universalCoreMaxChars) err(`universal/prompt-engine.md: ${chars(core)} chars (max ${B.universalCoreMaxChars})`);

// References: every file is linked from SKILL.md, every link resolves, one level deep.
const linked = new Set([...skillBody.matchAll(/references\/([\w-]+\.md)/g)].map((m) => m[1]));
const refFiles = readdirSync(join(root, SKILL_DIR, 'references')).filter((f) => !OS_JUNK.has(f));
for (const f of refFiles) {
  if (statSync(join(root, SKILL_DIR, 'references', f)).isDirectory()) err(`${SKILL_DIR}/references/${f}: keep references one level deep`);
  else if (!linked.has(f)) err(`${SKILL_DIR}/references/${f}: not linked from SKILL.md`);
}
for (const f of linked) if (!refFiles.includes(f)) err(`${SKILL}: links references/${f}, which does not exist`);
// build.mjs builds the universal knowledge file and the MCP server's content from KNOWLEDGE_ORDER only.
const ordered = new Set(KNOWLEDGE_ORDER.map((k) => `${k}.md`));
for (const f of refFiles) if (f.endsWith('.md') && !ordered.has(f)) err(`${SKILL_DIR}/references/${f}: add "${f.slice(0, -3)}" to KNOWLEDGE_ORDER in scripts/build.mjs, or the universal knowledge file and the MCP server won't include it`);
for (const k of KNOWLEDGE_ORDER) if (!refFiles.includes(`${k}.md`)) err(`scripts/build.mjs: KNOWLEDGE_ORDER lists ${k}, but references/${k}.md does not exist`);

// ---------- output contract ----------
// A contract heading counts only in one of two forms: a ## to #### heading (on its own line or
// right after a list marker) whose text is followed by a colon or the end of the line, or a
// **bold** label that starts a list item. So "Score anchors" doesn't count as "Score", and
// neither would "### Score (0-5)". The other contract strings may appear anywhere in the text.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headingRe = (h) => new RegExp(`(^|\\n)[ \\t]*(?:(?:[-*]|\\d+\\.)?[ \\t]*#{2,4}[ \\t]+${esc(h)}[ \\t]*(?::|\\n|$)|(?:[-*]|\\d+\\.)[ \\t]+\\*\\*${esc(h)}\\*\\*)`);
// The contract's own shape first: each group in required is a list of strings, and each artifact
// lists groups that required defines. A misspelled group name read as an empty list, and a list
// written as a string as its single characters, so either turned checks off without a message.
if (contract && !isMapping(contract.required)) err('data/contract.json: required must map each group name to a list of strings');
if (contract && !isMapping(contract.artifacts)) err('data/contract.json: artifacts must map each file to a list of group names from required');
const required = isMapping(contract?.required) ? contract.required : {};
const isGroup = (g) => typeof g === 'string' && Object.hasOwn(required, g);
const strings = (g) => (isGroup(g) && Array.isArray(required[g]) ? required[g].filter((s) => typeof s === 'string' && s !== '') : []);
for (const [g, list] of Object.entries(required)) {
  if (!Array.isArray(list) || !list.length || list.some((s) => typeof s !== 'string' || s === '')) err(`data/contract.json: required.${g} must be a list of non-empty strings`);
}
for (const [file, groups] of Object.entries(isMapping(contract?.artifacts) ? contract.artifacts : {})) {
  if (!Array.isArray(groups) || !groups.length) { err(`data/contract.json: artifacts[${JSON.stringify(file)}] must be a list of group names from required`); continue; }
  for (const g of groups) if (!isGroup(g)) err(`data/contract.json: artifacts[${JSON.stringify(file)}] lists ${JSON.stringify(g)}, which isn't a group in required (${Object.keys(required).join(', ')})`);
  if (!exists(file)) { err(`${file}: listed in data/contract.json but missing`); continue; }
  const t = read(file);
  for (const g of groups) for (const s of strings(g)) {
    if (g === 'headings') {
      if (!headingRe(s).test(t)) err(`${file}: missing contract heading ${JSON.stringify(s)} (a ## to #### heading followed by a colon or the end of the line, or a **bold** label that starts a list item)`);
    } else if (!t.includes(s)) err(`${file}: missing contract string ${JSON.stringify(s)} (${g})`);
  }
}

// ---------- plugin root hygiene ----------
// With marketplace source "./", the repo root is the plugin root. These entries would load
// as plugin components, make Claude Code run npm ci on install, or make claude.ai refuse the
// plugin. A root CLAUDE.md also draws a `claude plugin validate` warning, and Claude Code can
// load it as project memory in a user's session (see MEMORY_FILES below).
// Names here and below are compared without letter case: Claude Code opens these files and
// folders by path, and on macOS and Windows, where most users run it, a look for CLAUDE.md or
// commands/ finds claude.md or Commands/. existsSync followed each platform's own rule, so Linux,
// where CI runs, let them through.
const FORBIDDEN_ROOT = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'node_modules', 'bin',
  'CLAUDE.md', '.mcp.json', '.lsp.json', 'commands', 'agents', 'hooks', 'settings.json', 'SKILL.md',
  'output-styles', 'monitors', 'workflows', 'themes'];
const anyCase = (names) => new Set(names.map((n) => n.toLowerCase()));
const FORBIDDEN_ROOT_ANY_CASE = anyCase(FORBIDDEN_ROOT);
for (const f of readdirSync(root)) if (FORBIDDEN_ROOT_ANY_CASE.has(f.toLowerCase())) err(`${f}: not allowed at the repo root, which is also the plugin root`);

// Every committed file reaches each Claude Code install twice: in the marketplace clone
// and in the plugin cache. The rules below read the tracked files from git, because
// untracked files (build output, a maintainer's own notes) never ship. Without git, or
// in a copy without .git, they are skipped.
function trackedFiles() {
  if (!exists('.git')) return null; // a folder, or the file a worktree has instead
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
  } catch {
    return null; // no git on PATH, or not a work tree
  }
}
const tracked = trackedFiles();

// By Claude Code's documentation and code, it loads project memory (CLAUDE.md,
// CLAUDE.local.md, AGENTS.md, files under .claude/) from each folder between a session's
// working directory and a file it reads. So in a session started in a folder that contains
// the plugin cache (as the home folder contains ~/.claude), the skill's first Read of a
// reference can load such a file from the plugin root into the user's context. A run with
// Claude Code 2.1.319 on 2026-11-07 showed it for .claude/CLAUDE.md; for AGENTS.md and
// CLAUDE.local.md it rests on the documentation and code, not on a run. A root CLAUDE.md
// is refused above. Tracked files only: a maintainer's untracked CLAUDE.local.md passes
// here (`claude plugin validate . --strict` still flags one on disk).
const MEMORY_FILES = anyCase(['AGENTS.md', 'CLAUDE.local.md']);
for (const f of tracked ?? []) {
  if (MEMORY_FILES.has(f.toLowerCase())) err(`${f}: don't commit it at the plugin root: Claude Code can load it as project memory in a user's session`);
}
// The same walk passes through skills/, the skill folder and its references/ folder on the way to a
// reference. The skill zip is built from the folder on disk, so there a file is refused whether or
// not git tracks it.
const MEMORY_NAMES = anyCase(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude']);
for (const dir of ['skills', SKILL_DIR, `${SKILL_DIR}/references`]) {
  for (const f of exists(dir) ? readdirSync(join(root, dir)) : []) {
    if (MEMORY_NAMES.has(f.toLowerCase())) err(`${dir}/${f}: don't keep it in a folder the skill reads from: Claude Code can load it as project memory in a user's session`);
  }
}

// Anthropic's plugin directory holds a plugin version for a reviewer when the plugin folder
// has more than 512 files, a file that isn't an image or font and isn't under 256 KiB, or a
// binary file other than a PNG, JPEG, GIF or WebP image or a font
// (claude.com/docs/plugins/pre-submission-checklist, "Files in the plugin folder").
// `claude plugin validate . --strict --profile directory` reported none of the three in a
// test copy (Claude Code 2.1.319). Warnings until the plugin is to be listed (D40).
const LISTED_IN_DIRECTORY = false; // set to true once the plugin is to be listed: the rules then fail
const directoryRule = LISTED_IN_DIRECTORY ? err : warn;
const IMAGE_OR_FONT = /\.(png|jpe?g|gif|webp|woff2?|ttf|otf)$/i;
const DIRECTORY_MAX_FILES = 512;
const DIRECTORY_MAX_BYTES = 256 * 1024; // a file must stay under this
function hasNulByte(file) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8000); // git's own text-or-binary test reads the first 8,000 bytes
    return buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).includes(0);
  } finally {
    closeSync(fd);
  }
}
if (tracked) {
  if (tracked.length > DIRECTORY_MAX_FILES) directoryRule(`the plugin folder (the repository root) has ${tracked.length} tracked files; Anthropic's plugin directory holds a plugin with more than ${DIRECTORY_MAX_FILES} for a reviewer`);
  for (const f of tracked) {
    let st;
    try { st = lstatSync(join(root, f)); } catch { continue; } // deleted, and the deletion not yet staged
    if (!st.isFile() || IMAGE_OR_FONT.test(f)) continue;
    if (st.size >= DIRECTORY_MAX_BYTES) directoryRule(`${f}: ${st.size} bytes; Anthropic's plugin directory holds a file of 256 KiB or more that isn't an image or font for a reviewer`);
    if (hasNulByte(join(root, f))) directoryRule(`${f}: a binary file; Anthropic's plugin directory holds a binary file other than a PNG, JPEG, GIF or WebP image or a font for a reviewer`);
  }
}

// ---------- manifests ----------
const plugin = readObject('.claude-plugin/plugin.json');
const market = readObject('.claude-plugin/marketplace.json');
if (plugin) {
  if (plugin.name !== 'prompt-engine') err('.claude-plugin/plugin.json: name must be prompt-engine');
  if (!/^\d+\.\d+\.\d+$/.test(plugin.version ?? '')) err('.claude-plugin/plugin.json: version must be semver');
}
const plugins = market?.plugins ?? [];
if (!Array.isArray(plugins) || !plugins.every(isMapping)) err('.claude-plugin/marketplace.json: plugins must be a list of plugin entries');
else if (market) {
  const entry = plugins.find((p) => p.name === (plugin?.name ?? 'prompt-engine'));
  if (!entry) err('.claude-plugin/marketplace.json: no entry for prompt-engine');
  else {
    if (entry.source !== './') err('.claude-plugin/marketplace.json: prompt-engine source should be "./"');
    if (entry.version) err('.claude-plugin/marketplace.json: set version only in plugin.json (it silently wins)');
  }
}
// The versions kept in step with plugin.json's, compared only when plugin.json was read.
const version = plugin?.version;
const differs = (v) => plugin !== undefined && v !== version;
if (front?.metadata?.version && differs(front.metadata.version)) err(`${SKILL}: metadata.version ${front.metadata.version} != plugin.json ${version}`);
if (exists('mcp/package.json')) {
  const pkg = readObject('mcp/package.json');
  if (pkg && differs(pkg.version)) err(`mcp/package.json: version ${pkg.version} != plugin.json ${version}`);
  const server = exists('mcp/server.json') ? readObject('mcp/server.json') : undefined;
  if (server) {
    if (pkg && pkg.mcpName !== server.name) err(`mcp/package.json mcpName "${pkg.mcpName}" != server.json name "${server.name}"`);
    if (differs(server.version)) err(`mcp/server.json: version ${server.version} != ${version}`);
    if (chars(String(server.description ?? '')) > 100) err('mcp/server.json: description must be 100 characters or fewer');
    const packages = server.packages ?? [];
    if (!Array.isArray(packages) || !packages.every(isMapping)) err('mcp/server.json: packages must be a list of package entries');
    else for (const p of packages) if (p.version && differs(p.version)) err(`mcp/server.json: package ${p.identifier} version ${p.version} != ${version}`);
  }
  const mf = exists('mcp/manifest.json') ? readObject('mcp/manifest.json') : undefined;
  if (mf && differs(mf.version)) err(`mcp/manifest.json: version ${mf.version} != ${version}`);
}

// ---------- data ----------
// Each entry of data/media-targets.json has the keys build.mjs renders into
// references/media-targets.md and no others, so that a misspelled key is named instead of
// rendered as "undefined" or left out: an id (the MCP server's check also reads it as a tool name)
// that no other entry has, a name and a kind, text fields that are strings, a status, https
// sources and a date. An entry without an id is named by its place in the list.
const MEDIA_TEXT = ['prompt_style', 'exclusions', 'settings', 'references', 'text', 'notes'];
const MEDIA_KEYS = new Set(['id', 'name', 'kind', ...MEDIA_TEXT, 'status', 'sources', 'last_verified']);
const media = readObject('data/media-targets.json');
if (media && !Array.isArray(media.targets)) err('data/media-targets.json: targets must be a list of entries');
const mediaIds = new Set();
(Array.isArray(media?.targets) ? media.targets : []).forEach((t, i) => {
  if (!isMapping(t)) { err(`data/media-targets.json targets[${i}]: must be an object`); return; }
  const at = `data/media-targets.json ${typeof t.id === 'string' && t.id.trim() ? t.id : `targets[${i}]`}`;
  for (const k of ['id', 'name', 'kind']) if (typeof t[k] !== 'string' || !t[k].trim()) err(`${at}: ${k} must be a non-empty string`);
  if (typeof t.id === 'string' && mediaIds.has(t.id)) err(`${at}: another entry has this id too`);
  mediaIds.add(t.id);
  for (const k of Object.keys(t)) if (!MEDIA_KEYS.has(k)) err(`${at}: unknown key "${k}"`);
  for (const k of MEDIA_TEXT) if (t[k] !== undefined && typeof t[k] !== 'string') err(`${at}: ${k} must be a string`);
  if (!['verified', 'secondary', 'unverified'].includes(t.status)) err(`${at}: bad status "${t.status}"`);
  if (!Array.isArray(t.sources) || !t.sources.length || t.sources.some((s) => !/^https:\/\//.test(s))) err(`${at}: needs https sources`);
  const d = t.last_verified ?? '';
  const ms = Date.parse(`${d}T00:00:00Z`);
  // The round trip catches dates that Date.parse rolls over, such as 2024-02-30.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== d) err(`${at}: last_verified must be a real YYYY-MM-DD date`);
  // One day of slack, for dates written in a time zone ahead of UTC.
  else if (ms > Date.now() + 864e5) err(`${at}: last_verified ${d} is in the future`);
});

// ---------- eval cases ----------
// scripts/eval-cases.mjs checks each case's case.yaml, prompt.md and graders/*.md, and returns
// every case folder it found, including those whose files didn't parse. checkSuiteRules then
// applies this repo's rules for how the cases run and score, and checkConversations checks each
// history case's recording against the method and its graders against the recording, and the
// request text that any case's rubric quotes against the case.
const cases = checkEvalCases(root, err);
checkSuiteRules(root, cases, err);
// It reads the contract's headings, menu and reply line: skipped when data/contract.json didn't read.
if (contract) checkConversations(root, cases, { err, contract });
// A recorded history is public once committed: the recorder's scan runs on each one (D9).
// No machine patterns here, since this machine's home folder and name say nothing about
// the one that recorded the file. The messages name the line and kind, never the match,
// because CI logs are public.
const histories = cases.map((c) => `${c.dir}/history.jsonl`).filter(exists);
if (histories.length) {
  const allowText = publicText(root);
  for (const h of histories) {
    for (const hit of scanText(read(h), { allowText })) err(`${h} ${hit} (looks private; remove it or record again)`);
  }
}

// ---------- generated files ----------
// buildAll() throws on sources it can't render: list that with the other errors, unless it is one
// listed already, such as a SKILL.md frontmatter that doesn't end where Claude Code ends it.
let built = null;
try { built = buildAll(); } catch (e) { if (!errors.includes(e.message)) err(`build failed: ${e.message}`); }
for (const [p, content] of Object.entries(built ?? {})) {
  if (!exists(p) || read(p) !== content) err(`${p}: stale; run node scripts/build.mjs`);
}
// build.mjs writes files but never deletes them, so a lint grader it no longer writes (its case
// left LINT_GRADER_CASES, or its group of rules is empty) would stay and keep grading. The
// lint-prompt*.md names are reserved for its graders. Skipped when the build failed, since then
// no file counts as written.
if (built && exists('evals')) {
  for (const c of readdirSync(join(root, 'evals'), { withFileTypes: true })) {
    const dir = `evals/${c.name}/graders`;
    if (!c.isDirectory() || !exists(dir) || !statSync(join(root, dir)).isDirectory()) continue;
    for (const f of readdirSync(join(root, dir))) {
      const p = `${dir}/${f}`;
      if (/^lint-prompt.*\.md$/.test(f) && !Object.hasOwn(built, p)) err(`${p}: looks generated, but scripts/build.mjs doesn't write it; delete it or add the case to LINT_GRADER_CASES`);
    }
  }
}

report();
console.log(`validate: OK (${skillFiles.length} skill files, ${chars(skillBody)} chars in SKILL.md body, ${chars(core)} chars in universal core)`);
