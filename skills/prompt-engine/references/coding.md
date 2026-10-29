# Domain pack: coding and agent tasks

Use this pack for prompts that ask a model or coding agent to write, change, review or explain code; to set up projects or scripts; or to run as an agent with tools. Signals: code, repos, files, bugs, errors, frameworks, APIs, tests, "build", "fix", "refactor", "agent", "Claude Code", "Cursor", "Codex".

## Must-haves in the enhanced prompt

Coding agents take instructions literally and act on them, so these five items prevent most wasted or risky runs:

1. **Definition of done** — what must be true at the end, such as "the new endpoint returns 404 for unknown IDs, and all existing tests pass".
2. **Verification** — the command or check that proves it (test, type check, lint, a manual step), and a request to report its output. If none exists, ask the agent to say what it couldn't verify.
3. **Scope fence** — what to change and what to leave alone; extras go in the final report as suggestions.
4. **Risky-action policy** — which actions need confirmation first: deleting, force-pushing, migrations, deploys, installing packages, calling external services.
5. **Where to look** — the files, modules or areas involved, or an instruction to find them by search before editing.

## Checklist

★ marks the recommended default, used when the user replies `ok` or picks quick mode.

| # | Item | Example question | ★ Default |
|---|---|---|---|
| 1 | Action mode | Should the agent edit the code directly, plan first, or only review and explain? | Edit directly for clear, reversible changes; plan first for multi-file or architectural work; assess only when the user is describing a problem |
| 2 | Definition of done | What must be true for this to count as done? | Requested behavior works, existing tests pass, a new test covers the change, no new type or lint errors |
| 3 | Verification | Which command runs the tests, type check and lint? | Discover it from the repo config, run it, and report the exact command and output |
| 4 | Location | Which files, modules or endpoints are involved? | Find them by search and read them before editing; don't guess about unopened code |
| 5 | Bug symptoms | What exact error do you see, and how do you reproduce it? | Reproduce with a failing test first, then fix |
| 6 | Stack and environment | Which language, framework, versions and package manager? | Whatever the repo declares; no dependency upgrades |
| 7 | Conventions | Is there existing code whose pattern should be copied? | Mirror the nearest similar code and the repo's style |
| 8 | Hard constraints | Any limits: no new libraries, stable public API, files never to touch, performance budget? | No new dependencies; keep public interfaces compatible; don't edit generated or vendored code |
| 9 | Scope and ambition | Minimal fix, or the fuller version with empty, error and edge states? | Everything requested, completely, and nothing beyond; list extras as suggestions |
| 10 | Tests | Should new tests be added, and in which framework? | Focused tests in the existing framework, roughly one per new behavior |
| 11 | Risky actions | May the agent install packages, commit, push, migrate or call external services? | Local, reversible actions are fine; ask before destructive or shared actions |
| 12 | Attended or unattended | Will someone be watching, or should it run to completion without questions? | Attended: ask only blocking questions. Unattended: proceed on stated assumptions and list them at the end |
| 13 | Edge cases | Which edge cases matter: empty input, concurrency, large data, auth failures? | Validate input at system boundaries; don't add handling for impossible states |
| 14 | Non-functional needs | Performance, security or accessibility requirements? | Don't regress performance; treat external input as untrusted; keep accessibility semantics |
| 15 | Hidden context | Anything already tried, or team decisions that aren't in the repo? | Assume none; flag contradictions between the request and the code |
| 16 | Final report | What should the summary at the end contain? | Outcome first, then files changed, commands run with results, assumptions, and follow-up suggestions |
| 17 | Long-running work | Will this span many steps or sessions? | For multi-step work: keep a checklist or progress file and make small commits |
| 18 | Agent design (when the prompt is an agent's instructions) | Which tools may it use, and when must it stop, escalate or ask? | Use tools to reduce uncertainty; explicit stop rules; cap retries; confirm risky actions |
| 19 | UI direction | Is there a design system, or should it propose a few directions first? | Follow the existing system; otherwise propose 3 distinct directions for the user to pick |

## Tips for coding agents

- In a code workspace, read the repo before asking. Package manifests, configs, the README and the code the prompt mentions answer most stack and convention questions.
- Name files and folders the agent should start from.
- For large or risky changes, ask the agent to propose a plan first; many agents have a plan mode for this.
- Rules that must never break (never touch `migrations/`, never push to `main`) are best enforced with the agent's permission settings or hooks, with the prompt explaining why.
- If the prompt will run unattended (scheduled jobs, CI, background agents), the agent can't ask questions. Tell it to proceed on stated assumptions and list them in its report.

## Example

Rough prompt: "add login to my app"

What changes after questions (React + Express repo detected from `package.json`; answers: email + password, keep the existing user table):
- **Goal:** add email-and-password login to the existing React and Express app, so users can access their saved projects.
- **Where:** `server/routes/` and `client/src/pages/`; reuse the existing `users` table, because migrating user data is out of scope.
- **Done when:** a user can register, log in and log out; protected routes return 401 without a session; existing tests and the new auth tests pass (`npm test`).
- **Risky actions:** ask before adding dependencies other than a password-hashing library; never log passwords or tokens.
- **Report:** files changed, commands run with their output, and anything not verified.
