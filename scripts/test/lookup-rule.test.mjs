// The lookup rule (D32): until the user picks an option that runs the prompt, the skill looks
// things up without shell commands or subagents. No eval can see either (eval runs grant no Bash,
// and no grader looks for a subagent), so data/contract.json holds the rule's wording in the three
// method files that state it, and validate.mjs fails when one of them drops the rule or ends it at
// any pick. Each test changes a temporary copy of the repository, rebuilds the generated files that
// copy the method text, so that only the contract can fail, and validates the copy.
// Run with: node --test scripts/test/*.test.mjs

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
const QUESTIONS = 'skills/prompt-engine/references/questions.md';
const CODING = 'skills/prompt-engine/references/coding.md';
const CONTRACT = JSON.parse(readFileSync(join(repo, 'data/contract.json'), 'utf8'));

// [name, file, the text to replace, its replacement, the contract groups the change must break]
const MUTATIONS = [
  ['SKILL.md drops the ban from its Diagnose step', SKILL,
    'Look things up before asking, without shell commands or subagents:', 'Look things up before asking:', ['lookupRuleSkill']],
  ['questions.md ends the ban at any pick from the menu', QUESTIONS,
    'until the user picks an option that runs the prompt, such as Run it now (Refine and Fill placeholders run nothing, and Save to file has its own lookup rule)',
    'until the user picks from the "What next?" menu', ['lookupRuleQuestions']],
  ['coding.md ends the ban at any pick', CODING,
    'because nothing runs until the user picks an option that runs the prompt, such as Run it now. If you can list or search files only through a shell, list and search nothing before the prompt runs',
    'because nothing runs until the user picks. If you can list or search files only through a shell, list and search nothing before the pick', ['lookupRuleCoding']],
  ['coding.md drops the shell and subagent clauses', CODING,
    ' rather than shell commands, even read-only ones such as `ls`, and without handing the lookups to a subagent,', ',', ['lookupRuleCoding']],
];

for (const [name, file, from, to, groups] of MUTATIONS) {
  test(`validate fails when ${name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'pe-lookup-'));
    try {
      cpSync(repo, dir, { recursive: true, filter: (src) => src === repo || !SKIP.has(basename(src)) });
      const path = join(dir, file);
      const before = readFileSync(path, 'utf8');
      assert.ok(before.includes(from), `${file} no longer holds the text this test changes; update the test with the rule's wording`);
      writeFileSync(path, before.replace(from, to));
      const built = run(dir, 'build.mjs');
      assert.equal(built.status, 0, `build failed:\n${built.stdout}${built.stderr}`);
      const r = run(dir, 'validate.mjs');
      const out = r.stdout + r.stderr;
      assert.equal(r.status, 1, `validate passed without the rule:\n${out}`);
      assert.doesNotMatch(out, /stale; run node scripts\/build\.mjs/, 'the copy was rebuilt, so only the contract should fail');
      const after = readFileSync(path, 'utf8');
      for (const g of groups) {
        const strings = CONTRACT.required[g] ?? [];
        assert.ok(strings.length > 0 && (CONTRACT.artifacts[file] ?? []).includes(g), `data/contract.json doesn't hold ${g} for ${file}`);
        const missing = strings.filter((s) => !after.includes(s));
        assert.ok(missing.length > 0, `the change leaves every ${g} string in place`);
        for (const s of missing) assert.ok(out.includes(`${file}: missing contract string ${JSON.stringify(s)} (${g})`), `no error for ${JSON.stringify(s)}:\n${out}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
