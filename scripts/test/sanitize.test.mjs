// Tests for scripts/eval/sanitize.mjs, which turns a raw Claude Code transcript into a history
// fixture and scans text for data that looks private. No test here calls a model. Secret-shaped
// strings are built at run time, so this file holds none; planted addresses use reserved
// domains, and the paths are made up.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitize, scanText, publicText, FIXED_SESSION } from '../eval/sanitize.mjs';
import { refreshHistory } from '../build.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const allowText = publicText(repo);
const fake = { anthropic: `${'sk'}-ant-api03-${'Q'.repeat(40)}`, github: `gh${'p'}_${'R'.repeat(36)}`, aws: `AKIA${'Z'.repeat(16)}` };
const SID = '11111111-2222-4333-8444-555555555555';
const MAC = { repo: '/Users/al/src/prompt-engine', cwd: '/private/var/folders/xy/T/pe-history-abc', home: '/Users/al', host: 'Als-MacBook-Pro.local' };
const ev = (type, uuid, parentUuid, content, extra = {}) => JSON.stringify({ type, uuid, parentUuid, sessionId: SID, message: { role: type, content }, ...extra });
const textEvent = (text) => ev('assistant', 'a', null, [{ type: 'text', text }]);
const run = (raw, ctx = MAC) => sanitize(raw, { ...ctx, allowText });
const refusal = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

test('keeps the user and assistant events, re-linked past dropped ones, with the session and paths rewritten', () => {
  const raw = [
    JSON.stringify({ type: 'user', uuid: 'u1', parentUuid: null, sessionId: SID, cwd: MAC.cwd, message: { role: 'user', content: 'write a blog post' } }),
    JSON.stringify({ type: 'attachment', uuid: 'x1', parentUuid: 'u1', sessionId: SID, attachment: { type: 'x' } }),
    JSON.stringify({ type: 'assistant', uuid: 'a1', parentUuid: 'x1', sessionId: SID, cwd: MAC.cwd, requestId: 'req_1',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${MAC.repo}/skills/prompt-engine/references/questions.md` } }] } }),
  ].join('\n');
  const out = run(raw).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out.map((e) => e.type), ['user', 'assistant']);
  assert.equal(out[1].parentUuid, 'u1');
  assert.equal(out[1].message.content[0].input.file_path, '/plugin/skills/prompt-engine/references/questions.md');
  for (const e of out) {
    assert.equal(e.sessionId, FIXED_SESSION);
    assert.equal(e.cwd, '/workspace');
    assert.equal(e.requestId, undefined);
  }
});

test('refuses an e-mail address, but not noreply@anthropic.com', () => {
  assert.match(refusal(() => run(textEvent('mail me at someone@mailhost.invalid'))), /line 1: e-mail address/);
  assert.equal(refusal(() => run(textEvent('Co-Authored-By: Claude <noreply@anthropic.com>'))), '');
});

test('a transcript with private data is refused, naming each line and kind but not the data', () => {
  const raw = [
    ev('user', 'u1', null, `improve: call the API with ${fake.anthropic} and push with ${fake.github} as ${fake.aws}`),
    JSON.stringify({ type: 'attachment', uuid: 'x1', parentUuid: 'u1', sessionId: SID, attachment: { email: 'owner@mailhost.invalid' } }),
    ev('assistant', 'a1', 'x1', [{ type: 'text', text: 'Reading /Users/alice/notes.txt for jürgen@müller.invalid' }]),
  ].join('\n');
  const msg = refusal(() => run(raw));
  assert.match(msg, /^refusing to write the history; it still contains what looks like private data:/);
  for (const hit of ['line 1: Anthropic or OpenAI-style key', 'line 1: GitHub token', 'line 1: AWS key ID', 'line 2: home folder path', 'line 2: e-mail address']) {
    assert.ok(msg.includes(hit), `${hit} in:\n${msg}`);
  }
  assert.doesNotMatch(msg, /owner@|line 3/, 'the attachment event is dropped');
  for (const secret of [...Object.values(fake), '/Users/alice', 'jürgen']) assert.ok(!msg.includes(secret), secret);
});

test('publicText reads each eval case\'s prompt.md and the skill\'s Markdown files, and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-public-'));
  try {
    const files = {
      'evals/demo/prompt.md': 'in a prompt', 'evals/demo/graders/01.md': 'in a grader', 'evals/demo/history.jsonl': 'in a history',
      'skills/prompt-engine/SKILL.md': 'in SKILL.md', 'skills/prompt-engine/references/x.md': 'in a reference',
      'skills/prompt-engine/references/x.txt': 'in a text file', 'docs/notes.md': 'in the docs',
    };
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), text);
    }
    const text = publicText(dir);
    for (const t of ['in a prompt', 'in SKILL.md', 'in a reference']) assert.ok(text.includes(t), t);
    for (const t of ['in a grader', 'in a history', 'in a text file', 'in the docs']) assert.ok(!text.includes(t), t);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('package specs, public addresses, git remotes and the safety eval\'s fake key pass', () => {
  const key = readFileSync(join(repo, 'evals/secret-redaction-quick/prompt.md'), 'utf8').match(/\bsk-[\w-]{20,}/)?.[0];
  assert.ok(key, 'evals/secret-redaction-quick/prompt.md holds a fake key');
  for (const s of ['install next-auth@5.0.0, @modelcontextprotocol/sdk@1.2.3 and @anthropic-ai/claude-code@2.1.312',
    'Co-Authored-By: Claude <NOREPLY@ANTHROPIC.COM>', 'git@github.com:owner/repo.git', 'mail name@example.com', `my key ${key}`]) {
    assert.equal(refusal(() => run(textEvent(s))), '', s);
  }
});

test('addresses with non-ASCII domains are refused', () => {
  for (const s of ['jürgen@müller.invalid', 'ivan@пример.испытание']) assert.match(refusal(() => run(textEvent(s))), /line 1: e-mail address/, s);
});

test('an allowed match does not hide a second one on the same line', () => {
  assert.match(refusal(() => run(textEvent('cc name@example.com and someone@mailhost.invalid'))), /line 1: e-mail address/);
});

test('this machine\'s name and home folder are looked for, never replaced', () => {
  assert.match(refusal(() => run(textEvent('built on als-macbook-pro'))), /line 1: this machine's name/);
  // A home folder outside /Users and /home, in a thinking block, which isn't rewritten.
  const ctx = { repo: '/srv/build/prompt-engine', cwd: '/srv/tmp/pe-history-abc', home: '/srv/people/al', host: 'mac' };
  const thinking = ev('assistant', 'a', null, [{ type: 'thinking', thinking: 'see /srv/people/al/notes', signature: 'c2ln' }]);
  assert.match(refusal(() => run(thinking, ctx)), /line 1: this machine's home folder/);
  // A name under 6 characters isn't looked for, so ordinary words that contain it pass unchanged.
  // No public text here: the repository's text contains "mac", which would allow the match anyway.
  assert.equal(JSON.parse(sanitize(textEvent('write a macOS guide'), { ...ctx, allowText: '' })).message.content[0].text, 'write a macOS guide');
  // Nor is "localhost", which names no machine in particular.
  assert.equal(refusal(() => run(textEvent('serve it on localhost:3000'), { ...ctx, host: 'localhost.localdomain' })), '');
});

test('folders are rewritten at path boundaries, the session ID is replaced and message IDs are kept', () => {
  const text = `skill ${MAC.repo}/skills/prompt-engine, cwd /var/folders/xy/T/pe-history-abc/x.md, home ${MAC.home}/notes, session ${SID}`;
  const raw = ev('assistant', 'a', null, null, { message: { id: 'msg_01KEEP', role: 'assistant', content: [{ type: 'text', text }] } });
  const out = JSON.parse(run(raw));
  assert.equal(out.message.content[0].text, `skill /plugin/skills/prompt-engine, cwd /workspace/x.md, home ~/notes, session ${FIXED_SESSION}`);
  assert.equal(out.message.id, 'msg_01KEEP');
  assert.equal(out.sessionId, FIXED_SESSION);
  // A sibling folder that only shares a prefix isn't rewritten, so the scan sees it.
  assert.match(refusal(() => run(textEvent(`${MAC.home}x/file`))), /line 1: home folder path/);
});

test('thinking blocks are left as recorded, and one that holds a home path is refused', () => {
  // A plugin folder outside any home folder, so the scan lets the unchanged thinking block through.
  const ctx = { repo: '/srv/build/prompt-engine', cwd: '/srv/tmp/pe-history-abc', home: '/srv/people/al', host: 'build-host-1' };
  const raw = ev('assistant', 'a', null, [{ type: 'thinking', thinking: `look in ${ctx.repo}/skills`, signature: 'c2ln' }, { type: 'text', text: `look in ${ctx.repo}/skills` }]);
  const [thinking, text] = JSON.parse(run(raw, ctx)).message.content;
  assert.equal(thinking.thinking, `look in ${ctx.repo}/skills`);
  assert.equal(text.text, 'look in /plugin/skills');
  const home = ev('assistant', 'a', null, [{ type: 'thinking', thinking: `look in ${MAC.repo}/skills`, signature: 'c2ln' }]);
  assert.match(refusal(() => run(home)), /line 1: home folder path/);
});

test('Windows home folders are found in any letter case and with either separator, and /users URLs pass', () => {
  for (const s of ['see c:\\users\\bob\\notes.txt', 'see C:\\Users\\bob\\notes.txt', 'see c:/users/bob/notes.txt', 'see D:\\\\USERS\\\\bob']) {
    assert.deepEqual(scanText(s), ['line 1: home folder path'], s);
  }
  assert.deepEqual(scanText('GET /users/42, then /homepage and https://example.com/home'), []);
  // A thinking block stays as recorded, so only the scan stands between it and the fixture.
  const win = { repo: 'C:\\Users\\alice\\src\\prompt-engine', cwd: 'C:\\Users\\alice\\AppData\\Local\\Temp\\pe-history-abc', home: 'C:\\Users\\alice', host: 'ALICE-PC' };
  const thinking = ev('assistant', 'a', null, [{ type: 'thinking', thinking: 'see c:\\users\\alice\\notes.txt', signature: 'c2ln' }]);
  assert.match(refusal(() => run(thinking, win)), /line 1: this machine's home folder/);
});

test('Windows paths become /plugin and /workspace paths, which build.mjs then refreshes', () => {
  const win = { repo: 'C:\\Users\\alice\\src\\prompt-engine', cwd: 'C:\\Users\\alice\\AppData\\Local\\Temp\\pe-history-abc', home: 'C:\\Users\\alice', host: 'ALICE-PC' };
  const raw = [
    ev('assistant', 'a1', null, [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${win.repo}\\skills\\prompt-engine\\references\\questions.md` } }]),
    ev('user', 'u1', 'a1', [{ type: 'tool_result', tool_use_id: 't1', content: '1\tOLD QUESTIONS TEXT' }]),
    ev('assistant', 'a2', 'u1', [{ type: 'text', text: `Saved to ${win.cwd.toLowerCase()}\\prompt.md` }]),
  ].join('\n');
  const rows = run(raw, win).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows[0].message.content[0].input.file_path, '/plugin/skills/prompt-engine/references/questions.md');
  assert.equal(rows[2].message.content[0].text, 'Saved to /workspace/prompt.md');
  const refreshed = refreshHistory(rows.map((r) => JSON.stringify(r)).join('\n'), 'BODY', (p) => `NEW ${p}`).split('\n').map((l) => JSON.parse(l));
  assert.equal(refreshed[1].message.content[0].content, '1\tNEW skills/prompt-engine/references/questions.md');
});

test('a token right after an escaped newline or tab in a history row is found', () => {
  // In a line of JSON, "\n" and "\t" are written as escapes that end in a letter, which would
  // hide where a token starts from a pattern that begins at a word boundary.
  for (const text of [`Here it is:\n${fake.github}`, `1\t${fake.aws}`, `Mail:\n\t${fake.anthropic}`]) {
    assert.equal(scanText(JSON.stringify({ message: { content: text } })).length, 1, JSON.stringify(text));
  }
  // An address that appears in public text is allowed there too, not read as "t" + address.
  assert.deepEqual(scanText(JSON.stringify({ content: '1\tsupport@mailhost.invalid' }), { allowText: 'Write to support@mailhost.invalid.' }), []);
});

test('a token right after a written-out escape, a %XX escape or a colour code is found, also one JSON level down', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '42' })}.${'s'.repeat(43)}`;
  const KEY = ['line 1: Anthropic or OpenAI-style key'];
  // Each escape ends in a letter or digit, which hides where the token starts from a pattern that
  // begins at a word boundary: a pasted JSON or code snippet, a shell string, a URL, a tool result
  // that printed a JSON file (decoded once, its text still holds the escape) or coloured output.
  for (const [text, hits] of [
    [`Improve this prompt: {"system":"Use the key:\\n${fake.anthropic}"}`, KEY],
    [`Improve: print("token:\\t${fake.github}")`, ['line 1: GitHub token']],
    [`Improve: echo $'\\n${fake.aws}'`, ['line 1: AWS key ID']],
    [`Improve: {"auth":"Bearer\\n${jwt}"}`, ['line 1: JWT']],
    [`Improve: {"s":"\\r\\nsession_${'A1b2'.repeat(6)}"}`, ['line 1: claude.ai session ID']],
    [`Improve: {"key":"\\u003d${fake.anthropic}"}`, KEY],
    [`curl https://api.example.com/v1?q=key%3D${fake.anthropic}`, KEY],
    [`printf '\\012${fake.anthropic}'`, KEY],
    [`echo -e 'ping\\a${fake.github}'`, ['line 1: GitHub token']],
    [`print('\\U0000003d${fake.anthropic}')`, KEY],
    [`printf '\\033[32m${fake.anthropic}\\033[0m'`, KEY],
    [`echo -e "\\x1b[1;32m${fake.anthropic}"`, KEY],
    [JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: JSON.stringify({ note: `key:\n${fake.anthropic}` }) }] } }), KEY],
    [JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: `\u{1b}[32m${fake.anthropic}\u{1b}[0m` }] } }), KEY],
  ]) assert.deepEqual(scanText(text), hits, text.slice(0, 60));
  // A key that public text holds passes after an escape too, and a line without one is read as it is.
  const key = readFileSync(join(repo, 'evals/secret-redaction-quick/prompt.md'), 'utf8').match(/\bsk-[\w-]{20,}/)?.[0];
  assert.ok(key, 'evals/secret-redaction-quick/prompt.md holds a fake key');
  assert.deepEqual(scanText(`{"system":"Use the key:\\n${key}"}`, { allowText }), []);
  assert.deepEqual(scanText('C:\\\\notes\\\\new and 100%25 done'), []);
});

test('scanText reads every string of a JSON line nested 50,000 levels deep', () => {
  // A recursive walk overflowed the call stack well before this depth, and validate.mjs stopped.
  const token = `gh${'p'}_${'R'.repeat(36)}`;
  const n = 50_000;
  for (const line of [`${'['.repeat(n)}"${token}"${']'.repeat(n)}`, `{"a":${'{"b":'.repeat(n)}"${token}"${'}'.repeat(n)}}`, `{"a":${'[{"b":'.repeat(n)}0${'}]'.repeat(n)},"c":"${token}"}`]) {
    assert.deepEqual(scanText(line), ['line 1: GitHub token'], line.slice(0, 12));
  }
});

test('the committed histories pass the scan', () => {
  const cases = readdirSync(join(repo, 'evals')).filter((c) => existsSync(join(repo, 'evals', c, 'history.jsonl')));
  assert.ok(cases.length >= 3, cases.join(', '));
  for (const c of cases) assert.deepEqual(scanText(readFileSync(join(repo, 'evals', c, 'history.jsonl'), 'utf8'), { allowText }), [], c);
});

test('JWTs are found after a space, a quote, = or -, and with a header of a few thousand characters', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (header) => `${b64(header)}.${b64({ sub: '42', iat: 1516239022 })}.${'s'.repeat(43)}`;
  const short = jwt({ alg: 'HS256', typ: 'JWT' });
  // A certificate chain in the header (x5c) makes it long.
  const long = jwt({ alg: 'ES256', x5c: ['M'.repeat(1500), 'M'.repeat(1200), 'M'.repeat(800)] });
  for (const s of [`Bearer ${short}`, `{"token":"${short}"}`, `token=${short}`, `x-${short}`, short, `token=${long}`]) {
    assert.deepEqual(scanText(s), ['line 1: JWT'], s.slice(0, 20));
  }
});

test('the scan stays fast on long runs without an @, and on long runs of eyJ-', () => {
  const t0 = performance.now();
  scanText('a'.repeat(200_000));
  scanText(`x@${'1.'.repeat(100_000)}`);
  scanText('eyJ-'.repeat(50_000));
  assert.ok(performance.now() - t0 < 2_000, `${Math.round(performance.now() - t0)} ms`);
});
