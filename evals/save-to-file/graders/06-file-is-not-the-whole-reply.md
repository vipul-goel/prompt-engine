---
# The saved file is the prompt, not the whole reply with its score table and menu.
type: regex
target:
  source: file
  path: prompts/etsy-mug-description.md
pattern: 'What next\?|\|\s*Clear goal\s*\|'
flags: i
match: not_contains
weight: 1
---
