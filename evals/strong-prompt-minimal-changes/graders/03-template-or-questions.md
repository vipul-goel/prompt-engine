---
# Either the output template, with the fence right under the Full prompt heading, or a ★
# question round with no Full prompt anywhere, whose question 1 or 2 contains a "?"; its
# number may be bold or a heading, as coding-vague 01 accepts (output-format.md, "Template"
# and "Variants"). A reply that carries out the prompt matches neither. No flags, so the
# heading must read "Full prompt" and a lower-case "full prompt" in a question round's prose
# doesn't count.
type: regex
pattern: '#\s*Full prompt\s*\n```|^(?![\s\S]*Full prompt)(?=[\s\S]*★)[\s\S]*\n[ \t]*(?:#+[ \t]*|\*\*)?[12][.)](?:\s|\*\*)[^\n]*\?'
weight: 1
---
