# Manual checks

Some surfaces can't be tested from this repository's automation because they need a personal account. These checks take about 10 minutes. Record what you see in [compatibility.md](compatibility.md), including the app, the plan and the date, because results change as apps update.

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
- [ ] **What I added & why**: at most 6 bullets, tagged [you], [your answer] or [best practice]. Accepted ★ answers count as [your answer].
- [ ] **Assumptions**: numbered, followed by the "change 2: …" line.
- [ ] **Score**: a table with the five rows (Clear goal, Context, Constraints, Output format, Edge cases), followed by the "self-assessed coverage" line.
- [ ] **What next?** offering Run it now ★ and Refine. "Save to file" should be missing, because chat apps can't write files.
- [ ] No invented statistics, names or dates in the prompt. Anything only you would know appears as a `[[placeholder]]`.

### 3. Change an assumption

Reply `change 1: make it for team managers`. Expected:
- [ ] An updated prompt.
- [ ] What changed.
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
- [ ] Optionally, attach `prompt-engine-knowledge.md` and check whether a coding prompt gets coding-specific questions, such as which command proves the work is done.

## Claude.ai

1. Add the marketplace (Customize → Plugins → Add marketplace → `https://github.com/vipul-goel/prompt-engine`) and add the plugin.
2. In a new chat, type `/`, pick **prompt-engine**, and add a rough prompt.

Expected:
- [ ] The skill runs.
- [ ] Questions arrive as a numbered list, or as a form if the app shows one.
- [ ] The output follows the same order as check 2 above.
- [ ] If you also uploaded the skill zip, you see two copies. That's expected; remove one.

## Claude Desktop with the MCP bundle

Install `prompt-engine.mcpb` from a release by double-clicking it, or through Settings → Extensions. Then ask Claude to "use prompt-engine to improve: write a blog post about remote work".

Expected:
- [ ] Claude calls the `enhance_prompt` tool.
- [ ] Questions appear as a form if your Claude Desktop version supports MCP elicitation, and as a numbered list otherwise.
- [ ] If you close the form without answering, Claude asks the same questions as a numbered list instead of guessing. If you decline it, the recommended answers appear under Assumptions.
- [ ] The final output follows the same order as check 2.
- [ ] Optional, takes over an hour: leave the form open for more than an hour, then answer it. On a 2025-era protocol the server stops waiting after an hour, so the call fails, Claude should ask the same questions in its reply, and the answers you give in the form are lost. On protocol 2026-07-28 nothing on the server times out. Record which happened, and whether the form stayed on screen. If the call fails before the hour is up, note how long the form was open: the app may have its own time limit for a tool call.
