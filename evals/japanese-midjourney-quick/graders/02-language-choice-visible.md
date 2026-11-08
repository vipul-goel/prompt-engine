---
# image-video.md, "Language": quick mode keeps the user's language for the prompt and lists it as an
# assumption. D3: the template's headings, score rows, caveat line, What next? options and reply
# keywords are translated too, as spanish-quick's 01 asks. 07 checks the English labels
# deterministically. The tags and the ★ and [[ markers are contract strings that stay as written
# in every language, and a translated keyword may have the English one next to it, which the skill
# also takes. Example phrases are in single quotes.
type: llm
focus: last_message
weight: 1
---

PASS if the reply talks to the user in Japanese, including its section headings, score rows, caveat line, What next? options and the reply keywords it offers (such as 'change N'), with parameters such as --ar and file paths left as they are, and the Midjourney prompt stays in Japanese, the user's language, with an Assumption saying the user can ask for another language, such as English. FAIL if the prompt's language was switched or chosen silently, if the reply to the user is not in Japanese, or if those parts of the reply are not in Japanese. Not a FAIL: the tags [you], [your answer] and [best practice] and the ★ and [[ markers, which stay as written in every language, and an English keyword shown next to its Japanese form, such as 'change 3' after '変更 3'.
