# Prompt Engine: notes for Claude Code sessions in this repo

Read `docs/architecture.md` first for the map. The approved build plan, with the owner's decisions, is in `.claude/handoff/plan.md`.

## Hard rules

- **The repo root is also the Claude Code plugin root.** Never add a root `package.json`, lockfile, `node_modules/`, `bin/`, root `CLAUDE.md`, `.mcp.json`, `commands/`, `agents/` or `hooks/`. `node scripts/validate.mjs` enforces this.
- **Single source.** The method lives in `skills/prompt-engine/SKILL.md` and `references/`.
  - `universal/prompt-engine.md` is a hand-written mirror (at most 7,500 characters) that must stay in step with it.
  - Generated files: never edit them by hand; run `node scripts/build.mjs`. They are:
    - `universal/prompt-engine-knowledge.md`
    - `references/media-targets.md`
    - `mcp/src/generated/content.ts`
    - the skill text inside `evals/*/history.jsonl`
- **SKILL.md frontmatter** may only use `name`, `description` (at most 200 characters, one line, no `<>` or quotes), `license`, `allowed-tools` and `metadata`. Claude.ai and the Skills API reject other keys.
- **Method text** has no capitalized pressure words and no requests to show reasoning. The validator enforces both through `data/lint-rules.json`.
- **Honesty.** The owner wants honesty above all: never state unverified facts as facts in docs or prompts. Use the status labels in `docs/compatibility.md`.
- **Commits.** Commit messages end with a `Co-Authored-By` trailer. Never push to `main` directly; work on a branch.

## Checks (all must pass)

```bash
node scripts/build.mjs --check && node scripts/validate.mjs && node --test scripts/test/*.test.mjs && claude plugin validate . --strict
```

```bash
cd mcp && npm ci && npm run build && npm test && npm run test:inspector && npm run pack:mcpb && npm pack --dry-run
```

`npm run test:worker` downloads wrangler through npx and needs Node 22 or later.

## Status at handoff (2026-10-29, branch `claude/gallant-thompson-eblqe0`)

Done and pushed:
- The skill, references, plugin and marketplace manifests, universal prompt, build and validate scripts, the release and version scripts, and docs.
- 17 eval cases. The last full run passed 14/17; the 3 failures were fixed and those cases re-run 5/5 (see `docs/compatibility.md`).
- Description tuning (24/24 trigger tests).
- An interactive end-to-end smoke test: install from GitHub, clickable dialogs, the "What next?" menu, saving to a file.
- The MCP server, plus fixes for all its review findings. Results from that review: `.claude/handoff/mcp-fix-implementer.json`. Every gate was green at handoff: 162 MCP tests on Node 22 and 20, 24 root tests, 32/32 Inspector gates, the MCPB bundle, the npm tarball and the Worker dry run.

Not finished, in order:
1. **Verify the MCP fixes adversarially.** The implementer's own gates passed, but the independent verification was stopped before it ran. For each of the 13 items in `.claude/handoff/mcp-fix-implementer.json`, try to break the fix. In particular:
   - re-run the slow-regex probes from the original review: `{{` plus thousands of spaces, `1,` repeated, `[[` repeated, each up to 100k characters, through `check_prompt` over `--http` while sending a concurrent `tools/list`;
   - check ask_user's cancel and decline handling;
   - check host allowlists with ports;
   - check that the served resources don't mention AskUserQuestion.

   Item 13 (the MCPB icon) is marked partial; read its notes.
2. **Process the repo review.** `.claude/handoff/repo-review-partial.json` holds 45 findings from four of the six review dimensions: method, scripts, workflows and docs. The evals and packaging dimensions never ran.
   - The findings are **unverified**. Reproduce each one before fixing; some may be wrong.
   - Likely high value: the universal core offers "Save to file" in chat apps; the "What next?" reply handling; the history sanitizer only redacts e-mail addresses; CRLF and `.DS_Store` breaking validate on Windows and macOS; `build.mjs` silently doing nothing when its path has spaces or is a symlink (the `import.meta.url` vs `argv[1]` check); `verify-data.yml` opening duplicate issues; the README overclaiming before npm publish.
   - Then run the two missing dimensions: eval graders, and packaging (what a plugin install copies to users).
3. **Move the parked workflows.** Move `.github/pending-workflows/*.yml` to `.github/workflows/`. The cloud session's GitHub token lacked the `workflow` scope, so they're parked there. Then update the docs that call them "the CI/Release workflow".
4. **Run the final full eval.** It makes billed calls; the last run cost about $2:

   ```bash
   claude plugin eval . --runs 1 --allow-tools Write Edit --scaffold --no-publish --max-cost-usd 5 --trust-plugin -j 3
   ```

   Update the table in `docs/compatibility.md`. If you change SKILL.md wording that affects triggering, re-run the trigger tests: the eval set and method are described in `docs/compatibility.md` under "Trigger tests".
5. Optionally re-run the interactive smoke test: install the marketplace from the branch with `claude plugin marketplace add "https://github.com/vipul-goel/prompt-engine.git#<branch>"`, then run `/prompt-engine write a blog post about remote work`.
6. Squash the WIP commits if you like, open a PR to `main`, then follow `docs/publishing.md` for the first release. Ask the owner before pushing any tag or publishing to npm.

## Gotchas learned

- **Headless runs.** In `claude -p`, plugin eval runs and the Skills API, AskUserQuestion doesn't exist, so the skill uses the numbered text format. Interactive Claude Code shows dialogs. `claude -p` prints only the final message, which is why the skill keeps the output and the "What next?" menu in one message.
- **Nested runs.** When running `claude -p` or `claude plugin eval` from inside another Claude Code session, unset `CLAUDE_CODE_SESSION_ID` and `CLAUDE_CODE_REMOTE_SESSION_ID` first.
- **Description tuning.** If you tune the description with skill-creator's `run_loop`, run each query in its own project folder. Parallel runs that share one `.claude/commands/` folder see each other's copies and give false negatives.
- **Choosing eval cases.** `claude plugin eval --case` takes a single glob, with no braces and no repeats. Run several commands, or use `--tag`.
- **Cost.** Behavior evals and description tuning are billed model calls. Use `--runs 1` and `--max-cost-usd`.
