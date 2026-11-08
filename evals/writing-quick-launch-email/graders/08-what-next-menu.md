---
# After What next?: a starred Run it now, Fill placeholders or Try it here option, and Refine
# later on. Not Done ★: output-format.md's "What next?" table keeps it for image and video
# prompts. No Run it now ★ while Fill before running is listed. Refine sits in a lookahead
# to keep the match fast. The option prefix (^|\s)(\d[.)]|[-*•])[ \t]*\** is shared with the
# image and video 05 graders and scripts/eval/universal-test.mjs.
type: regex
pattern: '^(?![\s\S]*#+\s*Fill before running[\s\S]*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Run it now\**[ \t]*★)[\s\S]*?What next\?(?=[\s\S]*Refine)[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Fill (in )?(the )?placeholders|Try it here)\**[ \t]*★'
flags: i
weight: 1
---

