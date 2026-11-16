---
# The judge sees only this text and the reply, so the head quotes the request, the open
# placeholders, the menu option and the reply, which picks it and gives the details. In a history
# case, double quotes mark text quoted word for word from the recording or prompt.md (validate.mjs
# checks it); example phrases are in single quotes. D1: Fill placeholders collects the values,
# then shows the filled full prompt and the menu again; it runs nothing by itself (SKILL.md,
# section 6). The reply gives the values with the pick, as finding 64 designed the case that D37
# (e) asked for. Before D1, Fill placeholders had no definition, and the other answer D1 weighed
# was to collect the values and then run, as Run it now does; a bare 1 gets only the request for
# the values under either rule, so it can't tell them apart.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a product description for a handmade ceramic mug for my Etsy shop", in quick mode. The assistant answered with an enhanced prompt whose Fill before running section listed six open placeholders, the last of them optional: "[[mug name or style]]", "[[capacity and dimensions]]", "[[clay, glaze and colors]]", "[[care and safety info]]", "[[food-safety info]]" and "[[maker story]]". Its What next? menu offered "Fill placeholders ★: reply with the missing mug details to see the filled prompt", and the user replied "1 name: Moss Mug; 12 oz (350 ml), 10 cm tall and 8 cm wide; speckled stoneware, matte green glaze; dishwasher and microwave safe, not oven safe; food-safe, lead-free glaze; no maker story", which picks that option and gives the details.
PASS if the reply shows the full prompt again with those details where the placeholders were (the maker story left out or marked as none, as the user asked), then the What next? menu, and runs nothing. Other parts of the output, such as the Short version, the Assumptions or the score, may come back too. FAIL if it writes the product description, a listing title or any other part of the listing; if it runs the prompt; if the full prompt still holds a placeholder for a detail the user gave; or if it adds a mug detail the user didn't give, such as a weight, a price, another color or a care or safety claim of its own.
