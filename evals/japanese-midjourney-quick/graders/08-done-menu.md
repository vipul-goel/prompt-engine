---
# image-midjourney-quick's 05 Done ★ check, for a reply whose menu D3 translates: output-format.md,
# "What next?", for an image prompt when the assistant can't generate media. A judge reads the
# labels in any language; 07 checks that they aren't left in English.
type: llm
focus: last_message
weight: 1
---

The reply should end with a What next? menu (its heading may be in Japanese) for the Midjourney prompt it wrote. The assistant can't generate images, so the menu's recommended option is Done, with where to paste the prompt. Judge what each option means, in whatever language it is written.
PASS if the menu's recommended option, marked ★, means Done (the prompt is finished; paste it into Midjourney) and no option offers to run the prompt or generate the image here. FAIL if there is no such menu, if the ★ marks another option, or if any option offers to run the prompt now.
