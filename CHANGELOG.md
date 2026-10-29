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
- **MCP server** `prompt-engine-mcp`: serves the method, checklists and a deterministic prompt check to any MCP client, and asks questions as forms where the client supports elicitation. It makes no model calls and needs no API key. Runs over stdio, over HTTP, or as a Claude Desktop `.mcpb` bundle.
- **Checks and tests**:
  - a zero-dependency build and validator with mutation tests;
  - 17 behavior eval cases for `claude plugin eval`;
  - trigger tests for the skill description (24 requests, half of them near-misses);
  - a two-turn test of the universal prompt;
  - MCP server tests;
  - CI, release and monthly data re-verification workflows.

