---
# A fence whose first line starts "Negative prompt", or a Negative prompt label or heading
# followed by a fence that opens a block (image-video.md, "Settings and exclusions").
type: regex
pattern: '(^|\n)`{3,}[^\n]*\n[ \t]*Negative prompt\b|(^|\n)[ \t]*(#+[ \t]*)?\**Negative prompt\b[^\n]*\n\s*`{3,}[^\n]*\n[ \t]*[^`\s]'
flags: i
weight: 1
---

