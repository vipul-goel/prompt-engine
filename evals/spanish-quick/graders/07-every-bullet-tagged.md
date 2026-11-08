---
# Every -, * or • bullet of the What I added section, up to the next heading, carries a [you],
# [your answer] or [best practice] tag on the bullet's own line (output-format.md, "What I added &
# why."). D3 translates the heading, so the section is found by its tags instead: no section holds
# both a tagged and an untagged bullet, and a tagged bullet follows the first heading. So tagged
# bullets in another section can't hide an untagged bullet among tagged ones under What I added.
# Residual: a What I added section with no tag at all still passes when another section's bullets
# are all tagged. Each line is matched at its first tag and each section is scanned once, which
# keeps the match linear. The tags are contract strings that stay as written in every language, so
# they are matched in English.
type: regex
pattern: '^(?![\s\S]*?(?:^|\n)[ \t]*#[^\n]*\n(?=(?:(?!#)[^\n]*\n)*?[ \t]*[-*•][ \t](?:(?!\[(?:you|your answer|best practice)\])[^\n])*\[(?:you|your answer|best practice)\])(?=(?:(?!#)[^\n]*\n)*?[ \t]*[-*•][ \t](?:(?!\[(?:you|your answer|best practice)\])[^\n])*(?:\n|$)))(?:(?!(?:^|\n)[ \t]*#)[\s\S])*(?:^|\n)[ \t]*#[\s\S]*?\n[ \t]*[-*•][ \t](?:(?!\[(?:you|your answer|best practice)\])[^\n])*\[(?:you|your answer|best practice)\]'
flags: i
weight: 1
---
