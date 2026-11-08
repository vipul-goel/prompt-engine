// Tests for scripts/eval/record-history.mjs, run from a copy of scripts/eval in a folder whose
// name has a space. PATH holds only a stand-in for `claude`, so no test can reach the real,
// billed one. The refusal tests check that the stand-in never starts; the recording tests let
// it run and check what the recorder does with its output.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FIXED_SESSION } from '../eval/sanitize.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The stand-in is a shell script, which Windows can't start by name.
const STAND_IN = process.platform === 'win32' && 'the stand-in for claude is a shell script';

// The stand-in's own code. It saves its arguments to $FAKE_ARGS first, which is also the sign
// that it started. Then, like `claude -p --output-format json`, it writes a transcript under
// $CLAUDE_CONFIG_DIR/projects and prints the result the recorder reads. FAKE_LEAK adds an
// address to the reply; FAKE_NO_TRANSCRIPT skips the transcript.
const FAKE = `
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
writeFileSync(process.env.FAKE_ARGS, JSON.stringify(args));
const repo = args[args.indexOf('--plugin-dir') + 1];
const sid = '11111111-2222-4333-8444-555555555555';
const ev = (type, uuid, parentUuid, content) => JSON.stringify({ type, uuid, parentUuid, sessionId: sid, cwd: process.cwd(), message: { role: type, content } });
const reply = 'Saved to ' + join(process.cwd(), 'notes.md') + (process.env.FAKE_LEAK ? ' for someone@mailhost.invalid' : '');
const lines = [
  ev('user', 'u1', null, args[args.indexOf('-p') + 1]),
  JSON.stringify({ type: 'attachment', uuid: 'x1', parentUuid: 'u1', sessionId: sid, attachment: { email: 'owner@mailhost.invalid' } }),
  ev('assistant', 'a1', 'x1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: join(repo, 'skills', 'prompt-engine', 'references', 'questions.md') } }]),
  ev('user', 'u2', 'a1', [{ type: 'tool_result', tool_use_id: 't1', content: '1\\tQuestions' }]),
  ev('assistant', 'a2', 'u2', [{ type: 'text', text: reply }]),
];
if (!process.env.FAKE_NO_TRANSCRIPT) {
  const dir = join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'some-project');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, sid + '.jsonl'), lines.join('\\n') + '\\n');
}
console.log(JSON.stringify({ session_id: sid, result: 'done', total_cost_usd: 0 }));
`;

function setup() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'pe-record-')));
  // The copy's root, which record-history.mjs takes for the repository.
  const dir = join(parent, 'has space');
  cpSync(join(repo, 'scripts', 'eval'), join(dir, 'scripts', 'eval'), { recursive: true });
  const [bin, home, tmp] = ['bin', 'home', 'tmp'].map((d) => join(parent, d));
  for (const d of [bin, home, tmp]) mkdirSync(d);
  writeFileSync(join(parent, 'fake.mjs'), FAKE);
  // exec and "$@" are shell built-ins: nothing else on PATH is needed to start the stand-in.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec '${process.execPath}' '${join(parent, 'fake.mjs')}' "$@"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const started = join(parent, 'args.json');
  const out = join(parent, 'out.jsonl');
  // The parent's environment (Windows needs some of it), without its PATH, in any spelling, and
  // its Claude Code config folder. HOME and USERPROFILE point at an empty folder.
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (k.toUpperCase() === 'PATH' || k === 'CLAUDE_CONFIG_DIR') delete base[k];
  const env = { ...base, PATH: bin, HOME: home, USERPROFILE: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp, FAKE_ARGS: started };
  const record = (args, extra = {}) => spawnSync(process.execPath, [join(dir, 'scripts', 'eval', 'record-history.mjs'), ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  const cleanup = () => rmSync(parent, { recursive: true, force: true });
  return { parent, dir, home, env, started, out, record, cleanup };
}

test('record-history.mjs prints its usage, and importing it runs nothing', () => {
  const { dir, env, started, out, record, cleanup } = setup();
  try {
    const r = record([]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^usage: record-history\.mjs <out\.jsonl>/);
    // With two arguments after the script, a recorder that ran on import would record.
    const url = pathToFileURL(join(dir, 'scripts', 'eval', 'record-history.mjs')).href;
    const imp = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)}); console.log('imported');`, 'x', out, 'hello'], { encoding: 'utf8', env });
    assert.equal(imp.status, 0, imp.stderr);
    assert.equal(imp.stdout, 'imported\n');
    assert.equal(imp.stderr, '');
    assert.ok(!existsSync(started), 'claude was not started');
    assert.ok(!existsSync(out));
  } finally {
    cleanup();
  }
});

test('record-history.mjs refuses a first message that looks private, before claude starts', () => {
  const { parent, started, out, record, cleanup } = setup();
  try {
    // A transcript folder that exists, so only the scan stands between the message and claude.
    const cfg = join(parent, 'cfg');
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    const r = record([out, `improve: push with gh${'p'}_${'R'.repeat(36)}`], { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /looks private, so nothing was sent/);
    assert.match(r.stderr, /line 1: GitHub token/);
    assert.doesNotMatch(r.stderr, /RRRR/, 'the token itself is not printed');
    assert.ok(!existsSync(started), 'claude was not started');
    assert.ok(!existsSync(out));
  } finally {
    cleanup();
  }
});

test('record-history.mjs refuses to start without a transcript folder, naming both places it looks', () => {
  const { parent, started, out, record, cleanup } = setup();
  try {
    const r = record([out, 'write a blog post about remote work'], { CLAUDE_CONFIG_DIR: join(parent, 'missing') });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /no transcript folder at .*missing[\\/]projects or .*home[\\/]\.claude[\\/]projects/);
    assert.match(r.stderr, /must also be set in this shell/);
    assert.ok(!existsSync(started), 'claude was not started');
    assert.ok(!existsSync(out));
  } finally {
    cleanup();
  }
});

test('record-history.mjs limits Read to the skill folder, finds the transcript under CLAUDE_CONFIG_DIR and writes it sanitized', { skip: STAND_IN }, () => {
  const { parent, dir, started, out, record, cleanup } = setup();
  try {
    const cfg = join(parent, 'cfg');
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    const r = record([out, 'write a blog post about remote work'], { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'done\n');
    const args = JSON.parse(readFileSync(started, 'utf8'));
    assert.deepEqual(args.slice(args.indexOf('--allowedTools'), args.indexOf('--allowedTools') + 3), ['--allowedTools', 'Skill', `Read(/${dir}/skills/prompt-engine/**)`]);
    assert.ok(!args.includes('Read'), 'no rule pre-approves every Read');
    assert.equal(args[args.indexOf('--plugin-dir') + 1], dir);
    const rows = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((e) => e.type), ['user', 'assistant', 'user', 'assistant']);
    assert.equal(rows[1].message.content[0].input.file_path, '/plugin/skills/prompt-engine/references/questions.md');
    assert.equal(rows[3].message.content[0].text, 'Saved to /workspace/notes.md');
    for (const e of rows) assert.equal(e.sessionId, FIXED_SESSION);
    assert.doesNotMatch(readFileSync(out, 'utf8'), /mailhost|11111111-2222/);
  } finally {
    cleanup();
  }
});

test('record-history.mjs writes nothing when the recording still looks private or its transcript is missing', { skip: STAND_IN }, () => {
  const { parent, home, out, record, cleanup } = setup();
  try {
    // One config folder per run: both runs report the same session ID.
    const [cfg1, cfg2] = ['cfg1', 'cfg2'].map((d) => join(parent, d));
    for (const cfg of [cfg1, cfg2]) mkdirSync(join(cfg, 'projects'), { recursive: true });
    const leak = record([out, 'write a blog post about remote work'], { CLAUDE_CONFIG_DIR: cfg1, FAKE_LEAK: '1' });
    assert.equal(leak.status, 1, leak.stderr);
    assert.match(leak.stderr, /refusing to write the history; it still contains what looks like private data:\n {2}line 4: e-mail address/);
    assert.doesNotMatch(leak.stderr, /someone@/);
    assert.ok(!existsSync(out));
    const cfg = cfg2;
    const missing = record([out, 'write a blog post about remote work'], { CLAUDE_CONFIG_DIR: cfg, FAKE_NO_TRANSCRIPT: '1' });
    assert.equal(missing.status, 1, missing.stderr);
    assert.ok(missing.stderr.includes(`not found under ${join(cfg, 'projects')} or ${join(home, '.claude', 'projects')}`), missing.stderr);
    assert.ok(!existsSync(out));
  } finally {
    cleanup();
  }
});
