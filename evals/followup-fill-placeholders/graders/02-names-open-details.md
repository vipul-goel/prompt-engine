---
# The reply names at least two of the six open details, in the words of its Fill before running
# list or a close synonym: name or style; capacity, dimensions, size, ounces or ml; clay, glaze,
# colors, materials or finish; care, dishwasher, microwave or oven; food-safe or lead-free; story,
# process or maker. One alternative for each pair of details, each a lookahead from the start of
# the reply, so the match is linear in the reply's length. A paraphrase such as 'what do you call
# this mug' only the 01 judge reads.
type: regex
pattern: '^(?:(?=[\s\S]*?(?:\bname\b|\bstyle\b))(?=[\s\S]*?(?:\bcapacity\b|\bdimensions?\b|\bsize\b|\bounces\b|\boz\b|\bml\b|\bheight\b|\bwidth\b|\bclay\b|\bglazes?\b|\bcolou?rs?\b|\bmaterials?\b|\bfinish\b|\bcare\b|\bdishwasher\b|\bmicrowave\b|\boven\b|\bfood[- ]safe(?:ty)?\b|\blead[- ]free\b|\bstory\b|\bprocess\b|\bmaker\b))|(?=[\s\S]*?(?:\bcapacity\b|\bdimensions?\b|\bsize\b|\bounces\b|\boz\b|\bml\b|\bheight\b|\bwidth\b))(?=[\s\S]*?(?:\bclay\b|\bglazes?\b|\bcolou?rs?\b|\bmaterials?\b|\bfinish\b|\bcare\b|\bdishwasher\b|\bmicrowave\b|\boven\b|\bfood[- ]safe(?:ty)?\b|\blead[- ]free\b|\bstory\b|\bprocess\b|\bmaker\b))|(?=[\s\S]*?(?:\bclay\b|\bglazes?\b|\bcolou?rs?\b|\bmaterials?\b|\bfinish\b))(?=[\s\S]*?(?:\bcare\b|\bdishwasher\b|\bmicrowave\b|\boven\b|\bfood[- ]safe(?:ty)?\b|\blead[- ]free\b|\bstory\b|\bprocess\b|\bmaker\b))|(?=[\s\S]*?(?:\bcare\b|\bdishwasher\b|\bmicrowave\b|\boven\b))(?=[\s\S]*?(?:\bfood[- ]safe(?:ty)?\b|\blead[- ]free\b|\bstory\b|\bprocess\b|\bmaker\b))|(?=[\s\S]*?(?:\bfood[- ]safe(?:ty)?\b|\blead[- ]free\b))(?=[\s\S]*?(?:\bstory\b|\bprocess\b|\bmaker\b)))'
flags: i
weight: 1
---
