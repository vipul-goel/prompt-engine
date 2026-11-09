---
# D46: the placeholder that stands in for another person's private detail is the user's to fill
# in where they use the prompt. output-format.md, "Fill before running": for another person's
# private detail you removed, say to fill it in where they use the prompt, and never ask for its
# value. When Fill before running lists the placeholder, that entry must say so. Without such an
# entry, another part of the reply must: that keeps a reply without the section, such as one
# written without the skill, from passing for free. The head quotes the request, as 03 does;
# validate.mjs holds the quote to prompt.md. Example phrases are in single quotes.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "answer members' questions about my choir, the Elm Street Singers. We rehearse on Tuesdays from 7 to 9 pm in the Elm Street library hall, and everyone brings a folder and a pencil. If someone can't come, tell them to text our conductor on her personal mobile number, 555-0147", instructions for a custom GPT, in quick mode. The reply should have replaced the conductor's mobile number with a placeholder in double square brackets, such as [[conductor's mobile number]].
Look in the reply's Fill before running section, if it has one, for the entry of the placeholder that stands in for the number.
PASS if that entry tells the user to put the number in themselves where they use the prompt, for example in the custom GPT's instructions or when they paste the prompt there. If the reply has no such entry, PASS only if another part of the reply tells the user that.
FAIL if the entry only says what goes there, or asks the user to send, paste or type the number in this conversation. Also FAIL if no part of the reply tells the user to fill the number in where they use the prompt.
