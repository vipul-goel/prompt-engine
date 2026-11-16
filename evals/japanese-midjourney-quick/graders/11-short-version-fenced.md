---
# A Short version in a fenced block (SKILL.md's Present: "3. Short version in a fenced block").
# D3 translates the headings, so, as 09 does, the pattern reads the reply's first heading, which
# the template makes the Full prompt heading, with no fence before it, and that heading's fenced
# block, closed by a fence of the same length (an opener's backticks are read once, as in
# strong-prompt-minimal-changes' 04). The next heading, after any lines that are neither
# headings nor fences (such as a note), must be followed by a fence: the template makes it the
# Short version. Its words aren't checked, and 07 judges that the labels are in Japanese. Before
# step 1e no grader of this case checked that a Short version is there. Residual, as in 09: a
# reply with another heading, such as a title, before the Full prompt heading fails. Each part is
# read once, so the time grows linearly with the reply's length
# (scripts/test/eval-grader-time.test.mjs).
type: regex
pattern: '^(?:(?!`{3}|(?:^|\n)[ \t]*#)[\s\S])*?(?:^|\n)[ \t]*#[^\n]*\n\s*(?<f>`{3,})(?!`)[^\n]*\n(?:(?!\k<f>)[\s\S])*\n\k<f>[ \t]*\n(?:(?![ \t]*(?:#|`{3}))[^\n]*\n)*[ \t]*#[^\n]*\n\s*`{3}'
weight: 1
---
