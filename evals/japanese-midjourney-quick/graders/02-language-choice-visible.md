---
type: llm
focus: last_message
weight: 1
---

PASS if the reply talks to the user in Japanese and the language of the Midjourney prompt is either asked about or stated as an assumption the user can change (for example: the prompt is written in English or Japanese, and the user can ask for the other). FAIL if the prompt's language is chosen silently, or if the reply to the user is not in Japanese.
