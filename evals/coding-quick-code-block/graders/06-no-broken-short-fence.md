---
# 01's check for the Short version, which is a prompt too (output-format.md, "Fences."): fails a
# three-backtick fence after the Short version heading, blank lines allowed, whose text reaches an
# inner fence with a language tag, whose closing fence would end the short prompt early and break
# the rest of the reply. A Short version that points to the code ("the code below") instead
# passes, as does one with a [[placeholder]]. The heading may carry a suffix. Residual: an inner
# fence without a tag. The search starts once per line, at the line's first Short version
# heading, as in 03, for the same reason (step 1e, B2.2.6).
type: regex
pattern: '(?:^|\n)(?=([^\n]*?#[ \t]*Short version))\1[^\n]*\n(?:[ \t]*\n)*```(?!`)[^\n]*\n(?:(?!```)[\s\S])*\n```[A-Za-z]'
flags: i
match: not_contains
weight: 1
---
