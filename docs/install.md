# Install Prompt Engine

Pick the option for the app you use. Installing the same thing in two places makes duplicates: a plugin added on Claude.ai also shows up in Claude Code. Each option says whether its steps were verified against the vendor's docs or tested here; see [compatibility.md](compatibility.md) for details.

- [Claude Code](#claude-code)
- [Claude.ai, Claude Desktop and the Claude mobile apps](#claudeai-claude-desktop-and-the-claude-mobile-apps)
- [Claude API and Claude Agent SDK](#claude-api-and-claude-agent-sdk)
- [Codex, Gemini CLI, GitHub Copilot and other agents that read SKILL.md](#other-agents-that-read-skillmd)
- [ChatGPT, Gemini and other chatbots](#chatgpt-gemini-and-other-chatbots)
- [MCP clients](#mcp-clients)

## Claude Code

Install from the marketplace in this repository:

```text
/plugin marketplace add vipul-goel/prompt-engine
/plugin install prompt-engine@vipul-goel
```

On Claude Code 2.1.275 or later, one command does both:

```text
/plugin install prompt-engine --marketplace vipul-goel/prompt-engine
```

From a shell, the equivalent commands are:

```bash
claude plugin marketplace add vipul-goel/prompt-engine
```

```bash
claude plugin install prompt-engine@vipul-goel
```

Run it with `/prompt-engine:prompt-engine <your prompt>`. The short form `/prompt-engine` also works when no other skill uses that name. You can also just ask: "improve this prompt: …".

- **Updates.** Third-party marketplaces don't auto-update by default. Run `claude plugin update prompt-engine@vipul-goel`, or turn on auto-update in `/plugin` → Marketplaces.
- **Without the plugin system.** Copy [`skills/prompt-engine`](../skills/prompt-engine) to `~/.claude/skills/prompt-engine` (all your projects) or to `.claude/skills/prompt-engine` in one project. The command is then `/prompt-engine`.
- **Whole team.** Add this to the repository's `.claude/settings.json`. After a teammate trusts the folder, the plugin is available to them:

  ```json
  {
    "extraKnownMarketplaces": {
      "vipul-goel": { "source": { "source": "github", "repo": "vipul-goel/prompt-engine" } }
    },
    "enabledPlugins": { "prompt-engine@vipul-goel": true }
  }
  ```

- **Headless use (`claude -p`).** Use the slash command (`claude -p "/prompt-engine:prompt-engine quick: …"`), or allow the Skill and Read tools (`--allowedTools Skill Read`). By default, headless runs deny the skill call that a plain-language request triggers.
- **Questions.** In Claude Code they appear as clickable dialogs, at most four per dialog. The recommended answer comes first, so Enter accepts it.

Status: tested here with Claude Code 2.1.312.

## Claude.ai, Claude Desktop and the Claude mobile apps

You need **Code execution and file creation** turned on (Settings → Capabilities; on Team and Enterprise plans an Owner enables it). Anthropic's pages differ on which plans include custom skills: some list Pro, Max, Team and Enterprise, others also list Free.

**Option A: add the marketplace (recommended, because you get updates).** Go to Customize → Plugins → Add → Add marketplace and enter `https://github.com/vipul-goel/prompt-engine`. Then add the prompt-engine plugin. Plugins added here also appear in Claude Code.

**Option B: upload the skill.** Download `prompt-engine.zip` from the [latest release](https://github.com/vipul-goel/prompt-engine/releases), then go to Customize → Skills → + → Create skill → Upload a skill. To build the zip yourself from a clone, run `node scripts/release.mjs --zip`. The archive must contain the `prompt-engine/` folder at its top level.

Use it by typing `/` in the message box and picking **prompt-engine**, or write "prompt-engine: <your prompt>". Team and Enterprise Owners can add it for everyone under Organization settings → Plugins & skills.

Status: steps verified in Anthropic's docs. They can't be tested from this repository's automation, because a Claude.ai account is needed.

## Claude API and Claude Agent SDK

- **Claude API.** Upload the `skills/prompt-engine` folder (or the release zip) with the Skills API, then attach it to Messages requests through `container.skills` together with the code execution tool. Follow Anthropic's [Skills guide](https://platform.claude.com/docs/en/build-with-claude/skills-guide.md) for the exact request shapes. Pin a skill version in production. The API has no question dialog, so questions arrive as a numbered list.
- **Agent SDK.** Put the folder at `.claude/skills/prompt-engine/` in your project, or at `~/.claude/skills/prompt-engine/`. With the default setting sources the SDK loads both. If you pass your own `tools` list, include `Skill`, plus `AskUserQuestion` if your app handles questions.

Status: verified in Anthropic's docs; not tested here.

## Other agents that read SKILL.md

Many coding agents load the [Agent Skills](https://github.com/agentskills/agentskills) format. The quickest install for most of them, which needs Node.js 22.20 or later, is:

```bash
npx skills add vipul-goel/prompt-engine
```

Add `-a <agent>` to pick an agent, or `-g` to install for your user rather than the project. To install by hand, copy `skills/prompt-engine` into the agent's skills folder:

| Agent | Folder | How to run it | Status |
|---|---|---|---|
| OpenAI Codex | `~/.agents/skills/` (user) or `.agents/skills/` (repo) | `$prompt-engine`, or name it in your message | Verified in Codex's shipped code |
| Gemini CLI | `~/.gemini/skills/` or `~/.agents/skills/` | Ask for it; Gemini activates skills itself after you approve | Verified in Gemini CLI's bundled docs |
| GitHub Copilot (VS Code, CLI) | `~/.copilot/skills/`, `.github/skills/`, `.claude/skills/` or `.agents/skills/` | `/prompt-engine` | Verified in Copilot's shipped code |
| Cline | `~/.cline/skills/` or `.agents/skills/` | `/prompt-engine` | Verified in Cline's shipped code |
| OpenCode, Goose, Mistral Vibe | `.agents/skills/` (see each tool's docs) | Ask for it, or `/prompt-engine` where supported | Verified in each project's docs |
| Cursor, Kiro, Zed, Devin Desktop (formerly Windsurf) | See the tool's docs; `npx skills add` knows the paths | Varies | Not verified here (secondary sources only) |

Codex and GitHub Copilot can also add this repository as a plugin marketplace, because they read `.claude-plugin/marketplace.json`. That path is untested.

## ChatGPT, Gemini and other chatbots

Use the copy-paste prompt. See [universal/README.md](../universal/README.md) for ChatGPT custom GPTs and Projects, Gemini Gems, Microsoft Copilot agents, Claude Projects and any other chat.

## MCP clients

Run the MCP server locally with `npx -y prompt-engine-mcp`, which is available after the first npm release. In Claude Desktop, install the `.mcpb` file from the releases page instead. Configuration for Claude Code, Cursor, VS Code and others, and how to self-host the HTTP version, are in [mcp/README.md](../mcp/README.md).
