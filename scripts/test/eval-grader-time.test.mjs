// Times every regex grader of the eval cases on long replies that repeat one piece, the way claude
// plugin eval runs a grader: s.match(new RegExp(pattern, flags + 'g')) and then
// new RegExp(pattern, flags).test(s), synchronously and with no time limit (read in Claude Code
// 2.1.321's code). A pattern that backtracks too much on such a reply holds up the whole eval run,
// so each piece below is one that made some grader take seconds at 56799e0 or in a later version
// of step 1e (the spaces, tabs and single-dash words of B2.1.1 and B2.1.2 only there). Real
// replies take milliseconds either way.
// Two legs: Node's engine (V8), and JavaScriptCore, the engine of the Bun runtime that Claude Code
// runs in, through macOS's jsc shell or a bun on PATH. Some patterns that V8 runs fast are
// quadratic in JavaScriptCore, so the second leg matters; it is skipped where neither is there.
// A pattern is slow on a reply that it takes LIMIT_MS or more on in each of three tries (one try
// when it takes more than three times that), so a pause on a busy machine doesn't count. A busy
// machine slows a linear pattern in every try, though: some linear menu graders took about 400 ms
// in JavaScriptCore at a load of 4, and over 1,000 ms at loads of 10 and more, which failed the
// leg (step 1e). So a slow pattern fails only when its time doesn't grow linearly with the
// reply's length, judged from three tries each on a quarter, a half and all of the reply, taken
// in turns so that the three lengths see the same loads, by the median time of each length. It
// fails when both doublings of the length take more than 2.8 times as long (2 for linear growth,
// 4 for quadratic), or when the whole reply takes less than 1.5 times as long as its quarter, as
// JavaScriptCore did on the menu graders without their {0,200} bound. A jump at one doubling
// alone doesn't fail: Bun's times jumped from about 20 ms to 1 s between two lengths of a linear
// shape. Until step 1e's B2.2.5 the best try on the half and on the whole decided, and one quiet
// moment during a try on the half failed linear patterns under a changing load. A time over ten
// times LIMIT_MS fails without the growth test. The JavaScriptCore leg runs the shapes on which
// linear patterns take hundreds of milliseconds there with fewer repeats, given after the
// shape's repeats. Graders that share a pattern and flags are timed once. A last test checks that
// the menu graders match long correct replies in JavaScriptCore as in V8 (B2.2.4). No model calls.
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

// [label, prefix, piece, repeats, repeats in JavaScriptCore, suffix]: the reply is the prefix, the
// piece repeated, then the suffix, if any. The repeats in JavaScriptCore, when not null, are given
// for the shapes on which linear patterns took 0.4 to 0.8 s in macOS's jsc at a load of about 10
// (step 1e, B2.2.5). With those repeats, the slow patterns that each of these shapes was made for
// still took from 1.7 s to over a minute there at loads of 15 to 22, and V8 runs the full repeats.
const SHAPES = [
  // An unanchored search that starts with #+ reads the rest of the run from every # of it
  // (B1.2.1): 35 graders, among them every Full prompt heading check, took seconds at 40,000.
  ['a run of #', '', '#', 40_000],
  ['a line, then a run of #', 'x\n', '#', 40_000],
  // A region that runs from a Full prompt heading to the next heading that starts a line, when
  // every later heading starts mid-line (B1.2.2): each heading read to the end of the reply.
  ['Full prompt headings after [[', '', '# Full prompt\n[[', 6_000, 3_000],
  // [^\]\n]* read from every [[ to the end of the line (B1.2.2).
  ['one line of [[x under a Full prompt heading', '# Full prompt\n', '[[x', 15_000],
  // [\s\S]*What next\? and [\s\S]*?What next\? read the rest of the reply from every What next?;
  // Done\b[^\n]*★ the rest of the line from every Done; [^\n]*\b[a-d]\)[^\n]*★ the rest of the
  // line from every a) to d); [\s\S]* the rest of the reply from every Clear goal row; and the
  // aspect-ratio graders the rest of the line from every --ar (B1.2.3). Only JavaScriptCore was
  // slow on the first three.
  ['What next? repeated', '', 'What next?', 13_000],
  ['one line of Done options after What next?', 'What next?', ' 1. Done', 5_000],
  ['one line of a)', '', 'a) ', 43_000, 20_000],
  ['| Clear goal | repeated', '', '| Clear goal |', 9_000, 4_500],
  ['one line of --ar 1:1 under a Full prompt heading', '### Full prompt\n```text\nx', ' --ar 1:1', 5_000],
  // The aspect-ratio graders read --no's list one word at a time after the --ar (step 1e).
  ['a long --no list under a Full prompt heading', '### Full prompt\n```text\nx --ar 1:1 --no', ' a', 40_000],
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
  ['one line of bulleted Run it now options, after a ★', '★ What next? Refine', ' - Run it now', 8_000, 2_500],
  ['one line of bulleted Done options, after a ★', '★ What next? Refine', ' - Done', 10_000, 3_000],
  // A run of spaces or tabs on a line under a Full prompt heading: in JavaScriptCore, the menu
  // graders' lookbehinds before an open placeholder's [[ read the run back from every place in it,
  // until they first looked for the [[ (step 1e, B2.1.1). V8 was fast.
  ['a run of spaces on a line under a Full prompt heading', '### Full prompt\nx', ' ', 3_000],
  ['a run of tabs on a line under a Full prompt heading', '### Full prompt\nx', '\t', 3_000],
  // The same runs, and single-dash words, on the Full prompt's fenced line: the Midjourney --ar
  // graders gave their description back one character at a time and read the rest of the line
  // again from each place, in V8 and JavaScriptCore, until they read it in a lookahead (step 1e,
  // B2.1.2). In V8 they took over a second only from about 8,000 single-dash words on.
  ["a run of spaces on the Full prompt's fenced line", '### Full prompt\n```text\nx', ' ', 3_000],
  ["a run of tabs on the Full prompt's fenced line", '### Full prompt\n```text\nx', '\t', 3_000],
  ["single-dash words on the Full prompt's fenced line", '### Full prompt\n```text\nx', ' -a', 8_000],
  // A heading repeated on one line: the prompt-fenced graders and coding's 06 read the rest of
  // the line from each heading on it. What I added sections whose headings don't start a line, so
  // that each section ran on to the end, where an untagged bullet failed it: the English
  // every-bullet graders read it again from each heading. And indented # lines, whose sections the
  // translated ones scanned to the end from each line. Until step 1e's B2.2.6 these took seconds
  // in V8 and JavaScriptCore.
  ['#Full prompt repeated on one line', '', '#Full prompt', 11_000],
  ['#Short version repeated on one line', '', '#Short version', 9_400],
  ['What I added sections that start mid-line, an untagged bullet last', '', 'x # What I added\n- a [you]\n', 5_000, null, '- b\n'],
  ['indented # lines', '', ' #\n', 11_000],
];
// The reply of a shape with n repeats, and its first half and quarter, each with the shape's
// suffix, if it has one.
const replies = (prefix, piece, n, suffix = '') => [n, Math.ceil(n / 2), Math.ceil(n / 4)].map((k) => prefix + piece.repeat(k) + suffix);

// Whether a pattern is slow on a reply, from time(s), which times it on s: '' when it isn't, else
// what was measured. half and quarter are the reply's first half and quarter. Both legs run it;
// the JavaScriptCore one as source text, so it is plain JavaScript that the jsc shell and Bun both
// read.
function slowness(time, full, half, quarter, limit) {
  var ms = 0;
  for (var k = 0; k < 3; k++) {
    ms = time(full);
    if (ms < limit || ms > 3 * limit) break;
  }
  if (ms < limit) return '';
  if (ms > 10 * limit) return Math.round(ms) + ' ms';
  // Three rounds over the three lengths, the second in reverse order, so that a load that rises or
  // falls during the rounds reaches each length alike.
  var texts = [quarter, half, full], names = ['a quarter of', 'half', 'all of'], t = [[], [], []];
  for (var r = 0; r < 3; r++) {
    for (var i = 0; i < 3; i++) {
      var j = r === 1 ? 2 - i : i, x = time(texts[j]);
      if (x > 10 * limit) return Math.round(x) + ' ms on ' + names[j] + ' the reply';
      t[j].push(x);
    }
  }
  // The median of each length, and at least 1 ms, so that a length that took no time divides.
  var m = t.map(function (a) { return Math.max(1, a.sort(function (a1, a2) { return a1 - a2; })[1]); });
  if (m[2] < limit) return '';
  var superLinear = m[1] / m[0] > 2.8 && m[2] / m[1] > 2.8, flat = m[2] < 1.5 * m[0];
  if (!superLinear && !flat) return '';
  return Math.round(m[2]) + ' ms, ' + Math.round(m[1]) + ' ms on half the reply and ' + Math.round(m[0]) + ' ms on a quarter';
}

test('the timing test reads the regex graders', () => {
  assert.ok(PATTERNS.length > 40, `only ${PATTERNS.length} regex patterns found`);
});

// A busy machine slows every pattern, so a slow time fails a pattern only when its time doesn't
// grow linearly with the reply's length (step 1e: at loads of 10 and more, the JavaScriptCore leg
// failed linear menu graders that took about 400 ms at a load of 4).
test('a slow pattern fails only when its time does not grow linearly, so a busy machine fails no linear one', () => {
  // time(s) for a pattern whose tries on the reply, its half and its quarter take the times listed
  // for each, in turn; the last one again once the list runs out.
  const replay = (series) => {
    const at = { full: 0, half: 0, quarter: 0 };
    return (s) => series[s][Math.min(at[s]++, series[s].length - 1)];
  };
  const verdict = (full, half, quarter) => slowness(replay({ full, half, quarter }), 'full', 'half', 'quarter', 1_000);
  assert.equal(verdict([300], [150], [75]), '', 'fast');
  assert.equal(verdict([1_500], [750], [375]), '', 'linear, on a busy machine');
  assert.equal(verdict([2_400], [1_500], [1_050]), '', 'linear, with a fixed part');
  assert.equal(verdict([4_000], [1_000], [250]), '4000 ms, 1000 ms on half the reply and 250 ms on a quarter', 'quadratic');
  assert.equal(verdict([4_000, 4_100, 4_050, 4_020], [1_000, 1_020, 990], [250, 600, 240]), '4050 ms, 1000 ms on half the reply and 250 ms on a quarter', 'quadratic, with a slow try on the quarter');
  // JavaScriptCore can be as slow on part of the reply as on all of it, as it was on some menu
  // patterns without their {0,200} bound.
  assert.match(verdict([5_000], [5_000], [5_000]), /^5000 ms, 5000 ms on half/, 'as slow on a quarter of the reply');
  assert.match(verdict([40_000], [20_000], [10_000]), /^40000 ms$/, 'far over the limit: no growth test');
  assert.equal(verdict([5_000], [40_000], [100]), '40000 ms on half the reply', 'far over the limit on half the reply');
  // The tries on the reply and its half behind a failure of the JavaScriptCore leg at 5b9758d, at
  // a load of 24 to 32 (step 1e, B2.2.5): the old rule's best tries, 1,004 ms and 295 ms, gave 3.4
  // times. The quarter's times are about half the half's, as for the linear pattern it was.
  assert.equal(verdict([1_120, 1_050, 1_080, 1_004, 1_090, 1_080], [295, 430, 450], [215, 230, 150]), '', 'linear, under a changing load');
  // Bun's time on a linear shape jumped from about 20 ms to 1 s between two of its lengths.
  assert.equal(verdict([1_034], [21], [10]), '', 'a jump at one doubling');
  assert.equal(verdict([1_034], [900], [10]), '', 'a jump at the other doubling');
  // As before, one try under the limit is enough, and so is a median under it during the growth test.
  assert.equal(verdict([1_500, 900, 1_500], [100], [50]), '', 'one fast try');
  assert.equal(verdict([1_500, 1_500, 1_500, 900, 1_500, 900], [100], [50]), '', 'fast again during the growth test');
});

test('every regex grader takes linear time on long repeated replies (V8)', () => {
  const run = new vm.Script("s.match(new RegExp(p, f.includes('g') ? f : f + 'g')); new RegExp(p, f).test(s)");
  const slow = [];
  for (const [label, prefix, piece, n, , suffix] of SHAPES) {
    const [full, half, quarter] = replies(prefix, piece, n, suffix);
    for (const { name, pattern, flags } of PATTERNS) {
      // A try stops at ten times the limit, which fails the pattern anyway.
      const time = (s) => {
        const t0 = performance.now();
        try {
          run.runInNewContext({ p: pattern, f: flags, s }, { timeout: 10 * LIMIT_MS });
        } catch (e) {
          if (e?.code !== 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw e;
          return Infinity;
        }
        return performance.now() - t0;
      };
      const found = slowness(time, full, half, quarter, LIMIT_MS);
      if (found) slow.push(`${name} on ${label}: ${found}`);
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
var replies = ${replies};
${slowness}
for (var i = 0; i < S.length; i++) {
  var texts = replies(S[i][1], S[i][2], S[i][4] || S[i][3], S[i][5]);
  for (var j = 0; j < P.length; j++) {
    var p = P[j];
    say('RUN\\t' + p.name + ' on ' + S[i][0]);
    var found = slowness(function (s) {
      var t0 = now();
      s.match(new RegExp(p.pattern, p.flags.indexOf('g') >= 0 ? p.flags : p.flags + 'g'));
      new RegExp(p.pattern, p.flags).test(s);
      return now() - t0;
    }, texts[0], texts[1], texts[2], LIMIT);
    if (found) say('SLOW\\t' + p.name + ' on ' + S[i][0] + '\\t' + found);
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

// Past some amount of work on one match, JavaScriptCore stops and reports no match, with no error:
// the menu graders, whose tempered loops such as (?:(?!What next\?)[\s\S])* passed once per
// character, failed correct replies from about 50 KB in Bun 1.4.4, and from about 128 KB in macOS's
// jsc (step 1e, B2.2.4). So each menu grader must match a long correct reply there as V8 does, with
// the reply's text before the Full prompt heading, inside the Full prompt, or after it. Bun, the
// runtime of claude plugin eval, comes first, since it gave up sooner than jsc.
const LINE = 'Write the launch email in a friendly, plain tone for busy readers.\n';
const SCORE = '| | Original | Enhanced |\n|---|---|---|\n| Clear goal | 1 | 3 |\n| Context | 0 | 3 |\n| Constraints | 0 | 3 |\n| Output format | 0 | 3 |\n| Edge cases | 0 | 2 |\n\nSelf-assessed coverage of five areas, not a prediction of output quality.';
const longReply = (where, menu, n = 2_400) => `I wrote the prompt.\n${where === 'before' ? LINE.repeat(n) : ''}\n### Full prompt\n\`\`\`text\n${where === 'in' ? LINE.repeat(n) : 'Write it.\n'}\`\`\`\n\n### Short version\n\`\`\`text\nWrite it.\n\`\`\`\n\n### What I added & why\n- **Tone** [best practice] friendly.\n\n### Assumptions\n1. Friendly tone.\n${where === 'after' ? LINE.repeat(n) : ''}\n### Score\n${SCORE}\n\n### What next?\n${menu}`;
const MENU_GRADERS = [
  ['writing-quick-launch-email/08-what-next-menu', '1. Run it now ★\n2. Refine\n3. Save to file'],
  ['followup-change-assumption/03-what-next-menu', '1. Run it now ★\n2. Refine\n3. Save to file'],
  ['private-detail-redaction-quick/08-what-next-menu', '1. Try it here ★\n2. Refine\n3. Save to file'],
  ['image-midjourney-quick/05-done-not-run', '1. Done ★\n2. Refine\n3. Save to file'],
  ['video-veo-quick/05-done-menu', '1. Done ★\n2. Refine\n3. Save to file'],
];
const verdictEngine = spawnSync('bun', ['--version']).status === 0 ? ['bun', 'run'] : existsSync(JSC) ? [JSC] : null;
test('the menu graders match long correct replies in JavaScriptCore, as in V8', { skip: !verdictEngine && 'no bun or jsc shell here' }, () => {
  const items = MENU_GRADERS.flatMap(([id, menu]) => {
    const { pattern, flags } = PATTERNS.find((p) => p.ids.includes(id));
    return ['before', 'in', 'after'].map((where) => ({ name: `${id}, text ${where} the Full prompt`, pattern, flags, reply: longReply(where, menu) }));
  });
  for (const it of items) assert.ok(new RegExp(it.pattern, it.flags).test(it.reply), `V8: ${it.name}`);
  const dir = mkdtempSync(join(tmpdir(), 'pe-grader-verdicts-'));
  try {
    const file = join(dir, 'verdicts.js');
    // As claude plugin eval runs a regex grader: match with g, then test.
    writeFileSync(file, `var I = ${JSON.stringify(items)}, out = [];
var say = typeof print === 'function' ? print : function (x) { console.log(x); };
for (var i = 0; i < I.length; i++) {
  I[i].reply.match(new RegExp(I[i].pattern, I[i].flags + 'g'));
  if (!new RegExp(I[i].pattern, I[i].flags).test(I[i].reply)) out.push(I[i].name);
}
say('NO MATCH\\t' + JSON.stringify(out));
`);
    const r = spawnSync(verdictEngine[0], [...verdictEngine.slice(1), file], { encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
    const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('NO MATCH\t'));
    assert.ok(line, `no result from ${verdictEngine[0]}: ${r.error ?? r.stderr}`);
    assert.deepEqual(JSON.parse(line.slice('NO MATCH\t'.length)), [], `${items[0].reply.length} to ${items.at(-1).reply.length} characters`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
