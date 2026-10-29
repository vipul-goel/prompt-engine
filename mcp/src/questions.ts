// Clarifying questions for ask_user: validation, the text batch (the method's
// Format B), the flat form-elicitation schema, and mapping answers back.
// Pure and SDK-free.

export const MAX_QUESTIONS = 8;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const HEADER_MAX_CHARS = 12;
/** The one free-text field of the form; question ids can't use it. */
export const NOTES_FIELD = 'notes';
/** The notes field's longest answer; longer notes are cut to this many characters. */
export const NOTES_MAX_CHARS = 1_000;
/** English defaults for the notes field's label and hint; ask_user's notes_label and notes_hint replace them. */
export const NOTES_TITLE = 'Anything to add or change?';
export const NOTES_HINT = 'Optional. Anything you write here wins over the choices above.';
export const DEFAULT_INTRO = 'A few quick questions so the prompt fits what you need (★ = recommended):';
export const REPLY_LINE = 'Reply `ok` to accept every ★, or answer like `2b 4: your own text`. Anything you skip gets the ★.';
const DEFAULT_FORM_MESSAGE = 'A few quick questions so the prompt fits what you need. Each one starts on the recommended answer; change any you like.';

export interface QuestionOption {
  label: string;
  description?: string | undefined;
}

export interface Question {
  id: string;
  header?: string | undefined;
  question: string;
  options: QuestionOption[];
  /** 0-based index into options. */
  recommended: number;
  /** The reason for the recommendation, shown next to the ★. */
  why: string;
}

export type AnswerSource = 'chosen' | 'recommended';

export interface Answer {
  id: string;
  answer: string;
  source: AnswerSource;
}

export interface FormAnswers {
  answers: Answer[];
  notes?: string;
  /** Set when the notes were longer than NOTES_MAX_CHARS and were cut. */
  notesCut?: true;
}

/** A flat elicitation schema: one property per question plus the notes field. */
export type ElicitationSchema = {
  type: 'object';
  properties: Record<string, EnumField | TextField>;
  required: string[];
};

export interface EnumField {
  type: 'string';
  title: string;
  description?: string;
  enum: string[];
  default: string;
}

export interface TextField {
  type: 'string';
  title: string;
  description?: string;
  maxLength: number;
}

/** The notes field's label and hint, in the user's language when the caller gives them. */
export interface NotesText {
  label?: string | undefined;
  hint?: string | undefined;
}

/** Rules a JSON Schema can't express; returns one message per problem. */
export function validateQuestions(questions: readonly Question[]): string[] {
  const errors: string[] = [];
  if (questions.length < 1 || questions.length > MAX_QUESTIONS) errors.push(`ask between 1 and ${MAX_QUESTIONS} questions (got ${questions.length})`);
  const ids = new Set<string>();
  questions.forEach((q, i) => {
    const at = `question ${i + 1} ("${q.id}")`;
    if (ids.has(q.id)) errors.push(`${at}: id is used twice; ids must be unique`);
    ids.add(q.id);
    if (q.id === NOTES_FIELD) errors.push(`${at}: the id "${NOTES_FIELD}" is reserved for the free-text field`);
    if (q.header !== undefined && [...q.header].length > HEADER_MAX_CHARS) errors.push(`${at}: header "${q.header}" is longer than ${HEADER_MAX_CHARS} characters`);
    if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) errors.push(`${at}: give ${MIN_OPTIONS}-${MAX_OPTIONS} options (got ${q.options.length})`);
    if (!Number.isInteger(q.recommended) || q.recommended < 0 || q.recommended >= q.options.length) {
      errors.push(`${at}: recommended must be a 0-based option index from 0 to ${q.options.length - 1} (got ${q.recommended})`);
    }
    if (typeof q.why !== 'string' || !q.why.trim()) errors.push(`${at}: give why, the reason for the recommended option`);
    const labels = new Set<string>();
    for (const o of q.options) {
      if (labels.has(o.label)) errors.push(`${at}: option "${o.label}" appears twice; labels must be unique`);
      labels.add(o.label);
    }
  });
  return errors;
}

export function recommendedLabel(q: Question): string {
  return q.options[q.recommended]?.label ?? q.options[0]?.label ?? '';
}

const letter = (i: number) => String.fromCharCode(97 + i);

/** The numbered text batch, exactly in the method's format (★ on the recommended option with its reason). */
export function buildTextBatch(questions: readonly Question[], intro?: string): string {
  const lines = [intro?.trim() || DEFAULT_INTRO, ''];
  questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.question.trim()}`);
    const options = q.options.map((o, j) => `${letter(j)}) ${o.label.trim()}${j === q.recommended ? ` ★ (${q.why.trim()})` : ''}`);
    lines.push(`   ${options.join('  ')}`);
  });
  lines.push('', REPLY_LINE);
  return lines.join('\n');
}

/** The form's message: the caller's intro (in the user's language) or a default. */
export function buildFormMessage(intro?: string): string {
  return intro?.trim() || DEFAULT_FORM_MESSAGE;
}

// Only the caller's text and the language-neutral ★ appear here, so the form
// reads in the user's language when the questions are in it.
function fieldDescription(q: Question): string | undefined {
  const rec = q.options[q.recommended];
  const parts: string[] = [];
  if (q.header?.trim()) parts.push(q.header.trim());
  if (rec) parts.push(`${rec.label} ★ (${q.why.trim()})`);
  const described = q.options.filter((o) => o.description?.trim()).map((o) => `${o.label}: ${o.description?.trim()}`);
  if (described.length) parts.push(described.join('; '));
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * One flat form: a single-choice enum field per question (default = the
 * recommended label) and one optional free-text notes field.
 */
export function buildElicitationSchema(questions: readonly Question[], notes: NotesText = {}): ElicitationSchema {
  const properties: Record<string, EnumField | TextField> = {};
  for (const q of questions) {
    const field: EnumField = {
      type: 'string',
      title: q.question.trim(),
      enum: q.options.map((o) => o.label),
      default: recommendedLabel(q),
    };
    const description = fieldDescription(q);
    if (description) field.description = description;
    properties[q.id] = field;
  }
  properties[NOTES_FIELD] = {
    type: 'string',
    title: notes.label?.trim() || NOTES_TITLE,
    description: notes.hint?.trim() || NOTES_HINT,
    maxLength: NOTES_MAX_CHARS,
  };
  return { type: 'object', properties, required: questions.map((q) => q.id) };
}

/** The ★ answer for every question, marked as not confirmed by the user. */
export function recommendedAnswers(questions: readonly Question[]): Answer[] {
  return questions.map((q) => ({ id: q.id, answer: recommendedLabel(q), source: 'recommended' }));
}

/**
 * Maps accepted form content to answers. Values arrive from the client, so
 * anything that isn't one of the question's labels falls back to the ★ answer
 * and is marked "recommended", and notes are cut to NOTES_MAX_CHARS characters.
 */
export function mapFormAnswers(questions: readonly Question[], content: Record<string, unknown> | undefined): FormAnswers {
  const answers: Answer[] = questions.map((q) => {
    const value = content?.[q.id];
    if (typeof value === 'string' && q.options.some((o) => o.label === value)) return { id: q.id, answer: value, source: 'chosen' };
    return { id: q.id, answer: recommendedLabel(q), source: 'recommended' };
  });
  const raw = content?.[NOTES_FIELD];
  if (typeof raw !== 'string' || !raw.trim()) return { answers };
  const notes = truncate(raw.trim(), NOTES_MAX_CHARS);
  return notes === raw.trim() ? { answers, notes } : { answers, notes, notesCut: true };
}

/** At most max characters (code points), the last one "…" when the text was cut. */
export function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/**
 * Whether declared client capabilities cover a form-mode elicitation request:
 * `elicitation.form`, or a bare `elicitation: {}` (the pre-mode meaning).
 */
export function supportsFormElicitation(capabilities: unknown): boolean {
  if (!isPlainObject(capabilities)) return false;
  const elicitation = capabilities['elicitation'];
  if (!isPlainObject(elicitation)) return false;
  return elicitation['form'] !== undefined || elicitation['url'] === undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
