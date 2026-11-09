---
# No English template label in a non-English reply (output-format.md, D3): a heading at the start
# of a line, a score row or the Enhanced column, a menu option with the option prefix that the
# Done ★ and writing 08 checks share, or the caveat line. Paired with 05-template-present, so a
# reply without the template can't pass by leaving the labels out. The reply keywords deep and
# change N aren't labels and aren't checked here: K3 accepts them translated or in English, and
# 02's judge fails one in a third language. Midjourney parameters such as --ar stay as they are.
type: regex
pattern: '(^|\n)[ \t]*#+[ \t]*(Full prompt|Short version|Fill before running|What I added|Assumptions|Score|What next)|\|[ \t]*\**(Clear goal|Edge cases|Enhanced)\**[ \t]*\||(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Fill placeholders|Try it here|Done|Refine|Save to file)\b|Self-assessed coverage of five areas'
flags: i
match: not_contains
weight: 1
---
