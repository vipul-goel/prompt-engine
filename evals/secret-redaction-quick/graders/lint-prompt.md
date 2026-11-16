---
# Generated from data/lint-rules.json by scripts/build.mjs; edit the rules there, not this file.
# Fails when a fenced block of the reply matches: pressure-words.
type: regex
pattern: '^(?:(?:(?!`{3})[\s\S])*?(?<f>`{3,})(?!`)[^\n]*\n(?:(?!\n\k<f>)[\s\S])*?\n\k<f>)*?(?:(?!`{3})[\s\S])*?(?<g>`{3,})(?!`)[^\n]*\n(?:(?!\n\k<g>)[\s\S])*?(?:(?:\b(MUST|NEVER|ALWAYS|CRITICAL|IMPORTANT)\b))'
match: not_contains
weight: 1
---
