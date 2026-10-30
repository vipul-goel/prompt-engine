// The MCP surface of Prompt Engine: tools, the enhance prompt and resources.
// createServer() is a factory, so every serving entry (stdio, Node HTTP,
// Cloudflare Workers) gets a fresh, stateless instance per connection or request.
// This file, cli.ts and worker.ts are the only modules that import the SDK.

import {
  CLIENT_CAPABILITIES_META_KEY,
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
  completable,
  inputRequired,
  inputResponse,
  type CacheHint,
  type CallToolResult,
  type jsonSchemaValidator,
  type ServerContext,
  type ToolAnnotations,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  DOMAINS,
  MODES,
  REFERENCE_RESOURCES,
  TARGET_MAX_CHARS,
  buildBrief,
  buildChecklist,
  buildReference,
  isDomain,
  normalizeMode,
  normalizeTarget,
  referenceTitle,
  type Domain,
} from './brief.js';
import { PROMPT_MAX_CHARS, checkPrompt, formatReport, type CheckReport } from './check.js';
import { VERSION } from './generated/content.js';
import {
  HEADER_MAX_CHARS,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  NOTES_HINT,
  NOTES_MAX_CHARS,
  NOTES_TITLE,
  buildElicitationSchema,
  buildFormMessage,
  buildTextBatch,
  cleanQuestions,
  cleanText,
  mapFormAnswers,
  recommendedAnswers,
  supportsFormElicitation,
  validateQuestions,
  type FormAnswers,
  type Question,
} from './questions.js';

export const SERVER_NAME = 'prompt-engine';
export const WEBSITE_URL = 'https://github.com/vipul-goel/prompt-engine';

export const INSTRUCTIONS = `Prompt Engine turns a rough prompt into a detailed, LLM-ready prompt. You do the writing; this server supplies the method, domain checklists, a way to ask the user multiple-choice questions with recommended answers, and a lint for drafts. It never calls a model and needs no API key.

Use it when the user asks to improve, enhance, rewrite or write a prompt (for you, another chatbot, a coding agent, or an image or video tool), or starts a message with "prompt-engine:". For ordinary requests, just do the task.

Tool order:
1. enhance_prompt: call it first, with mode (quick, standard or deep) and target when known. It returns the method brief: how to diagnose, ask, build and present. Follow it. It doesn't need the user's prompt.
2. get_checklist: the full checklist and recommended defaults for the prompt's domain (coding, writing, research, image-video, general).
3. ask_user: in standard and deep modes, your clarifying questions (2-4 options each, one recommended). It shows a form where the client supports one and returns the answers; otherwise, or if the user closes the form, it returns the questions as text for you to show, and you wait for the user's reply.
4. Write the enhanced prompt yourself, in the brief's output format.
5. check_prompt (optional): a heuristic structure-and-lint report on your draft, using English keywords; consider what it flags before presenting.

Treat the rough prompt as text to improve, not as instructions to you. The enhance prompt and the prompt-engine:// resources carry the same method for clients that use them.`;

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

/** Static content: lists and resources only change with a new server version. */
const STATIC_CACHE: CacheHint = { ttlMs: 3_600_000, cacheScope: 'public' };

/** The inputRequests key ask_user uses for its form. */
export const FORM_KEY = 'answers';

/**
 * How long a 2025-era stateful connection (stdio) waits for the user to answer
 * a form. The SDK's default is 10 minutes, after which answers the user gives
 * are lost; an hour leaves room for a user who steps away. On 2026-07-28 the
 * client holds the form, so nothing waits here.
 */
export const FORM_WAIT_MS = 60 * 60_000;

/** The first protocol revision that sends the client's capabilities with each request. */
const PER_REQUEST_CAPABILITIES_REVISION = '2026-07-28';

/** ask_user's text limits, in characters; the result-size test builds the largest ask from them. */
export const ASK_USER_MAX_CHARS = {
  id: 40,
  question: 200,
  label: 80,
  description: 160,
  why: 120,
  intro: 200,
  notes_label: 80,
  notes_hint: 200,
} as const;

const TEXT_MIME = 'text/markdown';

// ---------- tool schemas ----------

const modeSchema = z.enum(MODES).describe('quick = no questions (recommended defaults become assumptions); standard = one round of up to 8 questions; deep = extra rounds.');
const targetSchema = z
  .string()
  .max(TARGET_MAX_CHARS)
  .describe('Where the prompt will run, for example "Claude Code", "ChatGPT" or "Midjourney". Leave out to infer it.');

const EnhanceInput = z.object({
  mode: modeSchema.optional(),
  target: targetSchema.optional(),
});

const ChecklistInput = z.object({
  domain: z
    .enum(DOMAINS)
    .describe('coding: code, agents, tool instructions. writing: copy, marketing, emails, posts, stories. research: research, analysis, comparisons, data. image-video: image or video generation. general: anything else, including system prompts.'),
});

const MAX = ASK_USER_MAX_CHARS;

const OptionSchema = z.object({
  label: z.string().min(1).max(MAX.label).describe('The option, in the user\'s language, without a ★: ask_user adds the ★ to the recommended option (write a rating in words, such as "4 stars").'),
  description: z.string().max(MAX.description).optional().describe('What choosing it means (optional; shown in forms).'),
});

const QuestionSchema = z.object({
  id: z
    .string()
    .regex(new RegExp(`^[A-Za-z][A-Za-z0-9_-]{0,${MAX.id - 1}}$`))
    .describe('Short unique identifier such as "audience" or "length" (letters, digits, - and _; "notes" is reserved).'),
  header: z.string().min(1).max(HEADER_MAX_CHARS).optional().describe(`A tag of up to ${HEADER_MAX_CHARS} characters, such as "Audience".`),
  question: z.string().min(1).max(MAX.question).describe('One decision in plain words, in the user\'s language.'),
  options: z.array(OptionSchema).min(MIN_OPTIONS).max(MAX_OPTIONS).describe(`${MIN_OPTIONS}-${MAX_OPTIONS} concrete, mutually exclusive options.`),
  recommended: z.number().int().min(0).max(MAX_OPTIONS - 1).describe('0-based index of the recommended option.'),
  why: z.string().min(1).max(MAX.why).describe('The reason for the recommended option, 12 words or fewer, in the user\'s language.'),
});

const AskUserInput = z.object({
  questions: z.array(QuestionSchema).min(1).max(MAX_QUESTIONS).describe('Most important first.'),
  intro: z
    .string()
    .max(MAX.intro)
    .optional()
    .describe('The form\'s message: one line in the user\'s language. The form has its own controls, so don\'t say how to reply. Questions asked in the chat open with their own line instead. Defaults to an English line.'),
  notes_label: z.string().max(MAX.notes_label).optional().describe(`The form's free-text field label, in the user's language. Defaults to "${NOTES_TITLE}"`),
  notes_hint: z.string().max(MAX.notes_hint).optional().describe(`The hint under that field, in the user's language. Defaults to "${NOTES_HINT}"`),
});

const AnswerSchema = z.object({
  id: z.string(),
  answer: z.string().describe('The option label.'),
  source: z.enum(['chosen', 'recommended']).describe('chosen: the user picked or confirmed it ([your answer]). recommended: the ★ answer the user did not confirm (list it under Assumptions).'),
});

const AskUserOutput = z.object({
  status: z
    .enum(['answered', 'declined', 'ask_in_chat'])
    .describe('answered: the user submitted the form. declined: the user declined it, so answers holds the ★ answers. ask_in_chat: no form here, or the user closed it without answering; show questionsText and wait for the reply.'),
  answers: z.array(AnswerSchema).optional(),
  notes: z.string().optional().describe(`Free text from the form, at most ${NOTES_MAX_CHARS.toLocaleString('en-US')} characters; it wins over the chosen options.`),
  questionsText: z.string().optional(),
  next: z.string().describe('What to do now.'),
});
type AskUserResult = z.infer<typeof AskUserOutput>;

const CheckInput = z.object({
  prompt: z.string().min(1).max(PROMPT_MAX_CHARS).describe('The draft enhanced prompt (the full prompt, not the whole reply).'),
  target: targetSchema.optional(),
});

const CheckOutput = z.object({
  heuristic: z.literal(true),
  target: z.string().optional(),
  targetKind: z.enum(['text', 'media']),
  mostlyEnglish: z.boolean().describe('Whether the draft looks mostly English. The area checks match English keywords only.'),
  dimensions: z.array(
    z.object({
      name: z.string(),
      status: z
        .enum(['found', 'not found', 'unknown'])
        .describe('found: explicitly mentioned (keyword or heading match), not a judgement of quality. unknown: no match in a draft that looks mostly non-English.'),
      evidence: z.array(z.string()),
    }),
  ),
  issues: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(['warning', 'info']),
      message: z.string(),
      excerpt: z.string(),
      line: z.number().int().min(1),
    }),
  ),
  summary: z.string(),
});

// ---------- descriptions ----------

const DESCRIPTIONS = {
  enhance_prompt:
    'Use when the user asks to improve, enhance, rewrite or write a prompt (for you, another chatbot, a coding agent, or an image or video tool), or starts a message with "prompt-engine:". Call it first. Returns the Prompt Engine method brief: how to find what the rough prompt leaves out, ask multiple-choice questions with recommended answers (through ask_user), and write and present the enhanced prompt in a fixed format with a score. Pass mode (quick = no questions, standard, deep = extra rounds) and target (the tool or model the prompt is for) when known. It doesn\'t need the user\'s prompt text.',
  get_checklist:
    'Use after enhance_prompt, once you know what the prompt is about. Returns the full checklist for that domain: must-haves, each item with an example question and its recommended (★) default, and a worked example. Domains: coding (code, agents, tool instructions), writing (copy, marketing, emails, posts, stories), research (research, analysis, comparisons, data), image-video (image or video generation; includes each tool\'s syntax), general (anything else, including system prompts and custom-assistant instructions).',
  ask_user:
    'Use in standard and deep modes to ask the user your clarifying questions, instead of writing them in your reply. Pass 1-8 questions in the user\'s language, most important first, each with 2-4 options, the 0-based index of the recommended option and why, its reason in 12 words or fewer; header is an optional tag of up to 12 characters. Where the app supports forms, the user answers one form (recommended answers preselected, plus a notes field; pass intro, notes_label and notes_hint in the user\'s language) and this returns the answers: source "chosen" means the user picked it; "recommended" means they didn\'t confirm it, so list it under Assumptions. If the user declines, you get the recommended answers to list under Assumptions. If forms aren\'t supported, or the user closes the form without answering, it returns the questions as numbered text: show that to the user in their language, then stop and wait for their reply. If the call fails, ask the same questions in your reply in the brief\'s numbered format.',
  check_prompt:
    'Use on your draft enhanced prompt before presenting it (optional). Returns a deterministic, heuristic report: for each scored area (Clear goal, Context, Constraints, Output format, Edge cases) whether the draft explicitly mentions it, with short evidence, plus lint findings such as capitalized pressure words, requests to expose reasoning, prefill instructions, leftover template variables and open [[placeholders]]. The checks match English keywords and headings: in a draft that is mostly in another language, an area without a match is reported as unknown rather than not found. It gives no score; score with the brief\'s anchors. Pass target (for example "Midjourney") so image and video conventions apply.',
} as const;

// ---------- helpers ----------

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * The client capabilities that apply to this request: the per-request envelope
 * when this instance serves the 2026-07-28 era; on a 2025-era connection, what
 * the client declared at initialize (stateless HTTP serving never sees an
 * initialize, so it has none). The served era decides, as in the SDK's own
 * check before it sends a form, because a 2025-era request can still carry
 * the 2026 capabilities key.
 */
function clientCapabilities(server: McpServer, ctx: ServerContext): unknown {
  // Revisions are ISO dates, so string order is date order. The SDK marks this
  // accessor deprecated in favour of the envelope, but the envelope is what a
  // 2025-era request can carry too; instances serving 2026-07-28 report it here.
  const revision = server.server.getNegotiatedProtocolVersion();
  if (revision !== undefined && revision >= PER_REQUEST_CAPABILITIES_REVISION) {
    return (ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[CLIENT_CAPABILITIES_META_KEY];
  }
  return server.server.getClientCapabilities();
}

function askResult(result: AskUserResult, lead: string): CallToolResult {
  const structured = Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined)) as AskUserResult;
  return {
    content: [
      { type: 'text', text: lead },
      { type: 'text', text: JSON.stringify(structured, null, 2) },
    ],
    structuredContent: structured,
  };
}

const CONTINUE =
  'Continue: write the enhanced prompt and present it in exactly the output format from the brief (section 5).';

function answeredResult({ answers, notes, notesCut }: FormAnswers): CallToolResult {
  const unconfirmed = answers.some((a) => a.source === 'recommended');
  const next = [
    'The user answered in a form.',
    CONTINUE,
    'Tag answers with source "chosen" as [your answer].',
    unconfirmed ? 'List answers with source "recommended" under Assumptions.' : '',
    notes ? 'Apply the notes; they win over the chosen options.' : '',
    notesCut ? `The notes were cut to ${NOTES_MAX_CHARS.toLocaleString('en-US')} characters; if the end matters, ask the user for it.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return askResult({ status: 'answered', answers, notes, next }, next);
}

/** The user explicitly declined the form: build with the ★ answers, listed as assumptions. */
function declinedResult(questions: Question[]): CallToolResult {
  const next = `The user declined the questions, so use the recommended (★) answers below and list each one under Assumptions. ${CONTINUE}`;
  return askResult({ status: 'declined', answers: recommendedAnswers(questions), next }, next);
}

/**
 * No form here, or the user closed it without answering: ask in the chat, never
 * guess. The intro is the form's message, so the chat text opens with the
 * default line (see buildTextBatch), which next asks the model to translate.
 */
function textModeResult(questions: Question[], reason: 'no-form' | 'form-closed'): CallToolResult {
  const questionsText = buildTextBatch(questions);
  const why = reason === 'form-closed' ? 'The user closed the form without answering' : "This app can't show a form";
  const next = `${why}, so ask in the chat: send questionsText to the user as your whole reply, in their language (translate the opening and closing lines if needed; keep the numbers, letters and ★ marks), then stop and wait. Don't guess the answers. Read their reply as the brief says: ok accepts every ★, partial answers keep ★ for the rest, and free text wins. Answers they accept, ★ ones included, are [your answer], not assumptions.`;
  // The text block already carries everything, so no JSON mirror here.
  return {
    content: [{ type: 'text', text: `${next}\n\n${questionsText}` }],
    structuredContent: { status: 'ask_in_chat', questionsText, next },
  };
}

function readResult(uri: URL, body: string) {
  return { contents: [{ uri: uri.href, mimeType: TEXT_MIME, text: body }] };
}

// ---------- the factory ----------

export interface CreateServerOptions {
  /** JSON Schema validator for elicitation results; defaults to the SDK's runtime pick (Ajv on Node). */
  jsonSchemaValidator?: jsonSchemaValidator;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: 'Prompt Engine',
      version: VERSION,
      description: 'Turns rough prompts into detailed, LLM-ready prompts with multiple-choice questions and recommended answers.',
      websiteUrl: WEBSITE_URL,
    },
    {
      instructions: INSTRUCTIONS,
      capabilities: {
        tools: { listChanged: false },
        prompts: { listChanged: false },
        resources: { listChanged: false },
      },
      cacheHints: {
        'tools/list': STATIC_CACHE,
        'prompts/list': STATIC_CACHE,
        'resources/list': STATIC_CACHE,
        'resources/templates/list': STATIC_CACHE,
        'resources/read': STATIC_CACHE,
        'server/discover': STATIC_CACHE,
      },
      inputRequired: { roundTimeoutMs: FORM_WAIT_MS },
      ...(options.jsonSchemaValidator ? { jsonSchemaValidator: options.jsonSchemaValidator } : {}),
    },
  );

  server.registerTool(
    'enhance_prompt',
    { title: 'Get the Prompt Engine method', description: DESCRIPTIONS.enhance_prompt, inputSchema: EnhanceInput, annotations: ANNOTATIONS },
    async ({ mode, target }) => text(buildBrief({ mode, target })),
  );

  server.registerTool(
    'get_checklist',
    { title: 'Get a domain checklist', description: DESCRIPTIONS.get_checklist, inputSchema: ChecklistInput, annotations: ANNOTATIONS },
    async ({ domain }) => text(buildChecklist(domain)),
  );

  server.registerTool(
    'ask_user',
    {
      title: 'Ask the user clarifying questions',
      description: DESCRIPTIONS.ask_user,
      inputSchema: AskUserInput,
      outputSchema: AskUserOutput,
      annotations: ANNOTATIONS,
    },
    async (input, ctx) => {
      // Clean the caller's text once, before validation (see cleanText and cleanQuestions).
      const questions = cleanQuestions(input.questions);
      const [intro, notes_label, notes_hint] = [input.intro, input.notes_label, input.notes_hint].map((s) => (s === undefined ? undefined : cleanText(s)));
      const errors = validateQuestions(questions);
      if (errors.length) return toolError(`Fix the questions and call ask_user again:\n- ${errors.join('\n- ')}`);

      // Stateless: the retry carries the same questions plus the form result.
      const response = inputResponse(ctx.mcpReq.inputResponses, FORM_KEY);
      if (response.kind === 'elicit') {
        if (response.action === 'accept') return answeredResult(mapFormAnswers(questions, response.content));
        if (response.action === 'decline') return declinedResult(questions);
        // "cancel": closed without a choice. The method says to ask in text then, never to guess.
        return textModeResult(questions, 'form-closed');
      }

      if (supportsFormElicitation(clientCapabilities(server, ctx))) {
        return inputRequired({
          inputRequests: {
            [FORM_KEY]: inputRequired.elicit({
              message: buildFormMessage(intro),
              requestedSchema: buildElicitationSchema(questions, { label: notes_label, hint: notes_hint }),
            }),
          },
        });
      }
      return textModeResult(questions, 'no-form');
    },
  );

  server.registerTool(
    'check_prompt',
    {
      title: 'Check a draft prompt',
      description: DESCRIPTIONS.check_prompt,
      inputSchema: CheckInput,
      outputSchema: CheckOutput,
      annotations: ANNOTATIONS,
    },
    async ({ prompt, target }) => {
      const report: CheckReport = checkPrompt(prompt, normalizeTarget(target));
      return { content: [{ type: 'text', text: formatReport(report) }], structuredContent: { ...report } };
    },
  );

  server.registerPrompt(
    'enhance',
    {
      title: 'Enhance a prompt',
      description: 'Turn your rough prompt into a detailed, LLM-ready prompt. Optional mode: quick (no questions), standard or deep.',
      argsSchema: z.object({
        mode: completable(z.string().describe('quick, standard or deep (optional).'), (value) =>
          MODES.filter((m) => m.startsWith((value ?? '').trim().toLowerCase())),
        ).optional(),
      }),
    },
    ({ mode }) => ({
      description: 'The Prompt Engine method, then a request to improve the rough prompt.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${buildBrief({ mode: normalizeMode(mode) })}\nImprove the rough prompt in my previous message, or ask me for it if there isn't one.`,
          },
        },
      ],
    }),
  );

  server.registerResource(
    'method',
    'prompt-engine://method',
    { title: 'Prompt Engine method', description: 'The method brief that enhance_prompt returns.', mimeType: TEXT_MIME },
    (uri) => readResult(uri, buildBrief()),
  );

  const referenceDescriptions: Record<(typeof REFERENCE_RESOURCES)[number], string> = {
    'output-format': 'The fixed reply format, rules for each part and the score anchors.',
    questions: 'Which clarifying questions to ask, how to word them, and how to read replies.',
    blueprint: 'How to write the enhanced prompt: skeleton, phrasing and target-model notes.',
    'media-targets': 'Tool-specific syntax for image and video generators, with verification status.',
  };
  for (const name of REFERENCE_RESOURCES) {
    server.registerResource(
      name,
      `prompt-engine://${name}`,
      { title: referenceTitle(name), description: referenceDescriptions[name], mimeType: TEXT_MIME },
      (uri) => readResult(uri, buildReference(name)),
    );
  }

  const checklistUri = (domain: Domain) => `prompt-engine://checklists/${domain}`;
  server.registerResource(
    'checklist',
    new ResourceTemplate('prompt-engine://checklists/{domain}', {
      list: () => ({
        resources: DOMAINS.map((domain) => ({
          uri: checklistUri(domain),
          name: `checklist-${domain}`,
          title: referenceTitle(domain),
          mimeType: TEXT_MIME,
        })),
      }),
      complete: { domain: (value) => DOMAINS.filter((d) => d.startsWith(value)) },
    }),
    { title: 'Domain checklist', description: 'The checklist get_checklist returns, by domain: coding, writing, research, image-video or general.', mimeType: TEXT_MIME },
    (uri, variables) => {
      const domain = Array.isArray(variables.domain) ? variables.domain[0] : variables.domain;
      if (!isDomain(domain)) throw new ResourceNotFoundError(uri.href);
      return readResult(uri, buildChecklist(domain));
    },
  );

  return server;
}

/** Tool, prompt and resource names, for tests and the bundle manifest. */
export const TOOL_NAMES = ['enhance_prompt', 'get_checklist', 'ask_user', 'check_prompt'] as const;
export { DESCRIPTIONS as TOOL_DESCRIPTIONS };
