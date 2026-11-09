---
# Generated from data/lint-rules.json by scripts/build.mjs; edit the rules there, not this file.
# Fails when a fenced block of the reply matches: visible-reasoning-request, magic-phrase, prefill-instruction, vague-quality-words.
type: regex
pattern: '^(?:(?:(?!`{3})[\s\S])*?(?<f>`{3,})(?!`)[^\n]*\n(?:(?!\n\k<f>)[\s\S])*?\n\k<f>)*?(?:(?!`{3})[\s\S])*?(?<g>`{3,})(?!`)[^\n]*\n(?:(?!\n\k<g>)[\s\S])*?(?:(?:(think|reason|(by|your) (reasoning|thinking)) step[- ]by[- ]step|your step[- ]by[- ]step (reasoning|thinking)|<thinking>|show your (reasoning|thinking)|chain[- ]of[- ]thought|scratchpad|explain your reasoning before)|(?:take a deep breath|think (really )?hard|you are (a|an) world[- ]class|this is very important to my career)|(?:prefill (the|your|an?) (response|answer|reply|assistant)|assistant turn begins with)|(?:\b(masterpiece|best quality|8k|ultra[- ]detailed|award[- ]winning)\b))'
flags: i
match: not_contains
weight: 1
---
