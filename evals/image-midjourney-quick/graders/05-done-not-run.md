---
# A starred Done option after What next?, and no Run it now option there (output-format.md,
# "What next?": an image or video prompt when you can't generate media). One check, so the
# no-skill arm gets no free point. The option prefix (^|\s)(\d[.)]|[-*•])[ \t]*\** is shared
# with writing-quick-launch-email's 08 and scripts/eval/universal-test.mjs.
type: regex
pattern: '^(?![\s\S]*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Run it now)[\s\S]*?What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Done\b[^\n]*★'
flags: i
weight: 1
---

