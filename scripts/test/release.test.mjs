// Tests for scripts/release.mjs that need no network and no npm: the skill zip only.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { OS_JUNK } from '../build.mjs';

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

// release.mjs --zip on a copy that setup changes first, with the normal PATH. Returns the run and
// the zip's entries.
const has = (cmd) => spawnSync(cmd, ['-v']).error?.code !== 'ENOENT';
const NO_ZIP = !(has('zip') && has('unzip')) && 'needs the zip and unzip commands';
function zipCopy(setup) {
  const dir = copyRepo();
  try {
    setup(dir);
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'release.mjs'), '--zip'], { env: { ...process.env, PE_ROOT: dir }, encoding: 'utf8' });
    const zip = join(dir, 'dist', 'prompt-engine.zip');
    const entries = existsSync(zip) ? spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean) : [];
    return { code: r.status, out: r.stdout + r.stderr, entries };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// validate.mjs skips these files, so only release.mjs's -x list keeps them out of the zip.
test('release.mjs --zip leaves out the files Finder and Explorer write', { skip: NO_ZIP }, () => {
  const r = zipCopy((dir) => {
    for (const f of OS_JUNK) for (const sub of ['', 'references']) writeFileSync(join(dir, 'skills', 'prompt-engine', sub, f), 'x');
  });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.entries.includes('prompt-engine/SKILL.md'), r.entries.join('\n'));
  assert.deepEqual(r.entries.filter((e) => OS_JUNK.has(e.split('/').at(-1))), []);
});

test('release.mjs --zip reads a plugin.json that starts with a byte-order mark', { skip: NO_ZIP }, () => {
  const r = zipCopy((dir) => {
    const file = join(dir, '.claude-plugin', 'plugin.json');
    writeFileSync(file, `\u{FEFF}${readFileSync(file, 'utf8')}`);
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^dist\/prompt-engine\.zip \(\d+ entries\)$/m);
});
