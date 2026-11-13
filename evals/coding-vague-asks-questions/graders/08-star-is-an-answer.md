---
# Finding 6: `ok` and skipped questions take the ★, so the ★ must be an answer the prompt can use.
# The judge sees only this text and the reply, so the head quotes the request; validate.mjs holds
# the quote to prompt.md. Example phrases are in single quotes. Only each ★ option's own text is
# judged: questions.md's Format B can put a question's options on one line, where an unstarred
# option that invites the user to type sat next to the ★ and read like the FAIL example. An option
# under which the agent asks the user before it acts sets how the agent works, so it is an answer
# too (step 1e).
type: llm
focus: last_message
weight: 1
---

The user's whole request was "add login to my app", a prompt for their coding agent, in standard mode, so the reply asks questions before writing the prompt. A reply of `ok`, or a question the user skips, takes the recommended option of each question: the one marked ★ or labelled (Recommended).
PASS if every recommended option is an answer the prompt can use as it stands: a concrete choice, a default, or a fallback such as letting the agent detect the stack from the repo or leaving a [[placeholder]]. Judge only the text of each option marked ★ or labelled (Recommended): when a question's options share a line, an option runs from its letter to the next option's letter, so in 'a) Use a library ★ (well tested) b) Write your own' only a) is judged. An option without ★ may invite the user to type or paste the real thing instead, such as 'b) Type it in your own words', and so may the question; that invitation is fine. An option under which the agent asks the user before it acts, such as 'Ask before installing packages', is a usable answer too: it sets how the agent works, and the user has nothing to supply now. FAIL if any recommended option asks the user to supply information instead, such as 'Tell me', 'Paste it' or 'Tell me, e.g. Next.js', because accepting it with `ok` gives the prompt nothing to use.
