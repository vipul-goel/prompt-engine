# Compatibility and test status

Last updated: 2026-11-08. Status labels:
- **✓ tested**: exercised by this repository's automation or by hand during development;
- **✓ docs**: confirmed in the vendor's own documentation or shipped code, not tested here;
- **~ secondary**: seen only through search results or third-party tools;
- **? unverified**.

Platforms change quickly. Recheck the secondary and unverified rows before relying on them.

## Surfaces

| Surface | How Prompt Engine runs there | Status | Notes |
|---|---|---|---|
| Claude Code 2.1.312 (interactive) | Plugin skill | ✓ tested | Checked by hand on 2026-10-29 in a clean configuration, with the plugin installed from this repository's GitHub marketplace on the development branch, at commit 55a5b2b or earlier. The skill's dialog, menu and save instructions have changed since, starting with 998e0c8. The short `/prompt-engine` command resolves to `/prompt-engine:prompt-engine`. Questions and the "What next?" menu appear as clickable dialogs: up to 4 questions per dialog, the "(Recommended)" option first, then a review screen before submitting. Reference files load without a permission prompt thanks to `allowed-tools: Read`. Nothing runs until you pick from the menu, and "Save to file" writes `prompts/<name>.md` after Claude Code's usual permission prompt. |
| Claude Code (`claude -p`, headless) | Plugin skill | ✓ tested | No question dialog in headless mode, so questions arrive as a numbered list. A plain-language request makes Claude call the Skill tool, which headless mode denies unless you allow it (`--allowedTools Skill Read`); the slash command works without that. |
| Claude Code (`claude plugin eval`) | Plugin skill | ✓ tested | Runs are non-interactive: no question dialog, so the numbered list is used. |
| Claude.ai, Claude Desktop, Claude mobile | Plugin from the marketplace, or skill upload | ✓ docs | Needs "Code execution and file creation" ("Create and edit files" in the updated Settings layout). The description-length limit for uploads is being confirmed with a real upload. |
| Claude API (Skills API) | Uploaded skill + code execution tool | ✓ docs | No question dialog; numbered list. |
| Claude Agent SDK | Filesystem skill | ✓ docs | Loads from `.claude/skills/` or `~/.claude/skills/` by default. |
| OpenAI Codex CLI 0.165 | SKILL.md | ✓ docs | Run with `$prompt-engine`. Reading `.claude-plugin` marketplaces is in Codex's code but untested here. |
| Gemini CLI 0.66 | SKILL.md | ✓ docs | Skills are activated by the model after you approve; there is no `/skill` command. |
| GitHub Copilot (VS Code, CLI) | SKILL.md | ✓ docs | `/prompt-engine` runs the skill. |
| Cursor, Cline, OpenCode, Goose, Mistral Vibe, Zed, Devin Desktop (formerly Windsurf), Kiro | SKILL.md | ✓ docs | Skill folders checked on 2026-11-08 in each vendor's docs, and for Cline's `.agents/skills/` folders, which its docs don't list, in its code. Kiro's docs list only its own `.kiro/skills/` folders. See [install.md](install.md#other-agents-that-read-skillmd). |
| ChatGPT, Gemini app, Microsoft Copilot, Perplexity, Grok, Le Chat | Universal prompt | ✓ tested (on Claude, without tools) / ? in those apps | The conversation test runs the prompt on Claude through `claude -p`, with no tools or MCP servers loaded; a turn fails if any loads. Its last recorded run predates the current prompt (see [Behavior evals](#behavior-evals)). Instruction limits are confirmed only for Microsoft 365 Copilot agents (8,000 characters). A manual check in ChatGPT and Gemini is pending. |
| Cross-agent installer (`npx skills add`, skills 1.7.4) | Copies `skills/prompt-engine` into each agent's folder | ✓ tested | Finds and lists the skill from a clone of this repository. Installing into each agent's folder wasn't tested here. |
| Claude Desktop (`.mcpb` from a release) | MCP bundle | ? unverified | Checked in CI: `npm run pack:mcpb` starts the packed server under Node, as its `manifest.json` describes, and checks that it lists the manifest's tools. Untested: installing it in Claude Desktop, running it on Claude Desktop's built-in Node, whether `ask_user`'s form appears, and whether the `enhance` prompt attaches from the + menu. See [manual-checks.md](manual-checks.md#claude-desktop-with-the-mcp-bundle). |
| MCP clients | `prompt-engine-mcp` | see [mcp/README.md](../mcp/README.md) | Questions appear as forms where the client supports MCP elicitation (per vendor docs: Claude Code, VS Code, Cursor, Codex); other clients get a numbered list. |

## Behavior evals

Behavior evals use `claude plugin eval`, with the plugin and without it. Each case's `prompt.md` pins Claude Sonnet 5.5 as the agent under test, and the eval commands in [CONTRIBUTING.md](../CONTRIBUTING.md) and the evals workflow pin `claude-haiku-5-5` as the judge. The rounds below ran on 2026-10-29, before those pins: they used a Haiku judge (the CLI's default judge; which version wasn't recorded), and their agent model wasn't recorded.

Each case runs once per arm during development, so one result can pass or fail by chance. `followup-ok-accepts-recommendations` passed on 2026-11-03 and failed on 2026-11-04 with the same fixture, grader and skill text, though on Claude Code 2.1.317 and then 2.1.318 and with an unpinned judge, so that pair can't separate chance from those changes. Within a single run, the three judge votes on one of `video-veo-quick`'s checks split 2-1. A failing case is re-checked at three runs before it's recorded.

In two-arm runs, `claude plugin eval` leaves the checks that the skill started (`tool_used` on Skill) out of the score unless they set `arm: both`; without the plugin, the skill can't start, so those checks would fail by design. The evals workflow fails a run when one of those unscored checks fails. The trigger cases set `arm: both`, so `trigger-natural-phrasing`, which expects the skill to start, fails its run without the plugin by design (it scores 0.5 when its other check passes). Its result without the plugin, and the mean difference between the arms, can't be compared with rounds 1 and 2. The three cases that resume a recorded conversation run with the plugin only.

| Round | Cases | With the skill | Without | Cost |
|---|---|---|---|---|
| 1 (smoke subset) | 6 | 6/6 passed (score 1.00) | mean score 0.56 | $0.72 |
| 1 (follow-ups, with the skill only) | 2 | 2/2 passed | — | $0.20 |
| 2 (save-to-file, with the skill only) | 1 | 1/1 passed | — | $0.10 |
| 2 (full suite) | 17 | 14/17 passed (mean score 0.94) | 6/14 passed (mean score 0.65) | $2.04 |
| 2 (re-run after fixes) | 5 | 5/5 passed | — | $0.69 |

Round 2's three failures and their fixes:
- **Research prompt.** The output was right, but after writing it the model looked for the question-dialog tool, which headless runs don't have. It then sent the "What next?" menu as a separate last message. `claude -p` prints only the last message, so headless users would have seen the menu without the prompt. The skill now uses the text format straight away when the dialog tool isn't loaded, and keeps the menu in the same message as the output.
- **Partial answers to the questions.** The recorded first turn carried an older copy of the output rules, so the model listed skipped ★ answers as assumptions and reworded one of them. The build now keeps the skill text and reference files inside recorded conversations current. The skill also now says to use accepted ★ answers as offered.
- **Secret redaction.** The skill replaced the API key with an `OPENAI_API_KEY` environment variable and told the user to rotate the key, but the grader accepted only a `[[placeholder]]`. The grader now accepts either.

The universal prompt's conversation test, round 1 (2026-10-29, before d63abbf changed the universal prompt): 4 cases, 36/36 checks passed, $0.17. That version of the test turned off Claude Code's built-in tools with `--tools ""`, but didn't keep MCP servers out or check what loaded.

## Trigger tests

These tests check that the skill starts when someone asks for prompt help, and only then. They were run as a one-off during development, and the request set isn't in the repository. They used 24 requests: 12 that should start it, and 12 near-misses that shouldn't, such as "translate this prompt into French", "run this prompt", "rewrite this paragraph" or "tips for writing prompts".
- **Setup.** Each request ran twice on Claude Sonnet 5.5, in a clean Claude Code configuration where the description competes only with Claude Code's built-in skills. The method is Anthropic's skill-creator description loop, adapted for a 200-character limit and isolated runs.
- **First description:** 21/24 requests handled correctly, with no false starts. It missed "What's missing from this prompt?", "I need a Veo prompt…" and messages starting with `prompt-engine:`.
- **Current description:** 24/24, with no false starts.

Tuning held out 8 of the 24 requests. Both descriptions passed all 8, so the held-out set doesn't show the current description doing better on requests the tuning didn't use. With other plugins installed, especially other prompt or image-generation skills, results may differ.

## Known limits

- In the eval runner and in headless runs, the question dialog isn't available, so automated tests exercise the numbered-list path. The dialog path is checked by an interactive smoke test.
- Scores in the output are the model's own coverage check against a fixed rubric. They are not a measurement of output quality.
- Media tool details (flags, versions, limits) change often. Each entry in `data/media-targets.json` carries its own status and last-checked date.
- **Files in the plugin's folder can load as project memory.** On 2026-11-07, with Claude Code 2.1.319, a session started in a folder that held a plugin cache loaded the cached plugin's `.claude/CLAUDE.md` (this repository's maintainer notes) as project memory once the skill read one of its reference files, and the model received the file's text. In that run the cache sat in a separate configuration folder; a session started in the home folder, whose own `~/.claude` holds the cache, wasn't run.
