# Sources

The design follows the platforms' own documentation and the prompting guidance below, checked on 2026-10-29 unless a line gives another date. Image and video tool sources and their individual verification status live in [`data/media-targets.json`](../data/media-targets.json).

## Agent Skills and Claude surfaces
- Agent Skills specification: https://github.com/agentskills/agentskills (docs/specification.mdx)
- Claude Code skills (frontmatter, arguments, locations, portability to claude.ai and the API): https://code.claude.com/docs/en/skills.md
- Agent Skills overview and best practices (Claude platform): https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview.md · https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices.md
- Skills API guide: https://platform.claude.com/docs/en/build-with-claude/skills-guide.md
- Creating and using skills on Claude.ai: https://claude.com/docs/skills/how-to.md · https://support.claude.com/en/articles/12512180-using-skills-in-claude · https://support.claude.com/en/articles/13119606-provision-and-manage-skills-for-your-organization
- The Settings toggle skills need, "Code execution and file creation", called "Create and edit files" in the updated Settings layout (checked on 2026-11-08): https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude · https://support.claude.com/en/articles/12512180-using-skills-in-claude
- Zipping the skill folder in Windows File Explorer, for a skill upload: Microsoft's "Zip and unzip files" page, whose current steps (for Windows 11 and 10) go through Show more options (checked on 2026-11-09), and the same page's Windows 10 steps, where Send to is in the first menu, as archived on 2021-06-09: https://support.microsoft.com/en-us/windows/zip-and-unzip-files-8d28fa72-f2f9-712f-67df-f80cf89fd4e5 · https://web.archive.org/web/20210609202040/https://support.microsoft.com/en-us/windows/zip-and-unzip-files-8d28fa72-f2f9-712f-67df-f80cf89fd4e5
- Plugins on Claude.ai: https://claude.com/docs/plugins/platform-support.md · getting updates with Check for updates or Sync automatically (checked on 2026-11-08): https://claude.com/docs/plugins/overview.md
- Agent SDK skills, the `tools` and `skills` options (checked on 2026-11-08): https://code.claude.com/docs/en/agent-sdk/skills.md · the `skills` option arrived in TypeScript SDK 0.2.120 and Python SDK 0.1.62, per their changelogs: https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md · https://github.com/anthropics/claude-agent-sdk-python/blob/main/CHANGELOG.md
- Anthropic's skill-creator validator: https://github.com/anthropics/skills (skills/skill-creator/scripts/quick_validate.py)

## Claude Code plugins and testing
- Plugin manifest, marketplace, loading, components, publishing and the CLI: https://code.claude.com/docs/en/plugins/manifest-reference.md · https://code.claude.com/docs/en/plugins/marketplace-reference.md · https://code.claude.com/docs/en/plugins/loading.md · https://code.claude.com/docs/en/plugins/components.md · https://code.claude.com/docs/en/plugins/publish.md · https://code.claude.com/docs/en/plugins/cli-reference.md
- Plugin evals: https://code.claude.com/docs/en/plugin-evals.md
- AskUserQuestion: https://code.claude.com/docs/en/agent-sdk/user-input.md
- Hooks (why there's no prompt-rewriting hook): https://code.claude.com/docs/en/hooks

## MCP
- Specification 2026-07-28 changelog: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx
- TypeScript SDK v2: https://github.com/modelcontextprotocol/typescript-sdk (release v2.4.0; docs on serving and protocol versions)
- MCP in Claude Code: https://code.claude.com/docs/en/mcp
- Building connectors for Claude, including MCPB: https://claude.com/docs/connectors/building/index.md · https://claude.com/docs/connectors/building/mcpb.md

## Prompting guidance
- Anthropic, Prompting best practices (checked on 2026-11-08): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Anthropic, refusals (including requests to expose reasoning): https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- Anthropic, per-model prompting pages for Claude Opus 5, Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 (checked on 2026-11-08): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5 · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5 · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5 · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5 · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1
- Claude Code best practices (checked on 2026-11-08): https://code.claude.com/docs/en/best-practices
- Anthropic release notes: the July 17, 2026 entry announces the retirement of the legacy Console Workbench and of the experimental API endpoints for generating, improving and templatizing prompts on August 17, 2026 (checked on 2026-11-08): https://platform.claude.com/docs/en/release-notes/overview#july-17-2026
- OpenAI, prompting guidance (checked on 2026-11-08): the prompt engineering guide https://developers.openai.com/api/docs/guides/prompt-engineering · the latest-model guide https://developers.openai.com/api/docs/guides/latest-model · the GPT-4.1 and GPT-5 prompting guides, which OpenAI now marks as archived: https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide · https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide
- Google, prompt design strategies for the Gemini API (checked on 2026-11-08 and again on 2026-11-09; formerly at ai.google.dev/gemini-api/docs/prompting-strategies): https://aistudio.google.com/docs/prompting-strategies · on 2026-11-09 its example template for Gemini 3 ended with the line `Remember to think step-by-step before answering.`, which the method leaves out (the Gemini note in `references/blueprint.md`), and its section "Enhancing reasoning and planning" said that Gemini 2.5 and 3 models think internally, so it's "generally not necessary to have the model outline, plan, or detail reasoning steps in the returned response itself"

## Other agents (verified in shipped packages or the vendors' docs)
- OpenAI Codex CLI 0.165.0, Gemini CLI 0.66.0, GitHub Copilot language server 1.564.0, Cline core 0.2.0 and Mistral Vibe 3.0.3: the skill folders and rules listed in [install.md](install.md) were read from each package's published docs or code on npm and PyPI.
- Skill folders in the vendors' docs, checked on 2026-11-08: Cursor https://cursor.com/docs/skills · GitHub Copilot https://docs.github.com/en/copilot/concepts/customizations/agent-skills · VS Code https://code.visualstudio.com/docs/agent-customization/agent-skills · OpenAI Codex https://learn.chatgpt.com/docs/build-skills (formerly developers.openai.com/codex/skills) · Gemini CLI https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md · Cline https://docs.cline.bot/customization/skills · OpenCode https://opencode.ai/docs/skills · Goose https://goose-docs.ai/docs/guides/context-engineering/using-skills · Mistral Vibe 3.1.0's README https://pypi.org/project/mistral-vibe/3.1.0/ · Zed https://zed.dev/docs/ai/skills · Devin Desktop https://docs.devin.ai/desktop/devin-local/customizations (formerly docs.windsurf.com/windsurf/cascade/skills) · Kiro https://kiro.dev/docs/skills
- Cline's code at release v4.1.26, for the `.agents/skills/` folders its docs don't list (checked on 2026-11-08): https://github.com/cline/cline/blob/v4.1.26/apps/vscode/src/core/storage/skill-directories.ts
- Cross-tool installer: the `skills` package on npm (1.7.4). How `npx skills add` picks agents, for [Install it once](install.md#install-it-once), was read in 1.7.6's code on 2026-11-08.
