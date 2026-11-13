---
# The judge sees only this text and the reply, so the head quotes the request and says what it
# leaves out; validate.mjs holds the quote to prompt.md. D30: text prompts follow the rule
# literally, as D6 does for media. Example phrases are in single quotes.
# An Assumption covers a number only when it states it, as in the media rubrics (step 1e).
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a launch email for my productivity app", in quick mode, so no questions were asked. It gives no app name, features, audience, offer, price, discount, trial length, dates, length or character limits, counts, user numbers, testimonials or links.
Check every specific value the enhanced prompt tells the model to use: names of products, people or companies; counts, lengths, limits, prices and percentages; dates; file names; URLs. Skip values the request gives, today's date when the prompt states it on purpose, and examples introduced with 'for example', 'e.g.' or 'such as'.
PASS if each remaining value is a placeholder in square brackets, double or single (such as [[app name]] or [app name]), or is covered by a numbered item under Assumptions; minor values may share one item. A number is covered only when an item states it: an item that names what the number measures, such as 'a guest list', doesn't cover '40 guests'. FAIL if any remaining value is neither, whatever tag the reply gives it ([you], [best practice] or none), or if the reply contains such values and has no Assumptions section.
