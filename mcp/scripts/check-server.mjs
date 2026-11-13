// The check pack-mcpb.mjs runs on the server it starts from the packed .mcpb bundle. The
// bundle's server/index.js is esbuild output, not dist/, so the tests, the Inspector gates and
// test:pack never run its code: this check is the only one that does. Listing the tools only
// proves the server starts, so it also calls each tool, which runs the bundled handlers, the
// argument parsing and, for check_prompt and ask_user, the structured result the server checks
// against its output schema. ask_user also runs the question checks, the reading of the
// client's capabilities and, since this client can't show forms, the questions written out for
// the chat. Then it fetches the enhance prompt, which manifest.json's prompts_generated lets
// Claude Desktop list, asks for completions of its completable mode argument and of the
// checklist template's domain, lists the resources, which runs the template's list callback, and
// reads three: the method, a reference (questions), and a checklist through the template.
// Last, two more clients, each on a server of its own, call ask_user and answer its form: one on
// the 2025-era protocol, where the server sends elicitation/create, and one that negotiates
// 2026-07-28, which the server must serve (server/discover), and where it returns input_required
// for the client to fill in and send again. That runs the form message and schema and the reading
// of the answers, the path a client that shows forms takes, which the first client never does.

import { Client } from '@modelcontextprotocol/client';

/** Runs one request; an error says which. */
async function step(label, request) {
  try {
    return await request();
  } catch (error) {
    throw new Error(`the packed server's ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const BRIEF = /^Prompt Engine brief from the prompt-engine MCP server\b/;
const shown = (result) => JSON.stringify(result).slice(0, 300);

/** The question ask_user is called with; a form client picks the option that isn't recommended. */
const QUESTION = { id: 'audience', question: 'Who is the prompt for?', options: [{ label: 'Developers' }, { label: 'Everyone' }], recommended: 0, why: 'It is about code.' };

/**
 * Calls ask_user from a client that shows forms, on the protocol era given ('2025' or
 * '2026-07-28'), over a transport from `open`, and checks that the user's pick comes back.
 */
async function checkForm(open, era) {
  const modern = era === '2026-07-28';
  const client = new Client({ name: 'mcpb-check-forms', version: '0.0.0' }, { capabilities: { elicitation: { form: {} } }, ...(modern ? { versionNegotiation: { mode: 'auto' } } : {}) });
  const forms = [];
  client.setRequestHandler('elicitation/create', async (request) => {
    forms.push(request.params);
    return { action: 'accept', content: { [QUESTION.id]: QUESTION.options[1].label } };
  });
  try {
    await step(`connection of a ${era}-era client that shows forms`, () => client.connect(open()));
    const served = client.getProtocolEra() === 'modern' ? '2026-07-28' : '2025';
    if (served !== era) throw new Error(`the packed server serves a client that negotiates the protocol in the ${served} era, not ${era}`);
    const asked = await step(`ask_user with a form (${era} era)`, () => client.callTool({ name: 'ask_user', arguments: { questions: [QUESTION] } }));
    const field = forms[0]?.requestedSchema?.properties?.[QUESTION.id];
    const answered =
      !asked.isError &&
      forms.length === 1 &&
      typeof forms[0].message === 'string' &&
      forms[0].message.trim() !== '' &&
      JSON.stringify(field?.enum) === JSON.stringify(QUESTION.options.map((o) => o.label)) &&
      field?.default === QUESTION.options[0].label &&
      asked.structuredContent?.status === 'answered' &&
      JSON.stringify(asked.structuredContent?.answers) === JSON.stringify([{ id: QUESTION.id, answer: QUESTION.options[1].label, source: 'chosen' }]);
    if (!answered) throw new Error(`the packed server's ask_user with a form (${era} era) returned ${shown(asked)} after ${forms.length} form(s): ${shown(forms)}`);
  } finally {
    // Also after a failed connection, so no server process is left running.
    await client.close().catch(() => {});
  }
}

/**
 * Checks the server a connected MCP client talks to against manifest.json: its tools are
 * exactly the manifest's, it lists no prompt the manifest doesn't cover, each tool answers, and
 * so do the enhance prompt, the completions and the resources. Then `open`, which returns a
 * transport to a new server of the same kind each time it is called, serves the two clients that
 * answer ask_user's form. Throws an Error that says what is wrong; returns a one-line summary.
 */
export async function checkServer(client, manifest, open) {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort().join(', ');
  const declared = manifest.tools.map((t) => t.name).sort().join(', ');
  if (names !== declared) throw new Error(`the packed server lists tools ${names}; manifest.json declares ${declared}`);
  // MCPB reads a missing prompts_generated as false: the bundle has no prompts beyond
  // manifest.prompts. Claude Desktop is reported to refuse a prompt the manifest doesn't
  // declare ("attempted undeclared prompt"); that hasn't been checked here.
  const { prompts } = await client.listPrompts();
  const undeclared = prompts.map((p) => p.name).filter((n) => !(manifest.prompts ?? []).some((p) => p.name === n));
  if (undeclared.length && manifest.prompts_generated !== true) {
    throw new Error(`the packed server lists prompts manifest.json doesn't declare: ${undeclared.join(', ')} (set prompts_generated, or declare them)`);
  }
  // get_checklist answers from the generated content.
  const checklist = await client.callTool({ name: 'get_checklist', arguments: { domain: 'coding' } });
  const checklistText = checklist.content?.[0]?.type === 'text' ? checklist.content[0].text : '';
  if (checklist.isError || !/coding/i.test(checklistText)) throw new Error(`the packed server's get_checklist {domain: "coding"} returned ${shown(checklist)}`);
  // check_prompt returns structured content, which the server checks against its output schema.
  const report = await client.callTool({ name: 'check_prompt', arguments: { prompt: 'Write a haiku about rain.' } });
  if (report.isError || !Array.isArray(report.structuredContent?.dimensions) || !Array.isArray(report.structuredContent?.issues)) {
    throw new Error(`the packed server's check_prompt returned ${shown(report)}`);
  }
  // enhance_prompt answers with the brief for the mode it was given.
  const brief = await client.callTool({ name: 'enhance_prompt', arguments: { mode: 'quick' } });
  const briefText = brief.content?.[0]?.type === 'text' ? brief.content[0].text : '';
  if (brief.isError || !BRIEF.test(briefText) || !/\nRequested mode: quick\b/.test(briefText)) {
    throw new Error(`the packed server's enhance_prompt {mode: "quick"} returned ${shown(brief)}`);
  }
  // ask_user, to a client that can't show a form, returns the questions to ask in the chat.
  const question = 'Who is the prompt for?';
  const asked = await client.callTool({
    name: 'ask_user',
    arguments: { questions: [{ id: 'audience', question, options: [{ label: 'Developers' }, { label: 'Everyone' }], recommended: 0, why: 'It is about code.' }] },
  });
  const { status, questionsText } = asked.structuredContent ?? {};
  if (asked.isError || status !== 'ask_in_chat' || typeof questionsText !== 'string' || !questionsText.includes(question)) {
    throw new Error(`the packed server's ask_user returned ${shown(asked)}`);
  }
  // The enhance prompt answers with the brief for the mode it was given.
  const prompt = await step('enhance prompt {mode: "quick"}', () => client.getPrompt({ name: 'enhance', arguments: { mode: 'quick' } }));
  const promptText = prompt.messages?.[0]?.content?.type === 'text' ? prompt.messages[0].content.text : '';
  if (!BRIEF.test(promptText) || !/\nRequested mode: quick\b/.test(promptText)) {
    throw new Error(`the packed server's enhance prompt {mode: "quick"} returned ${shown(prompt)}`);
  }
  // Completions: the prompt's mode, which needs its completable() wrapper to survive bundling, and
  // the checklist template's domain.
  for (const [label, ref, name, value, values] of [
    ["the enhance prompt's mode", { type: 'ref/prompt', name: 'enhance' }, 'mode', 'q', ['quick']],
    ["the checklist template's domain", { type: 'ref/resource', uri: 'prompt-engine://checklists/{domain}' }, 'domain', 'c', ['coding']],
  ]) {
    const done = await step(`completion/complete of ${label} "${value}"`, () => client.complete({ ref, argument: { name, value } }));
    if (JSON.stringify(done.completion?.values) !== JSON.stringify(values)) {
      throw new Error(`the packed server's completion/complete of ${label} "${value}" returned ${shown(done)}`);
    }
  }
  // resources/list, which runs the checklist template's list callback.
  const { resources } = await step('resources/list', () => client.listResources());
  const listed = (uri) => resources?.find((r) => r.uri === uri);
  const unlisted = ['prompt-engine://method', 'prompt-engine://questions', 'prompt-engine://checklists/coding'].filter((uri) => !listed(uri));
  if (unlisted.length) throw new Error(`the packed server's resources/list doesn't list ${unlisted.join(', ')}: ${shown(resources)}`);
  // Reads of a static resource, the brief; of a reference, which buildReference adapts for MCP and
  // which has its listed title as a heading; and of a checklist, through the template.
  for (const [uri, expected] of [
    ['prompt-engine://method', (text) => BRIEF.test(text)],
    ['prompt-engine://questions', (text) => text.split('\n').includes(`# ${listed('prompt-engine://questions').title}`)],
    ['prompt-engine://checklists/coding', (text) => /coding/i.test(text)],
  ]) {
    const read = await step(`resources/read ${uri}`, () => client.readResource({ uri }));
    const text = read.contents?.[0]?.uri === uri && typeof read.contents[0].text === 'string' ? read.contents[0].text : '';
    if (!expected(text)) throw new Error(`the packed server's resources/read ${uri} returned ${shown(read)}`);
  }
  for (const era of ['2025', '2026-07-28']) await checkForm(open, era);
  return (
    `the packed server starts, lists: ${names}; prompts: ${prompts.map((p) => p.name).join(', ') || 'none'}; ` +
    "and answers get_checklist, check_prompt, enhance_prompt and ask_user, the enhance prompt, completions of its mode and of a checklist's domain, " +
    'resources/list, reads of prompt-engine://method, prompt-engine://questions and prompt-engine://checklists/coding, ' +
    'and ask_user through a form, in the 2025-era and 2026-07-28 protocols'
  );
}
