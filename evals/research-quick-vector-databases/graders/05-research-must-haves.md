---
# Also fails a reply that carries out the prompt: nothing runs until the user picks (SKILL.md),
# and nothing comes after the menu (output-format.md), as strong-prompt-minimal-changes' 01
# checks (step 1e).
type: llm
focus: last_message
weight: 1
---

PASS if the enhanced prompt (1) says which sources to prefer or how to cite claims, (2) handles recency, for example by giving today's date, an 'as of' date, or telling the model to check current information, (3) says what to do when evidence is missing or uncertain, and (4) defines the comparison criteria. FAIL if any of the four is missing. Also FAIL if the reply carries out the prompt itself, for example by writing the comparison of vector databases, anywhere in the reply; the prompt's own instructions don't count.
