import { describe, expect, it } from 'vitest';
import {
  DIMENSIONS,
  EXCERPT_CHARS,
  PROMPT_MAX_CHARS,
  SKIPPED_LINT_RULES,
  checkPrompt,
  formatReport,
  isBoundedPattern,
  looksMostlyEnglish,
  targetKind,
} from '../src/check.js';
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

const GERMAN =
  'Schreibe einen Blogartikel über Remote-Arbeit für Teamleiter. Länge: etwa 1.200 Wörter. Ton: freundlich. Wenn Informationen fehlen, frage nach.';

const dim = (report: ReturnType<typeof checkPrompt>, name: string) => report.dimensions.find((d) => d.name === name)!;
const found = (report: ReturnType<typeof checkPrompt>, name: string) => dim(report, name).status === 'found';

describe('structure heuristics', () => {
  it('covers exactly the contract score dimensions, in order', () => {
    expect(DIMENSIONS).toEqual(CONTRACT.required.scoreDimensions);
    expect(checkPrompt('x').dimensions.map((d) => d.name)).toEqual([...CONTRACT.required.scoreDimensions]);
  });

  it('finds all five areas in a structured prompt, with evidence', () => {
    const report = checkPrompt(STRONG);
    for (const d of report.dimensions) {
      expect(d.status, d.name).toBe('found');
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.evidence.length).toBeLessThanOrEqual(3);
    }
    expect(dim(report, 'Clear goal').evidence[0]).toBe('# Goal');
    expect(dim(report, 'Edge cases').evidence.join(' ')).toMatch(/missing/);
    expect(report.summary).toMatch(/All five areas/);
  });

  it('reports a rough prompt as a task with little else', () => {
    const report = checkPrompt('write a haiku about rain');
    expect(found(report, 'Clear goal')).toBe(true);
    for (const name of ['Context', 'Constraints', 'Edge cases']) expect(dim(report, name).status, name).toBe('not found');
    expect(report.summary).toMatch(/Not explicitly found: Context/);
  });

  it('finds nothing in a bare topic', () => {
    const report = checkPrompt('remote work');
    expect(report.dimensions.every((d) => d.status === 'not found' && d.evidence.length === 0)).toBe(true);
  });

  it('recognizes XML-tag sections and length limits', () => {
    const report = checkPrompt('<context>\nOur team maintains a billing service.\n</context>\nRespond in 3 bullet points.');
    expect(found(report, 'Context')).toBe(true);
    expect(found(report, 'Output format')).toBe(true);
    expect(found(checkPrompt('Keep it to about 1,200 words.'), 'Output format')).toBe(true);
    expect(found(checkPrompt('Write 150 – 250 words.'), 'Output format')).toBe(true);
  });

  it("doesn't count the prompt's subject as an output format", () => {
    expect(found(checkPrompt('build a JSON parser in rust'), 'Output format')).toBe(false);
    expect(found(checkPrompt('Design a database schema for a library'), 'Output format')).toBe(false);
    expect(found(checkPrompt('Return the result as valid JSON.'), 'Output format')).toBe(true);
    expect(found(checkPrompt('Respond in JSON.'), 'Output format')).toBe(true);
    expect(found(checkPrompt('Output a JSON object with two keys.'), 'Output format')).toBe(true);
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
    expect(found(media, 'Output format')).toBe(true);
    expect(found(media, 'Constraints')).toBe(true);
    expect(found(checkPrompt(prompt), 'Output format')).toBe(false);
  });

  it('keeps evidence short', () => {
    const long = `${'Background detail that goes on and on. '.repeat(20)}The audience is managers. ${'More text. '.repeat(20)}`;
    const [snippet] = dim(checkPrompt(long), 'Context').evidence;
    expect(snippet).toBeDefined();
    expect(snippet!.length).toBeLessThanOrEqual(EXCERPT_CHARS + 2);
    expect(snippet).toMatch(/audience/);
  });

  it('collapses runs of whitespace before matching', () => {
    expect(found(checkPrompt('#    Goal\nWrite a post.'), 'Clear goal')).toBe(true);
    expect(dim(checkPrompt('The\taudience   is   managers.'), 'Context').evidence).toEqual(['The audience is managers.']);
  });
});

describe('language', () => {
  it('tells English drafts, including terse image prompts, from other languages', () => {
    for (const english of [
      STRONG,
      'Write a blog post about remote work for team managers, around 1,200 words, friendly tone.',
      'cyberpunk city street, neon signs, rain, reflections, cinematic lighting, 35mm, shallow depth, puddles, crowd, umbrellas, night market, steam',
      'masterpiece, best quality, 1girl, solo, long hair, looking at viewer, smile, outdoors, cherry blossoms, petals, sunlight, depth of field, bokeh',
    ]) {
      expect(looksMostlyEnglish(english), english).toBe(true);
    }
    for (const other of [
      GERMAN,
      "Rédige un article de blog sur le télétravail pour les responsables d'équipe. Longueur : environ 1 200 mots. Ton : amical. Si des informations manquent, pose la question.",
      'Escribe un artículo de blog sobre el teletrabajo para jefes de equipo. Extensión: unas 1.200 palabras. Tono: cercano. Si falta información, pregunta antes de escribir.',
      'Tulis artikel blog tentang kerja jarak jauh untuk manajer tim. Panjang sekitar 1.200 kata dengan nada yang ramah. Jika ada informasi yang kurang, tanyakan dulu sebelum menulis.',
      'チームリーダー向けにリモートワークについてのブログ記事を書いてください。長さは約1200語、口調は親しみやすく。情報が足りない場合は先に質問してください。',
      'Напиши статью для блога об удалённой работе для руководителей команд. Объём: около 1200 слов. Тон: дружелюбный. Если информации не хватает, сначала спроси.',
    ]) {
      expect(looksMostlyEnglish(other), other).toBe(false);
    }
    // Too short to tell: the English checks apply.
    expect(looksMostlyEnglish('Schreibe einen Artikel')).toBe(true);
  });

  it('reports areas without a match as unknown in a mostly non-English draft, and still lints it', () => {
    const report = checkPrompt(`${GERMAN}\nVerwende [[Firmenname]] und {{Anrede}}.`);
    expect(report.mostlyEnglish).toBe(false);
    for (const d of report.dimensions) expect(d.status, d.name).toBe('unknown');
    expect(report.summary).toMatch(/mostly non-English/);
    expect(report.summary).toMatch(/unknown: Clear goal, Context, Constraints, Output format, Edge cases/);
    expect(report.issues.map((i) => i.id)).toEqual(['template-leftover', 'open-placeholder']);
    const text = formatReport(report);
    expect(text).toContain('- Clear goal: unknown (keyword checks are English-only)');
    expect(text).not.toMatch(/: not found/);
  });

  it('still reports language-neutral matches as found', () => {
    const report = checkPrompt('ein gemütliches Blockhaus bei Nacht, warmes Licht in den Fenstern, frischer Schnee, Sterne über dem Wald --ar 3:2 --no Menschen', 'Midjourney');
    expect(report.mostlyEnglish).toBe(false);
    expect(dim(report, 'Output format').status).toBe('found');
    expect(dim(report, 'Constraints').status).toBe('found');
    expect(dim(report, 'Edge cases').status).toBe('unknown');
  });

  it('says in the report that the area checks are English-only', () => {
    expect(formatReport(checkPrompt(STRONG))).toMatch(/English keywords and headings only/);
    expect(checkPrompt(STRONG).mostlyEnglish).toBe(true);
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
    // A distinct match after many repeats on the same line still counts.
    const oneLine = checkPrompt(`${'[[a]] '.repeat(500)}[[b]]`).issues.filter((i) => i.id === 'open-placeholder');
    expect(oneLine).toHaveLength(2);
    expect(oneLine[1]!.excerpt).toMatch(/\[\[b\]\]$/);
  });

  it('reports nothing for a clean prompt', () => {
    expect(checkPrompt(STRONG.replace(/\[\[[^\]]+\]\]/g, 'Acme')).issues).toEqual([]);
  });

  it('matches one line at a time', () => {
    expect(checkPrompt('{{ name\n}}').issues).toEqual([]);
    expect(checkPrompt('[[company\nname]]').issues).toEqual([]);
  });

  it('runs every rule in data/lint-rules.json: none has an unbounded pattern', () => {
    expect(SKIPPED_LINT_RULES).toEqual([]);
    for (const rule of LINT_RULES) expect(isBoundedPattern(rule.pattern, rule.flags), rule.id).toBe(true);
  });
});

describe('isBoundedPattern', () => {
  it('accepts literals, classes, alternation, ? on anything, and bounded repetition of one character or class', () => {
    for (const ok of [
      String.raw`\b(MUST|NEVER)\b`,
      'think (really )?hard',
      'prefill (the|your|an?) (response|answer)',
      String.raw`\{\{[^{}\n]{0,80}\}\}`,
      String.raw`\[\[[^\[\]\n]{1,120}\]\]`,
      String.raw`(?:^|\s)--no\s`,
      String.raw`a{3}`,
      String.raw`x{2,5}?`,
      String.raw`[*+]`,
      String.raw`\*\+`,
      String.raw`(?<name>ab)c`,
      String.raw`(?=a)b`,
      '{literal}',
    ]) {
      expect(isBoundedPattern(ok), ok).toBe(true);
    }
  });

  it('rejects unbounded, repeated-group, oversized and backreferencing patterns', () => {
    for (const bad of [
      'a*',
      'a+',
      'a{2,}',
      String.raw`\{\{\s*[\w .-]*\s*\}\}`,
      String.raw`\[\[[^\]]+\]\]`,
      '(ab){2}',
      '(a|b){0,3}',
      'a{0,500}',
      String.raw`(a)\1`,
      String.raw`(?<x>a)\k<x>`,
      '[abc',
      '?a',
    ]) {
      expect(isBoundedPattern(bad), bad).toBe(false);
    }
    expect(isBoundedPattern(String.raw`\p{L}{0,10}`, 'u')).toBe(true);
    expect(isBoundedPattern(String.raw`\p{L}+`, 'u')).toBe(false);
  });
});

describe('long lines', () => {
  it('checks text beyond the first window of a long line, once, with the right line number', () => {
    const filler = 'lorem ipsum dolor sit amet '.repeat(200); // about 5,400 characters
    const report = checkPrompt(`intro\n${filler}You MUST fill [[late placeholder]] now. ${filler}`);
    const placeholder = report.issues.filter((i) => i.id === 'open-placeholder');
    expect(placeholder).toHaveLength(1);
    expect(placeholder[0]).toMatchObject({ line: 2 });
    expect(placeholder[0]!.excerpt).toContain('[[late placeholder]]');
    expect(report.issues.filter((i) => i.id === 'pressure-words')).toHaveLength(1);
  });

  it('finds a match that crosses a window edge exactly once, and no line-start heading mid-line', () => {
    for (let shift = 1990; shift <= 2010; shift += 2) {
      const line = `${'x'.repeat(shift)} [[edge case]] ${'y '.repeat(1500)}`;
      const report = checkPrompt(line);
      expect(report.issues.filter((i) => i.id === 'open-placeholder'), `shift ${shift}`).toHaveLength(1);
    }
    const midLine = `${'word '.repeat(400)}Goal: something`; // "Goal:" starts the second window
    expect(dim(checkPrompt(midLine), 'Clear goal').evidence).toEqual([]);
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

  it('lists each rule message once in the text, then each finding', () => {
    const text = formatReport(checkPrompt('You MUST do it.\nYou NEVER stop.'));
    const message = LINT_RULES.find((r) => r.id === 'pressure-words')!.message;
    expect(text.split(message)).toHaveLength(2);
    expect(text).toContain('    · line 1: "You MUST do it."');
    expect(text).toContain('    · line 2: "You NEVER stop."');
  });

  it('cuts excerpts of long matches and long lines to a fixed length, ending in "…"', () => {
    const report = checkPrompt(`Fill in [[${'customer name and a long description '.repeat(3)}]] ${'and more text '.repeat(5000)}`);
    for (const issue of report.issues) expect(issue.excerpt.length, issue.id).toBeLessThanOrEqual(EXCERPT_CHARS + 2);
    const evidence = report.dimensions.flatMap((d) => d.evidence);
    for (const e of evidence) expect(e.length).toBeLessThanOrEqual(EXCERPT_CHARS + 2);
    const longLine = checkPrompt(`You MUST ${'keep going '.repeat(3000)}`).issues[0]!;
    expect(longLine.excerpt.endsWith('…')).toBe(true);
    expect(longLine.excerpt.length).toBeLessThanOrEqual(EXCERPT_CHARS + 2);
  });

  it('stays small for the largest accepted prompt', () => {
    const line = 'You MUST [[fill]] {{x}} think step by step, masterpiece 8k, audience: managers, if missing ask. ';
    const prompt = line.repeat(Math.floor(PROMPT_MAX_CHARS / line.length)).slice(0, PROMPT_MAX_CHARS);
    const report = checkPrompt(prompt);
    expect(JSON.stringify(report).length + formatReport(report).length).toBeLessThan(24_000);
  });
});

describe('time on adversarial input', () => {
  // Each case is the largest prompt check_prompt accepts. A linear scan takes a
  // few tens of milliseconds; the regular expressions this replaced took
  // seconds to minutes. The bound is generous so slow CI machines pass.
  const LIMIT_MS = 500;
  const N = PROMPT_MAX_CHARS;
  const fill = (s: string) => s.repeat(Math.ceil(N / s.length)).slice(0, N);
  const cases: Record<string, string> = {
    '"{{" then spaces': `{{${' '.repeat(N - 2)}`,
    '"{{" then spaces and newlines': `{{${' \n'.repeat(N / 2 - 1)}`,
    '"1," repeated': fill('1,'),
    '"1 - " repeated': fill('1 - '),
    '"[[" repeated': fill('[['),
    '"]]" repeated': fill(']]'),
    'a single-line CSV of numbers': Array.from({ length: N / 5 }, (_, i) => String(1000 + i)).join(',').slice(0, N),
    'long whitespace runs': fill(' \t    x'),
    'one run of spaces': ' '.repeat(N),
    'nested brackets': fill('[[[{{a}}]] '),
    'unbalanced brackets': fill('[[x {{y [[ {{{ ]] }'),
    '"if" and short words': fill('if abc abc abc abc '),
    '"for a" and a long word': `for a ${'x'.repeat(N - 6)}`,
    'heading marks': fill('###### **'),
    'one short line after another': fill('a\n'),
    'every lint rule on one line': fill('You MUST [[fill]] {{x}} think step by step, masterpiece 8k, audience: managers, if missing ask. '),
  };

  for (const [name, prompt] of Object.entries(cases)) {
    it(`${name} (${N.toLocaleString('en-US')} characters)`, () => {
      expect(prompt.length).toBe(N);
      for (const target of [undefined, 'Midjourney']) {
        const start = performance.now();
        checkPrompt(prompt, target);
        const ms = performance.now() - start;
        expect(ms, `${target ?? 'text'}: ${ms.toFixed(0)} ms`).toBeLessThan(LIMIT_MS);
      }
    });
  }
});
