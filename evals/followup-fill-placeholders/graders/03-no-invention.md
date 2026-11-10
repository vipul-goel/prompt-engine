---
# The judge sees only this text and the reply, so the head quotes the request, the assumptions
# that set the prompt's lengths, counts and language, and the reply with the details. In a history
# case, double quotes mark text quoted word for word from the recording or prompt.md (validate.mjs
# checks it), so example phrases are in single quotes. D30: text prompts follow the no-invention
# rule literally. The reply may show only the filled prompt and the menu (D1), so the values that
# the recorded output's Assumptions covered are skipped rather than wanted under Assumptions again.
# So are the two counts that the recorded prompt held without stating them under Assumptions, the
# hook's length and the number of paragraphs, which those assumptions don't set (step 1e).
# An Assumption covers a number only when it states it, as in the media rubrics (step 1e).
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a product description for a handmade ceramic mug for my Etsy shop", in quick mode, so no questions were asked. The assistant's enhanced prompt left the mug's details as placeholders and listed its own defaults under Assumptions, among them "Description of 150–250 words plus a details list.", "Structure: hook, short paragraphs, details list, handmade note, soft call to action.", "Three alternative listing titles under 140 characters." and "English, as the language to respond in." The user then picked Fill placeholders and gave the details: "1 name: Moss Mug; 12 oz (350 ml), 10 cm tall and 8 cm wide; speckled stoneware, matte green glaze; dishwasher and microwave safe, not oven safe; food-safe, lead-free glaze; no maker story". The request and the details give no shop name, price, weight, names of people, dates or links.
Check every specific value the filled prompt tells the model to use: names of products, people or companies; counts, lengths, limits, prices and percentages; dates; file names; URLs. Skip values the request or the details give, values those four assumptions set (the word range, the three titles and their length limit, the language), the two counts that the assistant's prompt held without stating them under Assumptions (the hook's "1–2 sentences" and the "2–3 short paragraphs"), and examples introduced with 'for example', 'e.g.' or 'such as'.
PASS if each remaining value is a placeholder in square brackets, double or single (such as [[app name]] or [app name]), or is covered by a numbered item under Assumptions; minor values may share one item. A number is covered only when an item states it: an item that names what the number measures, such as 'a guest list', doesn't cover '40 guests'. FAIL if any remaining value is neither, whatever tag the reply gives it ([you], [best practice] or none), or if the reply contains such values and has no Assumptions section.
