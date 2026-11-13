---
# A Negative prompt block (image-video.md, "Settings and exclusions"): a fence whose first line
# starts "Negative prompt", or a Negative prompt label or heading (bold, in backticks or
# bulleted) followed by a fence whose first line has content. Either way the fence needs an
# info string (output-format.md's "Fences." rule asks for text). A closing fence has none, so
# exclusions on the main prompt's last line, right above its closing fence, don't count.
# Residual: a label line that holds the exclusions itself passes when any fenced block follows.
type: regex
pattern: '(^|\n)`{3,}[ \t]*[^\s`][^\n]*\n[ \t]*Negative prompt\b|(^|\n)[ \t]*([-*•][ \t]+)?(#+[ \t]*)?[*_`]*Negative prompt\b[^\n]*\n\s*`{3,}[ \t]*[^\s`][^\n]*\n[ \t]*[^`\s]'
flags: i
weight: 1
---

