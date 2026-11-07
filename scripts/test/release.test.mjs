// Tests for scripts/release.mjs that need no network and no npm: the skill zip only.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Build output and tool state the checks don't read: copying them only slows the tests down.
const SKIP = new Set(['.git', 'node_modules', 'results', 'dist', 'dist-mcpb', 'mcpb', '.wrangler']);

function copyRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'pe-release-'));
  cpSync(repo, dir, { recursive: true, filter: (src) => src === repo || !SKIP.has(basename(src)) });
  return dir;
}

// Runs release.mjs --zip with PATH set to one folder, which setup fills. Windows spells the
// variable Path, so every spelling is removed first.
function zipWithPath(setup) {
  const dir = copyRepo();
  const bin = mkdtempSync(join(tmpdir(), 'pe-bin-'));
  try {
    setup(bin);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'release.mjs'), '--zip'], {
      env: { ...env, PATH: bin, PE_ROOT: dir }, encoding: 'utf8',
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
}

const oneLine = (cmd) => new RegExp(`^release\\.mjs needs the ${cmd} command, which isn't installed\\. [^\\n]*Compressed \\(zipped\\) folder[^\\n]*$`, 'm');

test('release.mjs --zip without zip on PATH stops with one line, not a stack trace', () => {
  const r = zipWithPath(() => {});
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stderr, oneLine('zip'));
  assert.doesNotMatch(r.stderr, /^\s+at |ENOENT/m, 'no stack trace');
});

test('release.mjs --zip without unzip on PATH stops with one line, not a stack trace', (t) => {
  // Keep only zip on PATH. Windows has no zip command to keep.
  const zip = process.platform === 'win32' ? undefined
    : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, 'zip')).find((p) => existsSync(p));
  if (!zip) { t.skip('no zip command on PATH'); return; }
  const r = zipWithPath((bin) => symlinkSync(zip, join(bin, 'zip')));
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stderr, oneLine('unzip'));
  assert.doesNotMatch(r.stderr, /^\s+at |ENOENT/m, 'no stack trace');
});
