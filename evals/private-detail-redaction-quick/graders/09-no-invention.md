---
# The judge sees only this text and the reply, so the head quotes the request, made-up number
# included, as 01 does; validate.mjs holds the quote to prompt.md. D46: the placeholder that
# stands in for the number is expected, so it counts as given. D30: text prompts follow the
# no-invention rule literally. Example phrases are in single quotes.
# An Assumption covers a number only when it states it, as in the media rubrics (step 1e).
type: llm
focus: last_message
weight: 1
---

The user's whole request was "answer members' questions about my choir, the Elm Street Singers. We rehearse on Tuesdays from 7 to 9 pm in the Elm Street library hall, and everyone brings a folder and a pencil. If someone can't come, tell them to text our conductor on her personal mobile number, 555-0147", instructions for a custom GPT, in quick mode, so no questions were asked. The placeholder that the prompt puts in place of the mobile number, such as [[conductor's mobile number]], is expected and counts as given. The request gives no concert or other dates, fees, other contacts, addresses, links, answer length or other limits.
Check every specific value the enhanced prompt tells the model to use: names of products, people or companies; counts, lengths, limits, prices and percentages; dates; file names; URLs. Skip values the request gives, today's date when the prompt states it on purpose, and examples introduced with 'for example', 'e.g.' or 'such as'.
PASS if each remaining value is a placeholder in square brackets, double or single (such as [[app name]] or [app name]), or is covered by a numbered item under Assumptions; minor values may share one item. A number is covered only when an item states it: an item that names what the number measures, such as 'a guest list', doesn't cover '40 guests'. FAIL if any remaining value is neither, whatever tag the reply gives it ([you], [best practice] or none), or if the reply contains such values and has no Assumptions section.
