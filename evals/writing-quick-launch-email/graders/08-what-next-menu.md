---
# After What next?: a starred Run it now, Fill placeholders or Try it here option, and Refine
# later on. Not Done ★: output-format.md's "What next?" table keeps it for image and video
# prompts. While placeholders other than secrets' are open, no Run it now ★ or Try it here ★: the
# table's first row that fits is the one for open placeholders that are neither secrets nor
# removed private details, so the ★ goes to Fill placeholders (D1, D5, D46). They are open when
# Fill before running lists one, or when the reply has no "#" Fill before running heading and its
# Full prompt holds one: the method asks for that section whenever placeholders remain, so
# leaving it out, or writing it as a bold label, doesn't hide them (step 1e).
# A placeholder is a secret's when key, token, secret or password ends it, also after _, or when
# it says api key anywhere: the rule of
# secret-redaction-quick's 09, plus password, which SKILL.md counts as a secret. So
# [[key feature]] is not one. The Fill before running section ends at the next line that starts
# with #. The Full prompt is read from its first heading to the next heading of the output, and
# there some [[...]] don't count, such as the generic [[placeholder]], an example after such as
# and a marker the prompt tells the model to write; FILL_OPEN in scripts/eval/universal-test.mjs
# lists them all. Those conditions and Refine sit in lookaheads, which the engine doesn't
# backtrack into, to keep the match fast. The option prefix
# (^|\s)(\d[.)]|[-*•])[ \t]*\** and the open-placeholder condition are shared with the image and
# video 05 graders and scripts/eval/universal-test.mjs. D46 also leaves out the placeholder of
# another person's private detail that the method removed. This request holds none, so the
# condition doesn't model it; private-detail-redaction-quick's 08 does.
type: regex
pattern: '^(?!(?=[\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\]|(?![\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running)(?:(?!(?<!#)#+[ \t]*Full prompt)[\s\S])*(?<!#)#+[ \t]*Full prompt[^\n]*(?:\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*)*?\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*?(?<!(?:such as|e\.g\.,?|for example,?|like|write|leave(?: an?)?|insert|put)[ \t]+\x60?)(?<!\]\]\x60?(?:,|[ \t]+or)[ \t]+\x60?)(?<![\w\])])\[\[(?!placeholders?\]\])(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\])[\s\S]*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Try it here)\**[ \t]*★)[\s\S]*?What next\?(?=[\s\S]*Refine)[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Fill (in )?(the )?placeholders|Try it here)\**[ \t]*★'
flags: i
weight: 1
---

