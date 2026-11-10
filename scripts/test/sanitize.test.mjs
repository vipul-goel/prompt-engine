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
import { sanitize, scanText, publicText, machinePatterns, FIXED_SESSION, PRIVATE_PATTERNS } from '../eval/sanitize.mjs';
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

// One row or more for each kind the scan knows: [kind, text it must report as that kind, a near
// miss it must not report at all]. A pattern dropped or loosened would otherwise pass every test,
// since the others cover only the kinds that the review's reproductions used.
const r = (c, n) => c.repeat(n);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const KINDS = [
  ['Anthropic or OpenAI-style key', `${'sk'}-ant-api03-${r('Q', 40)}`, `${'sk'}-short`],
  ['Stripe key', `${'sk'}_live_${r('A', 24)}`, `${'pk'}_live_${r('A', 24)}`],
  ['Stripe key', `${'rk'}_test_${r('B', 24)}`, `${'sk'}_live_${r('A', 10)}`],
  ['GitHub token', `gh${'p'}_${r('R', 36)}`, `gh${'x'}_${r('R', 36)}`],
  // The pattern's other GitHub token prefixes: gho_, ghu_, ghs_ and ghr_.
  ...['o', 'u', 's', 'r'].map((k) => ['GitHub token', `gh${k}_${r('R', 36)}`, `gh${k}_${r('R', 20)}`]),
  ['GitHub token', `github${'_pat_'}${r('a', 22)}_${r('b', 59)}`, `github${'_pat_'}${r('a', 10)}`],
  ['GitLab token', `gl${'pat'}-${r('C', 20)}`, `gl${'pat'}-${r('C', 10)}`],
  ['Slack token', `xo${'xb'}-${r('1', 12)}-${r('d', 24)}`, `xo${'xz'}-${r('1', 12)}`],
  ['AWS key ID', `AK${'IA'}${r('Z', 16)}`, `AK${'IA'}${r('Z', 10)}`],
  ['Google API key', `AI${'za'}${r('D', 35)}`, `AI${'za'}${r('D', 20)}`],
  ['npm token', `np${'m_'}${r('E', 36)}`, `np${'m_'}${r('E', 20)}`],
  ['Hugging Face token', `h${'f_'}${r('F', 34)}`, `h${'f_'}${r('F', 10)}`],
  ['JWT', `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '42' })}.${r('s', 43)}`, `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '42' })}`],
  ['private key', `-----BEGIN ${'RSA PRIVATE'} KEY-----`, '-----BEGIN PUBLIC KEY-----'],
  ['private key', `-----BEGIN ${'PRIVATE'} KEY-----`, '-----BEGIN CERTIFICATE-----'],
  ['home folder path', `/${'Users'}/someone/notes.txt`, 'GET /users/42'],
  ['home folder path', `/${'home'}/someone/notes.txt`, 'GET /homes/42'],
  ['claude.ai session ID', `ses${'sion_'}${r('G', 24)}`, `ses${'sion_'}id`],
  ['e-mail address', `someone${'@'}mailhost.invalid`, 'name@example.com'],
];

test('each kind of private data is reported for its own shape, and a near miss is not reported', () => {
  assert.deepEqual([...new Set(KINDS.map(([k]) => k))].sort(), PRIVATE_PATTERNS.map(([k]) => k).sort(), 'a row for each kind the scan knows');
  for (const [kind, hit, miss] of KINDS) {
    assert.deepEqual(scanText(`text ${hit} text`), [`line 1: ${kind}`], `${kind}: ${hit.slice(0, 12)}`);
    assert.deepEqual(scanText(`text ${miss} text`), [], `${kind} near miss: ${miss.slice(0, 12)}`);
  }
});

test('only the reserved example domains are allowed, as whole domains', () => {
  for (const ok of ['name@example.com', 'name@sub.example.org', 'NAME@EXAMPLE.NET']) assert.deepEqual(scanText(ok), [], ok);
  // Look-alikes of those domains, the address built at run time like the keys above.
  for (const domain of ['example.com.attacker.invalid', 'notexample.com', 'example.community']) {
    assert.deepEqual(scanText(`name${'@'}${domain}`), ['line 1: e-mail address'], domain);
  }
});

// The commit-trailer address is allowed as a whole address only, not inside a longer one.
test('only noreply@anthropic.com itself is allowed, not an address that holds it', () => {
  for (const address of [`x.noreply${'@'}anthropic.com`, `noreply${'@'}anthropic.com.mailhost.invalid`]) {
    assert.deepEqual(scanText(`cc ${address}`), ['line 1: e-mail address'], address);
  }
});

// textsOf reads a JSON row's keys as well as its values: a pasted secret can land in either.
test('a token in a JSON key of a row is found', () => {
  const row = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: { [fake.anthropic]: 'x' } }] } });
  assert.deepEqual(scanText(row), ['line 1: Anthropic or OpenAI-style key']);
});

test('a sanitized row keeps only the conversation\'s keys', () => {
  const raw = JSON.stringify({
    type: 'user', uuid: 'u1', parentUuid: null, sessionId: SID, cwd: MAC.cwd, gitBranch: 'someone/feature', slug: 'gallant-thompson',
    requestId: 'req_1', version: '2.1.319', userType: 'external', isSidechain: false, timestamp: '2026-11-09T00:00:00.000Z',
    message: { role: 'user', content: 'hello' },
  });
  assert.deepEqual(Object.keys(JSON.parse(run(raw))).sort(), ['cwd', 'isSidechain', 'message', 'parentUuid', 'sessionId', 'timestamp', 'type', 'userType', 'uuid', 'version']);
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

// Only at a path boundary, so that a sibling folder whose name starts with the same letters, which
// names someone else, isn't reported as this machine's: /srv/people/al isn't /srv/people/alex.
test('this machine\'s home folder is looked for at a path boundary', () => {
  const extra = machinePatterns({ home: '/srv/people/al' });
  for (const s of ['see /srv/people/al/notes', 'see /srv/people/al.', 'see /srv/people/al']) assert.deepEqual(scanText(s, { extra }), ['line 1: this machine\'s home folder'], s);
  for (const s of ['see /srv/people/alex/notes', 'see /srv/people/al-x/notes', 'see /srv/people/al.d/notes']) assert.deepEqual(scanText(s, { extra }), [], s);
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

// Only where a path starts, too: a folder's text inside a longer path or a URL is another path. With
// a home of /root, as a container's root user has, https://github.com/acme/root/blob/main/x.py was
// written as https://github.com/acme~/blob/main/x.py, without a word. The scan looks for the home
// folder inside other paths too, so it refuses one there instead of letting a user name such as al
// in /mnt/opt/al/backup through. No public text, so that a path the skill's files or an eval prompt
// someday quote isn't allowed.
test('a folder inside a longer path or a URL is never rewritten, and the scan refuses a home folder there', () => {
  const at = (home) => ({ repo: '/srv/build/prompt-engine', cwd: '/srv/tmp/pe-history-abc', home, host: 'build-host-1', allowText: '' });
  const outcome = (text, home) => {
    try { return JSON.parse(sanitize(textEvent(text), at(home))).message.content[0].text; } catch (e) { return e.message; }
  };
  for (const [home, text, kind] of [
    ['/root', 'See https://github.com/acme/root/blob/main/x.py.', 'this machine\'s home folder'],
    ['/root', 'The files in /var/root/cache.', 'this machine\'s home folder'],
    [`/${'home'}/al`, `Mount it at /mnt/${'home'}/al/backup.`, 'home folder path'],
    // Outside /Users and /home, only the scan's own pattern for this machine's home folder sees it.
    ['/opt/al', 'Mount it at /mnt/opt/al/backup.', 'this machine\'s home folder'],
  ]) {
    const out = outcome(text, home);
    assert.ok(out.startsWith('refusing to write the history') && out.includes(`\n  line 1: ${kind}`), `home ${home}: ${JSON.stringify(text)} gave ${JSON.stringify(out)}`);
  }
  // The working folder's text inside another path, which holds nothing the scan looks for.
  assert.equal(outcome('Copied to /backup/srv/tmp/pe-history-abc/x.md.', '/opt/al'), 'Copied to /backup/srv/tmp/pe-history-abc/x.md.');
  // Where a path starts: at the start, after a space, a quote, a bracket, = or :, and after the
  // second / of file:///.
  assert.equal(outcome('/root/a, "/root/b" (/root/c) --dir=/root/d PATH=/bin:/root/e file:///root/f', '/root'), '~/a, "~/b" (~/c) --dir=~/d PATH=/bin:~/e file://~/f');
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

// A home folder that is a file-system root, as a container user without one can have, holds nothing
// private. Rewritten as a folder, "/" turned every "//" and lone "/" into "~", and C:\ every C:\ path.
test('a home folder that is a file-system root is neither rewritten nor looked for, and the other folders still are', () => {
  for (const home of ['/', 'C:\\', 'C:/', 'c:', '']) assert.deepEqual(machinePatterns({ home }), [], JSON.stringify(home));
  const posix = { repo: '/srv/build/prompt-engine', cwd: '/srv/tmp/pe-history-abc', home: '/', host: 'ci' };
  const user = 'compare REST and/or GraphQL, see https://example.com/api';
  const reply = `Saved to ${posix.cwd}/notes.md. See https://example.com/docs and use 1/2 cup, then a/b test or / slash, or file:///etc/hosts.`;
  const rows = run([ev('user', 'u1', null, user), ev('assistant', 'a1', 'u1', [{ type: 'text', text: reply }])].join('\n'), posix).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows[0].message.content, user);
  assert.equal(rows[1].message.content[0].text, reply.replace(posix.cwd, '/workspace'));
  const win = { repo: 'C:\\src\\prompt-engine', cwd: 'C:\\Temp\\pe-history-abc', home: 'C:\\', host: 'ci' };
  const text = `Open C:\\Windows\\System32 and D:\\data, then ${win.repo}\\skills\\prompt-engine\\SKILL.md.`;
  assert.equal(JSON.parse(run(textEvent(text), win)).message.content[0].text, 'Open C:\\Windows\\System32 and D:\\data, then /plugin/skills/prompt-engine/SKILL.md.');
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

// The rows above put a token with a distinctive prefix (sk-ant-, ghp_) after most forms, and those
// prefixes are found after any character, so the rows pass without ESCAPES. The tokens here start at
// a word boundary, so each form that ESCAPES opens is tested with them: a form dropped from ESCAPES
// fails here. Left out: an HTML reference by hex number without its semicolon, such as &#x3D. The
// scan reads every hex digit after it as part of it, so it misses an AWS key ID or a Google API key
// right after one, since their first letter, A, is a hex digit.
test('a token that starts at a word boundary is found right after each escape that ESCAPES opens, also one JSON level down', () => {
  const tokens = [
    [`${'sk'}-${'Ab1'.repeat(16)}`, 'Anthropic or OpenAI-style key'],
    [`AK${'IA'}${'Z'.repeat(16)}`, 'AWS key ID'],
    [`${'sk'}_${'live'}_${'S'.repeat(24)}`, 'Stripe key'],
    [`AI${'za'}${'D'.repeat(35)}`, 'Google API key'],
    [`${'npm'}_${'N'.repeat(36)}`, 'npm token'],
    [`${'hf'}_${'H'.repeat(34)}`, 'Hugging Face token'],
    [`${'session'}_${'A1b2'.repeat(6)}`, 'claude.ai session ID'],
  ];
  const forms = ['\\n', '\\t', '\\r', '\\f', '\\v', '\\b', '\\a', '\\0', '\\12', '\\012', '\\x3d', '\\u003d', '\\U0000003d',
    'key%3D', 'key%253D', 'key=3D', 'key&#61', 'key&#x3D;', '\u{1b}[0m', '\\x1b[0m'];
  for (const [token, kind] of tokens) {
    for (const form of forms) assert.deepEqual(scanText(`${form}${token}`), [`line 1: ${kind}`], `${kind} after ${JSON.stringify(form)}`);
    // A JSON text in a string of the row: decoded once, its escapes are still written out.
    assert.deepEqual(scanText(JSON.stringify({ content: JSON.stringify({ note: `\t${token}` }) })), [`line 1: ${kind}`], `${kind} after a tab one JSON level down`);
  }
});

// No list of escapes is complete. A token whose prefix a word rarely ends in (sk-ant-, sk-proj-,
// a GitHub, GitLab or Slack prefix) is found right after a letter or digit, whatever put it there;
// one that a word can end in, such as a plain sk- key, is found after the escapes that ESCAPES
// opens, among them the forms below.
test('a token right after quoted-printable, a %XX encoded twice, any ECMA-48 sequence or &#NN is found', () => {
  const plain = `${'sk'}-${'Ab1'.repeat(16)}`; // a key without a distinctive prefix
  const project = `${'sk'}-pr${'oj'}-${'P'.repeat(40)}`;
  const pat = `github${'_pat_'}${'a'.repeat(22)}_${'b'.repeat(59)}`;
  const gitlab = `gl${'pat'}-${'C'.repeat(20)}`;
  const slack = `xo${'xb'}-${'1'.repeat(12)}-${'d'.repeat(24)}`;
  const KEY = 'Anthropic or OpenAI-style key';
  const ESC = '\u{1b}';
  const forms = ['key=3D', 'url?key%253D', 'url?key%25253D', `${ESC}[38:2:255:0:0m`, '\\x1b[38:2:255:0:0m', `${ESC}[>4;2m`,
    '\\27[32m', '\\U0000001B[32m', '\\e[1;32m', `${ESC}(B`, `${ESC}M`, 'key&#61', 'key&#x3D'];
  for (const form of forms) {
    assert.deepEqual(scanText(`${form}${plain}`), [`line 1: ${KEY}`], `plain key after ${JSON.stringify(form)}`);
    for (const [token, kind] of [[fake.anthropic, KEY], [project, KEY], [fake.github, 'GitHub token'], [pat, 'GitHub token'], [gitlab, 'GitLab token'], [slack, 'Slack token']]) {
      assert.deepEqual(scanText(`${form}${token}`), [`line 1: ${kind}`], `${kind} after ${JSON.stringify(form)}`);
    }
  }
  // The distinctive prefixes after a letter or digit that no escape explains, and in a JSON row.
  for (const [token, kind] of [[fake.anthropic, KEY], [project, KEY], [fake.github, 'GitHub token'], [pat, 'GitHub token'], [gitlab, 'GitLab token'], [slack, 'Slack token']]) {
    assert.deepEqual(scanText(`id9Z${token}`), [`line 1: ${kind}`], `${kind} after a word`);
    assert.deepEqual(scanText(JSON.stringify({ content: `x=3D${token}` })), [`line 1: ${kind}`], `${kind} in a row`);
  }
  // A plain sk- key, an AWS key ID and a Google API key still start at a word boundary: words end
  // in "sk-" (task-), and base64 text, such as an image in a transcript, can hold AKIA or AIza
  // after a letter.
  assert.deepEqual(scanText(`task-${'Ab1'.repeat(16)}`), []);
  assert.deepEqual(scanText(`xAK${'IA'}${'Z'.repeat(16)} yAI${'za'}${'D'.repeat(35)}`), []);
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
