---
# D2: a request to find what's missing from a prompt gets the normal question round, opened by one
# sentence, not a list, that names the prompt's biggest gaps (SKILL.md, "When to use it": "open the
# question round with one sentence, not a list"; output-format.md, "Variants": "That line is one
# sentence, not a list"). Before step 1e this rubric asked for one line. A sentence that only
# introduces the questions may follow on the same line, as Format B's first line does
# (questions.md), and as in a kept passing run (f54bcdf); it isn't a second comment on the prompt
# (step 1e). The judge sees only this text and the reply, so the head quotes the request and says
# what the prompt already gives; validate.mjs holds the quote to prompt.md. Example phrases are in
# single quotes.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "What's missing from this prompt? Check it with prompt-engine: 'Write a product page description for my handmade soy candles, about 150 words. Make it sound premium.'", in standard mode, so the reply asks questions before it writes an improved prompt. The prompt already gives the product (handmade soy candles), where the text goes (a product page), the length (about 150 words) and the tone (premium).
PASS if the reply opens with one sentence, not a list, that names the prompt's biggest gaps, then asks a round of numbered multiple-choice questions, each with a recommended option. A short sentence that only introduces the questions, such as 'A few questions first', may follow it, on the same line or on a line of its own before the questions.
FAIL if no line before the first question names a gap; if the comments on the prompt take more than one sentence (a sentence that only introduces the questions doesn't count), such as a second sentence about the prompt, a list of gaps, a paragraph for each gap or a score; if the line says the prompt lacks something it gives, such as a length or a tone (calling a given detail too vague, such as 'premium' with no examples, is fine, and so is naming the brand's voice or a writing sample as a gap, since 'premium' is a tone word, not a voice sample); or if the reply writes an improved prompt instead of asking.
