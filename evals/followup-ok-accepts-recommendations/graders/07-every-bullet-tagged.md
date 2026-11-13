---
# Every -, * or • bullet under What I added, up to the next heading, carries a [you],
# [your answer] or [best practice] tag on the bullet's own line (output-format.md,
# "What I added & why."). The search starts once per line, at the line's first What I added
# heading, as the prompt-fenced graders do. A section also ends at a line where another such
# search starts: that section is the rest of the earlier one, so its own search decides, and the
# verdicts are those of reading each section on to its end. A tagged line is matched at its first
# tag. So a reply with an untagged bullet fails in linear time, however many tags its lines hold
# and however many of its headings start mid-line or indented; until step 1e's B2.2.6, the
# section of each such heading was read again to the end of the reply.
type: regex
pattern: '(?:^|\n)(?=([^\n]*?#\s*What I added))\1[^\n]*\n(?:(?!#)(?![^\n]*?#\s*What I added[^\n]*\n)(?:[ \t]*[-*•][ \t](?:(?!\[(?:you|your answer|best practice)\])[^\n])*\[(?:you|your answer|best practice)\][^\n]*|(?![ \t]*[-*•][ \t])[^\n]*)(?:\n|$))*(?:#|$)'
flags: i
weight: 1
---
