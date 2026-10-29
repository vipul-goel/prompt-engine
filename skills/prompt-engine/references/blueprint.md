# Blueprint for the enhanced prompt

This file describes how to write the full prompt: which sections to use, how to phrase instructions so models follow them sensibly, how to adapt to the target model, and what to check before handing it over. Image and video prompts follow `references/image-video.md` instead of the text skeleton.

## Skeleton

Use the sections that carry task-specific content and drop the rest. A two-line task doesn't need nine headings, and empty boilerplate sections dilute the instructions that matter.

```text
# Goal
<Action verb + concrete deliverable>. It is for <purpose>, read or used by <audience>.

# Context
- <Something the model can't see or infer> (why it matters)
- Assume <default> unless told otherwise.

# Inputs
<documents>
  <document index="1"><source>…</source><content>…</content></document>
</documents>

# What to do
1. <Instruction>, so that <reason>.
2. <Instruction>, because <reason>.

# Constraints and scope
- <A real invariant>, because <reason>.
- Instead of <unwanted pattern>, <wanted pattern>.
- Out of scope: <exclusions>. Suggest worthwhile extras at the end instead of doing them.

# Output
- Structure: <sections or medium>
- Length: <range>, because <reason>
- Tone: <description>; avoid <specific phrases>
- Language: respond in <language>.

# Done when
- <Measurable criterion>
- <Concrete check, e.g. run the test command and report its output; cite every factual claim>

# If information is missing
<State the assumption and continue | ask only if blocked | say what's missing>

# Task
<Restate the task in one sentence — only after long inputs.>
```

**Ordering.** With short inputs, use the order above. With long inputs (several documents or many pages), put a one- or two-line goal first, then the inputs, then the instructions, and end with the restated task, because models answer long-context questions better when the question comes after the material.

**Numbered steps.** Use them only when order matters. For reasoning-heavy tasks, describe the outcome and the constraints and let the model plan.

## Phrasing that models follow well

- **Explain the why, briefly.** A one-clause reason ("…, because readers skim on mobile") helps the model apply a rule sensibly in cases you didn't foresee. Skip reasons for self-evident format details, and don't stack justifications.
- **Say what to do, not only what to avoid.** "Write in flowing paragraphs" works better than "Don't use bullet points". When you do ban something, name the specific pattern.
- **Use plain emphasis.** Write important rules plainly with a reason. Capitalized pressure words (MUST, NEVER, CRITICAL) make current models over-apply the rule everywhere. Reserve "always" and "never" for true invariants.
- **Be explicit about scope.** Current models follow instructions literally: if you want the full-featured version, say so; if you want only the requested change, say that.
- **Write defaults as defaults.** "Assume the readers are team managers unless told otherwise" is honest; "The audience is team managers" turns your guess into a requirement the model will enforce.
- **Use placeholders for facts only the user has.** Write `[[company name]]`, `[[launch date]]` or `[[pricing]]` rather than inventing them, and list every placeholder under "Fill before running".
- **Give a role only when it changes the answer.** One specific sentence ("You are reviewing this as a security engineer would") helps; a generic "You are a world-class expert" adds nothing.
- **Keep one term per concept and one delimiter style.** Mixing "users", "customers" and "clients", or switching between headings and tags, makes the prompt harder to parse.
- **Ask for evidence, not visible deliberation.** If the user needs to check the work, ask for the result plus a brief explanation, sources or the commands run. Don't ask the model to write out its internal reasoning or to fill a dedicated reasoning section; current Claude models may refuse such requests, and reasoning models don't need them.
- **Leave runtime settings out of the prompt text.** Effort or reasoning level, temperature, prefilled assistant turns and token budgets are API settings, not prose. Prefilled answers are not supported on current Claude models.
- **Don't promise what the model can't see.** If the prompt depends on today's date or recent events, include the date and tell the model to check recent facts or say it can't.

## Adapting to the target model

The method is the same for every model; only delimiters, placement and a few lines change. If you don't know the target, use the universal column. (Last checked against vendor guidance: 2026-10-29; model behavior changes, so recheck these notes when vendors publish new guidance.)

| | Claude | GPT | Gemini | Universal (unknown, or a custom assistant) |
|---|---|---|---|---|
| Structure | XML tags for sections and inputs (`<context>`, `<instructions>`, `<documents>`, `<output_format>`, `<examples>`) | Markdown headings; XML for documents | One style used consistently: Markdown or XML | Markdown headings with XML-wrapped inputs |
| Placement | Long documents first, question last | Instructions first; repeat key instructions after long context | Critical constraints and format first; the question last | Goal first, inputs, instructions, task restated |
| Clarifying behavior | Check in only when readings differ materially | Tell it to state assumptions and continue rather than ask | Invite questions only in interactive use | Follow the user's choice |
| Length | State it explicitly | State it explicitly | Ask explicitly for detail when you want it | State it explicitly |
| Verification | A concrete check rather than a generic "double-check" | Completion criteria and stop rules | A validation step is fine | Concrete criteria |

**Coding agents** (Claude Code, Codex, Cursor, Copilot and similar):
- name the files or areas involved;
- give the command that proves the work (tests, type check, lint) and ask for its output;
- say whether to plan first or implement directly;
- list actions that need confirmation (deleting, pushing, migrating, deploying, installing);
- say whether a person will be watching or it runs unattended;
- for rules that must never break, suggest enforcing them with the tool's hooks or permission settings, because text instructions alone can be overlooked.

**Prompts that become system prompts** (custom GPTs, Gems, Projects, agents): describe the assistant's job, audience, boundaries, tone, tool use, when to ask versus proceed, and how to handle requests it can't fulfil. See `references/general.md`.

## Short version

The short version is the same prompt compressed for quick chats: the goal with its purpose, the 3–5 requirements that matter most, hard constraints, and the output format, in about 120 words or fewer. It keeps the same assumptions and placeholders.

## Final check before presenting

Fix anything that fails:

- Every requirement in the prompt traces back to the user, their answers, or a labelled default. Nothing was invented: no made-up names, numbers, dates, statistics, quotes or URLs.
- The user's key words — names, constraints, style words — survive intact.
- No contradictions, and examples agree with the instructions.
- No capitalized pressure words, generic personas, magic phrases ("think step by step", "take a deep breath"), requests to expose internal reasoning, prefill instructions or API settings.
- Scope is explicit, and the output format and length are stated.
- Every placeholder is listed under "Fill before running", and no template leftovers remain (such as an empty `{{variable}}`).
- The full prompt is as long as the task needs and no longer, and the short version fits its budget.
- The prompt is in the user's language, or the language the user asked for, and it says which language to respond in.
