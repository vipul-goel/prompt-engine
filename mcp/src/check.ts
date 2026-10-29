// The check_prompt engine: a deterministic structure-and-lint report for a draft
// prompt. English keyword and heading heuristics only; it gives no score,
// because the host model scores with the shared rubric. Pure and SDK-free.
//
// Every regular expression here runs in time linear in the prompt's length,
// whatever data/lint-rules.json holds:
// - each run of whitespace within a line becomes one space before matching;
// - matching is per line, and a long line is matched in windows that start every
//   WINDOW_CHARS characters and overlap by WINDOW_OVERLAP, so no match attempt
//   sees more than WINDOW_CHARS + WINDOW_OVERLAP + 1 characters;
// - the signals below use bounded repetition only;
// - a lint rule runs only if its pattern passes isBoundedPattern (no unbounded
//   or repeated-group repetition, no backreferences), which bounds the work at
//   each position.

import { CONTRACT, LINT_RULES, MEDIA_TARGETS } from './generated/content.js';

export type Dimension = (typeof CONTRACT.required.scoreDimensions)[number];
export const DIMENSIONS: readonly Dimension[] = CONTRACT.required.scoreDimensions;

export const PROMPT_MAX_CHARS = 100_000;
/** Excerpts and evidence are cut to this many characters, plus "…" marks. */
export const EXCERPT_CHARS = 100;
/** The largest repetition count a lint pattern may use, as in {0,200}. */
export const MAX_PATTERN_REPEAT = 200;
const MAX_EVIDENCE = 3;
const MAX_ISSUES_PER_RULE = 5;
const MAX_ISSUES = 20;
/** Long lines are matched in windows of this many characters... */
const WINDOW_CHARS = 2_000;
/** ...that overlap by this many, so a match that crosses a window edge is still found. */
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

/**
 * Whether a lint pattern does a bounded amount of work at each position, so a
 * scan is linear in the input: no *, + or {n,} repetition, no {n,m} above
 * MAX_PATTERN_REPEAT or after a group (a ? after a group is fine), and no
 * backreferences. Conservative: a pattern it can't read is rejected.
 */
export function isBoundedPattern(source: string, flags = ''): boolean {
  const unicode = /[uv]/.test(flags);
  let classDepth = 0;
  // What a quantifier here would repeat: nothing, one character or class, or a group.
  let last: 'none' | 'atom' | 'group' = 'none';
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === '\\') {
      const next = source[i + 1];
      if (next === undefined) return false;
      if (classDepth === 0 && (/[1-9]/.test(next) || next === 'k')) return false;
      i += 2;
      if (unicode && /[pPu]/.test(next) && source[i] === '{') {
        const close = source.indexOf('}', i);
        if (close < 0) return false;
        i = close + 1;
      }
      if (classDepth === 0) last = 'atom';
      continue;
    }
    if (classDepth > 0) {
      if (c === '[' && flags.includes('v')) classDepth++;
      else if (c === ']') classDepth--;
      i++;
      if (classDepth === 0) last = 'atom';
      continue;
    }
    if (c === '[') {
      classDepth = 1;
      i++;
      if (source[i] === '^') i++;
      if (source[i] === ']' && !unicode) i++; // "[]" or "[^]" opens with a literal ]
      continue;
    }
    if (c === '(') {
      i++;
      if (source[i] === '?') {
        const head = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>|[ims-]+:)/.exec(source.slice(i));
        if (!head) return false;
        i += head[0].length;
      }
      last = 'none';
      continue;
    }
    if (c === ')') {
      i++;
      last = 'group';
      continue;
    }
    if (c === '*' || c === '+') return false;
    if (c === '?') {
      if (last === 'none') return false;
      i++;
      if (source[i] === '?') i++;
      last = 'none';
      continue;
    }
    if (c === '{') {
      const q = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
      if (q) {
        if (q[2] !== undefined && q[3] === '') return false;
        if (Number(q[3] ?? q[1]) > MAX_PATTERN_REPEAT || last !== 'atom') return false;
        i += q[0].length;
        if (source[i] === '?') i++;
        last = 'none';
        continue;
      }
      if (unicode) return false;
    }
    last = c === '|' || c === '^' || c === '$' ? 'none' : 'atom';
    i++;
  }
  return classDepth === 0;
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
    try {
      if (!isBoundedPattern(rule.pattern, rule.flags)) throw new Error('unbounded');
      const flags = `${rule.flags.replace(/[gy]/g, '')}g`;
      compiled.push({ id: rule.id, severity: rule.severity, message: rule.message, pattern: new RegExp(rule.pattern, flags) });
    } catch {
      skipped.push(rule.id);
    }
  }
  return { rules: compiled, skipped };
}

const LINT = compileRules(LINT_RULES);
/** Ids of rules in data/lint-rules.json that check_prompt doesn't run (unbounded or invalid patterns). */
export const SKIPPED_LINT_RULES: readonly string[] = LINT.skipped;

// ---------- matching ----------

interface Window {
  text: string;
  /** Matches must start in [from, to); text before `from` is context for \b and ^. */
  from: number;
  to: number;
}

/** Called with each match's text, its window and where in the window it starts; returns whether to go on. */
type Visit = (text: string, window: string, index: number) => boolean;

function windowsOf(line: string): Window[] {
  if (line.length <= WINDOW_CHARS + WINDOW_OVERLAP) return [{ text: line, from: 0, to: line.length }];
  const windows: Window[] = [];
  for (let start = 0; start < line.length; start += WINDOW_CHARS) {
    // Later windows keep one character before their start, so \b sees the real
    // neighbour and ^ (line start) can't match mid-line.
    const lead = start === 0 ? 0 : 1;
    windows.push({ text: line.slice(start - lead, start + WINDOW_CHARS + WINDOW_OVERLAP), from: lead, to: lead + WINDOW_CHARS });
  }
  return windows;
}

/**
 * Visits the non-empty matches of a global pattern in a line, in order, until
 * visit returns false. A long line is searched window by window, and each match
 * is reported once, by the window it starts in.
 */
function forEachMatch(windows: Window[], pattern: RegExp, visit: Visit): void {
  for (const w of windows) {
    pattern.lastIndex = w.from;
    for (let m = pattern.exec(w.text); m && m.index < w.to; m = pattern.exec(w.text)) {
      if (!m[0]) {
        pattern.lastIndex = m.index + 1;
        continue;
      }
      if (!visit(m[0], w.text, m.index)) return;
    }
  }
}

/** An excerpt around the first match of a global pattern in a line. */
function firstMatchExcerpt(windows: Window[], pattern: RegExp): string | undefined {
  for (const w of windows) {
    pattern.lastIndex = w.from;
    for (let m = pattern.exec(w.text); m && m.index < w.to; m = pattern.exec(w.text)) {
      if (m[0]) return excerptAround(w.text, m.index);
      pattern.lastIndex = m.index + 1;
    }
  }
  return undefined;
}

/** About EXCERPT_CHARS characters of a line around a match, with "…" where it was cut. */
function excerptAround(line: string, index: number): string {
  const text = line.trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const offset = line.length - line.trimStart().length;
  const start = Math.max(0, Math.min(index - offset - 30, text.length - EXCERPT_CHARS));
  const end = start + EXCERPT_CHARS;
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

interface Line {
  number: number;
  windows: Window[];
}

/** Non-blank lines, each whitespace run (\r included) collapsed to one space, numbered as in the prompt. */
function linesOf(prompt: string): Line[] {
  const lines: Line[] = [];
  prompt
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .forEach((line, i) => {
      if (line.trim()) lines.push({ number: i + 1, windows: windowsOf(line) });
    });
  return lines;
}

function dimensionReport(name: Dimension, lines: Line[], kind: 'text' | 'media', english: boolean): DimensionReport {
  const pattern = DIMENSION_PATTERNS[kind][name];
  const evidence: string[] = [];
  for (const line of lines) {
    if (evidence.length >= MAX_EVIDENCE) break;
    const snippet = firstMatchExcerpt(line.windows, pattern);
    if (snippet !== undefined && !evidence.includes(snippet)) evidence.push(snippet);
  }
  const status: AreaStatus = evidence.length ? 'found' : english ? 'not found' : 'unknown';
  return { name, status, evidence };
}

function lintIssues(lines: Line[]): Issue[] {
  const issues: Issue[] = [];
  for (const rule of LINT.rules) {
    // Each distinct match is reported once, for at most MAX_ISSUES_PER_RULE matches.
    const seen = new Set<string>();
    let lineNumber = 0;
    const visit: Visit = (text, window, index) => {
      if (!seen.has(text)) {
        seen.add(text);
        issues.push({ id: rule.id, severity: rule.severity, message: rule.message, excerpt: excerptAround(window, index), line: lineNumber });
      }
      return seen.size < MAX_ISSUES_PER_RULE;
    };
    for (const line of lines) {
      if (seen.size >= MAX_ISSUES_PER_RULE) break;
      lineNumber = line.number;
      forEachMatch(line.windows, rule.pattern, visit);
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
    SKIPPED_LINT_RULES.length ? `Skipped lint rule(s) whose patterns could run slowly: ${SKIPPED_LINT_RULES.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const report: CheckReport = { heuristic: true, targetKind: kind, mostlyEnglish: english, dimensions, issues, summary };
  if (target) report.target = target;
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
