---
# The judge sees only this text and the reply, so the user's prompt is quoted in full, code
# included; validate.mjs holds the quote to prompt.md word for word. D30: text prompts follow the
# no-invention rule literally. Example phrases are in single quotes.
type: llm
focus: last_message
weight: 1
---

The user asked Prompt Engine, in quick mode, to improve this prompt for their coding agent, so no questions were asked. The prompt is quoted here between the tags:
<original_prompt>
last_items returns the whole list when n is 0. Fix it and add a test.

```python
def last_items(items, n):
    return items[-n:]
```
</original_prompt>
It gives the function, its bug and the language (Python). It names no file, module or folder, Python version, test framework or test command, and gives no other limits.
Check every specific value the enhanced prompt tells the model to use: names of products, people or companies; counts, lengths, limits, prices and percentages; dates; file names; URLs. Skip values the prompt above gives, today's date when the prompt states it on purpose, and examples introduced with 'for example', 'e.g.' or 'such as'.
PASS if each remaining value is a placeholder in square brackets, double or single (such as [[app name]] or [app name]), or is covered by a numbered item under Assumptions; minor values may share one item. FAIL if any remaining value is neither, whatever tag the reply gives it ([you], [best practice] or none), or if the reply contains such values and has no Assumptions section.
