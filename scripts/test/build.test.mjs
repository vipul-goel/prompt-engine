// Tests for scripts/build.mjs, run against temporary copies of the repository: running it
// from unusual paths, and sources with CRLF line endings or a byte-order mark.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Build output and tool state the checks don't read: copying them only slows the tests down.
const SKIP = new Set(['.git', 'node_modules', 'results', 'dist', 'dist-mcpb', 'mcpb', '.wrangler']);
const copyTo = (dir) => cpSync(repo, dir, { recursive: true, filter: (src) => src === repo || !SKIP.has(basename(src)) });
const MEDIA = 'skills/prompt-engine/references/media-targets.md';
// The child finds its own root, as it does outside the tests.
const envWithoutRoot = () => { const env = { ...process.env }; delete env.PE_ROOT; return env; };
const node = (script, args = [], opts = {}) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: envWithoutRoot(), ...opts });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr };
};

test('build.mjs finds and rewrites stale files from a folder with a space, and through a symlink', () => {
  const parent = mkdtempSync(join(tmpdir(), 'pe build '));
  try {
    const dir = join(parent, 'has space');
    copyTo(dir);
    const link = join(parent, 'link');
    // A 'dir' symlink needs admin rights or Developer Mode on Windows; a junction doesn't.
    symlinkSync(dir, link, process.platform === 'win32' ? 'junction' : 'dir');
    for (const where of [dir, link]) {
      appendFileSync(join(dir, MEDIA), '\nstale\n');
      const check = node(join(where, 'scripts', 'build.mjs'), ['--check']);
      assert.equal(check.code, 1, `${where}: ${check.out}`);
      assert.match(check.stderr, /stale: skills\/prompt-engine\/references\/media-targets\.md/);
      const build = node(join(where, 'scripts', 'build.mjs'));
      assert.equal(build.code, 0, build.out);
      assert.doesNotMatch(readFileSync(join(dir, MEDIA), 'utf8'), /\nstale\n/);
      const again = node(join(where, 'scripts', 'build.mjs'), ['--check']);
      assert.equal(again.code, 0, again.out);
      assert.match(again.stdout, /generated files are up to date/);
    }
    // A relative path from the repository root, and `npm run generate`'s ../ path from mcp/.
    for (const [cwd, script] of [[dir, 'scripts/build.mjs'], [join(dir, 'mcp'), '../scripts/build.mjs']]) {
      const r = node(script, ['--check'], { cwd });
      assert.equal(r.code, 0, r.out);
      assert.match(r.stdout, /generated files are up to date/);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('importing build.mjs does not run it', () => {
  // With --check in process.argv, a main() that ran would print its verdict.
  const url = new URL('../build.mjs', import.meta.url).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)}); console.log('imported');`, '--', '--check'],
    { encoding: 'utf8', env: envWithoutRoot() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'imported\n');
  assert.equal(r.stderr, '');
});

// ---------- line endings and byte-order marks ----------
const toCrlf = (file) => writeFileSync(file, readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
const textFiles = (dir, sub) => readdirSync(join(dir, sub), { recursive: true })
  .map((f) => join(dir, sub, f))
  .filter((f) => statSync(f).isFile() && /\.(md|json|jsonl|ts)$/.test(f));
const HISTORIES = ['followup-ok-accepts-recommendations', 'followup-partial-answers', 'save-to-file'];

test('a CRLF checkout builds as up to date, and a rebuild writes LF text without copying the frontmatter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-crlf-'));
  try {
    copyTo(dir);
    const files = [...textFiles(dir, 'skills'), ...textFiles(dir, 'universal'), ...textFiles(dir, 'data'), ...textFiles(dir, 'evals'),
      join(dir, 'mcp/src/generated/content.ts'), join(dir, '.claude-plugin/plugin.json')];
    for (const f of files) toCrlf(f);
    for (const c of HISTORIES) assert.match(readFileSync(join(dir, 'evals', c, 'history.jsonl'), 'utf8'), /\r\n/, `${c} was converted`);
    const check = node(join(dir, 'scripts', 'build.mjs'), ['--check']);
    assert.equal(check.code, 0, check.out);
    const validate = node(join(dir, 'scripts', 'validate.mjs'));
    assert.equal(validate.code, 0, validate.out);
    // A real change: every generated file that depends on SKILL.md or a reference is rewritten.
    appendFileSync(join(dir, 'skills/prompt-engine/references/questions.md'), '\r\nOne more line.\r\n');
    appendFileSync(join(dir, 'skills/prompt-engine/SKILL.md'), '\r\nOne more line.\r\n');
    const build = node(join(dir, 'scripts', 'build.mjs'));
    assert.equal(build.code, 0, build.out);
    assert.match(build.stdout, /wrote mcp\/src\/generated\/content\.ts/);
    assert.doesNotMatch(readFileSync(join(dir, 'mcp/src/generated/content.ts'), 'utf8'), /\\r\\n|\r/);
    for (const c of HISTORIES) {
      const text = readFileSync(join(dir, 'evals', c, 'history.jsonl'), 'utf8');
      assert.doesNotMatch(text, /name: prompt-engine|\\r\\n|\r/, c);
      assert.match(text, /One more line\./, c);
    }
    const twice = node(join(dir, 'scripts', 'build.mjs'));
    assert.equal(twice.code, 0, twice.out);
    assert.doesNotMatch(twice.stdout, /wrote/, 'a second build changes nothing');
    const again = node(join(dir, 'scripts', 'validate.mjs'));
    assert.equal(again.code, 0, again.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a byte-order mark at the start of a source file changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-bom-'));
  try {
    copyTo(dir);
    for (const f of ['skills/prompt-engine/SKILL.md', 'data/media-targets.json', 'universal/prompt-engine.md']) {
      writeFileSync(join(dir, f), `\u{FEFF}${readFileSync(join(dir, f), 'utf8')}`);
    }
    const check = node(join(dir, 'scripts', 'build.mjs'), ['--check']);
    assert.equal(check.code, 0, check.out);
    const validate = node(join(dir, 'scripts', 'validate.mjs'));
    assert.equal(validate.code, 0, validate.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
