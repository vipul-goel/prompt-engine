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

## Status at handoff (2026-11-03, branch `claude/gallant-thompson-eblqe0`)

Done and pushed (up to 34d9caa):
- The skill, references, plugin and marketplace manifests, universal prompt, build and validate scripts, the release and version scripts, and docs.
- 17 eval cases. The last full run passed 14/17; the 3 failures were fixed and those cases re-run 5/5 (see `docs/compatibility.md`).
- Description tuning (24/24 trigger tests).
- An interactive end-to-end smoke test: install from GitHub, clickable dialogs, the "What next?" menu, saving to a file.
- The MCP server, plus fixes for all its review findings (`.claude/handoff/mcp-fix-implementer.json`).

Done and pushed (34d9caa..3956d22):
- **Adversarial verification of the MCP fixes (old step 1).** Attackers tried to break all 13 items, including the slow-regex probes over `--http` with a concurrent `tools/list`, ask_user's cancel and decline handling, allowlists with ports, AskUserQuestion in served resources, and the icon. About 70 claimed breaks were triaged. The real ones were fixed: a u/v empty-match infinite loop, gate bypasses, window and excerpt bugs, the result-size bound, a bad Host giving 500, slow-body memory exhaustion, log injection, allowlist parsing, ask_user validation and capability reading, adaptation drift, the icon check, language-detection regressions, and tests that couldn't fail. Every original repro was re-run against the merged build, the docs were rewritten and fact-checked, and two more attack rounds checked the follow-up fixes; two rules that a round broke were undone (4f23883).
- Gates at 4f23883: 233 MCP tests (Node 24 only; Node 20 and 22 aren't installed on this machine), 31/32 root tests, 32/32 Inspector gates, the MCPB bundle, the npm tarball (11 files) and the Worker checks. The failing root test is `version.test.mjs`: on macOS, `build.mjs` silently does nothing when run through a symlinked path, a repo-review finding (step 1 below).
- Known limits, left by design and documented in `mcp/README.md`: check_prompt's language detection is a heuristic (some unlisted languages read as English; English requests quoting a longer passage in another script read as non-English; subject phrases such as "returns JSON" count as an output format); check_prompt is about 20-30% slower than at 34d9caa, still linear; GET, DELETE and OPTIONS reach the SDK, which reads the body before its 405; `<scheme>://*` allowlist entries other than http and https are kept silently; a single-★ rating on the recommended option loses its ★; SDK-written errors aren't covered by the result budget; whether Claude Desktop keeps a 2025-era form open for the hour-long wait is unverified (optional check in `docs/manual-checks.md`).
- **Owner decision needed:** `.claude/handoff/plan.md` line 100 says declined or cancelled answers fall back to ★. The server now asks in chat when the form is cancelled, which matches plan.md line 54 and the skill. Confirm, and update plan.md, or say otherwise.

Not finished, in order. When you finish a step or sub-step, mark it done here with its commit.
1. **Process the repo review.** `.claude/handoff/repo-review-partial.json` holds 45 findings from four of the six review dimensions: method, scripts, workflows and docs. The evals and packaging dimensions never ran.
   - 1a. **Done (3548123): verify the 45 findings.** Each was reproduced on this branch and attacked by an independent second agent; the two disputes went to a third. Live runs on this branch (about $1.20) stood in for the reviewer's model traces. Result, in `.claude/handoff/repo-review-verified.json`: 43 confirmed, 2 need an owner decision (3: what `ok` at the menu does; 11: what a critique request gets), none wrong or already fixed. 13 severities drop from major to minor. Most of the review's fixes needed corrections: use each record's `proposed_fix` and the audit's `fix_corrections`, not the review's `fix`.
     - **Owner answers come first.** The file's `owner_decisions` holds 26 questions (D1-D26), each with a recommended answer; 1c and 1d wait on the ones their findings name. Its `coordination` list covers fixes that interact: the SKILL.md budget (194 characters left before `### 5. Present`), the landing order for 13, 16, 18, 21 and 23, and one combined release.yml change.
     - The file is about 650 KB: read one finding at a time, for example `jq '.findings[12]' .claude/handoff/repo-review-verified.json` for finding 13.
   - 1b. **Run the two missing dimensions:** eval graders, and packaging (what a plugin install, the npm package, the MCPB bundle and the release files give users). Verify their findings the same way and add them to the same file.
   - 1c. **Fix the confirmed code findings** in `scripts/` and the parked workflows in `.github/pending-workflows/`.
   - 1d. **Fix the confirmed method and docs findings.** Re-run the affected eval cases with a cost cap.
   - 1e. **Adversarially check the fixes** from 1c and 1d, as was done for the MCP fixes.
   - The 10 that stay major: the universal core offers "Save to file" in chat apps (1); `ok` at the menu (3); untested acceptance behaviors (5); `build.mjs` silently doing nothing on paths with spaces or symlinks (13); CRLF and `.DS_Store` breaking the checks (16); release.yml's job-wide write and OIDC permissions and its unverified publisher download (27, 28); the README's platform claim and the unclaimed npm name (35, 37); compatibility.md's test-status claims (39).
2. **Move the parked workflows.** Run `git mv .github/pending-workflows .github/workflows` (the `*.yml` form fails, because the destination doesn't exist yet). D19 asks whether to do this right after 1c. A cloud session's GitHub token lacked the `workflow` scope, so they were parked there. This clone pushes over SSH, so the token's scopes shouldn't matter; if GitHub still refuses the push, the owner runs `gh auth refresh -h github.com -s workflow`. Then update the docs that call them "the CI/Release workflow", push, and get CI passing, including the MCP tests on Node 20 and 22.
3. **Run the final full eval.** It makes billed calls; the last run cost about $2:

   ```bash
   claude plugin eval . --runs 1 --allow-tools Write Edit --scaffold --no-publish --max-cost-usd 5 --trust-plugin -j 3
   ```

   Update the table in `docs/compatibility.md`. If you change SKILL.md wording that affects triggering, re-run the trigger tests: the eval set and method are described in `docs/compatibility.md` under "Trigger tests".
4. Optionally re-run the interactive smoke test: install the marketplace from the branch with `claude plugin marketplace add "https://github.com/vipul-goel/prompt-engine.git#<branch>"`, then run `/prompt-engine write a blog post about remote work`.
5. Open a PR to `main`. To squash the WIP commits, use "Squash and merge" on GitHub instead of rewriting the pushed branch. Then follow `docs/publishing.md` for the first release. Ask the owner before pushing any tag or publishing to npm. As of 2026-11-03, npm isn't logged in on this Mac and the repo has no Actions secrets.

## Gotchas learned

- **Headless runs.** In `claude -p`, plugin eval runs and the Skills API, AskUserQuestion doesn't exist, so the skill uses the numbered text format. Interactive Claude Code shows dialogs. `claude -p` prints only the final message, which is why the skill keeps the output and the "What next?" menu in one message.
- **Nested runs.** When running `claude -p` or `claude plugin eval` from inside another Claude Code session, unset `CLAUDE_CODE_SESSION_ID` and `CLAUDE_CODE_REMOTE_SESSION_ID` first.
- **Description tuning.** If you tune the description with skill-creator's `run_loop`, run each query in its own project folder. Parallel runs that share one `.claude/commands/` folder see each other's copies and give false negatives.
- **Choosing eval cases.** `claude plugin eval --case` takes a single glob, with no braces and no repeats. Run several commands, or use `--tag`.
- **macOS.** There is no `timeout` command: use `perl -e 'alarm shift; exec @ARGV' <seconds> <command>`. In a copy under `/tmp` (a symlink to `/private/tmp`), run the build as `node "$(realpath scripts/build.mjs)"`, or it does nothing.
- **Git on the owner's Mac.** `origin` uses SSH (`git@github.com:vipul-goel/prompt-engine.git`) and signs in as vipul-goel. Keep it on SSH: the macOS Keychain holds a GitHub login for an account that can't push here. Git's name and e-mail are set, so commit normally, with the `Co-Authored-By` trailer.
- **Invisible characters in source.** The Edit tool can write a `\uXXXX` escape as the literal character. Write `\u{XXXX}` instead, and check the bytes after editing tests about invisible characters. In a regular expression, `\u{XXXX}` works only with the `u` flag: without it, `/^\u{FEFF}/` matches the text `u{FEFF}` and strips no BOM.
- **Headless skill runs.** `claude -p --safe-mode` also hides a plugin loaded with `--plugin-dir`; without `--safe-mode`, your own installed and synced skills compete with it. `claude plugin eval --ablation none` runs only the skill arm, and `--output-dir` keeps results out of `evals/results/`.
- **Cost.** Behavior evals and description tuning are billed model calls. Use `--runs 1` and `--max-cost-usd`.
