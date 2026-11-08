---
type: llm
focus: last_message
weight: 1
---

PASS if the enhanced prompt (the Full prompt block) (1) says what must be true when the task is done, (2) names a command or check that proves it and asks the agent to report its output, or to say what it couldn't verify, (3) says what to change and what to leave alone, (4) says how to handle risky actions such as deleting data, installing packages or calling other external services (forbid them, or ask the user first), and (5) says where to look: the files or areas involved, or an instruction to find them before changing anything. FAIL if any of the five is missing.
