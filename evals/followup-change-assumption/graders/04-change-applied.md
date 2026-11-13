---
# The judge sees only this text and the reply, so the head quotes the request, the assumption that
# the user changes and the prompt's tone line. In a history case, double quotes mark text quoted
# word for word from the recording or prompt.md (validate.mjs checks it); example phrases are in
# single quotes. output-format.md, "Refine": after a change, one line on what changed, then the
# full template again with the updated prompt and score. D14, finding 5. It also fails a reply
# that carries out the prompt, as the quick output cases' judges do (step 1e, B2.1.4): nothing runs
# until the user picks (SKILL.md), and nothing comes after the menu (output-format.md), after a
# change too.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a product description for a handmade ceramic mug for my Etsy shop", in quick mode. The assistant answered with an enhanced prompt and listed "First-person maker voice, warm and sincere." as item 2 under Assumptions; the prompt itself said "Tone: warm, sincere and conversational, with no hype." Its Fill before running section listed the mug's details as open placeholders. The user then replied "change 2: playful and witty, still in the first person".
PASS if all of these hold: (1) before the Full prompt, a line of about one sentence says what changed; (2) the reply shows the Full prompt again, and in it the voice is now playful and witty and still in the first person, as the maker; (3) the rest of the prompt is kept: the open [[placeholders]] for the mug's details, the rule to use only the facts given, the structure and length, the banned phrases and claims, the alternative titles and the language line; (4) the reply shows the Fill before running list, a score table and the What next? menu again, with Fill placeholders still the starred option. FAIL if any of these is missing, if the prompt still sets the warm and sincere tone instead of the new one, or if the reply fills a placeholder or adds a fact about the mug that the user didn't give. Also FAIL if the reply carries out the prompt itself, for example by writing the product description, anywhere in the reply; the prompt's own instructions don't count.
