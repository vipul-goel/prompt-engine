# Architecture

Prompt Engine is one method shipped in four formats. To keep them from drifting apart, the method lives in one hand-edited place, and everything else is either generated from it or checked against a shared contract.

```text
                 hand-edited                                generated or checked
┌──────────────────────────────────────────┐
│ skills/prompt-engine/SKILL.md            │──► the Agent Skill itself (Claude, Codex, Gemini CLI, Copilot…)
│ skills/prompt-engine/references/*.md     │──► the Claude Code / Claude.ai plugin (repo root = plugin root)
│                                          │──► universal/prompt-engine-knowledge.md   (build.mjs)
│                                          │──► mcp/src/generated/content.ts           (build.mjs)
├──────────────────────────────────────────┤
│ universal/prompt-engine.md (compact core)│──► copy-paste prompt; also the base of the MCP brief
├──────────────────────────────────────────┤
│ data/media-targets.json                  │──► references/media-targets.md            (build.mjs)
│ data/contract.json                       │──► checked in SKILL.md, references, universal core (validate.mjs)
│ data/lint-rules.json                     │──► self-lint (validate.mjs) and the MCP check_prompt tool
│                                          │──► evals/*/graders/lint-prompt*.md        (build.mjs)
└──────────────────────────────────────────┘
```

## Pieces

- **The skill** (`skills/prompt-engine/`). `SKILL.md` holds the workflow and the output contract in its first few thousand characters, because Claude Code keeps only the first 5,000 tokens of an invoked skill after compacting a long conversation. Details live in `references/`, which the skill reads in its first turn.
  - Frontmatter uses only portable keys (`name`, `description`, `license`, `allowed-tools`, `metadata`), because Claude.ai and the Skills API reject other keys.
  - `allowed-tools: Read` lets Claude Code read those reference files from the plugin cache without asking for permission.
- **The plugin** (`.claude-plugin/`). The repository root is both the marketplace (`vipul-goel`) and the plugin (`source: "./"`). That's why the root must never contain a `package.json` with a lockfile (Claude Code would run `npm ci` on install), a `bin/` folder (Claude.ai refuses such plugins), `CLAUDE.md`, `.mcp.json` or `commands/`. The MCP server's `package.json` lives in `mcp/`, which the plugin loader doesn't inspect.
- **The universal prompt** (`universal/`). The core is written by hand to fit common instruction limits (7,500 characters or fewer). It mirrors the skill's workflow and output contract, except where it has no room for a rule, such as the one for other people's private details (D46); `docs/compatibility.md` lists the main gaps under Known limits. The contract check and the conversation test catch divergence in what they cover. The knowledge file is generated from the references.
- **The MCP server** (`mcp/`). It never calls a model. It serves the method, the checklists and a deterministic lint, and it asks questions through the client's form UI when the client supports elicitation. The host model does all the writing, so no API key is needed and the main tool never sees the user's prompt.
- **The data** (`data/`):
  - `contract.json` lists the headings, score dimensions, tags, markers, menu items and reply lines every format must contain, and the condition for offering Save to file (a tool that saves files on the user's computer), because no eval checks it in the skill; the wording of the lookup rule (no shell command or subagent until the user picks an option that runs the prompt, D32) in the three method files that state it, because no eval checks that rule; and size budgets.
  - `lint-rules.json` holds the prompt anti-patterns.
  - `media-targets.json` holds image and video tool syntax, each entry with a verification status, sources and a last-checked date.

## Checks

| Command | What it checks |
|---|---|
| `node scripts/build.mjs --check` | Generated files are up to date |
| `node scripts/validate.mjs` | Portable frontmatter (allowed keys, and a small YAML subset that strict YAML parsers and Claude Code read the same way), Claude Code substitution hazards, self-lint, budgets, reference links and `KNOWLEDGE_ORDER`, the output contract, plugin-root hygiene (including files Claude Code can load as project memory), warnings for files Anthropic's plugin directory would hold for a reviewer, manifests and version sync, data files, eval cases (the keys, values and referenced files of `case.yaml`, `prompt.md` and `graders/*.md`, this repo's rules for how the cases run and score, and the recorded conversations, with a scan for private data), generated-file freshness |
| `node --test scripts/test/*.test.mjs` | Script tests, with no model calls: a mutation test for each validator rule, and tests that validate fails when a method file loses the lookup rule or the condition for offering Save to file; tests for `build.mjs`, `version.mjs`, `release.mjs`'s skill zip, the history recorder and its sanitizer, the eval-case checks, the generated lint graders, `universal-test.mjs` and `to-review.mjs`; replays of some cases' regex graders on sample replies, and checks of the wording that some judge rubrics must keep; and timing tests for the lint patterns and some graders |
| `claude plugin validate . --strict` | Claude Code's own manifest and skill checks. CI runs `claude plugin validate . --strict --profile directory`, which also fails when Anthropic's plugin directory would refuse the plugin on a check this command makes, when such a check can't be made, and, with `--strict`, on the profile's warnings |
| `cd mcp && npm test && npm run test:inspector` | MCP server unit, integration (both protocol eras, with and without form elicitation) and end-to-end tests, plus MCP Inspector gates |
| `cd mcp && npm run build && npm run test:pack && npm run pack:mcpb` | The npm package: its tarball's files, an install from it (which needs the npm registry), and that the installed server starts and lists its tools. The `.mcpb` bundle: its icon, its third-party notices, and that its server, started as `manifest.json` describes, lists the manifest's tools. CI runs both on Node 22 and 24, and again on 22.19.0 |
| `claude plugin eval . --runs 1 --max-cost-usd 5 --no-publish --judge-model claude-haiku-5-5 --allow-tools Write Edit --scaffold` | Behavior evals, with and without the plugin (billed model calls). Each case pins its agent model. [CONTRIBUTING.md](../CONTRIBUTING.md#behavior-evals) explains the flags and has the check of the skill-started indicators, which the score leaves out |
| `node scripts/eval/universal-test.mjs` | Conversation test of the universal prompt on Claude, through `claude -p` with no tools or MCP servers loaded; a turn fails if any loads (billed) |
