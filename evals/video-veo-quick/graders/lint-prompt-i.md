---
# Generated from data/lint-rules.json by scripts/build.mjs; edit the rules there, not this file.
# Fails when a fenced block of the reply matches: visible-reasoning-request, magic-phrase, prefill-instruction, vague-quality-words.
type: regex
pattern: '^(?:(?:(?!`{3})[\s\S])*?(?<f>`{3,})(?!`)[^\n]*\n(?:(?!\n\k<f>)[\s\S])*?\n\k<f>)*?(?:(?!`{3})[\s\S])*?(?<g>`{3,})(?!`)[^\n]*\n(?:(?!\n\k<g>)[\s\S])*?(?:(?:(think|reason|(by|your)[^\S\n](reasoning|thinking))[^\S\n]step(?:[-‐‑]|[^\S\n])by(?:[-‐‑]|[^\S\n])step|your[^\S\n]step(?:[-‐‑]|[^\S\n])by(?:[-‐‑]|[^\S\n])step[^\S\n](reasoning|thinking)|<thinking>|show[^\S\n]your[^\S\n](reasoning|thinking)|chain(?:-|[^\S\n])of(?:-|[^\S\n])thought|scratchpad|explain[^\S\n]your[^\S\n]reasoning[^\S\n]before)|(?:take[^\S\n]a[^\S\n]deep[^\S\n]breath|think[^\S\n](really[^\S\n])?hard|you[^\S\n]are[^\S\n](a|an)[^\S\n]world(?:-|[^\S\n])class|this[^\S\n]is[^\S\n]very[^\S\n]important[^\S\n]to[^\S\n]my[^\S\n]career)|(?:prefill[^\S\n](the|your|an?)[^\S\n](response|answer|reply|assistant)|assistant[^\S\n]turn[^\S\n]begins[^\S\n]with)|(?:\b(masterpiece|best[^\S\n]quality|8k|ultra(?:-|[^\S\n])detailed|award(?:-|[^\S\n])winning)\b))'
flags: i
match: not_contains
weight: 1
---
