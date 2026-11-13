---
# D37: the user's code survives in the full prompt: both of its lines, one after the other, between
# the Full prompt heading and the next heading of the template. So code named only under What I
# added or in the Short version, or retold in prose, doesn't count. 01 and 03 check the fence
# around the full prompt; 06 checks the Short version's. The region also ends at the next
# "# Full prompt", even one that starts mid-line (the code after it is read from there), which keeps
# the time linear in the reply's length (scripts/test/eval-grader-time.test.mjs).
type: regex
pattern: '#[ \t]*Full prompt(?:(?!\n#+[ \t]*(?:Full prompt|Short version|Fill before running|What I added|Assumptions|Score|What next)|#[ \t]*Full prompt)[\s\S])*def last_items\(items, n\):[ \t]*\n[ \t]*return items\[-n:\]'
weight: 1
---
