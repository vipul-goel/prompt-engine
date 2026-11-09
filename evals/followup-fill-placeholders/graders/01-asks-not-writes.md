---
# The judge sees only this text and the reply, so the head quotes the request, the open
# placeholders and the menu option that the reply answers. In a history case, double quotes mark
# text quoted word for word from the recording or prompt.md (validate.mjs checks it); example
# phrases are in single quotes. D1: Fill placeholders asks for the open values, then shows the
# filled prompt and the menu again; it runs nothing by itself (SKILL.md, section 6).
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a product description for a handmade ceramic mug for my Etsy shop", in quick mode. The assistant answered with an enhanced prompt whose Fill before running section listed six open placeholders, the last of them optional: "[[mug name or style]]", "[[capacity and dimensions]]", "[[clay, glaze and colors]]", "[[care and safety info]]", "[[food-safety info]]" and "[[maker story]]". Its What next? menu offered "Fill placeholders ★: reply with the missing mug details to see the filled prompt", and the user replied "1", which picks that option.
PASS if the reply asks the user for the missing mug details, the open placeholders above, by name or in its own words, and runs nothing. FAIL if it writes the product description or any part of the listing, runs the prompt, or fills a placeholder with a detail the user didn't give, such as a capacity, a glaze color or a care instruction. Example values that show the user how to answer, introduced with 'for example', 'e.g.' or 'such as', don't fill a placeholder.
