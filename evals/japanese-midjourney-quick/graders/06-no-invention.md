---
# D51's media rubric, which replaces finding 4's (every detail the reply picks is in an
# Assumption). The judge counts new things (objects, people, actions, sounds, numbers, settings)
# that the request doesn't name and no numbered Assumption mentions. Descriptive words added to
# something the user named don't count. Neither do words for how the picture shows the scene
# (light, colors, mood, style, framing, camera): D51's list has no such kind, so the rubric no
# longer checks that those picks are listed, though the method still asks for it (image-video.md,
# "Fix these before presenting"). Clothing counts as a descriptive word of the person who wears
# it. A part of something named, a thing its action uses and a borderline item get no rule of
# their own: the judge reads them against D51's kinds, which excuse none of them. D6: one
# Assumption may merge several picks, and it mentions what it names; a general label names
# nothing. Kept from finding 4 (its audit, fix_corrections 3): a [best practice] tag doesn't
# excuse a pick, such as a count, that Assumptions lacks. The examples
# come from none of the media cases' subjects. The three media rubrics share every paragraph after
# the first, word for word; scripts/test/eval-cases.test.mjs holds them to that. The judge sees
# only this text and the reply, so the head quotes the request; validate.mjs holds the quote (not
# the English gloss) to prompt.md. D3 translates the reply's headings. Example phrases are in
# single quotes.
type: llm
focus: last_message
weight: 1
---

The user's whole request, in Japanese, was "夜の雪山にある小さな山小屋" (a small hut on a snowy mountain at night), for a Midjourney prompt, in quick mode, so no questions were asked. It names a small hut, a snowy mountain and the night. It names nothing else to show, no number, and no aspect ratio, version, excluded words or other setting. The reply is in Japanese, and its Assumptions and What I added headings may be in Japanese too.
Find the new things in the prompt that the reply wrote: its Full prompt, its Short version, and any Negative prompt or Settings block. A new thing is something the request doesn't name, of one of these kinds:
- an object, person, animal or place that the picture or clip would show;
- an action or event;
- a sound;
- a number: a count of two or more, or a measure such as a length or a duration;
- a setting of the tool, such as an aspect ratio, a version, a resolution or a list of excluded words.
A number or a setting counts even inside a descriptive phrase. For a request for 'a gardener watering tomatoes', a wheelbarrow, a cat, a neighbor waving, birdsong, 'three rows of plants' and '--ar 4:5' are new things.
Descriptive words are not new things, so leave them out. They say what something the request names is like: its material, color, size, age, condition or clothing, or the way its action is done. They also say how the picture or clip shows the scene: its light, colors, mood, style, framing or camera. For the same request, 'an elderly gardener in a straw hat', 'ripe red tomatoes', 'soft evening light' and 'a low-angle close-up in watercolor' are descriptive words.
PASS if the prompt has no new thing, or if every new thing is mentioned in a numbered item under Assumptions. One item may mention several new things: small scene details may share an item, and so may related picks merged to keep the list within eight items. An item mentions a new thing when it names it, in the prompt's words or a plain synonym. A number is mentioned only when the item states it. A general label doesn't mention the separate things it covers: 'background sounds' names neither a bell nor birdsong.
FAIL if a new thing is mentioned in no Assumption, whatever tag the reply gives it. In particular, FAIL if a bullet under What I added tagged [best practice] names one of the prompt's new things, such as a count or an aspect ratio, and no Assumption mentions it.
