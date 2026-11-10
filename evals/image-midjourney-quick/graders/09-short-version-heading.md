---
# A Short version heading followed by its fenced block, as writing-quick-launch-email's 02 checks:
# SKILL.md's Present lists "3. Short version in a fenced block" for every output, and image-video.md
# has the same blocks serve both versions. Before step 1e no grader of this case checked it. The
# heading starts a line, and only blank lines may come between it and the fence, as in
# output-format.md's template, so a note in place of the block fails, as it does in
# japanese-midjourney-quick's 11 (step 1e, B2.1.3). The pattern starts only at the start of a
# line, which keeps a long run of # linear.
type: regex
pattern: '(?:^|\n)[ \t]*#+[ \t]*Short version[^\n]*\n\s*`{3}'
flags: i
weight: 1
---
