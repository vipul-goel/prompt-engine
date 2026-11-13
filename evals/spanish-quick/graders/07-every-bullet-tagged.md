---
# Every -, * or • bullet of the What I added section, up to the next heading, carries a [you],
# [your answer] or [best practice] tag on the bullet's own line (output-format.md, "What I added &
# why."). D3 translates the heading, so the section is found by its tags instead: no section holds
# both a tagged and an untagged bullet, and a tagged bullet follows the first heading. So tagged
# bullets in another section can't hide an untagged bullet among tagged ones under What I added.
# Residual: a What I added section with no tag at all still passes when another section's bullets
# are all tagged. A section runs to the next line that starts with #. The section checks start at
# each heading whose # starts its line, and at the reply's first heading when it is indented: an
# indented heading's section lies inside that of the last such heading before it, or else of the
# first heading, so the verdicts are those of checking every heading. Each line is matched at its
# first tag and each of those sections is scanned once, which keeps the match linear; until step
# 1e's B2.2.6, the section of each indented heading was scanned again to the end of the reply. The
# tags are contract strings that stay as written in every language, so they are matched in English.
type: regex
pattern: '^(?!(?:[\s\S]*?(?:^|\n)#|(?=([\s\S]*?(?:^|\n)[ \t]*#))\1(?<=[ \t]#))[^\n]*\n(?=(?:(?!#)[^\n]*\n)*?[ \t]*[-*•][ \t](?:(?!\[(?:you|your answer|best practice)\])[^\n])*\[(?:you|your answer|best practice)\])(?=(?:(?!#)[^\n]*\n)*?[ \t]*[-*•][ \t](?:(?!\[(?:you|your answer|best practice)\])[^\n])*(?:\n|$)))(?:(?!(?:^|\n)[ \t]*#)[\s\S])*(?:^|\n)[ \t]*#[\s\S]*?\n[ \t]*[-*•][ \t](?:(?!\[(?:you|your answer|best practice)\])[^\n])*\[(?:you|your answer|best practice)\]'
flags: i
weight: 1
---
