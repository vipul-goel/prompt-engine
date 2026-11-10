# Use Prompt Engine in any chatbot

These files let you use Prompt Engine in any chat app by pasting `prompt-engine.md` in, with nothing to install: ChatGPT, Gemini, Microsoft Copilot, Perplexity, Grok, Le Chat and others. (On Claude, Claude Code, Codex, Gemini CLI, Copilot in VS Code and most coding agents, install the skill instead. See the main [README](../README.md).)

| File | What it is | Size |
|---|---|---|
| [`prompt-engine.md`](prompt-engine.md) | The instructions. Works on its own. | just under 7,500 characters |
| [`prompt-engine-knowledge.md`](prompt-engine-knowledge.md) | Optional detailed checklists for coding, writing, research, image and video prompts | about 70,000 characters |

## Quickest: paste into any chat

1. Open a new chat in any AI app.
2. Paste the whole of `prompt-engine.md` as your first message.
3. In the same message, or the next one, add `prompt-engine: <your rough prompt>`.
4. Answer the questions it asks. Reply `ok` to accept every ★ recommendation, or answer like `2b 4: your own text`.

This works for that one chat. Start your rough prompt with `quick:` to skip the questions, or with `deep:` for a more thorough interview.

## Set it up once

Most apps let you save instructions so every chat starts with them. Menu names change over time, so look for the closest match.

**ChatGPT: a custom GPT**
1. Create a GPT (Explore GPTs, then Create, then Configure).
2. Paste `prompt-engine.md` into **Instructions**.
3. Optionally, upload `prompt-engine-knowledge.md` under **Knowledge**.
4. Suggested conversation starters: `prompt-engine: write a blog post about remote work`, `quick: a Midjourney prompt for a cozy cabin at night`, `deep: instructions for an agent that refactors my billing module`.

In a GPT made only for this, each new request is treated as a rough prompt to improve, without `prompt-engine:`. Answers to its questions, menu picks, `change N` replies and follow-ups after "Run it now" aren't new requests, and when it can't tell whether you want a task done or a prompt improved, it asks once. Creating GPTs may depend on your ChatGPT plan.

**ChatGPT: a Project**
Paste `prompt-engine.md` into the project's instructions and add the knowledge file to the project's files.

**Gemini: a Gem**
Create a Gem, paste `prompt-engine.md` into its instructions, and add the knowledge file if your plan allows file uploads.

**Microsoft 365 Copilot: an agent**
Paste `prompt-engine.md` into the agent's instructions; the instructions field allows up to 8,000 characters. Add the knowledge file as a knowledge source.

**Claude: a Project**
Paste `prompt-engine.md` into the project instructions and add the knowledge file to project knowledge. On Claude, though, the skill works better: it asks with clickable questions in Claude Code and loads the checklists itself.

**Perplexity Spaces, Grok, Le Chat and others**
Use the app's custom instructions or space or agent instructions field, and attach the knowledge file where the app supports files.

## Good to know

- **Instruction limits.** Limits differ by app and change over time. `prompt-engine.md` is kept under 7,500 characters so it fits common limits of 8,000; the 8,000-character limit is confirmed for Microsoft 365 Copilot agents. Other apps' limits haven't been confirmed. If an app rejects the instructions as too long, paste them as the first chat message instead.
- **What's different outside Claude.**
  - Questions arrive as a numbered list rather than clickable dialogs.
  - "Run it now" carries out the prompt in the same chat.
  - "Save to file" appears only when the app has a tool that saves files on your computer; most chat apps don't.
  - Some of the skill's rules don't fit in `prompt-engine.md`, so its replies can differ from the skill's in places. [Known limits](../docs/compatibility.md#known-limits) lists those rules; the knowledge file has them.
- **Other people's private details.** With these instructions, on Claude too, secrets such as API keys are kept out of the prompt, but there is no rule for other people's private details, which the skill replaces with placeholders. [Known limits](../docs/compatibility.md#known-limits) has the details.
- **Privacy.** Prompt Engine is just instructions: your prompts go only to the AI app you're already using.
- **Testing status.** A conversation test checks these instructions on Claude through `claude -p`, with no tools or MCP servers loaded. It makes billed calls and is run by hand; [docs/compatibility.md](../docs/compatibility.md) has the date and result of the last run. Results in other apps may differ.
