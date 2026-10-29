// Times every rule in data/lint-rules.json on adversarial input: fragments of
// the rule's own pattern, repeated to 50,000 characters. A pattern that
// backtracks super-linearly (and so could stall the MCP server's check_prompt)
// takes seconds on such input and fails; a linear one takes milliseconds.
// Each match runs under a vm timeout, so a catastrophic pattern fails the test
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

const SIZE = 50_000;
// A linear pattern needs a few milliseconds for 50,000 characters; the bound
// is generous so that slow or busy CI machines pass.
const LIMIT_MS = 500;
// A match still running after this long is stopped and counts as a failure.
const TIMEOUT_MS = 2_000;

// Characters that \d, \w, \s and their negations stand for.
const ESCAPE_SAMPLES = { d: ['1'], D: ['a', ' '], w: ['a', '_', '1'], W: [' ', ','], s: [' ', '\t', '\n'], S: ['a', '1'] };
// Characters to pad with.
const FILLERS = [' ', 'a', '1', ',', '\n'];
// Characters tried against each character class, most telling first; each
// class contributes its first CLASS_SAMPLES matches.
const CANDIDATES = [
  ...' a1{[,.-_\t\n"\'<#*:/éZ9}]>()|?',
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
  '日',
];
const CLASS_SAMPLES = 4;

/** The literal runs of a pattern, and characters its classes and class escapes match. */
export function fragments(source, flags = '') {
  const literals = new Set();
  const chars = new Set();
  let run = '';
  const flush = () => {
    if (run) literals.add(run);
    run = '';
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      const next = source[++i] ?? '';
      if (ESCAPE_SAMPLES[next]) {
        flush();
        for (const ch of ESCAPE_SAMPLES[next]) chars.add(ch);
      } else if (next === 'b' || next === 'B') flush();
      else run += { n: '\n', t: '\t', r: '\r' }[next] ?? next;
      continue;
    }
    if (c === '[') {
      flush();
      let end = i + 1;
      if (source[end] === '^') end++;
      if (source[end] === ']') end++;
      while (end < source.length && source[end] !== ']') end += source[end] === '\\' ? 2 : 1;
      const cls = new RegExp(`^${source.slice(i, end + 1)}$`, flags.replace(/[gy]/g, ''));
      for (const ch of CANDIDATES.filter((x) => cls.test(x)).slice(0, CLASS_SAMPLES)) chars.add(ch);
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
    if ('()|?*+.^$'.includes(c)) flush();
    else run += c;
  }
  flush();
  return { literals: [...literals], chars: [...chars] };
}

/** Adversarial inputs of `size` characters built from a pattern's fragments, as [label, input] pairs. */
export function* adversarialInputs(source, flags = '', size = SIZE) {
  const { literals, chars } = fragments(source, flags);
  const pieces = [...new Set([...literals, ...literals.map((l) => l[0])])];
  const fills = [...new Set([...chars, ...FILLERS])];
  const repeat = (unit) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
  const show = (s) => JSON.stringify(s);
  for (const piece of pieces) {
    yield [`${show(piece)} repeated`, repeat(piece)];
    for (const fill of fills) {
      // One opening followed by a long run that never closes, then the same pair repeated.
      yield [`${show(piece)} then ${show(fill)} repeated`, piece + fill.repeat(size - piece.length)];
      yield [`${show(piece + fill)} repeated`, repeat(piece + fill)];
      yield [`${show(piece)} and 40 × ${show(fill)}, repeated`, repeat(piece + fill.repeat(40))];
    }
  }
  for (const a of literals) for (const b of literals) if (a !== b) yield [`${show(a + b)} repeated`, repeat(a + b)];
}

const MATCH_ALL = new vm.Script('(() => { let n = 0; for (const m of s.matchAll(re)) n++; return n; })()');

/**
 * Runs a pattern over every adversarial input and returns the slowest one; stops
 * at the first input that takes `limitMs` or more (ms is Infinity on a timeout).
 */
export function slowestInput(source, flags = '', { size = SIZE, limitMs = LIMIT_MS, timeoutMs = TIMEOUT_MS } = {}) {
  const context = vm.createContext({ re: new RegExp(source, flags.includes('g') ? flags : `${flags}g`), s: '' });
  let slowest = { label: 'no input', ms: 0, inputs: 0 };
  for (const [label, input] of adversarialInputs(source, flags, size)) {
    slowest.inputs++;
    context.s = input;
    const start = performance.now();
    try {
      MATCH_ALL.runInContext(context, { timeout: timeoutMs });
    } catch (error) {
      if (error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return { ...slowest, label, ms: Infinity };
      throw error;
    }
    const ms = performance.now() - start;
    if (ms > slowest.ms) slowest = { ...slowest, label, ms };
    if (ms >= limitMs) break;
  }
  return slowest;
}

test('data/lint-rules.json has rules, each a valid pattern', () => {
  assert.ok(rules.length > 0);
  for (const rule of rules) assert.doesNotThrow(() => new RegExp(rule.pattern, rule.flags), rule.id);
});

for (const rule of rules) {
  test(`${rule.id} runs in linear time on adversarial input`, () => {
    const { label, ms, inputs } = slowestInput(rule.pattern, rule.flags);
    assert.ok(inputs > 10, `${rule.id}: only ${inputs} inputs`);
    const took = ms === Infinity ? `more than ${TIMEOUT_MS} ms` : `${Math.round(ms)} ms`;
    assert.ok(
      ms < LIMIT_MS,
      `${rule.id} took ${took} on ${label} (${SIZE.toLocaleString('en-US')} characters). ` +
        'Bound every repetition, for example [^\\n]{0,80} instead of * or +, and don\'t repeat groups.',
    );
  });
}

test('the timing check catches super-linear patterns (the old template and placeholder rules)', () => {
  for (const pattern of [String.raw`\{\{\s*[\w .-]*\s*\}\}`, String.raw`\[\[[^\]]+\]\]`]) {
    assert.ok(slowestInput(pattern, '', { timeoutMs: 1_000 }).ms >= LIMIT_MS, pattern);
  }
});
