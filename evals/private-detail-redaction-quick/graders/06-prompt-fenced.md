---
# The full prompt sits in a text fence that is longer than any run of backticks inside it and
# is closed by a fence of the same length (output-format.md, "Fences."). Residual: an inner
# block with no info string still passes, since its opening line reads as the closing fence.
# The search starts once per line, at the line's first Full prompt heading, which a lookahead
# finds and a backreference matches as one piece: every heading on a line leads to the same next
# line, and reading the rest of the line again from each heading on it took seconds on a line
# that repeats the heading (step 1e, B2.2.6).
type: regex
pattern: '(?:^|\n)(?=([^\n]*?#[ \t]*Full prompt))\1[^\n]*\n\s*(?<f>`{3,})text[ \t]*\n(?:(?!\k<f>)[\s\S])*?\n\k<f>[ \t]*(\n|$)'
flags: i
weight: 1
---
