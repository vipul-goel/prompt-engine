---
# Finding 4's media rubric (its audit, fix_corrections 3): every detail the reply picks is in an
# Assumption. The method lists numbers, settings and style choices as items of their own and merges
# small scene details (D6), but caps the list at eight and merges related picks rather than drop
# any (output-format.md), so the judge checks that each pick is mentioned, not how the items are
# grouped. The judge sees only this text and the reply, so the head quotes the request;
# validate.mjs holds the quote to prompt.md. The request's own words are in double quotes, example
# phrases in single quotes.
type: llm
focus: last_message
weight: 1
---

The user's whole request was "write a Midjourney prompt: a cozy cabin in the snow at night", in quick mode, so no questions were asked. It gives the style word "cozy" and no other style, no palette or colors, light sources, number of objects, framing or camera angle, aspect ratio, version or other parameters, exclusions, or scene details beyond a cozy cabin, the snow and the night.
Check every detail the prompt adds that the request doesn't give: counts, colors, light sources, framing and camera angle, style, parameter values such as the aspect ratio or the excluded words, and small scene details.
PASS if each one is mentioned in a numbered item under Assumptions; small scene details may share one item, and so may related picks merged to keep the list within eight items. FAIL if any added detail appears in no Assumption, whatever tag the reply gives it; in particular, FAIL if a bullet under What I added tagged [best practice] names a specific value, such as a count or a color, that no Assumption mentions.
