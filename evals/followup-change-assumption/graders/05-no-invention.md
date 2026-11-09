---
# The judge sees only this text and the reply, so the head quotes the request and the change. In a
# history case, double quotes mark text quoted word for word from the recording or prompt.md
# (validate.mjs checks it), so example phrases are in single quotes. D30: text prompts follow the
# no-invention rule literally.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a product description for a handmade ceramic mug for my Etsy shop", in quick mode, so no questions were asked. After the assistant's enhanced prompt, they replied "change 2: playful and witty, still in the first person", which changes the voice the prompt had assumed. The request and the change give no mug name, capacity, dimensions, materials, glaze or colors, care or safety facts, maker story, shop name, price, names of people, counts, lengths, limits, dates or links.
Check every specific value the enhanced prompt tells the model to use: names of products, people or companies; counts, lengths, limits, prices and percentages; dates; file names; URLs. Skip values the request or the change gives, today's date when the prompt states it on purpose, and examples introduced with 'for example', 'e.g.' or 'such as'.
PASS if each remaining value is a placeholder in square brackets, double or single (such as [[app name]] or [app name]), or is covered by a numbered item under Assumptions; minor values may share one item. FAIL if any remaining value is neither, whatever tag the reply gives it ([you], [best practice] or none), or if the reply contains such values and has no Assumptions section.
