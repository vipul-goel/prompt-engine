---
# D2: a request to critique a prompt gets the normal question round, opened by one line that
# names the prompt's biggest gaps. The judge sees only this text and the reply, so the head quotes
# the request and says what the prompt already gives; validate.mjs holds the quote to prompt.md.
# Example phrases are in single quotes.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "Use prompt-engine to critique this prompt: 'You are an expert analyst. Read the customer interview notes I paste below and list the top 5 problems customers mention, in a table.'", in standard mode, so the reply asks questions before it writes an improved prompt. The prompt already gives the task (list the problems customers mention), the input (interview notes the user will paste), a count (5) and a format (a table).
PASS if the reply opens with one line that names the prompt's biggest gaps, then asks a round of numbered multiple-choice questions, each with a recommended option. A short line that introduces the questions, such as 'A few questions first', may sit between the two.
FAIL if no line before the first question names a gap; if the comments on the prompt take more than one line, such as a list of gaps, a paragraph for each gap or a score; if the line says the prompt lacks something it gives, such as a format or a number of problems (calling a given detail too vague, such as a table without columns, is fine); or if the reply writes an improved prompt instead of asking.
