# Prompt Engine

**Turn a rough prompt into a detailed, explained, LLM-ready prompt by answering a few multiple-choice questions.**

You type what you'd normally type into an AI tool. Prompt Engine finds what's missing — goal, audience, context, constraints, format, edge cases — and asks you a few questions, each with a recommended answer. Then it writes a prompt that gives the reason behind each instruction. It's tested in Claude Code and made for Claude.ai, ChatGPT, Gemini, Codex, GitHub Copilot, Cursor and MCP clients; [docs/compatibility.md](docs/compatibility.md) shows how far each one has been checked.

```text
You:   /prompt-engine write a blog post about remote work

       A few quick questions so the prompt fits what you need (★ = recommended):
       1. Who will read it?
          a) Employees  b) Team managers ★ (they decide remote-work policy)  c) Job seekers
       2. How long should it be?
          a) About 600 words  b) About 1,200 words ★ (room for examples)  c) 2,000+ words
       …
       Reply `ok` to accept every ★, or answer like `2b 3: your own text`.

You:   ok

       ### Full prompt        ← copy-ready, in a code block
       ### Short version      ← for quick chats
       ### What I added & why
       ### Assumptions        ← defaults you can change ("change 2: …")
       ### Score              ← original vs enhanced, per area
       ### What next?         ← 1) Run it now ★  2) Refine  3) Save to file
```

## Why use it

- **It asks before it guesses.** It asks only questions whose answers would change the prompt, up to 8. Each comes with a recommended answer, so `ok` takes one second. Start with `quick:` to skip the questions, or with `deep:` for a more thorough interview.
- **It's built not to invent facts.** Anything only you know, such as your product name, prices or dates, becomes a `[[placeholder]]` to fill in, and the choices it makes for you are listed as assumptions you can change. Tests still find small values, such as a count, left off that list in some replies ([Known limits](docs/compatibility.md#known-limits)).
- **It's built to explain itself.** It lists the main things it added, each with its reason and a tag saying whether it came from you, from your answers or from best practice.
- **It follows current prompting guidance.** Prompts state their goal and success criteria and give reasons instead of shouting rules in capitals. They don't ask the model to show its reasoning, which the newest Claude models may refuse, and they don't rely on tricks that newer models reject.
- **It knows the domain.** There are dedicated checklists for coding agents, writing and marketing, research and analysis, and image and video generation. Image and video prompts come out in the target tool's own syntax, such as Midjourney parameters or Veo sound cues.
- **It's built so nothing runs until you choose.** You get the prompt first. You decide whether to run it, refine it or save it. In the manual Claude Code check on 2026-11-16, read-only lookups such as `ls` or `git log` still ran before anything was chosen. Nothing changed your files before the pick ([Known limits](docs/compatibility.md#known-limits)).

## Install: pick one

| You use | How to install |
|---|---|
| **Claude Code** | `/plugin marketplace add vipul-goel/prompt-engine`, then `/plugin install prompt-engine@vipul-goel`. On Claude Code 2.1.275 or later, this one line does both: `/plugin install prompt-engine --marketplace vipul-goel/prompt-engine` |
| **Claude.ai** (web, desktop, mobile) | Customize → Plugins → Add → Add marketplace → `https://github.com/vipul-goel/prompt-engine`. Or upload `prompt-engine.zip` from the [latest release](https://github.com/vipul-goel/prompt-engine/releases) under Customize → Skills. Skills need **Code execution and file creation** (called **Create and edit files** in the updated Settings layout) turned on in Settings. |
| **Codex, Gemini CLI, GitHub Copilot, Cursor, Cline, OpenCode, Goose and other agents that read SKILL.md** | `npx skills add vipul-goel/prompt-engine`, or copy the [`skills/prompt-engine`](skills/prompt-engine) folder into `~/.agents/skills/`, which every agent named here reads ([other folders](docs/install.md#other-agents-that-read-skillmd)) |
| **ChatGPT, Gemini, Microsoft Copilot, Perplexity or any other chatbot** | Paste [`universal/prompt-engine.md`](universal/prompt-engine.md) into a chat, a custom GPT, a Gem or a project. [Setup notes](universal/README.md) |
| **MCP clients** (Claude Desktop, Claude Code, Cursor, VS Code, Zed…) | `npx -y prompt-engine-mcp` as a local MCP server, or the one-click `.mcpb` file for Claude Desktop from the releases page (not yet tested in Claude Desktop). [MCP server guide](mcp/README.md) |
| **Claude API or Agent SDK** | Upload the skill folder with the Skills API, or place it in `.claude/skills/`. See [docs/install.md](docs/install.md) |

**Don't install it twice.** A plugin or skill you add on Claude.ai also loads in Claude Code when you sign in there with the same account, and several agents read the same skill folders, so a second install can leave you with two copies; [Install it once](docs/install.md#install-it-once) says which copies overlap and what to do about them. Step-by-step instructions for every option are in [docs/install.md](docs/install.md). The marketplace, `npx skills add` and the files in this repo don't wait for a release.

## Use it

| Where | How |
|---|---|
| Claude Code | `/prompt-engine:prompt-engine <your prompt>`, which works as `/prompt-engine <your prompt>` when no other skill uses that name. Or just ask: "improve this prompt: …" |
| Claude.ai | Type `/` and pick **prompt-engine**, or write "prompt-engine: <your prompt>" or "improve this prompt: …" |
| Other agents | Ask "use prompt-engine on: …" (`$prompt-engine` in Codex) |
| Chatbots with the universal prompt | Start your message with `prompt-engine:` |

- **Modes:** start your prompt with `quick:` for no questions, or `deep:` for extra question rounds.
- **Answering questions:** `ok` accepts every ★; `2b 4: your own text` answers some questions and keeps ★ for the rest.
- **After the prompt is ready:**
  - `1` picks the ★ option (a bare `ok` picks nothing):
    - Run it now, or Try it here for a prompt meant for another tool, runs the prompt here;
    - Fill placeholders asks for the missing values, then shows the filled prompt and the menu again;
    - Done, for an image or video prompt the assistant can't generate, says where to paste it;
  - `change 2: …` edits an assumption;
  - `deep` asks more questions;
  - in Claude Code, `3` saves it to `prompts/<name>.md`.

In Claude Code, the questions and the "What next?" menu appear as clickable dialogs. The recommended answer is listed first, so pressing Enter accepts it.

## Real example

From the test suite's full run on 2026-11-16, with Claude Sonnet 5.5: the whole reply to "Use prompt-engine (quick mode) to write a Midjourney prompt: a cozy cabin in the snow at night". It passed every check in that run.

````markdown
Here is a quick-mode Midjourney prompt for your snowy night cabin. It has no placeholders and no secrets.

### Full prompt
```text
cozy log cabin in deep snow at night, warm amber light glowing from two windows, thin smoke rising from a stone chimney, three snow-covered pine trees beside it, clear starry sky, soft blue moonlight on the snowdrifts, medium-wide shot at eye level, photorealistic --ar 3:2 --no text watermark people
```

### Short version
```text
cozy log cabin in snow at night, warm amber windows, chimney smoke, snowy pines, starry sky, blue moonlight, photorealistic --ar 3:2 --no text watermark people
```
Full version: when you want a specific composition. Short version: when you'd rather let Midjourney fill in more of the scene.

### What I added & why
- **Your subject and mood** [you] — "cozy", "cabin", "snow" and "night" are kept as you wrote them.
- **Light sources** [best practice] — names a warm light and a cool light, so "cozy" comes from the lighting rather than from the word.
- **Exact counts** [best practice] — "two windows" and "three pine trees" are more reliable in Midjourney than vague plurals.
- **Parameters at the end, one-word `--no` items** [best practice] — this is Midjourney's syntax. Multi-word phrases in `--no` get read word by word.

### Assumptions
1. Log cabin with a stone chimney and thin smoke: you only said "cabin".
2. Two glowing amber windows: this gives the cozy warmth.
3. Three snow-covered pines, a starry sky and blue moonlight on the snowdrifts: these are the scene details.
4. Medium-wide shot at eye level, photorealistic: you didn't name a framing or style.
5. `--ar 3:2`: a landscape ratio suits a cabin scene.
6. `--no text watermark people`: this keeps the image clean and the cabin as the only subject.
7. Current Midjourney version, with no `--v`, `--stylize` or `--raw` set: you didn't name a version.

Reply "change 2: …" to adjust any of these.

### Score
| | Original | Enhanced |
|---|---|---|
| Clear goal | 2 | 3 |
| Context | 1 | 3 |
| Constraints | 0 | 3 |
| Output format | 1 | 3 |
| Edge cases | 0 | 2 |

Self-assessed coverage of five areas, not a prediction of output quality.

### What next?
1. Done ★ — paste the prompt into Midjourney. I can't generate images here.
2. Refine — change any assumption, for example a different style such as watercolor or a different ratio.
3. Save to file — `prompts/cozy-cabin-snow-night.md`
````

## How it's tested

- **Behavior evals** with Claude Code's official runner (`claude plugin eval`), run with and without the skill. The cases cover question rounds, quick mode, follow-up replies, requests to critique a prompt or say what's missing, a prompt that contains a code block, Spanish and Japanese prompts, secret redaction, other people's private details, prompt injection, saving to a file, "nothing runs until you choose", and trigger and non-trigger cases. Eval runs don't grant shell commands, so the "nothing runs until you choose" and injection cases check file writes and edits only. Results are in [docs/compatibility.md](docs/compatibility.md).
- **Trigger tests** of the skill description, run as a one-off during development: 24 requests, half of them near-misses such as "translate this prompt" or "run this prompt". With Claude Sonnet 5.5, it started on all 12 prompt requests and on none of the near-misses. The request set isn't in the repository.
- **Conversation tests** of the universal prompt on Claude, through `claude -p` with no tools or MCP servers loaded, the way a chatbot would use it. They make billed calls, so they're run by hand.
- **Static checks** (`node scripts/validate.mjs`) for portability rules, prompt lint, size budgets and the shared output contract, plus mutation tests for each rule it enforces.
- **MCP server tests** covering both protocol versions, with and without form questions, over stdio and HTTP.

Some platform details couldn't be verified directly, such as other chat apps' instruction limits and some tools' current syntax. Those are marked as unverified in the docs instead of being presented as facts.

## Prior art and what's different

Anthropic's [release notes](https://platform.claude.com/docs/en/release-notes/overview#july-17-2026) (July 17, 2026 entry) announced the retirement of the legacy Console Workbench and the experimental API endpoints for generating and improving prompts on August 17, 2026. As of November 2026, community projects cover parts of this idea:
- [prompt-master](https://github.com/nidhinjs/prompt-master) asks at most 3 questions and returns one prompt block;
- [claude-code-prompt-improver](https://github.com/severity1/claude-code-prompt-improver) uses a hook to research the repo and ask questions when a prompt is vague;
- [prompt-architect](https://github.com/ckelsoe/prompt-architect) offers framework-based rewrites with scores;
- the [grilling skill](https://github.com/mattpocock/skills) runs question rounds with recommended answers.

Prompt Engine combines adaptive questions with recommended answers, a no-invention rule with placeholders and labelled assumptions, explained changes, honest scoring, domain checklists, and one method shipped to every major surface.

## Privacy

The skill and the universal prompt are just instructions: your prompts go only to the AI app you already use. The MCP server never calls a model or any other service, needs no API key and doesn't log prompts. Its main tool, `enhance_prompt`, never receives your prompt. `check_prompt` receives a draft when the model calls it, and `ask_user` receives the questions and, when your app shows them as a form, your answers and notes. A server on your own machine sends none of this anywhere; if you connect to a copy someone else hosts, those calls go to their server.

## Repository layout

```text
skills/prompt-engine/   the Agent Skill: SKILL.md + references/ (the single source of the method)
.claude-plugin/         Claude Code / Claude.ai plugin and marketplace manifests
universal/              copy-paste prompt + knowledge file for any chatbot
mcp/                    the MCP server (npm package prompt-engine-mcp)
data/                   output contract, lint rules and image/video tool syntax (with verification status)
evals/                  test cases for `claude plugin eval`
scripts/                build, validate, release and eval helpers (no dependencies)
docs/                   install guide, compatibility, sources, architecture, publishing, manual checks
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to change the method or add a domain, and [docs/architecture.md](docs/architecture.md) for how one source feeds every format.

## License

[MIT](LICENSE)
