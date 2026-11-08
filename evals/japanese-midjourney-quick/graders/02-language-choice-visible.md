---
# image-video.md, "Language": quick mode keeps the user's language for the prompt and lists it as an
# assumption. D3: the template's headings, score rows, caveat line and What next? options are
# translated too. 07 checks the English labels deterministically.
type: llm
focus: last_message
weight: 1
---

PASS if the reply talks to the user in Japanese, including its section headings, score rows, caveat line and What next? options (parameters such as --ar and file paths stay as they are), and the Midjourney prompt stays in Japanese, the user's language, with an Assumption saying the user can ask for another language, such as English. FAIL if the prompt's language was switched or chosen silently, if the reply to the user is not in Japanese, or if those parts of the reply are not in Japanese.
