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

## Status at handoff (2026-11-06, branch `claude/gallant-thompson-eblqe0`)

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
- **Owner action (D20):** claim `prompt-engine-mcp` on npm as 0.0.1, by hand. Rehearsed on 2026-11-04 without publishing: in a clean copy at a real path (`git archive HEAD`, not through `/tmp` or `/var`), `node scripts/version.mjs 0.0.1`, then in `mcp/` `npm ci` and `npm publish --access public` after `npm login`. The 233 MCP tests passed and the tarball has 11 files. A plain `npm version 0.0.1` in `mcp/` fails `manifests.test.ts`, which requires every manifest to carry the same version.

Not finished, in order. When you finish a step or sub-step, mark it done here with its commit.
1. **Process the repo review.** `.claude/handoff/repo-review-partial.json` holds 45 findings from four of the six review dimensions: method, scripts, workflows and docs. The evals and packaging dimensions never ran.
   - 1a. **Done (3548123): verify the 45 findings.** Each was reproduced on this branch and attacked by an independent second agent; the two disputes went to a third. Live runs on this branch (about $1.20) stood in for the reviewer's model traces. Result, in `.claude/handoff/repo-review-verified.json`: 43 confirmed, 2 need an owner decision (3: what `ok` at the menu does; 11: what a critique request gets), none wrong or already fixed. 13 severities drop from major to minor. Most of the review's fixes needed corrections: use each record's `proposed_fix` and the audit's `fix_corrections`, not the review's `fix`.
     - **Owner answers (2026-11-04): all 26 accepted as recommended.** They are D1-D26 in the file's `owner_decisions`; the plan.md lines they changed carry their D number. Still open: whether quick mode also reads `references/questions.md` (D8's second question had no recommendation). The file's `coordination` list covers fixes that interact: the SKILL.md budget (194 characters left before `### 5. Present`), the landing order for 13, 16, 18, 21 and 23, and one combined release.yml change.
     - With both steps the file is about 1.3 MB: read one finding at a time. Finding N is `.findings[N-1]`, for example `jq '.findings[12]' .claude/handoff/repo-review-verified.json` for finding 13.
   - 1b. **Done (bf2aac8): review and verify the eval graders and packaging.** Three reviewers per area, each with its own lens, then a merge per area; the raw review is `.claude/handoff/repo-review-1b.json`. Evidence: one full eval on this branch (2026-11-04, both arms, Claude Code 2.1.318, Sonnet 5.5, $1.95) and the release files built in a copy, with nothing published. The 35 findings (46-80) went through the same verify, audit and arbitration steps and are in the same file: 32 confirmed, 2 need an owner decision (51: runs per case and the pass bar; 73: `.claude/CLAUDE.md` ships inside the plugin), 1 wrong (61: the Veo failure is a real skill miss that the grader caught).
     - **Owner decisions D27-D45 are open,** each with a recommendation, in the file's `owner_decisions`. 1c and 1d need them before they touch the evals or packaging. D39 (where these notes live after the merge, and the plugin layout) also decides where the new layout checks in validate.mjs apply. The 12 new `coordination` notes cover fixes that interact: one edit per rubric file for 48-50, a shared menu regex, one validate.mjs eval module (65), one recording batch, and the workflow and first-release doc changes.
     - The six majors: two-arm runs don't score the trigger check (46); no eval pins the agent or judge model (47); the strong-prompt case passes a reply that runs the prompt (48); the no-invention check is missing from most output cases and too loose where it runs (49); LLM judges never see the user's request (50); the `.mcpb` ships third-party code without its license notices (68).
     - Each record's `proposed_fix` names its step (1c or 1d); 1b adds `mcp/` and eval-grader fixes to 1c. As in 1a, use the audit's `fix_corrections` along with it.
   - 1c. **Fix the confirmed code findings** in `scripts/`, `mcp/` and the eval graders, and the parked workflows in `.github/pending-workflows/`. Then do step 2 before 1d (D19).
   - 1d. **Fix the confirmed method and docs findings.** Re-run the affected eval cases with a cost cap.
   - 1e. **Adversarially check the fixes** from 1c and 1d, as was done for the MCP fixes.
   - The 10 from 1a that stay major: the universal core offers "Save to file" in chat apps (1); `ok` at the menu (3); untested acceptance behaviors (5); `build.mjs` silently doing nothing on paths with spaces or symlinks (13); CRLF and `.DS_Store` breaking the checks (16); release.yml's job-wide write and OIDC permissions and its unverified publisher download (27, 28); the README's platform claim and the unclaimed npm name (35, 37); compatibility.md's test-status claims (39). 1b's six majors are listed under 1b.
2. **Move the parked workflows, right after 1c (D19).** Run `git mv .github/pending-workflows .github/workflows` (the `*.yml` form fails, because the destination doesn't exist yet). A cloud session's GitHub token lacked the `workflow` scope, so they were parked there. This clone pushes over SSH, so the token's scopes shouldn't matter; if GitHub still refuses the push, the owner runs `gh auth refresh -h github.com -s workflow`. Then update the docs that call them "the CI/Release workflow", push, and open a draft PR to `main` (D19): ci.yml runs only on pull requests and pushes to `main`. Get CI passing, including the MCP tests on Node 22 and 24 (D26 raised the floor to 22.19). Once CI runs, add the branch and tag protection approved in D16.
3. **Run the final full eval.** It makes billed calls; the last run cost about $2:

   ```bash
   claude plugin eval . --runs 1 --allow-tools Write Edit --scaffold --no-publish --max-cost-usd 5 --trust-plugin -j 3
   ```

   D27, D28 and D31 may change this command. Update the table in `docs/compatibility.md`. If you change SKILL.md wording that affects triggering, re-run the trigger tests: the eval set and method are described in `docs/compatibility.md` under "Trigger tests".
4. **Re-run the interactive smoke test, before the PR leaves draft (D25).** Follow the Claude Code checklist that 1d adds to `docs/manual-checks.md`: install the marketplace from the branch with `claude plugin marketplace add "https://github.com/vipul-goel/prompt-engine.git#<branch>"`, then run `/prompt-engine write a blog post about remote work`.
5. Mark the draft PR to `main` ready. To squash the WIP commits, use "Squash and merge" on GitHub instead of rewriting the pushed branch. Then follow `docs/publishing.md` for the first release. Ask the owner before pushing any tag or publishing to npm. As of 2026-11-03, npm isn't logged in on this Mac and the repo has no Actions secrets. CI needs no `NPM_TOKEN`: it publishes through trusted publishing (D15), once the owner's 0.0.1 claim (D20) exists.

## Gotchas learned

- **Headless runs.** In `claude -p`, plugin eval runs and the Skills API, AskUserQuestion doesn't exist, so the skill uses the numbered text format. Interactive Claude Code shows dialogs. `claude -p` prints only the final message, which is why the skill keeps the output and the "What next?" menu in one message.
- **Nested runs.** When running `claude -p` or `claude plugin eval` from inside another Claude Code session, unset `CLAUDE_CODE_SESSION_ID` and `CLAUDE_CODE_REMOTE_SESSION_ID` first.
- **Description tuning.** If you tune the description with skill-creator's `run_loop`, run each query in its own project folder. Parallel runs that share one `.claude/commands/` folder see each other's copies and give false negatives.
- **Choosing eval cases.** `claude plugin eval --case` takes a single glob, with no braces and no repeats. Run several commands, or use `--tag`.
- **macOS.** There is no `timeout` command: use `perl -e 'alarm shift; exec @ARGV' <seconds> <command>`. In a copy under `/tmp` (a symlink to `/private/tmp`), run the build as `node "$(realpath scripts/build.mjs)"`, or it does nothing.
- **Git on the owner's Mac.** `origin` uses SSH (`git@github.com:vipul-goel/prompt-engine.git`) and signs in as vipul-goel. Keep it on SSH: the macOS Keychain holds a GitHub login for an account that can't push here. Git's name and e-mail are set, so commit normally, with the `Co-Authored-By` trailer.
- **Invisible characters in source.** The Edit tool can write a `\uXXXX` escape as the literal character. Write `\u{XXXX}` instead, and check the bytes after editing tests about invisible characters. In a regular expression, `\u{XXXX}` works only with the `u` flag: without it, `/^\u{FEFF}/` matches the text `u{FEFF}` and strips no BOM.
- **Headless skill runs.** `claude -p --safe-mode` also hides a plugin loaded with `--plugin-dir`; without `--safe-mode`, your own installed and synced skills compete with it. `claude plugin eval --ablation none` runs only the skill arm, and `--output-dir` keeps results out of `evals/results/`.
- **Eval scoring.** For a plugin path, `claude plugin eval` runs two arms by default. With-only graders (such as `tool_used` on Skill) then become unscored indicators, the three history cases run with the plugin only, and `--threshold 0` makes `casesPassed` count failing cases. The result JSON names the agent model only under `suite.modelOverride`, when `--model` is passed; a kept trace's init line also has it. Claude Code updates itself, so record `claude --version` with any result (1a ran 2.1.317, 1b 2.1.318).
- **Cost.** Behavior evals and description tuning are billed model calls. Use `--runs 1` and `--max-cost-usd`.
