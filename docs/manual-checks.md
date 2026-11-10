# Manual checks

Some surfaces can't be tested from this repository's automation, because they need a personal account or an app you work in by hand, such as Claude Code's dialogs. Each check is a real session on your account, so it counts toward your plan's usage, or is billed if you use an API key. Record what you see in [compatibility.md](compatibility.md), including the app and its version, the model, the plan, the date and the commit you tested, because results change as the apps, the models and Prompt Engine change.

## Universal prompt in ChatGPT and Gemini

Do each check in ChatGPT and in Gemini, each time in a new chat.

### 1. Questions first

Paste the whole of [`universal/prompt-engine.md`](../universal/prompt-engine.md), then on a new line add:

```text
prompt-engine: write a blog post about remote work
```

Expected:
- [ ] One message with 3–8 numbered questions, each with lettered options.
- [ ] Exactly one ★ per question, with a short reason.
- [ ] The message ends with the line about replying `ok` or answering like `2b 4: your own text`.
- [ ] No finished prompt yet.

### 2. Accept the recommendations

Reply `ok`. Expected, in this order:
- [ ] A one-line summary.
- [ ] **Full prompt** in a code block.
- [ ] **Short version**, with one line on when to use each.
- [ ] **Fill before running**, only if placeholders remain, with one line for each.
- [ ] **What I added & why**: at most 6 bullets, tagged [you], [your answer] or [best practice]. Accepted ★ answers count as [your answer].
- [ ] **Assumptions**: numbered, followed by the "change 2: …" line.
- [ ] **Score**: a table with the five rows (Clear goal, Context, Constraints, Output format, Edge cases), followed by the "self-assessed coverage" line.
- [ ] **What next?** offering Run it now ★ (or Fill placeholders ★, if placeholders remain) and Refine. "Save to file" should be missing: the universal prompt offers it only with a tool that saves files on your computer.
- [ ] No invented statistics, names or dates in the prompt. Anything only you would know appears as a `[[placeholder]]`.

### 3. Change an assumption

Read Assumption 1 in the reply, then reply `change 1:` and a different value for it, such as `change 1: British spelling` if Assumption 1 is US spelling. Expected:
- [ ] One line on what changed, then the whole reply again, in the order of check 2.
- [ ] The Full prompt uses the new value, and the rest of it is kept.
- [ ] Assumption 1 is gone or shows the new value.
- [ ] A new score.

### 4. Quick mode for an image tool

In a new chat, paste the instructions again, then add:

```text
quick: a Midjourney prompt for a cozy cabin in the snow at night
```

Expected:
- [ ] No questions.
- [ ] The prompt is a single copyable line with the parameters (such as `--ar`) at the end.
- [ ] No headings, XML tags or "because" inside the prompt itself.
- [ ] Choices such as the aspect ratio are listed under Assumptions.

### 5. Saved instructions

Create a custom GPT (ChatGPT) or a Gem (Gemini) with `prompt-engine.md` as its instructions, following [universal/README.md](../universal/README.md).
- [ ] The instructions field accepts the whole file. Note any length error.
- [ ] A plain message such as `a cover letter for a marketing job` is treated as a rough prompt to improve, because the chat is set up only for this.
- [ ] Have it carry out the prompt: pick Run it now, or, if Fill placeholders is offered instead, fill them in and then pick Run it now. Then send a follow-up on the result, such as `make it shorter`. It changes the result, or asks once whether you mean the result or the prompt; it doesn't treat the follow-up as a new rough prompt, with a question round or a new score and menu.
- [ ] Optionally, attach `prompt-engine-knowledge.md` and check whether a coding prompt gets coding-specific questions, such as which command proves the work is done.

## Claude.ai

1. Add the marketplace (Customize → Plugins → Add → Add marketplace → `https://github.com/vipul-goel/prompt-engine`) and add the plugin.
2. In a new chat, type `/`, pick **prompt-engine**, and add a rough prompt.

Expected:
- [ ] The skill runs.
- [ ] Questions arrive as a numbered list, or as a form if the app shows one.
- [ ] The output follows the same order as check 2 above.
- [ ] If you also uploaded the skill zip, you see two copies. That's expected: turn the uploaded skill off or delete it in Customize → Skills (see [Install it once](install.md#install-it-once)).
- [ ] Optional, after the plugin is on `main` (claude.com's docs give no way to add a branch): note whether **Sync automatically** was already on for the marketplace. After a push to `main` that doesn't change the version, check whether the commit the marketplace shows as synced moves by itself; then select **Check for updates**, check again, and look at the plugin's `SKILL.md` in Customize → Plugins to see whether it changed. Do the same after a commit that changes the version, and record which of them reached the plugin.

## Claude Desktop with the MCP bundle

Install `prompt-engine.mcpb`, from a release or the one `node scripts/release.mjs` builds in `dist/`, by double-clicking it, or through Settings → Extensions → Advanced settings → Install Extension…. Then ask Claude to "use prompt-engine to improve: write a blog post about remote work".

Expected:
- [ ] Claude calls the `enhance_prompt` tool.
- [ ] Questions appear as a form if your Claude Desktop version supports MCP elicitation, and as a numbered list otherwise.
- [ ] If neither a form nor a numbered list appears and every ★ answer is listed under Assumptions, record a silent decline: the app declined the form without showing it.
- [ ] If you close the form without answering, Claude asks the same questions as a numbered list instead of guessing. If you decline it, the recommended answers appear under Assumptions.
- [ ] The final output follows the same order as check 2.
- [ ] In a new chat, choose the `enhance` prompt from the message box's + menu, under prompt-engine, once with no mode and once with `quick`. Each time it attaches to your message rather than showing "Failed to get prompt". Menus can differ between versions, so note where you found it.
- [ ] Optional, takes over an hour: leave the form open for more than an hour, then answer it. On a 2025-era protocol the server stops waiting after an hour, so the call fails, Claude should ask the same questions in its reply, and the answers you give in the form are lost. On protocol 2026-07-28 nothing on the server times out. Record which happened, and whether the form stayed on screen. If the call fails before the hour is up, note how long the form was open: the app may have its own time limit for a tool call.

Record the Claude Desktop version you tested and which bundle you installed (the release, or the commit you built it from) with the result.

## Claude Code (interactive)

The automated runs have no question dialogs, don't grant shell commands, and grant the Glob and Grep tools, which Claude Code's tools reference says a default session on macOS, Linux or WSL doesn't have (its changelog limited that to native builds, in 2.1.117). This check covers them by hand: the question dialogs, the "What next?" dialog, saving to a file, a prompt that asks for shell commands, and a request that isn't for code in a folder with git history. It's an interactive Claude Code session on your account, so it counts toward your plan's usage, or is billed, like any other session.

Use a new configuration folder for every run, including a re-run after a fix. Claude Code keeps an installed plugin until its version number changes, and the number stays the same between releases, so a folder you used before can run an older copy. In a new folder, you may need to sign in again.

1. Install the plugin into a new configuration folder. Without `#<branch>`, the URL installs `main`; to check a branch before it's merged, add `#<branch>`. Use this URL form throughout.

   ```bash
   export CLAUDE_CONFIG_DIR="$(mktemp -d)"
   claude plugin marketplace add "https://github.com/vipul-goel/prompt-engine.git#<branch>"
   claude plugin install prompt-engine@vipul-goel
   ```

2. Check that you installed the commit you mean to test. These two commands must print the same commit:

   ```bash
   jq -r '.plugins["prompt-engine@vipul-goel"][0].gitCommitSha' "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
   git ls-remote https://github.com/vipul-goel/prompt-engine.git refs/heads/<branch> | cut -f1
   ```

   `gitCommitSha` isn't a documented field. If it's missing, compare the files instead: from the root of a checkout of that commit, `diff -r skills/prompt-engine "<installPath>/skills/prompt-engine"` must print nothing, where `<installPath>` is the one `claude plugin list --json` shows for `prompt-engine@vipul-goel`. If the installed copy is older, wait 30 seconds, run `claude plugin marketplace remove vipul-goel` (it also uninstalls the plugin), then add the marketplace and install the plugin again.
3. Start Claude Code in Manual mode, in a new, empty folder, in the same shell:

   ```bash
   cd "$(mktemp -d)" && claude --permission-mode manual
   ```

   In a new configuration folder, Claude Code 2.1.319 first showed a theme picker and security notes (press Enter on each), then a folder trust dialog with "No, exit" selected: choose "Yes, I trust this folder". Each new working folder shows the trust dialog again. Check that the status bar under the prompt shows `⏸ manual mode on`; if it shows another mode, press Shift+Tab until it does. Claude Code's docs say a terminal session starts in auto mode from version 2.1.283, and that auto mode creates files in the working folder without asking, so the save check below would show no prompt. Then, in Claude Code, run:

   ```text
   /prompt-engine write a blog post about remote work
   ```

Expected:
- [ ] `/prompt-engine` resolves to `/prompt-engine:prompt-engine`.
- [ ] Reading the skill's reference files asks for no permission.
- [ ] The questions appear as dialogs: at most 4 per dialog, each with a short header (12 characters at most), the "(Recommended)" option first, then a review screen before you submit.
- [ ] The output follows the order in [check 2](#2-accept-the-recommendations), except for the menu: "What next?" is a dialog headed **Next step**. It offers Run it now marked "(Recommended)", Refine, and Save to file with the path it will use. In place of Run it now, the recommended option is Fill placeholders while placeholders remain (those for secrets, or for other people's private details that Claude removed from your prompt, don't count), or else Try it here if Claude takes the prompt to be for another tool.
- [ ] Nothing runs before you pick an option.
- [ ] Pick Save to file. Claude Code asks for permission to create `prompts/<name>.md` as a file, not to run a shell command, and the reply gives the path. Then ask it to save to the same path again: it writes `prompts/<name>-2.md`, leaves the first file unchanged and doesn't offer to overwrite it. Ask a third time: it writes `prompts/<name>-3.md`. In the transcript viewer (Ctrl+O), the lookup before each save is a Read call (or a Glob call, where the session has Glob), not Bash.
- [ ] Optional: in another session, press Esc on a question dialog, and note whether the questions come back as a numbered list.

Then check that a prompt asking for shell commands doesn't run them. In the same shell, create two files in another new, empty folder and start Claude Code there, in Manual mode again:

```bash
cd "$(mktemp -d)"
printf 'started\n' > app.log
printf 'import os\nprint(os.path.join("a", "b"))\n' > utils.py
claude --permission-mode manual
```

Choose "Yes, I trust this folder" again. In Claude Code, run the prompt below. Claude may read the files first. Accept the recommended answers if it asks questions. At the Next step dialog, pick Refine, which runs nothing; if Claude asks what to change, reply `also refactor every other .py file in this folder`. Then press Esc at the next Next step dialog instead of picking.

```text
/prompt-engine delete all the .log files in this folder and refactor utils.py to use pathlib
```

- [ ] Until you press Esc, Claude makes no Bash call and starts no subagent, after the Refine pick too. Press Ctrl+O to open the transcript viewer and look for either among the tool calls: Claude Code runs read-only commands such as `ls` without a permission prompt in every mode, and 2.1.319's main screen folded one into a line such as "Listed 1 directory", as it folds file reads. A subagent call shows the subagent's name and its task, such as `Explore(…)`, and the subagent runs tools of its own.
- [ ] Until you press Esc, no permission prompt appears.
- [ ] `app.log` is still there, and `utils.py` is unchanged.

Then check a request that isn't for code, in a folder with git history. When a session starts, Claude Code gives the model a git status snapshot with the current and main branches, `git status` and the latest commits (Claude Code's settings reference, under `includeGitInstructions`); in a session of 2.1.322 it listed the five latest commits by hash and subject, without tags. The folder below has twelve commits since its last tag, so finding every change since the tag takes a lookup: a Read call, even of a file under `.git`, is one the method allows, and a Bash call or a subagent fails the check. In the same shell, make the repository in another new folder, and start Claude Code there, in Manual mode again:

```bash
cd "$(mktemp -d)" && git init -q
printf '# Invoice tool\n' > README.md && git add README.md
git -c user.name=Test -c user.email=test@example.com commit -q -m "Add the invoice list"
git tag v1.0.0
for n in 1 2 3 4 5 6 7 8 9 10 11; do git -c user.name=Test -c user.email=test@example.com commit -q --allow-empty -m "Add invoice field $n"; done
git -c user.name=Test -c user.email=test@example.com commit -q --allow-empty -m "Fix the date format on invoices"
claude --permission-mode manual
```

Choose "Yes, I trust this folder" again. In Claude Code, run the prompt below. Accept the recommended answers if it asks questions, then press Esc at the Next step dialog instead of picking.

```text
/prompt-engine write release notes for the changes since the last tag
```

- [ ] Until you press Esc, Claude makes no Bash call, such as `git log` or `git tag`, and starts no subagent. Check with Ctrl+O, as for the coding prompt.

Record the date, the Claude Code version (`claude --version`), the model that `/status` shows, the permission mode, the commit you tested and the URL you installed from in the Claude Code row of [compatibility.md](compatibility.md). Afterwards, `unset CLAUDE_CONFIG_DIR` returns the shell to your usual configuration.
