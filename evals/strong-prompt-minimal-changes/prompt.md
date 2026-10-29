---
tags: [writing, standard, smoke]
max_turns: 16
timeout_seconds: 480
allowed_tools: [Read, Glob, Grep, Skill, AskUserQuestion]
---

Use prompt-engine on my prompt:

I'm writing release notes. Turn the merged pull requests below into release notes for version 2.4 of our web app, for non-technical customers who read them in the in-app "What's new" panel.
Format: a two-sentence summary, then at most 6 bullets grouped under "New", "Improved" and "Fixed". Keep each bullet under 20 words, in plain language, with no ticket numbers.
Leave out internal-only changes such as refactors, CI changes and dependency bumps. If a pull request title is unclear, don't guess: list it at the end under "Needs review".
Tone: friendly and concise.

Pull requests:
- Add dark mode toggle to settings (#812)
- Fix crash when exporting empty reports (#815)
- Bump eslint to 9.3 (#816)
- Speed up dashboard load by caching widgets (#820)
