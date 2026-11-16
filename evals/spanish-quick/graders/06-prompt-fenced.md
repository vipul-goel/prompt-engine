---
# The reply's first heading, which the template makes the Full prompt heading, is followed by a
# text fence that is longer than any run of backticks inside it and is closed by a fence of the
# same length (output-format.md, "Fences."), and no fence comes before it. The heading's words
# aren't checked, because D3 translates them; the English cases' prompt-fenced graders anchor on
# Full prompt. So a Full prompt left unfenced fails, even when the Short version under the next
# heading is fenced. Residuals: an inner block with no info string still passes, since its opening
# line reads as the closing fence; a reply with another heading, such as a title, before the Full
# prompt heading fails.
type: regex
pattern: '^(?:(?!`{3}|(?:^|\n)[ \t]*#)[\s\S])*?(?:^|\n)[ \t]*#[^\n]*\n\s*(?<f>`{3,})text[ \t]*\n(?:(?!\k<f>)[\s\S])*?\n\k<f>[ \t]*(\n|$)'
flags: i
weight: 1
---
