---
# The reply holds no code from the task: a Python fence, a function definition, an import line, or
# the calls a word count makes. File names such as top_words.py and commands such as pytest don't
# count, since a reply that names the options may mention them.
type: regex
pattern: '```[ \t]*(?:python|py)\b|\bdef [A-Za-z_]\w*[ \t]*\(|(?:^|\n)[ \t]*(?:import [A-Za-z_][\w.]*|from [A-Za-z_][\w.]* import\b)|\bmost_common\(|\bsys\.argv\b|\bCounter\('
match: not_contains
weight: 1
---
