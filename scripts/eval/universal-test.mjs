#!/usr/bin/env node
// Two-turn behavior test for the universal copy-paste prompt. Runs
// universal/prompt-engine.md as the only system prompt, with every tool disabled
// (like a chatbot with custom instructions), then replies to the questions the
// way a user would. Real, billed model calls: about $0.05-0.15 per case on Sonnet.
//
//   node scripts/eval/universal-test.mjs [--model claude-sonnet-5-5] [--out <dir>]

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const model = arg('--model', 'claude-sonnet-5-5');
const outDir = arg('--out', mkdtempSync(join(tmpdir(), 'pe-universal-')));
const system = readFileSync(join(repo, 'universal', 'prompt-engine.md'), 'utf8');
const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pe-universal-cwd-')));
const env = { ...process.env };
delete env.CLAUDE_CODE_SESSION_ID;
delete env.CLAUDE_CODE_REMOTE_SESSION_ID;

function turn(message, sessionId) {
  const args = ['-p', message, '--system-prompt', system, '--tools', '', '--model', model,
    '--output-format', 'json', '--max-budget-usd', '0.5'];
  if (sessionId) args.push('--resume', sessionId);
  const r = spawnSync('claude', args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

const has = (re) => (t) => re.test(t);
const STRUCTURE = [
  ['full prompt heading', has(/#+\s*Full prompt/i)],
  ['short version heading', has(/#+\s*Short version/i)],
  ['what I added heading', has(/#+\s*What I added/i)],
  ['assumptions heading', has(/#+\s*Assumptions/i)],
  ['score table', has(/\|\s*Clear goal\s*\|[\s\S]*\|\s*Edge cases\s*\|/i)],
  ['score caveat', has(/not a prediction of output quality/i)],
  ['what next menu', has(/What next\?/i)],
];
const QUESTIONS = [
  ['numbered questions', has(/(^|\n)\s*1[.)]\s/)],
  ['recommendation marker', has(/★/)],
  ['ok reply line', has(/\bok\b/i)],
  ['no full prompt yet', (t) => !/#+\s*Full prompt/i.test(t)],
];

const CASES = [
  { name: 'coding-standard-then-ok', turns: ['prompt-engine: add login to my app', 'ok'], checks: [QUESTIONS, STRUCTURE] },
  { name: 'writing-standard-then-override', turns: ['prompt-engine: write a blog post about remote work', '1a 3: under 800 words'], checks: [QUESTIONS, STRUCTURE] },
  { name: 'writing-quick', turns: ['prompt-engine: quick: write a launch email for my productivity app'], checks: [STRUCTURE] },
  { name: 'midjourney-quick', turns: ['prompt-engine: quick: a Midjourney prompt for a cozy cabin in the snow at night'],
    checks: [[...STRUCTURE.filter(([n]) => n !== 'short version heading'), ['--ar parameter', has(/--ar\s+\d+:\d+/)]]] },
];

mkdirSync(outDir, { recursive: true });
let failures = 0;
let cost = 0;
for (const c of CASES) {
  let session;
  const replies = [];
  c.turns.forEach((msg, i) => {
    const res = turn(msg, session);
    session = res.session_id;
    cost += res.total_cost_usd ?? 0;
    replies.push(res.result ?? '');
    writeFileSync(join(outDir, `${c.name}.turn${i + 1}.md`), `> ${msg}\n\n${res.result}\n`);
    for (const [label, ok] of c.checks[i] ?? []) {
      const pass = ok(res.result ?? '');
      if (!pass) failures++;
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name} turn ${i + 1}: ${label}`);
    }
  });
}
console.log(`\noutputs in ${outDir}\ntotal cost $${cost.toFixed(2)}; ${failures} failed check(s)`);
process.exit(failures ? 1 : 0);
