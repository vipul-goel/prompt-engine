// The check pack-mcpb.mjs runs on the server it starts from the packed .mcpb bundle. The
// bundle's server/index.js is esbuild output, not dist/, so the tests, the Inspector gates and
// test:pack never run its code: this check is the only one that does. Listing the tools only
// proves the server starts, so it also calls two tools, which run the bundled handlers, the
// argument parsing and, for check_prompt, the structured result the server checks against its
// output schema.

/**
 * Checks the server a connected MCP client talks to against manifest.json: its tools are
 * exactly the manifest's, it lists no prompt the manifest doesn't cover, and get_checklist and
 * check_prompt answer. Throws an Error that says what is wrong; returns a one-line summary.
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
  return `the packed server starts, lists: ${names}; prompts: ${prompts.map((p) => p.name).join(', ') || 'none'}; and answers get_checklist and check_prompt`;
}
