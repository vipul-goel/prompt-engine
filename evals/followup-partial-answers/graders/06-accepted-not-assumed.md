---
type: llm
focus: last_message
weight: 1
---

The user answered a round of seven questions with "2c 4b 5: write it like a newsletter from a founder who has run a remote team for 6 years". Questions they skipped keep the recommended (★) answer. The answers, quoted from the question round and the reply, are:
1. "Managers and business owners" (★, kept because the user skipped question 1)
2. "Practical tips for working remotely well" (the user's 2c)
3. "Come away with 3–5 ideas they can use this week" (★, kept because the user skipped question 3)
4. "About 1,500–2,000 words, in-depth" (the user's 4b)
5. "write it like a newsletter from a founder who has run a remote team for 6 years" (typed by the user for question 5)
6. "Use no statistics, and leave `[[placeholders]]` where a number would help" (★, kept because the user skipped question 6)
7. "None. Write for the reader first" (★, kept because the user skipped question 7)
These answers are the user's choices, not defaults the model picked.
FAIL if a numbered item under Assumptions presents one of these answers as a default or choice the model made. An Assumptions item that adds a detail the answers leave open (for example the post's structure or a second title) is fine, even if it mentions an answer.
FAIL also if a bullet under What I added & why restates a ★ answer (1, 3, 6 or 7) and is tagged anything other than [your answer]. A bullet for an answer the user picked or typed (2, 4 or 5) may be tagged [your answer] or [you], and so may a bullet that covers both kinds.
Otherwise PASS.
