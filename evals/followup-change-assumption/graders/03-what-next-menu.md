---
# After What next?: one starred Run it now, Fill placeholders or Try it here option, and Refine
# later on, as writing-quick-launch-email's 08 checks it, with the same pattern. The mug's details
# are still open placeholders after the change, so the table's first row that fits is the one for
# open placeholders that are neither secrets nor removed private details (output-format.md, "What
# next?"; D46), and the ★ stays on Fill placeholders: while Fill before running lists a
# placeholder that isn't a secret's, or the reply has no "#" Fill before running heading and its
# Full prompt holds one (step 1e), a starred Run it now or Try it here fails. This conversation
# holds no private detail, so the condition doesn't model D46. 08's comments say what counts as a
# secret's placeholder, why the conditions sit in lookaheads and why the menu is read from the
# first What next? on.
type: regex
pattern: '^(?!(?:(?!What next\?)[\s\S])*What next\?[^★]*★[^★]*★)(?!(?=[\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\]|(?![\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running)(?:(?!(?<!#)#+[ \t]*Full prompt)[\s\S])*(?<!#)#+[ \t]*Full prompt[^\n]*(?:\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*)*?\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*?(?<!(?:such as|e\.g\.,?|for example,?|like|write|leave(?: an?)?|insert|put)[ \t]+\x60?)(?<!\]\]\x60?(?:,|[ \t]+or)[ \t]+\x60?)(?<![\w\])])\[\[(?!placeholders?\]\])(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\])(?:(?!What next\?)[\s\S])*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Try it here)\**[ \t]*★)(?:(?!What next\?)[\s\S])*What next\?(?=[\s\S]*Refine)[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Fill (in )?(the )?placeholders|Try it here)\**[ \t]*★'
flags: i
weight: 1
---
