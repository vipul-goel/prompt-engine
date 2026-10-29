# Media targets

Tool-specific syntax for image and video prompts, used with `references/image-video.md`. These tools change often. If an entry is not marked verified, or the user may be on a different version, ask the user or state your choice as an assumption.

## Midjourney

*image; short video · ~ secondary: official documentation seen only in search results, so check the tool’s current docs before relying on details (last checked 2026-10-29)*

- **Prompt style:** Short descriptive prose, with parameters at the very end after a space. Short, simple prompts usually work best; use exact numbers ("three cats", not "cats").
- **Exclusions:** --no item, one word per item: multi-word phrases are read word by word. Writing "no cake" in the prompt text can still produce cake.
- **Settings:** Inline parameters at the end, with no commas inside them: --ar W:H (whole numbers), --stylize, --chaos, --raw. Video: --motion low|high, --loop.
- **References:** --sref for style. Image and character reference features have changed between versions, so ask which version the user is on or label it as an assumption.
- **Text in the image:** Exact words in double quotes; short words work best.
- **Sources:** https://docs.midjourney.com/hc/en-us/articles/32023408776205-Prompt-Basics · https://docs.midjourney.com/hc/en-us/articles/32859204029709-Parameter-List · https://docs.midjourney.com/hc/en-us/articles/32173351982093-No

## OpenAI GPT Image (also image generation in ChatGPT)

*image; image editing · ✓ verified against the vendor’s own documentation (last checked 2026-10-29)*

- **Prompt style:** A descriptive paragraph, or short labeled lines for complex requests: scene or background, then subject, then key details, then constraints. Say what the image is for (ad, UI mock, infographic).
- **Exclusions:** Plain constraints in the prompt work, such as "no watermark, no extra text".
- **Settings:** API parameters, not prose: size, quality, background (transparent needs PNG or WebP output), output_format, n.
- **References:** Refer to input images by index ("Image 1", "Image 2"). For edits: "Change only X; keep everything else the same", repeating the keep list each turn.
- **Text in the image:** Put exact text in quotes and describe font, placement and size; spell unusual words letter by letter.
- **Sources:** https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/multimodal/image-gen-models-prompting-guide.ipynb

## Google Gemini image models ("Nano Banana")

*image; image editing · ✓ verified against the vendor’s own documentation (last checked 2026-10-29)*

- **Prompt style:** A narrative paragraph, not a keyword list: subject, action, location or context, composition, style. With reference images, say how they relate to the new scene.
- **Exclusions:** Describe what you want instead of what you don't ("an empty street", not "no cars").
- **Settings:** Aspect ratio and resolution are request settings.
- **References:** Name each reference's role ("use the attached photo as the character reference").
- **Text in the image:** Put exact text in quotes and say where it goes.
- **Sources:** https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana · https://ai.google.dev/gemini-api/docs/image-generation

## FLUX (Black Forest Labs)

*image · ✓ verified against the vendor’s own documentation (last checked 2026-10-29)*

- **Prompt style:** Prose with the most important elements first: subject, action or pose, style or medium, setting, lighting, camera. About 30–80 words. JSON can be used to draft and is then flattened to prose.
- **Exclusions:** No negative prompts: describe the result you want instead.
- **Settings:** API parameters.
- **References:** Input images are passed as API parameters.
- **Text in the image:** Exact text in quotes; colors can be given as hex codes.
- **Sources:** https://raw.githubusercontent.com/black-forest-labs/skills/HEAD/README.md · https://raw.githubusercontent.com/black-forest-labs/skills/HEAD/skills/flux-image-best-practices/SKILL.md

## Stable Diffusion (AUTOMATIC1111, ComfyUI and similar)

*image · ✓ verified against the vendor’s own documentation (last checked 2026-10-29)*

- **Prompt style:** Comma-separated tags, with weights for emphasis: (term:1.2). BREAK (uppercase) starts a new chunk.
- **Exclusions:** A separate negative prompt field.
- **Settings:** UI or API settings (steps, sampler, size, CFG).
- **References:** Depends on the interface and extensions.
- **Text in the image:** Unreliable; plan to add text afterwards.
- **Note:** Square brackets reduce emphasis, so leave [[placeholders]] out of the prompt itself and ask for the value instead.
- **Sources:** https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/Features

## Google Veo

*video with audio · ✓ verified against the vendor’s own documentation (last checked 2026-10-29)*

- **Prompt style:** A paragraph in the order camera, subject, action, context, style and mood; for several moments, timestamped segments such as [00:00-00:02]. Dialogue goes in quotes; sound effects start with "SFX:" and background sound with "Ambient noise:".
- **Exclusions:** A separate negative prompt field, written as a list of things to leave out.
- **Settings:** Request settings: aspect ratio, duration, resolution.
- **References:** Reference images and first/last frames are request inputs.
- **Text in the image:** Avoid on-screen text; add titles and subtitles in editing.
- **Note:** Which Veo versions are available, and where, changed in 2026; check the current docs.
- **Sources:** https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1 · https://raw.githubusercontent.com/google-gemini/cookbook/main/quickstarts/Get_started_Veo.ipynb

## Google Gemini Omni (video)

*video with audio · ~ secondary: official documentation seen only in search results, so check the tool’s current docs before relying on details (last checked 2026-10-29)*

- **Prompt style:** A paragraph or timed segments. It may cut between several shots by default, so ask explicitly for "a single continuous shot, no scene cuts" when you want one take.
- **Exclusions:** Short plain instructions, such as "no dialogue".
- **Settings:** Request settings: aspect ratio, resolution.
- **References:** Image roles are set with tags such as <FIRST_FRAME>, <LAST_FRAME> and <IMAGE_REF_N>; check the current docs for exact placement.
- **Text in the image:** Avoid on-screen text; add it in editing.
- **Sources:** https://ai.google.dev/gemini-api/docs/video · https://raw.githubusercontent.com/google-gemini/cookbook/main/quickstarts/Get_started_Omni.ipynb

## Runway

*video; image · ~ secondary: official documentation seen only in search results, so check the tool’s current docs before relying on details (last checked 2026-10-29)*

- **Prompt style:** Natural language, roughly camera, then subject and action, then environment. Image-to-video: describe only the motion and call the subject "the subject".
- **Exclusions:** Negative phrasing isn't supported and may backfire: write "locked camera" rather than "no camera movement".
- **Settings:** UI or API settings, including duration.
- **References:** Saved references are called with @tags.
- **Text in the image:** Avoid on-screen text; add it in editing.
- **Sources:** https://help.runwayml.com/hc/en-us/articles/47313737321107-Text-to-Video-Prompting-Guide · https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide

## Kling

*video with audio · ~ secondary: official documentation seen only in search results, so check the tool’s current docs before relying on details (last checked 2026-10-29)*

- **Prompt style:** Subject, movement, scene, then camera, lighting and atmosphere; timed blocks for several moments. References are named in the prompt, for example "@Image1 as the first frame".
- **Exclusions:** A separate negative prompt field; keep it short (for example subtitles, background music).
- **Settings:** API or app settings, including duration.
- **References:** @Image1-style references in the prompt.
- **Text in the image:** Avoid on-screen text; add it in editing.
- **Sources:** https://kling.ai/quickstart/text-to-video-prompt-guide

## Luma (Ray models)

*video · ~ secondary: official documentation seen only in search results, so check the tool’s current docs before relying on details (last checked 2026-10-29)*

- **Prompt style:** Natural language in the present tense, focused on the action, with secondary motion (hair, fabric, dust) for realism. A few sentences.
- **Exclusions:** Positive phrasing only.
- **Settings:** Request settings: aspect ratio, duration, resolution.
- **References:** Keyframes and character references are request inputs.
- **Text in the image:** Avoid on-screen text; add it in editing.
- **Sources:** https://lumalabs.ai/learning-hub/ray3-faqs · https://docs.agents.lumalabs.ai/guides/videos/generation/

## ByteDance Seedance

*video with audio · ~ secondary: official documentation seen only in search results, so check the tool’s current docs before relying on details (last checked 2026-10-29)*

- **Prompt style:** Open with a one-sentence summary (subject, place, event, style, camera), then time-stamped segments, with constraints last. Give every reference a role ("Image 1 is the main character").
- **Exclusions:** Positive phrasing; negative prompts may be ignored.
- **Settings:** API settings.
- **References:** "Image 1 / Video 1 / Audio 1" roles in the prompt; use one input mode per request.
- **Text in the image:** Avoid on-screen text; add it in editing.
- **Sources:** https://ai.byteplus.com/resources/how-to-write-better-seedance-2-5-prompts

## OpenAI Sora

*video (discontinued) · ✓ verified against the vendor’s own documentation (last checked 2026-10-29)*

- **Prompt style:** Discontinued in 2026 (app in April, API in September). If a user asks for a Sora prompt, say so and offer a prompt for another video tool. Its published guide is still a good technique reference: prose scene, then camera and mood, distinct action beats, short dialogue, background sound.
- **Sources:** https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation · https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/sora/sora2_prompting_guide.ipynb

_Generated from `data/media-targets.json` by `scripts/build.mjs`; edit the JSON, not this file._
