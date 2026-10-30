// Times every rule in data/lint-rules.json on adversarial input: fragments of
// the rule's own pattern (its literals, alone and in a row, characters its
// classes match, astral ones included, and characters that two of its classes
// both match), repeated to 50,000 characters. A pattern that backtracks too
// much (and so could stall the MCP server's check_prompt) takes LIMIT_MS or
// more on some input, in each of three tries, and fails; the shipped rules take
// a few milliseconds. This is a second check, separate from the gate in
// mcp/src/check.ts, which check_prompt applies to every rule.
// Each scan runs under a vm timeout, so a catastrophic pattern fails the test
// instead of hanging it. Zero dependencies.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.PE_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { rules } = JSON.parse(readFileSync(join(root, 'data', 'lint-rules.json'), 'utf8'));

// Characters per input, counted as code points, as check_prompt's limit is.
const SIZE = 50_000;
// The shipped rules need at most a few milliseconds for each input; the bound
// is generous so that slow or busy CI machines pass.
const LIMIT_MS = 100;
// A scan still running after this long is stopped and counts as a failure.
const TIMEOUT_MS = 2_000;

// Characters that \d, \w, \s and their negations stand for.
const ESCAPE_SAMPLES = { d: ['1'], D: ['a', ' '], w: ['a', '_', '1'], W: [' ', ','], s: [' ', '\t', '\n'], S: ['a', '1'] };
// Characters to pad with: an emoji and an astral letter, which are two UTF-16
// units each, as well as ASCII.
const FILLERS = [' ', 'a', '1', ',', '\n', '😀', '𝐀'];
// Characters tried against each character class, most telling first; each
// class contributes its first CLASS_SAMPLES matches. A class that matches
// fewer of these is sampled by walking every code point instead.
const CANDIDATES = [
  ...' a1{[,.-_\t\n"\'<#*:/éZ9}]>()|?',
  '😀',
  '𝐀',
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
  '日',
];
const CLASS_SAMPLES = 4;

const sampled = new Map();
/** Up to CLASS_SAMPLES characters that one class, such as [ぁ-ゖ] or \p{Lu}, matches. */
export function samples(atom, flags = '') {
  const key = `${atom}/${flags}`;
  if (!sampled.has(key)) {
    const one = new RegExp(`^(?:${atom})$`, flags.replace(/[gy]/g, ''));
    const found = CANDIDATES.filter((c) => one.test(c)).slice(0, CLASS_SAMPLES);
    for (let cp = 0x80; found.length < CLASS_SAMPLES && cp <= 0x10ffff; cp++) {
      const c = String.fromCodePoint(cp);
      if (!found.includes(c) && one.test(c)) found.push(c);
    }
    sampled.set(key, found);
  }
  return sampled.get(key);
}

/** The character an escape such as \n, \x41, A, \u{1F600} or \cJ stands for. */
function unescape(escape) {
  const body = escape.slice(1);
  if (/^x[\dA-Fa-f]{2}$|^u[\dA-Fa-f]{4}$/.test(body)) return String.fromCharCode(parseInt(body.slice(1), 16));
  if (/^u\{[\dA-Fa-f]+\}$/.test(body)) return String.fromCodePoint(parseInt(body.slice(2, -1), 16));
  if (/^c[A-Za-z]$/.test(body)) return String.fromCharCode(body.charCodeAt(1) % 32);
  return { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v', 0: '\0' }[body] ?? body;
}

/** Where the class that opens at i ends. As in JavaScript, a ] right after [ or [^ closes it; under v, classes nest. */
function classEnd(source, i, flags) {
  let depth = 0;
  for (let end = i; end < source.length; end++) {
    const c = source[end];
    if (c === '\\') end++;
    else if (c === '[' && (depth === 0 || flags.includes('v'))) {
      depth++;
      if (source[end + 1] === '^') end++;
      if (source[end + 1] === ']') {
        end++;
        if (--depth === 0) return end;
      }
    } else if (c === ']' && --depth === 0) return end;
  }
  return source.length - 1;
}

/** The literal runs of a pattern, in order, and characters its classes and class escapes match. */
export function fragments(source, flags = '') {
  const unicode = /[uv]/.test(flags);
  const literals = [];
  const chars = new Set();
  // The classes and class escapes, as patterns of one character.
  const atoms = new Set();
  let run = '';
  const flush = () => {
    if (run) literals.push(run);
    run = '';
  };
  const sample = (atom) => {
    flush();
    atoms.add(atom);
    for (const c of samples(atom, flags)) chars.add(c);
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      const next = source[i + 1] ?? '';
      if (unicode && /[pP]/.test(next) && source[i + 2] === '{') {
        const end = source.indexOf('}', i);
        sample(source.slice(i, end + 1));
        i = end;
      } else if (ESCAPE_SAMPLES[next]) {
        flush();
        atoms.add(`\\${next}`);
        for (const ch of ESCAPE_SAMPLES[next]) chars.add(ch);
        i++;
      } else if (next === 'b' || next === 'B') {
        flush();
        i++;
      } else {
        const escape = (unicode && /^\\u\{[\dA-Fa-f]+\}/.exec(source.slice(i))) || /^\\(?:x[\dA-Fa-f]{2}|u[\dA-Fa-f]{4}|c[A-Za-z]|[^])/.exec(source.slice(i));
        run += unescape(escape[0]);
        i += escape[0].length - 1;
      }
      continue;
    }
    if (c === '[') {
      const end = classEnd(source, i, flags);
      sample(source.slice(i, end + 1));
      i = end;
      continue;
    }
    if (c === '{') {
      const quantifier = /^\{\d+(,\d*)?\}/.exec(source.slice(i));
      if (quantifier) {
        flush();
        i += quantifier[0].length - 1;
        continue;
      }
    }
    if (c === '(') {
      flush();
      // Skip the group's head, such as ?: or ?<=, which isn't text to match.
      i += /^\((?:\?(?:<?[=!]|<[\w$]+>|[ims]*(?:-[ims]*)?:))?/.exec(source.slice(i))[0].length - 1;
      continue;
    }
    if (')|?*+.^$'.includes(c)) flush();
    else run += c;
  }
  flush();
  // Repetitions of two classes side by side, such as \p{Script=Cyrillic}{1,30}
  // and \p{Ll}{10}, backtrack only on text that both match (here the Cyrillic
  // small letters, not Ж or the Latin a).
  const list = [...atoms];
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      for (const c of samples(`(?=(?:${list[a]})$)(?:${list[b]})`, flags)) chars.add(c);
    }
  }
  return { literals, chars: [...chars] };
}

/** Adversarial inputs of `size` characters built from a pattern's fragments, as [label, input] pairs. */
export function* adversarialInputs(source, flags = '', size = SIZE) {
  const { literals, chars } = fragments(source, flags);
  const unique = [...new Set(literals)];
  const firsts = unique.map((l) => String.fromCodePoint(l.codePointAt(0)));
  const pieces = [...new Set([...unique, ...firsts])];
  const fills = [...new Set([...chars, ...FILLERS, ...firsts])];
  // About `size` characters: each repeat unit counts by its code points.
  const repeat = (unit) => unit.repeat(Math.ceil(size / [...unit].length));
  const show = (s) => JSON.stringify(s);
  for (const fill of fills) yield [`${show(fill)} repeated`, repeat(fill)];
  for (const piece of pieces) {
    yield [`${show(piece)} repeated`, repeat(piece)];
    for (const fill of fills) {
      // One opening followed by a long run that never closes, then the same pair repeated.
      yield [`${show(piece)} then ${show(fill)} repeated`, piece + fill.repeat(size)];
      yield [`${show(piece + fill)} repeated`, repeat(piece + fill)];
      yield [`${show(piece)} and 40 × ${show(fill)}, repeated`, repeat(piece + fill.repeat(40))];
    }
  }
  for (const a of unique) for (const b of unique) if (a !== b) yield [`${show(a + b)} repeated`, repeat(a + b)];
  // The literals in their order, apart, with and without the last one: a
  // pattern such as "if ... then ... else ... end" tries every gap at every start.
  if (literals.length > 2) {
    for (const fill of fills) {
      for (const gap of [fill, fill.repeat(20)]) {
        yield [`the literals with ${show(gap)} between`, repeat(literals.join(gap) + gap)];
        yield [`all but the last literal with ${show(gap)} between`, repeat(literals.slice(0, -1).join(gap) + gap)];
      }
    }
  }
}

// check_prompt's own loop: exec from lastIndex, and after an empty match step
// on by a whole character (two units at a surrogate pair under u or v). It
// counts the empty matches, which check_prompt never reports.
const SCAN = new vm.Script(`(() => {
  const wide = /[uv]/.test(re.flags);
  let empty = 0;
  re.lastIndex = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[0]) continue;
    empty++;
    const pair = (s.charCodeAt(m.index) & 0xfc00) === 0xd800 && (s.charCodeAt(m.index + 1) & 0xfc00) === 0xdc00;
    re.lastIndex = m.index + (wide && pair ? 2 : 1);
  }
  return empty;
})()`);

/**
 * Runs a pattern over every adversarial input and returns the slowest one; stops
 * at the first input that takes `limitMs` or more (ms is Infinity on a timeout).
 * An input that takes `limitMs` or more is timed twice more and keeps its
 * fastest time, so one pause elsewhere on a busy machine doesn't fail a rule.
 * Also returns how many inputs ran and where the pattern first matched the
 * empty string. `now` is the clock, for tests.
 */
export function slowestInput(source, flags = '', { size = SIZE, limitMs = LIMIT_MS, timeoutMs = TIMEOUT_MS, now = () => performance.now() } = {}) {
  const context = vm.createContext({ re: new RegExp(source, flags.includes('g') ? flags : `${flags}g`), s: '' });
  // One scan of context.s: its time (Infinity on a timeout) and its empty matches.
  const scan = () => {
    const start = now();
    try {
      const empty = SCAN.runInContext(context, { timeout: timeoutMs });
      return { ms: now() - start, empty };
    } catch (error) {
      if (error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return { ms: Infinity, empty: 0 };
      throw error;
    }
  };
  let slowest = { label: 'no input', ms: 0, inputs: 0, empty: undefined };
  for (const [label, input] of adversarialInputs(source, flags, size)) {
    slowest.inputs++;
    context.s = input;
    let { ms, empty } = scan();
    for (let retry = 0; retry < 2 && ms >= limitMs && ms !== Infinity; retry++) ms = Math.min(ms, scan().ms);
    if (ms === Infinity) return { ...slowest, label, ms };
    if (empty && !slowest.empty) slowest.empty = label;
    if (ms > slowest.ms) slowest = { ...slowest, label, ms };
    if (ms >= limitMs) break;
  }
  return slowest;
}

test('data/lint-rules.json has rules, each a valid pattern', () => {
  assert.ok(rules.length > 0);
  for (const rule of rules) assert.doesNotThrow(() => new RegExp(rule.pattern, rule.flags), rule.id);
});

/** Checks one rule, timing first so a slow rule fails on its time; throws the first failure. */
export function checkRule(rule, { timeoutMs = TIMEOUT_MS } = {}) {
  const { label, ms, inputs, empty } = slowestInput(rule.pattern, rule.flags, { timeoutMs });
  const took = ms === Infinity ? `more than ${timeoutMs} ms` : `${Math.round(ms)} ms`;
  assert.ok(
    ms < LIMIT_MS,
    `${rule.id} took ${took} on ${label} (${SIZE.toLocaleString('en-US')} characters). ` +
      "Bound every repetition, for example [^\\n]{0,80} instead of * or +, don't repeat groups, " +
      "and don't put repetitions that can match the same characters side by side.",
  );
  assert.ok(inputs > 0, `${rule.id}: no inputs were generated from this pattern; fragments() in this file can't read it`);
  assert.ok(inputs > 10, `${rule.id}: only ${inputs} inputs`);
  assert.equal(empty, undefined, `${rule.id} matched the empty string on ${empty}; check_prompt skips such rules`);
}

for (const rule of rules) {
  test(`${rule.id} runs in linear time on adversarial input`, () => checkRule(rule));
}

test('a slow rule fails on its time, not on how many inputs ran before it stopped', () => {
  assert.throws(() => checkRule({ id: 'slow', pattern: 'a{0,200}a{0,200}!', flags: '' }, { timeoutMs: 300 }), /slow took more than 300 ms on "a" repeated/);
});

test('the timing check catches slow patterns', () => {
  for (const [pattern, flags] of [
    // The old placeholder rule.
    [String.raw`\[\[[^\]]+\]\]`, ''],
    // Nested repetition after [^], which JavaScript reads as a whole class, and
    // slow only on one literal followed by a run of another.
    ['[^](a+)+]', ''],
    ['you are[^](?:ж+)+]', ''],
    // Bounded repetitions side by side: over a \p{..} class, over a range
    // outside ASCII, between literals in a row, and over emoji only.
    [String.raw`\p{Lu}{2,40} ?\p{Lu}{2,40} ?\p{Lu}{2,40}\b`, 'u'],
    ['(?:「)?[ぁ-ゖ]{0,200}[ぁ-ゖ]{0,200}[ぁ-ゖ]{0,200}[。！]', ''],
    [String.raw`\bif\b[^.]{0,200}\bthen\b[^.]{0,200}\belse\b[^.]{0,200}\bend\b`, 'i'],
    [String.raw`\p{Extended_Pictographic}{1,40} ?\p{Extended_Pictographic}{1,20}!`, 'u'],
  ]) {
    assert.ok(slowestInput(pattern, flags, { timeoutMs: 300 }).ms >= LIMIT_MS, `/${pattern}/${flags}`);
  }
});

test('the timing check catches patterns that are slow but not catastrophic', () => {
  // Each took about 330 ms on its worst input when this test was written, so a
  // limit of 500 ms would let them pass. The first is on emoji. The second,
  // which check_prompt's gate accepts, is slow only on the Cyrillic small
  // letters, which both of its classes match.
  for (const [pattern, flags] of [
    [String.raw`\p{Extended_Pictographic}{1,40} ?\p{Extended_Pictographic}{1,10}!`, 'u'],
    [String.raw`\p{Script=Cyrillic}{1,30}\p{Ll}{10}!`, 'u'],
  ]) {
    const { ms, label } = slowestInput(pattern, flags);
    assert.ok(ms >= LIMIT_MS, `/${pattern}/${flags}: ${Math.round(ms)} ms on ${label}`);
  }
});

test('a rule fails only if every try of an input is slow, so one pause elsewhere on the machine is not enough', () => {
  let readings = 0;
  // The clock reads a second late once: at the end of the first scan.
  const now = () => performance.now() + (++readings === 2 ? 1_000 : 0);
  const { ms } = slowestInput(String.raw`\b(MUST|NEVER)\b`, '', { now });
  assert.ok(ms < LIMIT_MS, `took ${ms} ms`);
  assert.ok(readings > 2);
});

test('the scan steps past empty matches as check_prompt does, and reports them', () => {
  // The inputs include emoji; under u, stepping by one unit would never leave one.
  const { ms, empty } = slowestInput('(?:TODO)?', 'u', { size: 1_000, timeoutMs: 1_000 });
  assert.ok(ms < LIMIT_MS, `took ${ms} ms`);
  assert.ok(empty, 'no empty match reported');
});

test('fragments reads [] and [^] as JavaScript does, and samples classes outside ASCII', () => {
  assert.deepEqual(fragments('[^](a+)+]').literals, ['a', ']']);
  assert.deepEqual(fragments('x[]|z*z*q]').literals, ['x', 'z', 'z', 'q]']);
  assert.deepEqual(fragments('[ぁ-ゖ]{0,5}').chars, ['ぁ', 'あ', 'ぃ', 'い']);
  assert.ok(fragments(String.raw`\p{Lu}{2,40}`, 'u').chars.includes('𝐀'));
  assert.deepEqual(fragments(String.raw`\x41\u0042\u{1F600}`, 'u').literals, ['AB😀']);
  assert.deepEqual(fragments(String.raw`\bif\b[^.]{0,200}\bthen\b[^.]{0,200}\belse\b`).literals, ['if', 'then', 'else']);
});

test('fragments samples characters that two classes both match', () => {
  // Cyrillic small a: neither class alone samples it.
  assert.ok(!fragments(String.raw`\p{Script=Cyrillic}`, 'u').chars.includes('\u0430'));
  assert.ok(!fragments(String.raw`\p{Ll}`, 'u').chars.includes('\u0430'));
  assert.ok(fragments(String.raw`\p{Script=Cyrillic}{1,30}\p{Ll}{10}!`, 'u').chars.includes('\u0430'));
});
