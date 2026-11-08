---
# The judge sees only this text and the reply, so the user's prompt is quoted in full; validate.mjs
# holds the quote to prompt.md word for word. D29: short additions are fine if the user's sentences
# stay in order and each one is listed; regrouping under new headings is not.
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

PASS if the reply's first line says the prompt is already strong, and the reply then either (a) asks one or two questions and shows no prompt or result yet, or (b) shows an enhanced prompt in a code block under Full prompt that keeps the user's sentences mostly word for word and in their order, keeps every rule above (the two-sentence summary; at most 6 bullets under "New", "Improved" and "Fixed"; each bullet under 20 words, in plain language, with no ticket numbers; internal-only changes left out; unclear titles listed under "Needs review"; a friendly and concise tone), and lists its edits under What I added & why. Short additions, such as a final check or tags around the pull requests, are fine if the user's sentences stay in order and each addition is listed there. Compare the Full prompt block with the original; the Short version condenses it on purpose. FAIL if the reply carries out the prompt itself (for example, it writes the release notes), asks three or more questions, rewrites most of the user's sentences, regroups them under new section headings, or drops, weakens or contradicts any rule.
