# Contributing

Thanks for helping. Bug reports, better checklists, new domains, eval cases and fixes to tool data are all welcome.

## How the repository fits together

One method ships in four formats, so most changes start in one place and flow out from there. [docs/architecture.md](docs/architecture.md) has the full picture.

| Kind of file | Files | How to change it |
|---|---|---|
| The method (single source) | `skills/prompt-engine/SKILL.md`, `skills/prompt-engine/references/*.md` | Edit by hand |
| Hand-written mirror | `universal/prompt-engine.md` | When you change the workflow or the output format in `SKILL.md`, make the same change here. It must stay under 7,500 characters |
| Data | `data/contract.json` (output contract and size budgets), `data/lint-rules.json`, `data/media-targets.json` | Edit by hand |
| Generated | `universal/prompt-engine-knowledge.md`, `skills/prompt-engine/references/media-targets.md`, `mcp/src/generated/content.ts`, and the skill text inside `evals/*/history.jsonl` | Never edit; run `node scripts/build.mjs` |

## Setup

- **Node.js 20 or later** (22 recommended). The scripts in `scripts/` use only Node built-ins, so there's nothing to install at the repository root.
- **No `package.json` at the root.** The root is also the Claude Code plugin root, and Claude Code runs `npm ci` when someone installs a plugin that has a `package.json` and a lockfile. The validator enforces this, along with the other files a plugin root must not contain.
- **For the MCP server:** `cd mcp && npm ci`.
- **[Claude Code](https://code.claude.com/docs)** for `claude plugin validate` and the behavior evals.

## Checks

Run these before opening a pull request. CI runs the same ones.

```bash
node scripts/build.mjs --check && node scripts/validate.mjs && node --test scripts/test/*.test.mjs
```

```bash
claude plugin validate . --strict
```

If you changed `mcp/`:

```bash
cd mcp && npm test && npm run test:inspector
```

The validator explains each failure. The most common ones:
- **Generated file is stale.** Run `node scripts/build.mjs`.
- **Contract item missing.** Every heading, score dimension and marker in `data/contract.json` must appear in `SKILL.md`, `references/output-format.md` and the universal core. If you rename one, rename it everywhere.
- **Budget exceeded.** `SKILL.md` has a size budget, and its key sections must start within the first 8,000 characters. That's because Claude Code keeps only about the first 5,000 tokens of an invoked skill after it compacts a long conversation. Move detail into a reference file instead.

## Writing guidelines for the method

These apply to `SKILL.md`, the references and the universal prompt, and to the prompts they produce.

- **Give the reason, not emphasis.** Explain why an instruction matters rather than writing it in capitals. The validator flags capitalized pressure words such as MUST or NEVER and requests to show the model's reasoning, which current Claude models may refuse.
- **Stay portable.**
  - Frontmatter may only use `name`, `description`, `license`, `allowed-tools` and `metadata`, because Claude.ai and the Skills API reject other keys.
  - The description must be one line, without `<` or `>`, within the cap in `data/contract.json`.
  - Skill text must not use Claude Code's substitution syntax, such as `$ARGUMENTS` or `${CLAUDE_…}`; the validator lists every pattern.
- **Never present unverified facts as facts.** This applies to the method and to the prompts it writes: unknowns become `[[placeholders]]`, and defaults become labelled assumptions. Tool-specific details belong in `data/media-targets.json` with a verification status and sources.
- **Ask only questions whose answers change the result.** The scoring rule is in `references/questions.md`.

## Common changes

### Add or change a domain checklist

1. Write `skills/prompt-engine/references/<domain>.md`, starting with a `# Title` line.
2. In `SKILL.md`, make the "2. Diagnose" step point to it.
3. Add the file's name to `KNOWLEDGE_ORDER` in `scripts/build.mjs`, then run `node scripts/build.mjs`. This updates the universal knowledge file and the MCP server's content.
4. If the MCP server lists domains by name (see `mcp/src/`), add it there and to the server's tests.
5. Add at least one eval case that uses the new checklist.

### Update image or video tool data

Edit the tool's entry in `data/media-targets.json`:
- Set `status` to `verified` only if you checked the vendor's own documentation, `secondary` if you saw it only through search results or third parties, and `unverified` otherwise.
- List what you read in `sources`.
- Set `last_verified` to today's date.

Then run `node scripts/build.mjs`.

### Add a lint rule

Add an entry to `data/lint-rules.json`. Each entry has an `id`, a JavaScript regular expression `pattern`, `flags`, a `severity` and a `message` that says what to do instead. Set `selfCheck: true` only if Prompt Engine's own instructions must never match it, and add a test for it in `scripts/test/validate.test.mjs`. The MCP server's `check_prompt` tool uses the same rules, one line at a time, on drafts of up to 100,000 characters from anyone who can reach the server.

Keep the pattern linear-time, so a hostile draft can't stall the server:
- bound every repetition, for example `[^\n]{0,80}` instead of `*` or `+`, up to `{0,200}`;
- repeat only single characters or classes, never groups (`?` after a group is fine);
- don't use backreferences.

`check_prompt` skips a rule that breaks these, and `scripts/test/lint-rules.test.mjs` times every rule on adversarial input, so a slow pattern fails the checks above.

## Behavior evals

The cases in `evals/` run with Claude Code's plugin eval runner, with and without the plugin. Each case folder holds `prompt.md`, `case.yaml` and `graders/*.md`; see Claude Code's [plugin eval docs](https://code.claude.com/docs/en/plugin-evals.md) for the format.

Evals make real model calls on your account and are billed. Start with a subset and a cost ceiling:

```bash
claude plugin eval . --case 'image-*' --runs 1 --max-cost-usd 1 --no-publish
```

- **Cases that grant tools or run scaffold scripts.** The full suite needs `--allow-tools Write Edit --scaffold`. Read a case's `scaffold_script` before you run it.
- **Follow-up cases.** These resume a recorded first turn. Record one with `node scripts/eval/record-history.mjs evals/<case>/history.jsonl "<first message>"`. The script keeps only the conversation, rewrites local paths and refuses to write a file that still contains an e-mail address. Read the file before you commit it anyway. Afterwards, `node scripts/build.mjs` keeps the skill text and reference files inside the recording up to date, so re-record only when the recorded question round itself should change.
- **Results.** They go to `evals/results/`, which is ignored by git. Run transcripts can include details of your account, so don't commit them.
- **Universal prompt.** It has its own two-turn test: `node scripts/eval/universal-test.mjs`.
- **Reading outputs side by side.** Run the evals with `--json result.json --keep-temp`, then `node scripts/eval/to-review.mjs result.json <workspace>/iteration-1`. This converts the results into the workspace layout used by the review viewer in Anthropic's skill-creator skill.

When you change the method, include the eval summary, with and without the skill, in your pull request.

## Pull requests

- Describe the behavior change. If you changed the method, include the before and after output for one prompt.
- Add a line under "Unreleased" in `CHANGELOG.md`.
- Leave version numbers alone; they're set at release time (see [docs/publishing.md](docs/publishing.md)).
- Contributions are accepted under the [MIT License](LICENSE).

## Reporting problems

Open an issue with the rough prompt, the app and model you used, what you expected and what happened. Remove anything private first.

If you find a way that Prompt Engine could leak data or act without the user choosing to, don't post the details publicly. Use the repository's private vulnerability reporting (Security tab) if it's enabled, or open an issue asking for a private contact.
