---
# A ★ on an option line, after an a) to d) option, not only in the legend or the reply line. A
# line is read from its first a) to d), which gives the same verdicts as reading from any of them
# and keeps the time linear in the reply's length (scripts/test/eval-grader-time.test.mjs).
type: regex
pattern: '(?:^|\n)(?=([^\n]*?\b[a-d]\)))\1[^\n]*★'
weight: 1
---

