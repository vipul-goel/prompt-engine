---
# --ar or --aspect after the description, followed only by other parameters, at the end of the
# Full prompt's one line, with no trailing comma, semicolon or period (image-video.md, "C. One line
# with parameters at the end"; "Midjourney is the exception: its parameters belong at the end of
# the same line"). The pattern reads the fenced block right after the Full prompt heading, which
# must hold that line and nothing else, and it separates words with spaces or tabs only, so
# parameters on a line of their own fail, and a right Short version doesn't make up for a wrong
# Full prompt (step 1e). Residuals: the Short version's parameters aren't checked, and an --ar
# inside the description passes when the line also ends with parameters. The (?<!#) keeps a long
# run of # linear, and a lookahead finds an --ar that the line's end or another parameter follows,
# so the line is read once and a long line of --ar stays linear too. The fence opener takes all of
# its backticks, so a long run of them is read once and the closing fence has the opener's length,
# as output-format.md asks (scripts/test/eval-grader-time.test.mjs).
type: regex
pattern: '(?<!#)#+[ \t]*Full prompt[^\n]*\n\s*(?<f>`{3,})(?!`)[^\n]*\n[ \t]*[^\s`-](?=[^\n]*?[ \t]--(?:ar|aspect)[ \t]+\d+:\d+(?:[ \t]+--?[a-z]|[ \t]*\n))[^\n]*(?<![,;.])\n(\s*\n)?\k<f>'
flags: i
weight: 1
---

