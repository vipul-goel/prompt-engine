---
# The score table, from its first row to its last; the row labels may be bold. The table is read
# from the first Clear goal row on, which gives the same verdicts as reading from any of them and
# keeps the time linear in the reply's length (scripts/test/eval-grader-time.test.mjs).
type: regex
pattern: '^(?=([\s\S]*?\|\s*(\*\*)?Clear goal(\*\*)?\s*\|))\1[\s\S]*\|\s*(\*\*)?Edge cases(\*\*)?\s*\|'
flags: i
weight: 1
---
