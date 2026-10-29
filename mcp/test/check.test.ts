import { describe, expect, it } from 'vitest';
import { DIMENSIONS, PROMPT_MAX_CHARS, checkPrompt, formatReport, targetKind } from '../src/check.js';
import { CONTRACT, LINT_RULES } from '../src/generated/content.js';

const STRONG = `# Goal
Write a launch email announcing [[app name]] to existing newsletter subscribers, so that as many as possible start a free trial.

# Context
- The audience is busy professionals who already know the brand.

# Constraints
- Use only the facts above; do not invent numbers.

# Output
- A subject line under 50 characters plus two alternatives.
- Body of 150–250 words.

# If information is missing
If a detail is missing, leave a [[placeholder]] instead of inventing one.`;

const dim = (report: ReturnType<typeof checkPrompt>, name: string) => report.dimensions.find((d) => d.name === name)!;

describe('structure heuristics', () => {
  it('covers exactly the contract score dimensions, in order', () => {
    expect(DIMENSIONS).toEqual(CONTRACT.required.scoreDimensions);
    expect(checkPrompt('x').dimensions.map((d) => d.name)).toEqual([...CONTRACT.required.scoreDimensions]);
  });

  it('finds all five areas in a structured prompt, with evidence', () => {
    const report = checkPrompt(STRONG);
    for (const d of report.dimensions) {
      expect(d.present, d.name).toBe(true);
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.evidence.length).toBeLessThanOrEqual(3);
    }
    expect(dim(report, 'Clear goal').evidence[0]).toBe('# Goal');
    expect(dim(report, 'Edge cases').evidence.join(' ')).toMatch(/missing/);
    expect(report.summary).toMatch(/All five areas/);
  });

  it('reports a rough prompt as a task with little else', () => {
    const report = checkPrompt('write a haiku about rain');
    expect(dim(report, 'Clear goal').present).toBe(true);
    for (const name of ['Context', 'Constraints', 'Edge cases']) expect(dim(report, name).present, name).toBe(false);
    expect(report.summary).toMatch(/Not explicitly found: Context/);
  });

  it('finds nothing in a bare topic', () => {
    const report = checkPrompt('remote work');
    expect(report.dimensions.every((d) => !d.present && d.evidence.length === 0)).toBe(true);
  });

  it('recognizes XML-tag sections and length limits', () => {
    const report = checkPrompt('<context>\nOur team maintains a billing service.\n</context>\nRespond in 3 bullet points.');
    expect(dim(report, 'Context').present).toBe(true);
    expect(dim(report, 'Output format').present).toBe(true);
  });

  it('applies image and video conventions for media targets', () => {
    expect(targetKind('Midjourney v7')).toBe('media');
    expect(targetKind('GPT Image')).toBe('media');
    expect(targetKind('Google Veo')).toBe('media');
    expect(targetKind('Claude Code')).toBe('text');
    expect(targetKind('ChatGPT')).toBe('text');
    expect(targetKind(undefined)).toBe('text');

    const prompt = 'a lighthouse keeper repainting stripes at dawn, golden backlight --ar 3:2 --no boats';
    const media = checkPrompt(prompt, 'Midjourney');
    expect(media.targetKind).toBe('media');
    expect(media.target).toBe('Midjourney');
    expect(dim(media, 'Output format').present).toBe(true);
    expect(dim(media, 'Constraints').present).toBe(true);
    expect(dim(checkPrompt(prompt), 'Output format').present).toBe(false);
  });

  it('keeps evidence short', () => {
    const long = `${'Background detail that goes on and on. '.repeat(20)}The audience is managers. ${'More text. '.repeat(20)}`;
    const [snippet] = dim(checkPrompt(long), 'Context').evidence;
    expect(snippet).toBeDefined();
    expect(snippet!.length).toBeLessThanOrEqual(102);
    expect(snippet).toMatch(/audience/);
  });
});

describe('lint rules', () => {
  it('reports each rule from data/lint-rules.json with id, severity, message, excerpt and line', () => {
    const prompt = [
      'You MUST answer in English.',
      'Think step by step before answering.',
      'Take a deep breath.',
      'Prefill the response with "Sure".',
      'Hello {{ name }}, welcome to [[company name]].',
      'A masterpiece, 8k render.',
    ].join('\n');
    const report = checkPrompt(prompt);
    const ids = report.issues.map((i) => i.id);
    for (const rule of LINT_RULES) expect(ids, rule.id).toContain(rule.id);
    const pressure = report.issues.find((i) => i.id === 'pressure-words')!;
    expect(pressure).toMatchObject({ severity: 'warning', line: 1, excerpt: 'You MUST answer in English.' });
    expect(pressure.message).toBe(LINT_RULES.find((r) => r.id === 'pressure-words')!.message);
    expect(report.issues.find((i) => i.id === 'template-leftover')!.line).toBe(5);
    // Warnings first, then info.
    const firstInfo = report.issues.findIndex((i) => i.severity === 'info');
    expect(report.issues.slice(firstInfo).every((i) => i.severity === 'info')).toBe(true);
  });

  it('is case-sensitive where the rule is (pressure words) and not where it is not', () => {
    expect(checkPrompt('You must answer.').issues.some((i) => i.id === 'pressure-words')).toBe(false);
    expect(checkPrompt('THINK STEP BY STEP').issues.some((i) => i.id === 'visible-reasoning-request')).toBe(true);
  });

  it('reports each distinct match once and caps the list', () => {
    const repeated = checkPrompt('Use [[name]] here and [[name]] there.\n'.repeat(10));
    expect(repeated.issues.filter((i) => i.id === 'open-placeholder')).toHaveLength(1);
    const many = Array.from({ length: 50 }, (_, i) => `[[field ${i}]] MUST NEVER ALWAYS {{v${i}}}`).join('\n');
    const report = checkPrompt(many);
    expect(report.issues.filter((i) => i.id === 'open-placeholder')).toHaveLength(5);
    expect(report.issues.length).toBeLessThanOrEqual(20);
  });

  it('reports nothing for a clean prompt', () => {
    expect(checkPrompt(STRONG.replace(/\[\[[^\]]+\]\]/g, 'Acme')).issues).toEqual([]);
  });
});

describe('report', () => {
  it('is deterministic and labelled as a heuristic', () => {
    expect(checkPrompt(STRONG)).toEqual(checkPrompt(STRONG));
    const report = checkPrompt(STRONG);
    expect(report.heuristic).toBe(true);
    expect(report).not.toHaveProperty('score');
    const text = formatReport(report);
    expect(text).toMatch(/heuristic/);
    expect(text).toMatch(/no score/);
    for (const name of CONTRACT.required.scoreDimensions) expect(text).toContain(`- ${name}: found`);
  });

  it('stays small for the largest accepted prompt', () => {
    const line = 'You MUST [[fill]] {{x}} think step by step, masterpiece 8k, audience: managers, if missing ask. ';
    const prompt = line.repeat(Math.floor(PROMPT_MAX_CHARS / line.length)).slice(0, PROMPT_MAX_CHARS);
    const report = checkPrompt(prompt);
    expect(JSON.stringify(report).length).toBeLessThan(32_000);
    expect(formatReport(report).length).toBeLessThan(32_000);
  });
});
