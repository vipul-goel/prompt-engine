# Contributing

Thanks for helping. Bug reports, better checklists, new domains, eval cases and fixes to tool data are all welcome.

## How the repository fits together

One method ships in four formats, so most changes start in one place and flow out from there. [docs/architecture.md](docs/architecture.md) has the full picture.

| Kind of file | Files | How to change it |
|---|---|---|
| The method (single source) | `skills/prompt-engine/SKILL.md`, `skills/prompt-engine/references/*.md` | Edit by hand |
| Hand-written mirror | `universal/prompt-engine.md` | When you change the workflow or the output format in `SKILL.md`, make the same change here. Where it has no room for a rule, as for other people's private details (D46), list the gap under Known limits in `docs/compatibility.md`. It must stay within 7,500 characters |
| Data | `data/contract.json` (output contract, the lookup rule's wording and size budgets), `data/lint-rules.json`, `data/media-targets.json` | Edit by hand |
| Generated | `universal/prompt-engine-knowledge.md`, `skills/prompt-engine/references/media-targets.md`, `mcp/src/generated/content.ts`, the skill text inside `evals/*/history.jsonl`, and the lint graders `evals/*/graders/lint-prompt*.md` | Never edit; run `node scripts/build.mjs` |

## Setup

- **Node.js 22.19 or later.** That's the oldest version the project supports, and the MCP server's checks need it: `npm run test:inspector` runs the MCP Inspector, which stops with an error on older versions. The scripts in `scripts/` use only Node built-ins, so there's nothing to install at the repository root. `scripts/release.mjs` also needs the `zip` and `unzip` commands, and npm for the full release. `scripts/test/workflows.test.mjs` runs workflow steps under bash, and some of them need jq, tar and sha256sum: where one of these is missing it skips the runs that need it, and on Windows it skips them all, but on CI's Linux runner a missing one fails it.
- **No `package.json` at the root.** The root is also the Claude Code plugin root, and Claude Code runs `npm ci` when someone installs a plugin that has a `package.json` and a lockfile. The validator enforces this, along with the other files a plugin root must not contain.
- **Everything committed ships.** The plugin's source is the repository root (`"source": "./"` in `.claude-plugin/marketplace.json`), so every file committed to `main` reaches every Claude Code user who installs it from GitHub, twice: in the marketplace clone and in the plugin cache. Keep handoff notes, review records and large files off `main`. The validator warns about tracked files that Anthropic's plugin directory would hold for a reviewer: more than 512 of them, or a file that isn't an image or font and is 256 KiB or larger, or binary.
- **No memory files where the skill reads.** Claude Code can load memory files such as `CLAUDE.md` from a folder below a session's working directory once it reads a file there. So in a session started in a folder that holds the plugin cache, the skill's reads of its references can load such files from the plugin; [Known limits](docs/compatibility.md#known-limits) records a run that showed it. Besides a root `CLAUDE.md`, the validator refuses a tracked `AGENTS.md` or `CLAUDE.local.md` at the root, and a `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` or `.claude` in `skills/`, `skills/prompt-engine/` or its `references/` folder, tracked or not, because the skill zip is built from the folder on disk. It compares these names, and the other names the plugin root must not hold, in any letter case: on macOS and Windows, a look for `CLAUDE.md` opens `claude.md`.
- **For the MCP server:** `cd mcp && npm ci`.
- **[Claude Code](https://code.claude.com/docs)** for `claude plugin validate` and the behavior evals.

## Checks

Run these before opening a pull request. CI runs them too, with the script checks on both Linux and Windows. It also builds the skill zip, runs `claude plugin validate` with `--profile directory` added, and lints the workflow files with [actionlint](https://github.com/rhysd/actionlint) and shellcheck.

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

CI also runs `npm run test:pack`, which packs the build that `npm test` leaves in `dist/`, installs the package from its tarball and starts it (the install needs the npm registry), and `npm run pack:mcpb`, which packs the `.mcpb` bundle and starts its server. On Node 22 it then runs the Release workflow's build commands, which otherwise first run when a tag is pushed, without publishing anything: `node scripts/release.mjs --tag v<version>`, `npm pack`, and `npm run test:pack` on that tarball. Run them too when your change touches what the packages contain, their dependencies or how they start, or what `release.mjs` builds.

The validator explains each failure. The most common ones:
- **Generated file is stale.** Run `node scripts/build.mjs`.
- **Contract item missing.** Every heading, score dimension and marker in `data/contract.json` must appear in `SKILL.md`, `references/output-format.md` and the universal core. A heading counts only as a `##` to `####` heading followed by a colon or the end of its line, or as a **bold** label that starts a list item, so `### Score anchors` doesn't count as the `Score` heading. If you rename one, rename it everywhere. The same three files must state the condition for offering Save to file, a tool that saves files on the user's computer, which no eval checks in the skill: if you reword it, change `data/contract.json` and `scripts/test/save-offer.test.mjs` in the same commit. The contract also holds the wording of the lookup rule (no shell command or subagent until the user picks an option that runs the prompt) in `SKILL.md`, `references/questions.md` and `references/coding.md`, because no eval checks it: if you reword the rule, change its strings in `data/contract.json`, and the changes that `scripts/test/lookup-rule.test.mjs` makes to it, in the same commit.
- **Budget exceeded.** `SKILL.md` has a size budget, and its key sections must start within the first 8,000 characters. That's because Claude Code keeps only the first 5,000 tokens of an invoked skill after it compacts a long conversation; 8,000 characters is a deliberately conservative proxy for that. Move detail into a reference file instead.

If you change a file in `.github/workflows/`, also run `actionlint` on it. One of the script tests, `scripts/test/workflows.test.mjs`, checks the safeguards the workflows keep, such as each release job's permissions and the eval workflow's input checks; update it with the workflow when a change is deliberate. It reads the four workflow files, and fails on any other file in `.github/workflows` but those an operating system leaves there, such as `.DS_Store`, because GitHub runs every `.yml` and `.yaml` file there: a new workflow needs tests of its own. It runs the steps that hold a safeguard under bash, with stand-ins for gh, npm and curl, so nothing reaches GitHub, npm or the network: among them the release's on-main and tag checks, its MCP tests, the npm and MCP Registry publish steps and the data check's filter, and each step that downloads a tool, which must stop before an archive that doesn't match the pinned SHA-256 is unpacked, with errexit on or off. A step can tell those runs apart from a release, though: they have no tag ref and no OIDC token, and they run with stand-ins. So the runs, and the rules below, catch mistakes and plain switch-offs, but not a line that acts only in a release. That's why the test also pins each workflow, job by job, by the SHA-256 of what it holds, leaving out its comments and each action's version, which it checks on its own: any other change to a workflow fails the test until you update the pin in the same commit, and the failure gives the new SHA-256. Before you update a pin, read the change for what it does in a release.

Its rules fail on what would switch a safeguard off where it stands: `continue-on-error`, `|| true`, `set +e` or `shopt -u errexit`, a `shell` other than bash, an `if:` it doesn't list (GitHub reports a skipped job as passed, even for a required check), an `env:` variable it doesn't list (some, such as `BASH_ENV`, change how a step's shell starts), a job or step key it doesn't list (a job's `container:`, for one, runs each step in an image, under `sh`), a runner other than `ubuntu-latest` (`windows-latest` for the Windows job), an action input or a value of one that it doesn't list (a checkout's `ref:` or `repository:` would build another commit), and a script that writes to `GITHUB_ENV` or `GITHUB_PATH`. In the Release workflow, outside the package check, npm may only run `ci`, `run build`, `test`, `pack`, `view` and `publish`. The test reads the word after `npm` wherever `npm` stands, outside comments and what `echo` and `printf` print, and with quotes and backslashes taken out, so `NAME=value` words, a redirection, a wrapper such as `sudo`, `/usr/bin/env` or `find -exec`, or `"n"pm` don't hide it. No step there may run another package runner or fetcher (`npx`, `pnpm`, `yarn`, `bun`, `corepack`, `deno`, `pip`, `uv`, `wget`, `docker`, `podman`, `scp`, `sftp`, `rsync`, `ssh`, `ftp`, `nc`, `socat`, `svn`, `hg`, or `git clone`, `fetch` or `pull`), a `gh` command other than `release create` and `api` on the three endpoints the release reads (so not `gh api .../contents`), pipe into a shell or name a URL, in any letter case; and only the MCP Registry step may run `curl`, for its two calls. These rules read the commands as written, so one reached through a variable, a function or a program that doesn't name it gets past them: read each change to these jobs too.

The workflows name each action by the full commit SHA of a release, with the version in a comment (`actions/checkout@<sha> # v7.0.1`), because the publisher moves a tag such as `v7` to each new release. To update an action, look up the commit of its new release tag (for example `git ls-remote --tags https://github.com/actions/checkout.git`) and change the SHA and the comment together, in every workflow that uses it. The tools the workflows download, actionlint in `ci.yml` and `mcp-publisher` in `release.yml`, are pinned the same way, by a version and the SHA-256 next to it: update both together, then the job's pin in `scripts/test/workflows.test.mjs`.

## Writing guidelines for the method

These apply to `SKILL.md`, the references and the universal prompt, and to the prompts they produce.

- **Give the reason, not emphasis.** Explain why an instruction matters rather than writing it in capitals. In `SKILL.md`, the references and the universal prompt, the validator flags capitalized pressure words such as `MUST` or `NEVER` and requests to show the model's reasoning, which current Claude models may refuse. To name one of these patterns, for example to warn against it, put it in backticks: the check skips code spans, but not double-quoted text or fenced example prompts.
- **Stay portable.**
  - Frontmatter may only use `name`, `description`, `license`, `allowed-tools` and `metadata`, because Claude.ai and the Skills API reject other keys. Write each value as a single-line `"double-quoted string"` without `"` or `\` inside, or as one bare word, so that strict YAML parsers and Claude Code read it the same way. Open and close the frontmatter with a line of exactly `---`, and keep `---` out of the values: Claude Code ends the frontmatter at the first `---` after the opening line, wherever it is. Save `SKILL.md` as UTF-8 without a byte-order mark, which some skill validators refuse.
  - The description must be one line, without `<` or `>`, within the cap in `data/contract.json`.
  - Skill text must not use Claude Code's substitution syntax, such as `$ARGUMENTS` or `${CLAUDE_…}`; the validator lists every pattern.
- **Never present unverified facts as facts.** This applies to the method and to the prompts it writes: unknowns become `[[placeholders]]`, and defaults become labelled assumptions. Tool-specific details belong in `data/media-targets.json` with a verification status and sources.
- **Ask only questions whose answers change the result.** The scoring rule is in `references/questions.md`.

## Common changes

### Add or change a domain checklist

1. Write `skills/prompt-engine/references/<domain>.md`, starting with a `# Title` line.
2. In `SKILL.md`, make the "2. Diagnose" step point to it.
3. Add the file's name to `KNOWLEDGE_ORDER` in `scripts/build.mjs`, then run `node scripts/build.mjs`. This updates the universal knowledge file and the MCP server's content. `node scripts/validate.mjs` fails while a reference is missing from `KNOWLEDGE_ORDER`, or while `KNOWLEDGE_ORDER` names a file that doesn't exist.
4. Add the domain to `DOMAINS` in `mcp/src/brief.ts`, which also builds `get_checklist`'s list of accepted domains and the checklist resources. Then add it, in the same order as `DOMAINS`, to the five lists written out by hand: the brief's `get_checklist` step in `mcp/src/brief.ts`, and in `mcp/src/server.ts` the tool order in `INSTRUCTIONS`, the description of `get_checklist`'s `domain` field, `get_checklist`'s own description and the checklist template's description. `mcp/test/brief.test.ts` and `mcp/test/integration.test.ts` fail until `DOMAINS` and all five lists name it. Also update `get_checklist`'s description in `mcp/manifest.json`, which `mcp/test/manifests.test.ts` checks, and the tools table in `mcp/README.md`, whose list of domains no test checks.
5. Add at least one eval case that uses the new checklist.

### Update image or video tool data

Edit the tool's entry in `data/media-targets.json`:
- Set `status` to `verified` only if you checked the vendor's own documentation, `secondary` if you saw it only through search results or third parties, and `unverified` otherwise.
- List what you read in `sources`.
- Set `last_verified` to today's date.

Then run `node scripts/build.mjs`. A new entry needs an `id` that no other entry has, a `name` and a `kind`; the other keys it can have are the text fields that the existing entries use. The validator names any other key, which the build would leave out of `references/media-targets.md`.

### Edit the questions or output-format reference

The MCP server serves `references/questions.md` and `references/output-format.md` with the passages about Claude Code's AskUserQuestion dialog rewritten for its `ask_user` tool. `REFERENCE_ADAPTATIONS` in `mcp/src/brief.ts` finds them by pattern: the `## Format A` section up to the `## Format B` heading, the ` (all other apps)` suffix of that heading, the `(or "(Recommended)" in AskUserQuestion)` aside, and the paragraph that starts `In Claude Code, use AskUserQuestion`. After `node scripts/build.mjs`, `mcp/test/brief.test.ts` fails if an edit stops a pattern from matching exactly once or puts an H1 or H2 heading inside one of these passages. Update the pattern, or move the heading out.

### Add a lint rule

Add an entry to `data/lint-rules.json`. Each entry has an `id`, a JavaScript regular expression `pattern`, `flags`, a `severity` and a `message` that says what to do instead. Set `selfCheck: true` only if Prompt Engine's own instructions must never match it, and add a test for it in `scripts/test/validate.test.mjs`. Then run `node scripts/build.mjs`, which turns the rules into the eval graders `evals/<case>/graders/lint-prompt*.md`; it stops on a rule whose `flags` are other than empty or `i` until `LINT_FILES` in `scripts/build.mjs` names a file for them. It also stops on a pattern the graders can't carry: one that holds `---` or a raw line break (write `-{3}` or `\n`), a group named `f` or `g`, or a `^` or `$` outside a character class, which in a grader would match only at the start or end of the whole reply.

The MCP server's `check_prompt` tool uses the same rules on drafts of up to 100,000 characters from anyone who can reach the server. It matches one line at a time, after turning each control character into a space and each run of whitespace into one space, so a rule about tabs, double spaces or other whitespace never fires there. It matches a line over 2,300 characters in overlapping windows.

`check_prompt` skips a rule, and names it in its summary, if the pattern:
- is invalid, or uses something the check can't measure: a repeated lookaround, a `\q` escape under any flags (as in a `\q{…}` string under `v`), a `\c` that isn't followed by a letter, or under the `v` flag a property of strings such as `\p{RGI_Emoji}`;
- repeats without a bound (`*`, `+`, `{n,}`), more than `{0,200}` times, or repeats a group (`?` after a group is fine);
- uses a backreference;
- can match the empty string, as `(TODO)?` and `\b` can;
- has more than 1,000 ways to match from one position. Each repetition multiplies them by its number of choices (81 for `{0,80}`), each `?` adds one (skipping it), and alternatives add theirs up, so `[a-z]{0,200}[a-z]{0,200}` has 40,401;
- looks at more than 300 characters, so a match always fits in a window. This counts what a match consumes, what its lookarounds read, and one neighbour for each `\b`, `\B`, `^` and `$`, and each character counts as two under the `u` or `v` flag;
- takes more than 1,000 steps to try every way to match from one position. A step is a character read (two under the `u` or `v` flag, as above) or a `\b`, `\B`, `^` or `$`, and each part of the pattern is tried once for each way to match the parts before it. So `\[\[[^\[\]\n]{1,120}\]\]` takes 2 + 120 + 120 + 120 = 362 steps, but `[^x]{0,30}[^x]{0,30}x` takes 30 + 31 × 30 + 961 = 1,921: each of its 961 ways to match ends by trying the `x`. Without this limit, the two limits above would allow up to 300,000 steps.

The MCP tests fail if `check_prompt` skips a rule. These limits bound the work at each position of a draft, so the time grows linearly with the draft's length. They don't bound the time of a step, which depends on the pattern and the text: a `\p{…}` class under the `u` flag, for example, is much slower on letters outside ASCII than an ASCII class. `scripts/test/lint-rules.test.mjs` is a second, separate check: it times every rule on adversarial input built from the pattern's own pieces, including characters that two of its classes both match, and fails a rule that takes 100 ms or more on any of them in each of three tries.

## Behavior evals

The cases in `evals/` run with Claude Code's plugin eval runner, with and without the plugin. Each case folder holds `prompt.md`, `case.yaml` and `graders/*.md`; see Claude Code's [plugin eval docs](https://code.claude.com/docs/en/plugin-evals.md) for the format. `scripts/build.mjs` writes `graders/lint-prompt.md` and `graders/lint-prompt-i.md` for each case in its `LINT_GRADER_CASES`: add a new case whose reply holds an enhanced prompt there, and leave the `lint-prompt` names to those files. Such a case also needs an `llm` grader named `<n>-no-invention.md` that checks that every name, number, date or URL the user didn't give is a placeholder or an assumption; `node scripts/validate.mjs` fails the case without one. In an image or video case, that grader instead counts new things (objects, people, actions, sounds, numbers, settings) that the user didn't give and Assumptions doesn't list. Descriptive words added to something the user named, such as "wooden" on "cabin", don't count, and neither do words for the picture's light, colors, mood, style, framing and camera, though the method still asks for them under Assumptions, and a general label such as "background sounds" covers none of the sounds under it. In both kinds of case, an Assumption must state a number to cover it.

`claude plugin eval` runs each regex grader twice on the reply, synchronously and with no time limit, so a pattern that backtracks too much on a long reply holds up the whole run. `scripts/test/eval-grader-time.test.mjs` times every regex grader on long replies that repeat one piece, in Node and, where macOS's jsc shell or bun is installed, in JavaScriptCore, the engine of the Bun runtime that Claude Code runs in. Both facts about Claude Code were checked in version 2.1.321, the first in its code and the second in its binary; check them again when it changes. Start a pattern that can match anywhere in the reply with one `#`, not `#+`: `#\s*Full prompt` finds the same headings, while `#+` reads the rest of a long run of `#` from each `#` in it. Likewise, read the menu from its first heading on, with `^[^W]*(?:W(?!hat next\?)[^W]*)*What next\?`, not `[\s\S]*What next\?`, which JavaScriptCore tries again from every later `What next?`. Don't write that loop as `(?:(?!What next\?)[\s\S])*`, or use any other group that repeats at every character: after enough repeats in one match, JavaScriptCore stops and reports no match, with no error, so a `contains` grader fails a long reply and a `not_contains` grader passes it. With such loops, the menu graders failed correct replies from about 50 KB in Bun 1.4.4 and from about 128 KB in macOS's jsc, where the point moved with the shell's `maxRegExpStackSize` option. Written as above, the loops repeat at each W or w (the graders take the `i` flag) and at each run of `#`, and the open-placeholder condition still reads the Full prompt a line at a time, so the limit comes later, at a point that depends on the text: the menu graders matched correct replies of 3.2 MB of prose with one W in 67 characters in both, but in Bun failed some from 800 KB of prose with one w in 16 characters, from 200 KB of two-character lines in the Full prompt and from 50 KB of w's alone. The kept replies are under 6 KB, with at most about one w or W in 40 characters. Other checks that still have such loops reach the limit only on the text their loop reads: in Bun, the writing case's prompt-fenced check failed a correct reply with 600 KB of text inside its Full prompt and matched one with 400 KB, `followup-fill-placeholders`' 02 failed one with 400 KB in the prompt before the details it looks for and matched one with 300 KB, and the writing case's `lint-prompt-i` passed a lint hit after 600 KB of text and failed one after 400 KB. With the text elsewhere in the reply, each matched replies of 3.2 MB. The timing test also checks that the menu graders match long correct replies in JavaScriptCore.

Each case pins the agent under test in its `prompt.md` (`model: claude-sonnet-5-5`), so don't pass `--model`: it would replace every pin. `node scripts/validate.mjs` checks the case files before any billed run: the keys and values that `claude plugin eval` reads in `case.yaml`, `prompt.md` and each grader's front matter, the files they name, and this repository's own rules, whose messages end in "(repo rule)", such as one pinned model for every case, or a place in `LINT_GRADER_CASES` for every case with a `regex` grader that requires a match in the reply for a pattern that spells out the words `Full prompt`. It reads a small YAML subset and names the file and line of anything outside it. Four details follow from YAML:
- a no-break or ideographic space at the edge of a value stays part of the value, so use plain spaces there;
- lines of only spaces before or after the text of a `|` or `>` block can't be longer than the block's indentation, because YAML would read the extra spaces as text or refuse them;
- a `case.yaml` that holds nothing but comments counts as no `case.yaml`, for `claude plugin eval` too;
- a line that ends in CR CR LF, as in a file converted to CRLF twice, is two line breaks to YAML, so a `case.yaml`, `prompt.md` or grader with one is refused; save it with LF or CRLF line endings.

An `llm` judge isn't shown the case's request, so a rubric that judges the reply against it quotes it: in `<original_prompt>` tags, or in double quotes after the words "The user's whole request" on the same line, in any letter case and with any apostrophe. The validator holds that quote to the case's request, word for word and to the request's end. It reads only these two forms: a rubric that says "the user's entire request", or puts the request in single quotes, isn't checked, and one whose opening `<original_prompt>` tag holds more than its name and white space, such as an attribute, is refused, since the validator can't read it. In a history case's rubric, it also holds each double-quoted text to the recorded conversation, but not single-quoted text.

In a run with and without the plugin, `claude plugin eval` leaves the checks that the skill started (`tool_used` on Skill) out of the score unless they set `arm: both`, because without the plugin the skill can't start. It reports them as indicators, so a run in which the skill never started can still pass; the `jq` lines below check them, and work on any run's `aggregate-result.json`. The trigger cases' skill checks set `arm: both`, which the validator requires, so `trigger-natural-phrasing`, which expects the skill to start, fails its run without the plugin by design: it scores 0.5 when its other check passes. The validator also requires such a check's `input_match`, which the runner tests against each Skill call's input as JSON text, to match every form of a call that starts prompt-engine, such as `{"skill":"prompt-engine:prompt-engine"}`: one that matches none counts no call, and can't tell whether the skill started. The cases that resume a recorded conversation run with the plugin only.

Evals make real model calls on your account and are billed. Start with a subset and a cost ceiling:

```bash
claude plugin eval . --case 'image-*' --runs 1 --max-cost-usd 1 --no-publish --judge-model claude-haiku-5-5
```

`--runs 1` runs each case once per arm, instead of the `runs` the case sets, 3 by default. `--judge-model claude-haiku-5-5` pins the judge, which is otherwise the model Claude Code uses for background tasks, so that scores from different runs come from the same judge. `--no-publish` keeps the HTML report on your machine; without it, Claude Code also publishes the report as a private artifact when your claude.ai account can.

For the full suite, write the results to a folder and check the indicators with `jq`, as the evals workflow does. The full suite cost about $2 on 2026-11-04.

```bash
out="evals/results/full-$(date +%Y%m%d-%H%M%S)"
claude plugin eval . --runs 1 --max-cost-usd 5 --no-publish --judge-model claude-haiku-5-5 \
  --allow-tools Write Edit --scaffold --output-dir "$out"
jq -r '[.cases[].arms.with[]?.graders[]? | select(.name | test("-skill-fired$"))] | "Skill started in \(map(select(.passed)) | length) of \(length) runs"' "$out/aggregate-result.json"
jq -r '.cases[] | .name as $n | .arms.with[]?.graders[]? | select(.withOnly and (.passed | not)) | "Indicator failed: \($n) (\(.name))"' "$out/aggregate-result.json"
jq -e '[.cases[].arms.with[]?.graders[]? | select(.withOnly)] as $i | ($i | length) > 0 and ([$i[] | select(.passed | not)] | length) == 0' "$out/aggregate-result.json"
```

The last command prints `false` and exits 1 when an indicator failed, or when the results hold none; the one before it names each failed indicator.

- **Cases that need write tools or a scaffold.** A case's `allowed_tools` can only enable read-only tools, such as Read and Grep. Write, Edit and other tools come only from `--allow-tools`, and that grant reaches every case in the run. The cases tagged `needs-write` need `--allow-tools Write Edit --scaffold`, and so does the full suite. Without the grant, `imperative-coding-no-action`, `injection-is-content-quick`, the two `followup-menu-*` cases and `save-to-file-existing` fail their tools-granted check, and `save-to-file` and `save-to-file-existing` fail their saved-file checks; without `--scaffold`, `imperative-coding-no-action` fails its workspace checks, because the files they read aren't there, and `save-to-file-existing` fails its checks that the save left an existing file alone and went to a `-2` name, because no file is in the way. To re-run only these cases (the three of them that existed on 2026-11-04 cost about $0.35 together in that day's run):

  ```bash
  claude plugin eval . --tag needs-write --allow-tools Write Edit --scaffold --runs 1 --max-cost-usd 1 --no-publish --judge-model claude-haiku-5-5
  ```

  The validator requires the `needs-write` tag on a case that lists a tool outside the read-only set or has a `scaffold_script`. Read a case's `scaffold_script` before you run it.
- **Follow-up cases.** These resume a recorded first turn. Record one with `node scripts/eval/record-history.mjs evals/<case>/history.jsonl "<first message>"`. It records on `claude-sonnet-5-5` unless you pass `--model`, and the validator fails a history case recorded on a different model from the one the case pins. Before the billed call, the script checks that it can write the file, whose folder must exist, refuses a first message that looks private and checks that it can find Claude Code's transcript folder (`$CLAUDE_CONFIG_DIR` or `~/.claude`). It pre-approves Read only in the skill's folder, but Claude Code's documentation says the skill's own `allowed-tools: Read` pre-approves every read during the turn that invokes it, so other files can still end up in a recording. From the transcript, the script keeps only the conversation and, outside thinking blocks, which stay as recorded, rewrites the plugin, working and home folders where a path starts, and the session ID. It refuses to write a file that still holds one of those folders where no path starts, such as glued to an option (`-I<folder>/include`), which it can't tell from another path, or that contains what looks like a key, token, e-mail address, home path or this machine's name; but no scan recognises every secret or another machine's name. `node scripts/validate.mjs` runs the same scan, without the checks for this machine's home folder and name, on every committed `history.jsonl`. Read the file before you commit it anyway. Afterwards, `node scripts/build.mjs` keeps the skill text and reference reads inside the recording up to date. It doesn't change what the model said, so re-record when a recorded turn (a question round, an output or a menu) no longer matches the method, or when the build stops with "re-record it". `node scripts/validate.mjs` reports a recording whose last assistant turn is neither a question round nor a whole output with its What next? menu, that calls or searches for AskUserQuestion, or whose last assistant row didn't end its turn. Each run of a follow-up case also appends the resumed session to `evals/<case>/<session-id>.jsonl` (`00000000-0000-4000-8000-000000000001.jsonl` for recordings made by `record-history.mjs`). Git ignores these files. You can delete them between runs.
- **Results.** They go to `evals/results/`, which is ignored by git. Run transcripts can include details of your account, so don't commit them.
- **Universal prompt.** It has its own conversation test, `node scripts/eval/universal-test.mjs`, which runs the prompt on Claude through `claude -p` with no tools or MCP servers loaded. It makes billed calls too.
- **Reading outputs side by side.** Run `node scripts/eval/to-review.mjs <results folder>/aggregate-result.json <workspace>/iteration-1` on a run's results (a `--json` file works too); pass `--keep-temp` to the eval run to also get each run's tool calls, which the viewer shows as `tool-calls.md` next to the reply. It writes the `eval-<case>/<arm>/run-<k>/` layout that skill-creator's `aggregate_benchmark.py` and `eval-viewer/generate_review.py` read, checked by reading their code in anthropics/skills at 3d59511 and in the claude.ai example skill-creator of 2026-10-28. Without `--keep-temp`, each reply comes from the evidence that an `llm` judge of the last message was shown, when the case has one. Without skill-creator, `report.html` in the results folder shows each run's graders and the evidence each `llm` judge was shown.

When you change the method, include the eval summary, with and without the skill, and the skill-started count in your pull request.

## Pull requests

- Describe the behavior change. If you changed the method, include the before and after output for one prompt.
- Add a line under "Unreleased" in `CHANGELOG.md`.
- Leave version numbers alone; they're set at release time (see [docs/publishing.md](docs/publishing.md)).
- Contributions are accepted under the [MIT License](LICENSE).

## Reporting problems

Open an issue with the rough prompt, the app and model you used, what you expected and what happened. If you use the Claude Code plugin, add the `version`, `installedAt` and `lastUpdated` that `claude plugin list --json` shows for `prompt-engine@vipul-goel`: the version number stays the same until the next release, so the dates help narrow down which copy you have. Remove anything private first.

If you find a way that Prompt Engine could leak data or act without the user choosing to, don't post the details publicly. Use the repository's private vulnerability reporting (Security tab) if it's enabled, or open an issue asking for a private contact.
