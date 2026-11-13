---
# The Full prompt block holds at most 1,130 characters: 1.5 times the user's 753-character prompt
# (prompt.md's body after its first line), the ceiling D29 set. The count runs from the line after
# the opening fence to the closing fence, which is as long as the opening one (output-format.md,
# "Fences."), so an inner ``` block in a four-backtick fence doesn't end it early. A question round
# has no Full prompt and passes; 03 checks that the reply is one of the two shapes.
type: regex
pattern: '#\s*Full prompt\s*\n(?<f>`{3,})(?!`)[^\n]*\n(?:(?!\n\k<f>)[\s\S]){1131}'
match: not_contains
weight: 1
---
