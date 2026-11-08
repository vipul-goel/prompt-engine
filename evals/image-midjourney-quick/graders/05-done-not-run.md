---
# After What next?: no Run it now option, and a starred Done option (output-format.md, "What
# next?": an image or video prompt when you can't generate media), or a starred Fill
# placeholders option while Fill before running lists a placeholder that isn't a secret's: the
# table's first row that fits is the one for open placeholders other than secrets (D1, D5), so
# Done ★ fails then. One check, so the no-skill arm gets no free point. The option prefix
# (^|\s)(\d[.)]|[-*•])[ \t]*\** and the open-placeholder condition are shared with
# writing-quick-launch-email's 08, which says what counts as a secret's placeholder, and with
# scripts/eval/universal-test.mjs.
type: regex
pattern: '^(?![\s\S]*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Run it now)(?:(?=[\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\])[\s\S]*?What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Fill (in )?(the )?placeholders\**[ \t]*★|(?![\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\])[\s\S]*?What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Done\b[^\n]*★)'
flags: i
weight: 1
---

