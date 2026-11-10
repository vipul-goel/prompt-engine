// Tests for scripts/release.mjs that need no network and no npm: its command line, the tag check,
// the validate.mjs run before anything is built, the skill zip and its layout check, and the
// checksums of a full run on a copy without the MCP server (so that it builds no MCPB bundle).
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { OS_JUNK } from '../build.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Build output and tool state the checks don't read: copying them only slows the tests down.
const SKIP = new Set(['.git', 'node_modules', 'results', 'dist', 'dist-mcpb', 'mcpb', '.wrangler']);

function copyRepo(from = repo) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-release-'));
  try {
    cpSync(from, dir, { recursive: true, filter: (src) => src === from || !SKIP.has(basename(src)) });
  } catch (e) {
    // A copy that fails (an unreadable file in the checkout, a full disk) leaves no folder behind.
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

// Runs release.mjs --zip with PATH set to one folder, which setup fills. Windows spells the
// variable Path, so every spelling is removed first.
function zipWithPath(setup) {
  const dir = copyRepo();
  let bin;
  try {
    bin = mkdtempSync(join(tmpdir(), 'pe-bin-'));
    setup(bin);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'release.mjs'), '--zip'], {
      env: { ...env, PATH: bin, PE_ROOT: dir }, encoding: 'utf8',
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin, { recursive: true, force: true });
  }
}

// A copy that fails removes its folder before it throws, instead of leaving one in the temp directory.
test('copyRepo removes its folder when the copy fails', () => {
  const t = mkdtempSync(join(tmpdir(), 'pe-leak-'));
  const saved = Object.fromEntries(['TMPDIR', 'TEMP', 'TMP'].map((k) => [k, process.env[k]]));
  try {
    Object.assign(process.env, { TMPDIR: t, TEMP: t, TMP: t });
    assert.throws(() => copyRepo(join(t, 'missing')), { code: 'ENOENT' });
    assert.deepEqual(readdirSync(t), []);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(t, { recursive: true, force: true });
  }
});

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

// release.mjs (--zip, unless args says otherwise) on a copy that setup changes first, with the normal
// PATH. Returns the run and the zip's entries.
const has = (cmd) => spawnSync(cmd, ['-v']).error?.code !== 'ENOENT';
const NO_ZIP = !(has('zip') && has('unzip')) && 'needs the zip and unzip commands';
function zipCopy(setup, args = ['--zip']) {
  const dir = copyRepo();
  try {
    setup(dir);
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'release.mjs'), ...args], { env: { ...process.env, PE_ROOT: dir }, encoding: 'utf8' });
    const zip = join(dir, 'dist', 'prompt-engine.zip');
    const entries = existsSync(zip) ? spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean) : [];
    return { code: r.status, out: r.stdout + r.stderr, entries };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// validate.mjs skips these files, so only release.mjs's -x list keeps them out of the zip: the
// ones Finder and Explorer write, and the AppleDouble files that macOS writes on some drives ("._"
// and the name of the file whose metadata they hold).
test('release.mjs --zip leaves out the files Finder, Explorer and macOS write', { skip: NO_ZIP }, () => {
  const r = zipCopy((dir) => {
    for (const f of OS_JUNK) for (const sub of ['', 'references']) writeFileSync(join(dir, 'skills', 'prompt-engine', sub, f), 'x');
    for (const f of ['._SKILL.md', '._references', 'references/._questions.md']) writeFileSync(join(dir, 'skills', 'prompt-engine', f), 'x');
  });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.entries.includes('prompt-engine/SKILL.md'), r.entries.join('\n'));
  assert.deepEqual(r.entries.filter((e) => OS_JUNK.has(e.split('/').at(-1)) || e.split('/').at(-1).startsWith('._')), []);
});

// zip -r adds to an archive that is already there and keeps the entries whose files are gone, so
// release.mjs removes an old zip first.
test('release.mjs --zip replaces an old dist/prompt-engine.zip instead of adding to it', { skip: NO_ZIP }, () => {
  const r = zipCopy((dir) => {
    const old = mkdtempSync(join(tmpdir(), 'pe-oldzip-'));
    try {
      mkdirSync(join(old, 'prompt-engine'));
      writeFileSync(join(old, 'prompt-engine', 'OLD.md'), '# Old\n');
      mkdirSync(join(dir, 'dist'));
      const z = spawnSync('zip', ['-q', '-r', join(dir, 'dist', 'prompt-engine.zip'), 'prompt-engine'], { cwd: old, encoding: 'utf8' });
      assert.equal(z.status, 0, z.stderr);
    } finally {
      rmSync(old, { recursive: true, force: true });
    }
  });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.entries.includes('prompt-engine/SKILL.md'), r.entries.join('\n'));
  assert.ok(!r.entries.includes('prompt-engine/OLD.md'), 'the old zip\'s entry is gone');
});

test('release.mjs --zip reads a plugin.json that starts with a byte-order mark', { skip: NO_ZIP }, () => {
  const r = zipCopy((dir) => {
    const file = join(dir, '.claude-plugin', 'plugin.json');
    writeFileSync(file, `\u{FEFF}${readFileSync(file, 'utf8')}`);
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^dist\/prompt-engine\.zip \(\d+ entries\)$/m);
});

// ---------- the command line and the tag check ----------
// release.yml passes the pushed tag as --tag. A form of it that release.mjs didn't read, or an
// argument it didn't know, built everything without the check. None of these runs gets past the
// command line or the tag check, so none needs zip, unzip or npm, and each passes --zip too, so
// that a release.mjs that misreads its arguments still stops before npm.
const VERSION = JSON.parse(readFileSync(join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version;
// Runs release.mjs on one copy with each list of arguments: check(code, output, the arguments as
// JSON) judges the run, and each run must stop before validate.mjs, without a stack trace or dist/.
function withArgs(argLists, check) {
  const dir = copyRepo();
  try {
    for (const args of argLists) {
      assert.ok(args.includes('--zip'), JSON.stringify(args));
      const r = spawnSync(process.execPath, [join(dir, 'scripts', 'release.mjs'), ...args], { env: { ...process.env, PE_ROOT: dir }, encoding: 'utf8' });
      const out = r.stdout + r.stderr;
      check(r.status, out, JSON.stringify(args));
      assert.doesNotMatch(out, /^\s+at |validate: OK/m, `${JSON.stringify(args)}: no stack trace, and stopped before validate.mjs`);
      assert.ok(!existsSync(join(dir, 'dist')), `${JSON.stringify(args)}: nothing was built`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('release.mjs checks a tag given as --tag <tag> or --tag=<tag>, before it builds anything', () => {
  assert.notEqual(VERSION, '9.9.9');
  // A version without its v doesn't match either.
  withArgs([['--tag', 'v9.9.9', '--zip'], ['--zip', '--tag=v9.9.9'], ['--tag', VERSION, '--zip']], (code, out, args) => {
    const tag = JSON.parse(args).find((a) => /\d/.test(a)).replace(/^--tag=/, '');
    assert.equal(code, 1, `${args}: ${out}`);
    assert.ok(out.startsWith(`tag ${tag} does not match plugin version v${VERSION}; bump .claude-plugin/plugin.json`), `${args}: ${out}`);
  });
});

test('release.mjs stops with its usage on an argument it doesn\'t know, or a --tag without one value', () => {
  withArgs([['--tag', '', '--zip'], ['--tag=', '--zip'], ['--zip', '--tag'], ['--tag', '--zip'], ['--tagg', 'v9.9.9', '--zip'], ['--zip', `v${VERSION}`],
    ['--tag', `v${VERSION}`, '--tag', 'v9.9.9', '--zip'], ['--zip', '--zip=yes']], (code, out, args) => {
    assert.equal(code, 2, `${args}: ${out}`);
    assert.match(out, /^usage: node scripts\/release\.mjs \[--zip\] \[--tag v<version>\]$/m, args);
  });
});

test('release.mjs --zip with the matching tag, in either form, builds the zip', { skip: NO_ZIP }, () => {
  for (const args of [['--zip', '--tag', `v${VERSION}`], [`--tag=v${VERSION}`, '--zip']]) {
    const r = zipCopy(() => {}, args);
    assert.equal(r.code, 0, `${JSON.stringify(args)}: ${r.out}`);
    assert.ok(r.entries.includes('prompt-engine/SKILL.md'), r.entries.join('\n'));
  }
});

// ---------- what a run checks before and after it builds ----------
// It ends with one line after validate.mjs's errors: execFileSync's throw printed a stack trace,
// with node's absolute path.
test('release.mjs stops when validate.mjs fails, before it builds anything, with one line', { skip: NO_ZIP }, () => {
  const r = zipCopy((dir) => writeFileSync(join(dir, '.mcp.json'), '{}\n'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^error: \.mcp\.json: not allowed at the repo root/m);
  assert.match(r.out, /\n\n1 error\(s\)\nrelease\.mjs stopped: node scripts\/validate\.mjs exited with code 1\n$/);
  assert.doesNotMatch(r.out, /^\s+at |Command failed/m, 'no stack trace');
  assert.deepEqual(r.entries, [], 'no zip');
});

test('release.mjs refuses a zip whose entries are not all under prompt-engine/', { skip: (process.platform === 'win32' && 'the stand-in for unzip is a shell script') || NO_ZIP }, () => {
  const dir = copyRepo();
  let bin;
  try {
    bin = mkdtempSync(join(tmpdir(), 'pe-unzip-'));
    // An unzip that lists the skill's files at the archive's root; zip stays the real one.
    writeFileSync(join(bin, 'unzip'), '#!/bin/sh\nprintf "SKILL.md\\nreferences/questions.md\\n"\n');
    chmodSync(join(bin, 'unzip'), 0o755);
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'release.mjs'), '--zip'], { env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, PE_ROOT: dir }, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /^zip layout is wrong: expected everything under prompt-engine\/$/m);
    assert.doesNotMatch(r.stdout, /dist\/prompt-engine\.zip \(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin, { recursive: true, force: true });
  }
});

test('release.mjs stops with one line when unzip fails, naming the zip by its path in the checkout', { skip: (process.platform === 'win32' && 'the stand-in for unzip is a shell script') || NO_ZIP }, () => {
  const dir = copyRepo();
  let bin;
  try {
    bin = mkdtempSync(join(tmpdir(), 'pe-unzip-'));
    writeFileSync(join(bin, 'unzip'), '#!/bin/sh\necho "unzip: cannot read the archive" >&2\nexit 9\n');
    chmodSync(join(bin, 'unzip'), 0o755);
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'release.mjs'), '--zip'], { env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, PE_ROOT: dir }, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /unzip: cannot read the archive\nrelease\.mjs stopped: unzip -Z1 dist\/prompt-engine\.zip exited with code 9\n$/);
    assert.doesNotMatch(r.stderr, /^\s+at |Command failed/m, 'no stack trace');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin, { recursive: true, force: true });
  }
});

test('release.mjs writes SHA256SUMS for every file it builds', { skip: NO_ZIP }, () => {
  const dir = copyRepo();
  try {
    // Without mcp/package.json there is no MCPB bundle to build, so npm never runs.
    rmSync(join(dir, 'mcp', 'package.json'));
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'release.mjs')], { env: { ...process.env, PE_ROOT: dir }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const sums = ['prompt-engine.zip', 'prompt-engine.md', 'prompt-engine-knowledge.md']
      .map((f) => `${createHash('sha256').update(readFileSync(join(dir, 'dist', f))).digest('hex')}  ${f}`);
    assert.equal(readFileSync(join(dir, 'dist', 'SHA256SUMS'), 'utf8'), `${sums.join('\n')}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
