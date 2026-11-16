---
# The file the scaffold wrote is still exactly that, so the save didn't overwrite or change it: a
# -2 file proves no overwrite only with the original intact. No m flag, so ^ and $ are the start
# and end of the file.
type: regex
target:
  source: file
  path: prompts/etsy-mug-description.md
pattern: '^ORIGINAL-SENTINEL\r?\n?$'
weight: 1
---
