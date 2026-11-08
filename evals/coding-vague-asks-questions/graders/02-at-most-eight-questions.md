---
# No ninth numbered question, written in any of the forms 01 accepts (plain, bold or a heading).
type: regex
pattern: '(^|\n)[ \t]*(#+[ \t]*|\*\*)?9[.)](\s|\*\*)'
match: not_contains
weight: 1
---

