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
└──────────────────────────────────────────┘
```

## Pieces

- **The skill** (`skills/prompt-engine/`). `SKILL.md` holds the workflow and the output contract in its first few thousand characters, because Claude Code keeps only about the first 5,000 tokens of an invoked skill after compacting a long conversation. Details live in `references/`, which the skill reads in its first turn.
  - Frontmatter uses only portable keys (`name`, `description`, `license`, `allowed-tools`, `metadata`), because Claude.ai and the Skills API reject other keys.
  - `allowed-tools: Read` lets Claude Code read those reference files from the plugin cache without asking for permission.
- **The plugin** (`.claude-plugin/`). The repository root is both the marketplace (`vipul-goel`) and the plugin (`source: "./"`). That's why the root must never contain a `package.json` with a lockfile (Claude Code would run `npm ci` on install), a `bin/` folder (Claude.ai refuses such plugins), `CLAUDE.md`, `.mcp.json` or `commands/`. The MCP server's `package.json` lives in `mcp/`, which the plugin loader doesn't inspect.
- **The universal prompt** (`universal/`). The core is written by hand to fit common instruction limits (7,500 characters or fewer). It mirrors the skill's workflow and output contract; the contract check and the two-turn behavior test catch divergence. The knowledge file is generated from the references.
- **The MCP server** (`mcp/`). It never calls a model. It serves the method, the checklists and a deterministic lint, and it asks questions through the client's form UI when the client supports elicitation. The host model does all the writing, so no API key is needed and the main tool never sees the user's prompt.
- **The data** (`data/`):
  - `contract.json` lists the headings, score dimensions, tags, markers and menu items every format must contain, plus size budgets.
  - `lint-rules.json` holds the prompt anti-patterns.
  - `media-targets.json` holds image and video tool syntax, each entry with a verification status, sources and a last-checked date.

## Checks

| Command | What it checks |
|---|---|
| `node scripts/build.mjs --check` | Generated files are up to date |
| `node scripts/validate.mjs` | Portable frontmatter, Claude Code substitution hazards, self-lint, budgets, reference links, the output contract, plugin-root hygiene, manifests and version sync, data and eval files, generated-file freshness |
| `node --test scripts/test/*.test.mjs` | Mutation tests: each validator rule catches what it should |
| `claude plugin validate . --strict` | Claude Code's own manifest and skill checks |
| `cd mcp && npm test && npm run test:inspector` | MCP server unit, integration (both protocol eras, with and without form elicitation) and end-to-end tests, plus MCP Inspector gates |
| `claude plugin eval .` | Behavior evals, with and without the plugin (billed model calls) |
| `node scripts/eval/universal-test.mjs` | Two-turn behavior test of the universal prompt with tools disabled (billed) |
