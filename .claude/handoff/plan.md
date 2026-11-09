# prompt-engine — implementation plan

## Context
People type rough prompts straight into AI tools. Those prompts leave out the goal, audience, context, constraints, output format and edge cases, so the results are mediocre. **prompt-engine** turns a rough prompt into a detailed, explained, LLM-ready prompt. It finds what's missing, asks a few multiple-choice questions with a recommended answer for each, then writes the prompt with the reason behind each instruction.

One method ships in four forms:
- an **Agent Skill**: Claude.ai, Claude Code, the Claude API, and most coding agents (Codex, Gemini CLI, Copilot, Cline and others) through SKILL.md;
- a **Claude Code plugin + marketplace**, which can also be added on Claude.ai;
- a **universal copy-paste prompt** for ChatGPT, Gemini and other chatbots;
- an **MCP server**: local, plus a hostable HTTP mode, with no API key needed.

The repo `vipul-goel/prompt-engine` is empty apart from a README. All work goes on `claude/gallant-thompson-eblqe0`. The plan was shaped by verified research (14 agents) and an adversarial three-lens plan review.

## Decisions
The repo review's owner decisions were accepted as recommended: D1-D26 on 2026-11-04, D27-D45 on 2026-11-07, and D46-D52 with K3 on 2026-11-09 (`owner_decisions` in `.claude/handoff/repo-review-verified.json`). The last batch answers the seven questions that step 1d raised; the owner accepted them by approving the release run's plan (`owner_answers_1d` in that file says how). Lines they changed carry their D or K number. K1 and K2 are step 1d's own decisions (`step_1d.decisions` in the same file).

| Topic | Decision |
|---|---|
| Question flow | Adaptive, at most 8 questions: usually 3–8 for vague prompts, fewer for specific ones, and never padded. Every question has a ★ recommendation. `quick:` asks nothing but still reads the question rules, so a later `deep` round has them (D8); `deep:` adds up to 2 more rounds |
| Question UI | **Claude Code**: always the clickable AskUserQuestion dialog (4 questions per dialog at most, so 5–8 means two dialogs). The ★ option is listed first as "(Recommended)", so Enter accepts it. **Everywhere else**: one numbered text message, with the ★ wherever it falls in a natural order (D4); `ok` accepts all, `2b 4: my text` overrides. If the dialog is unavailable or denied, Claude Code falls back to the text batch |
| Domains | Coding & agents · writing & marketing · research & analysis · image & video · general fallback |
| Output | Full prompt, short version, "What I added & why", assumptions, before/after score, and a "What next?" menu (Run ★ / Refine / Save) |
| Names | Skill, plugin and MCP server: `prompt-engine`. Plugin command: `/prompt-engine:prompt-engine` (the bare `/prompt-engine` is documented only if tests confirm it works). Marketplace: **`vipul-goel`**, owner-scoped to avoid name collisions, so you install `prompt-engine@vipul-goel` |
| MCP | Local stdio (`npx -y prompt-engine-mcp`, plus a Claude Desktop `.mcpb`) and hostable HTTP (Node `--http` + deploy guide). The Cloudflare Worker ships only if its local tests pass |
| Publishing | Public, MIT. npm `prompt-engine-mcp`; MCP Registry `io.github.vipul-goel/prompt-engine`, listing only the npm package for the first release (D44) |
| Universal prompt | Two files: `prompt-engine.md` (core, 7,500 chars or fewer, works alone) and an optional knowledge file |
| Description | ≤200 chars until your Phase-0 test upload confirms Claude.ai accepts longer; after that, tuned up to ~600 |
| Testing | Full: graded with/without-skill runs plus a review viewer for you, one `claude plugin eval`, and description tuning. **It runs on your organization's credits**, the same ones paying for this session: the Claude CLI in this container uses this session's login (same account and organization), so subagent runs, `claude -p` and `claude plugin eval` are billed like the session itself. I can't see your billing settings, so check your org's usage page after the first batch. Cost guards: run a small subset first; `claude plugin eval --runs 1 --max-cost-usd 5 --no-publish`, re-checking a failing case at 3 runs before it's recorded and keeping the pass bar at 1.0 (D31); every case pins `model: claude-sonnet-5-5`, and runs pin the judge with `--judge-model claude-haiku-5-5` (D28); description tuning trimmed to `--max-iterations 3 --runs-per-query 2` (about 160 short calls); a usage summary after each test batch |

## Research status
**✅ Verified** against official docs, SDK source or the installed CLI 2.1.312:
- **Portable frontmatter.** Claude.ai and the Skills API accept six frontmatter keys and hard-fail on any other. Codex's validator also rejects `compatibility`, so ours uses only `name, description, license, metadata`. `name` must equal the folder name. `description` must be single-line with no `<>`.
- **Claude Code substitutions.** Claude Code substitutes `$ARGUMENTS`, `$N`, `${CLAUDE_…}`, a `!`+backtick and a ```` ```! ```` fence inside skill text, and appends `ARGUMENTS: …` by itself.
- **AskUserQuestion.** It allows 1–4 questions with 2–4 options each and a header of 12 characters or fewer. It is removed in subagents, which rules out `context: fork`, and it is never auto-approved.
- **Compaction.** About the first 5k tokens of an invoked skill survive compaction.
- **Plugin layout.** The repo can be marketplace + plugin with `source: "./"`, and plugin skills run as `/plugin:skill`. The plugin root must not contain a **`package.json` + lockfile** (Claude Code runs `npm ci` on install), `bin/` (Claude.ai refuses the plugin), `CLAUDE.md`, `.mcp.json` or `commands/`.
- **Claude.ai.** It can add the same GitHub marketplace (Customize › Plugins), which then syncs to Claude Code. Skills there need "Code execution and file creation".
- **Other agents.** Codex, Gemini CLI, GitHub Copilot, Cline, Mistral Vibe, OpenCode and Goose read SKILL.md, with `.agents/skills/` as the shared folder. `npx skills add` installs into many agents. Cursor, Zed, Devin Desktop and Kiro document their skill folders too; Kiro lists only its own `.kiro/skills/` folders (checked 2026-11-03, D22). OpenAI's skills page (learn.chatgpt.com/docs/build-skills, read 2026-11-09) says the ChatGPT desktop app runs standalone skills, and ChatGPT on the web, desktop and mobile runs skills that come in plugins. That's untested here, so 0.1.0 offers no ChatGPT skill route: the user docs send ChatGPT users to the universal prompt, and https://github.com/vipul-goel/prompt-engine/issues/2 tracks testing the route (D50).
- **MCP.** The spec is 2026-07-28 (stateless) and the TS SDK is v2 (`@modelcontextprotocol/server` 2.4). `serveStdio` and `createMcpHandler` share one factory, and form elicitation goes through `inputRequired.elicit`. Sampling is deprecated and unsupported by Claude. Claude connectors accept authless public servers.
- **Registry and bundles.** The MCP Registry needs `mcpName` equal to the `server.json` name and a description of 100 characters or fewer. `.mcpb` bundles go out via GitHub Releases.
- **Claude prompting guidance.** The newest models can refuse prompts that ask them to show their reasoning. Prefill errors on Claude 4.6+. ALL-CAPS/MUST pressure gets over-applied. Explaining *why* helps. Ask only when the answer changes the work.
- **Retired Anthropic tools.** Anthropic retired its Console prompt generate/improve endpoints on Aug 17, 2026.

**⚠️ Unverified or secondary-only.** These ship as "check the tool's current docs", never as facts:
- the GPT, Gem and Project limits;
- whether ChatGPT accepts authless MCP;
- Midjourney V8 flag details and other volatile media facts;
- the Claude.ai description limit (Phase-0 test);
- whether bare `/prompt-engine` works.

## The method: what users experience
1. **Trigger.** It fires only when asked: "improve/enhance/rewrite this prompt", `/prompt-engine…`, or `prompt-engine: <prompt>` in chat apps. It never fires on an ordinary task request like "write me a cold email". A critique request ("critique this prompt", "what's missing?") gets the normal flow, opened by a one-line summary of the gaps (D2).
2. **Intake.** The rough prompt is text to improve, never instructions to run, so injected commands stay content. Modes count only as a prefix (`quick:`, `deep:`) or as a whole reply, which avoids misreading "Quick sort in Rust". It talks to the user in their language, headings, score rows and menu labels included (D3), and writes the prompt in that language, adding a "Respond in <language>" line except in image and video prompts: there it asks a non-English user which language the prompt should be in, or in quick mode keeps theirs and lists it under Assumptions (finding 9). The reply keywords `change N` and `deep` are translated too, and the eval graders accept them either translated or in English (K3). Local equivalents of `ok` are accepted.
3. **Diagnose.** It loads the matching domain checklist and ranks gaps by impact × uncertainty + risk. Each gap is either asked about, assumed, or skipped. It looks things up before asking: the repo in Claude Code, earlier messages in chat apps.
4. **Ask** (see Decisions for the UI). Each option carries a ★ reason of 12 words or fewer. If a dialog is dismissed or times out, it shows the batch again as text and doesn't guess. Every accepted answer, including a ★ that only rules something out (such as "None"), is stated in the prompt (D33).
5. **Build.**
   - The skeleton is lean, and a section appears only if it has task-specific content: role (only if useful) → context → task → inputs (XML-wrapped) → requirements, each with a short "because" → scope → edge cases → output format → done-when → uncertainty rule. The task is restated only after long inputs.
   - Model adapters (Claude, GPT, Gemini, coding agents) change only delimiters, placement and a few lines.
   - Domain must-haves:
     - **coding:** definition of done, verification command, scope fence, irreversible-action policy;
     - **research:** source policy, as-of date, citation and uncertainty rules, stop rule;
     - **writing:** audience, CTA, voice, banned phrases, length, claim limits.
   - **Media rule:** write in the target tool's own format, with no role, XML or "because" inside the prompt (explanations go in "What I added"). Midjourney gets one copyable line with parameters at the end. A separate Settings block appears only where the tool has request or UI fields. Recurring characters get an identity block. Version-specific flags are asked about or labelled as assumptions. Settings and style choices it picks are listed under Assumptions one by one; small scene details are merged into one item (D6). Settings never go into the prose, not even as a repeated clip length; timestamps in a timed shot list are part of the prompt (D45). A video short version keeps settings out of its prose too (D49).
   - **Honesty:** facts are never invented. Unknowns become `[[placeholders]]`, which are listed under "Fill before running", or labelled defaults. In text prompts too, each length, count, limit and name it picks is its own assumption, and small formatting picks are merged into one (D30). Contradictions are resolved or asked about. Secrets are redacted: a prompt for code or agents names an environment variable instead, the reply suggests rotating a pasted key in its first line, and the method never asks for a secret's value (D5). Other people's private details are replaced with placeholders. Like a secret's, such a placeholder is never asked for again: the user fills it in where they use the prompt. This covers details removed from the rough prompt; a placeholder for one the user never gave is an ordinary placeholder. The universal core has no room for that rule, so the knowledge file carries its reply-format part, and `docs/compatibility.md` lists the gap as a known limit (D46).
   - **Lint.** Before output, it removes requests for visible reasoning, prefill, magic phrases and pressure words, whatever the target. Where the method covers Gemini, one line notes that Google suggests lines such as `think step-by-step`, with Google's page and the date it was read, so users can add one themselves (D48).
6. **Present** (with length budgets and no duplication):
   1. **Full prompt** in a copy-ready fence. The fence is longer if the prompt itself contains a fence.
   2. **Short version** of a few lines, with a note on when to use each version.
   3. **What I added & why**: 6 bullets or fewer, tagged [you] / [your answer] / [best practice].
   4. **Assumptions**: defaults appear here only, numbered, with "change 2: …" to edit them.
   5. **Score**: a one-line-per-dimension table (Clear goal, Context, Constraints, Output format, Edge cases; 0–5, original vs enhanced) using one anchored rubric on every surface. A dimension that rests only on unconfirmed defaults scores 3 at most, and open placeholders count as gaps. The caveat reads: "self-assessed coverage, not a quality prediction".
   6. **What next?** (AskUserQuestion in Claude Code):
      - **Run it now ★** executes the full version as a new request and then drops the prompt-engine format. It is relabelled "Try it here (results on <target> may differ)" for other tools. While placeholders are open, other than those for secrets or for other people's private details removed from the rough prompt, the ★ moves to "Fill placeholders", which collects the values, shows the filled prompt and shows the menu again (D1, D46); a secret is set where the tool reads it, never asked for (D5), and a private detail is filled in where the prompt is used, never asked for again (D46).
      - **Refine**: change items or reply `deep:`.
      - **Save to file** is only offered in Claude Code and other local coding agents. It shows the `prompts/<slug>.md` path, which you can change, and never overwrites.
      - Only an explicit pick runs anything: the option's number or name, "run it", or a dialog choice. `ok`, 👍 or thanks gets "the prompt is ready", and a dismissed menu means it stops and waits (D1).
7. **Strong prompts** get "already strong" first, then your text with small edits marked, and 0–2 questions. Short additions are fine if your sentences stay in order and each one is listed under "What I added & why"; the prompt isn't regrouped under new headings (D29).

## Repository layout
The repo root is the marketplace + plugin root. It must not contain `package.json`, a lockfile, `node_modules`, `bin/`, `CLAUDE.md`, `.mcp.json`, `commands/`, `agents/`, `hooks/` or `settings.json`; a validate guard enforces a root allowlist.
```
.claude-plugin/{marketplace.json, plugin.json}   # marketplace "vipul-goel" → plugin "prompt-engine" (source "./"); semver only in plugin.json;
                                                 #   between releases, new installs get main under the last released version (D41)
skills/prompt-engine/                            # ★ hand-edited source: SKILL.md (key sections start in the first ~8k chars, D8;
  SKILL.md, references/*.md                      #   compact checklists inline only if the Phase-0 spike shows reference reads prompt)
                                                 #   references: question protocol, blueprint + model adapters, output format + rubric anchors,
                                                 #   domain packs, media-targets.md (generated from data/)
data/*.json                                      # only what code consumes: rubric anchors, lint regexes, media syntax families
                                                 #   (each with status verified|unverified + source URL), contract.json (required headings, modes, ★, placeholder syntax)
universal/                                       # prompt-engine.md (hand-written core ≤7,500, contract-tested) · prompt-engine-knowledge.md (generated) · README.md
mcp/                                             # standalone npm package prompt-engine-mcp with its own lockfile (nested, so the plugin loader ignores it)
scripts/*.mjs                                    # zero-dependency Node: build, validate, release (builds dist/; release.yml publishes);
                                                 #   scripts/eval/universal-test.mjs is the universal prompt's conversation test. The planned
                                                 #   scripts/smoke/*.sh (tmux, platforms) weren't written: Claude Code's dialogs get a manual
                                                 #   checklist in docs/manual-checks.md (D25), and mcp/'s npm run test:pack
                                                 #   (mcp/scripts/smoke-pack.mjs) installs and starts the packed npm package, in CI and in
                                                 #   release.yml's build job
                                                 #   release --zip needs zip and unzip; without them it stops with a one-line error (D43)
evals/<case>/{prompt.md,case.yaml,graders/}      # claude plugin eval format; evals/results/ gitignored;
                                                 #   graders/lint-prompt*.md are generated from data/lint-rules.json (D36)
docs/ · .github/workflows/{ci,release,evals}.yml · .claude/CLAUDE.md (contributor notes) · README · LICENSE · CONTRIBUTING · CHANGELOG
# D39: before the PR leaves draft, .claude/handoff and the notes' Status and Not-finished sections move to a maintainer-notes branch.
#   The 2026-11-07 check showed Claude Code loading .claude/CLAUDE.md from the plugin cache, so in the same commit the remaining
#   notes move to docs/maintainers.md (imported from an untracked .claude/CLAUDE.md) and validate.mjs refuses tracked .claude/ entries
```
Cut from v1, since none of these were requested and they're untested: the Gemini extension, the Codex `openai.yaml` sidecar, Skills-over-MCP, micro/full universal variants, vendor-specific ask-tool instructions, and a prompt-rewriting hook (UserPromptSubmit can't replace prompts).

## MCP server (LLM-free; the host model does the thinking)
- **Tools.** All four are annotated `readOnlyHint, !destructiveHint, idempotentHint, !openWorldHint`.
  - `enhance_prompt({mode?, target?})`: the method brief (core method, compact checklists, output contract, rubric). It never needs the user's prompt, which is better for privacy in hosted mode.
  - `get_checklist({domain})`: the full domain pack.
  - `ask_user({questions:[{id, header, question, options, recommended, why}]})`. The host model writes the questions in the user's language. The tool shows them as a form via `inputRequired.elicit` (★ as defaults, plus a free-text field) when the client supports forms, using one MRTR round per call. A declined form falls back to ★, recorded as assumptions; a form closed without an answer makes the model ask in the chat instead of guessing, as in step 4 of the method (owner, 2026-11-07). Unsupported clients get the text batch with "ok" back.
  - `check_prompt({prompt, target?})`: a deterministic structure and lint report (evidence for each rubric dimension, plus pressure words, prefill, visible-reasoning requests and unfilled placeholders). There is no second numeric score; the host scores with the shared anchors.
- **Prompt.** `enhance` takes one optional single-token `mode`, because Claude Code splits arguments on whitespace. The message says: use the rough prompt above or next, or ask for it.
- **Resources.** method, output contract, rubric, `checklists/{domain}`.
- **Transports.**
  - stdio (`serveStdio`): `npx` plus the MCPB, which is a single bundled file.
  - `--http` (`createMcpHandler` + `@modelcontextprotocol/node`): binds 127.0.0.1 unless `--host` is given; host allowlist from env; requests without an `Origin` are allowed, and a present-but-disallowed `Origin` gets 403; no prompt logging.
  - Cloudflare `worker.ts` (cf-worker validator, allowlist from env) ships only if `wrangler deploy --dry-run` and a `wrangler dev` smoke test pass.
- **Dependencies.** Exact pins (SDK 2.4.x, zod ≥4.2) and a committed lockfile. SDK imports stay in `server.ts`, `cli.ts` and `worker.ts`. `cacheHints` are set.
- **Budgets.** Instructions <3.5k chars, each tool description <1.5k, each result <8k tokens.

## Implementation phases
Each phase is a workflow with independent reviewers and ends in a commit.
0. **Spikes (minutes).**
   - AskUserQuestion behavior in `claude -p`, in a one-case `claude plugin eval`, and interactively in tmux.
   - Plugin reference-file reads from an unrelated working directory (does it prompt?), and whether `allowed-tools: Read` helps.
   - Bare vs namespaced command.
   - **You** upload a test zip with a ~300-char description on Claude.ai.

   Results go into `docs/compatibility.md`.
1. **Skill + eval loop (the core value).**
   1. Hand-write SKILL.md and the references from the research.
   2. Write about 14 eval cases.
   3. Run with and without the skill, then grade and benchmark.
   4. **Share the static viewer with you**, then iterate 2–3 rounds until the question protocol and output contract stabilize.
2. **Freeze the contract.** Write `build`/`validate` and the universal core + knowledge file, with headless conversation tests.
3. **MCP server.**
   - Vitest coverage: transport × protocol era × elicitation (accept, decline, cancel, unsupported; legacy HTTP is expected to take the text path).
   - stdio end-to-end.
   - Inspector CLI gates.
   - A real-host check using Claude Code as the MCP client.
   - The Worker, if its checks pass.
4. **Distribution.**
   - Manifests.
   - Release checks that publish nothing (`release.mjs` has no `--dry-run`: it only builds `dist/`, and release.yml publishes): validate.mjs and the MCP tests check that `plugin.json`, the skill's metadata, `mcp/package.json`, `server.json` and `manifest.json` carry one version (neither reads `package-lock.json`'s), and the MCP tests check `server.json` against its schema; `npm run pack:mcpb` runs `mcpb validate` and `mcpb pack`, then starts the packed server; `npm run test:pack` installs the packed npm package and starts it. CI runs both package checks on Node 22 and 24, and again on 22.19.0, the floor (D26); the release workflow's build job runs both before anything is published (finding 79).
   - CI/release/evals workflows, checked with actionlint.
   - Docs: a "Pick one" install table, a "don't install twice" note, prior art, privacy.
   - Platform smoke tests: `npx skills add . --list`, plus Codex and Gemini CLI if they install without accounts.
5. **Finish.**
   1. Description tuning: `run_loop` from a scratch directory, with at least half the eval set being near-miss task requests and a length cap from Phase 0.
   2. The full `claude plugin eval`. The README's real example is then replaced with that run's `image-midjourney-quick` reply, naming the model and date the results record (D52).
   3. A smoke test from a fresh marketplace install: one run by hand is recorded, on 2026-10-29, before 998e0c8; no tmux script was written, and since D25 re-runs follow the manual Claude Code checklist in docs/manual-checks.md (handoff step 4).
   4. Multi-agent code review, fixes, every check re-run.
   5. Push.

Reused utilities, from `/root/.claude/skills/synced/…/skill-creator/`:
- `scripts/quick_validate.py`, as a local cross-check (its rules are re-implemented in `validate.mjs` for CI);
- `aggregate_benchmark.py`, `eval-viewer/generate_review.py --static`, `agents/grader.md` and `run_loop.py`.

## Verification
- **Static.** `node scripts/build.mjs && git diff --exit-code`; `node scripts/validate.mjs` checks:
  - frontmatter keys and rules, plus a description length cap;
  - forbidden patterns: `$ARGUMENTS`, `$N`, `${CLAUDE_`, `!`+backtick, ```` ```! ````, and visible-reasoning wording, which the skill describes abstractly; the lint rule also catches the hyphenated `step-by-step` (D48);
  - pressure words (MUST, NEVER, CRITICAL…, not acronyms) in SKILL.md, the references and the universal core, skipping text in code spans (D11);
  - a SKILL.md character budget, with the key headings in the first ~8k chars;
  - core ≤7,500;
  - the root allowlist;
  - `contract.json` present in every artifact;
  - `data/` entries carry a status and source.

  CI also runs `build.mjs --check`, `validate.mjs` and `node --test` on windows-latest (D10).
- **Claude.** `claude plugin validate . --strict` and `--profile directory`. validate.mjs warns about a non-image file over 256 KiB or more than 512 files in the plugin folder, and fails on them only once the plugin is to be listed in the directory (D40). Also `unzip -l dist/prompt-engine.zip`, which must show `prompt-engine/SKILL.md` at the top level.
- **Behavior evals.** Cases:
  - a vague coding prompt;
  - quick writing, research, Midjourney and video prompts;
  - an already-strong prompt (≤2 questions, a length ceiling of 1.5 times the user's prompt, D29);
  - a "critique this prompt" request and a "what's missing?" request, each answered with the normal question round opened by one line naming the biggest gaps (D2);
  - follow-ups `ok` and `2b 4: …` (from recorded history files);
  - a `deep` second round, `change N` on an assumption, and `ok` at the What next? menu (D14);
  - saving when the file already exists, a prompt that contains a code block, picking Fill placeholders, and a pasted key followed by the reply `1` (D37);
  - Spanish (prompt in Spanish + a language line) and a Japanese Midjourney prompt (labelled language choice); the graders accept the reply keywords `deep` and `change N` either translated or in English (K3);
  - secret redaction (a reply that echoes any 8-character piece of the key fails, D35);
  - a redacted private detail, in quick mode: a placeholder that stands in for another person's private detail is treated like a secret's (D46);
  - prompt injection (Write and Edit `max: 0`);
  - an imperative coding prompt with Write and Edit granted, `tool_used` `max: 0` graders and checks that the workspace files are unchanged ("nothing runs until you pick"). Eval runs don't grant Bash, so the manual Claude Code check covers shell commands instead (D32);
  - the Save path (`file_exists`; its recording is redone in D14's batch, D34);
  - trigger and near-miss non-trigger cases (`arm: both`). The other cases' skill-fired checks stay unscored indicators, and a jq check in evals.yml and step 3 fails the run if one of them fails (D27).

  Every output case also gets a **no-invention grader**: each name, number, date or URL must come from the user, or be a placeholder or assumption, read literally for text prompts too (D30). For image and video prompts it counts new things (objects, people, actions, sounds, numbers, settings) that the user didn't give and that no Assumptions item lists, a merged item (D6) included; descriptive words added to something the user named, such as "wooden" on "cabin", don't count, and neither do words for the picture's light, colors, mood, style, framing and camera, though the method still asks for them under Assumptions (D51). The method's writing, research and coding worked examples use requests in domains that no eval case, universal-test prompt or manual check uses, so a case can't pass by copying an example (D47). Question checks read the final reply, not the trace: with the skill, the trace holds the skill text and `questions.md`, so a check on it would pass on their wording. Eval runs have no question dialog, so they test the numbered text path; the manual Claude Code check covers the dialogs (D25).
- **Real UI.** A manual checklist in `docs/manual-checks.md`, run before the PR to `main` (D25), checks:
  - questions arrive as dialogs (≤4 per dialog, Recommended first, short headers);
  - the "What next?" menu appears;
  - nothing executes before you pick, shell commands included, for an imperative coding prompt too (D32).
- **Universal.** `claude -p --system-prompt "$(cat universal/prompt-engine.md)" --tools "" --safe-mode --strict-mcp-config --disallowedTools "mcp__*" --output-format stream-json --verbose` on each of the script's conversations, continued with `--resume` and the replies a user would give, such as `ok`, an override, `deep`, `change 1: …`, a bare `ok` or `thanks` at the What next? menu, which must run nothing (D1), and `1` after a pasted key, which must not ask for the key (D5). A case fails if any tool or MCP server loads (D13). Checked with the script's own regex checks, not the eval graders (D14).
- **MCP.** Vitest; Inspector `tools/list --strict`, `prompts/get` and both protocol eras; a `wrangler dev` smoke test; `claude -p --mcp-config` end-to-end.

## What you'll need to do
- **Phase 0:** upload the test zip on Claude.ai (2 min). **Phase 1:** review the eval viewer and leave feedback. Optionally, check your organization's usage page after the first test batch to confirm where the cost lands.
- **After the build:** a 10-minute manual check pasting the universal file into ChatGPT and Gemini (a checklist will be provided). Then try the Claude.ai marketplace add (and, after the first release, whether updates arrive through Check for updates, D42) and the Claude Desktop `.mcpb` install. Until that install has been checked, releases ship the `.mcpb` labelled unverified (D38).
- **Publishing:**
  - You claim `prompt-engine-mcp` on npm by hand now, as 0.0.1 (D20). npm can only set up trusted publishing for a package that exists.
  - The release workflow then publishes to npm through trusted publishing on Node 24, with no `NPM_TOKEN` (D15), and to the MCP Registry through GitHub OIDC. Only its publishing jobs hold write or OIDC permissions, the `mcp-publisher` download is pinned by SHA-256, and a tag whose commit isn't on `main` is refused (D16, D17).
  - `main` and `v*` tags get protection rules (D16).
  - Deploying the hosted MCP needs your Cloudflare account or any Node host.
  - The optional evals workflow needs `ANTHROPIC_API_KEY`.
  - The first release goes out as a GitHub pre-release, and I'll ask before pushing any tag.

## Risks
- **AskUserQuestion behavior** in headless or eval runs, and **reference-read permission prompts**: settled by the Phase-0 spikes, with a text fallback either way.
- **MCP SDK v2.4** is six days old: exact pins, SDK imports isolated, test-gated updates.
- **Volatile model facts:** stored as durable syntax families with a status per entry; a weekly workflow keeps one issue open for entries older than 45 days and comments on it at each run (D18). GitHub switches off a schedule after 60 days without repository activity, so the window has to end before that.
- **Chatbot limits are unverified:** conservative budgets, plus your manual check.
