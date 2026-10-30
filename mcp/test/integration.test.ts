// In-process integration tests: a real SDK client against createMcpHandler (the
// stateless HTTP entry) in both protocol eras, plus serveStdio over an in-memory
// pipe for the stateful-connection paths.

import type { ElicitResult } from '@modelcontextprotocol/client';
import { CLIENT_CAPABILITIES_META_KEY, createMcpHandler } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMAINS, REFERENCE_RESOURCES, buildBrief, buildChecklist, buildReference } from '../src/brief.js';
import { PROMPT_MAX_CHARS } from '../src/check.js';
import { VERSION } from '../src/generated/content.js';
import { DEFAULT_INTRO, HEADER_MAX_CHARS, MAX_OPTIONS, MAX_QUESTIONS, NOTES_MAX_CHARS } from '../src/questions.js';
import { ASK_USER_MAX_CHARS, FORM_WAIT_MS, INSTRUCTIONS, TOOL_NAMES, createServer } from '../src/server.js';
import {
  ERAS,
  SAMPLE_QUESTIONS,
  connectHttp,
  connectStdioInProcess,
  schemaErrors,
  textOf,
  type ConnectOptions,
  type Connected,
  type ElicitCall,
  type Era,
} from './helpers.js';

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RESULT_MAX_CHARS = 32_000;
const ask = { name: 'ask_user', arguments: { questions: SAMPLE_QUESTIONS } };

async function outputSchemaOf(conn: Connected, tool: string) {
  const { tools } = await conn.client.listTools();
  const schema = tools.find((t) => t.name === tool)?.outputSchema;
  if (!schema) throw new Error(`${tool} has no outputSchema`);
  return schema;
}

describe.each(ERAS)('%s era over stateless HTTP', (era: Era) => {
  let conn: Connected;
  beforeAll(async () => {
    conn = await connectHttp(era);
  });
  afterAll(async () => {
    await conn.close();
  });

  it('identifies the server and gives the instructions', () => {
    expect(conn.client.getServerVersion()).toMatchObject({ name: 'prompt-engine', title: 'Prompt Engine', version: VERSION });
    expect(conn.client.getInstructions()).toBe(INSTRUCTIONS);
  });

  it('lists the four tools, each annotated read-only and closed-world', async () => {
    const { tools } = await conn.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toEqual(ANNOTATIONS);
      expect(tool.title, tool.name).toBeTruthy();
      // Some clients and model APIs are reported to reject or cut descriptions over 1,024 characters.
      expect(tool.description!.length, tool.name).toBeLessThanOrEqual(1_024);
      expect(tool.inputSchema.type).toBe('object');
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.ask_user!.outputSchema).toBeDefined();
    expect(byName.check_prompt!.outputSchema).toBeDefined();
    expect(byName.enhance_prompt!.outputSchema).toBeUndefined();
    expect(Object.keys(byName.enhance_prompt!.inputSchema.properties ?? {}).sort()).toEqual(['mode', 'target']);
    expect(byName.enhance_prompt!.inputSchema.required ?? []).toEqual([]);
    // The intro is only the form's message, and labels carry no ★.
    const askInput = JSON.stringify(byName.ask_user!.inputSchema);
    expect(askInput).toMatch(/The form's message: one line in the user's language\. The form has its own controls, so don't say how to reply\./);
    expect(askInput).toMatch(/without a ★: ask_user adds the ★ to the recommended option \(write a rating in words/);
  });

  it('lists the enhance prompt with one optional mode argument', async () => {
    const { prompts } = await conn.client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['enhance']);
    expect(prompts[0]!.arguments).toEqual([expect.objectContaining({ name: 'mode', required: false })]);
  });

  it('gets the enhance prompt with and without a mode', async () => {
    const plain = await conn.client.getPrompt({ name: 'enhance' });
    expect(plain.messages).toHaveLength(1);
    const message = plain.messages[0]!;
    expect(message.role).toBe('user');
    expect(message.content.type).toBe('text');
    const text = message.content.type === 'text' ? message.content.text : '';
    expect(text.startsWith(buildBrief())).toBe(true);
    expect(text.trimEnd().endsWith("Improve the rough prompt in my previous message, or ask me for it if there isn't one.")).toBe(true);

    const quick = await conn.client.getPrompt({ name: 'enhance', arguments: { mode: 'quick' } });
    const quickText = quick.messages[0]!.content.type === 'text' ? quick.messages[0]!.content.text : '';
    expect(quickText).toContain('Requested mode: quick —');

    // Claude Code passes the first word of free text as the argument; it is not a mode, so it is ignored.
    const word = await conn.client.getPrompt({ name: 'enhance', arguments: { mode: 'write' } });
    const wordText = word.messages[0]!.content.type === 'text' ? word.messages[0]!.content.text : '';
    expect(wordText).toContain('Requested mode: not given');
  });

  it('completes the mode argument and the checklist domain', async () => {
    const mode = await conn.client.complete({ ref: { type: 'ref/prompt', name: 'enhance' }, argument: { name: 'mode', value: 'q' } });
    expect(mode.completion.values).toEqual(['quick']);
    const all = await conn.client.complete({ ref: { type: 'ref/prompt', name: 'enhance' }, argument: { name: 'mode', value: '' } });
    expect(all.completion.values).toEqual(['quick', 'standard', 'deep']);
    const domain = await conn.client.complete({
      ref: { type: 'ref/resource', uri: 'prompt-engine://checklists/{domain}' },
      argument: { name: 'domain', value: 'im' },
    });
    expect(domain.completion.values).toEqual(['image-video']);
  });

  it('lists the static resources and every checklist from the template', async () => {
    const { resources } = await conn.client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(
      [
        'prompt-engine://method',
        'prompt-engine://output-format',
        'prompt-engine://questions',
        'prompt-engine://blueprint',
        'prompt-engine://media-targets',
        ...DOMAINS.map((d) => `prompt-engine://checklists/${d}`),
      ].sort(),
    );
    for (const r of resources) expect(r.mimeType, r.uri).toBe('text/markdown');
    expect(resources.some((r) => r.uri.startsWith('skill://'))).toBe(false);
    const { resourceTemplates } = await conn.client.listResourceTemplates();
    expect(resourceTemplates).toEqual([expect.objectContaining({ uriTemplate: 'prompt-engine://checklists/{domain}' })]);
  });

  it('reads static resources and the checklist template', async () => {
    const method = await conn.client.readResource({ uri: 'prompt-engine://method' });
    expect(method.contents[0]).toMatchObject({ uri: 'prompt-engine://method', mimeType: 'text/markdown', text: buildBrief() });
    const format = await conn.client.readResource({ uri: 'prompt-engine://output-format' });
    expect(format.contents[0]).toMatchObject({ text: buildReference('output-format') });
    for (const domain of DOMAINS) {
      const res = await conn.client.readResource({ uri: `prompt-engine://checklists/${domain}` });
      expect(res.contents[0], domain).toMatchObject({ uri: `prompt-engine://checklists/${domain}`, text: buildChecklist(domain) });
    }
  });

  it('rejects an unknown checklist domain with Invalid Params (-32602)', async () => {
    await expect(conn.client.readResource({ uri: 'prompt-engine://checklists/cooking' })).rejects.toMatchObject({ code: -32602 });
  });

  it('serves resources that point to ask_user, never to AskUserQuestion', async () => {
    const { resources } = await conn.client.listResources();
    for (const { uri } of resources) {
      const res = await conn.client.readResource({ uri });
      const text = String((res.contents[0] as { text?: string }).text);
      expect(text, uri).not.toMatch(/AskUserQuestion/);
    }
    // The two adapted references keep none of the dialog's wording.
    const questions = await conn.client.readResource({ uri: 'prompt-engine://questions' });
    expect((questions.contents[0] as { text: string }).text).toMatch(/## Format A — the ask_user tool/);
    expect((questions.contents[0] as { text: string }).text).not.toMatch(/AskUserQuestion|Claude Code|\(Recommended\)|multiSelect/);
    const format = await conn.client.readResource({ uri: 'prompt-engine://output-format' });
    expect((format.contents[0] as { text: string }).text).toMatch(/menu as a numbered list/);
    expect((format.contents[0] as { text: string }).text).not.toMatch(/AskUserQuestion|Claude Code|\(Recommended\)|multiSelect/);
  });

  it('returns the method brief from enhance_prompt without the user prompt', async () => {
    const plain = await conn.client.callTool({ name: 'enhance_prompt', arguments: {} });
    expect(plain.isError).toBeFalsy();
    expect(textOf(plain)).toBe(buildBrief());
    const quick = await conn.client.callTool({ name: 'enhance_prompt', arguments: { mode: 'quick', target: 'Midjourney' } });
    const text = textOf(quick);
    expect(text).toContain('Requested mode: quick —');
    expect(text).toContain('Requested target: Midjourney —');
    expect(text.length).toBeLessThan(RESULT_MAX_CHARS);
    const bad = await conn.client.callTool({ name: 'enhance_prompt', arguments: { mode: 'fast' } });
    expect(bad.isError).toBe(true);
  });

  it('returns a checklist for every domain', async () => {
    for (const domain of DOMAINS) {
      const result = await conn.client.callTool({ name: 'get_checklist', arguments: { domain } });
      expect(result.isError, domain).toBeFalsy();
      expect(textOf(result), domain).toBe(buildChecklist(domain));
      expect(textOf(result).length, domain).toBeLessThan(RESULT_MAX_CHARS);
    }
    const bad = await conn.client.callTool({ name: 'get_checklist', arguments: { domain: 'cooking' } });
    expect(bad.isError).toBe(true);
  });

  it('returns check_prompt results that match the output schema, with a readable mirror', async () => {
    const schema = await outputSchemaOf(conn, 'check_prompt');
    const result = await conn.client.callTool({
      name: 'check_prompt',
      arguments: { prompt: '# Goal\nWrite a blog post for team managers.\nYou MUST use [[company name]].', target: 'ChatGPT' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(schemaErrors(schema, structured)).toBeUndefined();
    expect(structured).toMatchObject({ heuristic: true, target: 'ChatGPT', targetKind: 'text' });
    expect((structured.issues as Array<{ id: string }>).map((i) => i.id)).toEqual(['pressure-words', 'open-placeholder']);
    const text = textOf(result);
    expect(text).toMatch(/heuristic/);
    expect(text).toContain('- Clear goal: found');
  });

  it('rejects invalid ask_user input with a clear message', async () => {
    const dup = await conn.client.callTool({ name: 'ask_user', arguments: { questions: [SAMPLE_QUESTIONS[0], SAMPLE_QUESTIONS[0]] } });
    expect(dup.isError).toBe(true);
    expect(textOf(dup)).toMatch(/used twice/);
    const outOfRange = await conn.client.callTool({
      name: 'ask_user',
      arguments: { questions: [{ id: 'a', question: 'Q?', options: [{ label: 'x' }, { label: 'y' }], recommended: 3, why: 'because' }] },
    });
    expect(outOfRange.isError).toBe(true);
    expect(textOf(outOfRange)).toMatch(/recommended/);
    const longHeader = await conn.client.callTool({
      name: 'ask_user',
      arguments: { questions: [{ ...SAMPLE_QUESTIONS[0], header: 'A very long header' }] },
    });
    expect(longHeader.isError).toBe(true);
    // Every recommendation needs its reason.
    const { why: _why, ...noReason } = SAMPLE_QUESTIONS[0]!;
    const missingWhy = await conn.client.callTool({ name: 'ask_user', arguments: { questions: [noReason] } });
    expect(missingWhy.isError).toBe(true);
    expect(textOf(missingWhy)).toMatch(/why/);
    const blankWhy = await conn.client.callTool({ name: 'ask_user', arguments: { questions: [{ ...SAMPLE_QUESTIONS[0], why: '  ' }] } });
    expect(blankWhy.isError).toBe(true);
    expect(textOf(blankWhy)).toMatch(/give why/);
    // Text the user can't see counts as blank, control characters included.
    const invisibleWhy = await conn.client.callTool({ name: 'ask_user', arguments: { questions: [{ ...SAMPLE_QUESTIONS[0], why: '\u200B\u0001' }] } });
    expect(invisibleWhy.isError).toBe(true);
    expect(textOf(invisibleWhy)).toMatch(/give why/);
    const blankQuestion = await conn.client.callTool({ name: 'ask_user', arguments: { questions: [{ ...SAMPLE_QUESTIONS[0], question: '\u0007 ' }] } });
    expect(blankQuestion.isError).toBe(true);
    expect(textOf(blankQuestion)).toMatch(/give the question text/);
    // A ★ in a label can be content, such as a star rating, so it is rejected rather than removed.
    for (const labels of [['★★★★★', '★★★★☆', '★★★☆☆'], ['5★ hotels', '4★ hotels'], ['Luxury (5★)', 'Mid-range (3★)']]) {
      const stars = await conn.client.callTool({ name: 'ask_user', arguments: { questions: [{ ...SAMPLE_QUESTIONS[0], options: labels.map((label) => ({ label })), recommended: 1 }] } });
      expect(stars.isError, labels[1]).toBe(true);
      expect(textOf(stars), labels[1]).toContain(`option 2 ("${labels[1]}") contains ★; ask_user puts the only ★ on the option that recommended points to`);
    }
    const sameLabel = await conn.client.callTool({ name: 'ask_user', arguments: { questions: [{ ...SAMPLE_QUESTIONS[0], options: [{ label: 'Yes' }, { label: 'Yes ' }], recommended: 1 }] } });
    expect(sameLabel.isError).toBe(true);
    expect(textOf(sameLabel)).toMatch(/option "Yes" appears twice/);
  });

  it('asks in text mode when the client declares no form elicitation', async () => {
    const schema = await outputSchemaOf(conn, 'ask_user');
    const result = await conn.client.callTool(ask);
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(schemaErrors(schema, structured)).toBeUndefined();
    expect(structured.status).toBe('ask_in_chat');
    expect(structured.answers).toBeUndefined();
    expect(structured.questionsText).toContain('b) Team managers ★ (they decide remote-work policy)');
    expect(String(structured.questionsText).endsWith('Anything you skip gets the ★.')).toBe(true);
    expect(textOf(result)).toMatch(/stop and wait/);
    expect(textOf(result)).toMatch(/their language/);
  });

  it('opens the chat text with its own line, not the intro, which is the form\'s message', async () => {
    // Intros models wrote for the form in real runs: in a chat nothing is preselected.
    for (const intro of ['A few quick choices to shape your remote-work blog post prompt. The recommended answers are preselected.', 'Unas preguntas rápidas. Ya están marcadas las respuestas recomendadas.']) {
      const result = await conn.client.callTool({ name: 'ask_user', arguments: { questions: SAMPLE_QUESTIONS, intro } });
      const structured = result.structuredContent as { status: string; questionsText: string };
      expect(structured.status).toBe('ask_in_chat');
      expect(structured.questionsText.split('\n')[0]).toBe(DEFAULT_INTRO);
      expect(textOf(result)).not.toContain(intro);
    }
  });
});

describe('tool result size', () => {
  // Hosts cap tool results (8,000 tokens is a common budget). At a conservative
  // 3 characters per token, every result has to stay under 24,000 characters,
  // counting everything sent: text content and structured content.
  const TOKEN_SAFE_CHARS = 24_000;
  const size = (result: { content?: unknown; structuredContent?: unknown }) =>
    JSON.stringify(result.content ?? []).length + JSON.stringify(result.structuredContent ?? {}).length;
  // How JSON writes a control character or a lone surrogate: 6 characters for 1.
  const SIX_CHARACTER_ESCAPE = /\\u(?:00[01][0-9a-f]|d[89a-f][0-9a-f]{2})/i;

  // The largest ask_user input the schema allows, built from its limits. Each
  // field starts with a character the user can see (a quote, or a digit that
  // keeps the labels unique) and is filled to its limit with quotes, which
  // double when a result is serialized, or with control characters or lone
  // surrogates, which ask_user cleans first because JSON writes each as 6.
  const FILLS = { quotes: '"', 'U+0001': '\u0001', 'lone surrogates': '\uD800' };
  const MAX = ASK_USER_MAX_CHARS;
  const largestAsk = (fill: string) => {
    const field = (max: number, lead = '"') => lead + fill.repeat(max - 1);
    return {
      intro: field(MAX.intro),
      notes_label: field(MAX.notes_label),
      notes_hint: field(MAX.notes_hint),
      questions: Array.from({ length: MAX_QUESTIONS }, (_, i) => ({
        id: `q${i}`.padEnd(MAX.id, 'x'),
        header: field(HEADER_MAX_CHARS),
        question: field(MAX.question),
        options: Array.from({ length: MAX_OPTIONS }, (_, j) => ({ label: field(MAX.label, String(j)), description: field(MAX.description) })),
        recommended: MAX_OPTIONS - 1,
        why: field(MAX.why),
      })),
    };
  };

  // A check_prompt draft past every cap: 4 heading lines per area (3 evidence
  // items are kept) and 5 distinct matches for each of the 7 lint rules (35
  // findings; 20 are kept), each with about 300 fill characters around it.
  const pastEveryCap = (fill: string) => {
    const pad = (n: number) => fill.repeat(n);
    let n = 0;
    const tag = () => `${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[n % 26]}${Math.floor(n++ / 26)}`;
    const lines: string[] = [];
    for (const heading of ['Goal', 'Background', 'Constraints', 'Output', 'Edge cases']) {
      for (let i = 0; i < 4; i++) lines.push(`${heading}: ${tag()}${pad(300)}`);
    }
    const matches = [
      ['MUST', 'NEVER', 'ALWAYS', 'CRITICAL', 'IMPORTANT'],
      ['scratchpad', 'Scratchpad', 'SCRATCHPAD', 'ScratchPad', 'scratchPAD'],
      ['prefill the response', 'prefill your answer', 'prefill an reply', 'prefill the assistant', 'Prefill The Response'],
      ['take a deep breath', 'Take a deep breath', 'think hard', 'Think hard', 'think really hard'],
      ['masterpiece', 'Masterpiece', '8k', 'best quality', 'award-winning'],
    ];
    for (const words of matches) for (const word of words) lines.push(`${pad(40)}${tag()} ${word} ${tag()}${pad(300)}`);
    for (let i = 0; i < 5; i++) lines.push(`${pad(10)}${tag()}{{${tag()}${pad(76)}}}${pad(300)}`);
    for (let i = 0; i < 5; i++) lines.push(`${pad(10)}${tag()}[[${tag()}${pad(116)}]]${pad(300)}`);
    return lines.join('\n');
  };
  const longestLine = (n: number, unit: string) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

  it('stays under the budget for the largest inputs of every tool', async () => {
    const conn = await connectHttp('modern');
    try {
      const prompts = {
        'many findings on many lines': `You MUST [[a]] {{b}} think step by step, masterpiece 8k. ${'x'.repeat(200)}\n`.repeat(400).slice(0, PROMPT_MAX_CHARS),
        'distinct findings, one per line': Array.from({ length: 4000 }, (_, i) => `NEVER ALWAYS [[field ${i} "with quotes" ${'q'.repeat(80)}]] {{v${i} ${'"'.repeat(60)}}} think step by step, take a deep breath, prefill the response, masterpiece`).join('\n').slice(0, PROMPT_MAX_CHARS),
        'long single-line matches': longestLine(PROMPT_MAX_CHARS, `[[${'"long placeholder" '.repeat(6)}]] {{ ${'"'.repeat(78)} }} `),
        'one huge line': longestLine(PROMPT_MAX_CHARS, 'You MUST "quote" audience: managers, if missing ask; format as a table. '),
        'past every cap, with quotes': pastEveryCap('"'),
      };
      const calls: Array<{ label: string; name: string; arguments: Record<string, unknown> }> = [
        { label: 'enhance_prompt', name: 'enhance_prompt', arguments: { mode: 'standard', target: 'x'.repeat(100) } },
        ...DOMAINS.map((domain) => ({ label: `get_checklist ${domain}`, name: 'get_checklist', arguments: { domain } })),
        ...Object.entries(prompts).map(([label, prompt]) => ({ label: `check_prompt: ${label}`, name: 'check_prompt', arguments: { prompt, target: 'x'.repeat(100) } })),
        ...Object.entries(FILLS).map(([label, fill]) => ({ label: `ask_user in text mode, ${label}`, name: 'ask_user', arguments: largestAsk(fill) })),
      ];
      for (const call of calls) {
        const result = await conn.client.callTool(call);
        expect(result.isError, call.label).toBeFalsy();
        expect(size(result), call.label).toBeLessThan(TOKEN_SAFE_CHARS);
        expect(JSON.stringify(result), call.label).not.toMatch(SIX_CHARACTER_ESCAPE);
      }
    } finally {
      await conn.close();
    }
  });

  it('keeps check_prompt to 20 findings, 3 evidence items per area and short excerpts', async () => {
    const conn = await connectHttp('modern');
    try {
      // The caps hold whatever check_prompt does with control characters.
      for (const [label, fill] of [['quotes', '"'], ['U+0001', '\u0001']] as const) {
        const result = await conn.client.callTool({ name: 'check_prompt', arguments: { prompt: pastEveryCap(fill), target: 'x'.repeat(100) } });
        const report = result.structuredContent as { issues: Array<{ excerpt: string }>; dimensions: Array<{ name: string; evidence: string[] }> };
        expect(report.issues, label).toHaveLength(20);
        for (const area of report.dimensions) expect(area.evidence, `${label}: ${area.name}`).toHaveLength(3);
        // 100 characters of the line, with a … at either cut.
        for (const excerpt of [...report.issues.map((i) => i.excerpt), ...report.dimensions.flatMap((d) => d.evidence)]) {
          expect(excerpt.length, `${label}: ${excerpt}`).toBeLessThanOrEqual(102);
        }
      }
    } finally {
      await conn.close();
    }
  });

  // check_prompt turns control characters into spaces and lone surrogates into
  // U+FFFD, so JSON escaping at most doubles what it echoes; without that, these
  // drafts give results of about 44,000 characters.
  it('stays under the budget for check_prompt drafts past every cap made of control characters or lone surrogates', async () => {
    const conn = await connectHttp('modern');
    try {
      for (const fill of ['\u{1}', '\u{D800}']) {
        const result = await conn.client.callTool({ name: 'check_prompt', arguments: { prompt: pastEveryCap(fill), target: 'x'.repeat(100) } });
        expect(result.isError).toBeFalsy();
        expect(size(result)).toBeLessThan(TOKEN_SAFE_CHARS);
        expect(JSON.stringify(result)).not.toMatch(SIX_CHARACTER_ESCAPE);
      }
    } finally {
      await conn.close();
    }
  });

  it('stays under the budget for every form outcome, including long notes', async () => {
    // The client answers with the first option the form shows.
    const accept =
      (notes: string) =>
      (form: ElicitCall): ElicitResult => {
        const choices = Object.entries(form.requestedSchema.properties).flatMap(([id, field]) => (Array.isArray(field.enum) ? [[id, String(field.enum[0])]] : []));
        return { action: 'accept', content: { ...Object.fromEntries(choices), notes } };
      };
    for (const [fillLabel, fill] of Object.entries(FILLS)) {
      const outcomes: Array<[string, ConnectOptions['elicit']]> = [
        ['accept with notes far over the limit', accept(`${'"pasted brief"\n'.repeat(100)}${fill.repeat(4 * NOTES_MAX_CHARS)}`)],
        ['accept with notes at the limit', accept(`"${fill.repeat(NOTES_MAX_CHARS - 1)}`)],
        ['decline', () => ({ action: 'decline' })],
        ['cancel', () => ({ action: 'cancel' })],
      ];
      for (const [outcome, elicit] of outcomes) {
        const label = `${outcome}, ${fillLabel}`;
        const conn = await connectHttp('modern', { elicit });
        try {
          const result = await conn.client.callTool({ name: 'ask_user', arguments: largestAsk(fill) });
          expect(result.isError, label).toBeFalsy();
          expect(size(result), label).toBeLessThan(TOKEN_SAFE_CHARS);
          // Neither the form nor the result carries a character JSON writes as 6.
          expect(JSON.stringify(conn.elicitCalls), label).not.toMatch(SIX_CHARACTER_ESCAPE);
          expect(JSON.stringify(result), label).not.toMatch(SIX_CHARACTER_ESCAPE);
          const notes = (result.structuredContent as { notes?: string }).notes;
          if (notes !== undefined) expect([...notes].length, label).toBeLessThanOrEqual(NOTES_MAX_CHARS);
        } finally {
          await conn.close();
        }
      }
    }
  });
});

describe('ask_user with a client that supports form elicitation', () => {
  const content = { audience: 'Employees', length: 'About 600 words', notes: 'Keep it upbeat' };

  it('modern era: accepts the form and returns the chosen answers', async () => {
    const conn = await connectHttp('modern', { elicit: () => ({ action: 'accept', content }) });
    try {
      const schema = await outputSchemaOf(conn, 'ask_user');
      const result = await conn.client.callTool(ask);
      expect(conn.elicitCalls).toHaveLength(1);
      const form = conn.elicitCalls[0]!.requestedSchema;
      expect(Object.keys(form.properties)).toEqual(['audience', 'length', 'notes']);
      expect(form.properties.audience).toMatchObject({ type: 'string', enum: ['Employees', 'Team managers', 'Job seekers'], default: 'Team managers' });
      expect(form.properties.audience!.description).toContain('Team managers ★ (they decide remote-work policy)');
      expect(form.properties.notes).toMatchObject({ type: 'string', title: 'Anything to add or change?', maxLength: NOTES_MAX_CHARS });
      expect(result.isError).toBeFalsy();
      expect(schemaErrors(schema, result.structuredContent)).toBeUndefined();
      expect(result.structuredContent).toEqual({
        status: 'answered',
        answers: [
          { id: 'audience', answer: 'Employees', source: 'chosen' },
          { id: 'length', answer: 'About 600 words', source: 'chosen' },
        ],
        notes: 'Keep it upbeat',
        next: expect.stringMatching(/Continue: write the enhanced prompt/),
      });
      // A JSON text mirror for clients that read only content.
      const mirror = (result.content as Array<{ type: string; text: string }>)[1]!;
      expect(JSON.parse(mirror.text)).toEqual(result.structuredContent);
    } finally {
      await conn.close();
    }
  });

  it('shows the intro, notes label and notes hint the model passes, in the user\'s language', async () => {
    const conn = await connectHttp('modern', { elicit: () => ({ action: 'accept', content }) });
    try {
      await conn.client.callTool({
        name: 'ask_user',
        arguments: { questions: SAMPLE_QUESTIONS, intro: 'Unas preguntas rápidas.', notes_label: '¿Algo que añadir?', notes_hint: 'Opcional.' },
      });
      expect(conn.elicitCalls[0]!.message).toBe('Unas preguntas rápidas.');
      expect(conn.elicitCalls[0]!.requestedSchema.properties.notes).toMatchObject({ title: '¿Algo que añadir?', description: 'Opcional.' });
    } finally {
      await conn.close();
    }
  });

  it('legacy era over stateless HTTP cannot elicit, so it falls back to text', async () => {
    const conn = await connectHttp('legacy', { elicit: () => ({ action: 'accept', content }) });
    try {
      const result = await conn.client.callTool(ask);
      expect(conn.elicitCalls).toHaveLength(0);
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ status: 'ask_in_chat' });
    } finally {
      await conn.close();
    }
  });

  it('legacy era over a stateful connection elicits through the legacy shim', async () => {
    const conn = await connectStdioInProcess('legacy', { elicit: () => ({ action: 'accept', content: { audience: 'Job seekers', length: 'About 1,200 words' } }) });
    try {
      const result = await conn.client.callTool(ask);
      expect(conn.elicitCalls).toHaveLength(1);
      expect(result.structuredContent).toMatchObject({
        status: 'answered',
        answers: [
          { id: 'audience', answer: 'Job seekers', source: 'chosen' },
          { id: 'length', answer: 'About 1,200 words', source: 'chosen' },
        ],
      });
      expect(result.structuredContent).not.toHaveProperty('notes');
    } finally {
      await conn.close();
    }
  });

  it('modern era over a stateful connection elicits through multi-round-trip results', async () => {
    const conn = await connectStdioInProcess('modern', { elicit: () => ({ action: 'accept', content }) });
    try {
      const result = await conn.client.callTool(ask);
      expect(conn.elicitCalls).toHaveLength(1);
      expect(result.structuredContent).toMatchObject({ status: 'answered', notes: 'Keep it upbeat' });
    } finally {
      await conn.close();
    }
  });

  // Every path that shows a form: the legacy shim (2025 era over a stateful
  // connection), and multi-round-trip results over stdio and HTTP (2026-07-28).
  const FORM_PATHS: Array<[string, (options: ConnectOptions) => Promise<Connected>]> = [
    ['legacy shim on stdio', (options) => connectStdioInProcess('legacy', options)],
    ['modern era on stdio', (options) => connectStdioInProcess('modern', options)],
    ['modern era over HTTP', (options) => connectHttp('modern', options)],
  ];

  for (const [path, connect] of FORM_PATHS) {
    it(`${path}: a declined form returns the ★ answers to list as assumptions`, async () => {
      const conn = await connect({ elicit: () => ({ action: 'decline' }) });
      try {
        const schema = await outputSchemaOf(conn, 'ask_user');
        const result = await conn.client.callTool(ask);
        expect(conn.elicitCalls).toHaveLength(1);
        expect(result.isError).toBeFalsy();
        expect(schemaErrors(schema, result.structuredContent)).toBeUndefined();
        expect(result.structuredContent).toEqual({
          status: 'declined',
          answers: [
            { id: 'audience', answer: 'Team managers', source: 'recommended' },
            { id: 'length', answer: 'About 1,200 words', source: 'recommended' },
          ],
          next: expect.stringMatching(/declined .*list each one under Assumptions/),
        });
      } finally {
        await conn.close();
      }
    });

    it(`${path}: a form closed without answering asks in the chat instead of guessing`, async () => {
      const conn = await connect({ elicit: () => ({ action: 'cancel' }) });
      try {
        const schema = await outputSchemaOf(conn, 'ask_user');
        // A form's intro can say the answers are preselected, which isn't true in the chat.
        const intro = 'Unas preguntas rápidas. Las respuestas recomendadas ya están marcadas.';
        const result = await conn.client.callTool({ name: 'ask_user', arguments: { questions: SAMPLE_QUESTIONS, intro } });
        expect(conn.elicitCalls).toHaveLength(1);
        expect(conn.elicitCalls[0]!.message).toBe(intro);
        expect(result.isError).toBeFalsy();
        expect(schemaErrors(schema, result.structuredContent)).toBeUndefined();
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.status).toBe('ask_in_chat');
        expect(structured.answers).toBeUndefined();
        expect(String(structured.questionsText).split('\n')[0]).toBe(DEFAULT_INTRO);
        expect(structured.questionsText).toContain('b) Team managers ★ (they decide remote-work policy)');
        expect(structured.next).toMatch(/closed the form without answering/);
        expect(structured.next).toMatch(/Don't guess the answers/);
        expect(textOf(result)).toMatch(/stop and wait/);
      } finally {
        await conn.close();
      }
    });

    it(`${path}: notes over the limit are cut`, async () => {
      const conn = await connect({ elicit: () => ({ action: 'accept', content: { audience: 'Employees', length: 'About 600 words', notes: 'pasted brief '.repeat(400) } }) });
      try {
        const result = await conn.client.callTool(ask);
        expect(result.isError).toBeFalsy();
        const structured = result.structuredContent as { status: string; notes: string; next: string };
        expect(structured.status).toBe('answered');
        expect([...structured.notes].length).toBe(NOTES_MAX_CHARS);
        expect(structured.next).toMatch(/cut to 1,000 characters/);
      } finally {
        await conn.close();
      }
    });
  }

  it('takes the ★ a model puts on the recommended label off it, so the form, the text and the answers use the plain label', async () => {
    // Haiku 5.5 did this in a real run, with "Individual remote workers ★" at the recommended index.
    const starred = [
      { ...SAMPLE_QUESTIONS[0]!, options: [{ label: 'Employees' }, { label: 'Team managers ★', description: 'They set policy' }, { label: 'Job seekers' }] },
      { ...SAMPLE_QUESTIONS[1]!, options: [{ label: 'About 600 words' }, { label: '★ About 1,200 words' }, { label: '2,000+ words' }] },
    ];
    const pick = (form: ElicitCall, id: string, i: number) => String((form.requestedSchema.properties[id]!.enum as string[])[i]);
    const conn = await connectHttp('modern', { elicit: (form) => ({ action: 'accept', content: { audience: pick(form, 'audience', 2), length: pick(form, 'length', 1) } }) });
    try {
      const result = await conn.client.callTool({ name: 'ask_user', arguments: { questions: starred } });
      const { audience, length } = conn.elicitCalls[0]!.requestedSchema.properties;
      expect(audience).toMatchObject({ enum: ['Employees', 'Team managers', 'Job seekers'], default: 'Team managers' });
      expect(length).toMatchObject({ enum: ['About 600 words', 'About 1,200 words', '2,000+ words'], default: 'About 1,200 words' });
      for (const field of [audience, length]) expect(String(field!.description).match(/★/g)).toHaveLength(1);
      expect(result.structuredContent).toMatchObject({
        status: 'answered',
        answers: [
          { id: 'audience', answer: 'Job seekers', source: 'chosen' },
          { id: 'length', answer: 'About 1,200 words', source: 'chosen' },
        ],
      });
    } finally {
      await conn.close();
    }
    const text = await connectHttp('modern');
    try {
      const result = await text.client.callTool({ name: 'ask_user', arguments: { questions: starred } });
      const { questionsText } = result.structuredContent as { questionsText: string };
      expect(questionsText).toContain('   a) Employees  b) Team managers ★ (they decide remote-work policy)  c) Job seekers\n');
      expect(questionsText).toContain('   a) About 600 words  b) About 1,200 words ★ (room for examples)  c) 2,000+ words\n');
    } finally {
      await text.close();
    }
  });

  it('2025-era stdio: the capabilities declared at initialize decide, not the 2026 _meta key', async () => {
    // A form client whose key claims nothing still gets the form...
    const form = await connectStdioInProcess('legacy', { elicit: () => ({ action: 'decline' }) });
    try {
      const result = await form.client.callTool({ ...ask, _meta: { [CLIENT_CAPABILITIES_META_KEY]: {} } });
      expect(form.elicitCalls).toHaveLength(1);
      expect(result.structuredContent).toMatchObject({ status: 'declined' });
    } finally {
      await form.close();
    }
    // ...and a client without forms whose key claims one gets the text, not an error.
    const noForm = await connectStdioInProcess('legacy');
    try {
      const result = await noForm.client.callTool({ ...ask, _meta: { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: { form: {} } } } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ status: 'ask_in_chat' });
    } finally {
      await noForm.close();
    }
  });

  it('2025-era request over stateless HTTP: the 2026 _meta key still gets the text, not an error', async () => {
    const handler = createMcpHandler(() => createServer());
    try {
      const response = await handler.fetch(
        new Request('http://test.local/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { ...ask, _meta: { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: { form: {} } } } } }),
        }),
      );
      const body = await response.text();
      // The reply is plain JSON or a server-sent event.
      const json = response.headers.get('content-type')?.startsWith('text/event-stream') ? body.split('\n').filter((l) => l.startsWith('data: ')).at(-1)!.slice(6) : body;
      const { result } = JSON.parse(json) as { result: { isError?: boolean; structuredContent?: Record<string, unknown> } };
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ status: 'ask_in_chat' });
    } finally {
      await handler.close();
    }
  });

  // On a 2025-era stateful connection the server waits for the form's answer;
  // fake timers stand in for a user who takes their time.
  it('legacy shim on stdio: answers to a form left open past the SDK\'s 10-minute default still count', async () => {
    let answer: (result: ElicitResult) => void = () => {};
    const conn = await connectStdioInProcess('legacy', { elicit: () => new Promise<ElicitResult>((resolve) => (answer = resolve)) });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const call = conn.client.callTool(ask, { timeout: 24 * 3_600_000 });
      while (conn.elicitCalls.length === 0) await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      answer({ action: 'accept', content: { audience: 'Job seekers', length: 'About 600 words' } });
      const result = await call;
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ status: 'answered', answers: [{ answer: 'Job seekers', source: 'chosen' }, { answer: 'About 600 words', source: 'chosen' }] });
    } finally {
      vi.useRealTimers();
      await conn.close();
    }
  });

  it('legacy shim on stdio: a form left open past FORM_WAIT_MS fails the call, so the model asks in its reply', async () => {
    const conn = await connectStdioInProcess('legacy', { elicit: () => new Promise<ElicitResult>(() => {}) });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const call = conn.client.callTool(ask, { timeout: 24 * 3_600_000 });
      while (conn.elicitCalls.length === 0) await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(FORM_WAIT_MS + 1_000);
      const result = await call;
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
      await conn.close();
    }
  });

  it('a client that sends invalid form values gets the recommended answers for those questions', async () => {
    const conn = await connectHttp('modern', { elicit: () => ({ action: 'accept', content: { audience: 'Employees' } }) });
    try {
      const result = await conn.client.callTool(ask);
      expect(result.structuredContent).toMatchObject({
        status: 'answered',
        answers: [
          { id: 'audience', answer: 'Employees', source: 'chosen' },
          { id: 'length', answer: 'About 1,200 words', source: 'recommended' },
        ],
        next: expect.stringMatching(/under Assumptions/),
      });
    } finally {
      await conn.close();
    }
  });
});
