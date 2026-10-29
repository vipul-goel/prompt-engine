# Prompt Engine

**Turn a rough prompt into a detailed, explained, LLM-ready prompt by answering a few multiple-choice questions.**

You type what you'd normally type into an AI tool. Prompt Engine finds what's missing — goal, audience, context, constraints, format, edge cases — and asks you a few questions, each with a recommended answer. Then it writes a prompt that gives the reason behind each instruction. It works in Claude, Claude Code, ChatGPT, Gemini, Codex, GitHub Copilot, Cursor and any MCP client.

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
- **It never invents facts.** Anything only you know, such as your product name, prices or dates, becomes a `[[placeholder]]` to fill in. Choices it made for you are listed as assumptions you can change.
- **It explains itself.** Every addition is listed with its reason and tagged as coming from you, from your answers, or from best practice.
- **It follows current prompting guidance.** Prompts state their goal and success criteria and give reasons instead of shouting rules in capitals. They don't ask the model to show its reasoning, which the newest Claude models may refuse, and they don't rely on tricks that newer models reject.
- **It knows the domain.** There are dedicated checklists for coding agents, writing and marketing, research and analysis, and image and video generation. Image and video prompts come out in the target tool's own syntax, such as Midjourney parameters or Veo sound cues.
- **Nothing runs until you choose.** You get the prompt first. You decide whether to run it, refine it or save it.

## Install: pick one

| You use | How to install |
|---|---|
| **Claude Code** | `/plugin marketplace add vipul-goel/prompt-engine`, then `/plugin install prompt-engine@vipul-goel`. On Claude Code 2.1.275 or later, this one line does both: `/plugin install prompt-engine --marketplace vipul-goel/prompt-engine` |
| **Claude.ai** (web, desktop, mobile) | Customize → Plugins → Add → Add marketplace → `https://github.com/vipul-goel/prompt-engine`. Or upload `prompt-engine.zip` from the [latest release](https://github.com/vipul-goel/prompt-engine/releases) under Customize → Skills. Skills need **Code execution and file creation** turned on in Settings. |
| **Codex, Gemini CLI, GitHub Copilot, Cursor, Cline, OpenCode, Goose and other agents that read SKILL.md** | `npx skills add vipul-goel/prompt-engine`, or copy the [`skills/prompt-engine`](skills/prompt-engine) folder into `~/.agents/skills/` |
| **ChatGPT, Gemini, Microsoft Copilot, Perplexity or any other chatbot** | Paste [`universal/prompt-engine.md`](universal/prompt-engine.md) into a chat, a custom GPT, a Gem or a project. [Setup notes](universal/README.md) |
| **MCP clients** (Claude Desktop, Claude Code, Cursor, VS Code, Zed…) | `npx -y prompt-engine-mcp` as a local MCP server, or the one-click `.mcpb` file for Claude Desktop from the releases page. [MCP server guide](mcp/README.md) |
| **Claude API or Agent SDK** | Upload the skill folder with the Skills API, or place it in `.claude/skills/`. See [docs/install.md](docs/install.md) |

**Don't install it twice.** A plugin added on Claude.ai also appears in Claude Code, so adding the same thing in both places gives you two copies. Step-by-step instructions for every option are in [docs/install.md](docs/install.md). The npm package and the release files appear after the first release; until then, use the marketplace, `npx skills add`, or the files in this repo.

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
  - `1` runs it here;
  - `change 2: …` edits an assumption;
  - `deep` asks more questions;
  - in Claude Code, `3` saves it to `prompts/<name>.md`.

In Claude Code, the questions and the "What next?" menu appear as clickable dialogs. The recommended answer is listed first, so pressing Enter accepts it.

## Real example

From the test suite (Claude Sonnet 5.5, quick mode), for "a cozy cabin in the snow at night" as a Midjourney prompt:

```text
small log cabin with warm glowing windows nestled in deep fresh snow at night, thin chimney smoke curling upward, three snow-laden pine trees beside it, clear sky full of stars with a crescent moon, soft blue moonlight on the snowdrifts, amber window light spilling across the snow, a single line of footprints leading to the front door, wide shot at eye level, photorealistic --ar 3:2 --no people text watermark
```

It explained the additions. For example, the amber window light against blue moonlight shows "cozy" through contrast, because a mood word alone gives the model nothing to draw. It also listed its choices as assumptions, such as the 3:2 ratio and the photorealistic style. It left out version flags because it didn't know which Midjourney version you use.

## How it's tested

- **Behavior evals** with Claude Code's official runner (`claude plugin eval`), run with and without the skill. The cases cover question rounds, quick mode, follow-up replies, Spanish and Japanese prompts, secret redaction, prompt injection, saving to a file, "nothing runs until you choose", and trigger and non-trigger cases. Results are in [docs/compatibility.md](docs/compatibility.md).
- **Trigger tests** of the skill description: 24 requests, half of them near-misses such as "translate this prompt" or "run this prompt". In testing with Claude Sonnet 5.5, it started on all 12 prompt requests and on none of the near-misses.
- **Two-turn tests** of the universal prompt with every tool disabled, the way a chatbot would use it.
- **Static checks** (`node scripts/validate.mjs`) for portability rules, prompt lint, size budgets and the shared output contract, plus mutation tests that confirm each check catches what it should.
- **MCP server tests** covering both protocol versions, with and without form questions, over stdio and HTTP.

Some platform details couldn't be verified directly, such as other chat apps' instruction limits and some tools' current syntax. Those are marked as unverified in the docs instead of being presented as facts.

## Prior art and what's different

Anthropic's Console prompt improver and generator were retired in August 2026, according to Anthropic's release notes. Most remaining "enhance prompt" buttons, such as those in app builders and IDEs, rewrite silently without asking or explaining. Community projects explored parts of this idea:
- [prompt-master](https://github.com/nidhinjs/prompt-master) asks at most 3 questions and returns one prompt block;
- [claude-code-prompt-improver](https://github.com/severity1/claude-code-prompt-improver) uses a hook to research the repo and ask questions when a prompt is vague;
- [prompt-architect](https://github.com/ckelsoe/prompt-architect) offers framework-based rewrites with scores;
- the [grilling skill](https://github.com/mattpocock/skills) runs question rounds with recommended answers.

Prompt Engine combines adaptive questions with recommended answers, a no-invention rule with placeholders and labelled assumptions, explained changes, honest scoring, domain checklists, and one method shipped to every major surface.

## Privacy

The skill and the universal prompt are just instructions: your prompts go only to the AI app you already use. The MCP server makes no network calls, needs no API key and doesn't log prompts. Its main tool doesn't even receive your prompt text.

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
