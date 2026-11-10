// Times every regex grader of the eval cases on long replies that repeat one piece, the way claude
// plugin eval runs a grader: s.match(new RegExp(pattern, flags + 'g')) and then
// new RegExp(pattern, flags).test(s), synchronously and with no time limit (read in Claude Code
// 2.1.321's code). A pattern that backtracks too much on such a reply holds up the whole eval run,
// so each piece below is one that made some grader take seconds at 56799e0 (step 1e). Real
// replies take milliseconds either way.
// Two legs: Node's engine (V8), and JavaScriptCore, the engine of the Bun runtime that Claude Code
// runs in, through macOS's jsc shell or a bun on PATH. Some patterns that V8 runs fast are
// quadratic in JavaScriptCore, so the second leg matters; it is skipped where neither is there.
// A pattern fails when one reply takes LIMIT_MS or more in each of three tries (one try when it
// takes more than three times that), so a pause on a busy machine doesn't fail a linear pattern.
// Graders that share a pattern and flags are timed once. No model calls.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { frontmatter } from '../eval-cases.mjs';

const EVALS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'evals');
const LIMIT_MS = 1_000;

// Every regex grader, one entry per pattern and flags, named by the graders that use it.
const byPattern = new Map();
for (const c of readdirSync(EVALS).sort()) {
  const dir = join(EVALS, c, 'graders');
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const { data, body } = frontmatter(readFileSync(join(dir, f), 'utf8'), `evals/${c}/graders/${f}`);
    if (data?.type !== 'regex') continue;
    const pattern = data.pattern ?? body;
    const flags = data.flags ?? '';
    const key = JSON.stringify([pattern, flags]);
    if (!byPattern.has(key)) byPattern.set(key, { ids: [], pattern, flags });
    byPattern.get(key).ids.push(`${c}/${f.replace(/\.md$/, '')}`);
  }
}
const PATTERNS = [...byPattern.values()].map((p) => ({ ...p, name: p.ids.length > 1 ? `${p.ids[0]} (and ${p.ids.length - 1} more)` : p.ids[0] }));

// [label, prefix, piece, repeats]: the reply is the prefix, then the piece repeated.
const SHAPES = [
  // An unanchored search that starts with #+ reads the rest of the run from every # of it
  // (B1.2.1): 35 graders, among them every Full prompt heading check, took seconds at 40,000.
  ['a run of #', '', '#', 40_000],
  ['a line, then a run of #', 'x\n', '#', 40_000],
  // A region that runs from a Full prompt heading to the next heading that starts a line, when
  // every later heading starts mid-line (B1.2.2): each heading read to the end of the reply.
  ['Full prompt headings after [[', '', '# Full prompt\n[[', 6_000],
  // [^\]\n]* read from every [[ to the end of the line (B1.2.2).
  ['one line of [[x under a Full prompt heading', '# Full prompt\n', '[[x', 15_000],
  // [\s\S]*What next\? and [\s\S]*?What next\? read the rest of the reply from every What next?;
  // Done\b[^\n]*★ the rest of the line from every Done; [^\n]*\b[a-d]\)[^\n]*★ the rest of the
  // line from every a) to d); [\s\S]* the rest of the reply from every Clear goal row; and the
  // aspect-ratio graders the rest of the line from every --ar (B1.2.3). Only JavaScriptCore was
  // slow on the first three.
  ['What next? repeated', '', 'What next?', 13_000],
  ['one line of Done options after What next?', 'What next?', ' 1. Done', 5_000],
  ['one line of a)', '', 'a) ', 43_000],
  ['| Clear goal | repeated', '', '| Clear goal |', 9_000],
  ['one line of --ar 1:1 under a Full prompt heading', '### Full prompt\n```text\nx', ' --ar 1:1', 5_000],
  // A run of spaces after a full stop, which an ask check read in two parts (B1.1.8), and the
  // lead-ins that the ask checks accept before a verb.
  ['spaces after a full stop', 'x.', ' ', 40_000],
  ['if you, repeated', 'x ', 'if you ', 6_000],
  // A fence opener's backticks, which the Midjourney aspect-ratio graders read again for every
  // shorter fence they tried (B1.2.3).
  ['a run of backticks under a Full prompt heading', '### Full prompt\n', '`', 40_000],
  // A starred option's ★ is looked for up to 200 characters on from the option's label, which
  // reads all 200 at every bulleted option on one line; the next numbered option stops it sooner.
  // Without the bound it read the rest of the line from each option (step 1e, B1.2.11). The ★
  // before What next? keeps V8 from returning at once, as it did on a reply with no ★ at all.
  ['one line of bulleted Run it now options, after a ★', '★ What next? Refine', ' - Run it now', 8_000],
  ['one line of bulleted Done options, after a ★', '★ What next? Refine', ' - Done', 10_000],
];
const reply = ([, prefix, piece, n]) => prefix + piece.repeat(n);

test('the timing test reads the regex graders', () => {
  assert.ok(PATTERNS.length > 40, `only ${PATTERNS.length} regex patterns found`);
});

test('every regex grader takes linear time on long repeated replies (V8)', () => {
  const run = new vm.Script("s.match(new RegExp(p, f.includes('g') ? f : f + 'g')); new RegExp(p, f).test(s)");
  const slow = [];
  for (const shape of SHAPES) {
    const s = reply(shape);
    for (const { name, pattern, flags } of PATTERNS) {
      let fast = false;
      for (let i = 0; i < 3 && !fast; i++) {
        try {
          run.runInNewContext({ p: pattern, f: flags, s }, { timeout: LIMIT_MS });
          fast = true;
        } catch (e) {
          if (e?.code !== 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw e;
        }
      }
      if (!fast) slow.push(`${name} on ${shape[0]}`);
    }
  }
  assert.deepEqual(slow, []);
});

const JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc';
const engine = existsSync(JSC) ? [JSC] : spawnSync('bun', ['--version']).status === 0 ? ['bun', 'run'] : null;
test('every regex grader takes linear time on long repeated replies (JavaScriptCore)', { skip: !engine && 'no jsc shell or bun here' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pe-grader-time-'));
  try {
    const file = join(dir, 'time.js');
    // print and preciseTime are the jsc shell's; console.log and performance.now are Bun's.
    writeFileSync(file, `var P = ${JSON.stringify(PATTERNS)}, S = ${JSON.stringify(SHAPES)}, LIMIT = ${LIMIT_MS};
var now = typeof preciseTime === 'function' ? function () { return preciseTime() * 1000; } : function () { return performance.now(); };
var say = typeof print === 'function' ? print : function (x) { console.log(x); };
for (var i = 0; i < S.length; i++) {
  var s = S[i][1] + S[i][2].repeat(S[i][3]);
  for (var j = 0; j < P.length; j++) {
    var p = P[j], ms = 0;
    say('RUN\\t' + p.name + ' on ' + S[i][0]);
    for (var k = 0; k < 3; k++) {
      var t0 = now();
      s.match(new RegExp(p.pattern, p.flags.indexOf('g') >= 0 ? p.flags : p.flags + 'g'));
      new RegExp(p.pattern, p.flags).test(s);
      ms = now() - t0;
      if (ms < LIMIT || ms > 3 * LIMIT) break;
    }
    if (ms >= LIMIT) say('SLOW\\t' + p.name + ' on ' + S[i][0] + '\\t' + Math.round(ms) + ' ms');
  }
}
say('DONE');
`);
    const r = spawnSync(engine[0], [...engine.slice(1), file], { encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
    const lines = (r.stdout ?? '').split('\n');
    const slow = lines.filter((l) => l.startsWith('SLOW\t')).map((l) => l.split('\t').slice(1).join(': '));
    if (!lines.includes('DONE')) slow.push(`stopped in ${lines.findLast((l) => l.startsWith('RUN\t'))?.slice(4) ?? 'no grader'}: ${r.error ?? r.stderr}`);
    assert.deepEqual(slow, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
