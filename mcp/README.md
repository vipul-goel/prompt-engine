# Prompt Engine MCP server

`prompt-engine-mcp` brings [Prompt Engine](https://github.com/vipul-goel/prompt-engine) to any MCP client. Prompt Engine turns a rough prompt into a detailed, LLM-ready prompt. It finds what's missing, asks you a few multiple-choice questions with a recommended answer for each, then writes the prompt and explains every addition.

The model you already use does the writing. This server supplies the method, the domain checklists, a way to ask you questions and a deterministic lint. It never calls a model, needs no API key, makes no network calls and doesn't log prompts.

- [Install](#install)
- [Use it](#use-it)
- [Reference](#reference)
- [Self-hosting over HTTP](#self-hosting-over-http)
- [Privacy](#privacy)
- [Development and testing](#development-and-testing)

## Install

The npm package and the `.mcpb` file appear with the first release. Until then, build from a clone (see [Development and testing](#development-and-testing)) and point your client at `node /path/to/prompt-engine/mcp/dist/cli.js`.

**Claude Desktop.** Download `prompt-engine.mcpb` from the [latest release](https://github.com/vipul-goel/prompt-engine/releases) and open it with Claude Desktop. The bundle carries its own server file, so nothing else gets installed.

**Claude Code.**

```bash
claude mcp add prompt-engine -- npx -y prompt-engine-mcp
```

Add `--scope user` to use it in every project. If you also installed the Prompt Engine plugin, you don't need this server in Claude Code: the plugin's skill does the same job.

**Cursor** (`~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project), **Windsurf, Claude Desktop without the bundle** and most other clients:

```json
{
  "mcpServers": {
    "prompt-engine": { "command": "npx", "args": ["-y", "prompt-engine-mcp"] }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "prompt-engine": { "type": "stdio", "command": "npx", "args": ["-y", "prompt-engine-mcp"] }
  }
}
```

The server needs Node.js 20 or later. On Windows, some clients need `"command": "cmd", "args": ["/c", "npx", "-y", "prompt-engine-mcp"]`.

## Use it

Ask for it in plain words: "improve this prompt: write a blog post about remote work", "quick: a Midjourney prompt for a cozy cabin at night", or "use prompt-engine on this agent prompt: …". Start with `quick:` to skip the questions, or with `deep:` for extra rounds.

What happens:
1. The model calls `enhance_prompt` and gets the method brief, then `get_checklist` for the prompt's domain.
2. In standard and deep modes it calls `ask_user` with its questions. Where your client supports MCP form elicitation, they appear as one form, with the recommended answers as defaults and a notes field. Otherwise the model shows them as a numbered list; reply `ok` to accept every ★, or answer like `2b 4: your own text`.
3. It writes the enhanced prompt in a fixed format: the full prompt, a short version, what it added and why, assumptions, a score, and a "What next?" menu.

The `enhance` prompt gives the same start from a client's prompt menu. In Claude Code, write your rough prompt first, then run `/mcp__prompt-engine__enhance`, optionally followed by `quick`, `standard` or `deep`. Claude Code passes one word per argument, so the mode is the prompt's only argument.

## Reference

### Tools

Every tool is annotated read-only, non-destructive, idempotent and closed-world.

| Tool | Input | Returns |
|---|---|---|
| `enhance_prompt` | `mode?`: `quick`, `standard` or `deep`; `target?`: where the prompt will run, such as `Midjourney` | The method brief as text. It echoes the mode and target and never needs the prompt itself. |
| `get_checklist` | `domain`: `coding`, `writing`, `research`, `image-video` or `general` | The domain's checklist with ★ defaults and an example. `image-video` also includes each tool's syntax. |
| `ask_user` | `questions`: 1–8 of `{ id, header?, question, options: [{ label, description? }] (2–4), recommended, why? }`; `intro?` | Structured `{ status, answers?, notes?, questionsText?, next }`, plus a JSON text mirror |
| `check_prompt` | `prompt`; `target?` | Structured `{ heuristic, targetKind, dimensions, issues, summary }`, plus a readable text version |

How `ask_user` asks:

| Client and connection | Result |
|---|---|
| Supports form elicitation, protocol 2026-07-28 (stdio or HTTP) | A form, through a multi-round-trip `input_required` result. `status: "answered"`, each answer with `source: "chosen"` |
| Supports form elicitation, 2025-era protocol over stdio | A form, through an `elicitation/create` request |
| 2025-era protocol over HTTP | `status: "ask_in_chat"` with `questionsText`, because stateless HTTP serving can't send the client a request |
| No form support | `status: "ask_in_chat"` with `questionsText` for the model to show |
| The user declines or dismisses the form | `status: "declined"` or `"cancelled"`, with the recommended answers marked `source: "recommended"` so they are listed as assumptions |

`check_prompt` is a heuristic. For each scored area (Clear goal, Context, Constraints, Output format, Edge cases) it reports whether the draft explicitly mentions it, with short evidence, plus lint findings from [`data/lint-rules.json`](../data/lint-rules.json): capitalized pressure words, requests to expose reasoning, prefill instructions, template leftovers, open `[[placeholders]]` and similar. It gives no score; the model scores with the shared rubric.

### Prompt

| Prompt | Argument | Returns |
|---|---|---|
| `enhance` | `mode` (optional; completes to `quick`, `standard`, `deep`) | One user message: the method brief, then "Improve the rough prompt in my previous message, or ask me for it if there isn't one." |

### Resources

| URI | Content |
|---|---|
| `prompt-engine://method` | The method brief (what `enhance_prompt` returns without arguments) |
| `prompt-engine://output-format` | The reply format, the rules for each part and the score anchors |
| `prompt-engine://questions` | Which questions to ask and how to read replies |
| `prompt-engine://blueprint` | How to write the enhanced prompt |
| `prompt-engine://media-targets` | Image and video tool syntax, with verification status |
| `prompt-engine://checklists/{domain}` | The `get_checklist` text for each domain (listed individually) |

All text comes from the same sources as the skill and the copy-paste prompt (`skills/prompt-engine/` and `universal/`), generated into `src/generated/content.ts` by `node scripts/build.mjs` at the repository root.

## Self-hosting over HTTP

```bash
npx -y prompt-engine-mcp --http
```

This serves Streamable HTTP at `http://127.0.0.1:8787/mcp`. Options:

| Option | Default | Meaning |
|---|---|---|
| `--host <address>` | `127.0.0.1` | Address to bind |
| `--port <number>` | `8787` | Port; `0` picks a free one |
| `--allowed-hosts <a,b>` | `localhost,127.0.0.1,[::1]` | `Host` header names to accept; also read from `PROMPT_ENGINE_ALLOWED_HOSTS` |

Requests with any other `Host` header get `403`, which protects a local server from DNS rebinding. Browser requests are accepted only from an allowed host's origin; requests without an `Origin` header, which is what non-browser clients send, are accepted. To serve on a network, bind the interface and name the hostname clients use:

```bash
npx -y prompt-engine-mcp --http --host 0.0.0.0 --port 8080 --allowed-hosts mcp.example.com
```

Connect a client with, for example, `claude mcp add --transport http prompt-engine http://127.0.0.1:8787/mcp`. The server has no authentication of its own, so put it behind your own proxy or access control before exposing it. Each request gets a fresh, stateless server. Clients on the 2026-07-28 protocol get question forms; 2025-era clients over HTTP get the questions as text.

### Cloudflare Workers

`src/worker.ts` serves the same server statelessly on Cloudflare Workers, with the SDK's Workers JSON Schema validator. From this folder:

1. Set `ALLOWED_HOSTS` in `wrangler.jsonc` (or in the dashboard) to the hostname clients will use, such as `prompt-engine-mcp.<your-subdomain>.workers.dev`. Requests for any other host get `403`; if the variable is empty, every request gets `500`.
2. Deploy with `npx wrangler@4.155.0 deploy` (Wrangler needs Node.js 22 or later).
3. Connect clients to `https://<your hostname>/mcp`.

`npm run test:worker` checks the Worker without deploying: a `wrangler deploy --dry-run`, then a local `wrangler dev` that must answer `tools/list` and `enhance_prompt`, reject a foreign `Host`, and return `ask_user` form answers to a 2026-07-28 client.

## Privacy

- **No prompt logging.** The server writes nothing to stdout except protocol messages, and logs only errors to stderr, with quoted text removed so request content can't leak into logs.
- **No API key and no network calls.** It never calls a model or any other service.
- **Your prompt stays with your model.** `enhance_prompt` never receives it. Only `check_prompt` sees a draft, and only when the model calls it.
- Self-hosted and Workers deployments keep nothing between requests.

## Development and testing

From a clone, in this folder (Node.js 22.19 or later for the full tool chain; the server itself runs on Node.js 20+):

```bash
npm ci
npm run build            # tsc → dist/
npm test                 # build, type-check, then unit, in-process integration (both protocol eras) and end-to-end tests
npm run test:inspector   # MCP Inspector CLI gates: tools/list --strict, prompts, resources, tool calls, modern and legacy eras
npm run pack:mcpb        # esbuild bundle → mcpb/server/index.js, then mcpb validate + pack → dist-mcpb/prompt-engine.mcpb
npm run test:worker      # Cloudflare Worker dry-run and wrangler dev smoke test (downloads Wrangler)
```

`npm test` covers:
- the `check_prompt` heuristics and lint rules, and the question validation, text format and form schema;
- every tool, the prompt and the resources through a real SDK client, in both the 2025-era and the 2026-07-28 protocol, including form answers, declines, cancellations and the text fallback;
- the built `dist/cli.js` over stdio, and over real HTTP with `Host` and `Origin` checks;
- budgets: instructions under 3,500 characters, tool descriptions under 1,500, brief and checklist results under 32,000;
- version and schema checks for `package.json`, `manifest.json` (MCPB) and `server.json` (MCP Registry).

To try the server by hand, run the Inspector: `npx @modelcontextprotocol/inspector@2.13.0 --cli node dist/cli.js --method tools/list`.

Edit the method in `skills/prompt-engine/`, `universal/` or `data/`, never in `src/generated/`, then run `node scripts/build.mjs` from the repository root. One version number covers every part of Prompt Engine; set it with `node scripts/version.mjs <version>` from the root, which updates `package.json`, `package-lock.json`, `manifest.json` and `server.json` here too.
