// In-process integration tests: a real SDK client against createMcpHandler (the
// stateless HTTP entry) in both protocol eras, plus serveStdio over an in-memory
// pipe for the stateful-connection paths.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOMAINS, buildBrief, buildChecklist, buildReference } from '../src/brief.js';
import { VERSION } from '../src/generated/content.js';
import { INSTRUCTIONS, TOOL_NAMES } from '../src/server.js';
import { ERAS, SAMPLE_QUESTIONS, connectHttp, connectStdioInProcess, schemaErrors, textOf, type Connected, type Era } from './helpers.js';

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
      expect(tool.description!.length, tool.name).toBeLessThan(1_500);
      expect(tool.inputSchema.type).toBe('object');
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.ask_user!.outputSchema).toBeDefined();
    expect(byName.check_prompt!.outputSchema).toBeDefined();
    expect(byName.enhance_prompt!.outputSchema).toBeUndefined();
    expect(Object.keys(byName.enhance_prompt!.inputSchema.properties ?? {}).sort()).toEqual(['mode', 'target']);
    expect(byName.enhance_prompt!.inputSchema.required ?? []).toEqual([]);
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

  it('rejects an unknown checklist domain', async () => {
    await expect(conn.client.readResource({ uri: 'prompt-engine://checklists/cooking' })).rejects.toThrow();
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
      arguments: { questions: [{ id: 'a', question: 'Q?', options: [{ label: 'x' }, { label: 'y' }], recommended: 3 }] },
    });
    expect(outOfRange.isError).toBe(true);
    expect(textOf(outOfRange)).toMatch(/recommended/);
    const longHeader = await conn.client.callTool({
      name: 'ask_user',
      arguments: { questions: [{ ...SAMPLE_QUESTIONS[0], header: 'A very long header' }] },
    });
    expect(longHeader.isError).toBe(true);
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
      expect(form.properties.notes).toMatchObject({ type: 'string', title: 'Anything to add or change?' });
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

  for (const action of ['decline', 'cancel'] as const) {
    it(`modern era: ${action} returns the recommended answers to list as assumptions`, async () => {
      const conn = await connectHttp('modern', { elicit: () => ({ action }) });
      try {
        const schema = await outputSchemaOf(conn, 'ask_user');
        const result = await conn.client.callTool(ask);
        expect(conn.elicitCalls).toHaveLength(1);
        expect(schemaErrors(schema, result.structuredContent)).toBeUndefined();
        expect(result.structuredContent).toEqual({
          status: action === 'decline' ? 'declined' : 'cancelled',
          answers: [
            { id: 'audience', answer: 'Team managers', source: 'recommended' },
            { id: 'length', answer: 'About 1,200 words', source: 'recommended' },
          ],
          next: expect.stringMatching(/Assumptions/),
        });
      } finally {
        await conn.close();
      }
    });
  }

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

  it('legacy era over a stateful connection: a declined form returns the recommended answers', async () => {
    const conn = await connectStdioInProcess('legacy', { elicit: () => ({ action: 'decline' }) });
    try {
      const result = await conn.client.callTool(ask);
      expect(result.structuredContent).toMatchObject({ status: 'declined', answers: [{ source: 'recommended' }, { source: 'recommended' }] });
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
