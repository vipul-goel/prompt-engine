# Maintainer notes

These notes are for the people who maintain Prompt Engine, and for the Claude Code sessions that work in this repository. Read [architecture.md](architecture.md) first for the map. [CONTRIBUTING.md](../CONTRIBUTING.md) covers setup, the checks and the eval cases.

## Where the notes live

- This file holds the standing rules and procedures. It ships with the plugin, like every file on `main`.
- Status notes, handoff records and review records never go on `main`. They live on the `maintainer-notes` branch, which shares no history with `main` and is never merged into it. Commit to that branch from its own worktree.
- On that branch, `handoff/plan.md` is the approved build plan, with the owner's decisions. `handoff/repo-review-verified.json` holds the review findings and the owner's answers. The finding numbers and the D and K numbers in this repository's docs and code refer to that file. `STATUS.md` holds the release run's status notes.
- `STATUS.md` is the shared copy of the status notes. A maintainer's untracked `.claude/CLAUDE.md` can hold the working copy. Each time you mark a step done there, copy its text, without the import line, into `STATUS.md` under that file's header, and commit it on `maintainer-notes`.
- To read them without switching branches, run `git fetch origin maintainer-notes`, then `git show origin/maintainer-notes:STATUS.md`.
- To have Claude Code load this file in your sessions, keep an untracked `.claude/CLAUDE.md` whose first line is `@../docs/maintainers.md`. Claude Code resolves an import from the folder of the file that holds it. Git ignores that file.

## Hard rules

- **The repo root is also the Claude Code plugin root.** Every file committed to `main` ships in every install.
  - Never add a root `package.json`, lockfile, `node_modules/`, `bin/`, root `CLAUDE.md`, `.mcp.json`, `commands/`, `agents/` or `hooks/`.
  - Never commit an `AGENTS.md` or a `CLAUDE.local.md` at the root, or anything under `.claude/`. Claude Code can load them as project memory in a user's session (finding 73).
  - Maintainer notes and handoff records never go on `main`. They live on the `maintainer-notes` branch.
  - `node scripts/validate.mjs` enforces the names in this rule.
- **Single source.** The method lives in `skills/prompt-engine/SKILL.md` and `references/`.
  - `universal/prompt-engine.md` is a hand-written mirror (at most 7,500 characters) that must stay in step with it, except for gaps accepted for lack of room, such as D46's rule for other people's private details; `docs/compatibility.md` lists the main ones under Known limits.
  - Generated files: never edit them by hand; run `node scripts/build.mjs`. They are:
    - `universal/prompt-engine-knowledge.md`
    - `references/media-targets.md`
    - `mcp/src/generated/content.ts`
    - the skill text inside `evals/*/history.jsonl`
    - `evals/*/graders/lint-prompt*.md` (lint graders, from `data/lint-rules.json`)
- **SKILL.md frontmatter** may only use `name`, `description` (at most 200 characters, one line, no `<>` or quotes), `license`, `allowed-tools` and `metadata`. Claude.ai and the Skills API reject other keys.
- **Method text** has no capitalized pressure words and no requests to show reasoning. The validator enforces both through `data/lint-rules.json`.
- **Worked examples** in the method use languages and domains that no eval case uses (step 1d's rule on method examples; D47 applied it to the writing, research and coding worked examples). A model can copy an example's words into its reply, and then a case tests the example, not the method.
  - The output template, Format B in `questions.md` and the universal core's sample question still use the remote-work request that some checks use. Whether to move them is an open owner question. Don't move them before the owner answers.
- **Honesty.** The owner wants honesty above all: never state unverified facts as facts in docs or prompts. Use the status labels in `docs/compatibility.md`.
- **Commits.** Commit messages end with a `Co-Authored-By` trailer. Never push to `main` directly; work on a branch.

## Checks (all must pass)

```bash
node scripts/build.mjs --check && node scripts/validate.mjs && node --test scripts/test/*.test.mjs && claude plugin validate . --strict
```

```bash
cd mcp && npm ci && npm run build && npm test && npm run test:inspector && npm run pack:mcpb && npm run test:pack
```

The MCP checks need Node 22.19 or later: `npm run test:inspector` stops with an error on older versions. `npm run test:pack` installs the packed package, which needs the npm registry, and `npm run test:worker` downloads wrangler through npx.

## The full eval

A full run makes billed model calls. With 28 cases, 10 of which resume a recorded conversation, expect about $3.65 for the agent's calls. The judges' calls come on top (see Cost, under Gotchas). From inside a Claude Code session, unset `CLAUDE_CODE_SESSION_ID` and `CLAUDE_CODE_REMOTE_SESSION_ID` first:

```bash
claude --version
out="evals/results/step3-$(date +%Y%m%d-%H%M%S)"
claude plugin eval . --runs 1 --allow-tools Write Edit --scaffold --no-publish --max-cost-usd 5 --trust-plugin -j 3 \
  --judge-model claude-haiku-5-5 --output-dir "$out"
jq '{claudeVersion, suite, models: ([.cases[].model] | unique)}' "$out/aggregate-result.json"
jq -r '[.cases[].arms.with[]?.graders[]? | select(.name | test("-skill-fired$"))] | "Skill started in \(map(select(.passed)) | length) of \(length) runs"' "$out/aggregate-result.json"
jq -r '.cases[] | .name as $n | .arms.with[]?.graders[]? | select(.withOnly and (.passed | not)) | "Indicator failed: \($n) (\(.name))"' "$out/aggregate-result.json"
jq -e '[.cases[].arms.with[]?.graders[]? | select(.withOnly)] as $i | ($i | length) > 0 and ([$i[] | select(.passed | not)] | length) == 0' "$out/aggregate-result.json"
```

- Each case's `prompt.md` pins the agent model (D28), so don't pass `--model`: it would replace every pin.
- Don't pass `--json` either. It hides the summary table and the per-run grader lines, and `aggregate-result.json` holds the same data.
- The `jq` lines are the ones `evals.yml` runs.
  - The last is D27's gate. It prints `false` and exits 1 when a with-only indicator failed, or when the results hold no indicators at all. These indicators are the skill-fired checks of the cases that ask for prompt-engine by name.
  - The line before it names each failed indicator.
  - The trigger case's own skill check is scored in both arms (`arm: both`). So that case's without arm fails by design: it scores 0.5 when its other check passes.
- Keep one run per case and the 1.0 pass bar (D31). Don't pass `--threshold`: 0.8 would pass a real follow-up failure that scored exactly 0.8.
- Before you record a failing case, re-run it alone: the same command with `--case '<name>' --runs 3 --max-cost-usd 1` and its own `--output-dir`. That costs about $0.36-0.45 for a two-arm case and $0.28-0.36 for a history case. Then count how many of the three runs passed:

  ```bash
  jq -r '.cases[] | "\(.name): \([.arms.with[] | select(.passed and all(.graders[]?; (.withOnly | not) or .passed))] | length) of \(.arms.with | length) runs passed"' "<dir>/aggregate-result.json"
  ```

  It counts a run only when its `passed` is true and its with-only indicators passed too. `passed` means a score of 1, whatever `--threshold` says. The score leaves the indicators out.
- When `claude --version` changes, check these JSON details again. They were first read in the CLI's code: `cases[].model` names the pin; `runsPerCase` is the case's own setting (3) even with `--runs 1`; `passed` is true exactly when the score is 1.
- Record each run in the table in `docs/compatibility.md`. With each row, record:
  - the commit (`git rev-parse --short HEAD`);
  - `claudeVersion` (and `claude --version`);
  - the agent model (`models`), the judge (`suite.judgeModel`), and the ablation and threshold, all from the first `jq`;
  - the runs per arm: the `--runs` you passed. The JSON's `runsPerCase` is the case's own setting, 3 by default, not the flag;
  - the skill-started count, from the second `jq`.
- Add the judges' cost, `jq '[.cases[].arms[][] | .judgeCostUsd // 0] | add' "$out/aggregate-result.json"`, to the paragraph above the rounds table, which gives it for each round.
- Judge a reply's What I added & why section from the with-skill arm only (`.arms.with`). Without the skill, its checks fail by design. Each `llm` grader's `evidence` holds the reply it judged.
- The README's real example is a full run's `image-midjourney-quick` reply (D52). When you replace it, name the model that the results record for it and the day of its `startedAt` on your machine's clock. That is how `docs/compatibility.md` dates runs: the UTC date in `startedAt` can be a day off.
- If you change SKILL.md wording that affects triggering, re-run the trigger tests.
  - Their 24-request set isn't in the repository (finding 39, D23), so rebuild one first. `docs/compatibility.md` describes the method and the kinds of requests under "Trigger tests". The Description tuning gotcha below applies.
  - If the original set turns up, commit it as `scripts/eval/trigger-set.json`, and add its re-run command to CONTRIBUTING.md's Behavior evals section.

## The interactive smoke test

Run it before a release's pull request leaves draft (D25). Follow the Claude Code checklist, `docs/manual-checks.md#claude-code-interactive` (findings 43 and 74).

- Use a new `CLAUDE_CONFIG_DIR` for every run, re-runs after a fix included. An installed copy changes only when the version in `plugin.json` changes and the plugin is updated. The version stays the same between releases (D41), so a configuration you used before can run an older copy.
- Use one add form throughout: `claude plugin marketplace add "https://github.com/vipul-goel/prompt-engine.git#<branch>"`, then `claude plugin install prompt-engine@vipul-goel`.
- Before testing, check that `jq -r '.plugins["prompt-engine@vipul-goel"][0].gitCommitSha' "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"` prints the same commit as `git ls-remote https://github.com/vipul-goel/prompt-engine.git refs/heads/<branch> | cut -f1`. The checklist says what to do when the field is missing or the commits differ.
- Start each Claude Code session with `claude --permission-mode manual`, and check that the status bar shows `⏸ manual mode on`, as the checklist says. Claude Code's docs say a terminal session starts in auto mode from 2.1.283. Auto mode saves a file without the permission prompt that the save check expects.
- Read-only shell commands run without a prompt in every mode. So judge the no-Bash check from the tool calls in the transcript viewer (Ctrl+O). The main screen can hide a Bash call: 2.1.319's showed a Bash `ls` as "Listed 1 directory".
- A new configuration folder first shows a theme picker, security notes and a folder trust dialog that starts on "No, exit". The checklist says what to pick.
- Then run `/prompt-engine write a blog post about remote work`, the checklist's imperative coding prompt (D32), and its release-notes prompt.
  - Run the release-notes prompt in a folder whose commits since its last tag outnumber what Claude Code's git status snapshot shows the model at the start (in 2.1.322, the five latest commits by hash and subject, without tags). Then finding the changes takes a lookup.
  - Any Bash call before a pick that runs the prompt fails those checks, a read-only `ls` or `git log` included, as finding 52's record says. The coding check picks Refine first, which runs nothing.
  - A subagent call fails them too. SKILL.md's Diagnose step and coding.md's first tip rule out handing the lookups to one.
  - Nothing executes before the pick, shell commands included (D32, and plan.md's Real UI list on the `maintainer-notes` branch). The method says to look things up without shell commands or subagents: SKILL.md's Diagnose step, questions.md's Don't-ask list, coding.md's first tip. If one happens, fix the method, not the check.
  - The eval runs grant Glob and Grep. A default session of the native build on macOS, Linux or WSL has Read and Bash but no Glob or Grep (Claude Code's tools reference, read 2026-11-10, and its changelog for 2.1.117, which left npm-installed builds unchanged). So there the method reads only the files it can name before the prompt runs, and the save check's lookup should be a Read call.
- Record the date, `claude --version`, the model that `/status` shows, the permission mode, the commit and the install URL in the Claude Code row of `docs/compatibility.md`. Update the Known limits line there about the dialog path, which gives the date of the last recorded check.

## Merging and releasing

- Two repository rulesets apply (D16). "Protect main" requires a pull request and the four CI checks, and blocks force pushes and deletion, with no bypass. "Release tags" lets only repository admins create, move or delete `v*` tags.
- Before merging to `main`, check that `npm view prompt-engine-mcp maintainers` lists `vipul-goel` (finding 37, D20). The docs' `npx -y prompt-engine-mcp` commands rely on it.
- To squash the WIP commits, use "Squash and merge" on GitHub instead of rewriting the pushed branch.
- Follow `docs/publishing.md` to cut a release. After the first release, do step 7 of its "Cut a release" list: delete the first-release notes in `README.md` and `docs/install.md`, the first-release sentence in step 3, and step 7 itself (finding 78).
- Ask the owner before pushing any tag or publishing to npm.
- Before the first tag, the owner adds npm's trusted publisher, no more than 2 days before pushing the first tag whose version isn't on npm (`docs/publishing.md`, One-time setup, step 1).
- CI needs no `NPM_TOKEN`. It publishes through trusted publishing (D15).

## Gotchas

- **Headless runs.** In `claude -p`, plugin eval runs and the Skills API, AskUserQuestion doesn't exist, so the skill uses the numbered text format. Interactive Claude Code shows dialogs. `claude -p` prints only the final message. That's why the skill keeps the output and the "What next?" menu in one message.
- **Nested runs.** When running `claude -p` or `claude plugin eval` from inside another Claude Code session, unset `CLAUDE_CODE_SESSION_ID` and `CLAUDE_CODE_REMOTE_SESSION_ID` first.
- **Description tuning.** If you tune the description with skill-creator's `run_loop`, run each query in its own project folder. Parallel runs that share one `.claude/commands/` folder see each other's copies and give false negatives.
- **Choosing eval cases.** `claude plugin eval --case` takes a single glob, with no braces and no repeats. Run several commands, or use `--tag`.
- **macOS.** There is no `timeout` command: use `perl -e 'alarm shift; exec @ARGV' <seconds> <command>`.
- **Commits from before D39's move.** Check one out only in a separate worktree. Those commits track `.claude/`. A checkout overwrites your ignored `.claude/` files without a warning, and checking out a later commit then deletes them.
- **Invisible characters in source.** The Edit tool can write a `\uXXXX` escape as the literal character. Write `\u{XXXX}` instead, and check the bytes after editing tests about invisible characters. In a regular expression, `\u{XXXX}` works only with the `u` flag: without it, `/^\u{FEFF}/` matches the text `u{FEFF}` and strips no BOM.
- **Headless skill runs.** `claude -p --safe-mode` also hides a plugin loaded with `--plugin-dir`. Without `--safe-mode`, your own installed and synced skills compete with it. `claude plugin eval --ablation none` runs only the skill arm, and `--output-dir` keeps results out of `evals/results/`.
- **Eval scoring.**
  - For a plugin path, `claude plugin eval` runs two arms by default. Graders that are with-only by default, such as `tool_used` on Skill, then become unscored indicators, unless they set `arm: both`, as the trigger cases' Skill checks do (D27). The `jq` gate in the full eval above and in `evals.yml` fails the run when an indicator fails.
  - Every history case (one with a `history.jsonl`) runs with the plugin only. `--threshold 0` makes `casesPassed` count failing cases.
  - Each case's `prompt.md` pins the agent model (D28), and the result JSON names it per case under `cases[].model`. `--model` overrides every pin but shows only under `suite.modelOverride`; `cases[].model` still names the pin. `--judge-model` shows under `suite.judgeModel`. A kept trace's init line also has the agent model.
  - Claude Code updates itself, so record `claude --version` with any result.
- **Cost.** Behavior evals and description tuning are billed model calls. Use `--runs 1` and `--max-cost-usd`. The cost that `claude plugin eval` prints, and records as `costUsd`, is the agent's alone. Each run's judge calls are recorded as `judgeCostUsd` and billed on top, a few percent more. The costs in these notes are the printed ones.
