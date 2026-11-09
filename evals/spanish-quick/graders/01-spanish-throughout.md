---
# D3: in a non-English reply the template's headings, score rows, caveat line and What next?
# options are translated too. 04 checks the English labels deterministically. K3: the reply
# keywords deep and change N pass translated or in English; the method still asks for the
# translation. Before K3, an English keyword passed only next to its translation (K2). One in a
# third language still fails: step 1d's replies copied a French example word from the method.
# K1: the tags and the ★ and [[ markers are contract strings that stay as written in every
# language. Example phrases are in single quotes.
type: llm
focus: last_message
weight: 1
---

PASS if the reply to the user is written in Spanish, the enhanced prompt is written in Spanish, and the enhanced prompt tells the target model to respond in Spanish. The reply's section headings, score rows, caveat line and What next? options are in Spanish too. FAIL if any of these is not true. Not a FAIL: the tags [you], [your answer] and [best practice] and the ★ and [[ markers, which stay as written in every language; and the two reply keywords that the reply tells the user to type, 'change N' (as in 'change 2: …') and 'deep', each of which may be in Spanish (such as 'cambia 2') or in English. A reply keyword in a third language is a FAIL.
