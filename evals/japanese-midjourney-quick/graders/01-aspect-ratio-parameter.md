---
# --ar or --aspect after the description, followed only by other parameters, at the end of the
# Full prompt's one line, with no trailing comma, semicolon or period (image-video.md, "C. One line
# with parameters at the end"; "Midjourney is the exception: its parameters belong at the end of
# the same line"). D3 translates the headings, so the pattern reads the fenced block right after
# the reply's first heading, which the template makes the Full prompt heading, with no fence
# before it, as 09 does. That block must hold the line and nothing else, and words are separated
# by spaces or tabs only, so parameters on a line of their own fail, and a right Short version
# doesn't make up for a wrong Full prompt (step 1e). When no heading comes before the reply's first
# fenced block, as in a reply without the template, which the no-skill arm writes, that block is
# read instead, so 01 doesn't count the missing template again, which the case's other graders
# score. The description ends at the line's first " --" and a letter; from there to the end of the
# line come only parameters, one of them --ar or --aspect: each is - or -- and a name, then at most
# one value, except --no, --sref and --cref, which take a list, and no value holds a comma
# (data/media-targets.json: "Inline parameters at the end, with no commas inside them"; "--no item,
# one word per item"). So "--ar 3:2 --v 7 in deep snow" fails, and so does "--ar 3:2 --no people
# text, photorealistic", whose last phrase --no would leave out (step 1e). Residuals: the Short
# version's parameters aren't checked; words after --no, --sref or --cref with no comma read as
# their list; any other parameter with two values fails; and a reply with another heading, such as
# a title, before the Full prompt heading fails, as in 09. The description is read once, up to its
# end, in a lookahead, and then matched as one piece by a backreference, so the engine can't give
# it back one character at a time: it did, and read the rest of the line again from each place, on
# a line that ends in a long run of spaces, tabs or single-dash words (step 1e, B2.1.2). Giving
# some of it back could only turn single-dash words before the first " --" and a letter into
# parameters, and a line that matches that way also matches with the whole description, so the
# verdicts are the same. A lookahead then finds the --ar among the parameters, so a long line of
# parameters stays linear. The fence opener takes all of its backticks, so a long run of them is
# read once and the closing fence has the opener's length, as output-format.md asks
# (scripts/test/eval-grader-time.test.mjs).
type: regex
pattern: '^(?:(?!`{3}|(?:^|\n)[ \t]*#)[\s\S])*?(?:^|\n)[ \t]*#[^\n]*\n\s*(?<f>`{3,})(?!`)[^\n]*\n[ \t]*[^\s`-](?=(?<d>(?:(?![ \t]--[a-z])[^\n])*))\k<d>(?=(?:[ \t]+(?:--(?:no|sref|cref)(?:[ \t]+[^\s,、，-][^\s,、，]*)+|--?(?!(?:no|sref|cref)\b)[a-z][\w-]*(?:[ \t]+[^\s,、，-][^\s,、，]*)?))*?[ \t]+--(?:ar|aspect)[ \t]+\d+:\d+(?:[ \t]|\n))(?:[ \t]+(?:--(?:no|sref|cref)(?:[ \t]+[^\s,、，-][^\s,、，]*)+|--?(?!(?:no|sref|cref)\b)[a-z][\w-]*(?:[ \t]+[^\s,、，-][^\s,、，]*)?))+(?<![,;.])[ \t]*\n(\s*\n)?\k<f>|^(?:(?!(?:^|\n)[ \t]*(?:#|`{3}))[\s\S])*(?:^|\n)[ \t]*(?<g>`{3,})(?!`)[^\n]*\n[ \t]*[^\s`-](?=(?<e>(?:(?![ \t]--[a-z])[^\n])*))\k<e>(?=(?:[ \t]+(?:--(?:no|sref|cref)(?:[ \t]+[^\s,、，-][^\s,、，]*)+|--?(?!(?:no|sref|cref)\b)[a-z][\w-]*(?:[ \t]+[^\s,、，-][^\s,、，]*)?))*?[ \t]+--(?:ar|aspect)[ \t]+\d+:\d+(?:[ \t]|\n))(?:[ \t]+(?:--(?:no|sref|cref)(?:[ \t]+[^\s,、，-][^\s,、，]*)+|--?(?!(?:no|sref|cref)\b)[a-z][\w-]*(?:[ \t]+[^\s,、，-][^\s,、，]*)?))+(?<![,;.])[ \t]*\n(\s*\n)?\k<g>'
weight: 1
---

