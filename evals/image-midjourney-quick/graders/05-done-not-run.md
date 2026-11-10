---
# After What next?: no Run it now option, and a starred Done option (output-format.md, "What
# next?": an image or video prompt when you can't generate media), or a starred Fill
# placeholders option while placeholders other than secrets' are open: the table's first row that
# fits is the one for open placeholders that are neither secrets nor removed private details
# (D1, D5, D46), so Done ★ fails then. They are open when Fill before running lists one, or when
# the reply has no "#" Fill before running heading and its Full prompt holds one (step 1e). This
# request holds no private detail, so the condition doesn't model D46;
# private-detail-redaction-quick's 08 does. Only one option is starred, so a second ★ after the
# first What next? fails (step 1e). One check, so the no-skill arm gets no free point. The
# option prefix (^|\s)(\d[.)]|[-*•])[ \t]*\**, the ★ that ends a starred option and the
# open-placeholder condition are shared with writing-quick-launch-email's 08, which says what
# counts as a secret's placeholder, and with scripts/eval/universal-test.mjs (OPTION_STAR and
# FILL_OPEN there). The menu is read from the first What next? on, which gives the same verdicts as
# reading from any of them, and a starred option's ★ is looked for on its line, up to 200
# characters after the label and before the next numbered option, so it may follow a note ("Done
# — paste it into Midjourney ★"), but in "1. Done 2. Refine ★" it is option 2's (step 1e; in
# every kept reply it comes right after the label). So the time grows linearly with the reply's
# length (scripts/test/eval-grader-time.test.mjs). Before step 1e a reply that repeats What next?
# took minutes in JavaScriptCore.
type: regex
pattern: '^(?!(?:(?!What next\?)[\s\S])*What next\?[^★]*★[^★]*★)(?!(?:(?!What next\?)[\s\S])*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Run it now)(?:(?=[\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\]|(?![\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running)(?:(?!(?<!#)#+[ \t]*Full prompt)[\s\S])*(?<!#)#+[ \t]*Full prompt[^\n]*(?:\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*)*?\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*?(?<!(?:such as|e\.g\.,?|for example,?|like|write|leave(?: an?)?|insert|put)[ \t]+\x60?)(?<!\]\]\x60?(?:,|[ \t]+or)[ \t]+\x60?)(?<![\w\])])\[\[(?!placeholders?\]\])(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\])(?:(?!What next\?)[\s\S])*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Fill (in )?(the )?placeholders\b(?:(?!\s\d[.)]\s)[^\n★]){0,200}★|(?![\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\]|(?![\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running)(?:(?!(?<!#)#+[ \t]*Full prompt)[\s\S])*(?<!#)#+[ \t]*Full prompt[^\n]*(?:\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*)*?\n(?![ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next))[^\n]*?(?<!(?:such as|e\.g\.,?|for example,?|like|write|leave(?: an?)?|insert|put)[ \t]+\x60?)(?<!\]\]\x60?(?:,|[ \t]+or)[ \t]+\x60?)(?<![\w\])])\[\[(?!placeholders?\]\])(?![^\[\]\n]*(?:(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)))[^\[\]\n]+\]\])(?:(?!What next\?)[\s\S])*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Done\b(?:(?!\s\d[.)]\s)[^\n★]){0,200}★)'
flags: i
weight: 1
---

