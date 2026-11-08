---
# The reply's first fenced block, which the template makes the full prompt, sits right under a
# heading in a text fence that is longer than any run of backticks inside it and is closed by a
# fence of the same length (output-format.md, "Fences."). The heading's words aren't checked,
# because D3 translates them; the English cases' prompt-fenced graders anchor on Full prompt.
# Residual: an inner block with no info string still passes, since its opening line reads as the
# closing fence.
type: regex
pattern: '^(?:(?!`{3})[\s\S])*?(^|\n)[ \t]*#+[^\n]*\n\s*(?<f>`{3,})text[ \t]*\n(?:(?!\k<f>)[\s\S])*?\n\k<f>[ \t]*(\n|$)'
flags: i
weight: 1
---
