---
# The saved file holds the Full prompt (its sections in order), not the Short version.
# Derived from history.jsonl's recorded Full prompt; validate.mjs checks it against the recording.
type: regex
target:
  source: file
  path: prompts/etsy-ceramic-mug-description.md
pattern: 'Goal[\s\S]*Context[\s\S]*Product details[\s\S]*What to write[\s\S]*Constraints[\s\S]*food-safe[\s\S]*Output[\s\S]*Language:'
weight: 1
---
