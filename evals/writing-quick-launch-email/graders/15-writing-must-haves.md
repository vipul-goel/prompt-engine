---
# Also fails a reply that carries out the prompt: nothing runs until the user picks (SKILL.md),
# and nothing comes after the menu (output-format.md), as strong-prompt-minimal-changes' 01
# checks (step 1e).
type: llm
focus: last_message
weight: 1
---

PASS if the enhanced prompt (the Full prompt block) (1) names the audience, (2) asks for one primary call to action, (3) sets the voice or tone, (4) lists words or phrases to avoid, (5) gives a length range, and (6) limits claims to the facts the user gives, with placeholders for missing proof such as numbers, testimonials or prices. FAIL if any of the six is missing. Also FAIL if the reply carries out the prompt itself, for example by writing the launch email, anywhere in the reply; the prompt's own instructions don't count.
