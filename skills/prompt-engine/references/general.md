# Domain pack: general prompts and system prompts

Use this pack when no specific pack fits: explanations and learning, planning, brainstorming, decisions, extraction and classification, personal tasks. Also use it, together with any pack that fits the subject, when the prompt is itself instructions for an assistant: a system prompt, a custom GPT, a Gem, a Claude Project, or an agent's standing instructions.

## Universal dimensions

Every complete prompt answers most of these. Check each one: explicit, inferable or missing.

| Dimension | What to pin down | Why it matters |
|---|---|---|
| Goal and deliverable | An action verb plus the concrete result | An unclear ask gets the wrong kind of answer, such as ideas when a plan was wanted |
| Success criteria | What a good result looks like; when it's done | Gives the model a target to check itself against |
| Purpose and audience | Who it's for and what they'll do with it | Lets the model make many small choices correctly |
| Background | Facts, history and constraints the model can't see | Models work from what's in front of them, not what's in your head |
| Inputs | What material is provided, and which source wins in a conflict | Clear delimiting and placement improve accuracy on long inputs |
| Constraints | Real limits: budget, time, tools, rules | A few true limits prevent unusable output; too many make it rigid |
| Scope | What's in, what's out, how ambitious | Models follow scope literally; extras should be suggested, not done |
| Output format | Structure, medium (prose, table, JSON), length | The model needs a target shape; default lengths vary widely |
| Tone and style | Register, point of view, words to avoid | Voice is hard to infer |
| Examples | A sample of what's wanted, if one exists | The strongest single steer, so use one only when it shows exactly what's wanted |
| Edge cases | What to do with missing data, conflicts or impossible requests | Prevents improvising off the happy path |
| Quality check | How the model should verify its result | "Looks done" isn't done |
| Uncertainty | When to say "I don't know", how to label assumptions | Reduces made-up answers |
| Process | Steps, only when order matters | Prescribed steps help procedures but can hurt open-ended reasoning |
| Interaction | Ask or proceed, act or suggest | Decides whether the model stalls or charges ahead |
| Recency | Today's date; whether to check current facts | Stale knowledge sounds just as confident as fresh knowledge |

★ defaults for general prompts: a direct answer first, then details; plain language for an intelligent non-expert; state assumptions instead of asking more than once; say when something is uncertain.

## Common prompt types

| Type | Ask or pin down |
|---|---|
| Explain or teach | The learner's current level, the goal (pass an exam, use it at work), preferred format (analogy, steps, examples), and depth |
| Plan (trip, project, event) | Dates, budget, constraints, must-haves, and preferences; the output as a timeline or checklist |
| Brainstorm | How many ideas, how wild, the criteria for a good idea, and whether to rank them |
| Decide or advise | The options, the criteria and their weights, deal-breakers; ask for a recommendation plus what would change it |
| Extract or classify | The exact fields or labels with definitions, the output schema, and what to do with missing or ambiguous items; include 2–3 labelled examples when possible |
| Summarize | Audience, length, what to keep (decisions, numbers, action items), and whether to quote or paraphrase |

## When the prompt is an assistant's instructions

A system prompt is read on every turn, so it should describe a stable job rather than one task. Cover:

1. **Role and job** — what the assistant does and for whom, in one or two sentences.
2. **Audience** — who talks to it, and their expertise.
3. **Knowledge and tools** — what it can rely on (uploaded files, search, tools) and when to use each.
4. **Boundaries** — what it should decline or hand off, and how to say so politely.
5. **Interaction style** — when to ask a clarifying question and when to proceed on assumptions; tone; length.
6. **Output conventions** — formats it should always use, such as headings, tables or citations.
7. **Uncertainty** — what to do when it doesn't know or sources conflict.
8. **Examples** — one or two short sample exchanges for tricky behavior.

Keep it within the platform's instruction limit, and put long reference material in uploaded knowledge files rather than in the instructions. Limits differ by platform and change over time, so check the current one rather than assuming a number.
