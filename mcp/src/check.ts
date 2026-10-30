// The check_prompt engine: a deterministic structure-and-lint report for a draft
// prompt. English keyword and heading heuristics only; it gives no score,
// because the host model scores with the shared rubric. Pure and SDK-free.
//
// How matching keeps the work at each position of a hostile draft bounded, so
// the time grows linearly with its length:
// - control characters become spaces, and each run of whitespace within a line
//   one space, before matching;
// - matching is per line, and a line longer than WINDOW_CHARS + WINDOW_OVERLAP
//   is matched in windows that each own WINDOW_CHARS characters and also see
//   WINDOW_OVERLAP characters on either side;
// - the signals below use bounded repetition only;
// - a lint rule from data/lint-rules.json runs only if patternProblem finds
//   nothing wrong with its pattern: no unbounded repetition, repeated group or
//   backreference, no empty match, at most MAX_PATTERN_PATHS ways to match from
//   one position, and nothing it looks at more than WINDOW_OVERLAP characters
//   away. The timing tests in mcp/test/check.test.ts and
//   scripts/test/lint-rules.test.mjs measure the speed separately.

import { CONTRACT, LINT_RULES, MEDIA_TARGETS } from './generated/content.js';

export type Dimension = (typeof CONTRACT.required.scoreDimensions)[number];
export const DIMENSIONS: readonly Dimension[] = CONTRACT.required.scoreDimensions;

/** The longest draft check_prompt takes. zod counts code points, so a draft can be up to twice as many UTF-16 units. */
export const PROMPT_MAX_CHARS = 100_000;
/** Excerpts and evidence are cut to this many characters, plus "…" marks. */
export const EXCERPT_CHARS = 100;
/** The largest repetition count a lint pattern may use, as in {0,200}. */
export const MAX_PATTERN_REPEAT = 200;
/** The most ways a lint pattern may have to match from one position (see patternProblem). */
export const MAX_PATTERN_PATHS = 1_000;
const MAX_EVIDENCE = 3;
const MAX_ISSUES_PER_RULE = 5;
const MAX_ISSUES = 20;
/** Long lines are matched in windows that each own this many characters... */
const WINDOW_CHARS = 2_000;
/**
 * ...and see this many more on either side: as far as a lint pattern may look
 * (see patternProblem), and further than the signals below look, so a match
 * that starts in a window is found there, as in a scan of the whole line.
 */
const WINDOW_OVERLAP = 300;

export type AreaStatus = 'found' | 'not found' | 'unknown';

export interface DimensionReport {
  name: Dimension;
  /** "unknown": no keyword match in a draft that looks mostly non-English. */
  status: AreaStatus;
  evidence: string[];
}

export interface Issue {
  id: string;
  severity: 'warning' | 'info';
  message: string;
  excerpt: string;
  line: number;
}

export interface CheckReport {
  heuristic: true;
  target?: string;
  targetKind: 'text' | 'media';
  /** Whether the draft looks mostly English, the only language the area checks know. */
  mostlyEnglish: boolean;
  dimensions: DimensionReport[];
  issues: Issue[];
  summary: string;
}

interface Signal {
  /** Matched against one line (or one window of a long line) at a time, case-insensitively. */
  pattern: RegExp;
  /** Only used when the target is (or isn't) an image or video tool. */
  kind?: 'text' | 'media';
}

const heading = (words: string) =>
  new RegExp(`^\\s?(?:#{1,6}\\s?|<\\s?)(?:${words})\\b|^\\s?(?:\\*\\*)?(?:${words})(?:\\*\\*)?\\s?:`, 'i');

// Each dimension counts as explicitly present when one line matches one of its
// signals. Whitespace runs are collapsed before matching, so \s? stands for any
// gap between words.
const SIGNALS: Record<Dimension, Signal[]> = {
  'Clear goal': [
    { pattern: heading('goal|objective|task|purpose|deliverable|mission|use|subject') },
    { pattern: /\b(your (task|goal|job) is|the goal is|i (want|need) (you )?to|done when|success criteria|definition of done)\b/i },
    { pattern: /^\s?(?:[-*\d.)]{1,8}\s?)?(please\s)?(write|create|build|generate|draft|summari[sz]e|analy[sz]e|compare|explain|design|implement|fix|refactor|review|translate|plan|rewrite|produce|make|add|list|describe|research|find|outline|edit|improve|answer|classify|extract|convert|debug|test|propose|recommend|evaluate|prepare|compose|render|animate|show)\b/i },
  ],
  Context: [
    { pattern: heading('context|background|situation|audience|about|inputs?|documents?|reference|setting|scene') },
    { pattern: /<\s?(context|background|documents?|inputs?)\b/i },
    { pattern: /\b(audience|readers?|the user is|users are|is for|is used by|for (an?|the|our|my) [\w-]{1,40} (audience|team|readers|users|customers)|we are|our (company|team|product|app|users|customers|codebase|repo)|i am an?|i'm an?|currently|already|existing)\b/i },
    { pattern: /\b(set in|located|at (dawn|dusk|night|sunset|sunrise)|in the background|reference image|--sref)\b/i, kind: 'media' },
  ],
  Constraints: [
    { pattern: heading('constraints?|requirements?|rules|scope|limits?|guidelines|boundaries|must[- ]haves?|out of scope|do not|don\'t|avoid|exclusions?|negative prompt') },
    { pattern: /\b(must|should|do not|don't|never|avoid|only|at most|no more than|at least|within|limit(ed)?( to)?|without|out of scope|keep (it|the)|unless|ask before|stick to)\b/i },
    { pattern: /(?:^|\s)--no\s|\bno (text|watermarks?|logos?|people|subtitles)\b|\bnegative( prompt)?\b|\bexclude\b/i, kind: 'media' },
  ],
  'Output format': [
    { pattern: heading('output|format|response format|structure|deliverables?|length|style|settings|parameters') },
    { pattern: /<\s?(output_format|output|format)\b/i },
    // A format word only counts in an output phrase: "build a JSON parser" names the subject, not the format.
    { pattern: /\b(format(ted)?( as)?|as (a|an) (table|list|bullet|paragraph|code block|report|email|summary)|in (a table|bullet points|plain text)|(as|in|into) (an? )?(valid |plain )?(json|yaml|csv|xml|markdown|html)|bullet(ed)? (points|list)|numbered list|headings?|sections?|json (object|array|output|response|schema)|(return|respond|reply|answer|output)(s|ing)? (only )?(with )?(an? )?(valid )?(json|yaml|csv|xml|markdown)|(output|response) schema|word count|tone)\b/i },
    { pattern: /\b\d[\d,]{0,15}\s{0,3}(?:(?:-|–|to)\s{0,3}\d[\d,]{0,15}\s{0,3})?(words?|characters?|sentences?|paragraphs?|bullets?|lines?|pages?|items?|slides?)\b/i },
    { pattern: /(?:^|\s)--(ar|v|stylize|chaos|raw|motion|loop)\b|\baspect ratio\b|\b\d{1,2}:\d{1,2}\b|\bresolution\b|\b\d{1,4}\s{0,3}(s|sec|seconds)\b|\b(16:9|9:16|1:1|4:3|3:2)\b/i, kind: 'media' },
  ],
  'Edge cases': [
    { pattern: heading('edge cases?|if information is missing|missing information|errors?|exceptions?|fallback|uncertainty|when unsure|unknowns?') },
    { pattern: /\b(edge cases?|corner cases?|if (?:[\w'-]{1,30} ){0,4}(?:is |are )?(missing|unclear|unknown|ambiguous|unavailable|empty|fails?|invalid|not (?:found|available|sure|provided|given))|when (?:[\w'-]{1,30} ){0,4}(?:is |are )?(missing|unclear|unknown|ambiguous|empty|invalid)|otherwise|in case|fall ?back|if you (are|'re) (not sure|unsure|uncertain)|say (so|that you don't know)|don't know|insufficient evidence|ask (me|the user)|state (the|your) assumptions?)\b/i },
    { pattern: /\b(consistent|consistency|same (character|face|outfit|product)|identity block|keep (everything else|the rest)|unchanged)\b/i, kind: 'media' },
  ],
};

// One pattern per dimension and target kind: all of its signals as one alternation.
const DIMENSION_PATTERNS = Object.fromEntries(
  (['text', 'media'] as const).map((kind) => [
    kind,
    Object.fromEntries(
      DIMENSIONS.map((name) => {
        const sources = SIGNALS[name].filter((sig) => !sig.kind || sig.kind === kind).map((sig) => `(?:${sig.pattern.source})`);
        return [name, new RegExp(sources.join('|'), 'gi')];
      }),
    ),
  ]),
) as Record<'text' | 'media', Record<Dimension, RegExp>>;

// Image and video tools from data/media-targets.json (ids such as "gpt-image" also
// match "GPT Image"), other well-known tools, and generic media words.
const MEDIA_KEYWORDS = [
  ...MEDIA_TARGETS.targets.flatMap((t) => [t.id, t.id.replace(/-/g, ' ')]),
  'nano banana', 'comfyui', 'automatic1111', 'dall-e', 'dalle', 'imagen', 'ideogram', 'firefly', 'sdxl', 'pika',
  'image', 'images', 'picture', 'photo', 'illustration', 'video', 'videos', 'clip', 'animation',
  'text-to-image', 'text-to-video', 'image-to-video',
];
const MEDIA_TARGET = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${MEDIA_KEYWORDS.map(escapeRegExp).join('|')})(?:[^\\p{L}\\p{N}]|$)`, 'iu');

/** Whether a target names an image or video tool (decides which signals apply). */
export function targetKind(target: string | undefined): 'text' | 'media' {
  return target && MEDIA_TARGET.test(target.slice(0, 200)) ? 'media' : 'text';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- lint rules ----------

// The two halves of a surrogate pair.
function isHigh(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}
function isLow(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** What patternProblem works out about a pattern, or a part of one. */
interface Shape {
  /** The fewest characters a match consumes. */
  min: number;
  /**
   * The most UTF-16 units a match can look at: what it consumes, what its
   * lookarounds read, and one neighbour for each \b, \B, ^ and $.
   */
  reach: number;
  /** The most ways to match from one position, which bounds the backtracking there. */
  paths: number;
}

// Properties of strings (v flag): they match sequences of several characters.
const STRING_PROPERTY = /^(?:Basic_Emoji|Emoji_Keycap_Sequence|RGI_Emoji(?:_Flag_Sequence|_Modifier_Sequence|_Tag_Sequence|_ZWJ_Sequence)?)$/;

/** Reads a valid pattern the way JavaScript does; throws on what it can't read or won't run. */
function shapeOf(source: string, flags: string): Shape {
  const unicode = /[uv]/.test(flags);
  const sets = flags.includes('v');
  // One character: one UTF-16 unit, or one code point (up to two units) under u or v.
  const char: Shape = { min: 1, reach: unicode ? 2 : 1, paths: 1 };
  const assertion: Shape = { min: 0, reach: 1, paths: 1 };
  const quantifierAt = (at: number) => /^(?:[*+?]|\{\d+(?:,\d*)?\})/.test(source.slice(at));
  let i = 0;

  // Alternatives add up their ways to match.
  function disjunction(): Shape {
    const branches = [sequence()];
    while (source[i] === '|') {
      i++;
      branches.push(sequence());
    }
    return {
      min: Math.min(...branches.map((b) => b.min)),
      reach: Math.max(...branches.map((b) => b.reach)),
      paths: branches.reduce((sum, b) => sum + b.paths, 0),
    };
  }

  // Terms in a row multiply theirs.
  function sequence(): Shape {
    const shape: Shape = { min: 0, reach: 0, paths: 1 };
    while (i < source.length && source[i] !== '|' && source[i] !== ')') {
      const t = term();
      shape.min += t.min;
      shape.reach += t.reach;
      shape.paths *= t.paths;
    }
    return shape;
  }

  function term(): Shape {
    const c = source[i]!;
    if (c === '^' || c === '$' || (c === '\\' && /[bB]/.test(source[i + 1] ?? ''))) {
      i += c === '\\' ? 2 : 1;
      return assertion;
    }
    return c === '(' ? group() : repeated(single());
  }

  function group(): Shape {
    i++;
    let lookaround = false;
    if (source[i] === '?') {
      const head = /^\?(?:(<?[=!])|<[A-Za-z_$][\w$]*>|[ims]*(?:-[ims]*)?:)/.exec(source.slice(i));
      if (!head) throw new Error('an unknown group');
      lookaround = head[1] !== undefined;
      i += head[0].length;
    }
    const inner = disjunction();
    i++; // ")"
    if (lookaround) {
      // A lookaround consumes nothing, but what it reads counts toward the reach.
      if (quantifierAt(i)) throw new Error('a repeated lookaround');
      return { min: 0, reach: inner.reach, paths: inner.paths };
    }
    if (source[i] === '?') {
      i += source[i + 1] === '?' ? 2 : 1;
      return { min: 0, reach: inner.reach, paths: inner.paths + 1 };
    }
    if (quantifierAt(i)) throw new Error('a repeated group');
    return inner;
  }

  // One character, class or escape.
  function single(): Shape {
    const c = source[i]!;
    if (c === '[') characterClass();
    else if (c === '\\') escape(false);
    // Under u or v, a surrogate pair is one character.
    else i += unicode && isHigh(source.charCodeAt(i)) && isLow(source.charCodeAt(i + 1)) ? 2 : 1;
    return char;
  }

  function repeated(one: Shape): Shape {
    const q = /^(?:([*+])|\?|\{(\d+)(,(\d*))?\})\??/.exec(source.slice(i));
    if (!q) return one;
    if (q[1] || q[4] === '') throw new Error('an unbounded repetition');
    i += q[0].length;
    if (q[2] === undefined) return { min: 0, reach: one.reach, paths: one.paths + 1 };
    const low = Number(q[2]);
    const high = q[3] ? Number(q[4]) : low;
    if (high > MAX_PATTERN_REPEAT) throw new Error(`a repetition above ${MAX_PATTERN_REPEAT}`);
    return { min: low * one.min, reach: high * one.reach, paths: (high - low + 1) * one.paths };
  }

  // As in JavaScript, a ] right after [ or [^ closes the class: [] matches
  // nothing and [^] any character. Under v, classes nest.
  function characterClass(): void {
    let depth = 0;
    for (;;) {
      const c = source[i];
      if (c === undefined) throw new Error('an unclosed class');
      if (c === '\\') {
        escape(true);
        continue;
      }
      i++;
      if (c === '[' && (depth === 0 || sets)) {
        depth++;
        if (source[i] === '^') i++;
        if (source[i] !== ']') continue;
        i++;
        if (--depth === 0) return;
      } else if (c === ']' && --depth === 0) return;
    }
  }

  function escape(inClass: boolean): void {
    const next = source[i + 1]!;
    if (!inClass && /[1-9k]/.test(next)) throw new Error('a backreference');
    if (next === 'q') throw new Error('a \\q{} string');
    if (next === 'c' && !/[A-Za-z]/.test(source[i + 2] ?? '')) throw new Error('a \\c without a letter');
    i += 2;
    const rest = source.slice(i);
    if (unicode && /[pPu]/.test(next) && rest[0] === '{') {
      const close = rest.indexOf('}');
      if (sets && STRING_PROPERTY.test(rest.slice(1, close))) throw new Error('a property of strings');
      i += close + 1;
    } else if (next === 'u' && /^[\dA-Fa-f]{4}/.test(rest)) {
      // Under u or v, \uD83D\uDE00 is one character.
      i += unicode && /^[dD][89aAbB][\dA-Fa-f]{2}\\u[dD][c-fC-F][\dA-Fa-f]{2}/.test(rest) ? 10 : 4;
    } else if (next === 'x' && /^[\dA-Fa-f]{2}/.test(rest)) i += 2;
    else if (next === 'c') i++;
    else if (next === '0' && !unicode) i += /^[0-7]{0,2}/.exec(rest)![0].length; // a legacy octal escape
  }

  const shape = disjunction();
  if (i < source.length) throw new Error('an unmatched )');
  return shape;
}

/**
 * Why check_prompt won't run a lint pattern, or undefined if it will. It
 * refuses a pattern that is invalid or that it can't read, and one that:
 * - repeats without a bound (*, +, {n,}), more than MAX_PATTERN_REPEAT times,
 *   or repeats a group (a ? after a group is fine);
 * - uses a backreference;
 * - can match the empty string;
 * - has more than MAX_PATTERN_PATHS ways to match from one position: a
 *   repetition {m,n} multiplies them by n - m + 1, a ? by 2, and alternatives
 *   add up theirs;
 * - can look at more than WINDOW_OVERLAP characters (two per character under u
 *   or v): what a match consumes, what its lookarounds read, and one neighbour
 *   for each \b, \B, ^ and $.
 */
export function patternProblem(source: string, flags = ''): string | undefined {
  let shape: Shape;
  try {
    new RegExp(source, flags.replace(/[gy]/g, ''));
  } catch {
    return 'an invalid pattern';
  }
  try {
    shape = shapeOf(source, flags);
  } catch (error) {
    return (error as Error).message;
  }
  if (shape.min === 0) return 'can match the empty string';
  if (shape.paths > MAX_PATTERN_PATHS) return `more than ${MAX_PATTERN_PATHS} ways to match from one position`;
  if (shape.reach > WINDOW_OVERLAP) return `looks at more than ${WINDOW_OVERLAP} characters`;
  return undefined;
}

/** Whether check_prompt runs a lint pattern (see patternProblem). */
export function isBoundedPattern(source: string, flags = ''): boolean {
  return patternProblem(source, flags) === undefined;
}

interface LintRule {
  id: string;
  severity: 'warning' | 'info';
  message: string;
  pattern: RegExp;
}

function compileRules(rules: typeof LINT_RULES): { rules: LintRule[]; skipped: string[] } {
  const compiled: LintRule[] = [];
  const skipped: string[] = [];
  for (const rule of rules) {
    if (patternProblem(rule.pattern, rule.flags)) skipped.push(rule.id);
    else compiled.push({ id: rule.id, severity: rule.severity, message: rule.message, pattern: new RegExp(rule.pattern, `${rule.flags.replace(/[gy]/g, '')}g`) });
  }
  return { rules: compiled, skipped };
}

const LINT = compileRules(LINT_RULES);
/** Ids of rules in data/lint-rules.json that check_prompt doesn't run (see patternProblem). */
export const SKIPPED_LINT_RULES: readonly string[] = LINT.skipped;

// ---------- matching ----------

/** Whether position i of text falls between the two halves of a surrogate pair. */
function splitsPair(text: string, i: number): boolean {
  return isLow(text.charCodeAt(i)) && isHigh(text.charCodeAt(i - 1));
}

interface Window {
  text: string;
  /** Where text starts in the line. */
  offset: number;
  /** Matches must start in [from, to) of text; the text around that range is what lookarounds, \b, ^ and $ see. */
  from: number;
  to: number;
}

interface Line {
  number: number;
  /** The line as matched (see linesOf). */
  text: string;
  windows: Window[];
}

/** Called with each match's text, its line and where in the line it starts; returns whether to go on. */
type Visit = (text: string, line: Line, index: number) => boolean;

function windowsOf(line: string): Window[] {
  if (line.length <= WINDOW_CHARS + WINDOW_OVERLAP) return [{ text: line, offset: 0, from: 0, to: line.length }];
  const windows: Window[] = [];
  for (let start = 0; start < line.length; ) {
    // No cut splits a surrogate pair, so u and v patterns see whole characters.
    let end = Math.min(start + WINDOW_CHARS, line.length);
    if (splitsPair(line, end)) end--;
    let first = Math.max(0, start - WINDOW_OVERLAP);
    if (splitsPair(line, first)) first--;
    let last = Math.min(end + WINDOW_OVERLAP, line.length);
    if (splitsPair(line, last)) last++;
    windows.push({ text: line.slice(first, last), offset: first, from: start - first, to: end - first });
    start = end;
  }
  return windows;
}

/**
 * Visits the non-empty matches of a global pattern in a line, in order, until
 * visit returns false. A long line is searched window by window; each match is
 * reported once, by the window it starts in, and none starts inside the one
 * before it, as in a scan of the whole line.
 */
function forEachMatch(line: Line, pattern: RegExp, visit: Visit): void {
  let after = 0; // where the last match ended, in the line
  for (const w of line.windows) {
    const from = Math.max(w.from, after - w.offset);
    pattern.lastIndex = from;
    for (let m = pattern.exec(w.text); m && m.index < w.to; m = pattern.exec(w.text)) {
      if (!m[0] || m.index < from) {
        // Step past an empty match, or one that u or v moved back to the start
        // of a surrogate pair, by a whole character (two units for a pair under
        // u or v, as matchAll does); one unit would land inside the pair again.
        const pair = isHigh(w.text.charCodeAt(m.index)) && isLow(w.text.charCodeAt(m.index + 1));
        pattern.lastIndex = m.index + (pair && /[uv]/.test(pattern.flags) ? 2 : 1);
        continue;
      }
      const index = w.offset + m.index;
      if (!visit(m[0], line, index)) return;
      after = index + m[0].length;
    }
  }
}

/** The matches check_prompt finds for a global pattern in one line, as [index, text] pairs (for tests). */
export function matchesInLine(line: string, pattern: RegExp): Array<[number, string]> {
  const found: Array<[number, string]> = [];
  forEachMatch({ number: 1, text: line, windows: windowsOf(line) }, pattern, (text, _, index) => {
    found.push([index, text]);
    return true;
  });
  return found;
}

/** About EXCERPT_CHARS characters of a line around a match, with "…" where text was cut; no cut splits a surrogate pair. */
function excerptAround(line: string, index: number): string {
  const text = line.trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const offset = line.length - line.trimStart().length;
  let start = Math.max(0, Math.min(index - offset - 30, text.length - EXCERPT_CHARS));
  if (splitsPair(text, start)) start++;
  let end = start + EXCERPT_CHARS;
  if (splitsPair(text, end)) end--;
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Text that is safe to return: control characters other than \n become spaces
 * and unpaired surrogates U+FFFD, so it is well-formed and at most doubles in
 * length when escaped as JSON. Lengths don't change.
 */
function echoable(text: string): string {
  return text
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd');
}

/**
 * Non-blank lines, numbered as in the prompt, as matched: made echoable, with
 * each whitespace run (\r included) collapsed to one space.
 */
function linesOf(prompt: string): Line[] {
  const lines: Line[] = [];
  echoable(prompt)
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .forEach((text, i) => {
      if (text.trim()) lines.push({ number: i + 1, text, windows: windowsOf(text) });
    });
  return lines;
}

function dimensionReport(name: Dimension, lines: Line[], kind: 'text' | 'media', english: boolean): DimensionReport {
  const pattern = DIMENSION_PATTERNS[kind][name];
  const evidence: string[] = [];
  // The first match of each line, until there is enough evidence.
  const visit: Visit = (_, line, index) => {
    const snippet = excerptAround(line.text, index);
    if (!evidence.includes(snippet)) evidence.push(snippet);
    return false;
  };
  for (const line of lines) {
    if (evidence.length >= MAX_EVIDENCE) break;
    forEachMatch(line, pattern, visit);
  }
  const status: AreaStatus = evidence.length ? 'found' : english ? 'not found' : 'unknown';
  return { name, status, evidence };
}

function lintIssues(lines: Line[]): Issue[] {
  const issues: Issue[] = [];
  for (const rule of LINT.rules) {
    // Each distinct match is reported once, for at most MAX_ISSUES_PER_RULE matches.
    const seen = new Set<string>();
    const visit: Visit = (text, line, index) => {
      if (!seen.has(text)) {
        seen.add(text);
        issues.push({ id: rule.id, severity: rule.severity, message: rule.message, excerpt: excerptAround(line.text, index), line: line.number });
      }
      return seen.size < MAX_ISSUES_PER_RULE;
    };
    for (const line of lines) {
      if (seen.size >= MAX_ISSUES_PER_RULE) break;
      forEachMatch(line, rule.pattern, visit);
    }
  }
  const rank = { warning: 0, info: 1 } as const;
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.line - b.line).slice(0, MAX_ISSUES);
}

// ---------- language ----------

// Common English function words that are rare in other languages written in
// Latin script (so not "a", "in", "to", "die" or "will").
const ENGLISH_WORDS = new Set(
  'the and you your with that this are it not if when what which should must can from have has they their them we our each any only about into than then there these those would could how who or by been being where why its my she him such other all'.split(' '),
);
// Common function words of other languages written in Latin script (German,
// French, Spanish, Portuguese, Italian, Dutch, Polish, Swedish, Turkish,
// Indonesian), minus words that are also English.
const OTHER_WORDS = new Set(
  [
    'der das und ist nicht mit für ein eine einen einem einer zu von auf sie ich du wir wenn oder auch sind werden wird dem den des im zum zur über nach bei aus wie etwa',
    'le la les des du et est une un que qui pour dans sur pas ne avec au aux ce cette il elle vous nous ou sont être par plus ses leur',
    'el los las y en es por para con una del al lo como más pero sus se su si sin sobre este esta muy hay',
    'o os do da dos das em um uma não com na pelo pela ao à é são você',
    'il gli di della che per non è sono nel alla anche questo questa',
    'het een van dat op te voor niet zijn er je ik wordt worden ook aan bij',
    'się nie jest że jak dla od po oraz czy',
    'och att det som är på för med av inte till',
    've bir bu için ile çok daha olarak gibi',
    'yang dan di ke dari untuk dengan ini itu tidak akan ada adalah',
  ]
    .join(' ')
    .split(' ')
    .filter((w) => !ENGLISH_WORDS.has(w)),
);
const LANGUAGE_SAMPLE_CHARS = 20_000;

/**
 * Whether a draft looks mostly English. Mostly non-Latin letters means no; so
 * does a draft of 12 words or more with almost no English function words and
 * clear signs of another language (its function words, or accented letters).
 */
export function looksMostlyEnglish(prompt: string): boolean {
  const sample = prompt.slice(0, LANGUAGE_SAMPLE_CHARS);
  const letters = sample.replace(/[^\p{L}]/gu, '').length;
  if (letters < 20) return true;
  const latin = sample.replace(/[^\p{Script=Latin}]/gu, '').length;
  if (latin < letters / 2) return false;
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 12) return true;
  let english = 0;
  let other = 0;
  let accented = 0;
  for (const word of words) {
    if (ENGLISH_WORDS.has(word)) english++;
    else if (OTHER_WORDS.has(word)) other++;
    if (/[^a-z]/.test(word) && /\p{Script=Latin}/u.test(word)) accented++;
  }
  const share = (n: number) => n / words.length;
  return !(share(english) < 0.05 && (share(other) >= 0.08 || share(accented) >= 0.15));
}

// ---------- report ----------

/** Runs the structure heuristics and the lint rules from data/lint-rules.json. */
export function checkPrompt(prompt: string, target?: string): CheckReport {
  const kind = targetKind(target);
  const english = looksMostlyEnglish(prompt);
  const lines = linesOf(prompt);
  const dimensions = DIMENSIONS.map((name) => dimensionReport(name, lines, kind, english));
  const issues = lintIssues(lines);
  const missing = dimensions.filter((d) => d.status === 'not found').map((d) => d.name);
  const unknown = dimensions.filter((d) => d.status === 'unknown').map((d) => d.name);
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const summary = [
    english
      ? missing.length
        ? `Not explicitly found: ${missing.join(', ')}.`
        : 'All five areas are explicitly mentioned.'
      : `The draft looks mostly non-English, and the area checks match English keywords only${unknown.length ? `, so these areas are unknown: ${unknown.join(', ')}.` : '; all five areas were still found.'}`,
    issues.length ? `${issues.length} lint finding(s), ${warnings} warning(s).` : 'No lint findings.',
    SKIPPED_LINT_RULES.length ? `Skipped lint rule(s) whose patterns could run slowly or miss matches: ${SKIPPED_LINT_RULES.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const report: CheckReport = { heuristic: true, targetKind: kind, mostlyEnglish: english, dimensions, issues, summary };
  if (target) report.target = echoable(target);
  return report;
}

const STATUS_TEXT: Record<AreaStatus, string> = {
  found: 'found',
  'not found': 'not found',
  unknown: 'unknown (keyword checks are English-only)',
};

/** A readable mirror of the report for clients that show only text; each rule's message appears once. */
export function formatReport(report: CheckReport): string {
  const out = [
    'check_prompt: a heuristic structure-and-lint report. The area checks match English keywords and headings only. "Found" means the prompt explicitly mentions the area, not that it covers it well. It gives no score: score with the shared anchors.',
    '',
    `Target: ${report.target ?? 'not given'} (${report.targetKind === 'media' ? 'image or video tool' : 'text model'})`,
    '',
    'Areas:',
  ];
  for (const d of report.dimensions) {
    out.push(`- ${d.name}: ${STATUS_TEXT[d.status]}`);
    for (const e of d.evidence) out.push(`    · ${e}`);
  }
  out.push('', report.issues.length ? 'Lint findings:' : 'Lint findings: none.');
  const byRule = new Map<string, Issue[]>();
  for (const issue of report.issues) byRule.set(issue.id, [...(byRule.get(issue.id) ?? []), issue]);
  for (const [id, issues] of byRule) {
    out.push(`- [${issues[0]!.severity}] ${id}: ${issues[0]!.message}`);
    for (const i of issues) out.push(`    · line ${i.line}: "${i.excerpt}"`);
  }
  out.push('', report.summary);
  return out.join('\n');
}
