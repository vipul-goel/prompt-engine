---
# image-midjourney-quick's 05 check, for a reply whose menu D3 translates: output-format.md,
# "What next?", for an image prompt when the assistant can't generate media, Done ★, or Fill
# placeholders ★ while Fill before running lists a placeholder that isn't a secret's, since the
# table's first row that fits is the one for open placeholders that are neither secrets nor
# removed private details (D1, D5, D46). This request holds no private detail, so the rubric
# doesn't model D46. A judge reads the labels in any language; 07 checks that they aren't left in
# English. Example phrases are in single quotes.
type: llm
focus: last_message
weight: 1
---

The reply should end with a What next? menu (its heading may be in Japanese) for the Midjourney prompt it wrote. The assistant can't generate images, so the menu's recommended option is Done, with where to paste the prompt. The one exception: if the reply's Fill before running section (its heading may be in Japanese too) lists a placeholder in double square brackets, such as '[[看板の文字]]', that isn't for a secret such as an API key, password or token, the recommended option is Fill placeholders, which asks for the missing values. Judge what each option means, in whatever language it is written.
PASS if the menu's recommended option, marked ★, is the one that fits: Fill placeholders while such a placeholder is open, and Done otherwise (the prompt is finished; paste it into Midjourney); and no option offers to run the prompt or generate the image here. FAIL if there is no such menu, if the ★ marks another option, or if any option offers to run the prompt now.
