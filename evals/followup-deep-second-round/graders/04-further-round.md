---
# The judge sees only this text and the reply, so the head quotes the request and the ★ answers,
# which a bare deep keeps (questions.md: anything skipped gets the ★). The answers are quoted word
# for word from the recorded question round, which validate.mjs checks, as in
# followup-ok-accepts-recommendations' 05. SKILL.md, section 3: deep asks a further round, of at
# most 4 questions. D14, finding 5.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a blog post about remote work". The assistant asked a round of seven questions, and the user replied "deep", which keeps the recommended (★) answer to each and asks for a further round of questions. The accepted answers, quoted from the question round, are:
1. "Managers and business owners"
2. "Balanced look at benefits and challenges"
3. "Come away with 3–5 ideas they can use this week"
4. "About 800–1,000 words, with subheadings"
5. "Conversational and practical, with no hype"
6. "Use no statistics, and leave `[[placeholders]]` where a number would help"
7. "None. Write for the reader first"
PASS if the reply is a further round of at most 4 new questions, each with lettered options and one of them marked ★, and shows no draft prompt yet: no Full prompt, Short version, score or What next? menu. A short line that restates the accepted answers is fine. FAIL if it asks more than 4 questions, asks one of the seven questions again, or shows a draft or full prompt.
