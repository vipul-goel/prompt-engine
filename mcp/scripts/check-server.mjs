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

/** Runs one request; an error says which. */
async function step(label, request) {
  try {
    return await request();
  } catch (error) {
    throw new Error(`the packed server's ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const BRIEF = /^Prompt Engine brief from the prompt-engine MCP server\b/;

/**
 * Checks the server a connected MCP client talks to against manifest.json: its tools are
 * exactly the manifest's, it lists no prompt the manifest doesn't cover, each tool answers, and
 * so do the enhance prompt, the completions and the resources. Throws an Error that says what is
 * wrong; returns a one-line summary.
 */
export async function checkServer(client, manifest) {
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
  const shown = (result) => JSON.stringify(result).slice(0, 300);
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
  return (
    `the packed server starts, lists: ${names}; prompts: ${prompts.map((p) => p.name).join(', ') || 'none'}; ` +
    "and answers get_checklist, check_prompt, enhance_prompt and ask_user, the enhance prompt, completions of its mode and of a checklist's domain, " +
    'resources/list, and reads of prompt-engine://method, prompt-engine://questions and prompt-engine://checklists/coding'
  );
}
