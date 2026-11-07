---
# Every -, * or • bullet under What I added, up to the next heading, carries a [you],
# [your answer] or [best practice] tag on the bullet's own line (output-format.md,
# "What I added & why.").
type: regex
pattern: '#+\s*What I added[^\n]*\n(?:(?!#)(?:[ \t]*[-*•][ \t][^\n]*\[(?:you|your answer|best practice)\][^\n]*|(?![ \t]*[-*•][ \t])[^\n]*)(?:\n|$))*(?:#|$)'
flags: i
weight: 1
---
