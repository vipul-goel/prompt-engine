---
# D2: a request to find what's missing from a prompt gets the normal question round, opened by one
# line that names the prompt's biggest gaps. The judge sees only this text and the reply, so the
# head quotes the request and says what the prompt already gives; validate.mjs holds the quote to
# prompt.md. Example phrases are in single quotes.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "What's missing from this prompt? Check it with prompt-engine: 'Write a product page description for my handmade soy candles, about 150 words. Make it sound premium.'", in standard mode, so the reply asks questions before it writes an improved prompt. The prompt already gives the product (handmade soy candles), where the text goes (a product page), the length (about 150 words) and the tone (premium).
PASS if the reply opens with one line that names the prompt's biggest gaps, then asks a round of numbered multiple-choice questions, each with a recommended option. A short line that introduces the questions, such as 'A few questions first', may sit between the two.
FAIL if no line before the first question names a gap; if the comments on the prompt take more than one line, such as a list of gaps, a paragraph for each gap or a score; if the line says the prompt lacks something it gives, such as a length or a tone (calling a given detail too vague, such as 'premium' with no examples, is fine); or if the reply writes an improved prompt instead of asking.
