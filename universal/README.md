# Use Prompt Engine in any chatbot

These files let you use Prompt Engine in apps that don't support Agent Skills, such as ChatGPT, Gemini, Microsoft Copilot, Perplexity, Grok and Le Chat. (On Claude, Claude Code, Codex, Gemini CLI, Copilot in VS Code and most coding agents, install the skill instead. See the main [README](../README.md).)

| File | What it is | Size |
|---|---|---|
| [`prompt-engine.md`](prompt-engine.md) | The instructions. Works on its own. | about 6,000 characters |
| [`prompt-engine-knowledge.md`](prompt-engine-knowledge.md) | Optional detailed checklists for coding, writing, research, image and video prompts | about 62,000 characters |

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

In a GPT made only for this, every message is treated as a rough prompt to improve. Creating GPTs may depend on your ChatGPT plan.

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
  - "Save to file" only appears in tools that can write files.
- **Privacy.** Prompt Engine is just instructions: your prompts go only to the AI app you're already using.
- **Testing status.** The instructions are tested automatically with Claude (all tools disabled, two-turn conversations). Results in other apps may differ; see [docs/compatibility.md](../docs/compatibility.md).
