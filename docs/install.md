# Install Prompt Engine

Steps checked against the vendors' docs on 2026-11-08. Apps rename menus, so if a label differs, look for the closest match.

Pick one option for the app you use. Some options reach more than one app, so a second install can give you two copies (see [Install it once](#install-it-once)). Each option says whether its steps were verified against the vendor's docs or tested here; see [compatibility.md](compatibility.md) for details.

- [Claude Code](#claude-code)
- [Claude.ai, Claude Desktop and the Claude mobile apps](#claudeai-claude-desktop-and-the-claude-mobile-apps)
- [Claude API and Claude Agent SDK](#claude-api-and-claude-agent-sdk)
- [Codex, Gemini CLI, GitHub Copilot, Cursor and other agents that read SKILL.md](#other-agents-that-read-skillmd)
- [ChatGPT, Gemini and other chatbots](#chatgpt-gemini-and-other-chatbots)
- [MCP clients](#mcp-clients)
- [Install it once](#install-it-once)

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

You need **Code execution and file creation** turned on (Settings → Capabilities; called **Create and edit files** in the updated Settings layout; on Team and Enterprise plans an Owner controls it). Anthropic's pages differ on which plans include custom skills: some list Pro, Max, Ultra, Team and Enterprise, others also list Free.

**Option A: add the marketplace (recommended, because you get updates).** Go to Customize → Plugins → Add → Add marketplace and enter `https://github.com/vipul-goel/prompt-engine`. Then add the prompt-engine plugin. Plugins added here also appear in Claude Code (see [Install it once](#install-it-once)). To get a new version, select **Check for updates** on the marketplace in Customize → Plugins. claude.com's docs also describe **Sync automatically** for marketplaces added from github.com; whether it picks up this repository's pushes wasn't tested here.

**Option B: upload the skill.** Download `prompt-engine.zip` from the [latest release](https://github.com/vipul-goel/prompt-engine/releases), then go to Customize → Skills → + → Create skill → Upload a skill. To check a download, put it next to `SHA256SUMS` from the same release and run `shasum -a 256 -c --ignore-missing SHA256SUMS` (or `sha256sum -c --ignore-missing SHA256SUMS`).

To build the zip yourself from a clone, run `node scripts/release.mjs --zip`. It needs Node.js 22.19 or later and the `zip` and `unzip` commands: macOS includes them; on Linux, install the zip and unzip packages if they're missing. On Windows, or without a clone, zip the `skills/prompt-engine` folder yourself: right-click it, then Show more options → Send to → Compressed (zipped) folder (on Windows 10, Send to is in the first menu); not tested here. Either way, the archive must contain the `prompt-engine/` folder at its top level.

Use it by typing `/` in the message box and picking **prompt-engine**, or write "prompt-engine: <your prompt>". Team and Enterprise Owners can add it for everyone under Organization settings → Plugins & skills.

Status: steps verified in Anthropic's docs. They can't be tested from this repository's automation, because a Claude.ai account is needed.

## Claude API and Claude Agent SDK

- **Claude API.** Upload the `skills/prompt-engine` folder (or the release zip) with the Skills API, then attach it to Messages requests through `container.skills` together with the code execution tool. Follow Anthropic's [Skills guide](https://platform.claude.com/docs/en/build-with-claude/skills-guide.md) for the exact request shapes. Pin a skill version in production. The API has no question dialog, so questions arrive as a numbered list.
- **Agent SDK.** Put the folder at `.claude/skills/prompt-engine/` in your project, or at `~/.claude/skills/prompt-engine/`. With the default setting sources the SDK loads both. If you pass your own `tools` list, include `Skill` and `Read` (the skill reads its reference files with Read), plus `AskUserQuestion` if your app handles questions and `Write` if you want it to offer Save to file. Setting the `skills` option to `['prompt-engine']` pre-approves the skill call and lets Claude invoke only that skill; `'all'` keeps your other skills. The option needs TypeScript SDK 0.2.120 or later, or Python SDK 0.1.62 or later.

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
| GitHub Copilot (VS Code, CLI) | `~/.copilot/skills/` or `~/.agents/skills/` (user); `.github/skills/`, `.claude/skills/` or `.agents/skills/` (repo) | `/prompt-engine` | Verified in GitHub's docs and Copilot's shipped code |
| Cursor | `~/.agents/skills/` or `~/.cursor/skills/` (user); `.agents/skills/` or `.cursor/skills/` (repo) | `/prompt-engine` in Agent chat, or ask for it | Verified in Cursor's docs |
| Cline | `~/.cline/skills/` or `~/.agents/skills/` (user); `.cline/skills/` or `.agents/skills/` (repo) | `/prompt-engine` | Verified in Cline's code (release v4.1.26); its docs list only the `.cline`, `.clinerules` and `.claude` folders |
| OpenCode | `~/.agents/skills/` (user) or `.agents/skills/` (repo) | Ask for it | Verified in OpenCode's docs |
| Goose | `~/.agents/skills/` (user) or `.agents/skills/` (repo) | Ask for it, or `/skills prompt-engine` in the CLI | Verified in Goose's docs |
| Mistral Vibe | `~/.agents/skills/` (user) or `.agents/skills/` (repo, read only in folders you trust) | `/prompt-engine`, or ask for it | Verified in Mistral Vibe's README (3.1.0) |
| Zed | `~/.agents/skills/` (user) or `.agents/skills/` (repo, read only in projects you trust) | `/prompt-engine`, or ask for it | Verified in Zed's docs |
| Devin Desktop (formerly Windsurf) | `~/.config/devin/skills/` or `~/.agents/skills/` (user); `.devin/skills/` or `.agents/skills/` (repo) | `/prompt-engine`, or ask for it | Verified in Devin's docs |
| Kiro | `~/.kiro/skills/` (user) or `.kiro/skills/` (repo); its docs don't list `.agents/skills/` | `/prompt-engine`, or ask for it | Verified in Kiro's docs |

Codex and GitHub Copilot can also add this repository as a plugin marketplace, because they read `.claude-plugin/marketplace.json`. That path is untested.

## ChatGPT, Gemini and other chatbots

Use the copy-paste prompt. See [universal/README.md](../universal/README.md) for ChatGPT custom GPTs and Projects, Gemini Gems, Microsoft Copilot agents, Claude Projects and any other chat.

## MCP clients

Run the MCP server locally with `npx -y prompt-engine-mcp`, which is available after the first npm release. In Claude Desktop, install the `.mcpb` file from the releases page instead (not yet tested in Claude Desktop). Configuration for Claude Code, Cursor, VS Code and others, and how to self-host the HTTP version, are in [mcp/README.md](../mcp/README.md).

## Install it once

Some options reach more than one app, so a second install can give you two copies:
- **The Claude.ai plugin and the Claude Code plugin.** A plugin you add on Claude.ai also loads in Claude Code as `prompt-engine@synced` when you sign in there with that Claude.ai account (Claude Code 2.1.273 or later). If you also installed `prompt-engine@vipul-goel`, Claude Code loads that copy and reports the Claude.ai copy as not loaded. To use the Claude.ai copy instead, disable yours with `claude plugin disable prompt-engine@vipul-goel`.
- **The skill zip.** A skill you upload on Claude.ai also loads in Claude Code when you sign in there with that account (Claude Code 2.1.273 or later), next to the plugin's skill rather than in place of it. Use the plugin or the zip, not both. To drop the zip's copy, turn the skill off or delete it in Customize → Skills on Claude.ai.
- **Claude Desktop.** The plugin and the `.mcpb` bundle each bring the method to Claude Desktop. Pick one. To drop the plugin, turn it off or remove it in Customize → Plugins; an installed bundle is listed under Settings → Extensions.
- **Copied folders.** Cursor, OpenCode, Goose and GitHub Copilot's local sessions in VS Code read Claude Code's skill folders, `~/.claude/skills/` and `.claude/skills/`, as well as `~/.agents/skills/` and `.agents/skills/`. If you copied the skill into one of these, don't copy it into another; to drop an extra copy, delete its `prompt-engine` folder. Claude Code loads a copy in `~/.claude/skills/` or `.claude/skills/` next to the plugin's skill, so if you use the plugin, put the other agents' copy in `~/.agents/skills/`, which isn't one of Claude Code's skill folders.
- **`npx skills add`.** It counts Claude Code as installed when `~/.claude` exists, and it picks the agents without asking when it finds only one, or when you pass `-y`. If you use the plugin in Claude Code, name the agents you want with `-a`, for example `npx skills add vipul-goel/prompt-engine -a codex`. To drop a copy it put in Claude Code's folder, run `npx skills remove prompt-engine -a claude-code`, adding `-g` if you installed it for your user rather than the project.

Status: checked on 2026-11-09 against Claude Code's plugin and skills docs, claude.com's plugin and desktop-extension docs, the Claude Help Center, the skills docs of Cursor, VS Code, OpenCode and Goose, and the code and docs of the `skills` package 1.7.6; not tested here.
