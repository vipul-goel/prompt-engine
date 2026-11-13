---
# The saved file holds the Full prompt (its sections in order), not the Short version.
# Derived from history.jsonl's recorded Full prompt; validate.mjs checks it against the recording.
# Each part is found at its first place after the one before, inside a lookahead that the
# backreference after it consumes. The engine doesn't backtrack into a lookahead, so a file that
# lacks a part fails in linear time: the plain Goal[\s\S]*Context[\s\S]*... form took 2 s on
# 2,000 characters of repeated section names.
type: regex
target:
  source: file
  path: prompts/etsy-mug-description.md
pattern: '^(?=([\s\S]*?Goal))\1(?=([\s\S]*?Context))\2(?=([\s\S]*?Mug details))\3(?=([\s\S]*?Food-safe))\4(?=([\s\S]*?What to do))\5(?=([\s\S]*?Constraints and scope))\6(?=([\s\S]*?Output))\7(?=([\s\S]*?Language:))\8(?=([\s\S]*?If information is missing))\9'
weight: 1
---
