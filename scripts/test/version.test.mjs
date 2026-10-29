// Tests for scripts/version.mjs, run against a temporary copy of the repository.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['.git', 'node_modules', 'results', 'dist', 'dist-mcpb']);

function copyRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'pe-version-'));
  cpSync(repo, dir, { recursive: true, filter: (src) => !SKIP.has(src.split('/').pop()) });
  return dir;
}

const run = (dir, script, ...args) => {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', script), ...args], {
    env: { ...process.env, PE_ROOT: dir }, encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
};
const read = (dir, file) => readFileSync(join(dir, file), 'utf8');

test('sets the version everywhere and the repository still validates', () => {
  const dir = copyRepo();
  try {
    const bumped = run(dir, 'version.mjs', '9.8.7');
    assert.equal(bumped.code, 0, bumped.out);
    assert.equal(JSON.parse(read(dir, '.claude-plugin/plugin.json')).version, '9.8.7');
    assert.match(read(dir, 'skills/prompt-engine/SKILL.md'), /^ {2}version: "9\.8\.7"$/m);
    for (const file of ['mcp/package.json', 'mcp/manifest.json', 'mcp/server.json']) {
      if (existsSync(join(dir, file))) assert.equal(JSON.parse(read(dir, file)).version, '9.8.7', file);
    }
    if (existsSync(join(dir, 'mcp/package-lock.json'))) {
      const lock = JSON.parse(read(dir, 'mcp/package-lock.json'));
      assert.equal(lock.version, '9.8.7');
      assert.equal(lock.packages[''].version, '9.8.7');
    }
    const checked = run(dir, 'validate.mjs');
    assert.equal(checked.code, 0, checked.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a version that is not major.minor.patch', () => {
  const dir = copyRepo();
  try {
    const r = run(dir, 'version.mjs', 'v1.0');
    assert.equal(r.code, 2);
    assert.match(r.out, /usage/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changes nothing when a file has an unexpected "version" key', () => {
  const dir = copyRepo();
  try {
    const plugin = JSON.parse(read(dir, '.claude-plugin/plugin.json'));
    plugin.metadata = { version: 'keep-me' };
    writeFileSync(join(dir, '.claude-plugin/plugin.json'), `${JSON.stringify(plugin, null, 2)}\n`);
    const skillBefore = read(dir, 'skills/prompt-engine/SKILL.md');
    const r = run(dir, 'version.mjs', '9.8.7');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /plugin\.json: has "version" keys/);
    assert.equal(read(dir, 'skills/prompt-engine/SKILL.md'), skillBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
