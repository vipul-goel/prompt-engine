---
type: llm
focus: last_message
weight: 1
---

PASS if the Midjourney prompt itself is one line of descriptive text with parameters such as --ar placed at the end, and contains no role statement (such as 'You are...'), no headings, no XML tags and no 'because' explanations; any explanation of choices appears outside the prompt block. FAIL otherwise.
