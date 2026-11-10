---
# --ar or --aspect after the description, followed only by other parameters, at the end of the
# Full prompt's one line, with no trailing comma, semicolon or period (image-video.md, "C. One line
# with parameters at the end"; "Midjourney is the exception: its parameters belong at the end of
# the same line"). The pattern reads the fenced block right after the Full prompt heading, which
# must hold that line and nothing else, and it separates words with spaces or tabs only, so
# parameters on a line of their own fail, and a right Short version doesn't make up for a wrong
# Full prompt (step 1e). A reply without a Full prompt heading, as the no-skill arm writes, has its
# first fenced block read instead, so 01 doesn't count the missing template again, which the case's
# other graders score. The description ends at the line's first " --" and a letter; from there to
# the end of the line come only parameters, one of them --ar or --aspect: each is - or -- and a
# name, then at most one value, except --no, --sref and --cref, which take a list, and no value
# holds a comma (data/media-targets.json: "Inline parameters at the end, with no commas inside
# them"; "--no item, one word per item"). So "--ar 3:2 --v 7 in deep snow" fails, and so does "--ar
# 3:2 --no people text, photorealistic", whose last phrase --no would leave out (step 1e).
# Residuals: the Short version's parameters aren't checked; words after --no, --sref or --cref with
# no comma read as their list ("--no people text photorealistic"); and any other parameter with two
# values fails. The (?<!#) keeps a long run of # linear; the description is read once, up to its
# end, and a lookahead finds the --ar among the parameters, so a long line of parameters stays
# linear too. The fence opener takes all of its backticks, so a long run of them is read once and
# the closing fence has the opener's length, as output-format.md asks
# (scripts/test/eval-grader-time.test.mjs).
type: regex
pattern: '(?<!#)#+[ \t]*Full prompt[^\n]*\n\s*(?<f>`{3,})(?!`)[^\n]*\n[ \t]*[^\s`-](?:(?![ \t]--[a-z])[^\n])*(?=(?:[ \t]+(?:--(?:no|sref|cref)(?:[ \t]+[^\s,、，-][^\s,、，]*)+|--?(?!(?:no|sref|cref)\b)[a-z][\w-]*(?:[ \t]+[^\s,、，-][^\s,、，]*)?))*?[ \t]+--(?:ar|aspect)[ \t]+\d+:\d+(?:[ \t]|\n))(?:[ \t]+(?:--(?:no|sref|cref)(?:[ \t]+[^\s,、，-][^\s,、，]*)+|--?(?!(?:no|sref|cref)\b)[a-z][\w-]*(?:[ \t]+[^\s,、，-][^\s,、，]*)?))+(?<![,;.])[ \t]*\n(\s*\n)?\k<f>|^(?![\s\S]*?#[ \t]*Full prompt)(?:(?!(?:^|\n)[ \t]*`{3})[\s\S])*(?:^|\n)[ \t]*(?<g>`{3,})(?!`)[^\n]*\n[ \t]*[^\s`-](?:(?![ \t]--[a-z])[^\n])*(?=(?:[ \t]+(?:--(?:no|sref|cref)(?:[ \t]+[^\s,、，-][^\s,、，]*)+|--?(?!(?:no|sref|cref)\b)[a-z][\w-]*(?:[ \t]+[^\s,、，-][^\s,、，]*)?))*?[ \t]+--(?:ar|aspect)[ \t]+\d+:\d+(?:[ \t]|\n))(?:[ \t]+(?:--(?:no|sref|cref)(?:[ \t]+[^\s,、，-][^\s,、，]*)+|--?(?!(?:no|sref|cref)\b)[a-z][\w-]*(?:[ \t]+[^\s,、，-][^\s,、，]*)?))+(?<![,;.])[ \t]*\n(\s*\n)?\k<g>'
flags: i
weight: 1
---

