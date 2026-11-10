---
# Every -, * or • bullet under What I added, up to the next heading, carries a [you],
# [your answer] or [best practice] tag on the bullet's own line (output-format.md,
# "What I added & why."). A tagged line is matched at its first tag, so a reply with an
# untagged bullet fails in linear time, however many tags its lines hold.
type: regex
pattern: '#\s*What I added[^\n]*\n(?:(?!#)(?:[ \t]*[-*•][ \t](?:(?!\[(?:you|your answer|best practice)\])[^\n])*\[(?:you|your answer|best practice)\][^\n]*|(?![ \t]*[-*•][ \t])[^\n]*)(?:\n|$))*(?:#|$)'
flags: i
weight: 1
---
