---
type: llm
focus: last_message
weight: 1
---

PASS if the reply talks to the user in Japanese, and the Midjourney prompt stays in Japanese, the user's language, with an Assumption saying the user can ask for another language, such as English. FAIL if the prompt's language was switched or chosen silently, or if the reply to the user is not in Japanese.
