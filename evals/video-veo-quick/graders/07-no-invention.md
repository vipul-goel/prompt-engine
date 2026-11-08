---
# Finding 4's media rubric (its audit, fix_corrections 3) with D6: numbers, settings and style
# choices are Assumptions of their own; small scene details are merged into one. The judge sees
# only this text and the reply, so the head quotes the request; validate.mjs holds the quote to
# prompt.md. Example phrases are in single quotes.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "I need an 8-second Veo video prompt of a barista making latte art", in quick mode, so no questions were asked. It gives the length (8 seconds) and nothing else: no aspect ratio or other settings, style, palette or colors, light sources, framing, camera moves, sound, latte art pattern, exclusions, or details of the barista, the cup or the café.
Check every detail the prompt adds that the request doesn't give: counts, colors, light sources, framing and camera moves, style, settings such as the aspect ratio, sound, the excluded items, and small scene details.
PASS if each one is listed under Assumptions, with numbers, settings and style choices as items of their own and small scene details merged into one item. FAIL if any added detail appears in no Assumption, whatever tag the reply gives it; in particular, FAIL if a bullet under What I added tagged [best practice] names a specific value, such as a count or a color, that no Assumption mentions.
