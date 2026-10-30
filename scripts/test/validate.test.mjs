// Mutation tests for scripts/validate.mjs: each case breaks one rule in a temporary
// copy of the repository and expects validation to fail with a matching message.
// Run with: node --test scripts/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Build output and tool state the checks don't read: copying them only slows the tests down.
const SKIP = new Set(['.git', 'node_modules', 'results', 'dist', 'dist-mcpb', 'mcpb', '.wrangler']);

function copyRepo(from = repo) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-validate-'));
  // The checkout itself is copied whatever its folder is called; SKIP applies to what's inside it.
  cpSync(from, dir, { recursive: true, filter: (src) => src === from || !SKIP.has(basename(src)) });
  return dir;
}

function validate(dir) {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'validate.mjs')], {
    env: { ...process.env, PE_ROOT: dir }, encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function withMutation(mutate, expected) {
  const dir = copyRepo();
  try {
    mutate(dir);
    const { code, out } = validate(dir);
    assert.equal(code, 1, `expected failure, got:\n${out}`);
    assert.match(out, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const edit = (dir, file, fn) => writeFileSync(join(dir, file), fn(readFileSync(join(dir, file), 'utf8')));
const SKILL = 'skills/prompt-engine/SKILL.md';

test('the repository passes as-is', () => {
  const dir = copyRepo();
  try {
    const { code, out } = validate(dir);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('copies a checkout in a folder named like a skipped entry, still without its build output', () => {
  const parent = mkdtempSync(join(tmpdir(), 'pe-rootname-'));
  const from = join(parent, 'mcpb');
  mkdirSync(join(from, 'mcp', 'dist'), { recursive: true });
  writeFileSync(join(from, 'LICENSE'), '');
  writeFileSync(join(from, 'mcp', 'dist', 'cli.js'), '');
  const dir = copyRepo(from);
  try {
    assert.deepEqual(readdirSync(dir, { recursive: true }).sort(), ['LICENSE', 'mcp']);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a Claude Code-only frontmatter key', () =>
  withMutation((d) => edit(d, SKILL, (t) => t.replace('license: MIT', 'license: MIT\nargument-hint: "[prompt]"')), /not portable/));

test('rejects a description over the cap', () =>
  withMutation((d) => edit(d, SKILL, (t) => t.replace(/^description: ".*"$/m, `description: "${'word '.repeat(60).trim()}"`)), /description is \d+ chars/));

test('rejects angle brackets in the description', () =>
  withMutation((d) => edit(d, SKILL, (t) => t.replace(/^description: ".*"$/m, 'description: "Use <when> asked to improve a prompt."')), /must not contain < or >/));

test('rejects a $N placeholder that Claude Code would substitute', () =>
  withMutation((d) => edit(d, 'skills/prompt-engine/references/writing.md', (t) => `${t}\nPrices start at $1 per month.\n`), /\$N/));

test('rejects capitalized pressure words in SKILL.md', () =>
  withMutation((d) => edit(d, SKILL, (t) => `${t}\nYou MUST do this.\n`), /"MUST" \(pressure-words\)/));

test('rejects a request to expose reasoning in the universal prompt', () =>
  withMutation((d) => edit(d, 'universal/prompt-engine.md', (t) => `${t}\nThink step by step before answering.\n`), /visible-reasoning-request/));

test('rejects a package.json at the plugin root', () =>
  withMutation((d) => writeFileSync(join(d, 'package.json'), '{}'), /package\.json: not allowed at the repo root/));

test('rejects a missing contract heading', () =>
  withMutation((d) => edit(d, 'universal/prompt-engine.md', (t) => t.replaceAll('Fill before running', 'Fill in')), /missing contract string "Fill before running"/));

test('rejects a stale generated file', () =>
  withMutation((d) => edit(d, 'skills/prompt-engine/references/media-targets.md', (t) => `${t}\nhand edit\n`), /stale/));

test('rejects an unlinked reference file', () =>
  withMutation((d) => writeFileSync(join(d, 'skills/prompt-engine/references/extra.md'), '# Extra\n'), /not linked from SKILL\.md/));

test('rejects a version mismatch between SKILL.md and plugin.json', () =>
  withMutation((d) => edit(d, '.claude-plugin/plugin.json', (t) => t.replace(/"version": "[^"]+"/, '"version": "9.9.9"')), /metadata\.version/));
