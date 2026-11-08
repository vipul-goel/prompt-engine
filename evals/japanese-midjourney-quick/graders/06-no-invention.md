---
# Finding 4's media rubric (its audit, fix_corrections 3) with D6: numbers, settings and style
# choices are Assumptions of their own; small scene details are merged into one. The judge sees
# only this text and the reply, so the head quotes the request; validate.mjs holds the quote (not
# the English gloss) to prompt.md. D3 translates the Assumptions heading. Example phrases are in
# single quotes.
type: llm
focus: last_message
weight: 1
---

The user's whole request, in Japanese, was "夜の雪山にある小さな山小屋" (a small hut on a snowy mountain at night), for a Midjourney prompt, in quick mode, so no questions were asked. It gives no style, palette or colors, light sources, number of objects, framing or camera angle, aspect ratio, version or other parameters, exclusions, or scene details beyond the hut, the snowy mountain and the night.
Check every detail the prompt adds that the request doesn't give: counts, colors, light sources, framing and camera angle, style, parameter values such as the aspect ratio or the excluded words, and small scene details.
PASS if each one is listed under Assumptions (the heading may be in Japanese), with numbers, settings and style choices as items of their own and small scene details merged into one item. FAIL if any added detail appears in no Assumption, whatever tag the reply gives it; in particular, FAIL if a bullet under What I added tagged [best practice] names a specific value, such as a count or a color, that no Assumption mentions.
