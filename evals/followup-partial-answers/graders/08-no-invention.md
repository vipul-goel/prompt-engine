---
# The judge sees only this text and the reply, so the head quotes the request and the answers. In
# a history case, double quotes mark text quoted word for word from the recording or prompt.md
# (validate.mjs checks it), so example phrases are in single quotes. D30: text prompts follow the
# no-invention rule literally.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a blog post about remote work". They then answered a round of seven questions with "2c 4b 5: write it like a newsletter from a founder who has run a remote team for 6 years"; questions they skipped keep the recommended (★) answer. The answers, quoted from the question round and the reply, are:
1. "Managers and business owners"
2. "Practical tips for working remotely well"
3. "Come away with 3–5 ideas they can use this week"
4. "About 1,500–2,000 words, in-depth"
5. "write it like a newsletter from a founder who has run a remote team for 6 years"
6. "Use no statistics, and leave `[[placeholders]]` where a number would help"
7. "None. Write for the reader first"
The request and these answers give no title, names of people or companies, number of sections, statistics, dates or links.
Check every specific value the enhanced prompt tells the model to use: names of products, people or companies; counts, lengths, limits, prices and percentages; dates; file names; URLs. Skip values the request or the answers give, today's date when the prompt states it on purpose, and examples introduced with 'for example', 'e.g.' or 'such as'.
PASS if each remaining value is a placeholder in square brackets, double or single (such as [[app name]] or [app name]), or is covered by a numbered item under Assumptions; minor values may share one item. FAIL if any remaining value is neither, whatever tag the reply gives it ([you], [your answer], [best practice] or none), or if the reply contains such values and has no Assumptions section.
