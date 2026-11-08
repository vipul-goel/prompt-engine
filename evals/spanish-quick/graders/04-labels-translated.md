---
# No English template label in a non-English reply (output-format.md, D3): a heading at the start
# of a line, a score row or the Enhanced column, a menu option with the option prefix that the
# Done ★ and writing 08 checks share, or the caveat line. Paired with 05-template-present, so a
# reply without the template can't pass by leaving the labels out. The reply keywords (change N,
# deep, ok) aren't checked here until the method says whether a translated reply may also show
# the English keyword; 01 judges them.
type: regex
pattern: '(^|\n)[ \t]*#+[ \t]*(Full prompt|Short version|Fill before running|What I added|Assumptions|Score|What next)|\|[ \t]*\**(Clear goal|Edge cases|Enhanced)\**[ \t]*\||(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Fill placeholders|Try it here|Done|Refine|Save to file)\b|Self-assessed coverage of five areas'
flags: i
match: not_contains
weight: 1
---
