---
# The reply shows the full prompt again with the user's details in it, then the What next? menu
# (D1): after a Full prompt heading (or Filled prompt, Filled full prompt), the name and the clay
# that the user gave come before What next?. The heading sits in a lookahead that its
# backreference consumes, and the engine doesn't backtrack into a lookahead, so each later
# condition is looked for from one place and the match is linear in the reply's length. The 01
# judge reads the rest: that nothing runs and no detail is invented.
type: regex
pattern: '^(?=([\s\S]*?#[ \t]*(?:Full|Filled(?:[ \t]+full)?)[ \t]+prompt\b))\1(?=(?:(?!What next\?)[\s\S])*?Moss Mug)(?=(?:(?!What next\?)[\s\S])*?stoneware)[\s\S]*?What next\?'
flags: i
weight: 1
---
