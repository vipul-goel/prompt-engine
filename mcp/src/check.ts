// The check_prompt engine: a deterministic structure-and-lint report for a draft
// prompt. Keyword and heading heuristics only; it gives no score, because the host
// model scores with the shared rubric. Pure and SDK-free.

import { CONTRACT, LINT_RULES, MEDIA_TARGETS } from './generated/content.js';

export type Dimension = (typeof CONTRACT.required.scoreDimensions)[number];
export const DIMENSIONS: readonly Dimension[] = CONTRACT.required.scoreDimensions;

export const PROMPT_MAX_CHARS = 100_000;
const MAX_EVIDENCE = 3;
const MAX_ISSUES_PER_RULE = 5;
const MAX_ISSUES = 20;
const EXCERPT_CHARS = 100;

export interface DimensionReport {
  name: Dimension;
  present: boolean;
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
  dimensions: DimensionReport[];
  issues: Issue[];
  summary: string;
}

interface Signal {
  /** Matched against one line at a time. */
  pattern: RegExp;
  /** Only used when the target is (or isn't) an image or video tool. */
  kind?: 'text' | 'media';
}

const heading = (words: string) =>
  new RegExp(`^\\s*(?:#{1,6}\\s*|<\\s*)(?:${words})\\b|^\\s*(?:\\*\\*)?(?:${words})(?:\\*\\*)?\\s*:`, 'i');

// Each dimension counts as explicitly present when one line matches one signal.
const SIGNALS: Record<Dimension, Signal[]> = {
  'Clear goal': [
    { pattern: heading('goal|objective|task|purpose|deliverable|mission|use|subject') },
    { pattern: /\b(your (task|goal|job) is|the goal is|i (want|need) (you )?to|done when|success criteria|definition of done)\b/i },
    { pattern: /^\s*(?:[-*\d.)]+\s*)?(please\s+)?(write|create|build|generate|draft|summari[sz]e|analy[sz]e|compare|explain|design|implement|fix|refactor|review|translate|plan|rewrite|produce|make|add|list|describe|research|find|outline|edit|improve|answer|classify|extract|convert|debug|test|propose|recommend|evaluate|prepare|compose|render|animate|show)\b/i },
  ],
  Context: [
    { pattern: heading('context|background|situation|audience|about|inputs?|documents?|reference|setting|scene') },
    { pattern: /<\s*(context|background|documents?|inputs?)\b/i },
    { pattern: /\b(audience|readers?|the user is|users are|is for|is used by|for (an?|the|our|my) [\w-]+ (audience|team|readers|users|customers)|we are|our (company|team|product|app|users|customers|codebase|repo)|i am an?|i'm an?|currently|already|existing)\b/i },
    { pattern: /\b(set in|located|at (dawn|dusk|night|sunset|sunrise)|in the background|reference image|--sref)\b/i, kind: 'media' },
  ],
  Constraints: [
    { pattern: heading('constraints?|requirements?|rules|scope|limits?|guidelines|boundaries|must[- ]haves?|out of scope|do not|don\'t|avoid|exclusions?|negative prompt') },
    { pattern: /\b(must|should|do not|don't|never|avoid|only|at most|no more than|at least|within|limit(ed)?( to)?|without|out of scope|keep (it|the)|unless|ask before|stick to)\b/i },
    { pattern: /(?:^|\s)--no\s|\bno (text|watermarks?|logos?|people|subtitles)\b|\bnegative( prompt)?\b|\bexclude\b/i, kind: 'media' },
  ],
  'Output format': [
    { pattern: heading('output|format|response format|structure|deliverables?|length|style|settings|parameters') },
    { pattern: /<\s*(output_format|output|format)\b/i },
    { pattern: /\b(format(ted)?( as)?|as (a|an) (table|list|json|bullet|markdown|paragraph|code block|csv|report|email|summary)|in (json|markdown|yaml|csv|a table|bullet points|plain text)|bullet(ed)? (points|list)|numbered list|headings?|sections?|json|schema|word count|tone)\b/i },
    { pattern: /\b\d[\d,]*\s*(?:(?:-|–|to)\s*\d[\d,]*\s*)?(words?|characters?|sentences?|paragraphs?|bullets?|lines?|pages?|items?|slides?)\b/i },
    { pattern: /(?:^|\s)--(ar|v|stylize|chaos|raw|motion|loop)\b|\baspect ratio\b|\b\d{1,2}:\d{1,2}\b|\bresolution\b|\b\d+\s*(s|sec|seconds)\b|\b(16:9|9:16|1:1|4:3|3:2)\b/i, kind: 'media' },
  ],
  'Edge cases': [
    { pattern: heading('edge cases?|if information is missing|missing information|errors?|exceptions?|fallback|uncertainty|when unsure|unknowns?') },
    { pattern: /\b(edge cases?|corner cases?|if (?:[\w'-]+ ){0,4}(?:is |are )?(missing|unclear|unknown|ambiguous|unavailable|empty|fails?|invalid|not (?:found|available|sure|provided|given))|when (?:[\w'-]+ ){0,4}(?:is |are )?(missing|unclear|unknown|ambiguous|empty|invalid)|otherwise|in case|fall ?back|if you (are|'re) (not sure|unsure|uncertain)|say (so|that you don't know)|don't know|insufficient evidence|ask (me|the user)|state (the|your) assumptions?)\b/i },
    { pattern: /\b(consistent|consistency|same (character|face|outfit|product)|identity block|keep (everything else|the rest)|unchanged)\b/i, kind: 'media' },
  ],
};

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
  return target && MEDIA_TARGET.test(target) ? 'media' : 'text';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function excerptAround(line: string, index: number, length: number): string {
  const text = line.trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const offset = line.length - line.trimStart().length;
  const start = Math.max(0, Math.min(index - offset - 30, text.length - EXCERPT_CHARS));
  const end = Math.min(text.length, Math.max(start + EXCERPT_CHARS, index - offset + length));
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function dimensionReport(name: Dimension, lines: string[], kind: 'text' | 'media'): DimensionReport {
  const evidence: string[] = [];
  for (const line of lines) {
    if (evidence.length >= MAX_EVIDENCE) break;
    if (!line.trim()) continue;
    for (const signal of SIGNALS[name]) {
      if (signal.kind && signal.kind !== kind) continue;
      const m = signal.pattern.exec(line);
      if (m) {
        const snippet = excerptAround(line, m.index, m[0].length);
        if (!evidence.includes(snippet)) evidence.push(snippet);
        break;
      }
    }
  }
  return { name, present: evidence.length > 0, evidence };
}

function lintIssues(prompt: string): Issue[] {
  const issues: Issue[] = [];
  const lineStarts = [0];
  for (let i = 0; i < prompt.length; i++) if (prompt[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (index: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (const rule of LINT_RULES) {
    const flags = rule.flags.includes('g') ? rule.flags : `${rule.flags}g`;
    const re = new RegExp(rule.pattern, flags);
    const seen = new Set<string>();
    let count = 0;
    for (const m of prompt.matchAll(re)) {
      if (count >= MAX_ISSUES_PER_RULE) break;
      if (!m[0] || seen.has(m[0])) continue;
      seen.add(m[0]);
      count++;
      const index = m.index ?? 0;
      const lineIndex = lineOf(index);
      const start = lineStarts[lineIndex] ?? 0;
      const end = prompt.indexOf('\n', start);
      const line = prompt.slice(start, end === -1 ? undefined : end);
      issues.push({
        id: rule.id,
        severity: rule.severity,
        message: rule.message,
        excerpt: excerptAround(line, index - start, m[0].length),
        line: lineIndex + 1,
      });
    }
  }
  const rank = { warning: 0, info: 1 } as const;
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.line - b.line).slice(0, MAX_ISSUES);
}

/** Runs the structure heuristics and the lint rules from data/lint-rules.json. */
export function checkPrompt(prompt: string, target?: string): CheckReport {
  const kind = targetKind(target);
  const lines = prompt.split(/\r?\n/);
  const dimensions = DIMENSIONS.map((name) => dimensionReport(name, lines, kind));
  const issues = lintIssues(prompt);
  const missing = dimensions.filter((d) => !d.present).map((d) => d.name);
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const summary = [
    missing.length ? `Not explicitly found: ${missing.join(', ')}.` : 'All five areas are explicitly mentioned.',
    issues.length ? `${issues.length} lint finding(s), ${warnings} warning(s).` : 'No lint findings.',
  ].join(' ');
  const report: CheckReport = { heuristic: true, targetKind: kind, dimensions, issues, summary };
  if (target) report.target = target;
  return report;
}

/** A readable mirror of the report for clients that show only text. */
export function formatReport(report: CheckReport): string {
  const out = [
    'check_prompt: a heuristic structure-and-lint report. "Found" means the prompt explicitly mentions the area (keyword and heading matches), not that it covers it well. It gives no score: score with the shared anchors.',
    '',
    `Target: ${report.target ?? 'not given'} (${report.targetKind === 'media' ? 'image or video tool' : 'text model'})`,
    '',
    'Areas:',
  ];
  for (const d of report.dimensions) {
    out.push(`- ${d.name}: ${d.present ? 'found' : 'not found'}`);
    for (const e of d.evidence) out.push(`    · ${e}`);
  }
  out.push('', report.issues.length ? 'Lint findings:' : 'Lint findings: none.');
  for (const i of report.issues) out.push(`- [${i.severity}] ${i.id} (line ${i.line}): "${i.excerpt}". ${i.message}`);
  out.push('', report.summary);
  return out.join('\n');
}
