// Tests for scripts/version.mjs, run against a temporary copy of the repository.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Build output and tool state the checks don't read: copying them only slows the tests down.
const SKIP = new Set(['.git', 'node_modules', 'results', 'dist', 'dist-mcpb', 'mcpb', '.wrangler']);

function copyRepo(from = repo) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-version-'));
  try {
    // The checkout itself is copied whatever its folder is called; SKIP applies to what's inside it.
    cpSync(from, dir, { recursive: true, filter: (src) => src === from || !SKIP.has(basename(src)) });
  } catch (e) {
    // A copy that fails (an unreadable file in the checkout, a full disk) leaves no folder behind.
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

const run = (dir, script, ...args) => {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', script), ...args], {
    env: { ...process.env, PE_ROOT: dir }, encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
};
const read = (dir, file) => readFileSync(join(dir, file), 'utf8');

test('copies a checkout in a folder named like a skipped entry, still without its build output', () => {
  const parent = mkdtempSync(join(tmpdir(), 'pe-rootname-'));
  let dir;
  try {
    const from = join(parent, 'mcpb');
    mkdirSync(join(from, 'mcp', 'dist'), { recursive: true });
    writeFileSync(join(from, 'LICENSE'), '');
    writeFileSync(join(from, 'mcp', 'dist', 'cli.js'), '');
    dir = copyRepo(from);
    assert.deepEqual(readdirSync(dir, { recursive: true }).sort(), ['LICENSE', 'mcp']);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

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

// A part with a leading zero isn't semver: npm publish refuses 01.2.3 (EBADSEMVER), though npm pack
// keeps it.
test('rejects a version that is not major.minor.patch, or has a leading zero, and changes nothing', () => {
  const dir = copyRepo();
  try {
    const before = read(dir, '.claude-plugin/plugin.json');
    for (const v of ['v1.0', '01.2.3', '1.02.3', '1.2.03']) {
      const r = run(dir, 'version.mjs', v);
      assert.equal(r.code, 2, `${v}: ${r.out}`);
      assert.match(r.out, /^usage: /, v);
      assert.equal(read(dir, '.claude-plugin/plugin.json'), before, v);
    }
    // 0 alone is a part without a leading zero.
    const ok = run(dir, 'version.mjs', '10.0.20');
    assert.equal(ok.code, 0, ok.out);
    assert.equal(JSON.parse(read(dir, '.claude-plugin/plugin.json')).version, '10.0.20');
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

// The lockfile is written back as JSON.stringify(lock, null, 2), so version.mjs refuses one in
// any other format instead of reformatting it, and changes no file.
test('changes nothing when mcp/package-lock.json has another format', () => {
  const dir = copyRepo();
  try {
    const lock = join(dir, 'mcp', 'package-lock.json');
    assert.ok(existsSync(lock), 'the copy has mcp/package-lock.json');
    writeFileSync(lock, `${JSON.stringify(JSON.parse(readFileSync(lock, 'utf8')), null, 4)}\n`);
    const files = ['.claude-plugin/plugin.json', 'skills/prompt-engine/SKILL.md', 'mcp/package.json', 'mcp/package-lock.json'];
    const before = files.map((f) => read(dir, f));
    const r = run(dir, 'version.mjs', '9.8.7');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^mcp\/package-lock\.json: unexpected formatting; run `npm version 9\.8\.7 --no-git-tag-version` in mcp\/ instead$/m);
    assert.deepEqual(files.map((f) => read(dir, f)), before, 'no file changed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets the version in a CRLF checkout, changing only the version lines', () => {
  const dir = copyRepo();
  try {
    const files = ['.claude-plugin/plugin.json', 'skills/prompt-engine/SKILL.md', 'mcp/package.json', 'mcp/package-lock.json', 'mcp/server.json', 'mcp/manifest.json'];
    for (const f of files) writeFileSync(join(dir, f), read(dir, f).replace(/\n/g, '\r\n'));
    const before = Object.fromEntries(files.map((f) => [f, read(dir, f).replace(/\r\n/g, '\n').split('\n')]));
    const bumped = run(dir, 'version.mjs', '9.8.7');
    assert.equal(bumped.code, 0, bumped.out);
    for (const f of files) {
      const after = read(dir, f).split('\n');
      assert.equal(after.length, before[f].length, f);
      const changed = after.filter((l, i) => l !== before[f][i]);
      assert.ok(changed.length > 0 && changed.every((l) => /9\.8\.7/.test(l)), `${f}: ${changed.join(' | ')}`);
    }
    const checked = run(dir, 'validate.mjs');
    assert.equal(checked.code, 0, checked.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps $$, $&, $' and $` in SKILL.md's frontmatter as they are", () => {
  const dir = copyRepo();
  try {
    const rel = 'skills/prompt-engine/SKILL.md';
    // A function replacer, so this setup doesn't expand the $ sequences itself.
    const description = "description: \"Use to improve a prompt for any AI tool: $$ $& $' $` stay as typed.\"";
    writeFileSync(join(dir, rel), read(dir, rel).replace(/^description: .*$/m, () => description));
    const before = read(dir, rel);
    assert.ok(before.includes(description), 'the setup wrote the description as typed');
    const bumped = run(dir, 'version.mjs', '9.8.7');
    assert.equal(bumped.code, 0, bumped.out);
    const after = read(dir, rel);
    assert.equal(after.match(/^description: .*$/m)[0], description);
    const versionLine = /^ {2}version: "[^"]*"$/m;
    assert.match(after, /^ {2}version: "9\.8\.7"$/m);
    assert.equal(after.replace(versionLine, ''), before.replace(versionLine, ''));
    const checked = run(dir, 'validate.mjs');
    assert.equal(checked.code, 0, checked.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a SKILL.md whose frontmatter Claude Code would end elsewhere, and changes nothing', () => {
  const dir = copyRepo();
  try {
    const rel = 'skills/prompt-engine/SKILL.md';
    const files = ['.claude-plugin/plugin.json', rel];
    const original = read(dir, rel);
    for (const variant of [(t) => t.replace(/\n---\n/, '\n--- \n'), (t) => t.replace(/\n---\n/, '\n----\n'), (t) => t.replace(/^ {2}version:/m, '  tag: a---b\n  version:')]) {
      writeFileSync(join(dir, rel), variant(original));
      const before = files.map((f) => read(dir, f));
      assert.notEqual(before[1], original);
      const r = run(dir, 'version.mjs', '9.8.7');
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /^skills\/prompt-engine\/SKILL\.md: frontmatter must open and close with a line of exactly "---"/m);
      assert.deepEqual(files.map((f) => read(dir, f)), before);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reminds about CHANGELOG.md until the version has a dated heading', () => {
  const dir = copyRepo();
  try {
    const changelog = join(dir, 'CHANGELOG.md');
    const reminder = /Next: give CHANGELOG\.md a "## \[9\.8\.7\] - YYYY-MM-DD" heading/;
    const withHeading = (heading, eol = '\n') =>
      writeFileSync(changelog, `# Changelog\n\n## [Unreleased]\n\n${heading}\n\nFirst version.\n`.replaceAll('\n', eol));
    // Undated, another version, a heading that only an unescaped "." would match, and one with
    // text after the date.
    for (const heading of ['## [9.8.7] - not yet released', '## [9.8.70] - 2026-11-10', '## [9x8x7] - 2026-11-10', '## [9.8.7] - 2026-11-10 [YANKED]']) {
      withHeading(heading);
      const r = run(dir, 'version.mjs', '9.8.7');
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, reminder, heading);
    }
    rmSync(changelog);
    const missing = run(dir, 'version.mjs', '9.8.7');
    assert.equal(missing.code, 0, missing.out);
    assert.match(missing.out, reminder, 'no CHANGELOG.md');
    for (const eol of ['\n', '\r\n']) {
      withHeading('## [9.8.7] - 2026-11-10', eol);
      const r = run(dir, 'version.mjs', '9.8.7');
      assert.equal(r.code, 0, r.out);
      assert.doesNotMatch(r.out, /Next: give CHANGELOG/, JSON.stringify(eol));
      assert.match(r.out, /Then run the checks and tag v9\.8\.7/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
