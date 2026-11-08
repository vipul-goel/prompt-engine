---
# D37: the user's prompt holds a ```python block, so the full prompt needs a fence longer than any
# run of backticks inside it (output-format.md, "Fences."). Fails a three-backtick fence after the
# Full prompt heading, blank lines allowed, whose text reaches an inner fence with a language tag:
# that block's closing fence would end the prompt early. Residual: an inner fence without a tag.
type: regex
pattern: '#+[ \t]*Full prompt[ \t]*\n(?:[ \t]*\n)*```(?!`)[^\n]*\n(?:(?!```)[\s\S])*\n```[A-Za-z]'
match: not_contains
weight: 1
---
