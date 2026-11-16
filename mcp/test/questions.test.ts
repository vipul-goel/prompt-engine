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
  cleanQuestions,
  cleanText,
  hasVisibleText,
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

  it('compares labels as the user sees them: spacing, invisible characters and normalization don\'t count', () => {
    expect(validateQuestions([q({ options: [{ label: 'Yes' }, { label: 'Yes ' }] })]).join('\n')).toMatch(/option "Yes" appears twice/);
    expect(validateQuestions([q({ options: [{ label: ' No' }, { label: 'No\t' }] })]).join('\n')).toMatch(/option "No" appears twice/);
    // A zero-width space, a soft hyphen, a word joiner, doubled or other spaces, and NFC against NFD.
    const lookAlikes: Array<[string, string, string]> = [
      ['Yes', 'Yes\u{200B}', 'Yes'],
      ['Remote', 'Re\u{AD}mote', 'Remote'],
      ['Remote', '\u{2060}Remote', 'Remote'],
      ['Two words', 'Two  words', 'Two words'],
      ['Two words', 'Two\u{A0}words', 'Two words'],
      ['Caf\u{E9}', 'Cafe\u{301}', 'Caf\u{E9}'],
      // Joiners, variation selectors and tag characters at the start or after an ASCII character
      // change nothing that is drawn; tag characters there can hide text.
      ['Yes', 'Ye\u{200D}s', 'Yes'],
      ['Yes', '\u{200C}Yes', 'Yes'],
      ['Yes', 'Yes\u{FE0F}', 'Yes'],
      ['Yes', 'Y\u{FE00}es', 'Yes'],
      ['Yes', 'Yes\u{E0100}', 'Yes'],
      ['Yes', 'Yes\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}', 'Yes'],
      ['Yes', 'Yes\u{200B}\u{200D}', 'Yes'],
    ];
    for (const [first, second, shown] of lookAlikes) {
      expect(validateQuestions([q({ options: [{ label: first }, { label: second }] })]), JSON.stringify(second)).toEqual([
        `question 1 ("goal"): option "${shown}" appears twice; labels must differ in text the user can see`,
      ]);
    }
    // Differences the user can see still count.
    expect(validateQuestions([q({ options: [{ label: 'Yes' }, { label: 'yes' }] })])).toEqual([]);
    expect(validateQuestions([q({ options: [{ label: 'Twowords' }, { label: 'Two words' }] })])).toEqual([]);
    // So do joiners, variation selectors and tag characters elsewhere, which change what is drawn:
    // flags of England, Scotland and Wales, a ZWJ family against three people, Persian and
    // Devanagari with and without a ZWNJ or ZWJ, a heart in text and emoji style, and Mongolian
    // with a free variation selector.
    const drawnDifferently = [
      ['🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', '🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}'],
      ['👨\u{200D}👩\u{200D}👧', '👨👩👧'],
      ['می\u{200C}خواهم', 'میخواهم'],
      ['क्\u{200D}ष', 'क्ष'],
      ['❤\u{FE0E}', '❤\u{FE0F}'],
      ['\u{1820}\u{182E}', '\u{1820}\u{180B}\u{182E}'],
    ];
    for (const labels of drawnDifferently) {
      expect(validateQuestions([q({ options: labels.map((label) => ({ label })) })]), labels.join(' ')).toEqual([]);
    }
  });

  it('cuts a label it quotes in an error to 40 characters', () => {
    const long = `${'Remote'.repeat(13)}x`;
    const errors = validateQuestions([q({ options: [{ label: `${long} ★ ` }, { label: long }, { label: long }] })]);
    expect(errors).toEqual([
      `question 1 ("goal"): option 1 ("${'Remote'.repeat(6)}Rem…") contains ★; ask_user puts the only ★ on the option that recommended points to, so leave it out (write a rating in words, such as "4 stars")`,
      `question 1 ("goal"): option "${'Remote'.repeat(6)}Rem…" appears twice; labels must differ in text the user can see`,
    ]);
  });

  it('rejects a recommendation without a reason, including one the user can\'t see', () => {
    expect(validateQuestions([q({ why: '   ' })]).join('\n')).toMatch(/give why/);
    expect(validateQuestions([{ ...q(), why: undefined } as unknown as Question]).join('\n')).toMatch(/give why/);
    // Zero-width space, word joiner, Hangul filler, blank braille pattern, soft hyphen, NUL and NEL.
    for (const why of ['\u200B', '\u2060', '\u3164', '\u2800', '\u00AD', '\u0000', '\u0085', ' \u200B\u200C ']) {
      expect(validateQuestions([q({ why })]).join('\n'), JSON.stringify(why)).toMatch(/give why/);
    }
    // Format characters that aren't default-ignorable: interlinear annotation and Egyptian hieroglyph format controls.
    for (const why of ['\u{FFF9}', '\u{FFFB}', '\u{13430}', '\u{1343F}']) {
      expect(validateQuestions([q({ why })]).join('\n'), JSON.stringify(why)).toMatch(/give why/);
    }
    // Marks with no letter to go on: a combining acute, a combining enclosing circle.
    for (const why of ['\u{301}', ' \u{301}\u{308} ', '\u{20DD}']) {
      expect(validateQuestions([q({ why })]).join('\n'), JSON.stringify(why)).toMatch(/give why/);
    }
  });

  it('rejects a question or an option label the user can\'t see', () => {
    for (const blank of ['   ', '\u200B', '\u3164\u2800']) {
      expect(validateQuestions([q({ question: blank })]).join('\n'), JSON.stringify(blank)).toMatch(/give the question text/);
      expect(validateQuestions([q({ options: [{ label: 'Inform' }, { label: blank }] })]).join('\n'), JSON.stringify(blank)).toMatch(/option 2 has no label text/);
    }
  });

  it('accepts visible text in any script', () => {
    // Devanagari, an emoji ZWJ sequence, Persian with a ZWNJ, Hangul, Thai, CJK and combining accents.
    const texts = ['कौन पढ़ेगा?', '👩\u200D💻', 'می\u200Cخواهم', '누가 읽나요?', 'ใครจะอ่าน', '谁会读？', 'e\u0301'];
    for (const text of texts) {
      expect(validateQuestions([q({ question: text, why: text, options: [{ label: text }, { label: `${text} 2` }] })]), text).toEqual([]);
    }
  });

  it('rejects an empty list and more than 8 questions', () => {
    expect(validateQuestions([])).toHaveLength(1);
    const nine = Array.from({ length: 9 }, (_, i) => q({ id: `q${i}` }));
    expect(validateQuestions(nine).join('\n')).toMatch(/between 1 and 8/);
  });
});

describe('cleaning the caller\'s text', () => {
  it('tells visible text from whitespace, control and invisible characters', () => {
    // Format characters count as unseen, even the few that show, such as U+0600; text with anything else in it is visible.
    for (const text of ['\u{FFF9}', '\u{13430}', '\u{0600}', '\u{200E}\u{202E}']) expect(hasVisibleText(text), JSON.stringify(text)).toBe(false);
    expect(hasVisibleText('\u{0600}\u{0661}\u{0662}')).toBe(true);
    // Marks alone aren't visible text; on a letter they are, in any script (spacing marks such as Devanagari's U+093E show on their own).
    for (const text of ['\u{301}', '\u{20DD}', '\u{E31}\u{E48}']) expect(hasVisibleText(text), JSON.stringify(text)).toBe(false);
    for (const text of ['e\u{301}', '\u{915}\u{93F}', '\u{93E}', '\u{E01}\u{E31}\u{E48}', 'Cafe\u{301}']) expect(hasVisibleText(text), text).toBe(true);
    for (const text of ['a', '.', '★', '\uFFFD', '👩\u200D💻', 'می\u200Cخواهم']) expect(hasVisibleText(text), text).toBe(true);
    for (const text of ['', ' \t\n', '\u200B\u200D\uFEFF', '\u0001\u007F\u0085', '\u2800', undefined, 42]) expect(hasVisibleText(text), JSON.stringify(text)).toBe(false);
  });

  it('turns control characters into spaces and lone surrogates into U+FFFD, keeping the length', () => {
    const raw = 'a\u0000b\u0001c\u001B[31md\u007Fe\u0085f\nnew\tline\r\u2028';
    const clean = cleanText(raw);
    expect(clean).toBe('a b c [31md e f new line \u2028');
    expect(clean).toHaveLength(raw.length);
    expect(cleanText('x\uD800y\uDC00z\uD83D')).toBe('x\uFFFDy\uFFFDz\uFFFD');
    // Pairs are characters, not lone surrogates.
    expect(cleanText('😀 \uD83D\uDE00')).toBe('😀 😀');
    // Notes keep their newlines.
    expect(cleanText('one\ntwo\u0001\r\n', true)).toBe('one\ntwo  \n');
  });

  it('cleans every text field and takes the ★ a model adds off the recommended label', () => {
    const [cleaned] = cleanQuestions([
      {
        id: 'audience',
        header: 'Who\u0001',
        question: 'Who will\nread it?\uD800',
        options: [{ label: 'Team leads', description: 'They\u0007 decide' }, { label: 'Individual remote workers ★' }, { label: ' ★ Premium' }, { label: '5★ hotels ' }],
        recommended: 1,
        why: 'most\u001Fcommon readers',
      },
    ]);
    expect(cleaned).toEqual({
      id: 'audience',
      header: 'Who ',
      question: 'Who will read it?\uFFFD',
      // Only the recommended label loses its ★; the others are trimmed, and validation rejects their ★.
      options: [{ label: 'Team leads', description: 'They  decide' }, { label: 'Individual remote workers' }, { label: '★ Premium' }, { label: '5★ hotels' }],
      recommended: 1,
      why: 'most common readers',
    });
  });

  it('takes off only a ★ that stands alone at the start or end of the recommended label', () => {
    const recommendedLabel = (label: string) => cleanQuestions([q({ options: [{ label: 'Inform' }, { label }], recommended: 1 })])[0]!.options[1]!.label;
    // The marker as models write it, with a variation selector or other spaces around it.
    for (const label of ['Team managers ★', '★ Team managers', '★ Team managers ★', 'Team managers ★\u{FE0F}', 'Team managers ★\u{FE0E}', ' Team managers\u{A0}★ ']) {
      expect(recommendedLabel(label), JSON.stringify(label)).toBe('Team managers');
    }
    // Labels with numbers too, which a single ★ can't tell from a rating on the recommended option alone.
    for (const [label, unmarked] of [['Python 3 ★', 'Python 3'], ['★ 5', '5'], ['Top 10 ★\u{FE0F}', 'Top 10'], ['4.5 ★', '4.5']] as const) {
      expect(recommendedLabel(label), JSON.stringify(label)).toBe(unmarked);
    }
    // A ★ inside the label, next to other text or more than one: possibly content, so it stays (and validation rejects it).
    for (const label of ['Most ★ popular', 'Team managers ★★', 'Team managers ★ ★', '★★★★☆', '5★ hotels', 'Luxury (5★)', 'Team managers★']) {
      expect(recommendedLabel(label), JSON.stringify(label)).toBe(label);
    }
    // The same marker on another option stays.
    expect(cleanQuestions([q({ options: [{ label: 'Inform ★' }, { label: 'Persuade' }], recommended: 1 })])[0]!.options[0]!.label).toBe('Inform ★');
  });

  it('rejects a ★ left in a label, so a star rating is never changed', () => {
    const errorsFor = (labels: string[], recommended: number) => validateQuestions(cleanQuestions([q({ options: labels.map((label) => ({ label })), recommended })]));
    const starError = (n: number, label: string) =>
      `question 1 ("goal"): option ${n} ("${label}") contains ★; ask_user puts the only ★ on the option that recommended points to, so leave it out (write a rating in words, such as "4 stars")`;
    const ratings = ['★★★★★', '★★★★☆', '★★★☆☆'];
    expect(errorsFor(ratings, 1)).toEqual(ratings.map((label, i) => starError(i + 1, label)));
    expect(errorsFor(['5★ hotels', '4★ hotels'], 1)).toEqual([starError(1, '5★ hotels'), starError(2, '4★ hotels')]);
    expect(errorsFor(['Luxury (5★)', 'Mid-range (3★)'], 1)).toEqual([starError(1, 'Luxury (5★)'), starError(2, 'Mid-range (3★)')]);
    expect(errorsFor(['Inform', 'Most ★ popular'], 1)).toEqual([starError(2, 'Most ★ popular')]);
    // Ratings with one ★ each: the recommended one loses its ★ as a marker, and the others are rejected.
    expect(errorsFor(['5 ★', '4 ★', '3 ★'], 1)).toEqual([starError(1, '5 ★'), starError(3, '3 ★')]);
    // A ★ on an option that isn't the recommended one: maybe the recommended index is wrong.
    expect(errorsFor(['Inform ★', 'Persuade'], 1)).toEqual([starError(1, 'Inform ★')]);
    // A recommended label that is only the marker has no text left.
    expect(errorsFor(['Inform', '★'], 1)).toEqual(['question 1 ("goal"): option 2 has no label text']);
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

  it('always gives the reason next to the ★ and opens with the default line for the model to translate', () => {
    const batch = buildTextBatch([q({ question: '¿Cuál es el objetivo?', recommended: 1, why: ' los gerentes deciden ' })]);
    expect(batch.split('\n')[0]).toBe(DEFAULT_INTRO);
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
    // Blank strings, and strings of invisible characters, fall back to the defaults.
    expect(buildElicitationSchema(questions, { label: ' ', hint: '' }).properties[NOTES_FIELD]).toMatchObject({ title: NOTES_TITLE, description: NOTES_HINT });
    expect(buildElicitationSchema(questions, { label: '\u200B', hint: '\u3164\u2800' }).properties[NOTES_FIELD]).toMatchObject({ title: NOTES_TITLE, description: NOTES_HINT });
  });

  it('leaves out a header or an option description the user can\'t see', () => {
    const options = [{ label: 'Employees', description: '\u200B' }, { label: 'Team managers', description: ' \u2060 ' }];
    const schema = buildElicitationSchema([{ ...questions[0]!, header: '\u200B', options }]);
    expect(schema.properties.audience!.description).toBe('Team managers ★ (they decide remote-work policy)');
  });

  it('uses the intro as the form message, or a default', () => {
    expect(buildFormMessage('Hola')).toBe('Hola');
    expect(buildFormMessage()).toMatch(/recommended answer/);
    expect(buildFormMessage('\u200B ')).toMatch(/recommended answer/);
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

  it('cleans the notes like the caller\'s text but keeps their newlines, and drops notes with nothing to see', () => {
    const { notes } = mapFormAnswers(questions, { notes: '\u001B[1mBold\u001B[0m\nline two\uD800\u0000' });
    expect(notes).toBe('[1mBold [0m\nline two\uFFFD');
    expect(mapFormAnswers(questions, { notes: '\u200B\u0001\n' })).not.toHaveProperty('notes');
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
