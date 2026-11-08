---
# Every -, * or • bullet of the What I added section, up to the next heading, carries a [you],
# [your answer] or [best practice] tag on the bullet's own line (output-format.md, "What I added &
# why."). D3 translates the heading, so the section is found by its tags instead: a section with
# at least one tagged bullet and no untagged one. Only lines that aren't bullets may come before
# the first tagged bullet, which keeps the match linear. D3 doesn't list the tags, and every
# recorded non-English reply keeps them in English, so they are matched in English.
type: regex
pattern: '(^|\n)[ \t]*#+[^\n]*\n(?:(?!#)(?![ \t]*[-*•][ \t])[^\n]*(?:\n|$))*[ \t]*[-*•][ \t][^\n]*\[(?:you|your answer|best practice)\][^\n]*(?:\n|$)(?:(?!#)(?:[ \t]*[-*•][ \t][^\n]*\[(?:you|your answer|best practice)\][^\n]*|(?![ \t]*[-*•][ \t])[^\n]*)(?:\n|$))*(?:#|$)'
flags: i
weight: 1
---
