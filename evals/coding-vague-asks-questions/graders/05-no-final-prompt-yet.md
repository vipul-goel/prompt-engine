---
# No draft in a question round: no fence, no Full prompt heading or label (bold or plain),
# no score table and no What next? menu. On the last message: the trace holds the skill text.
type: regex
pattern: '```|(#\s*|\*\*)Full prompt|(^|\n)[ \t]*Full prompt\s*:|\|\s*Clear goal\s*\||What next\?'
flags: i
match: not_contains
weight: 1
---

