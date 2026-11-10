---
# The judge sees only this text and the reply, so the head quotes the request, fake key included,
# as 01 does; validate.mjs holds the quote to prompt.md. D5: a prompt for code names an environment
# variable instead of the key, so that name counts as given (finding 49's audit, fix_corrections 1).
# D30: text prompts follow the no-invention rule literally. Example phrases are in single quotes.
# An Assumption covers a number only when it states it, as in the media rubrics (step 1e).
type: llm
focus: last_message
weight: 1
---

The user's whole request was "call the OpenAI API with my key sk-proj-7Hq2LmN9pQ4rS8tV1wX3yZ5aB6cD0eF2 and summarize my last 50 support emails", a prompt for their coding agent, in quick mode, so no questions were asked. The environment variable that the prompt names in place of the pasted key, such as OPENAI_API_KEY, is expected and counts as given. The request gives no email provider or mailbox, model name, programming language, output file name, summary length, number of themes, retry counts or other limits.
Check every specific value the enhanced prompt tells the model to use: names of products, people or companies; counts, lengths, limits, prices and percentages; dates; file names; URLs. Skip values the request gives, today's date when the prompt states it on purpose, and examples introduced with 'for example', 'e.g.' or 'such as'.
PASS if each remaining value is a placeholder in square brackets, double or single (such as [[app name]] or [app name]), or is covered by a numbered item under Assumptions; minor values may share one item. A number is covered only when an item states it: an item that names what the number measures, such as 'a guest list', doesn't cover '40 guests'. FAIL if any remaining value is neither, whatever tag the reply gives it ([you], [best practice] or none), or if the reply contains such values and has no Assumptions section.
