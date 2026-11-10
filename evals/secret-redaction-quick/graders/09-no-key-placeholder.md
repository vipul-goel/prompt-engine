---
# D5: a prompt for code names an environment variable for the key, not a [[placeholder]] for its
# value. Only the prompt sections count, from the Full prompt heading to Fill before running or
# What I added, so a bullet that mentions [[api key]] while explaining the change passes (finding
# 63's audit). A placeholder is a key's when key, token or secret ends it, also after _ as in
# [[your_api_key]], or when it says api key anywhere, so [[max tokens]] or [[token budget]] don't
# count (the test finding 58's audit gave 02 before D5). The region also ends at the next
# "# Full prompt", even one that starts mid-line (a placeholder after it is read from there), and
# a placeholder's name holds no [ or ], so the time grows linearly with the reply's length
# (scripts/test/eval-grader-time.test.mjs). Before step 1e a name could hold a [, as in
# [[a[key]], and a long line of [[ took seconds.
type: regex
pattern: '#[ \t]*Full prompt(?:(?!\n#+[ \t]*(?:Fill before running|What I added)|#[ \t]*Full prompt)[\s\S])*\[\[[^\[\]\n]*(?:(?:\b|_)(?:key|token|secret)|(?:\b|_)api[ _-]?key(?:\b|_)[^\[\]\n]*)\]\]'
flags: i
match: not_contains
weight: 1
---
