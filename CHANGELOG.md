# Changelog

Notable changes to Prompt Engine. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). One version number covers the skill, the plugin, the universal prompt and the MCP server.

## [Unreleased]

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
- **MCP server** `prompt-engine-mcp`: serves the method, checklists and a deterministic prompt check to any MCP client, and asks questions as forms where the client supports elicitation. It makes no model calls and needs no API key. Runs over stdio, over HTTP, or as a Claude Desktop `.mcpb` bundle. In detail:
  - over HTTP, request bodies are capped at 1,500,000 bytes (`413`), in the CLI and the Cloudflare Worker. In the CLI, headers must arrive within 10 seconds and a whole request within 30 (`408`), at most 128 requests are handled at once (`503` past that), and at most 1,024 connections are open. A request refused for its `Host` or `Origin`, or for a method other than `POST`, `GET`, `DELETE` and `OPTIONS`, is answered before its body is read;
  - `Host` allowlists (`--allowed-hosts`, `PROMPT_ENGINE_ALLOWED_HOSTS`, the Worker's `ALLOWED_HOSTS`) take a pasted URL's hostname and match other spellings of the same name. Entries that name no hostname, wildcard hostnames, `http://*` and `https://*` are ignored, with a warning;
  - `ask_user` waits up to an hour for a form on a 2025-era stdio connection. It adds the ★ itself, and rejects a label with any other ★, a question, reason or label with nothing visible, and two labels in one question that differ only in whitespace, invisible characters or Unicode normalization. Questions asked in the chat open with their own line, not the form's intro;
  - `check_prompt` is a heuristic whose area checks and most lint rules match English only. It judges a draft's language without code and URLs, and reports areas without a match as `unknown` when a draft looks mostly non-English. Output format counts a format word such as JSON only in phrases about the reply, so "build a JSON parser" doesn't count;
  - tool descriptions are at most 1,024 characters.
- **Checks and tests**:
  - a zero-dependency build and validator with mutation tests;
  - 17 behavior eval cases for `claude plugin eval`;
  - trigger tests for the skill description (24 requests, half of them near-misses);
  - a two-turn test of the universal prompt;
  - MCP server tests, and a check that the `.mcpb` bundle ships a 512×512 icon;
  - CI, release and monthly data re-verification workflows.

