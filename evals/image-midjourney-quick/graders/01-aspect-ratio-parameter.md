---
# --ar or --aspect after the description, followed only by other parameters, on the last line
# of a fenced block, with no trailing comma, semicolon or period (image-video.md, "C. One line
# with parameters at the end"). No heading anchor, so translated headings don't matter.
type: regex
pattern: '(^|\n)[^\s`-][^\n]*\s--(ar|aspect)\s+\d+:\d+(\s+--?[a-z][^\n]*)?(?<![,;.])[ \t]*\n(\s*\n)?`{3}'
weight: 1
---

