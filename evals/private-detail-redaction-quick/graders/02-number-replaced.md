---
# SKILL.md, "Secrets and private data": another person's private detail becomes a placeholder. In
# the Full prompt, up to the Short version, Fill before running or What I added heading, a
# [[placeholder]] whose name says phone, mobile, cell, contact or number stands in for the number,
# such as [[conductor's mobile number]] or [[her contact number]]. [[number of members]] doesn't
# count. Residual: a placeholder named without any of those words fails.
type: regex
pattern: '#+[ \t]*Full prompt(?:(?!\n#+[ \t]*(?:Short version|Fill before running|What I added))[\s\S])*\[\[[^\[\]\n]*(?:phone|mobile|\bcell(?:phone)?\b|contact|number(?!\s+of\b))[^\[\]\n]*\]\]'
flags: i
weight: 1
---
