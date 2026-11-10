// When the "What next?" menu offers Save to file: only when the session has a tool that saves
// files on the user's computer, such as Write in Claude Code. The universal core has keyed the
// offer on such a tool since finding 1. SKILL.md keyed it on the product ("where you can write
// files (Claude Code and other local coding agents)") and output-format.md on "chat apps", and in
// eval sessions with no tool that writes files, 14 of 15 replies with a menu still offered it. No
// eval checks the skill's menu for this, because the full suite grants Write, so data/contract.json
// holds the condition's wording in the three files that state it, and validate.mjs fails when one
// of them drops it. Each mutation test changes a temporary copy of the repository, rebuilds the
// generated files that copy the method text, so that only the contract can fail, and validates the
// copy. Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Build output and tool state the checks don't read, as in validate.test.mjs.
const SKIP = new Set(['.git', 'node_modules', 'results', 'dist', 'dist-mcpb', 'mcpb', '.wrangler']);
// git exports variables such as GIT_DIR to the hooks it runs; inherited, they would point the
// copy's git commands at the repository being committed to (see validate.test.mjs).
const hasGit = spawnSync('git', ['--version']).status === 0;
const LOCAL_GIT_VARS = new Set(hasGit ? spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean) : []);
const env = (dir) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !LOCAL_GIT_VARS.has(k))), PE_ROOT: dir });
const run = (dir, script) => spawnSync(process.execPath, [join(dir, 'scripts', script)], { env: env(dir), encoding: 'utf8' });

const SKILL = 'skills/prompt-engine/SKILL.md';
const FORMAT = 'skills/prompt-engine/references/output-format.md';
const CORE = 'universal/prompt-engine.md';
const GROUP = 'saveOffer';
const CONTRACT = JSON.parse(readFileSync(join(repo, 'data/contract.json'), 'utf8'));
const read = (file) => readFileSync(join(repo, file), 'utf8');
const lineWith = (text, start) => text.split('\n').find((l) => l.startsWith(start)) ?? '';

test('each format offers Save to file only with a tool that saves files on the user\'s computer', () => {
  const condition = "tool that saves files on the user's computer";
  assert.ok(lineWith(read(SKILL), '- **Save to file** — ').includes(condition), `${SKILL}'s Save to file bullet doesn't key the offer on such a tool`);
  const format = read(FORMAT);
  assert.ok(lineWith(format, '| You have no ').includes(condition) && lineWith(format, '| You have no ').endsWith('| Drop "Save to file" |'), `${FORMAT}'s menu table doesn't drop Save to file by that tool test`);
  assert.ok(format.includes(`Drop "Save to file" from any of them when you have no ${condition}.`), `${FORMAT}'s rule under the table doesn't use the same test`);
  assert.ok(lineWith(read(CORE), '- ### What next?:').includes(`Save to file only if you have a ${condition}`), `${CORE} no longer keys the offer on such a tool`);
  assert.deepEqual(CONTRACT.required[GROUP], [condition], `data/contract.json doesn't hold the condition as ${GROUP}`);
  for (const file of [SKILL, FORMAT, CORE]) assert.ok((CONTRACT.artifacts[file] ?? []).includes(GROUP), `data/contract.json doesn't check ${GROUP} in ${file}`);
});

// [name, file, the text to replace, its replacement]
const MUTATIONS = [
  ['SKILL.md keys the offer on the product again', SKILL,
    "only when you have a tool that saves files on the user's computer (Write in Claude Code)",
    'only where you can write files (Claude Code and other local coding agents)'],
  ['output-format.md keys the menu on chat apps again', FORMAT,
    "| You have no tool that saves files on the user's computer (most chat apps) | Drop \"Save to file\" |\n\nWhen several rows apply, use the first that fits: open placeholders that are neither secrets nor removed private details, then an image or video prompt you can't generate, then a prompt for another tool. Drop \"Save to file\" from any of them when you have no tool that saves files on the user's computer.",
    "| You can't write files (chat apps) | Drop \"Save to file\" |\n\nWhen several rows apply, use the first that fits: open placeholders that are neither secrets nor removed private details, then an image or video prompt you can't generate, then a prompt for another tool. Drop \"Save to file\" from any of them when you can't write files."],
  ['the universal core keys the offer on the app', CORE,
    "Add 3) Save to file only if you have a tool that saves files on the user's computer; most chat apps don't, so leave it out.",
    'Add 3) Save to file in apps that can write files.'],
];

for (const [name, file, from, to] of MUTATIONS) {
  test(`validate fails when ${name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'pe-save-offer-'));
    try {
      cpSync(repo, dir, { recursive: true, filter: (src) => src === repo || !SKIP.has(basename(src)) });
      const path = join(dir, file);
      const before = readFileSync(path, 'utf8');
      assert.ok(before.includes(from), `${file} no longer holds the text this test changes; update the test with the condition's wording`);
      writeFileSync(path, before.replace(from, to));
      const built = run(dir, 'build.mjs');
      assert.equal(built.status, 0, `build failed:\n${built.stdout}${built.stderr}`);
      const r = run(dir, 'validate.mjs');
      const out = r.stdout + r.stderr;
      assert.equal(r.status, 1, `validate passed without the condition:\n${out}`);
      assert.doesNotMatch(out, /stale; run node scripts\/build\.mjs/, 'the copy was rebuilt, so only the contract should fail');
      for (const s of CONTRACT.required[GROUP] ?? []) {
        assert.ok(out.includes(`${file}: missing contract string ${JSON.stringify(s)} (${GROUP})`), `no error for ${JSON.stringify(s)}:\n${out}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
