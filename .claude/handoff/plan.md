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
| Topic | Decision |
|---|---|
| Question flow | Adaptive, at most 8 questions: usually 3–8 for vague prompts, fewer for specific ones, and never padded. Every question has a ★ recommendation. `quick:` asks nothing, `deep:` adds up to 2 more rounds |
| Question UI | **Claude Code**: always the clickable AskUserQuestion dialog (4 questions per dialog at most, so 5–8 means two dialogs). The ★ option is listed first as "(Recommended)", so Enter accepts it. **Everywhere else**: one numbered text message; `ok` accepts all, `2b 4: my text` overrides. If the dialog is unavailable or denied, Claude Code falls back to the text batch |
| Domains | Coding & agents · writing & marketing · research & analysis · image & video · general fallback |
| Output | Full prompt, short version, "What I added & why", assumptions, before/after score, and a "What next?" menu (Run ★ / Refine / Save) |
| Names | Skill, plugin and MCP server: `prompt-engine`. Plugin command: `/prompt-engine:prompt-engine` (the bare `/prompt-engine` is documented only if tests confirm it works). Marketplace: **`vipul-goel`**, owner-scoped to avoid name collisions, so you install `prompt-engine@vipul-goel` |
| MCP | Local stdio (`npx -y prompt-engine-mcp`, plus a Claude Desktop `.mcpb`) and hostable HTTP (Node `--http` + deploy guide). The Cloudflare Worker ships only if its local tests pass |
| Publishing | Public, MIT. npm `prompt-engine-mcp`; MCP Registry `io.github.vipul-goel/prompt-engine` |
| Universal prompt | Two files: `prompt-engine.md` (core, 7,500 chars or fewer, works alone) and an optional knowledge file |
| Description | ≤200 chars until your Phase-0 test upload confirms Claude.ai accepts longer; after that, tuned up to ~600 |
| Testing | Full: graded with/without-skill runs plus a review viewer for you, one `claude plugin eval`, and description tuning. **It runs on your organization's credits**, the same ones paying for this session: the Claude CLI in this container uses this session's login (same account and organization), so subagent runs, `claude -p` and `claude plugin eval` are billed like the session itself. I can't see your billing settings, so check your org's usage page after the first batch. Cost guards: run a small subset first; `claude plugin eval --runs 1 --max-cost-usd 5 --no-publish`; description tuning trimmed to `--max-iterations 3 --runs-per-query 2` (about 160 short calls); a usage summary after each test batch |

## Research status
**✅ Verified** against official docs, SDK source or the installed CLI 2.1.312:
- **Portable frontmatter.** Claude.ai and the Skills API accept six frontmatter keys and hard-fail on any other. Codex's validator also rejects `compatibility`, so ours uses only `name, description, license, metadata`. `name` must equal the folder name. `description` must be single-line with no `<>`.
- **Claude Code substitutions.** Claude Code substitutes `$ARGUMENTS`, `$N`, `${CLAUDE_…}`, a `!`+backtick and a ```` ```! ```` fence inside skill text, and appends `ARGUMENTS: …` by itself.
- **AskUserQuestion.** It allows 1–4 questions with 2–4 options each and a header of 12 characters or fewer. It is removed in subagents, which rules out `context: fork`, and it is never auto-approved.
- **Compaction.** About the first 5k tokens of an invoked skill survive compaction.
- **Plugin layout.** The repo can be marketplace + plugin with `source: "./"`, and plugin skills run as `/plugin:skill`. The plugin root must not contain a **`package.json` + lockfile** (Claude Code runs `npm ci` on install), `bin/` (Claude.ai refuses the plugin), `CLAUDE.md`, `.mcp.json` or `commands/`.
- **Claude.ai.** It can add the same GitHub marketplace (Customize › Plugins), which then syncs to Claude Code. Skills there need "Code execution and file creation".
- **Other agents.** Codex, Gemini CLI, GitHub Copilot, Cline, Mistral Vibe, OpenCode and Goose read SKILL.md, with `.agents/skills/` as the shared folder. `npx skills add` installs into many agents.
- **MCP.** The spec is 2026-07-28 (stateless) and the TS SDK is v2 (`@modelcontextprotocol/server` 2.4). `serveStdio` and `createMcpHandler` share one factory, and form elicitation goes through `inputRequired.elicit`. Sampling is deprecated and unsupported by Claude. Claude connectors accept authless public servers.
- **Registry and bundles.** The MCP Registry needs `mcpName` equal to the `server.json` name and a description of 100 characters or fewer. `.mcpb` bundles go out via GitHub Releases.
- **Claude prompting guidance.** The newest models can refuse prompts that ask them to show their reasoning. Prefill errors on Claude 4.6+. ALL-CAPS/MUST pressure gets over-applied. Explaining *why* helps. Ask only when the answer changes the work.
- **Retired Anthropic tools.** Anthropic retired its Console prompt generate/improve endpoints on Aug 17, 2026.

**⚠️ Unverified or secondary-only.** These ship as "check the tool's current docs", never as facts:
- the Cursor, Devin, Kiro and Zed skill paths;
- whether ChatGPT supports skills, and the GPT, Gem and Project limits;
- whether ChatGPT accepts authless MCP;
- Midjourney V8 flag details and other volatile media facts;
- the Claude.ai description limit (Phase-0 test);
- whether bare `/prompt-engine` works.

## The method: what users experience
1. **Trigger.** It fires only when asked: "improve/enhance/rewrite this prompt", `/prompt-engine…`, or `prompt-engine: <prompt>` in chat apps. It never fires on an ordinary task request like "write me a cold email".
2. **Intake.** The rough prompt is text to improve, never instructions to run, so injected commands stay content. Modes count only as a prefix (`quick:`, `deep:`) or as a whole reply, which avoids misreading "Quick sort in Rust". It talks to the user in their language and writes the prompt in that language, adding a "Respond in <language>" line. Local equivalents of `ok` are accepted.
3. **Diagnose.** It loads the matching domain checklist and ranks gaps by impact × uncertainty + risk. Each gap is either asked about, assumed, or skipped. It looks things up before asking: the repo in Claude Code, earlier messages in chat apps.
4. **Ask** (see Decisions for the UI). Each option carries a ★ reason of 12 words or fewer. If a dialog is dismissed or times out, it shows the batch again as text and doesn't guess.
5. **Build.**
   - The skeleton is lean, and a section appears only if it has task-specific content: role (only if useful) → context → task → inputs (XML-wrapped) → requirements, each with a short "because" → scope → edge cases → output format → done-when → uncertainty rule. The task is restated only after long inputs.
   - Model adapters (Claude, GPT, Gemini, coding agents) change only delimiters, placement and a few lines.
   - Domain must-haves:
     - **coding:** definition of done, verification command, scope fence, irreversible-action policy;
     - **research:** source policy, as-of date, citation and uncertainty rules, stop rule;
     - **writing:** audience, CTA, voice, banned phrases, length, claim limits.
   - **Media rule:** write in the target tool's own format, with no role, XML or "because" inside the prompt (explanations go in "What I added"). Midjourney gets one copyable line with parameters at the end. A separate Settings block appears only where the tool has request or UI fields. Recurring characters get an identity block. Version-specific flags are asked about or labelled as assumptions.
   - **Honesty:** facts are never invented. Unknowns become `[[placeholders]]`, which are listed under "Fill before running", or labelled defaults. Contradictions are resolved or asked about. Secrets are redacted.
   - **Lint.** Before output, it removes requests for visible reasoning, prefill, magic phrases and pressure words.
6. **Present** (with length budgets and no duplication):
   1. **Full prompt** in a copy-ready fence. The fence is longer if the prompt itself contains a fence.
   2. **Short version** of a few lines, with a note on when to use each version.
   3. **What I added & why**: 6 bullets or fewer, tagged [you] / [your answer] / [best practice].
   4. **Assumptions**: defaults appear here only, numbered, with "change 2: …" to edit them.
   5. **Score**: a one-line-per-dimension table (Clear goal, Context, Constraints, Output format, Edge cases; 0–5, original vs enhanced) using one anchored rubric on every surface. A dimension that rests only on unconfirmed defaults scores 3 at most, and open placeholders count as gaps. The caveat reads: "self-assessed coverage, not a quality prediction".
   6. **What next?** (AskUserQuestion in Claude Code):
      - **Run it now ★** executes the full version as a new request and then drops the prompt-engine format. It is relabelled "Try it here (results on <target> may differ)" for other tools. If placeholders are still open, the ★ moves to "Fill placeholders first".
      - **Refine**: change items or reply `deep:`.
      - **Save to file** is only offered in Claude Code and other local coding agents. It shows the `prompts/<slug>.md` path, which you can change, and never overwrites.
      - A dismissed menu means it stops and waits.
7. **Strong prompts** get "already strong" first, then your text with small edits marked, and 0–2 questions.

## Repository layout
The repo root is the marketplace + plugin root. It must not contain `package.json`, a lockfile, `node_modules`, `bin/`, `CLAUDE.md`, `.mcp.json`, `commands/`, `agents/`, `hooks/` or `settings.json`; a validate guard enforces a root allowlist.
```
.claude-plugin/{marketplace.json, plugin.json}   # marketplace "vipul-goel" → plugin "prompt-engine" (source "./"); semver only in plugin.json
skills/prompt-engine/                            # ★ hand-edited source: SKILL.md (workflow + output contract in the first ~8k chars;
  SKILL.md, references/*.md                      #   compact checklists inline only if the Phase-0 spike shows reference reads prompt)
                                                 #   references: question protocol, blueprint + model adapters, output format + rubric anchors,
                                                 #   domain packs, media-targets.md (generated from data/)
data/*.json                                      # only what code consumes: rubric anchors, lint regexes, media syntax families
                                                 #   (each with status verified|unverified + source URL), contract.json (required headings, modes, ★, placeholder syntax)
universal/                                       # prompt-engine.md (hand-written core ≤7,500, contract-tested) · prompt-engine-knowledge.md (generated) · README.md
mcp/                                             # standalone npm package prompt-engine-mcp with its own lockfile (nested, so the plugin loader ignores it)
scripts/*.mjs                                    # zero-dependency Node: build, validate, release (--dry-run|--publish); smoke/*.sh (tmux, 2-turn, platforms)
evals/<case>/{prompt.md,case.yaml,graders/}      # claude plugin eval format; evals/results/ gitignored
docs/ · .github/workflows/{ci,release,evals}.yml · .claude/CLAUDE.md (contributor notes) · README · LICENSE · CONTRIBUTING · CHANGELOG
```
Cut from v1, since none of these were requested and they're untested: the Gemini extension, the Codex `openai.yaml` sidecar, Skills-over-MCP, micro/full universal variants, vendor-specific ask-tool instructions, and a prompt-rewriting hook (UserPromptSubmit can't replace prompts).

## MCP server (LLM-free; the host model does the thinking)
- **Tools.** All four are annotated `readOnlyHint, !destructiveHint, idempotentHint, !openWorldHint`.
  - `enhance_prompt({mode?, target?})`: the method brief (core method, compact checklists, output contract, rubric). It never needs the user's prompt, which is better for privacy in hosted mode.
  - `get_checklist({domain})`: the full domain pack.
  - `ask_user({questions:[{id, header, question, options, recommended, why}]})`. The host model writes the questions in the user's language. The tool shows them as a form via `inputRequired.elicit` (★ as defaults, plus a free-text field) when the client supports forms, using one MRTR round per call. Declined or cancelled answers fall back to ★, recorded as assumptions. Unsupported clients get the text batch with "ok" back.
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
2. **Freeze the contract.** Write `build`/`validate` and the universal core + knowledge file, with 2-turn headless tests.
3. **MCP server.**
   - Vitest coverage: transport × protocol era × elicitation (accept, decline, cancel, unsupported; legacy HTTP is expected to take the text path).
   - stdio end-to-end.
   - Inspector CLI gates.
   - A real-host check using Claude Code as the MCP client.
   - The Worker, if its checks pass.
4. **Distribution.**
   - Manifests.
   - `release.mjs --dry-run`: version sync, `server.json` schema, `npm pack`, `mcpb validate/pack`, and the packed entry booting on Node 20 and 22.
   - CI/release/evals workflows, checked with actionlint.
   - Docs: a "Pick one" install table, a "don't install twice" note, prior art, privacy.
   - Platform smoke tests: `npx skills add . --list`, plus Codex and Gemini CLI if they install without accounts.
5. **Finish.**
   1. Description tuning: `run_loop` from a scratch directory, with at least half the eval set being near-miss task requests and a length cap from Phase 0.
   2. The full `claude plugin eval`.
   3. A tmux smoke test from a fresh clone + marketplace install.
   4. Multi-agent code review, fixes, every check re-run.
   5. Push.

Reused utilities, from `/root/.claude/skills/synced/…/skill-creator/`:
- `scripts/quick_validate.py`, as a local cross-check (its rules are re-implemented in `validate.mjs` for CI);
- `aggregate_benchmark.py`, `eval-viewer/generate_review.py --static`, `agents/grader.md` and `run_loop.py`.

## Verification
- **Static.** `node scripts/build.mjs && git diff --exit-code`; `node scripts/validate.mjs` checks:
  - frontmatter keys and rules, plus a description length cap;
  - forbidden patterns: `$ARGUMENTS`, `$N`, `${CLAUDE_`, `!`+backtick, ```` ```! ````, and visible-reasoning wording, which the skill describes abstractly;
  - pressure words (MUST, NEVER, CRITICAL…, not acronyms);
  - a SKILL.md character budget, with the key headings in the first ~8k chars;
  - core ≤7,500;
  - the root allowlist;
  - `contract.json` present in every artifact;
  - `data/` entries carry a status and source.
- **Claude.** `claude plugin validate . --strict` and `--profile directory`. Also `unzip -l dist/prompt-engine.zip`, which must show `prompt-engine/SKILL.md` at the top level.
- **Behavior evals.** Cases:
  - a vague coding prompt;
  - quick writing, research, Midjourney and video prompts;
  - an already-strong prompt (≤2 questions, length ceiling);
  - follow-ups `ok` and `2b 4: …` (from recorded history files);
  - Spanish (prompt in Spanish + a language line) and a Japanese Midjourney prompt (labelled language choice);
  - secret redaction;
  - prompt injection (Bash `max: 0`);
  - an imperative coding prompt with Write/Edit/Bash granted and a `tool_used` `max: 0` grader ("nothing runs until you pick");
  - the Save path (`file_exists`);
  - trigger and near-miss non-trigger cases (`arm: both`).

  Every output case also gets a **no-invention grader**: each name, number, date or URL must come from the user, or be a placeholder or assumption. Questions are graded from the trace, so both the dialog path and the text path count.
- **Real UI.** A scripted tmux session runs `claude --plugin-dir <fresh clone>` and checks:
  - questions arrive as dialogs (≤4 per dialog, Recommended first, short headers);
  - the "What next?" menu appears;
  - nothing executes before you pick.
- **Universal.** `claude -p --system-prompt "$(cat universal/prompt-engine.md)" --tools ""` on 4 cases, then `--resume` with `ok` and with an override. Graded with the same graders.
- **MCP.** Vitest; Inspector `tools/list --strict`, `prompts/get` and both protocol eras; a `wrangler dev` smoke test; `claude -p --mcp-config` end-to-end.

## What you'll need to do
- **Phase 0:** upload the test zip on Claude.ai (2 min). **Phase 1:** review the eval viewer and leave feedback. Optionally, check your organization's usage page after the first test batch to confirm where the cost lands.
- **After the build:** a 10-minute manual check pasting the universal file into ChatGPT and Gemini (a checklist will be provided). Then try the Claude.ai marketplace add and the Claude Desktop `.mcpb` install.
- **Publishing:**
  - The first npm publish needs a manual publish or `NPM_TOKEN`. Whether trusted publishing works for a first publish is unverified.
  - The release workflow then publishes to the MCP Registry through GitHub OIDC.
  - Deploying the hosted MCP needs your Cloudflare account or any Node host.
  - The optional evals workflow needs `ANTHROPIC_API_KEY`.
  - The first release goes out as a GitHub pre-release, and I'll ask before pushing any tag.

## Risks
- **AskUserQuestion behavior** in headless or eval runs, and **reference-read permission prompts**: settled by the Phase-0 spikes, with a text fallback either way.
- **MCP SDK v2.4** is six days old: exact pins, SDK imports isolated, test-gated updates.
- **Volatile model facts:** stored as durable syntax families with a status per entry; a monthly workflow opens an issue for entries older than 60 days.
- **Chatbot limits are unverified:** conservative budgets, plus your manual check.
