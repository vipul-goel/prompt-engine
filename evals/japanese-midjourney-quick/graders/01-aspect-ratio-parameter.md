---
# --ar or --aspect after the description, followed only by other parameters, at the end of the
# Full prompt's one line, with no trailing comma, semicolon or period (image-video.md, "C. One line
# with parameters at the end"; "Midjourney is the exception: its parameters belong at the end of
# the same line"). D3 translates the headings, so the pattern reads the fenced block right after
# the reply's first heading, which the template makes the Full prompt heading, with no fence
# before it, as 09 does. That block must hold the line and nothing else, and words are separated
# by spaces or tabs only, so parameters on a line of their own fail, and a right Short version
# doesn't make up for a wrong Full prompt (step 1e). Residuals: the Short version's parameters
# aren't checked; an --ar inside the description passes when the line also ends with parameters;
# and a reply with another heading, such as a title, before the Full prompt heading fails, as in 09.
# A lookahead finds an --ar that the line's end or another parameter follows, so the line is read
# once and a long line of --ar stays linear (scripts/test/eval-grader-time.test.mjs).
type: regex
pattern: '^(?:(?!`{3}|(?:^|\n)[ \t]*#)[\s\S])*?(?:^|\n)[ \t]*#[^\n]*\n\s*(?<f>`{3,})[^\n]*\n[ \t]*[^\s`-](?=[^\n]*?[ \t]--(?:ar|aspect)[ \t]+\d+:\d+(?:[ \t]+--?[a-z]|[ \t]*\n))[^\n]*(?<![,;.])\n(\s*\n)?\k<f>'
weight: 1
---

