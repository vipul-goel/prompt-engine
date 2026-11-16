---
# image-video.md, "Language": quick mode keeps the user's language for the prompt and lists it as an
# assumption. D3: the template's headings, score rows, caveat line and What next? options are
# translated too, as spanish-quick's 01 asks. 07 checks the English labels deterministically. K3:
# the reply keywords deep and change N pass translated or in English; the method still asks for
# the translation. Before K3, an English keyword passed only next to its translation (K2). One in
# a third language still fails: step 1d's replies copied a French example word from the method.
# K1: the tags and the ★ and [[ markers are contract strings that stay as written in every
# language. Example phrases are in single quotes.
type: llm
focus: last_message
weight: 1
---

PASS if the reply talks to the user in Japanese, including its section headings, score rows, caveat line and What next? options, with parameters such as --ar and file paths left as they are, and the Midjourney prompt stays in Japanese, the user's language, with an Assumption saying the user can ask for another language, such as English. FAIL if the prompt's language was switched or chosen silently, if the reply to the user is not in Japanese, or if those parts of the reply are not in Japanese. Not a FAIL: the tags [you], [your answer] and [best practice] and the ★ and [[ markers, which stay as written in every language; and the two reply keywords that the reply tells the user to type, 'change N' (as in 'change 3: …') and 'deep', each of which may be in Japanese (such as '変更 3') or in English. A reply keyword in a third language is a FAIL.
