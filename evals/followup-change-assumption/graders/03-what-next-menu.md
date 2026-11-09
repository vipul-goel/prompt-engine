---
# After What next?: a starred Run it now, Fill placeholders or Try it here option, and Refine
# later on, as writing-quick-launch-email's 08 checks it, with the same pattern. The mug's details
# are still open placeholders after the change, so the table's first row that fits is the one for
# open placeholders other than secrets (output-format.md, "What next?"), and the ★ stays on Fill
# placeholders: while Fill before running lists a placeholder that isn't a secret's, a starred Run
# it now or Try it here fails. 08's comments say what counts as a secret's placeholder and why the
# conditions sit in lookaheads.
type: regex
pattern: '^(?!(?=[\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\])[\s\S]*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Try it here)\**[ \t]*★)[\s\S]*?What next\?(?=[\s\S]*Refine)[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**(Run it now|Fill (in )?(the )?placeholders|Try it here)\**[ \t]*★'
flags: i
weight: 1
---
