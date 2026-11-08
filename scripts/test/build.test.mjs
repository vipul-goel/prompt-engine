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
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { KNOWLEDGE_ORDER, normalize, refreshHistory, renderKnowledge, renderMediaTargets } from '../build.mjs';

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

// ---------- data the build can't render ----------
test('renderMediaTargets names the entry it cannot render', () => {
  const data = (over) => ({ targets: [{ id: 'midjourney', name: 'Midjourney', kind: 'image', status: 'verified', last_verified: '2026-10-29', sources: ['https://example.com/docs'], ...over }] });
  assert.match(renderMediaTargets(data({})), /^## Midjourney$/m);
  assert.throws(() => renderMediaTargets(data({ status: 'verifed' })), { message: 'media-targets: unknown status "verifed" for midjourney' });
  assert.throws(() => renderMediaTargets(data({ sources: undefined })), { message: 'media-targets: midjourney needs a sources array' });
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

// ---------- the knowledge file ----------
test('the knowledge file demotes headings but not "# " lines inside fenced blocks', () => {
  const refs = Object.fromEntries(KNOWLEDGE_ORDER.map((k) => [k, `# ${k}\n\nText.\n`]));
  refs.coding = '# Coding\n\n## Steps\n\n```bash\n# a shell comment\n## not a heading\n```\n\n~~~\n# tilde fence\n~~~\n\n### After\n';
  const out = renderKnowledge(refs);
  for (const line of ['## Coding', '### Steps', '#### After', '# a shell comment', '## not a heading', '# tilde fence']) {
    assert.match(out, new RegExp(`^${line}$`, 'm'), line);
  }
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

test("another skill's text is left alone", () => {
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
