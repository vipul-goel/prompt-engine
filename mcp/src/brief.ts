// Assembles the text the server hands to the host model, from the generated
// content (skills/prompt-engine/references and universal/prompt-engine.md).
// Pure and SDK-free.

import { REFERENCES, UNIVERSAL_METHOD, VERSION } from './generated/content.js';

export const MODES = ['quick', 'standard', 'deep'] as const;
export type Mode = (typeof MODES)[number];

export const DOMAINS = ['coding', 'writing', 'research', 'image-video', 'general'] as const;
export type Domain = (typeof DOMAINS)[number];

/** Reference files served as static resources (prompt-engine://<name>). */
export const REFERENCE_RESOURCES = ['output-format', 'questions', 'blueprint', 'media-targets'] as const;
export type ReferenceResource = (typeof REFERENCE_RESOURCES)[number];

export const TARGET_MAX_CHARS = 100;

const MODE_NOTES: Record<Mode, string> = {
  quick: 'ask nothing; use the recommended defaults and list them under Assumptions.',
  standard: 'ask one round of up to 8 questions, only the ones that matter.',
  deep: 'ask a first round, then up to two more rounds of at most 4 questions.',
};

// The universal method tells chat users to attach a knowledge file; over MCP the
// checklists come from a tool instead.
const KNOWLEDGE_SENTENCE = /If a knowledge file[^.\n]*\./;
const CHECKLIST_SENTENCE = "Call get_checklist for the domain's full checklist.";

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

export function isDomain(value: unknown): value is Domain {
  return typeof value === 'string' && (DOMAINS as readonly string[]).includes(value);
}

/** Lower-cases and trims a free-form mode token; anything that isn't a mode is ignored. */
export function normalizeMode(value: unknown): Mode | undefined {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isMode(token) ? token : undefined;
}

/** One line, no control characters, bounded, so a target can't reshape the brief. */
export function normalizeTarget(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, TARGET_MAX_CHARS) : undefined;
}

/** Points `references/x.md` mentions at this server's resources instead of files the host can't see. */
export function rewriteReferencePaths(md: string): string {
  return md.replace(/`?references\/([a-z-]+)\.md`?/g, (match, name: string) => {
    if (isDomain(name)) return `\`prompt-engine://checklists/${name}\``;
    if ((REFERENCE_RESOURCES as readonly string[]).includes(name)) return `\`prompt-engine://${name}\``;
    return match;
  });
}

/** The universal method with the knowledge-file sentence replaced by the get_checklist call. */
export function adaptMethod(method: string = UNIVERSAL_METHOD): string {
  return KNOWLEDGE_SENTENCE.test(method) ? method.replace(KNOWLEDGE_SENTENCE, CHECKLIST_SENTENCE) : method;
}

const SERVER_SECTION = `## How to use this server
These steps replace the instruction above to send the questions in your own message.
1. Call get_checklist with the domain (coding, writing, research, image-video or general) for its full checklist and ★ defaults. Use two domains if the prompt spans them.
2. Standard and deep modes: call ask_user with the questions that matter, written in the user's language: 1–8 questions, each with 2–4 options, the 0-based index of the recommended option, a reason of 12 words or fewer, and a header of up to 12 characters. Pass intro in the user's language if it isn't English. Where the app supports forms, the user answers in a form and ask_user returns the answers. Otherwise it returns the questions as text: show them to the user in their language, then stop and wait for the reply. Deep mode can call ask_user again for later rounds. Skip this step in quick mode.
3. With the answers in hand, write the enhanced prompt yourself and present it in exactly the format of section 5. Answers with source "chosen" are [your answer]; answers with source "recommended" that the user never confirmed go under Assumptions, and so do the defaults you chose without asking.
4. Optionally call check_prompt on your draft full prompt and fix what it flags before presenting it. Its findings are keyword heuristics, so score with the anchors above, not with the tool.
This server never calls a model and doesn't receive the user's prompt unless you pass a draft to check_prompt.`;

export interface BriefOptions {
  mode?: Mode | undefined;
  target?: string | undefined;
}

/** The method brief returned by enhance_prompt, the enhance prompt and prompt-engine://method. */
export function buildBrief(options: BriefOptions = {}): string {
  const target = normalizeTarget(options.target);
  const request = [
    `Prompt Engine brief from the prompt-engine MCP server (v${VERSION}).`,
    options.mode
      ? `Requested mode: ${options.mode} — ${MODE_NOTES[options.mode]}`
      : "Requested mode: not given — use the mode the user asked for: standard unless they said quick or deep.",
    target
      ? `Requested target: ${target} — write the prompt for this tool or model.`
      : 'Requested target: not given — infer it as section 1 says.',
  ].join('\n');
  const method = adaptMethod().trim();
  const parts = [request, method, SERVER_SECTION];
  if (!KNOWLEDGE_SENTENCE.test(UNIVERSAL_METHOD)) parts.push(CHECKLIST_SENTENCE);
  return `${parts.join('\n\n')}\n`;
}

/** The domain checklist returned by get_checklist and prompt-engine://checklists/{domain}. */
export function buildChecklist(domain: Domain): string {
  const parts = [rewriteReferencePaths(referenceText(domain)).trim()];
  if (domain === 'image-video') parts.push(rewriteReferencePaths(referenceText('media-targets')).trim());
  return `${parts.join('\n\n---\n\n')}\n`;
}

/** A reference file's text, with paths pointing at this server's resources. */
export function buildReference(name: ReferenceResource): string {
  return `${rewriteReferencePaths(referenceText(name)).trim()}\n`;
}

export function referenceTitle(name: Domain | ReferenceResource): string {
  return REFERENCES[name]?.title ?? name;
}

function referenceText(name: string): string {
  const ref = REFERENCES[name];
  if (!ref) throw new Error(`generated content has no reference named "${name}"; run node scripts/build.mjs`);
  return ref.text;
}
