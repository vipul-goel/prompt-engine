# Changelog

Notable changes to Prompt Engine. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). One version number covers the skill, the plugin, the universal prompt and the MCP server.

## [Unreleased]

### Changed
- **MCP over HTTP has limits.** Bodies are capped at 1,500,000 bytes (`413`), in the CLI and the Worker. In the CLI, headers must arrive within 10 seconds and a whole request within 30 (`408`), at most 128 requests are handled at once (`503` past that), and at most 1,024 connections are open.
- **Host allowlists** (`--allowed-hosts`, `PROMPT_ENGINE_ALLOWED_HOSTS`, `ALLOWED_HOSTS`) take a pasted URL's hostname, match other spellings of the same name, and ignore entries that name no hostname, wildcards included, with a warning.
- **`ask_user`** waits up to an hour for a form on a 2025-era stdio connection, instead of the SDK's 10 minutes. It takes a model's ★ off the recommended label. It rejects a label with any other ★, a question, reason or label with nothing visible, and two labels that look the same. Questions asked in the chat open with their own line, not the form's intro.
- **`check_prompt`** judges language without code and URLs and also recognizes Tagalog, Swahili and Romanized Hindi. Output format counts more ways of asking for JSON and similar formats, and no longer counts phrases such as "build a JSON parser".
- Tool descriptions are at most 1,024 characters.

### Fixed
- **MCP over HTTP:** a `Host` header that doesn't parse gets `403`, and `TRACE` gets `405`, instead of `500` and a log line. A request refused for its `Host`, `Origin` or method is answered before its body is read.
- **MCP logging:** log lines no longer carry control characters or text from notifications the server drops, and a slow stdio reader no longer makes Node print a warning.
- **`check_prompt`:** a lint rule that could match the empty string, backtrack too much or look past a window's overlap is skipped, instead of stalling the server or missing matches. Long lines match correctly at window edges and around emoji, and excerpts never split a surrogate pair. Control characters and unpaired surrogates come back as spaces and U+FFFD, so results stay under 24,000 characters.
- **`ask_user`** reads a 2025-era client's form support from what it declared at initialize, and returns control characters and unpaired surrogates as spaces and U+FFFD too.
- **Served references:** the maintainer footer is gone from the media-targets resource and the image-video checklist, and the questions resource asks for `intro`, `notes_label` and `notes_hint` in the user's language.
- `npm run pack:mcpb` fails unless the bundle ships a 512×512 icon.

## [0.1.0] - not yet released

First version.

### Added
- **Agent Skill `prompt-engine`.** Turns a rough prompt into a detailed one:
  - asks up to 8 multiple-choice questions, each with a ★ recommended answer, and only when the answer changes the prompt;
  - `quick:` skips the questions and `deep:` adds rounds;
  - `ok` accepts every ★, and `2b 4: your own text` overrides some answers;
  - writes the full prompt, a short version, what was added and why, the assumptions, a before/after score and a "What next?" menu (run it, refine it, or save it in Claude Code);
  - domain checklists for coding agents, writing and marketing, research and analysis, and image and video generation, plus a general fallback;
  - image and video prompts come out in the target tool's own syntax, with each tool's verification status in `data/media-targets.json`;
  - never invents facts: unknowns become `[[placeholders]]` and choices it made become numbered assumptions.
- **Claude Code plugin and marketplace** (`prompt-engine@vipul-goel`). In Claude Code, questions and the menu appear as clickable dialogs.
- **Universal copy-paste prompt** for ChatGPT, Gemini and other chatbots (`universal/prompt-engine.md`, under 7,500 characters), with an optional knowledge file.
- **MCP server** `prompt-engine-mcp`: serves the method, checklists and a deterministic prompt check to any MCP client, and asks questions as forms where the client supports elicitation. It makes no model calls and needs no API key. Runs over stdio, over HTTP, or as a Claude Desktop `.mcpb` bundle.
- **Checks and tests**:
  - a zero-dependency build and validator with mutation tests;
  - 17 behavior eval cases for `claude plugin eval`;
  - trigger tests for the skill description (24 requests, half of them near-misses);
  - a two-turn test of the universal prompt;
  - MCP server tests;
  - CI, release and monthly data re-verification workflows.

