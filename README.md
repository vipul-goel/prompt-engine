# Prompt Engine: maintainer notes

This branch holds the maintainers' status notes and review records for Prompt Engine. It shares no history with `main`, and it is never merged into `main`.

Why it is separate: the repository root is also the Claude Code plugin root, so every file on `main` ships in every install. Claude Code can load a shipped `.claude/CLAUDE.md` as project memory in a user's session (finding 73). Decision D39 moved these notes here.

The standing rules and procedures live in `docs/maintainers.md` on `main`. Start there.

## What is here

- `STATUS.md`: the former `.claude/CLAUDE.md`, whole and unchanged, as it was at commit 3557b85 on `claude/gallant-thompson-eblqe0`. It holds the status of the release run and the open owner questions.
- `handoff/plan.md`: the approved build plan, with the owner's decisions.
- `handoff/repo-review-partial.json` and `handoff/repo-review-1b.json`: the raw repository reviews.
- `handoff/repo-review-verified.json`: the verified findings, the owner's decisions (the D and K numbers) and the record of each step. The finding numbers and the D and K numbers in the docs and code on `main` refer to this file. It is about 2 MB, so read it with `jq`, one record at a time. Finding N is `.findings[N-1]`.
- `handoff/mcp-fix-implementer.json`: the fixes for the MCP server's review findings.

These files were `.claude/handoff/` on the working branch until D39. They were copied unchanged, with one exception: a real session ID became `<session-id>`, and the user number in one local temp folder became `<uid>`.
