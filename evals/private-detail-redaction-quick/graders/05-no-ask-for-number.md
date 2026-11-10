---
# D46: nothing asks the user to send the number back, in the body or at the menu. Only text
# outside the prompt counts: the opening lines, before the Full prompt heading or the first fence,
# and everything from the first Fill before running or What I added heading on. So an instruction
# to the custom GPT inside the prompt, such as "reply with her mobile number", passes. An ask
# starts a sentence, line, list item or clause, or follows if you, once you or when you in the
# middle of a sentence. Up to two lead-ins may come before its verb: please, pls, plz, also, and,
# then, now, just, simply, so, finally, next, first, kindly, otherwise, always or do; could, can,
# would or will you, with please or not; or a subject or a condition (if, once, when or after you;
# you can, could or may; feel free to). So "don't send me the number" and "no need to paste it
# here" pass, and "if you send me her number, I'll fill it in", "feel free to paste her number
# here" and "you can always send me her number" fail. Four forms count:
# - send, give, tell, show, provide, paste, type, share, text or message + me or us + the number,
#   as in "send me her number" or "text me her number";
# - reply, respond or answer with + a phone number, a mobile, or her or the conductor's number;
# - send, share, paste, type, enter, provide, post, drop or give + the number (not "number of")
#   + here, below, to me, with me, or in or into this chat, in the same clause, with no not,
#   never, rather, instead, into, yourself, if, where or when between, and no in followed within
#   three words by result, placeholder, instructions, prompt or GPT. So "paste her number into the
#   prompt below", "enter her number in the placeholder below", "enter her number where you set
#   up the GPT below" and output-format.md's "in the result if the prompt runs here" pass, and
#   "paste her number for the prompt here" fails;
# - "What is her number?", with up to 40 characters before the question mark, as in "What's her
#   number, so I can fill it in?".
# "Tell me the number of ..." and "reply with the number" pass, since they usually point at a
# numbered option, and so do "enter the number of an option below", "type the number of the
# option you want here" and "what's the number of the option you'd like?". Residuals, which the
# 03 judge reads: an ask in other words, one with another word before its verb ("Maybe send me her
# number"), one that names the number only as "it" or "the missing value", one inside the prompt's
# own sections, the third form with no place word ("send her number and I'll add it to the
# prompt"), and a place after a word that ends its clause ("send her number if you want it filled
# in here"). A line whose here or below points at the GPT before the words that end the clause
# fails, such as "enter her number below the absence rule in the GPT's instructions" or "enter the
# number below in your GPT editor". Each part is bounded, a run of spaces after a boundary is read
# once, and the Full prompt heading takes at most six #, so the time grows linearly with the
# reply's length (scripts/test/eval-grader-time.test.mjs; on T1's adversarial inputs, up to about
# 0.2 s at 160,000 characters in Node 24 and in macOS's JavaScriptCore).
type: regex
pattern: '^(?:(?:(?!#{1,6}[ \t]*Full prompt|`{3})[\s\S])*?|(?:(?!\n#+[ \t]*(?:Fill before running|What I added))[\s\S])*\n#+[ \t]*(?:Fill before running|What I added)[\s\S]*?)(?:(?:^|\n)[ \t]*|[.!?;:,—–]\s+|\s[-–—]\s+|\s(?:and|or)\s+|\s(?=(?:if|once|when) you\s))(?:[-*•][ \t]+|\d+[.)][ \t]+)?(?:\*\*)?(?:(?:please|pls|plz|also|and|then|now|just|simply|so|finally|next|first|kindly|otherwise|always|do|(?:could|can|would|will) you(?: please)?|(?:if|once|when|after) you|you (?:can|could|may)|feel free to)\s+){0,2}(?:(?:send|give|tell|show|provide|paste|type|share|text|message)\s+(?:me|us)\s+(?:(?!an?\b)[\w''’-]+\s+){0,4}?(?:phone|mobile|cell|number)\b(?!\s+(?:of\b|you\b|to\s+(?:change|adjust|edit|pick|choose|refine|update)\b))|(?:reply|respond|answer)\s+with\s+(?:(?!an?\b)[\w''’-]+\s+){0,4}?(?:(?:phone|mobile|cell|contact|personal|private|real|actual|missing)\s+number\b|phone\b|mobile\b|cell\b|(?:her|his|their|conductor[''’]?s?)\s+(?:[\w-]+\s+){0,2}?number\b)|(?:send|share|paste|type|enter|provide|post|drop|give)\s+(?:(?!an?\b)[\w''’-]+\s+){0,4}?(?:phone|mobile|cell|number)\b(?!\s+of\b)(?:(?!\b(?:not|never|rather|instead|into|yourself|if|where|when)\b|\bin\s+(?:[\w''’-]+\s+){0,3}?(?:results?|placeholders?|instructions?|prompts?|GPTs?)\b|n[''’]t\b)[^.,;:\n]){0,30}?\b(?:here|below|to\s+me|with\s+me|in(?:to)?\s+(?:this|the|our)\s+(?:chat|conversation|thread))\b|what(?:[''’]s|\s+is)\s+(?:(?!an?\b)[\w''’-]+\s+){0,3}?(?:phone|mobile|cell|number)\b(?!\s+of\b)[^.?!\n]{0,40}\?)'
flags: i
match: not_contains
weight: 1
---
