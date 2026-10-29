# Sources

The design follows the platforms' own documentation and the prompting guidance below, checked on 2026-10-29. Image and video tool sources and their individual verification status live in [`data/media-targets.json`](../data/media-targets.json).

## Agent Skills and Claude surfaces
- Agent Skills specification: https://github.com/agentskills/agentskills (docs/specification.mdx)
- Claude Code skills (frontmatter, arguments, locations, portability to claude.ai and the API): https://code.claude.com/docs/en/skills.md
- Agent Skills overview and best practices (Claude platform): https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview.md · https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices.md
- Skills API guide: https://platform.claude.com/docs/en/build-with-claude/skills-guide.md
- Creating and using skills on Claude.ai: https://claude.com/docs/skills/how-to.md · https://support.claude.com/en/articles/12512180-using-skills-in-claude · https://support.claude.com/en/articles/13119606-provision-and-manage-skills-for-your-organization
- Plugins on Claude.ai: https://claude.com/docs/plugins/platform-support.md
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
- Anthropic, Prompting best practices: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Anthropic, refusals (including requests to expose reasoning): https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- Anthropic, per-model prompting pages, for example https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
- Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Anthropic release notes (retirement of the Console prompt tools, Aug 2026): https://platform.claude.com/docs/en/release-notes/overview
- OpenAI GPT-4.1 prompting guide: https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide. Newer OpenAI and Google guidance was seen only through search results.

## Other agents (verified in shipped packages)
- OpenAI Codex CLI 0.165.0, Gemini CLI 0.66.0, GitHub Copilot language server 1.564.0, Cline core 0.2.0 and Mistral Vibe 3.0.3: the skill folders and rules listed in [install.md](install.md) were read from each package's published docs or code on npm and PyPI.
- Cross-tool installer: the `skills` package on npm (1.7.4).
