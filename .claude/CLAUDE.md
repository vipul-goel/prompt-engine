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

## Status at handoff (2026-10-30, branch `claude/gallant-thompson-eblqe0`)

Done and pushed (up to 34d9caa):
- The skill, references, plugin and marketplace manifests, universal prompt, build and validate scripts, the release and version scripts, and docs.
- 17 eval cases. The last full run passed 14/17; the 3 failures were fixed and those cases re-run 5/5 (see `docs/compatibility.md`).
- Description tuning (24/24 trigger tests).
- An interactive end-to-end smoke test: install from GitHub, clickable dialogs, the "What next?" menu, saving to a file.
- The MCP server, plus fixes for all its review findings (`.claude/handoff/mcp-fix-implementer.json`).

Done locally, not pushed (the commits after 34d9caa):
- **Adversarial verification of the MCP fixes (old step 1).** Attackers tried to break all 13 items, including the slow-regex probes over `--http` with a concurrent `tools/list`, ask_user's cancel and decline handling, allowlists with ports, AskUserQuestion in served resources, and the icon. About 70 claimed breaks were triaged. The real ones were fixed: a u/v empty-match infinite loop, gate bypasses, window and excerpt bugs, the result-size bound, a bad Host giving 500, slow-body memory exhaustion, log injection, allowlist parsing, ask_user validation and capability reading, adaptation drift, the icon check, language-detection regressions, and tests that couldn't fail. Every original repro was re-run against the merged build, the docs were rewritten and fact-checked, and two more attack rounds checked the follow-up fixes; two rules that a round broke were undone (4f23883).
- Gates at 4f23883: 233 MCP tests (Node 24 only; Node 20 and 22 aren't installed on this machine), 31/32 root tests, 32/32 Inspector gates, the MCPB bundle, the npm tarball (11 files) and the Worker checks. The failing root test is `version.test.mjs`: on macOS, `build.mjs` silently does nothing when run through a symlinked path, a repo-review finding (step 1 below).
- Known limits, left by design and documented in `mcp/README.md`: check_prompt's language detection is a heuristic (some unlisted languages read as English; English requests quoting a longer passage in another script read as non-English; subject phrases such as "returns JSON" count as an output format); check_prompt is about 20-30% slower than at 34d9caa, still linear; GET, DELETE and OPTIONS reach the SDK, which reads the body before its 405; `<scheme>://*` allowlist entries other than http and https are kept silently; a single-★ rating on the recommended option loses its ★; SDK-written errors aren't covered by the result budget; whether Claude Desktop keeps a 2025-era form open for the hour-long wait is unverified (optional check in `docs/manual-checks.md`).
- **Owner decision needed:** `.claude/handoff/plan.md` line 100 says declined or cancelled answers fall back to ★. The server now asks in chat when the form is cancelled, which matches plan.md line 54 and the skill. Confirm, and update plan.md, or say otherwise.

Not finished, in order:
1. **Process the repo review.** `.claude/handoff/repo-review-partial.json` holds 45 findings from four of the six review dimensions: method, scripts, workflows and docs. The evals and packaging dimensions never ran.
   - The findings are **unverified**. Reproduce each one before fixing; some may be wrong.
   - Likely high value: the universal core offers "Save to file" in chat apps; the "What next?" reply handling; the history sanitizer only redacts e-mail addresses; CRLF and `.DS_Store` breaking validate on Windows and macOS; `build.mjs` silently doing nothing when its path has spaces or is a symlink (the `import.meta.url` vs `argv[1]` check); `verify-data.yml` opening duplicate issues; the README overclaiming before npm publish.
   - Then run the two missing dimensions: eval graders, and packaging (what a plugin install copies to users).
2. **Move the parked workflows.** Move `.github/pending-workflows/*.yml` to `.github/workflows/`. The cloud session's GitHub token lacked the `workflow` scope, so they're parked there. Then update the docs that call them "the CI/Release workflow".
3. **Run the final full eval.** It makes billed calls; the last run cost about $2:

   ```bash
   claude plugin eval . --runs 1 --allow-tools Write Edit --scaffold --no-publish --max-cost-usd 5 --trust-plugin -j 3
   ```

   Update the table in `docs/compatibility.md`. If you change SKILL.md wording that affects triggering, re-run the trigger tests: the eval set and method are described in `docs/compatibility.md` under "Trigger tests".
4. Optionally re-run the interactive smoke test: install the marketplace from the branch with `claude plugin marketplace add "https://github.com/vipul-goel/prompt-engine.git#<branch>"`, then run `/prompt-engine write a blog post about remote work`.
5. Push the branch, squash the WIP commits if you like, open a PR to `main`, then follow `docs/publishing.md` for the first release. Ask the owner before pushing any tag or publishing to npm.

## Gotchas learned

- **Headless runs.** In `claude -p`, plugin eval runs and the Skills API, AskUserQuestion doesn't exist, so the skill uses the numbered text format. Interactive Claude Code shows dialogs. `claude -p` prints only the final message, which is why the skill keeps the output and the "What next?" menu in one message.
- **Nested runs.** When running `claude -p` or `claude plugin eval` from inside another Claude Code session, unset `CLAUDE_CODE_SESSION_ID` and `CLAUDE_CODE_REMOTE_SESSION_ID` first.
- **Description tuning.** If you tune the description with skill-creator's `run_loop`, run each query in its own project folder. Parallel runs that share one `.claude/commands/` folder see each other's copies and give false negatives.
- **Choosing eval cases.** `claude plugin eval --case` takes a single glob, with no braces and no repeats. Run several commands, or use `--tag`.
- **macOS.** There is no `timeout` command: use `perl -e 'alarm shift; exec @ARGV' <seconds> <command>`. In a copy under `/tmp` (a symlink to `/private/tmp`), run the build as `node "$(realpath scripts/build.mjs)"`, or it does nothing.
- **Commit identity.** On the owner's Mac git has no user set, so commits record the machine's hostname. Commit with `git -c user.name=Claude -c user.email=noreply@anthropic.com`.
- **Invisible characters in source.** The Edit tool can write a `\uXXXX` escape as the literal character. Write `\u{XXXX}` instead, and check the bytes after editing tests about invisible characters.
- **Cost.** Behavior evals and description tuning are billed model calls. Use `--runs 1` and `--max-cost-usd`.
