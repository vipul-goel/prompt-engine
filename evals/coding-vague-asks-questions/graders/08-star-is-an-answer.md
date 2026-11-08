---
# Finding 6: `ok` and skipped questions take the ★, so the ★ must be an answer the prompt can use.
# The judge sees only this text and the reply, so the head quotes the request; validate.mjs holds
# the quote to prompt.md. Example phrases are in single quotes.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "add login to my app", a prompt for their coding agent, in standard mode, so the reply asks questions before writing the prompt. A reply of `ok`, or a question the user skips, takes the recommended option of each question: the one marked ★ or labelled (Recommended).
PASS if every recommended option is an answer the prompt can use as it stands: a concrete choice, a default, or a fallback such as letting the agent detect the stack from the repo or leaving a [[placeholder]]. A question may invite the user to type or paste the real thing instead; that invitation is fine. FAIL if any recommended option asks the user to supply information instead, such as 'Tell me', 'Paste it' or 'Tell me, e.g. Next.js', because accepting it with `ok` gives the prompt nothing to use.
