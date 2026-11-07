---
# The full prompt sits in a text fence that is longer than any run of backticks inside it and
# is closed by a fence of the same length (output-format.md, "Fences.").
type: regex
pattern: '#+[ \t]*Full prompt[^\n]*\n\s*(?<f>`{3,})text[ \t]*\n(?:(?!\k<f>)[\s\S])*?\n\k<f>[ \t]*(\n|$)'
flags: i
weight: 1
---

