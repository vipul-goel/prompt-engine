---
# After What next?: a starred Run it now, Fill placeholders or Try it here option, and Refine
# later on. Not Done ★: output-format.md's "What next?" table keeps it for image and video
# prompts. While Fill before running lists a placeholder that isn't a secret's, no Run it now ★
# or Try it here ★: the table's first row that fits is the one for open placeholders other than
# secrets, so the ★ goes to Fill placeholders (D1, D5). A placeholder is a secret's when key,
# token, secret or password ends it, also after _, or when it says api key anywhere: the rule of
# secret-redaction-quick's 09, plus password, which SKILL.md counts as a secret. So
# [[key feature]] is not one. The Fill before running section ends at the next line that starts
# with #. That condition and Refine sit in lookaheads, which the engine doesn't backtrack into,
# to keep the match fast. The option prefix
# (^|\s)(\d[.)]|[-*•])[ \t]*\** and the open-placeholder condition are shared with the image and
# video 05 graders and scripts/eval/universal-test.mjs.
type: regex
pattern: '^(?!(?=[\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\])[\s\S]*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Try it here)\**[ \t]*★)[\s\S]*?What next\?(?=[\s\S]*Refine)[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Fill (in )?(the )?placeholders|Try it here)\**[ \t]*★'
flags: i
weight: 1
---

