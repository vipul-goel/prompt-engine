---
# D5: the reply's first line suggests rotating the pasted key; revoking or regenerating it counts
# too. No m flag, so ^ is the start of the reply and [^\n]* keeps the match on its first line.
type: regex
pattern: '^[^\n]*\b(rotat|revok|regenerat)'
flags: i
weight: 1
---
