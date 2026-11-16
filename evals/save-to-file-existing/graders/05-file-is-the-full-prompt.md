---
# The -2 file holds the Full prompt, not the Short version, with save-to-file's 05 pattern; that
# file's comments say how it was derived and why it is linear. validate.mjs checks this one against
# the recording too: in a case with a scaffold_script, it checks the graders on the menu's save
# path with -2 added to the name, the file a save writes when that path is taken.
type: regex
target:
  source: file
  path: prompts/etsy-mug-description-2.md
pattern: '^(?=([\s\S]*?Goal))\1(?=([\s\S]*?Context))\2(?=([\s\S]*?Mug details))\3(?=([\s\S]*?Food-safe))\4(?=([\s\S]*?What to do))\5(?=([\s\S]*?Constraints and scope))\6(?=([\s\S]*?Output))\7(?=([\s\S]*?Language:))\8(?=([\s\S]*?If information is missing))\9'
weight: 1
---
