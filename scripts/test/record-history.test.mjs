// Tests for scripts/eval/record-history.mjs, run from a copy of scripts/eval and scripts/build.mjs
// in a folder whose name has a space. PATH holds only a stand-in for `claude`, so no test can reach the real,
// billed one. The refusal tests check that the stand-in never starts; the recording tests let
// it run and check what the recorder does with its output.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FIXED_SESSION } from '../eval/sanitize.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The model every eval case pins (D28), which a recording is made on unless --model says otherwise:
// validate.mjs fails a history case recorded on another model.
const PINNED = readFileSync(join(repo, 'evals', 'spanish-quick', 'prompt.md'), 'utf8').match(/^model: (\S+)$/m)[1];
// The stand-in is a shell script, which Windows can't start by name.
const STAND_IN = process.platform === 'win32' && 'the stand-in for claude is a shell script';

// The stand-in's own code. It saves its arguments to $FAKE_ARGS first, which is also the sign
// that it started, and the session variables it inherited to $FAKE_ARGS.env. Then, like
// `claude -p --output-format json`, it writes a transcript, under $CLAUDE_CONFIG_DIR/projects or,
// when that is unset or empty, ~/.claude/projects (FAKE_PROJECTS overrides both), and prints the
// result the recorder reads. FAKE_LEAK adds an address to the reply; FAKE_NO_TRANSCRIPT skips the
// transcript.
const FAKE = `
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
writeFileSync(process.env.FAKE_ARGS, JSON.stringify(args));
writeFileSync(process.env.FAKE_ARGS + '.env', JSON.stringify([process.env.CLAUDE_CODE_SESSION_ID ?? null, process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? null]));
const repo = args[args.indexOf('--plugin-dir') + 1];
const sid = '11111111-2222-4333-8444-555555555555';
const ev = (type, uuid, parentUuid, content) => JSON.stringify({ type, uuid, parentUuid, sessionId: sid, cwd: process.cwd(), message: { role: type, content } });
const reply = 'Saved to ' + join(process.cwd(), 'notes.md') + ' and ' + join(process.env.HOME, 'backup.md') + (process.env.FAKE_LEAK ? ' for someone@mailhost.invalid' : '');
const lines = [
  ev('user', 'u1', null, args[args.indexOf('-p') + 1]),
  JSON.stringify({ type: 'attachment', uuid: 'x1', parentUuid: 'u1', sessionId: sid, attachment: { email: 'owner@mailhost.invalid' } }),
  ev('assistant', 'a1', 'x1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: join(repo, 'skills', 'prompt-engine', 'references', 'questions.md') } }]),
  ev('user', 'u2', 'a1', [{ type: 'tool_result', tool_use_id: 't1', content: '1\\tQuestions' }]),
  ev('assistant', 'a2', 'u2', [{ type: 'text', text: reply }]),
];
if (!process.env.FAKE_NO_TRANSCRIPT) {
  const projects = process.env.FAKE_PROJECTS || join(process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME, '.claude'), 'projects');
  const dir = join(projects, 'some-project');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, sid + '.jsonl'), lines.join('\\n') + '\\n');
}
console.log(JSON.stringify({ session_id: sid, result: 'done', total_cost_usd: 0 }));
`;

function setup() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'pe-record-')));
  // The copy's root, which record-history.mjs takes for the repository. It also holds the text
  // that publicText() reads: each eval case's prompt.md and the skill's Markdown files.
  const dir = join(parent, 'has space');
  cpSync(join(repo, 'scripts', 'eval'), join(dir, 'scripts', 'eval'), { recursive: true });
  // The recorder imports its entry-point check from build.mjs.
  cpSync(join(repo, 'scripts', 'build.mjs'), join(dir, 'scripts', 'build.mjs'));
  cpSync(join(repo, 'skills', 'prompt-engine'), join(dir, 'skills', 'prompt-engine'), { recursive: true });
  for (const c of readdirSync(join(repo, 'evals'))) {
    if (existsSync(join(repo, 'evals', c, 'prompt.md'))) cpSync(join(repo, 'evals', c, 'prompt.md'), join(dir, 'evals', c, 'prompt.md'));
  }
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
  // From the parent folder, so that a file the recorder writes by mistake can't land in the checkout.
  const record = (args, extra = {}) => spawnSync(process.execPath, [join(dir, 'scripts', 'eval', 'record-history.mjs'), ...args], { cwd: parent, encoding: 'utf8', env: { ...env, ...extra } });
  const cleanup = () => rmSync(parent, { recursive: true, force: true });
  return { parent, dir, home, env, started, out, record, cleanup };
}

test('record-history.mjs prints its usage, and importing it runs nothing', () => {
  const { parent, dir, env, started, out, record, cleanup } = setup();
  try {
    const r = record([]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^usage: record-history\.mjs <out\.jsonl>/);
    // With two arguments after the script and a transcript folder, a recorder that ran on import
    // would start claude. Under -e, process.argv[1] is the first argument after the code, which
    // can be the recorder's own path.
    const script = join(dir, 'scripts', 'eval', 'record-history.mjs');
    const cfg = join(parent, 'cfg');
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    for (const first of ['x', script]) {
      const imp = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(script).href)}); console.log('imported');`, first, out, 'hello'],
        { encoding: 'utf8', env: { ...env, CLAUDE_CONFIG_DIR: cfg } });
      assert.equal(imp.status, 0, imp.stderr);
      assert.equal(imp.stdout, 'imported\n', first);
      assert.equal(imp.stderr, '');
      assert.ok(!existsSync(started), 'claude was not started');
      assert.ok(!existsSync(out));
    }
  } finally {
    cleanup();
  }
});

test('record-history.mjs refuses a command line it can\'t read, before claude starts', () => {
  const { parent, started, out, record, cleanup } = setup();
  try {
    const cfg = join(parent, 'cfg');
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    const msg = 'write a blog post about remote work';
    // One argument, three, an empty message, --model without a value or with an empty one (a model
    // name then taken for the file), an unknown option, and a message that reads as an option.
    for (const args of [[out], [out, msg, 'extra'], [out, ''], [out, msg, '--model'], [out, msg, '--model='], ['--model', out, msg], [out, msg, '--modle', 'x'], [out, '--help me']]) {
      const r = record(args, { CLAUDE_CONFIG_DIR: cfg });
      assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stderr}`);
      assert.match(r.stderr, /usage: record-history\.mjs <out\.jsonl>/, JSON.stringify(args));
      assert.doesNotMatch(r.stderr, /^\s+at /m, 'no stack trace');
      assert.ok(!existsSync(started), `${JSON.stringify(args)}: claude was not started`);
    }
    assert.ok(!existsSync(out));
  } finally {
    cleanup();
  }
});

test('record-history.mjs reads --model before the file and the message too', { skip: STAND_IN }, () => {
  const { parent, started, out, record, cleanup } = setup();
  try {
    const cfg = join(parent, 'cfg');
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    const other = PINNED === 'claude-opus-5-5' ? 'claude-haiku-5-5' : 'claude-opus-5-5';
    const r = record(['--model', other, out, 'write a blog post about remote work'], { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.status, 0, r.stderr);
    const args = JSON.parse(readFileSync(started, 'utf8'));
    assert.equal(args[args.indexOf('-p') + 1], 'write a blog post about remote work');
    assert.equal(args[args.indexOf('--model') + 1], other);
    assert.ok(existsSync(out));
    assert.ok(!existsSync(join(parent, '--model')), 'no file named after the flag');
  } finally {
    cleanup();
  }
});

test('record-history.mjs refuses an output file it can\'t write, before claude starts', () => {
  const { parent, started, record, cleanup } = setup();
  try {
    const cfg = join(parent, 'cfg');
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    // A new case's folder that isn't there yet, a folder, and a path through a file.
    for (const [out, why] of [[join(parent, 'evals', 'new-case', 'history.jsonl'), 'its folder doesn\'t exist'], [cfg, 'it is a folder'], [join(parent, 'fake.mjs', 'history.jsonl'), 'its folder is a file']]) {
      const r = record([out, 'write a blog post about remote work'], { CLAUDE_CONFIG_DIR: cfg });
      assert.equal(r.status, 1, r.stderr);
      assert.equal(r.stderr, `cannot write ${out} (${why}), so nothing was sent\n`);
      assert.ok(!existsSync(started), `${why}: claude was not started`);
    }
  } finally {
    cleanup();
  }
});

test('record-history.mjs says so when claude isn\'t on PATH', () => {
  const { parent, out, record, cleanup } = setup();
  try {
    const cfg = join(parent, 'cfg');
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    const empty = join(parent, 'empty');
    mkdirSync(empty);
    const r = record([out, 'write a blog post about remote work'], { CLAUDE_CONFIG_DIR: cfg, PATH: empty });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stderr, 'could not start claude: it isn\'t on PATH, so nothing was sent\n');
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

test('record-history.mjs refuses a key right after a written-out escape in the first message, before claude starts', () => {
  const { parent, started, out, record, cleanup } = setup();
  try {
    const cfg = join(parent, 'cfg');
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    // A pasted JSON snippet: the key follows the two characters \ and n, not a line break.
    const r = record([out, `Improve this prompt: {"system":"Use the key:\\n${'sk'}-ant-api03-${'Q'.repeat(40)}"}`], { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /looks private, so nothing was sent:\n {2}line 1: Anthropic or OpenAI-style key/);
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
    // The parent session's IDs, which the child must not inherit.
    const r = record([out, 'write a blog post about remote work'], { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: 'parent-session', CLAUDE_CODE_REMOTE_SESSION_ID: 'parent-remote' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'done\n');
    assert.deepEqual(JSON.parse(readFileSync(`${started}.env`, 'utf8')), [null, null], 'the session IDs are not passed on');
    const args = JSON.parse(readFileSync(started, 'utf8'));
    assert.deepEqual(args.slice(args.indexOf('--allowedTools'), args.indexOf('--allowedTools') + 3), ['--allowedTools', 'Skill', `Read(/${dir}/skills/prompt-engine/**)`]);
    assert.ok(!args.includes('Read'), 'no rule pre-approves every Read');
    assert.equal(args[args.indexOf('--plugin-dir') + 1], dir);
    // The billed call's spending cap, and the model the eval cases pin.
    assert.equal(args[args.indexOf('--max-budget-usd') + 1], '1');
    assert.equal(args[args.indexOf('--model') + 1], PINNED);
    const rows = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((e) => e.type), ['user', 'assistant', 'user', 'assistant']);
    assert.equal(rows[1].message.content[0].input.file_path, '/plugin/skills/prompt-engine/references/questions.md');
    assert.equal(rows[3].message.content[0].text, 'Saved to /workspace/notes.md and ~/backup.md');
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
    assert.doesNotMatch(leak.stderr, /^\s+at /m, 'no stack trace');
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

test('record-history.mjs passes a first message that holds the safety eval\'s fake key, which is public text', { skip: STAND_IN }, () => {
  const { parent, dir, started, out, record, cleanup } = setup();
  try {
    const key = readFileSync(join(dir, 'evals/secret-redaction-quick/prompt.md'), 'utf8').match(/\bsk-[\w-]{20,}/)?.[0];
    assert.ok(key, 'the copy holds the safety eval\'s prompt.md');
    const cfg = join(parent, 'cfg');
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    const r = record([out, `improve: call the API with ${key}`], { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(started), 'claude was started');
    assert.ok(readFileSync(out, 'utf8').includes(key), 'the fixture keeps the key');
  } finally {
    cleanup();
  }
});

test('record-history.mjs refuses a first message that names this machine\'s home folder, before claude starts', () => {
  const { parent, started, out, record, cleanup } = setup();
  try {
    // A home folder in the temp folder. On macOS and Linux that isn't under /Users or /home, so only the
    // check for this machine's home folder finds it. On Windows the temp folder is under C:\Users\<name>,
    // so the generic home-path check also reports line 1, first; the machine's own check must still fire.
    const home = join(parent, 'person');
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
    const r = record([out, `improve the notes in ${join(home, 'notes.txt')}`], { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '' });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /looks private, so nothing was sent:\n(?: {2}line \d+: [^\n]*\n)* {2}line 1: this machine's home folder\n/);
    assert.ok(!existsSync(started), 'claude was not started');
    assert.ok(!existsSync(out));
  } finally {
    cleanup();
  }
});

test('record-history.mjs reads an empty CLAUDE_CONFIG_DIR as unset, and then looks only in ~/.claude/projects', () => {
  const { home, started, out, record, cleanup } = setup();
  try {
    const r = record([out, 'write a blog post about remote work'], { CLAUDE_CONFIG_DIR: '' });
    assert.equal(r.status, 1, r.stderr);
    // Only ~/.claude/projects, not a "projects" folder relative to where the recorder runs.
    assert.ok(r.stderr.startsWith(`no transcript folder at ${join(home, '.claude', 'projects')} (a CLAUDE_CONFIG_DIR`), r.stderr);
    assert.ok(!existsSync(started), 'claude was not started');
  } finally {
    cleanup();
  }
});

test('record-history.mjs finds the transcript under ~/.claude/projects when CLAUDE_CONFIG_DIR names another folder', { skip: STAND_IN }, () => {
  const { parent, home, out, record, cleanup } = setup();
  try {
    const cfg = join(parent, 'cfg');
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    const projects = join(home, '.claude', 'projects');
    mkdirSync(projects, { recursive: true });
    const r = record([out, 'write a blog post about remote work'], { CLAUDE_CONFIG_DIR: cfg, FAKE_PROJECTS: projects });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(out));
  } finally {
    cleanup();
  }
});
