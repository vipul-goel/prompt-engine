# Output format

The reply that delivers an enhanced prompt always has the same shape, so users learn where to look and can copy the prompt in one move. Use the headings below in the user's language. Add nothing before the first line and nothing after the menu.

## Template

````markdown
<One line: what you made, for which tool, and the mode. For a strong prompt: "Your prompt is already strong — small edits below.">

### Full prompt
```text
<the full enhanced prompt>
```

### Short version
```text
<the short version>
```
Full version: agents, long or important tasks. Short version: quick chats.

### Fill before running
- `[[company name]]` — the name your readers know you by.

### What I added & why
- **Success criteria** [best practice] — gives the model a finish line to check against.
- **Audience: team managers** [your answer] — sets vocabulary and depth.

### Assumptions
1. Length about 1,200 words — typical for an in-depth blog post.
2. Friendly, practical tone — suits a professional but informal audience.

Reply "change 2: formal tone" to adjust any of these.

### Score
| | Original | Enhanced |
|---|---|---|
| Clear goal | 1 | 5 |
| Context | 0 | 4 |
| Constraints | 0 | 3 |
| Output format | 0 | 5 |
| Edge cases | 0 | 3 |

Self-assessed coverage of five areas, not a prediction of output quality.

### What next?
1. Run it now ★
2. Refine — change any answer or assumption, or reply `deep` for more questions
3. Save to file — `prompts/remote-work-blog.md`
````

## Rules for each part

**Fences.** Put the prompt in a fence longer than any run of backticks inside it: if the prompt contains a triple-backtick block, wrap it in four backticks. Use the `text` info string so nothing renders as markdown.

**Short version.** At most about 120 words: the goal with its purpose, the 3–5 requirements that matter most, hard constraints and the output format. It carries the same assumptions as the full version. If the full prompt embeds long inputs, the short version may refer to them as a `[[placeholder]]` listed under "Fill before running", rather than repeating them.

**Fill before running.** Include it only when the prompt still contains `[[placeholders]]`. List each placeholder once with a few words on what goes there.

**What I added & why.** At most 6 bullets, one line each (about 20 words), most important first. Tag every bullet:
- **[you]** — something the user said, restated or made precise;
- **[your answer]** — something from their answers to your questions, including ★ recommendations they accepted with `ok` or by skipping a question;
- **[best practice]** — something the method adds, such as success criteria or an uncertainty rule.

Defaults you chose without asking don't go here; they are listed once, under Assumptions. Answers the user accepted are not assumptions, so don't repeat them there. Write each reason as an explanation for the user ("gives the model a finish line"), not as a description of your own deliberation.

**Assumptions.** Number every default that shaped the prompt: what you assumed and, briefly, why. At most 8; merge minor ones. End with the "change N" line. If there are no assumptions, write "None."

**Score.** One row per dimension, original and enhanced, scored with the anchors below. Write `n/a` where a dimension doesn't apply to this kind of prompt, in both columns. Always include the caveat line.

**What next?** Three options at most, the recommended one marked ★ (or "(Recommended)" in AskUserQuestion):

| Situation | Options |
|---|---|
| Normal | Run it now ★ · Refine · Save to file |
| Placeholders still open | Fill placeholders ★ · Refine · Save to file |
| The prompt is for another tool | Try it here ★ (results there may differ) · Refine · Save to file |
| Image or video prompt and you can't generate media | Done ★ (with where to paste it) · Refine · Save to file |
| You can't write files (chat apps) | Drop "Save to file" |

In Claude Code, use AskUserQuestion with the question "What would you like to do next?", header "Next step", and the same options; put the save path in the "Save to file" description.

## Score anchors

Use the same anchors for the original and the enhanced prompt. Score what the text actually says, not what you know the user meant.

| Score | Clear goal | Context | Constraints | Output format | Edge cases |
|---|---|---|---|---|---|
| 0 | No discernible task | Nothing beyond the task | None | None | None |
| 1 | A topic, no task ("remote work") | Topic only | One vague limit | Medium implied | One mentioned |
| 2 | A task verb, vague deliverable | Some background | A few, mostly vague | Medium stated | A few, no handling |
| 3 | Clear deliverable | Audience or situation stated | Key hard limits stated | Medium and length | Main cases with what to do |
| 4 | Deliverable and purpose | Audience, situation and inputs | Limits plus scope | Plus structure or sections | Plus a rule for missing information |
| 5 | Deliverable, purpose and what "done" means | Everything the model can't infer | Limits, scope and reasons | Plus tone and an example or exact schema | Plus a concrete check of the result |

Two honesty rules keep the score from flattering itself:

- A dimension that rests only on defaults the user hasn't confirmed scores at most 3.
- An open `[[placeholder]]` counts as a gap in the dimension it belongs to (at most 3 there) until the user fills it.

For image and video prompts, read the dimensions as: Clear goal = subject, action and purpose; Context = setting and references; Constraints = exclusions, what must stay unchanged, rights; Output format = the target tool's syntax and settings; Edge cases = consistency, on-screen text and the tool's known weak spots.

## Variants

- **Questions round.** When you are asking questions, the reply is only the questions (see `references/questions.md`). Don't show a draft prompt yet.
- **Already strong.** First line says so. Keep the user's wording; list each edit under "What I added & why". Ask at most two questions, and only if they matter.
- **Refine.** After a change, show one line on what changed, then the full template again with the updated prompt and score.
- **Run it now.** Once the user picks this, answer the prompt like any normal request. Don't show the template, score or menu again unless they ask for another prompt.
