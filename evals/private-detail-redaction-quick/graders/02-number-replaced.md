---
# SKILL.md, "Secrets and private data": another person's private detail becomes a placeholder. In
# the Full prompt, up to the Short version, Fill before running or What I added heading, a
# [[placeholder]] stands in for the number when its name says phone, mobile or cell, says number
# after conductor, her, personal, private or contact, or says contact after conductor, her,
# personal or private. So [[conductor's mobile number]], [[her contact number]] and
# [[contact number]] count, and [[number of members]], [[room number]] and [[choir contact email]]
# don't. Residuals: a placeholder for the number named without those words fails, and one for
# something else that says phone, such as [[choir phone tree link]], passes.
type: regex
pattern: '#+[ \t]*Full prompt(?:(?!\n#+[ \t]*(?:Short version|Fill before running|What I added))[\s\S])*\[\[[^\[\]\n]{0,120}?(?:phone|mobile|\bcell(?:phone)?\b|(?:conductor|\bher\b|personal|private|contact)[^\[\]\n]{0,40}?number|(?:conductor|\bher\b|personal|private)[^\[\]\n]{0,40}?contact)[^\[\]\n]{0,120}\]\]'
flags: i
weight: 1
---
