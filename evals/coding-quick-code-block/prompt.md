---
tags: [coding, quick]
model: claude-sonnet-5-5
max_turns: 16
timeout_seconds: 480
allowed_tools: [Read, Glob, Grep, Skill, AskUserQuestion]
---

Use prompt-engine in quick mode on this prompt for my coding agent:

last_items returns the whole list when n is 0. Fix it and add a test.

```python
def last_items(items, n):
    return items[-n:]
```
