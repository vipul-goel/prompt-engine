// The check pack-mcpb.mjs runs on the server it starts from the packed .mcpb bundle. The
// bundle's server/index.js is esbuild output, not dist/, so the tests, the Inspector gates and
// test:pack never run its code: this check is the only one that does. Listing the tools only
// proves the server starts, so it also calls each tool, which runs the bundled handlers, the
// argument parsing and, for check_prompt and ask_user, the structured result the server checks
// against its output schema. ask_user also runs the question checks, the reading of the
// client's capabilities and, since this client can't show forms, the questions written out for
// the chat.

/**
 * Checks the server a connected MCP client talks to against manifest.json: its tools are
 * exactly the manifest's, it lists no prompt the manifest doesn't cover, and each tool answers.
 * Throws an Error that says what is wrong; returns a one-line summary.
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
  if (brief.isError || !/^Prompt Engine brief from the prompt-engine MCP server\b[^]*\nRequested mode: quick\b/.test(briefText)) {
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
  return `the packed server starts, lists: ${names}; prompts: ${prompts.map((p) => p.name).join(', ') || 'none'}; and answers get_checklist, check_prompt, enhance_prompt and ask_user`;
}
