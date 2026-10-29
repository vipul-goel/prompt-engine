# Asking clarifying questions

Good questions are the main thing that separates Prompt Engine from a one-click rewrite. They let the user steer the prompt, and the recommended answers let them do it in seconds. Bad questions — trivia, things you could look up, or too many — waste their time. This file covers which questions to ask, how to word them, and how to present and read them.

## Which questions to ask

Ask only when different answers would lead to materially different prompts. For anything else, make the call yourself and record it under Assumptions.

Score each missing or unclear checklist item from the domain pack:

| Factor | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Impact** — how much the answer changes the result | No visible effect | Cosmetic | Changes a large part | Changes the deliverable or approach, or risks unusable output |
| **Uncertainty** — how unclear the user's intent is | Stated | Strongly implied | A few plausible answers | Wide open |
| **Risk** — cost of a wrong default | Harmless | Rework | Irreversible actions, compliance, or a long unattended run wasted | — |
| **Default quality** — how often the recommended default is right | Rarely | Often | Almost always | — |

Priority = Impact × Uncertainty + Risk − Default quality. Ask items with priority 4 or more; assume the rest.

- **Standard mode:** ask every item that qualifies, most important first, at most 8. If more qualify, keep the top 8 and default the rest. If none qualify, skip the questions.
- **Quick mode:** ask nothing. Every gap gets its default, listed under Assumptions.
- **Deep mode:** round 1 as in standard. Then re-check with the answers in hand and ask up to two more rounds of at most 4 questions each, covering gaps the answers opened or items just below the threshold. Stop when nothing qualifies or the user says go.

Don't ask:
- for facts you can find yourself — in a code workspace, read the repo; in a chat, check earlier messages and attachments;
- for things the prompt already says;
- "Anything else?" as a main question (the free-text option covers it).

When the user has an artifact, ask for it instead of a description: "Paste the error message", "Share a paragraph in the voice you want".

## Order and wording

Order questions by what they unlock: goal and deliverable → audience and use → success criteria → constraints and scope → inputs and sources → format and length → tone.

Each question:
- covers one decision; questions that depend on each other go in the same round, in order;
- uses plain words and fits on one line;
- offers 2–4 concrete, mutually exclusive options, recommended option first;
- gives a reason of at most 12 words for the recommendation;
- is written in the user's language.

Good: "Should the fix keep the public API unchanged? a) Yes, stay backward compatible ★ — other code may call it · b) Breaking changes are fine"

Bad: "What programming language is this?" when the code is attached. Bad: "Do you want it good?"

## Format A — the AskUserQuestion dialog (Claude Code)

When the AskUserQuestion tool is available, use it for every round. Its limits: 1–4 questions per call, 2–4 options per question, headers of at most 12 characters. For 5–8 questions, make two consecutive calls, the most important four first.

For each question:
- `question`: the full question;
- `header`: a short tag such as "Audience", "Length", "Goal", "Stack", "Tests", "Scope", "Tone", "Format";
- `options`: the recommended option first, its label ending in " (Recommended)", its description holding the reason; other options with a short description of what choosing them means;
- `multiSelect`: true only when several answers can apply together, such as "Which platforms?".

The tool adds a free-text option itself, so don't add "Other". If the tool is unavailable, denied or fails, or the user dismisses the dialog, fall back to Format B in your next message. Never guess the answers.

## Format B — one text message (all other apps)

```text
A few quick questions so the prompt fits what you need (★ = recommended):

1. Who will read it?
   a) Employees  b) Team managers ★ (they decide remote-work policy)  c) Job seekers
2. How long should it be?
   a) About 600 words  b) About 1,200 words ★ (room for examples)  c) 2,000+ words
3. What's the main goal?
   a) Inform  b) Persuade ★ (managers need a reason to act)  c) Rank on Google

Reply `ok` to accept every ★, or answer like `2b 3: get managers to pilot a 4-day week`. Anything you skip gets the ★.
```

Translate everything, including the reply line, into the user's language.

## Reading the reply

| Reply | Meaning |
|---|---|
| `ok`, `yes`, `sure`, 👍, or a local equivalent (sí, oui, ja, はい, 好的…) | Accept every ★ |
| `2b`, `1a 3c`, `2: b` | Those answers; ★ for the rest |
| `3: <text>` or a sentence | Use the text for that question; free text wins over options |
| A new detail not tied to a question | Use it, and keep ★ for unanswered questions |
| `quick` | Accept every ★ and build now |
| `deep` | Accept the given answers, then ask another round |
| A question back to you | Answer it briefly, then repeat the open questions |

If the reply contradicts the original prompt, the newer statement wins; mention the change under "What I added & why".
