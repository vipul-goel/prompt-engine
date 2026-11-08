// Tests for scripts/eval/universal-test.mjs, with no model calls. The checks and the
// stream-json reader are imported and run on synthetic replies, and the script runs
// against a fake `claude` that checks the isolation flags and prints stream-json events.
// They test the script's own logic, not Claude Code or the model. The fake-claude tests
// are skipped on Windows, where a script on PATH needs a .cmd wrapper.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(repo, 'scripts', 'eval', 'universal-test.mjs');

// Importing must not start a run. In case the entry guard ever breaks, PATH points at an
// empty folder during the import, so the import fails instead of calling the real, billed
// `claude`.
async function importScript() {
  const empty = mkdtempSync(join(tmpdir(), 'pe-no-claude-'));
  const saved = process.env.PATH;
  process.env.PATH = empty;
  try {
    return await import(pathToFileURL(script).href);
  } finally {
    if (saved === undefined) delete process.env.PATH; else process.env.PATH = saved;
    rmSync(empty, { recursive: true, force: true });
  }
}
const U = await importScript();

const check = (list, label) => {
  const found = list.find(([name]) => name === label);
  assert.ok(found, `no check named ${label}`);
  return found[1];
};
const failing = (list, text) => list.filter(([, ok]) => !ok(text)).map(([name]) => name);

const REPLY_LINE = 'Reply `ok` to accept every ★, or answer like `2b 4: your own text`. Anything you skip gets the ★.';
const questions = (tail) => `I need a few answers.\n\n1. Who will read it?\n   a) Employees  b) Team managers ★ (they set policy)  c) Job seekers\n\n2. How long?\n   a) 600 words ★ (easy to read)  b) 1,500 words\n\n${tail}`;
const SCORE = '| Dimension | Original | Enhanced |\n|---|---|---|\n| Clear goal | 1 | 3 |\n| Context | 0 | 3 |\n| Constraints | 0 | 3 |\n| Output format | 0 | 3 |\n| Edge cases | 0 | 3 |';
const output = ({ menu = '1) Run it now ★\n2) Refine', tag = '[best practice]', prompt = 'Write a blog post about remote work.' } = {}) =>
  `I made a prompt for a chat model.\n\n### Full prompt\n\`\`\`text\n${prompt}\n\`\`\`\n\n### Short version\n\`\`\`text\nA blog post on remote work.\n\`\`\`\n\n` +
  `### What I added & why\n- Audience: team managers ${tag}\n\n### Assumptions\n1. English.\n\nReply "change 1: …" to adjust any of these.\n\n` +
  `### Score\n${SCORE}\n\nSelf-assessed coverage of five areas, not a prediction of output quality.\n\n### What next?\n${menu}`;

test('ok reply line: needs the reply line from the contract, with ok bare or in backticks', () => {
  const ok = check(U.QUESTIONS, 'ok reply line');
  assert.ok(ok(questions(REPLY_LINE)));
  assert.ok(ok(questions('Reply ok to accept every ★.')));
  assert.ok(!ok(questions('Let me know if these look OK.')));
  assert.ok(!ok(questions('Reply "ok" to accept every ★, or answer like `2b 4: your own text`.')));
});

test('no full prompt yet: a question round holds no draft, score table or menu', () => {
  const none = check(U.QUESTIONS, 'no full prompt yet');
  assert.deepEqual(failing(U.QUESTIONS, questions(REPLY_LINE)), []);
  for (const draft of [
    '### Full prompt\n```text\nWrite a post.\n```',
    '**Full prompt**\n```text\nWrite a post.\n```',
    'Full prompt: Write a blog post about remote work for managers.',
    'Here is a draft:\n```\nWrite a post.\n```',
    `### Score\n${SCORE}`,
    '### What next?\n1) Run it now ★\n2) Refine',
  ]) assert.ok(!none(questions(`${REPLY_LINE}\n\n${draft}`)), draft);
});

test('what next menu: a starred first option the method allows, numbered or bulleted, then Refine', () => {
  const menu = check(U.STRUCTURE, 'what next menu');
  for (const m of [
    '1) Run it now ★\n2) Refine\n3) Save to file',
    '1) Run it now ★ 2) Refine',
    "1) Done ★ (paste it into Midjourney, since I can't generate images)\n2) Refine",
    '1. Fill placeholders ★\n2. Refine',
    '1. Fill in the placeholders ★\n2. Refine',
    '1) Try it here ★ (results there may differ)\n2) Refine',
    '1) **Run it now** ★\n2) **Refine**',
    '- Run it now ★\n- Refine',
  ]) assert.ok(menu(output({ menu: m })), m);
  for (const m of [
    'Let me know.',
    '1) Refine ★\n2) Save to file',
    '1) Run it now\n2) Refine ★',
    '1) Run it now\n2) Refine\nTell me when you are done ★ reviewing.',
    '1) Run it now ★\n2) Save to file',
  ]) assert.ok(!menu(output({ menu: m })), m);
});

test('after ok or an override: the full output, with the accepted answers tagged [your answer]', () => {
  assert.deepEqual(failing(U.ACCEPTED, output({ tag: '[your answer]' })), []);
  assert.deepEqual(failing(U.ACCEPTED, output({ tag: '[best practice]' })), ['accepted ★ tagged']);
});

test('after deep: 1-4 new question lines, the reply line and still no draft', () => {
  assert.deepEqual(U.DEEP_ROUND.map(([name]) => name), ['1-4 new questions', 'recommendation marker', 'ok reply line', 'no full prompt yet']);
  const restated = 'Using your ★ answers so far:\n1. Team managers\n2. Balanced pros and cons\n3. Try one practice\n4. Conversational\n5. About 1,000 words\n\n' +
    `A few more questions:\n\n1. Which examples?\n   a) Tech ★ (familiar)  b) Retail\n\n2. Include data?\n   a) No ★ (avoids invented numbers)  b) Yes\n\n${REPLY_LINE}`;
  const continued = `Two more:\n\n8. **Which examples?**\n   a) Tech ★ (familiar)  b) Retail\n\n9. **Include data?**\n   a) No ★ (avoids invented numbers)  b) Yes\n\n${REPLY_LINE}`;
  const five = `${[1, 2, 3, 4, 5].map((i) => `${i}. Question ${i}?\n   a) A ★ (why)  b) B`).join('\n\n')}\n\n${REPLY_LINE}`;
  assert.deepEqual(failing(U.DEEP_ROUND, restated), []);
  assert.deepEqual(failing(U.DEEP_ROUND, continued), []);
  assert.deepEqual(failing(U.DEEP_ROUND, five), ['1-4 new questions']);
  assert.deepEqual(failing(U.DEEP_ROUND, output()), ['1-4 new questions', 'ok reply line', 'no full prompt yet']);
});

test('after change 1: the change is inside a fenced block, and the score is shown again', () => {
  const changed = 'Write a launch email for new users who found the app through its Product Hunt launch.';
  assert.deepEqual(failing(U.CHANGED, output({ prompt: changed })), []);
  assert.deepEqual(failing(U.CHANGED, `Updated.\n\n\`\`\`\`text\nAudience: new users from the Product Hunt launch.\n\`\`\`json\n{}\n\`\`\`\n\`\`\`\`\n\n${SCORE}`), []);
  assert.deepEqual(failing(U.CHANGED, `Got it: readers are new users from a Product Hunt launch. I updated the prompt.\n\n${SCORE}`), ['change applied in the prompt']);
  assert.deepEqual(failing(U.CHANGED, `\`\`\`text\n${changed}\n\`\`\``), ['score table']);
});

test('cases: six cases, with ok, an override, deep and change 1 as second turns', () => {
  assert.deepEqual(U.CASES.map((c) => c.name), ['coding-standard-then-ok', 'writing-standard-then-override', 'writing-standard-then-deep', 'writing-quick', 'writing-quick-then-change', 'midjourney-quick']);
  for (const c of U.CASES) assert.equal(c.checks.length, c.turns.length, c.name);
  assert.deepEqual(U.CASES.filter((c) => c.turns.length === 2).map((c) => [c.turns[1], c.checks[1]]), [
    ['ok', U.ACCEPTED],
    ['1a 3: under 800 words', U.ACCEPTED],
    ['deep', U.DEEP_ROUND],
    ['change 1: readers are new users from a Product Hunt launch', U.CHANGED],
  ]);
});

const lines = (...events) => events.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n';
const INIT = { type: 'system', subtype: 'init', session_id: 'session-1', model: 'claude-sonnet-5-5', tools: [], mcp_servers: [] };
const RESULT = { type: 'result', subtype: 'success', is_error: false, result: 'The reply', session_id: 'session-1', total_cost_usd: 0.02 };

test('readTurn: skips lines that are not JSON and takes the init and the last result event', () => {
  const r = U.readTurn(lines('a line that is not JSON', INIT, { type: 'assistant', message: { content: [] } }, { ...RESULT, result: 'an earlier result' }, RESULT, 'null'));
  assert.equal(r.result, 'The reply');
  assert.equal(r.session_id, 'session-1');
  assert.equal(r.total_cost_usd, 0.02);
  assert.equal(r.model, 'claude-sonnet-5-5');
  assert.deepEqual(r.leaks, []);
});

test('readTurn: lists the tools and MCP servers of every init event', () => {
  const r = U.readTurn(lines({ ...INIT, tools: ['Read', 'mcp__example__search'], mcp_servers: [{ name: 'example-server', status: 'needs-auth' }] }, { ...INIT, tools: ['Bash'] }, RESULT));
  assert.deepEqual(r.leaks, ['Read', 'mcp__example__search', 'MCP server example-server', 'Bash']);
});

test('readTurn: refuses output without an init event with both lists, without a result, or ending in an error', () => {
  assert.throws(() => U.readTurn(lines(RESULT)), /no init event/);
  assert.throws(() => U.readTurn(lines({ ...INIT, tools: undefined }, RESULT)), /no init event/);
  assert.throws(() => U.readTurn(lines({ ...INIT, mcp_servers: 'none' }, RESULT)), /no init event/);
  assert.throws(() => U.readTurn(lines(INIT)), /no result event/);
  assert.throws(() => U.readTurn(lines(INIT, { ...RESULT, is_error: true, subtype: 'error_max_budget_usd' })), /error_max_budget_usd/);
});

// The fake `claude`, written out as its own script, so it can use only what it defines. It
// refuses a call without the isolation flags, logs each message, and prints stream-json
// events with a reply that suits the message.
function fakeClaude() {
  const fs = require('node:fs');
  const env = process.env;
  const a = process.argv.slice(2);
  const val = (flag) => (a.includes(flag) ? a[a.indexOf(flag) + 1] : undefined);
  const refuse = (why) => { console.error(`fake claude: ${why}`); process.exit(3); };
  for (const flag of ['--safe-mode', '--strict-mcp-config', '--verbose']) if (!a.includes(flag)) refuse(`missing ${flag}`);
  if (val('--tools') !== '') refuse('--tools is not ""');
  if (val('--disallowedTools') !== 'mcp__*') refuse('--disallowedTools is not mcp__*');
  if (val('--output-format') !== 'stream-json') refuse('--output-format is not stream-json');
  if (val('--system-prompt') !== fs.readFileSync(env.FAKE_SYSTEM, 'utf8')) refuse('--system-prompt is not universal/prompt-engine.md');
  const msg = val('-p');
  const first = msg.startsWith('prompt-engine:');
  if (first ? a.includes('--resume') : val('--resume') !== 'session-1') refuse(`wrong --resume for "${msg}"`);
  fs.appendFileSync(env.FAKE_LOG, `${msg}\n`);

  const menu = msg.includes('Midjourney') ? '1) Done ★ (paste it into Midjourney)\n2) Refine' : '1) Run it now ★\n2) Refine';
  const output = (prompt, tag) => ['I made a prompt.', '### Full prompt', '```text', prompt, '```',
    '### Short version', '```text', 'Short.', '```', '### What I added & why', `- Audience ${tag}`,
    '### Assumptions', '1. English.', '### Score', '| | Original | Enhanced |', '|---|---|---|',
    '| Clear goal | 1 | 3 |', '| Edge cases | 0 | 3 |',
    'Self-assessed coverage of five areas, not a prediction of output quality.', '### What next?', menu].join('\n');
  const questions = (...qs) => [...qs.map((q, i) => `${i + 1}. ${q}?\n   a) Yes ★ (simplest)  b) No`),
    'Reply `ok` to accept every ★, or answer like `2b 4: your own text`.'].join('\n\n');
  let text;
  if (msg === 'deep') text = questions('Include examples', 'Include data');
  else if (msg.startsWith('change 1:')) text = output('Write a launch email for new users from the Product Hunt launch.', '[you]');
  else if (!first) text = output('Write it for team managers.', '[your answer]');
  else if (msg.includes('quick:')) text = output(msg.includes('Midjourney') ? 'A cozy cabin in the snow at night --ar 3:2' : 'Write a launch email.', '[best practice]');
  else text = questions('Who reads it', 'How long is it') + (env.FAKE_DRAFT ? '\n\n```text\nA draft.\n```' : '');

  const leak = !env.FAKE_LEAK_ON || msg === env.FAKE_LEAK_ON;
  const init = { type: 'system', subtype: 'init', cwd: process.cwd(), session_id: 'session-1', model: 'fake-model',
    tools: leak && env.FAKE_TOOLS ? env.FAKE_TOOLS.split(',') : [],
    mcp_servers: leak && env.FAKE_MCP ? [{ name: env.FAKE_MCP, status: 'connected' }] : [] };
  console.log('a line that is not JSON');
  for (const e of [init, { type: 'assistant', message: { content: [{ type: 'text', text }] } },
    { type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'session-1', total_cost_usd: 0.01 }]) {
    console.log(JSON.stringify(e));
  }
}

// Runs the script (or other node arguments) with only the fake `claude` and node on PATH, so
// the real, billed `claude` can't run, and with TMPDIR in a folder that is removed afterwards.
function runScript({ env = {}, args, fake = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-universal-test-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    if (fake) {
      writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node\n(${fakeClaude})();\n`);
      chmodSync(join(bin, 'claude'), 0o755);
    }
    symlinkSync(process.execPath, join(bin, 'node'));
    const log = join(dir, 'calls.log');
    const out = join(dir, 'out');
    const r = spawnSync(process.execPath, args ?? [script, '--out', out], {
      env: { ...process.env, ...env, PATH: bin, TMPDIR: dir, FAKE_LOG: log, FAKE_SYSTEM: join(repo, 'universal', 'prompt-engine.md') },
      encoding: 'utf8',
    });
    return {
      code: r.status,
      out: `${r.stdout}${r.stderr}`,
      calls: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [],
      files: existsSync(out) ? readdirSync(out) : [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const skip = process.platform === 'win32';

test('runs every turn of every case with the isolation flags, and passes well-formed replies', { skip }, () => {
  const r = runScript();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /total cost \$0\.10; 0 failed check\(s\)/);
  assert.deepEqual(r.calls, U.CASES.flatMap((c) => c.turns));
  assert.equal(r.out.match(/: no tools or MCP servers loaded \(fake-model\)/g).length, 10);
  assert.equal(r.files.length, 10);
});

test('stops at the first turn that loads an MCP server', { skip }, () => {
  const r = runScript({ env: { FAKE_MCP: 'example-server' } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL {2}coding-standard-then-ok turn 1: tools or MCP servers loaded: MCP server example-server; stopping/);
  assert.equal(r.calls.length, 1);
  assert.match(r.out, /; 1 failed check\(s\)/);
});

test('checks every turn: a tool that loads on a later turn also stops the run', { skip }, () => {
  const r = runScript({ env: { FAKE_TOOLS: 'Read,Bash', FAKE_LEAK_ON: 'ok' } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /PASS {2}coding-standard-then-ok turn 1: no tools or MCP servers loaded/);
  assert.match(r.out, /FAIL {2}coding-standard-then-ok turn 2: tools or MCP servers loaded: Read, Bash; stopping/);
  assert.deepEqual(r.calls, ['prompt-engine: add login to my app', 'ok']);
});

test('a failed check fails the run without stopping it', { skip }, () => {
  const r = runScript({ env: { FAKE_DRAFT: '1' } });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.calls.length, 10);
  assert.equal(r.out.match(/FAIL {2}\S+ turn 1: no full prompt yet/g).length, 3);
  assert.match(r.out, /; 3 failed check\(s\)/);
});

test('says so when claude cannot be started', { skip }, () => {
  const r = runScript({ fake: false });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /spawnSync claude ENOENT/);
});

test('runs when started through a symlink in a folder with spaces, and not when imported', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe universal link '));
  try {
    const link = join(dir, 'universal test.mjs');
    symlinkSync(script, link);
    const viaLink = runScript({ args: [link, '--out', join(dir, 'out')] });
    assert.equal(viaLink.code, 0, viaLink.out);
    assert.equal(viaLink.calls.length, 10);
    const imported = runScript({ args: ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(script).href)});`] });
    assert.equal(imported.code, 0, imported.out);
    assert.deepEqual(imported.calls, []);
    // Under -e, process.argv[1] is the first extra argument: here, this script's own path.
    const evalArg = runScript({ args: ['--input-type=module', '-e', 'await import(process.argv[1]);', script] });
    assert.equal(evalArg.code, 0, evalArg.out);
    assert.deepEqual(evalArg.calls, [], evalArg.out);
    assert.equal(U.isEntryPoint({ isMain: undefined, execArgv: [], argv1: link, self: script }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isEntryPoint: import.meta.main decides where Node sets it; older Node never runs under -e or -p', () => {
  assert.equal(U.isEntryPoint({ isMain: true, execArgv: ['-e', 'x'], argv1: undefined, self: script }), true);
  assert.equal(U.isEntryPoint({ isMain: false, execArgv: [], argv1: script, self: script }), false);
  // Without import.meta.main, as on Node 20:
  assert.equal(U.isEntryPoint({ isMain: undefined, execArgv: [], argv1: script, self: script }), true);
  for (const execArgv of [['-e', 'x'], ['--input-type=module', '--eval', 'x'], ['--eval=x'], ['-p', 'x'], ['-pe', 'x'], ['--print', 'x']]) {
    assert.equal(U.isEntryPoint({ isMain: undefined, execArgv, argv1: script, self: script }), false, execArgv.join(' '));
  }
  assert.equal(U.isEntryPoint({ isMain: undefined, execArgv: [], argv1: join(repo, 'scripts', 'build.mjs'), self: script }), false);
  assert.equal(U.isEntryPoint({ isMain: undefined, execArgv: [], argv1: undefined, self: script }), false);
});
