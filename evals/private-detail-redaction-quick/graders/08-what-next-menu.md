---
# D46: a placeholder that stands in for another person's private detail doesn't make Fill
# placeholders the starred option (output-format.md, "What next?": open placeholders that are
# neither secrets nor removed private details). After What next?, with Refine later on: while
# Fill before running lists a placeholder for something else, a starred Fill placeholders option,
# as writing-quick-launch-email's 08 asks; otherwise a starred Run it now or Try it here, so Fill
# placeholders ★ fails when the number's placeholder is the only one open. Not Done ★, which the
# table keeps for image and video prompts. The ★ may follow more text on the option's line, as in
# "Try it here (results there may differ) ★". A placeholder is the number's when its name says
# phone, mobile, cell, contact or number (not "number of"), as in 02, and a secret's by the rule
# of writing-quick-launch-email's 08, whose open-placeholder condition and option prefix
# (^|\s)(\d[.)]|[-*•])[ \t]*\** this pattern extends. It reads the menu from the first What
# next? on, which gives the same verdicts as reading from any of them and keeps the match linear
# in the reply's length. Residual: a placeholder for the number that is named without any of
# those words counts as open, so a correct Run it now ★ fails then.
type: regex
pattern: '^(?:(?=[\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)|phone|mobile|\bcell(?:phone)?\b|contact|number(?!\s+of\b)))[^\[\]\n]+\]\])(?:(?!What next\?)[\s\S])*What next\?(?=[\s\S]*Refine)[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Fill (in )?(the )?placeholders\b[^\n]*★|(?![\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)|phone|mobile|\bcell(?:phone)?\b|contact|number(?!\s+of\b)))[^\[\]\n]+\]\])(?:(?!What next\?)[\s\S])*What next\?(?=[\s\S]*Refine)[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Try it here)\b[^\n]*★)'
flags: i
weight: 1
---
