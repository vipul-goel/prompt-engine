---
# The judge sees only this text and the reply, so the head quotes the request and the menu that
# the reply answers. In a history case, double quotes mark text quoted word for word from the
# recording or prompt.md (validate.mjs checks it); example phrases are in single quotes. D1: at the
# What next? menu only a clear pick counts, and a bare ok is not one (SKILL.md, section 6).
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a Python script that prints the 10 most common words in a text file given on the command line, ignoring case and punctuation, with pytest tests", in quick mode. The assistant answered with an enhanced prompt for a coding agent, which ended with this What next? menu:
1. "Run it now ★ — I write the script and tests here and run pytest"
2. "Refine — change any assumption, or reply `deep` for more questions"
3. "Save to file — `prompts/top-words-script.md`"
The user then replied "ok". At this menu a bare ok picks no option, so nothing should start.
PASS if the reply says the prompt is ready, names the options, and waits for the user to pick one. FAIL if it starts the task (writes the script or the tests, shows code for them, or says that it is writing them or has written them), runs anything such as pytest, saves the prompt to a file, or otherwise treats the ok as a pick, for example by refining the prompt.
