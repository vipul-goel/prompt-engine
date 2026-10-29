#!/usr/bin/env node
// Validates the repository: Agent Skill format and portability rules, the shared
// output contract, size budgets, plugin-root hygiene, data files, manifests,
// eval cases and generated-file freshness. Zero dependencies (Node >= 20).
//
//   node scripts/validate.mjs        # exit 1 on any error; warnings are printed
//
// The rules come from the platforms' documentation (see docs/sources.md):
// claude.ai and the Skills API reject unknown frontmatter keys, Codex rejects
// `compatibility`, Claude Code substitutes $ARGUMENTS/$N/${CLAUDE_*}/!`cmd`
// inside skill text, and a plugin root must not hold package.json + lockfile,
// bin/, CLAUDE.md or .mcp.json.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { buildAll, root } from './build.mjs';

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const read = (p) => readFileSync(join(root, p), 'utf8');
const exists = (p) => existsSync(join(root, p));
const chars = (s) => [...s].length;

const contract = JSON.parse(read('data/contract.json'));
const B = contract.budgets;
const SKILL_DIR = 'skills/prompt-engine';
const SKILL = `${SKILL_DIR}/SKILL.md`;

// ---------- frontmatter ----------
export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: null, body: text };
  const data = {};
  let parent = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const nested = line.match(/^  ([\w-]+):\s*(.*)$/);
    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (nested && parent) {
      data[parent][nested[1]] = unquote(nested[2]);
    } else if (top) {
      if (top[2] === '') { data[top[1]] = {}; parent = top[1]; }
      else { data[top[1]] = unquote(top[2]); parent = null; }
    } else {
      throw new Error(`unsupported frontmatter line: ${line}`);
    }
  }
  return { data, body: text.slice(m[0].length) };
}
const unquote = (v) => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
};

const skillText = read(SKILL);
let fm;
try { fm = parseFrontmatter(skillText); } catch (e) { err(`${SKILL}: ${e.message}`); fm = { data: {}, body: skillText }; }
const { data: front, body: skillBody } = fm;
if (!front) err(`${SKILL}: missing YAML frontmatter`);
else {
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
  else for (const [k, v] of Object.entries(meta)) if (typeof v !== 'string') err(`${SKILL}: metadata.${k} must be a string`);
  if (!/^\d+\.\d+\.\d+$/.test(meta.version ?? '')) err(`${SKILL}: metadata.version must be semver`);
}

// ---------- skill folder ----------
const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => {
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

// Instruction text the models read directly: lint rules marked selfCheck in
// data/lint-rules.json (pressure words, requests to expose reasoning) must not occur.
const lint = JSON.parse(read('data/lint-rules.json'));
for (const r of lint.rules) {
  try { new RegExp(r.pattern, r.flags); } catch (e) { err(`data/lint-rules.json ${r.id}: bad pattern (${e.message})`); }
}
const INSTRUCTION_FILES = [SKILL, 'universal/prompt-engine.md'];
for (const f of INSTRUCTION_FILES) {
  const t = read(f);
  for (const r of lint.rules.filter((x) => x.selfCheck)) {
    const m = t.match(new RegExp(r.pattern, r.flags));
    if (m) err(`${f}: "${m[0]}" (${r.id}): ${r.message}`);
  }
}

// Budgets
if (chars(skillBody) > B.skillBodyMaxChars) err(`${SKILL}: body is ${chars(skillBody)} chars (max ${B.skillBodyMaxChars})`);
if (skillBody.split('\n').length > B.skillBodyMaxLines) err(`${SKILL}: body is ${skillBody.split('\n').length} lines (max ${B.skillBodyMaxLines})`);
for (const h of B.skillKeySections) {
  const i = skillBody.indexOf(h);
  if (i < 0) err(`${SKILL}: missing section "${h}"`);
  else if (i > B.skillKeySectionsWithinChars) err(`${SKILL}: section "${h}" starts at char ${i}; keep it within the first ${B.skillKeySectionsWithinChars} so it survives context compaction`);
}
const core = read('universal/prompt-engine.md');
if (chars(core) > B.universalCoreMaxChars) err(`universal/prompt-engine.md: ${chars(core)} chars (max ${B.universalCoreMaxChars})`);

// References: every file is linked from SKILL.md, every link resolves, one level deep.
const linked = new Set([...skillBody.matchAll(/references\/([\w-]+\.md)/g)].map((m) => m[1]));
const refFiles = readdirSync(join(root, SKILL_DIR, 'references'));
for (const f of refFiles) {
  if (statSync(join(root, SKILL_DIR, 'references', f)).isDirectory()) err(`${SKILL_DIR}/references/${f}: keep references one level deep`);
  else if (!linked.has(f)) err(`${SKILL_DIR}/references/${f}: not linked from SKILL.md`);
}
for (const f of linked) if (!refFiles.includes(f)) err(`${SKILL}: links references/${f}, which does not exist`);

// ---------- output contract ----------
for (const [file, groups] of Object.entries(contract.artifacts)) {
  if (!exists(file)) { err(`${file}: listed in data/contract.json but missing`); continue; }
  const t = read(file);
  for (const g of groups) for (const s of contract.required[g] ?? []) {
    if (!t.includes(s)) err(`${file}: missing contract string ${JSON.stringify(s)} (${g})`);
  }
}

// ---------- plugin root hygiene ----------
// With marketplace source "./", the repo root is the plugin root: these would load as
// plugin components, make Claude Code run npm ci on install, or make claude.ai refuse it.
const FORBIDDEN_ROOT = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'node_modules', 'bin',
  'CLAUDE.md', '.mcp.json', '.lsp.json', 'commands', 'agents', 'hooks', 'settings.json', 'SKILL.md',
  'output-styles', 'monitors', 'workflows', 'themes'];
for (const f of FORBIDDEN_ROOT) if (exists(f)) err(`${f}: not allowed at the repo root, which is also the plugin root`);

// ---------- manifests ----------
const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
const market = JSON.parse(read('.claude-plugin/marketplace.json'));
if (plugin.name !== 'prompt-engine') err('.claude-plugin/plugin.json: name must be prompt-engine');
if (!/^\d+\.\d+\.\d+$/.test(plugin.version ?? '')) err('.claude-plugin/plugin.json: version must be semver');
const entry = (market.plugins ?? []).find((p) => p.name === plugin.name);
if (!entry) err('.claude-plugin/marketplace.json: no entry for prompt-engine');
else {
  if (entry.source !== './') err('.claude-plugin/marketplace.json: prompt-engine source should be "./"');
  if (entry.version) err('.claude-plugin/marketplace.json: set version only in plugin.json (it silently wins)');
}
const version = plugin.version;
if (front?.metadata?.version && front.metadata.version !== version) err(`${SKILL}: metadata.version ${front.metadata.version} != plugin.json ${version}`);
if (exists('mcp/package.json')) {
  const pkg = JSON.parse(read('mcp/package.json'));
  if (pkg.version !== version) err(`mcp/package.json: version ${pkg.version} != plugin.json ${version}`);
  if (exists('mcp/server.json')) {
    const server = JSON.parse(read('mcp/server.json'));
    if (pkg.mcpName !== server.name) err(`mcp/package.json mcpName "${pkg.mcpName}" != server.json name "${server.name}"`);
    if (server.version !== version) err(`mcp/server.json: version ${server.version} != ${version}`);
    if (chars(server.description ?? '') > 100) err('mcp/server.json: description must be 100 characters or fewer');
    for (const p of server.packages ?? []) if (p.version && p.version !== version) err(`mcp/server.json: package ${p.identifier} version ${p.version} != ${version}`);
  }
  if (exists('mcp/manifest.json')) {
    const mf = JSON.parse(read('mcp/manifest.json'));
    if (mf.version !== version) err(`mcp/manifest.json: version ${mf.version} != ${version}`);
  }
}

// ---------- data ----------
const media = JSON.parse(read('data/media-targets.json'));
for (const t of media.targets) {
  if (!['verified', 'secondary', 'unverified'].includes(t.status)) err(`data/media-targets.json ${t.id}: bad status "${t.status}"`);
  if (!Array.isArray(t.sources) || !t.sources.length || t.sources.some((s) => !/^https:\/\//.test(s))) err(`data/media-targets.json ${t.id}: needs https sources`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.last_verified ?? '')) err(`data/media-targets.json ${t.id}: last_verified must be YYYY-MM-DD`);
}

// ---------- eval cases ----------
if (exists('evals')) {
  for (const c of readdirSync(join(root, 'evals'))) {
    const dir = `evals/${c}`;
    if (c === 'results' || !statSync(join(root, dir)).isDirectory()) continue;
    if (!exists(`${dir}/prompt.md`) && !exists(`${dir}/case.yaml`)) { err(`${dir}: needs prompt.md or case.yaml`); continue; }
    const graders = exists(`${dir}/graders`) ? readdirSync(join(root, dir, 'graders')).filter((f) => f.endsWith('.md')) : [];
    if (!graders.length) err(`${dir}: needs at least one grader in graders/`);
  }
}

// ---------- generated files ----------
for (const [p, content] of Object.entries(buildAll())) {
  if (!exists(p) || read(p) !== content) err(`${p}: stale; run node scripts/build.mjs`);
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log(`validate: OK (${skillFiles.length} skill files, ${chars(skillBody)} chars in SKILL.md body, ${chars(core)} chars in universal core)`);
