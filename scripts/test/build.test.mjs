// Tests for scripts/build.mjs: running it from unusual paths, sources with CRLF line endings or
// a byte-order mark, data it can't render, the knowledge file's headings, and keeping the skill
// text and Read results inside recorded histories up to date. Some run against temporary copies
// of the repository.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { KNOWLEDGE_ORDER, isEntryPoint, normalize, refreshHistory, renderKnowledge, renderMediaTargets, splitFrontmatter } from '../build.mjs';

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

// Any argument but --check meant "write": a misspelled --check, --check=true or a stray word
// rewrote the stale files and exited 0, so a check run with a typo passed, and validate.mjs then
// compared against the rewritten files.
test('build.mjs refuses an argument it does not know, and reads and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-build-args-'));
  try {
    copyTo(dir);
    appendFileSync(join(dir, MEDIA), '\nstale\n');
    const stale = readFileSync(join(dir, MEDIA), 'utf8');
    for (const args of [['--chekc'], ['--check=true'], ['-c'], ['--dry-run'], ['check'], ['--check', 'extra'], ['--', '--check']]) {
      const r = node(join(dir, 'scripts', 'build.mjs'), args);
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}`);
      assert.equal(r.stdout, '', args.join(' '));
      assert.match(r.stderr, /\nusage: node scripts\/build\.mjs \[--check\]\n$/, args.join(' '));
      assert.equal(readFileSync(join(dir, MEDIA), 'utf8'), stale, `${args.join(' ')}: the stale file was left as it was`);
    }
    const check = node(join(dir, 'scripts', 'build.mjs'), ['--check']);
    assert.equal(check.code, 1, check.out);
    assert.match(check.stderr, /stale: skills\/prompt-engine\/references\/media-targets\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('importing build.mjs does not run it, not even under node -e with its own path as the first argument', () => {
  // With --check in process.argv, a main() that ran would print its verdict. Under -e,
  // process.argv[1] is the first argument after the code, which can be build.mjs's own path.
  const url = new URL('../build.mjs', import.meta.url);
  for (const args of [['--', '--check'], [fileURLToPath(url), '--check']]) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url.href)}); console.log('imported');`, ...args],
      { encoding: 'utf8', env: envWithoutRoot() });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'imported\n', args[0]);
    assert.equal(r.stderr, '');
  }
});

// The fallback for Node without import.meta.main (before 22.18 and 24.2): the real-path comparison,
// and never under -e or -p. Node 22.19 and later set import.meta.main, so only a direct call reaches it.
test('isEntryPoint: import.meta.main decides where Node sets it; older Node never runs under -e or -p', () => {
  const self = fileURLToPath(new URL('../build.mjs', import.meta.url));
  assert.equal(isEntryPoint({ isMain: true, execArgv: ['-e', 'x'], argv1: undefined, self }), true);
  assert.equal(isEntryPoint({ isMain: false, execArgv: [], argv1: self, self }), false);
  assert.equal(isEntryPoint({ isMain: undefined, execArgv: [], argv1: self, self }), true);
  for (const execArgv of [['-e', 'x'], ['--input-type=module', '--eval', 'x'], ['--eval=x'], ['-p', 'x'], ['-pe', 'x'], ['--print', 'x']]) {
    assert.equal(isEntryPoint({ isMain: undefined, execArgv, argv1: self, self }), false, execArgv.join(' '));
  }
  assert.equal(isEntryPoint({ isMain: undefined, execArgv: [], argv1: join(repo, 'scripts', 'validate.mjs'), self }), false);
  assert.equal(isEntryPoint({ isMain: undefined, execArgv: [], argv1: undefined, self }), false);
});

// ---------- line endings and byte-order marks ----------
const toCrlf = (file) => writeFileSync(file, readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
const textFiles = (dir, sub) => readdirSync(join(dir, sub), { recursive: true })
  .map((f) => join(dir, sub, f))
  .filter((f) => statSync(f).isFile() && /\.(md|json|jsonl|ts)$/.test(f));
// Every eval case that resumes a recorded conversation.
const HISTORIES = readdirSync(join(repo, 'evals')).filter((c) => existsSync(join(repo, 'evals', c, 'history.jsonl')));

test('a CRLF checkout builds as up to date, and a rebuild writes LF text without copying the frontmatter', () => {
  assert.ok(HISTORIES.length >= 3, HISTORIES.join(', '));
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

// A file converted to CRLF twice ends its lines in CR CR LF. One pass of CR LF to LF left a CR LF
// there, which the build wrote and every later read dropped, so the build never settled.
test('normalize() reads a run of CRs before a LF as one line break, so a second pass changes nothing', () => {
  assert.equal(normalize('a\r\r\nb\r\nc\r\r\r\n\r\nd\re\r'), 'a\nb\nc\n\nd\re\r');
  for (const s of ['a\r\r\nb', 'a\r\r\r\n', '\u{FEFF}a\r\r\nb', 'a\rb\r\n\r', '\r\r\n\r\n']) {
    assert.equal(normalize(normalize(s)), normalize(s), JSON.stringify(s));
  }
});

// A run of CRs that no LF follows stays as it is, in time in step with the run: /\r+\n/ tried the
// rest of the run from each of its CRs, which took about a minute at 200,000 CRs, and every script
// reads its files through normalize(). In a child process, so that a slow pattern stops at the limit.
test('normalize() keeps a long run of CRs that no LF follows, in time in step with the run', () => {
  const build = pathToFileURL(join(repo, 'scripts', 'build.mjs')).href;
  const code = `const { normalize } = await import(${JSON.stringify(build)});
const run = '\\r'.repeat(200_000);
process.stdout.write(String(normalize(\`a\${run}b\${run}\\nc\`) === \`a\${run}b\\nc\`));`;
  const t0 = performance.now();
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.signal, null, `stopped after ${Math.round(performance.now() - t0)} ms`);
  assert.equal(r.stdout, 'true', r.stderr);
});

test('one build settles a reference line that ends in CR CR LF, and a data value that holds a written-out CR LF', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-crcrlf-'));
  try {
    copyTo(dir);
    const ref = join(dir, 'skills/prompt-engine/references/writing.md');
    const lines = readFileSync(ref, 'utf8').split('\n');
    lines[2] += '\r\r';
    writeFileSync(ref, lines.join('\n'));
    // A value with \r\n in its JSON string, which the build copies into references/media-targets.md.
    const file = join(dir, 'data/media-targets.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data.targets[0].notes = 'First line.\r\nSecond line.';
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    // And so into a recorded Read of that reference and the MCP server's copy of it, which the build
    // writes as it renders them, before any read of a file on disk could drop the CR.
    const recording = join(dir, 'evals/save-to-file/history.jsonl');
    const recorded = readFileSync(recording, 'utf8');
    const reads = recorded.replaceAll('/plugin/skills/prompt-engine/references/writing.md', `/plugin/${MEDIA}`);
    assert.notEqual(reads, recorded, 'the recording reads writing.md');
    writeFileSync(recording, reads);
    const build = node(join(dir, 'scripts', 'build.mjs'));
    assert.equal(build.code, 0, build.out);
    for (const p of [MEDIA, 'universal/prompt-engine-knowledge.md']) assert.doesNotMatch(readFileSync(join(dir, p), 'utf8'), /\r/, p);
    const texts = (c) => (typeof c === 'string' ? [c] : Array.isArray(c) ? c.flatMap((p) => (typeof p?.text === 'string' ? [p.text] : [])) : []);
    const results = readFileSync(recording, 'utf8').split('\n').filter(Boolean).flatMap((l) => JSON.parse(l).message?.content ?? [])
      .filter((part) => part?.type === 'tool_result').flatMap((part) => texts(part.content)).filter((t) => t.includes('First line.'));
    assert.ok(results.length > 0, 'the recorded Reads hold the media targets');
    for (const t of results) assert.doesNotMatch(t, /\r/);
    // The MCP content's copy of the reference, apart from the data as written (MEDIA_TARGETS).
    assert.ok(readFileSync(join(dir, 'mcp/src/generated/content.ts'), 'utf8').includes('**Note:** First line.\\nSecond line.'), 'the MCP content copies the note without its CR');
    const check = node(join(dir, 'scripts', 'build.mjs'), ['--check']);
    assert.equal(check.code, 0, check.out);
    const twice = node(join(dir, 'scripts', 'build.mjs'));
    assert.equal(twice.code, 0, twice.out);
    assert.doesNotMatch(twice.stdout, /wrote/, 'a second build changes nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a byte-order mark at the start of a source file changes nothing, though validate.mjs refuses one in SKILL.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-bom-'));
  try {
    copyTo(dir);
    for (const f of ['skills/prompt-engine/SKILL.md', 'data/media-targets.json', 'universal/prompt-engine.md']) {
      writeFileSync(join(dir, f), `\u{FEFF}${readFileSync(join(dir, f), 'utf8')}`);
    }
    const check = node(join(dir, 'scripts', 'build.mjs'), ['--check']);
    assert.equal(check.code, 0, check.out);
    // Some skill validators refuse a SKILL.md that doesn't start with "---" (validate.mjs says
    // which). With the mark read past everywhere else, that is the only error.
    const validate = node(join(dir, 'scripts', 'validate.mjs'));
    assert.equal(validate.code, 1, validate.out);
    assert.match(validate.stderr, /^error: skills\/prompt-engine\/SKILL\.md: starts with a byte-order mark[^\n]*\n\n1 error\(s\)$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- SKILL.md's frontmatter ----------
// Claude Code (2.1.319) ends the frontmatter at the first "---" after the opening line, wherever it is.
const SPLIT_RULE = 'frontmatter must open and close with a line of exactly "---", with no other "---" in between: Claude Code ends it at the first "---" after the opening line, even inside a value or in a line such as "--- " or "----"';

test('splitFrontmatter ends the frontmatter only where Claude Code ends it too', () => {
  const body = '# Title\n\nText.\n\n---\n\nMore.\n';
  assert.deepEqual(splitFrontmatter(`---\nname: x\n---\n${body}`), { front: 'name: x', body });
  // A blank line at the top, which Claude Code's \s* skips, and a closing line at the end of the file.
  assert.deepEqual(splitFrontmatter('---\n\nname: x\n---'), { front: '\nname: x', body: '' });
  // No frontmatter: no "---" first, or none that closes it.
  for (const text of [body, '---\nname: x\n']) assert.equal(splitFrontmatter(text), null, text);
  for (const text of ['---\nname: x\n--- \nbody', '---\nname: x\n----\nbody', '---\nname: "a --- b"\n---\nbody', '---\nmetadata:\n  tag: a---b\n---\nbody', '--- \nname: x\n---\nbody']) {
    assert.throws(() => splitFrontmatter(text), { message: SPLIT_RULE }, text);
  }
});

// splitFrontmatter as it was before it found Claude Code's close without its pattern: the
// reference for the linear search. Claude Code's pattern backtracked into a run of white space
// after the opening "---" once for each character, when no "---" followed.
const referenceSplit = (text) => {
  const strict = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const close = text.match(/^---\s*\n[\s\S]*?(?=---)/)?.[0].length;
  if (!strict && close === undefined) return null;
  if (!strict || close !== strict[1].length + 5) return 'throws';
  return { front: strict[1], body: text.slice(strict[0].length) };
};

test('splitFrontmatter finds Claude Code\'s close as its pattern does, in time in step with the text', () => {
  // Every text of one to six of these pieces, white space that \s matches among them.
  const pieces = ['---', '-', '\n', ' ', '\r', '\u{A0}', 'x'];
  let texts = [''];
  for (let n = 1; n <= 6; n++) {
    texts = texts.flatMap((t) => pieces.map((p) => t + p));
    for (const text of texts) {
      let got;
      try { got = splitFrontmatter(text); } catch (e) { assert.equal(e.message, SPLIT_RULE); got = 'throws'; }
      assert.deepEqual(got, referenceSplit(text), JSON.stringify(text));
    }
  }
  const t0 = performance.now();
  for (const run of ['\n', ' \n', '\n\t']) assert.equal(splitFrontmatter(`---\n${run.repeat(100_000)}name: x\n`), null, JSON.stringify(run));
  assert.ok(performance.now() - t0 < 1_000, `${Math.round(performance.now() - t0)} ms`);
});

test('build.mjs stops on a SKILL.md whose frontmatter Claude Code would end elsewhere, and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-front-'));
  try {
    copyTo(dir);
    const skill = join(dir, 'skills/prompt-engine/SKILL.md');
    const original = readFileSync(skill, 'utf8');
    const histories = () => HISTORIES.map((c) => readFileSync(join(dir, 'evals', c, 'history.jsonl'), 'utf8'));
    const before = histories();
    for (const variant of [original.replace(/\n---\n/, '\n--- \n'), original.replace(/\n---\n/, '\n----\n'), original.replace(/^description: "/m, 'description: "--- ')]) {
      assert.notEqual(variant, original);
      writeFileSync(skill, variant);
      for (const args of [[], ['--check']]) {
        const r = node(join(dir, 'scripts', 'build.mjs'), args);
        assert.equal(r.code, 1, r.out);
        assert.equal(r.stdout, '');
        assert.equal(r.stderr, `build failed: skills/prompt-engine/SKILL.md: ${SPLIT_RULE}\n`);
      }
      assert.deepEqual(histories(), before, 'no history changed');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- data the build can't render ----------
test('renderMediaTargets names the entry it cannot render', () => {
  const data = (over) => ({ targets: [{ id: 'midjourney', name: 'Midjourney', kind: 'image', status: 'verified', last_verified: '2026-10-29', sources: ['https://example.com/docs'], ...over }] });
  assert.match(renderMediaTargets(data({})), /^## Midjourney$/m);
  assert.throws(() => renderMediaTargets(data({ status: 'verifed' })), { message: 'media-targets: unknown status "verifed" for midjourney' });
  assert.throws(() => renderMediaTargets(data({ sources: undefined })), { message: 'media-targets: midjourney needs a sources array' });
  // The fields it writes into the Markdown, which a missing or misspelled key turned into "undefined".
  for (const [key, what] of [['name', 'a name'], ['kind', 'a kind'], ['last_verified', 'a last_verified date']]) {
    for (const value of [undefined, ' ', 5]) {
      assert.throws(() => renderMediaTargets(data({ [key]: value })), { message: `media-targets: midjourney needs ${what}` }, `${key}: ${value}`);
    }
  }
});

test('build.mjs reports data it cannot render in one line, without a stack trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-baddata-'));
  try {
    copyTo(dir);
    const file = join(dir, 'data/media-targets.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data.targets[0].status = 'verifed';
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    for (const args of [[], ['--check']]) {
      const r = node(join(dir, 'scripts', 'build.mjs'), args);
      assert.equal(r.code, 1, r.out);
      assert.equal(r.stdout, '', `build.mjs ${args.join(' ')}`);
      assert.equal(r.stderr, `build failed: media-targets: unknown status "verifed" for ${data.targets[0].id}\n`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The shape checks before a render: lint rules or media targets that aren't a list, and a media
// target that isn't an entry. Without them, the build stopped with "rules is not iterable",
// "data.targets.entries is not a function", "Cannot read properties of undefined (reading
// 'entries')" or "Cannot read properties of null (reading 'status')", which named neither the file
// nor the entry, and no other test noticed.
test('build.mjs names lint rules and media targets that are not a list, and a media target that is not an entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-badshape-'));
  try {
    copyTo(dir);
    for (const [file, change, message] of [
      ['data/lint-rules.json', (j) => { j.rules = {}; }, 'data/lint-rules.json: rules must be a list of rules'],
      ['data/media-targets.json', (j) => { j.targets[0] = null; }, 'media-targets: targets[0] is not an entry'],
      ['data/media-targets.json', (j) => { j.targets = {}; }, 'media-targets: targets must be a list of entries'],
      ['data/media-targets.json', (j) => { delete j.targets; }, 'media-targets: targets must be a list of entries'],
    ]) {
      const path = join(dir, file);
      const before = readFileSync(path, 'utf8');
      const data = JSON.parse(before);
      change(data);
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
      for (const args of [[], ['--check']]) {
        const r = node(join(dir, 'scripts', 'build.mjs'), args);
        assert.equal(r.code, 1, r.out);
        assert.equal(r.stdout, '', `${file}, build.mjs ${args.join(' ')}`);
        assert.equal(r.stderr, `build failed: ${message}\n`);
      }
      writeFileSync(path, before);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build.mjs names a JSON file it reads that does not parse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-badjson-'));
  try {
    copyTo(dir);
    for (const f of ['data/media-targets.json', 'data/lint-rules.json', 'data/contract.json', '.claude-plugin/plugin.json']) {
      const before = readFileSync(join(dir, f), 'utf8');
      writeFileSync(join(dir, f), before.replace('\n', '\n<<<<<<< HEAD\n'));
      const r = node(join(dir, 'scripts', 'build.mjs'), ['--check']);
      assert.equal(r.code, 1, r.out);
      assert.match(r.stderr, new RegExp(`^build failed: ${f.replace(/\./g, '\\.')}: [^\\n]*JSON[^\\n]*\\n$`), f);
      writeFileSync(join(dir, f), before);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- the knowledge file ----------
test('the knowledge file demotes headings but not "# " lines inside fenced blocks', () => {
  const refs = Object.fromEntries(KNOWLEDGE_ORDER.map((k) => [k, `# ${k}\n\nText.\n`]));
  refs.coding = '# Coding\n\n## Steps\n\n```bash\n# a shell comment\n## not a heading\n```\n\n~~~\n# tilde fence\n~~~\n\n### After\n';
  const out = renderKnowledge(refs);
  for (const line of ['## Coding', '### Steps', '#### After', '# a shell comment', '## not a heading', '# tilde fence']) {
    assert.match(out, new RegExp(`^${line}$`, 'm'), line);
  }
});

// A fence closes only the block that a fence of its own kind, at least as long, opened; and a
// level-6 heading has no level below it, so it stays as it is.
test('the knowledge file keeps a block open past a shorter fence inside it, and leaves level-6 headings alone', () => {
  const refs = Object.fromEntries(KNOWLEDGE_ORDER.map((k) => [k, `# ${k}\n\nText.\n`]));
  refs.coding = '# Coding\n\n````markdown\n```text\n# inside the outer block\n```\n# still inside it\n````\n\n##### Five\n###### Six\n';
  const out = renderKnowledge(refs);
  for (const line of ['# inside the outer block', '# still inside it', '###### Five', '###### Six']) assert.match(out, new RegExp(`^${line}$`, 'm'), line);
  assert.doesNotMatch(out, /^#{7}/m);
});

// CommonMark's fence rules (fenceAfter): a fence indented up to three spaces opens and closes a block,
// a line that only starts with the opening run doesn't close it, and a line of backticks that holds
// another backtick opens none.
test('the knowledge file reads fenced blocks as CommonMark does: indented fences, closing lines and lines that open none', () => {
  const refs = Object.fromEntries(KNOWLEDGE_ORDER.map((k) => [k, `# ${k}\n\nText.\n`]));
  refs.coding = [
    '# Coding', '',
    ' ```text', '## in a fence indented one space', ' ```', '',
    '   ~~~', '## in a ~~~ fence indented three spaces', '   ~~~', '',
    '```text', '``` example', '## after a line that only starts with the opening fence', '```', '',
    '```', 'x', '   ```', '## after a block closed three spaces in', '',
    '``` not `a` fence', '## after a line that opens no block', '',
  ].join('\n');
  const lines = renderKnowledge(refs).split('\n');
  for (const line of ['## in a fence indented one space', '## in a ~~~ fence indented three spaces', '## after a line that only starts with the opening fence',
    '### after a block closed three spaces in', '### after a line that opens no block']) assert.ok(lines.includes(line), line);
});

// ---------- refreshHistory: the skill text and Read results inside recorded histories ----------
const HEAD = 'Base directory for this skill: /plugin/skills/prompt-engine\n\n';
const readText = (p) => normalize(readFileSync(join(repo, p), 'utf8'));
const body = readText('skills/prompt-engine/SKILL.md').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const readPluginFile = (p) => (existsSync(join(repo, p)) ? readText(p) : undefined);
const history = (c) => readText(`evals/${c}/history.jsonl`);
const refresh = (jsonl, b = body) => refreshHistory(jsonl, b, readPluginFile);
const partsOf = (jsonl) => jsonl.split('\n').filter((l) => l.trim()).flatMap((l) => {
  const c = JSON.parse(l).message?.content;
  return Array.isArray(c) ? c : [];
});
const skillText = (jsonl) => partsOf(jsonl).find((p) => p.type === 'text' && p.text.startsWith(HEAD))?.text;
// The skill text as Claude Code writes it: the head, the body, a newline and, when there are
// arguments, a line with them.
const expected = (b, args) => `${HEAD}${b}\n${args ? `\n\nARGUMENTS: ${args}` : ''}`;
const ARGS = 'write a blog post about remote work';
// A body that differs from the current one at its end.
const OLD_BODY = `${body}\n\n- A rule that was removed later.`;

// The arguments a recording invoked the skill with: a typed command's <command-args>, or the
// Skill call's input.args.
function recordedArgs(jsonl) {
  for (const l of jsonl.split('\n').filter((x) => x.trim())) {
    const c = JSON.parse(l).message?.content;
    if (typeof c === 'string' && c.includes('<command-name>/prompt-engine')) return c.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '';
    for (const p of Array.isArray(c) ? c : []) if (p.type === 'tool_use' && p.name === 'Skill') return p.input.args ?? '';
  }
}

// The follow-up recording with its skill text replaced, and the Skill call's arguments set
// (or removed, for undefined).
function variant(text, args) {
  return history('followup-ok-accepts-recommendations').split('\n').map((l) => {
    if (!l.trim()) return l;
    const r = JSON.parse(l);
    for (const p of Array.isArray(r.message?.content) ? r.message.content : []) {
      if (p.type === 'tool_use' && p.name === 'Skill') { if (args === undefined) delete p.input.args; else p.input.args = args; }
      if (p.type === 'text' && p.text.startsWith(HEAD)) p.text = text;
    }
    return JSON.stringify(r);
  }).join('\n');
}

test('the committed histories hold exactly the current skill text, and refreshing them changes nothing', () => {
  const cases = readdirSync(join(repo, 'evals')).filter((c) => existsSync(join(repo, 'evals', c, 'history.jsonl')));
  assert.ok(cases.length >= 3, cases.join(', '));
  for (const c of cases) {
    const h = history(c);
    assert.equal(skillText(h), expected(body, recordedArgs(h)), c);
    assert.equal(refresh(h), h, c);
  }
});

test('a recording without arguments gets the whole current body, whatever the old one was', () => {
  const nearTop = body.replace(/^.*$/m, (line) => `${line} (old title)`);
  for (const old of [OLD_BODY, nearTop, body]) {
    const once = refresh(variant(`${HEAD}${old}\n`, undefined));
    assert.equal(skillText(once), expected(body, ''));
    assert.equal(refresh(once), once);
  }
  assert.notEqual(nearTop, body);
});

test('text before the H1 is copied once, and a body without an H1 still takes later edits', () => {
  const noted = `<!-- note -->\n\n${body}`;
  const once = refresh(variant(expected(body, ARGS), ARGS), noted);
  assert.equal(skillText(once), expected(noted, ARGS));
  assert.equal(refresh(once, noted), once);
  const noH1 = body.replace(/^# .*\n+/, '');
  assert.notEqual(noH1, body);
  const edited = refresh(refresh(variant(expected(body, ARGS), ARGS), noH1), `${noH1}\nREVISED`);
  assert.equal(skillText(edited), expected(`${noH1}\nREVISED`, ARGS));
});

test('arguments that contain "ARGUMENTS:" survive intact', () => {
  const a = 'improve this: ARGUMENTS: list the steps\n\nARGUMENTS: and this';
  const once = refresh(variant(expected(OLD_BODY, a), a));
  assert.equal(skillText(once), expected(body, a));
  assert.equal(refresh(once), once);
});

// The white space at the end of the old body is found in time in step with its length: a pattern
// tried from each character of a long run of spaces inside the body took quadratic time, about a
// minute at 200,000 characters.
test('refreshing skill text with a long run of spaces inside it is fast', () => {
  const t0 = performance.now();
  refresh(variant(`${HEAD}a${' '.repeat(200_000)}b\n`, undefined));
  assert.ok(performance.now() - t0 < 2_000, `${Math.round(performance.now() - t0)} ms`);
});

// A typed command's arguments are found with indexOf: a lazy pattern tried the rest of the text
// from each <command-args> that nothing closed, which took quadratic time, several seconds at
// 500,000 characters.
test('refreshing a typed command with a long run of unclosed <command-args> tags is fast', () => {
  const typed = JSON.stringify({ type: 'user', message: { role: 'user', content: `<command-name>/prompt-engine</command-name>\n${'<command-args>x '.repeat(32_000)}` } });
  const t0 = performance.now();
  assert.equal(refreshHistory(typed, 'BODY', () => undefined), typed);
  assert.ok(performance.now() - t0 < 2_000, `${Math.round(performance.now() - t0)} ms`);
});

test('the old body\'s trailing white space is kept', () => {
  const once = refresh(variant(`${HEAD}${OLD_BODY}\n\n`, undefined));
  assert.equal(skillText(once), `${HEAD}${body}\n\n`);
  assert.equal(refresh(once), once);
});

test('without arguments, an empty ARGUMENTS line is kept, and any other is refused', () => {
  const once = refresh(variant(`${HEAD}${OLD_BODY}\n\n\nARGUMENTS: `, ''));
  assert.equal(skillText(once), `${HEAD}${body}\n\n\nARGUMENTS: `);
  assert.equal(refresh(once), once);
  for (const line of ['ARGUMENTS:', 'ARGUMENTS: write a post']) {
    assert.throws(() => refresh(variant(`${HEAD}${OLD_BODY}\n\n\n${line}`, '')), { message: 'no arguments were recorded, but the skill text ends with an ARGUMENTS line; re-record it' }, line);
  }
});

test('an ARGUMENTS line that Claude Code escaped is kept as it is', () => {
  // Claude Code escapes some characters, such as a "!" after a space, in the line it appends.
  const once = refresh(variant(`${HEAD}${OLD_BODY}\n\n\nARGUMENTS: mon nouveau poste \\!`, 'mon nouveau poste !'));
  assert.equal(skillText(once), `${HEAD}${body}\n\n\nARGUMENTS: mon nouveau poste \\!`);
  assert.equal(refresh(once), once);
});

test('a slash command with empty or no arguments is refreshed', () => {
  for (const args of ['<command-args></command-args>', '']) {
    const h = history('save-to-file').split('\n').map((l) => {
      if (!l.trim()) return l;
      const r = JSON.parse(l);
      if (typeof r.message?.content === 'string') r.message.content = r.message.content.replace(/<command-args>[\s\S]*?<\/command-args>/, args);
      for (const p of Array.isArray(r.message?.content) ? r.message.content : []) if (p.type === 'text' && p.text.startsWith(HEAD)) p.text = `${HEAD}OLD BODY\n`;
      return JSON.stringify(r);
    }).join('\n');
    assert.match(h, /<command-name>\/prompt-engine/);
    const once = refresh(h);
    assert.equal(skillText(once), expected(body, ''), args || 'no <command-args>');
    assert.equal(refresh(once), once);
  }
});

// refreshHistory also reads a typed slash command whose message content is a list of text parts.
test('a slash command recorded as text parts is refreshed like one recorded as a string', () => {
  const original = history('save-to-file');
  const args = recordedArgs(original);
  const h = original.split('\n').map((l) => {
    if (!l.trim()) return l;
    const r = JSON.parse(l);
    if (typeof r.message?.content === 'string' && r.message.content.includes('<command-name>/prompt-engine')) r.message.content = [{ type: 'text', text: r.message.content }];
    for (const p of Array.isArray(r.message?.content) ? r.message.content : []) if (p.type === 'text' && p.text.startsWith(HEAD)) p.text = expected('OLD BODY', args);
    return JSON.stringify(r);
  }).join('\n');
  assert.ok(partsOf(h).some((p) => p.type === 'text' && p.text.includes('<command-name>/prompt-engine')), 'the command is a text part');
  assert.equal(skillText(refresh(h)), expected(body, args));
});

test("another skill's text is left alone, and its Skill call sets no arguments", () => {
  // The recording's only Skill call is for another skill: prompt-engine's text has no invocation.
  const other = history('followup-ok-accepts-recommendations').split('\n').map((l) => {
    if (!l.trim()) return l;
    const r = JSON.parse(l);
    for (const p of Array.isArray(r.message?.content) ? r.message.content : []) if (p.type === 'tool_use' && p.name === 'Skill') p.input = { skill: 'other', args: 'x' };
    return JSON.stringify(r);
  }).join('\n');
  assert.throws(() => refresh(other), { message: 'skill text without a recorded prompt-engine invocation; re-record it' });
  for (const dir of ['/plugin/skills/other', '/home/u/.claude/skills/other']) {
    const other = JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: `Base directory for this skill: ${dir}\n\n# Other\n\nDo it.\n` }] } });
    assert.equal(refresh(other), other, dir);
  }
});

test('skill text it cannot refresh exactly is refused, so it is recorded again', () => {
  assert.throws(() => refresh(variant(`${HEAD}${body}\n`, ARGS)), { message: 'arguments were recorded, but the skill text has no ARGUMENTS line; re-record it' });
  const noCall = JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: expected(body, ARGS) }] } });
  assert.throws(() => refresh(noCall), { message: 'skill text without a recorded prompt-engine invocation; re-record it' });
  for (const dir of ['/home/al/src/prompt-engine/skills/prompt-engine', 'C:\\dev\\prompt-engine\\skills\\prompt-engine']) {
    const unrewritten = variant(expected(body, ARGS).replace('/plugin/skills/prompt-engine', dir), ARGS);
    assert.throws(() => refresh(unrewritten), { message: 'the skill text names a plugin path other than /plugin; record it with scripts/eval/record-history.mjs' }, dir);
  }
});

// A Read of a reference file and its result, with Claude Code's own copy of the file.
const REL = 'skills/prompt-engine/references/questions.md';
const jsonl = (...rows) => rows.map((r) => JSON.stringify(r)).join('\n');
const readUse = (input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input }] } });
const readResult = (content, extra = {}) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content, ...extra }] },
  toolUseResult: { type: 'text', file: { filePath: `/plugin/${REL}`, content: 'OLD', numLines: 1, startLine: 1, totalLines: 1 } },
});
const files = (map) => (rel) => map[rel];

test('refreshes the Read result and Claude Code\'s copy of the file together', () => {
  const out = refreshHistory(jsonl(readUse({ file_path: `/plugin/${REL}` }), readResult('1\tOLD')), 'BODY', files({ [REL]: 'NEW\nTEXT\n' }));
  const row = JSON.parse(out.split('\n')[1]);
  assert.equal(row.message.content[0].content, '1\tNEW\n2\tTEXT\n3\t');
  assert.deepEqual(row.toolUseResult.file, { filePath: `/plugin/${REL}`, content: 'NEW\nTEXT\n', numLines: 3, startLine: 1, totalLines: 3 });
  assert.deepEqual(Object.keys(row.toolUseResult.file), ['filePath', 'content', 'numLines', 'startLine', 'totalLines']);
  assert.equal(refreshHistory(out, 'BODY', files({ [REL]: 'NEW\nTEXT\n' })), out);
});

test('refreshes Claude Code\'s copy of a file when only that copy is stale', () => {
  // As in both follow-up histories before step 1c: the Read result was current, its copy was not.
  const rel = 'skills/prompt-engine/references/output-format.md';
  const h = history('followup-partial-answers');
  const stale = h.split('\n').map((l) => {
    if (!l.trim()) return l;
    const r = JSON.parse(l);
    if (r.toolUseResult?.file?.filePath === `/plugin/${rel}`) r.toolUseResult.file.content = 'STALE COPY';
    return JSON.stringify(r);
  }).join('\n');
  assert.notEqual(stale, h);
  assert.equal(refresh(stale), h);
  const current = readText(rel);
  const copy = h.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).find((r) => r.toolUseResult?.file?.filePath === `/plugin/${rel}`).toolUseResult.file;
  assert.equal(copy.content, current);
  assert.equal(copy.numLines, current.split('\n').length);
  assert.equal(copy.totalLines, current.split('\n').length);
});

test('refuses a Read of a path with a ".." segment, which would copy a file from outside the plugin', () => {
  for (const rel of ['../outside.txt', 'skills/../../outside.txt', 'skills\\..\\..\\outside.txt']) {
    assert.throws(() => refreshHistory(jsonl(readUse({ file_path: `/plugin/${rel}` }), readResult('1\tOLD')), 'BODY', files({ [rel]: 'OUTSIDE SECRET' })),
      { message: `reads ${rel}, outside the plugin; re-record it` }, rel);
  }
});

test('refuses a Read of a file outside the skill\'s folder, which a refresh would copy into the history from disk', () => {
  // An untracked .env, the checkout's own git config, a file that a link in a case folder leads
  // to, and other files of the repository: none of them is the skill's, so none is refreshed.
  for (const rel of ['.env', '.git/config', 'evals/x/fixtures/notes.txt', 'README.md', 'skills/other/SKILL.md', 'skills/prompt-engine-x/notes.md']) {
    assert.throws(() => refreshHistory(jsonl(readUse({ file_path: `/plugin/${rel}` }), readResult('1\tOLD')), 'BODY', files({ [rel]: 'LOCAL TEXT' })),
      { message: `reads ${rel}, outside the skill's folder; re-record it` }, rel);
  }
});

// Only the skill's own files are refreshed. Another file in its folder is refused before it is read:
// a refresh copied its text from disk into the history. It can be a file the operating system wrote
// there, which git ignores and validate.mjs skips, so that no check noticed the copy, or an untracked
// note. A name in another letter case is refused too: on macOS and Windows it opened the skill's file.
test('refuses a Read of a file in the skill\'s folder that isn\'t one of the skill\'s files, without reading it', () => {
  const asked = [];
  const reader = (rel) => { asked.push(rel); return 'LOCAL TEXT'; };
  for (const name of ['.DS_Store', '._SKILL.md', 'Thumbs.db', 'desktop.ini', 'references/.DS_Store', 'references/._writing.md', 'references/notes.md', 'SKILL copy.md', 'references/Writing.md']) {
    const rel = `skills/prompt-engine/${name}`;
    assert.throws(() => refreshHistory(jsonl(readUse({ file_path: `/plugin/${rel}` }), readResult('1\tOLD')), 'BODY', reader),
      { message: `reads ${rel}, which isn't one of the skill's files (SKILL.md or a reference that KNOWLEDGE_ORDER lists); re-record it` }, rel);
  }
  assert.deepEqual(asked, []);
  for (const rel of ['skills/prompt-engine/SKILL.md', ...KNOWLEDGE_ORDER.map((k) => `skills/prompt-engine/references/${k}.md`)]) {
    const out = refreshHistory(jsonl(readUse({ file_path: `/plugin/${rel}` }), readResult('1\tOLD')), 'BODY', files({ [rel]: 'NEW' }));
    assert.equal(JSON.parse(out.split('\n')[1]).message.content[0].content, '1\tNEW', rel);
  }
});

test('build.mjs refuses a recorded Read of a file the operating system wrote into the skill\'s folder, and changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-junk-'));
  try {
    copyTo(dir);
    const junk = 'skills/prompt-engine/.DS_Store';
    writeFileSync(join(dir, junk), 'LOCAL TEXT\n');
    const h = join(dir, 'evals/followup-partial-answers/history.jsonl');
    writeFileSync(h, `${jsonl(readUse({ file_path: `/plugin/${junk}` }), readResult('1\tOLD'))}\n${readFileSync(h, 'utf8')}`);
    const before = readFileSync(h, 'utf8');
    const r = node(join(dir, 'scripts', 'build.mjs'));
    assert.equal(r.code, 1, r.out);
    assert.equal(r.stderr, `build failed: evals/followup-partial-answers/history.jsonl: reads ${junk}, which isn't one of the skill's files (SKILL.md or a reference that KNOWLEDGE_ORDER lists); re-record it\n`);
    assert.equal(readFileSync(h, 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build.mjs never copies a file that a link in the skill\'s folder leads to from outside it', { skip: process.platform === 'win32' && 'links need extra rights on Windows' }, () => {
  const parent = mkdtempSync(join(tmpdir(), 'pe-link-'));
  try {
    const dir = join(parent, 'repo');
    copyTo(dir);
    writeFileSync(join(parent, 'notes.txt'), 'OUTSIDE TEXT\n');
    // One of the skill's own files, which a refresh reads, made a link; no committed history reads it.
    const link = 'skills/prompt-engine/references/research.md';
    rmSync(join(dir, link));
    symlinkSync(join(parent, 'notes.txt'), join(dir, link));
    const h = join(dir, 'evals/followup-partial-answers/history.jsonl');
    writeFileSync(h, `${jsonl(readUse({ file_path: `/plugin/${link}` }), readResult('1\tOLD'))}\n${readFileSync(h, 'utf8')}`);
    const before = readFileSync(h, 'utf8');
    const r = node(join(dir, 'scripts', 'build.mjs'));
    assert.equal(r.code, 1, r.out);
    assert.equal(r.stderr, `build failed: evals/followup-partial-answers/history.jsonl: ${link} leads out of the skill's folder through a link, and only the skill's own files are copied into a recording\n`);
    assert.equal(readFileSync(h, 'utf8'), before);
    assert.doesNotMatch(readFileSync(h, 'utf8'), /OUTSIDE TEXT/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('refuses a Read it cannot refresh exactly: part of a file, a file that no longer exists, a result that is not text', () => {
  for (const extra of [{ offset: 4 }, { limit: 2 }, { offset: 4, limit: 2 }]) {
    assert.throws(() => refreshHistory(jsonl(readUse({ file_path: `/plugin/${REL}`, ...extra }), readResult('4\tOLD')), 'BODY', files({ [REL]: 'NEW' })),
      { message: `reads part of ${REL} (offset/limit); re-record it` }, JSON.stringify(extra));
  }
  assert.throws(() => refreshHistory(jsonl(readUse({ file_path: `/plugin/${REL}` }), readResult('1\tOLD')), 'BODY', files({})),
    { message: `reads ${REL}, which no longer exists; re-record it` });
  assert.throws(() => refreshHistory(jsonl(readUse({ file_path: `/plugin/${REL}` }), readResult([{ type: 'text', text: '1\tOLD' }])), 'BODY', files({ [REL]: 'NEW' })),
    { message: `has a Read result for ${REL} that isn't text; re-record it` });
});

test('leaves a failed Read as it was recorded', () => {
  const input = jsonl(readUse({ file_path: `/plugin/${REL}` }), readResult('File does not exist.', { is_error: true }));
  assert.equal(refreshHistory(input, 'BODY', files({ [REL]: 'NEW' })), input);
  assert.equal(refreshHistory(input, 'BODY', files({})), input);
});

// Claude Code writes one JSON object per line. The checks in eval-cases.mjs skip a line that isn't
// one, such as a list nested 200,000 levels deep, and a null row stopped the build with a
// TypeError. The message names the line in the file: JSON.parse's own counts lines in the row.
test('refuses a line that does not parse or is not a JSON object, and names its line', () => {
  const start = `${jsonl(readUse({ file_path: `/plugin/${REL}` }))}\n\n`;
  for (const row of ['[]', '1', '"x"', 'null', 'true', `${'['.repeat(200_000)}${']'.repeat(200_000)}`]) {
    assert.throws(() => refreshHistory(`${start}${row}\n`, 'BODY', files({})), { message: 'line 3 is not a JSON object; re-record it' }, row.slice(0, 12));
  }
  assert.throws(() => refreshHistory(`${start}{\n`, 'BODY', files({})), { message: /^line 3: [^\n]*JSON at position 1; re-record it$/ });
  assert.throws(() => refreshHistory(`${start}{"type":`, 'BODY', files({})), { message: /^line 3: [^\n]*JSON[^\n]*; re-record it$/ });
});

// A row that is an object can still hold content that Claude Code never writes: a part that isn't
// an object, or a text part without text. Each stopped the build with JavaScript's own message,
// which named neither the line nor what to do, or passed without a word.
test('refuses a row whose content holds a part that is not an object, or a text part without text, and names its line', () => {
  const start = `${jsonl(readUse({ file_path: `/plugin/${REL}` }))}\n\n`;
  const row = (role, content) => JSON.stringify({ type: role, message: { role, content } });
  for (const part of [null, 1, 'x', true, []]) {
    for (const role of ['user', 'assistant']) {
      assert.throws(() => refreshHistory(`${start}${row(role, [{ type: 'text', text: 'hi' }, part])}\n`, 'BODY', files({})),
        { message: 'line 3: a content part is not an object; re-record it' }, `${role}: ${JSON.stringify(part)}`);
    }
  }
  for (const text of [undefined, null, 5, ['x']]) {
    assert.throws(() => refreshHistory(`${start}${row('assistant', [{ type: 'text', text }])}\n`, 'BODY', files({})),
      { message: 'line 3: a text part whose text is not a string; re-record it' }, JSON.stringify(text));
  }
});

// media-targets.md is generated and copied into recorded Reads in the same run, so the Reads get
// the new render rather than the file still on disk, and one build settles. No committed recording
// reads it yet, so the copy's save-to-file recording reads it in place of writing.md.
test('one build gives the recorded Reads of media-targets.md the new render', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-media-reads-'));
  try {
    copyTo(dir);
    const recording = join(dir, 'evals/save-to-file/history.jsonl');
    const before = readFileSync(recording, 'utf8');
    const reads = before.replaceAll('/plugin/skills/prompt-engine/references/writing.md', '/plugin/skills/prompt-engine/references/media-targets.md');
    assert.notEqual(reads, before, 'the recording reads writing.md');
    writeFileSync(recording, reads);
    const file = join(dir, 'data/media-targets.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data.targets[0].notes = 'A note added by the test.';
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    const build = node(join(dir, 'scripts', 'build.mjs'));
    assert.equal(build.code, 0, build.out);
    assert.match(readFileSync(join(dir, 'evals/save-to-file/history.jsonl'), 'utf8'), /A note added by the test\./);
    const check = node(join(dir, 'scripts', 'build.mjs'), ['--check']);
    assert.equal(check.code, 0, check.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The MCP server's content is written only where the server is: a copy of the skill alone gets no mcp/.
test('build.mjs writes no MCP content in a tree without mcp/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-no-mcp-'));
  try {
    copyTo(dir);
    rmSync(join(dir, 'mcp'), { recursive: true, force: true });
    const build = node(join(dir, 'scripts', 'build.mjs'));
    assert.equal(build.code, 0, build.out);
    assert.ok(!existsSync(join(dir, 'mcp')), 'no mcp/ folder was made');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build.mjs and validate.mjs name the history they cannot refresh, in one line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-partial-read-'));
  try {
    copyTo(dir);
    const p = join(dir, 'evals/followup-partial-answers/history.jsonl');
    const read = `"file_path":"/plugin/${REL}"`;
    const before = readFileSync(p, 'utf8');
    assert.ok(before.includes(read));
    writeFileSync(p, before.replace(read, `${read},"limit":2`));
    const msg = `evals/followup-partial-answers/history.jsonl: reads part of ${REL} (offset/limit); re-record it`;
    const check = node(join(dir, 'scripts', 'build.mjs'), ['--check']);
    assert.equal(check.code, 1, check.out);
    assert.equal(check.stdout, '');
    assert.equal(check.stderr, `build failed: ${msg}\n`);
    const validate = node(join(dir, 'scripts', 'validate.mjs'));
    assert.equal(validate.code, 1, validate.out);
    assert.ok(validate.stderr.includes(`error: build failed: ${msg}\n`), validate.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
