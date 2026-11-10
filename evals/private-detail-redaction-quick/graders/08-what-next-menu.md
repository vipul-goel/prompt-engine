---
# D46: a placeholder that stands in for another person's private detail doesn't make Fill
# placeholders the starred option (output-format.md, "What next?": open placeholders that are
# neither secrets nor removed private details). After What next?, with Refine later on: while
# Fill before running lists a placeholder for something else, or the Full prompt holds one, with
# or without that heading (step 1e), a starred Fill placeholders option,
# as writing-quick-launch-email's 08 asks; otherwise a starred Run it now or Try it here, so Fill
# placeholders ★ fails when the number's placeholder is the only one open. Both Run it now ★ and
# Try it here ★ pass: the table names the option Try it here for a prompt meant for another
# tool, such as a custom GPT, but this case tests D46's rule for the ★, not that row. Not Done ★,
# which the table keeps for image and video prompts. The ★ may follow more text on the option's line, as in
# "Try it here (results there may differ) ★", up to 200 characters and before the next numbered
# option on that line, so in "1. Try it here 2. Fill placeholders ★" the ★ is option 2's. Only
# one option is starred, so a second ★ after the first What next? fails (step 1e). A
# placeholder is the number's by 02's rule, so
# [[choir contact email]] or [[room number]] is open, and a secret's by the rule
# of writing-quick-launch-email's 08, whose open-placeholder condition and option prefix
# (^|\s)(\d[.)]|[-*•])[ \t]*\** this pattern extends. It reads the menu from the first What
# next? on, which gives the same verdicts as reading from any of them. On the adversarial inputs
# of T1's grader review, its time grew linearly with the reply's length in Node 24 and in
# macOS's JavaScriptCore. Residuals, as in 02: a placeholder for the number named without 02's
# words counts as open, so a correct Run it now ★ fails then; one for something else that says
# phone, such as [[choir phone tree link]], doesn't count as open.
type: regex
pattern: '^(?!(?:(?!What next\?)[\s\S])*What next\?[^★]*★[^★]*★)(?:(?=[\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)|phone|mobile|\bcell(?:phone)?\b|(?:conductor|\bher\b|personal|private|contact)[^\[\]\n]{0,40}?number|(?:conductor|\bher\b|personal|private)[^\[\]\n]{0,40}?contact))[^\[\]\n]+\]\]|(?:(?!(?<!#)#+[ \t]*Full prompt)[\s\S])*(?<!#)#+[ \t]*Full prompt[^\n]*(?:\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*)*?\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*?(?=\[\[)(?<!(?:such as|e\.g\.,?|for example,?|like|write|leave(?: an?)?|insert|put)[ \t]+\x60?)(?<!\]\]\x60?(?:,|[ \t]+or)[ \t]+\x60?)(?<![\w\])])\[\[(?!placeholders?\]\])(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)|phone|mobile|\bcell(?:phone)?\b|(?:conductor|\bher\b|personal|private|contact)[^\[\]\n]{0,40}?number|(?:conductor|\bher\b|personal|private)[^\[\]\n]{0,40}?contact))[^\[\]\n]+\]\])(?:(?!What next\?)[\s\S])*What next\?(?=[\s\S]*Refine)[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Fill (in )?(the )?placeholders\b(?:(?!\s\d[.)]\s)[^\n★]){0,200}★|(?![\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)|phone|mobile|\bcell(?:phone)?\b|(?:conductor|\bher\b|personal|private|contact)[^\[\]\n]{0,40}?number|(?:conductor|\bher\b|personal|private)[^\[\]\n]{0,40}?contact))[^\[\]\n]+\]\]|(?:(?!(?<!#)#+[ \t]*Full prompt)[\s\S])*(?<!#)#+[ \t]*Full prompt[^\n]*(?:\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*)*?\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*?(?=\[\[)(?<!(?:such as|e\.g\.,?|for example,?|like|write|leave(?: an?)?|insert|put)[ \t]+\x60?)(?<!\]\]\x60?(?:,|[ \t]+or)[ \t]+\x60?)(?<![\w\])])\[\[(?!placeholders?\]\])(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)|phone|mobile|\bcell(?:phone)?\b|(?:conductor|\bher\b|personal|private|contact)[^\[\]\n]{0,40}?number|(?:conductor|\bher\b|personal|private)[^\[\]\n]{0,40}?contact))[^\[\]\n]+\]\])(?:(?!What next\?)[\s\S])*What next\?(?=[\s\S]*Refine)[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Try it here)\b(?:(?!\s\d[.)]\s)[^\n★]){0,200}★)'
flags: i
weight: 1
---
