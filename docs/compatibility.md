# Compatibility and test status

Last updated: 2026-10-29. Status labels:
- **✓ tested**: exercised by this repository's automation or by hand during development;
- **✓ docs**: confirmed in the vendor's own documentation or shipped code, not tested here;
- **~ secondary**: seen only through search results or third-party tools;
- **? unverified**.

Platforms change quickly. Recheck the secondary and unverified rows before relying on them.

## Surfaces

| Surface | How Prompt Engine runs there | Status | Notes |
|---|---|---|---|
| Claude Code 2.1.312 (interactive) | Plugin skill | ✓ tested | Tested end to end in a clean configuration, with the plugin installed from this repository's marketplace on GitHub. The short `/prompt-engine` command resolves to `/prompt-engine:prompt-engine`. Questions and the "What next?" menu appear as clickable dialogs: up to 4 questions per dialog, the "(Recommended)" option first, then a review screen before submitting. Reference files load without a permission prompt thanks to `allowed-tools: Read`. Nothing runs until you pick from the menu, and "Save to file" writes `prompts/<name>.md` after Claude Code's usual permission prompt. |
| Claude Code (`claude -p`, headless) | Plugin skill | ✓ tested | No question dialog in headless mode, so questions arrive as a numbered list. A plain-language request makes Claude call the Skill tool, which headless mode denies unless you allow it (`--allowedTools Skill Read`); the slash command works without that. |
| Claude Code (`claude plugin eval`) | Plugin skill | ✓ tested | Runs are non-interactive: no question dialog, so the numbered list is used. |
| Claude.ai, Claude Desktop, Claude mobile | Plugin from the marketplace, or skill upload | ✓ docs | Needs "Code execution and file creation". The description-length limit for uploads is being confirmed with a real upload. |
| Claude API (Skills API) | Uploaded skill + code execution tool | ✓ docs | No question dialog; numbered list. |
| Claude Agent SDK | Filesystem skill | ✓ docs | Loads from `.claude/skills/` or `~/.claude/skills/` by default. |
| OpenAI Codex CLI 0.165 | SKILL.md | ✓ docs | Run with `$prompt-engine`. Reading `.claude-plugin` marketplaces is in Codex's code but untested here. |
| Gemini CLI 0.66 | SKILL.md | ✓ docs | Skills are activated by the model after you approve; there is no `/skill` command. |
| GitHub Copilot (VS Code, CLI) | SKILL.md | ✓ docs | `/prompt-engine` runs the skill. |
| Cline, OpenCode, Goose, Mistral Vibe | SKILL.md | ✓ docs | |
| Cursor, Kiro, Zed, Devin Desktop (formerly Windsurf) | SKILL.md | ~ secondary | Paths come from cross-tool installers, not the vendors' docs. |
| ChatGPT, Gemini app, Microsoft Copilot, Perplexity, Grok, Le Chat | Universal prompt | ✓ tested (Claude, tools disabled) / ? in those apps | The two-turn behavior test runs on Claude with all tools disabled. Instruction limits are confirmed only for Microsoft 365 Copilot agents (8,000 characters). A manual check in ChatGPT and Gemini is pending. |
| Cross-agent installer (`npx skills add`, skills 1.7.4) | Copies `skills/prompt-engine` into each agent's folder | ✓ tested | Finds and lists the skill from a clone of this repository. Installing into each agent's folder wasn't tested here. |
| MCP clients | `prompt-engine-mcp` | see [mcp/README.md](../mcp/README.md) | Questions appear as forms where the client supports MCP elicitation (per vendor docs: Claude Code, VS Code, Cursor, Codex); other clients get a numbered list. |

## Behavior evals

Behavior evals use `claude plugin eval` (Claude Sonnet 5.5 as the agent under test, Haiku as the judge), with the plugin and without it. Each case runs once per arm during development.

| Round | Cases | With the skill | Without | Cost |
|---|---|---|---|---|
| 1 (smoke subset) | 6 | 6/6 passed (score 1.00) | mean score 0.56 | $0.72 |
| 1 (follow-ups, with the skill only) | 2 | 2/2 passed | — | $0.20 |
| 2 (save-to-file, with the skill only) | 1 | 1/1 passed | — | $0.10 |

The full-suite results are added here after the final run.

The universal prompt's two-turn test, round 1: 4 cases, 36/36 checks passed, $0.17.

## Trigger tests

These tests check that the skill starts when someone asks for prompt help, and only then. They used 24 requests: 12 that should start it, and 12 near-misses that shouldn't, such as "translate this prompt into French", "run this prompt", "rewrite this paragraph" or "tips for writing prompts".
- **Setup.** Each request ran twice on Claude Sonnet 5.5, in a clean Claude Code configuration where the description competes only with Claude Code's built-in skills. The method is Anthropic's skill-creator description loop, adapted for a 200-character limit and isolated runs.
- **First description:** 21/24 requests handled correctly, with no false starts. It missed "What's missing from this prompt?", "I need a Veo prompt…" and messages starting with `prompt-engine:`.
- **Current description:** 24/24, with no false starts.

The first description included 8 held-out requests that it never saw during tuning, and it passed all 8. With other plugins installed, especially other prompt or image-generation skills, results may differ.

## Known limits

- In the eval runner and in headless runs, the question dialog isn't available, so automated tests exercise the numbered-list path. The dialog path is checked by an interactive smoke test.
- Scores in the output are the model's own coverage check against a fixed rubric. They are not a measurement of output quality.
- Media tool details (flags, versions, limits) change often. Each entry in `data/media-targets.json` carries its own status and last-checked date.
