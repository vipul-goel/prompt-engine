---
# After What next?: a starred Run it now, Fill placeholders, Try it here or Done option, and
# Refine later on. No Run it now ★ while Fill before running is listed (output-format.md,
# "What next?"). Refine sits in a lookahead to keep the match fast. The option prefix
# (^|\s)(\d[.)]|[-*•])[ \t]*\** is shared with the image and video 05 graders and
# scripts/eval/universal-test.mjs.
type: regex
pattern: '^(?![\s\S]*#+\s*Fill before running[\s\S]*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Run it now\**[ \t]*★)[\s\S]*?What next\?(?=[\s\S]*Refine)[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Fill (in )?(the )?placeholders|Try it here|Done)\**[ \t]*★'
flags: i
weight: 1
---

