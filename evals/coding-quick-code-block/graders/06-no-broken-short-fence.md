---
# 01's check for the Short version, which is a prompt too (output-format.md, "Fences."): fails a
# three-backtick fence after the Short version heading, blank lines allowed, whose text reaches an
# inner fence with a language tag, whose closing fence would end the short prompt early and break
# the rest of the reply. A Short version that refers to the code as a [[placeholder]] instead
# passes. The heading may carry a suffix. Residual: an inner fence without a tag.
type: regex
pattern: '#+[ \t]*Short version[^\n]*\n(?:[ \t]*\n)*```(?!`)[^\n]*\n(?:(?!```)[\s\S])*\n```[A-Za-z]'
flags: i
match: not_contains
weight: 1
---
