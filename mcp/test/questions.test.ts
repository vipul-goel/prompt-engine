import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTRO,
  NOTES_FIELD,
  NOTES_HINT,
  NOTES_MAX_CHARS,
  NOTES_TITLE,
  REPLY_LINE,
  buildElicitationSchema,
  buildFormMessage,
  buildTextBatch,
  mapFormAnswers,
  recommendedAnswers,
  supportsFormElicitation,
  truncate,
  validateQuestions,
  type Question,
} from '../src/questions.js';
import { CONTRACT } from '../src/generated/content.js';
import { SAMPLE_QUESTIONS } from './helpers.js';

const questions: Question[] = SAMPLE_QUESTIONS;

const q = (overrides: Partial<Question> = {}): Question => ({
  id: 'goal',
  question: 'What is the main goal?',
  options: [{ label: 'Inform' }, { label: 'Persuade' }],
  recommended: 0,
  why: 'readers need the facts first',
  ...overrides,
});

describe('validateQuestions', () => {
  it('accepts well-formed questions', () => {
    expect(validateQuestions(questions)).toEqual([]);
  });

  it('rejects duplicate ids', () => {
    expect(validateQuestions([q(), q()]).join('\n')).toMatch(/used twice/);
  });

  it('rejects a recommended index outside the options', () => {
    expect(validateQuestions([q({ recommended: 2 })]).join('\n')).toMatch(/recommended must be a 0-based option index from 0 to 1/);
    expect(validateQuestions([q({ recommended: -1 })])).toHaveLength(1);
    expect(validateQuestions([q({ recommended: 0.5 })])).toHaveLength(1);
  });

  it('rejects a header over 12 characters, counting characters rather than UTF-16 units', () => {
    expect(validateQuestions([q({ header: 'Audience+tone' })]).join('\n')).toMatch(/longer than 12/);
    expect(validateQuestions([q({ header: 'Público 👥' })])).toEqual([]);
  });

  it('rejects the reserved notes id, duplicate labels and bad option counts', () => {
    expect(validateQuestions([q({ id: NOTES_FIELD })]).join('\n')).toMatch(/reserved/);
    expect(validateQuestions([q({ options: [{ label: 'A' }, { label: 'A' }] })]).join('\n')).toMatch(/appears twice/);
    expect(validateQuestions([q({ options: [{ label: 'A' }], recommended: 0 })]).join('\n')).toMatch(/give 2-4 options/);
  });

  it('rejects a recommendation without a reason', () => {
    expect(validateQuestions([q({ why: '   ' })]).join('\n')).toMatch(/give why/);
    expect(validateQuestions([{ ...q(), why: undefined } as unknown as Question]).join('\n')).toMatch(/give why/);
  });

  it('rejects an empty list and more than 8 questions', () => {
    expect(validateQuestions([])).toHaveLength(1);
    const nine = Array.from({ length: 9 }, (_, i) => q({ id: `q${i}` }));
    expect(validateQuestions(nine).join('\n')).toMatch(/between 1 and 8/);
  });
});

describe('buildTextBatch', () => {
  it('matches the method format exactly', () => {
    expect(buildTextBatch(questions)).toBe(
      [
        DEFAULT_INTRO,
        '',
        '1. Who will read it?',
        '   a) Employees  b) Team managers ★ (they decide remote-work policy)  c) Job seekers',
        '2. How long should it be?',
        '   a) About 600 words  b) About 1,200 words ★ (room for examples)  c) 2,000+ words',
        '',
        'Reply `ok` to accept every ★, or answer like `2b 4: your own text`. Anything you skip gets the ★.',
      ].join('\n'),
    );
  });

  it('ends with the contract reply line and marks exactly one ★ per question', () => {
    const batch = buildTextBatch(questions);
    expect(batch.endsWith(REPLY_LINE)).toBe(true);
    for (const required of CONTRACT.required.replyLine) expect(batch).toContain(required);
    const optionLines = batch.split('\n').filter((l) => l.startsWith('   a)'));
    for (const line of optionLines) expect(line.match(/★/g)).toHaveLength(1);
  });

  it('uses a custom intro and always gives the reason next to the ★', () => {
    const batch = buildTextBatch([q({ recommended: 1, why: ' los gerentes deciden ' })], 'Unas preguntas rápidas (★ = recomendado):');
    expect(batch.split('\n')[0]).toBe('Unas preguntas rápidas (★ = recomendado):');
    expect(batch).toContain('   a) Inform  b) Persuade ★ (los gerentes deciden)\n');
  });
});

describe('buildElicitationSchema', () => {
  const schema = buildElicitationSchema(questions);

  it('is a flat object of primitive fields', () => {
    expect(schema.type).toBe('object');
    for (const field of Object.values(schema.properties)) {
      expect(field.type).toBe('string');
      // The keys MCP's primitive string and single-select enum field schemas allow.
      expect(Object.keys(field).every((k) => ['type', 'title', 'description', 'enum', 'default', 'maxLength'].includes(k))).toBe(true);
    }
  });

  it('has one single-choice enum per question, defaulting to the recommended label', () => {
    expect(schema.properties.audience).toEqual({
      type: 'string',
      title: 'Who will read it?',
      description: 'Audience · Team managers ★ (they decide remote-work policy) · Team managers: They set policy',
      enum: ['Employees', 'Team managers', 'Job seekers'],
      default: 'Team managers',
    });
    expect(schema.properties.length).toMatchObject({ enum: ['About 600 words', 'About 1,200 words', '2,000+ words'], default: 'About 1,200 words' });
    expect(schema.required).toEqual(['audience', 'length']);
  });

  it('adds one optional free-text notes field with a length limit', () => {
    expect(schema.properties[NOTES_FIELD]).toEqual({ type: 'string', title: NOTES_TITLE, description: NOTES_HINT, maxLength: NOTES_MAX_CHARS });
    expect(schema.required).not.toContain(NOTES_FIELD);
  });

  it('has no fixed English words: the caller can give the notes label and hint', () => {
    const es = buildElicitationSchema(
      [{ ...questions[0]!, question: '¿Quién lo leerá?', header: 'Público', options: [{ label: 'Empleados' }, { label: 'Gerentes' }], recommended: 1, why: 'deciden la política' }],
      { label: '¿Algo que añadir?', hint: 'Opcional. Lo que escribas aquí manda.' },
    );
    expect(es.properties.audience!.description).toBe('Público · Gerentes ★ (deciden la política)');
    expect(es.properties[NOTES_FIELD]).toMatchObject({ title: '¿Algo que añadir?', description: 'Opcional. Lo que escribas aquí manda.' });
    expect(JSON.stringify(es)).not.toMatch(/Recommended|Optional|Anything/);
    // Blank strings fall back to the defaults.
    expect(buildElicitationSchema(questions, { label: ' ', hint: '' }).properties[NOTES_FIELD]).toMatchObject({ title: NOTES_TITLE, description: NOTES_HINT });
  });

  it('uses the intro as the form message, or a default', () => {
    expect(buildFormMessage('Hola')).toBe('Hola');
    expect(buildFormMessage()).toMatch(/recommended answer/);
  });
});

describe('answers', () => {
  it('maps accepted content to chosen answers and keeps notes', () => {
    expect(mapFormAnswers(questions, { audience: 'Employees', length: 'About 1,200 words', notes: '  keep it short ' })).toEqual({
      answers: [
        { id: 'audience', answer: 'Employees', source: 'chosen' },
        { id: 'length', answer: 'About 1,200 words', source: 'chosen' },
      ],
      notes: 'keep it short',
    });
  });

  it('falls back to the recommended answer for missing or unknown values', () => {
    expect(mapFormAnswers(questions, { audience: 'Aliens', notes: '   ' })).toEqual({
      answers: [
        { id: 'audience', answer: 'Team managers', source: 'recommended' },
        { id: 'length', answer: 'About 1,200 words', source: 'recommended' },
      ],
    });
  });

  it('cuts notes to the field limit and says so', () => {
    const long = mapFormAnswers(questions, { notes: `${'pasted brief '.repeat(400)}` });
    expect([...long.notes!].length).toBe(NOTES_MAX_CHARS);
    expect(long.notes!.endsWith('…')).toBe(true);
    expect(long.notesCut).toBe(true);
    const exact = mapFormAnswers(questions, { notes: 'x'.repeat(NOTES_MAX_CHARS) });
    expect(exact.notes).toHaveLength(NOTES_MAX_CHARS);
    expect(exact).not.toHaveProperty('notesCut');
  });

  it('truncates by characters, not UTF-16 units', () => {
    expect(truncate('😀😀😀😀', 3)).toBe('😀😀…');
    expect(truncate('abc', 3)).toBe('abc');
  });

  it('lists every ★ answer as recommended', () => {
    expect(recommendedAnswers(questions).map((a) => `${a.answer}/${a.source}`)).toEqual(['Team managers/recommended', 'About 1,200 words/recommended']);
  });
});

describe('supportsFormElicitation', () => {
  it('reads form support from client capabilities', () => {
    expect(supportsFormElicitation({ elicitation: { form: {} } })).toBe(true);
    expect(supportsFormElicitation({ elicitation: {} })).toBe(true);
    expect(supportsFormElicitation({ elicitation: { form: {}, url: {} } })).toBe(true);
    expect(supportsFormElicitation({ elicitation: { url: {} } })).toBe(false);
    expect(supportsFormElicitation({})).toBe(false);
    expect(supportsFormElicitation(undefined)).toBe(false);
    expect(supportsFormElicitation({ elicitation: true })).toBe(false);
  });
});
