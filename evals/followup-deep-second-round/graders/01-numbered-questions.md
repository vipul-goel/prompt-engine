---
# A numbered question: a line whose number may be bold or a heading, as coding-vague-asks-questions'
# 01 reads it (finding 60), and that holds a question mark, so a numbered list of the accepted
# answers doesn't count. Any number, since a second round may go on from 8.
type: regex
pattern: '(^|\n)[ \t]*(#+[ \t]*|\*\*)?\d+[.)](\s|\*\*)[^\n]*\?'
weight: 1
---
