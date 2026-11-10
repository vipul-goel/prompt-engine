---
# The judge sees only this text and the reply, so the head quotes the request and the ★ answers,
# which a bare deep keeps (questions.md: anything skipped gets the ★). The answers are quoted word
# for word from the recorded question round, which validate.mjs checks, as in
# followup-ok-accepts-recommendations' 05. SKILL.md, section 3: deep asks a further round, of at
# most 4 questions. D14, finding 5. It fails a round that asks one of the seven questions again, so
# it quotes each question with its answer; answer 7 also needs its question to say what "None"
# declines (step 1e). Deep rounds cover gaps the answers opened (questions.md), so a question on a
# nearby subject can be new: step 1d's passing round asked whose voice the post is written in
# under question 5's "What voice?", and writing.md keeps point of view (9) apart from voice and
# tone (6). The rubric says what asking again means (step 1e).
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a blog post about remote work". The assistant asked a round of seven questions, and the user replied "deep", which keeps the recommended (★) answer to each and asks for a further round of questions. The seven questions and their accepted answers, quoted from the question round, are:
1. "Who will read it?": "Managers and business owners"
2. "What angle should the post take?": "Balanced look at benefits and challenges"
3. "What should readers do or feel afterwards?": "Come away with 3–5 ideas they can use this week"
4. "How long and what format?": "About 800–1,000 words, with subheadings"
5. "What voice?": "Conversational and practical, with no hype"
6. "Facts and statistics?": "Use no statistics, and leave `[[placeholders]]` where a number would help"
7. "SEO keyword?": "None. Write for the reader first"
PASS if the reply is a further round of at most 4 new questions, each with lettered options and one of them marked ★, and shows no draft prompt yet: no Full prompt, Short version, score or What next? menu. A short line that restates the accepted answers is fine. FAIL if it asks more than 4 questions, asks one of the seven questions again, or shows a draft or full prompt. Asking again means asking the user to decide again what one of these answers decided; a question about a different decision on a nearby subject is new, such as whose point of view the post takes ('I', 'we' or 'you') after question 5's tone.
