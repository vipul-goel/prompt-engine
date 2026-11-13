---
# The judge sees only this text and the reply, so the user's prompt is quoted in full; validate.mjs
# holds the quote to prompt.md word for word. D30: text prompts follow the no-invention rule
# literally. Example phrases are in single quotes.
# An Assumption covers a number only when it states it, as in the media rubrics (step 1e).
type: llm
focus: last_message
weight: 1
---

The user asked Prompt Engine to improve this prompt, quoted here between the tags:
<original_prompt>
I'm writing release notes. Turn the merged pull requests below into release notes for version 2.4 of our web app, for non-technical customers who read them in the in-app "What's new" panel.
Format: a two-sentence summary, then at most 6 bullets grouped under "New", "Improved" and "Fixed". Keep each bullet under 20 words, in plain language, with no ticket numbers.
Leave out internal-only changes such as refactors, CI changes and dependency bumps. If a pull request title is unclear, don't guess: list it at the end under "Needs review".
Tone: friendly and concise.

Pull requests:
- Add dark mode toggle to settings (#812)
- Fix crash when exporting empty reports (#815)
- Bump eslint to 9.3 (#816)
- Speed up dashboard load by caching widgets (#820)
</original_prompt>
Apart from the pull request titles, the prompt names no product, company, people or release date and gives no links. If the reply asks questions and shows no enhanced prompt yet, PASS.
Check every specific value the enhanced prompt tells the model to use: names of products, people or companies; counts, lengths, limits, prices and percentages; dates; file names; URLs. Skip values the prompt above gives, today's date when the prompt states it on purpose, and examples introduced with 'for example', 'e.g.' or 'such as'.
PASS if each remaining value is a placeholder in square brackets, double or single (such as [[app name]] or [app name]), or is covered by a numbered item under Assumptions; minor values may share one item. A number is covered only when an item states it: an item that names what the number measures, such as 'a guest list', doesn't cover '40 guests'. FAIL if any remaining value is neither, whatever tag the reply gives it ([you], [best practice] or none), or if the reply contains such values and has no Assumptions section.
