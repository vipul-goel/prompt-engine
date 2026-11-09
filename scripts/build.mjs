#!/usr/bin/env node
// Generates derived files from the hand-edited sources:
//   data/media-targets.json              -> skills/prompt-engine/references/media-targets.md
//   skills/prompt-engine/references/*.md -> universal/prompt-engine-knowledge.md
//   skills/, universal/ and data/        -> mcp/src/generated/content.ts (when mcp/ exists)
//   SKILL.md and references/            -> the skill text and Read results inside evals/*/history.jsonl
//   data/lint-rules.json                 -> evals/<case>/graders/lint-prompt*.md (LINT_GRADER_CASES)
// Zero dependencies: Node >= 22.19 built-ins only. Output is deterministic (no timestamps),
// so `node scripts/build.mjs && git diff --exit-code` detects stale generated files.
// `node scripts/build.mjs --check` exits 1 instead of writing when anything is stale. Any other
// argument is a usage error (exit 2), before anything is read or written.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// PE_ROOT lets tests point the scripts at a temporary copy of the repository.
export const root = process.env.PE_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
// Text as the scripts compare it: without a leading byte-order mark and with LF line endings,
// so a CRLF checkout (Git for Windows' default) or a BOM an editor added changes nothing. A run
// of CRs before a LF is one line break (a file converted to CRLF twice ends its lines in CR CR
// LF), so a second pass changes nothing: the build compares what it generates with a read of
// what it wrote, and one pass of CR LF to LF left a CR LF that the next read dropped.
export const normalize = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s).replace(/\r+\n/g, '\n');
const read = (p) => normalize(readFileSync(join(root, p), 'utf8'));
// A JSON file under the root, parsed. JSON.parse's own message doesn't name the file, so a merge-
// conflict marker or a trailing comma left the build's one line, and validate.mjs, without it.
export function readJson(p) {
  try { return JSON.parse(read(p)); } catch (e) { throw new Error(`${p}: ${e.message}`); }
}
// SKILL.md's frontmatter and body, from normalized text, or null when the text has none. Claude
// Code (2.1.319, read in its code) ends the frontmatter at the first "---" after the opening line,
// wherever it is (/^---\s*\n([\s\S]*?)---\s*\n?/): inside a value, or in a closing line such as
// "--- " or "----". The scripts end it at the first line of exactly "---". Where the two would
// differ, this throws instead, so that the skill can't load one way and be checked, versioned and
// copied into recordings another.
export function splitFrontmatter(text) {
  const strict = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  // Where Claude Code's closing "---" starts; strict's starts after "---\n", the block and "\n".
  const close = text.match(/^---\s*\n[\s\S]*?(?=---)/)?.[0].length;
  if (!strict && close === undefined) return null;
  if (!strict || close !== strict[1].length + 5) throw new Error('frontmatter must open and close with a line of exactly "---", with no other "---" in between: Claude Code ends it at the first "---" after the opening line, even inside a value or in a line such as "--- " or "----"');
  return { front: strict[1], body: text.slice(strict[0].length) };
}
// A release version: major.minor.patch, each part 0 or a number without a leading zero, as
// semver.org (item 2) and npm read it. /^\d+\.\d+\.\d+$/ also took 01.2.3: npm pack keeps it, and npm
// publish refuses it (EBADSEMVER) only in the release workflow, whose GitHub release job doesn't
// wait for the npm one. version.mjs and validate.mjs use it.
export const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
// Files the operating system writes into folders (Finder, Explorer). Git ignores them
// (.gitignore), validate.mjs skips them and release.mjs leaves them out of the skill zip.
export const OS_JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const STATUS_LABEL = {
  verified: '✓ verified against the vendor’s own documentation',
  secondary: '~ secondary: official documentation seen only in search results, so check the tool’s current docs before relying on details',
  unverified: '? unverified: check the tool’s current docs',
};

export function renderMediaTargets(data) {
  const lines = [
    '# Media targets',
    '',
    'Tool-specific syntax for image and video prompts, used with `references/image-video.md`. These tools change often. If an entry is not marked verified, or the user may be on a different version, ask the user or state your choice as an assumption.',
    '',
  ];
  if (!Array.isArray(data?.targets)) throw new Error('media-targets: targets must be a list of entries');
  for (const [i, t] of data.targets.entries()) {
    if (t === null || typeof t !== 'object') throw new Error(`media-targets: targets[${i}] is not an entry`);
    if (!STATUS_LABEL[t.status]) throw new Error(`media-targets: unknown status "${t.status}" for ${t.id}`);
    if (!Array.isArray(t.sources)) throw new Error(`media-targets: ${t.id} needs a sources array`);
    // The fields written into the Markdown below: a missing or misspelled one became "undefined".
    for (const [k, what] of [['name', 'a name'], ['kind', 'a kind'], ['last_verified', 'a last_verified date']]) {
      if (typeof t[k] !== 'string' || !t[k].trim()) throw new Error(`media-targets: ${t.id} needs ${what}`);
    }
    lines.push(`## ${t.name}`, '');
    lines.push(`*${t.kind} · ${STATUS_LABEL[t.status]} (last checked ${t.last_verified})*`, '');
    const fields = [
      ['Prompt style', t.prompt_style],
      ['Exclusions', t.exclusions],
      ['Settings', t.settings],
      ['References', t.references],
      ['Text in the image', t.text],
      ['Note', t.notes],
    ];
    for (const [label, value] of fields) {
      if (value && value !== '—') lines.push(`- **${label}:** ${value}`);
    }
    lines.push(`- **Sources:** ${t.sources.join(' · ')}`, '');
  }
  lines.push('_Generated from `data/media-targets.json` by `scripts/build.mjs`; edit the JSON, not this file._', '');
  return lines.join('\n');
}

// Order of sections in the knowledge file: how to respond first, then the domain packs.
export const KNOWLEDGE_ORDER = [
  'output-format', 'questions', 'blueprint', 'general',
  'coding', 'writing', 'research', 'image-video', 'media-targets',
];

const titleOf = (md) => (md.match(/^# (.+)$/m) || [, 'Untitled'])[1].trim();

// Shift markdown headings down one level outside fenced code blocks.
function demoteHeadings(md) {
  let fence = null;
  return md.split('\n').map((line) => {
    const f = line.match(/^(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1];
      else if (line.startsWith(fence)) fence = null;
      return line;
    }
    return !fence && /^#{1,5} /.test(line) ? `#${line}` : line;
  }).join('\n');
}

export function renderKnowledge(refs) {
  const titles = Object.fromEntries(Object.entries(refs).map(([k, md]) => [k, titleOf(md)]));
  const rewritePaths = (md) => md.replace(/`?references\/([a-z-]+)\.md`?/g, (m, name) =>
    titles[name] ? `the "${titles[name]}" section` : m);
  const parts = [
    '# Prompt Engine knowledge file',
    '',
    'Detailed checklists and rules for Prompt Engine. Use this file together with the Prompt Engine instructions (`prompt-engine.md`). If the two ever disagree, follow the instructions.',
    '',
    'Sections:',
    ...KNOWLEDGE_ORDER.map((k, i) => `${i + 1}. ${titles[k]}`),
    '',
  ];
  for (const k of KNOWLEDGE_ORDER) {
    parts.push('---', '', demoteHeadings(rewritePaths(refs[k].trim())), '');
  }
  parts.push('_Generated from `skills/prompt-engine/references/` by `scripts/build.mjs`; edit those files, not this one._', '');
  return parts.join('\n');
}

const ts = (value) => JSON.stringify(value, null, 2);

// The MCP server serves the same method text as the skill and the universal prompt.
export function renderContentModule({ version, universal, refs, contract, media, lint }) {
  const references = Object.fromEntries(Object.entries(refs).map(([k, md]) => [k, { title: titleOf(md), text: md }]));
  return [
    '// Generated by scripts/build.mjs from skills/prompt-engine, universal/ and data/. Do not edit;',
    '// change the sources and run `node scripts/build.mjs` from the repository root.',
    '',
    `export const VERSION = ${ts(version)};`,
    '',
    '/** The copy-paste method (universal/prompt-engine.md), used as the base of the MCP brief. */',
    `export const UNIVERSAL_METHOD: string = ${ts(universal)};`,
    '',
    '/** Reference files from skills/prompt-engine/references, keyed by file name without .md. */',
    `export const REFERENCES: Record<string, { title: string; text: string }> = ${ts(references)};`,
    '',
    `export const CONTRACT = ${ts(contract)} as const;`,
    '',
    `export const MEDIA_TARGETS = ${ts(media)} as const;`,
    '',
    `export const LINT_RULES: ReadonlyArray<{ id: string; pattern: string; flags: string; severity: 'warning' | 'info'; selfCheck: boolean; message: string }> = ${ts(lint.rules)};`,
    '',
  ].join('\n');
}

// How Claude Code starts the skill text it injects, with the plugin path that
// scripts/eval/record-history.mjs writes in place of the real one.
const SKILL_TEXT_HEAD = 'Base directory for this skill: /plugin/skills/prompt-engine\n\n';
// The names a recording can invoke the skill by: the Skill tool's input.skill, and a typed slash command.
const SKILL_NAMES = new Set(['prompt-engine', 'prompt-engine:prompt-engine']);
const COMMAND_NAME = /<command-name>\/(prompt-engine(?::prompt-engine)?)<\/command-name>/;
// The only files whose Reads refreshHistory refreshes: the skill's own, under the plugin root.
const SKILL_FILES = 'skills/prompt-engine/';
// Claude Code's Read result: each line prefixed with its number and a tab.
const numberLines = (text) => text.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n');

// Follow-up eval cases resume a recorded conversation (evals/*/history.jsonl), which
// holds the skill text and the reference files as they were when it was recorded
// (scripts/eval/record-history.mjs rewrites the plugin path to /plugin). Both are
// refreshed here so the follow-up turn is tested against the current method; the
// recorded questions and answers stay as they were. The skill text is found by
// prompt-engine's own header and ends where the line with the recorded invocation's
// arguments starts. A reference file is refreshed both in the Read result and in Claude
// Code's own copy of it (toolUseResult.file); a failed Read (is_error) stays as recorded.
// A recording this can't refresh exactly throws, so it is recorded again instead of being
// patched by guesswork: skill text without a recorded invocation, arguments without their
// ARGUMENTS line (or an ARGUMENTS line other than an empty one without them), a plugin path that
// wasn't rewritten, a Read with offset or limit (D12: Claude Code's partial-read format isn't
// verified), a Read of a file that no longer exists, or a Read of a file outside the skill's
// folder (skills/prompt-engine/), or of a path with a ".." segment. A refresh copies the file's
// text from disk into the history, and other files under the root can be untracked or private,
// such as an .env file, .git/config or a file that a link leads to.
export function refreshHistory(jsonl, skillBody, readPluginFile) {
  const reads = new Map(); // Read tool_use id -> { rel, partial }
  let args = null; // the arguments of the latest prompt-engine invocation; null before the first one
  return jsonl.split('\n').map((line) => {
    if (!line.trim()) return line;
    const row = JSON.parse(line);
    const content = row.message?.content;
    // A typed slash command: "<command-name>/prompt-engine:prompt-engine</command-name>\n<command-args>…</command-args>".
    const typed = typeof content === 'string' ? content
      : Array.isArray(content) ? content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : '';
    if (COMMAND_NAME.test(typed)) args = typed.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '';
    const parts = Array.isArray(content) ? content : [];
    let changed = false;
    for (const part of parts) {
      if (part.type === 'tool_use' && part.name === 'Skill' && SKILL_NAMES.has(part.input?.skill)) {
        args = typeof part.input.args === 'string' ? part.input.args : '';
      } else if (part.type === 'tool_use' && part.name === 'Read') {
        const m = String(part.input?.file_path ?? '').match(/^\/plugin\/(.+)$/);
        if (m) reads.set(part.id, { rel: m[1], partial: part.input.offset !== undefined || part.input.limit !== undefined });
      } else if (part.type === 'tool_result' && reads.has(part.tool_use_id) && part.is_error !== true) {
        const { rel, partial } = reads.get(part.tool_use_id);
        if (rel.split(/[\\/]/).includes('..')) throw new Error(`reads ${rel}, outside the plugin; re-record it`);
        if (!rel.startsWith(SKILL_FILES)) throw new Error(`reads ${rel}, outside the skill's folder; re-record it`);
        if (partial) throw new Error(`reads part of ${rel} (offset/limit); re-record it`);
        const current = readPluginFile(rel);
        if (current === undefined) throw new Error(`reads ${rel}, which no longer exists; re-record it`);
        if (typeof part.content !== 'string') throw new Error(`has a Read result for ${rel} that isn't text; re-record it`);
        const numbered = numberLines(current);
        if (numbered !== part.content) { part.content = numbered; changed = true; }
        // Claude Code's own copy of the file, in the shape of a whole-file Read; the spread keeps the key order.
        const file = row.toolUseResult?.file;
        if (file?.filePath === `/plugin/${rel}`) {
          const n = current.split('\n').length;
          const fresh = { ...file, content: current, numLines: n, startLine: 1, totalLines: n };
          if (JSON.stringify(fresh) !== JSON.stringify(file)) { row.toolUseResult.file = fresh; changed = true; }
        }
      } else if (part.type === 'text' && part.text.startsWith(SKILL_TEXT_HEAD)) {
        if (args === null) throw new Error('skill text without a recorded prompt-engine invocation; re-record it');
        // "<head><SKILL.md body>\n" and, when there are arguments, "\n\nARGUMENTS: <args>". Cut at
        // that line when it holds exactly the recorded arguments (which may themselves contain
        // "\n\nARGUMENTS: "); otherwise at the last such line, since Claude Code escapes some
        // characters in it, such as "!". With no arguments, Claude Code appends no line (read in
        // 2.1.314-2.1.317's code). An empty ARGUMENTS line is kept as recorded and any other one is
        // refused, so a later version that writes one can't have it dropped without a word.
        const exact = `\n\nARGUMENTS: ${args}`;
        let cut = part.text.length;
        if (part.text.endsWith(exact)) cut -= exact.length;
        else if (args) {
          cut = part.text.lastIndexOf('\n\nARGUMENTS: ');
          if (cut < SKILL_TEXT_HEAD.length) throw new Error('arguments were recorded, but the skill text has no ARGUMENTS line; re-record it');
        } else if (/\n\nARGUMENTS:[^\n]*$/.test(part.text)) throw new Error('no arguments were recorded, but the skill text ends with an ARGUMENTS line; re-record it');
        // The old body's trailing white space is kept. trimEnd drops what \s matches, in time in step
        // with the text; /\s*$/ tried the end from each character of a long run of spaces inside the
        // body, which took quadratic time.
        const old = part.text.slice(SKILL_TEXT_HEAD.length, cut);
        const text = `${SKILL_TEXT_HEAD}${skillBody}${old.slice(old.trimEnd().length)}${part.text.slice(cut)}`;
        if (text !== part.text) { part.text = text; changed = true; }
      } else if (part.type === 'text' && /^Base directory for this skill: .*[\\/]skills[\\/]prompt-engine\n/.test(part.text)) {
        throw new Error('the skill text names a plugin path other than /plugin; record it with scripts/eval/record-history.mjs');
      }
    }
    return changed ? JSON.stringify(row) : line;
  }).join('\n');
}

// Eval cases whose reply holds an enhanced prompt get two regex graders generated from
// data/lint-rules.json (D36): lint-prompt.md for the rules without flags, lint-prompt-i.md for
// the rules with flag i. Each fails when a rule matches inside any fenced block of the reply,
// which is where the full prompt and the short version go, so the same words in the commentary
// don't count. open-placeholder stays out (placeholders are allowed), vague-quality-words
// applies only to image and video prompts, and secret-redaction-quick skips template-leftover,
// because a correct GitHub Actions prompt reads the key as ${{ secrets.NAME }}. The graders
// match the raw text of each block, code spans included, so a prompt that names a CRITICAL log
// level in backticks fails them.
export const LINT_GRADER_CASES = {
  'coding-quick-code-block': {},
  'followup-change-assumption': {},
  'followup-fill-placeholders': {},
  'followup-ok-accepts-recommendations': {},
  'followup-partial-answers': {},
  'image-midjourney-quick': { media: true },
  'japanese-midjourney-quick': { media: true },
  'research-quick-vector-databases': {},
  'secret-redaction-quick': { skip: ['template-leftover'] },
  'spanish-quick': {},
  'strong-prompt-minimal-changes': {},
  'video-veo-quick': { media: true },
  'writing-quick-launch-email': {},
};
const LINT_NEVER = new Set(['open-placeholder']);
const LINT_MEDIA_ONLY = new Set(['vague-quality-words']);
const LINT_FILES = { '': 'lint-prompt.md', i: 'lint-prompt-i.md' };
// A ^ or $ outside a character class and not escaped. In a generated grader, which has no m flag,
// it matches only at the start or end of the whole reply, not at a line of a fenced block, so the
// grader would miss what check_prompt (which matches one line at a time) still finds.
const hasAnchor = (pattern) => [...pattern.matchAll(/\\.|\[(?:\\.|[^\]\\])*\]|[\^$]/g)].some((m) => m[0] === '^' || m[0] === '$');

// A pattern that matches when x matches inside any fenced block: skip whole blocks, each closed
// by a fence as long as its opener, then search one block. Named groups, because the rules' own
// groups would shift numbered backreferences. An opening fence takes its whole run of backticks
// ((?!`)). Without that, a fence of four or more backticks can also be read as a shorter one, so
// on a reply without a match the time doubled with each such block: 20 took 3 s in JavaScriptCore.
export const inFencedBlock = (x) => '^(?:(?:(?!`{3})[\\s\\S])*?(?<f>`{3,})(?!`)[^\\n]*\\n(?:(?!\\n\\k<f>)[\\s\\S])*?\\n\\k<f>)*?'
  + '(?:(?!`{3})[\\s\\S])*?(?<g>`{3,})(?!`)[^\\n]*\\n(?:(?!\\n\\k<g>)[\\s\\S])*?(?:' + x + ')';

export function renderLintGraders(rules, { media = false, skip = [] } = {}) {
  for (const id of skip) {
    if (!rules.some((r) => r.id === id)) throw new Error(`LINT_GRADER_CASES in scripts/build.mjs skips ${id}, which data/lint-rules.json doesn't have`);
  }
  const groups = {};
  for (const r of rules) {
    if (LINT_NEVER.has(r.id) || skip.includes(r.id) || (LINT_MEDIA_ONLY.has(r.id) && !media)) continue;
    if (!Object.hasOwn(LINT_FILES, r.flags)) throw new Error(`data/lint-rules.json ${r.id}: flags "${r.flags}" have no generated eval grader; add one to LINT_FILES in scripts/build.mjs`);
    (groups[r.flags] ??= []).push(r);
  }
  const files = {};
  for (const [flags, rs] of Object.entries(groups)) {
    const ids = rs.map((r) => r.id).join(', ');
    const pattern = inFencedBlock(rs.map((r) => `(?:${r.pattern})`).join('|'));
    // A rule that compiles alone can still break the combined pattern, for example with a group
    // named f or g.
    try { new RegExp(pattern, flags); } catch (e) { throw new Error(`data/lint-rules.json ${ids}: the generated eval grader doesn't compile (${e.message})`); }
    const yaml = [
      '# Generated from data/lint-rules.json by scripts/build.mjs; edit the rules there, not this file.',
      `# Fails when a fenced block of the reply matches: ${ids}.`,
      'type: regex',
      `pattern: '${pattern.replace(/'/g, "''")}'`,
      ...(flags ? [`flags: ${flags}`] : []),
      'match: not_contains',
      'weight: 1',
    ];
    // claude plugin eval (2.1.319) ends the front matter at the first "---" anywhere in it, and
    // YAML folds a line break inside a quoted value into a space: either would change the grader.
    if (yaml.some((l) => l.includes('---')) || /[\r\n]/.test(pattern)) throw new Error(`data/lint-rules.json ${ids}: a generated eval grader can't hold "---" or a line break; write -{3} or \\n instead`);
    for (const r of rs) if (hasAnchor(r.pattern)) throw new Error(`data/lint-rules.json ${r.id}: a generated eval grader can't carry ^ or $ (without the m flag they match only at the start or end of the whole reply, not at a line of a fenced block); write the rule without them`);
    files[LINT_FILES[flags]] = ['---', ...yaml, '---', ''].join('\n');
  }
  return files;
}

export function buildAll() {
  const outputs = {};
  const media = readJson('data/media-targets.json');
  // As a read of the file will see it, here already because the knowledge file and recorded Reads
  // copy this text: a value with a written-out \r\n left a CR LF in them, which each later read
  // dropped, so the build never settled.
  outputs['skills/prompt-engine/references/media-targets.md'] = normalize(renderMediaTargets(media));
  const refs = {};
  for (const k of KNOWLEDGE_ORDER) {
    const p = `skills/prompt-engine/references/${k}.md`;
    refs[k] = outputs[p] ?? read(p);
  }
  outputs['universal/prompt-engine-knowledge.md'] = renderKnowledge(refs);
  // The body as Claude Code loads it: without the frontmatter, or the whole file when it has none.
  const skillText = read('skills/prompt-engine/SKILL.md');
  let skill;
  try { skill = splitFrontmatter(skillText); } catch (e) { throw new Error(`skills/prompt-engine/SKILL.md: ${e.message}`); }
  const skillBody = (skill ? skill.body : skillText).trim();
  // A file on disk is read only when it is still in the skill's folder once links are followed,
  // so a link there can't bring a file from elsewhere into a recording.
  const skillDir = join(root, SKILL_FILES);
  const readPluginFile = (p) => {
    if (outputs[p] !== undefined) return outputs[p];
    if (!existsSync(join(root, p))) return undefined;
    if (!realpathSync(join(root, p)).startsWith(realpathSync(skillDir) + sep)) throw new Error(`${p} leads out of the skill's folder through a link, and only the skill's own files are copied into a recording`);
    return read(p);
  };
  for (const entry of readdirSync(join(root, 'evals'), { withFileTypes: true })) {
    const p = `evals/${entry.name}/history.jsonl`;
    if (!entry.isDirectory() || !existsSync(join(root, p))) continue;
    // Name the history in the error, so the build's one line says which file to record again.
    try { outputs[p] = refreshHistory(read(p), skillBody, readPluginFile); } catch (e) { throw new Error(`${p}: ${e.message}`); }
  }
  const lintRules = readJson('data/lint-rules.json').rules;
  if (!Array.isArray(lintRules)) throw new Error('data/lint-rules.json: rules must be a list of rules');
  for (const [c, opts] of Object.entries(LINT_GRADER_CASES)) {
    const dir = `evals/${c}/graders`;
    if (!existsSync(join(root, dir)) || !statSync(join(root, dir)).isDirectory()) throw new Error(`LINT_GRADER_CASES in scripts/build.mjs names ${dir}, which does not exist`);
    for (const [name, text] of Object.entries(renderLintGraders(lintRules, opts))) outputs[`${dir}/${name}`] = text;
  }
  if (existsSync(join(root, 'mcp', 'package.json'))) {
    const strip = ({ $comment, ...rest }) => rest;
    outputs['mcp/src/generated/content.ts'] = renderContentModule({
      version: readJson('.claude-plugin/plugin.json').version,
      universal: read('universal/prompt-engine.md'),
      refs,
      contract: strip(readJson('data/contract.json')),
      media: strip(readJson('data/media-targets.json')),
      lint: strip(readJson('data/lint-rules.json')),
    });
  }
  // Every output as a later read of it will see it, so that what the build writes compares equal
  // the next time (main() and validate.mjs normalize the file on disk).
  for (const [p, text] of Object.entries(outputs)) outputs[p] = normalize(text);
  return outputs;
}

function main() {
  // Read strictly: any argument but --check meant "write", so a misspelled --check, --check=true or
  // a stray word rewrote the stale files and exited 0.
  let check;
  try {
    check = parseArgs({ args: process.argv.slice(2), options: { check: { type: 'boolean' } } }).values.check === true;
  } catch (e) {
    console.error(`${e.message}\nusage: node scripts/build.mjs [--check]`);
    process.exit(2);
  }
  // A source the build can't render is a data error to fix, not a crash: one line, no stack.
  let outputs;
  try { outputs = buildAll(); } catch (e) { console.error(`build failed: ${e.message}`); process.exit(1); }
  let stale = 0;
  for (const [p, content] of Object.entries(outputs)) {
    const abs = join(root, p);
    const current = existsSync(abs) ? normalize(readFileSync(abs, 'utf8')) : null;
    if (current === content) continue;
    if (check) { console.error(`stale: ${p}`); stale++; continue; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    console.log(`wrote ${p}`);
  }
  if (check && stale) process.exit(1);
  if (check) console.log('generated files are up to date');
}

// Whether a module is the entry point, so that importing it runs nothing (record-history.mjs
// uses this too). Node 22.18+ and 24.2+, so every version this project supports, set
// import.meta.main: pass it as isMain. Comparing process.argv[1] with the module's path isn't
// enough, because under node -e or -p process.argv[1] is the first argument after the code, which
// can be the module's own path. Without import.meta.main: never under -e or -p, and otherwise
// compare real paths, since import.meta.url is percent-encoded and symlink-free and
// process.argv[1] is neither (spaces, /tmp and /var on macOS, Windows).
export function isEntryPoint({ isMain, execArgv, argv1, self }) {
  if (typeof isMain === 'boolean') return isMain;
  if (execArgv.some((a) => /^(-e|-p|-pe|--eval|--print)(=|$)/.test(a))) return false;
  try { return realpathSync(self) === realpathSync(argv1); } catch { return false; }
}
if (isEntryPoint({ isMain: import.meta.main, execArgv: process.execArgv, argv1: process.argv[1], self: fileURLToPath(import.meta.url) })) main();
