---
# D3: in a non-English reply the template's headings, score rows, caveat line, What next? options
# and reply keywords are translated too. 04 checks the English labels deterministically.
type: llm
focus: last_message
weight: 1
---

PASS if the reply to the user is written in Spanish, the enhanced prompt is written in Spanish, and the enhanced prompt tells the target model to respond in Spanish. The reply's section headings, score rows, caveat line, What next? options and the reply keywords it offers (such as 'change N') are in Spanish too. FAIL if any of these is not true.
