# Domain pack: image and video generation

Use this pack for prompts meant for image or video models: Midjourney, GPT Image, Gemini image models, FLUX, Stable Diffusion, Veo, Gemini Omni, Runway, Kling, Luma, Seedance and similar. Signals: image, picture, photo, illustration, logo, poster, thumbnail, render, video, clip, shot, scene, animation, a tool's name. Tool-specific syntax is in `references/media-targets.md`.

## The media rule

Write the prompt in the target tool's own format, because these models read prompts differently from chat models:
- no role, section headings, XML tags or "because" clauses inside the prompt — they become things to draw;
- put explanations under "What I added & why", and settings where the tool expects them;
- keep the user's subject, action, style words and layout intact, and add missing details only as labelled defaults.

## First: tool and mode

Two facts decide the format, so settle them first, by inference or as the first question:

- **Target tool.** If unknown, ★ default: a tool-agnostic descriptive paragraph plus a separate Settings list.
- **Input mode.**
  - **T2I** — text to image.
  - **EDIT** — change an existing image.
  - **T2V** — text to video.
  - **I2V** — image to video.
  - **V2V** — change an existing video.

Then ask only about the dimensions below that apply to that mode.

## Checklist

★ marks the recommended default.

| # | Dimension | Modes | Example question | ★ Default |
|---|---|---|---|---|
| 1 | Target tool and mode | all | Which tool will you paste this into, and are you starting from text, an image or a video? | Tool-agnostic paragraph plus Settings; text to image |
| 2 | Purpose | all | What is it for: ad, thumbnail, storyboard frame, product shot, social clip? | General illustrative use |
| 3 | Subject | all | Who or what is the subject, how many, and which 2–3 traits matter? | One subject, exact counts, concrete materials and textures |
| 4 | Action or pose | all; essential for video | What happens? For video: first, next, last? | Image: natural pose. Video: one action in 2–3 beats |
| 5 | Setting and time | all | Where and when does it take place? | One coherent location; time of day chosen to fit the mood |
| 6 | Composition and framing | T2I, T2V, EDIT | Close-up, medium or wide shot? Camera height? | Medium shot at eye level |
| 7 | Camera look | photoreal | Lens feel, depth of field, film or phone look? | Natural perspective, subject in sharp focus |
| 8 | Camera movement | T2V, I2V | Still camera or one move (push-in, pan, tracking, handheld)? | Static, or exactly one move per shot |
| 9 | Lighting | all | What light: soft or hard, from where, how much contrast? | Always name a light source and its quality |
| 10 | Color palette | all | Must-have colors or brand colors? | 3–5 named colors that fit the mood |
| 11 | Style and medium | all | Photo, illustration, 3D, anime, watercolor, a period film look? | Photorealistic if the user said "photo"; otherwise ask |
| 12 | Mood | all | What should the viewer feel? | Inferred from the purpose and shown through light, color and scale |
| 13 | Aspect ratio and resolution | all | Where will it be shown: square feed, 16:9 video, 9:16 vertical, print? | 1:1 for images, 16:9 for video, 9:16 for vertical social |
| 14 | Duration and pacing | T2V, I2V | How long, and how fast should it feel? | The shortest length that fits the action; long pieces split into clips |
| 15 | Shot structure | T2V | One continuous shot, or several shots with cuts? | One continuous shot, stated explicitly |
| 16 | Dialogue | video with audio | Should anyone speak? Exact lines, language, voice? | No dialogue; if any, short quoted lines |
| 17 | Sound | video with audio | What should we hear: effects, ambience, music? | Natural ambience; no music unless asked |
| 18 | Consistency | multi-image or multi-shot | Will this character or product appear again? Any reference images? | A reusable identity block, pasted unchanged every time |
| 19 | Reference roles | EDIT, I2V, references | What is each reference for: subject, style, first frame, last frame? | State a role for every reference, in the tool's syntax |
| 20 | Text in the image | all | Should any words appear? Exact text, font, placement? | No text. For video, add text in editing |
| 21 | Exclusions | all | Anything that must not appear: watermark, extra people, logos, subtitles? | No watermark or extra text, written in the tool's exclusion style |
| 22 | What an edit keeps | EDIT, I2V, V2V | What must stay exactly the same? | Change only the requested part; keep everything else identical |
| 23 | Variety | T2I | Several varied options, or one faithful result? | The tool's defaults |
| 24 | Rights and likeness | all | Real people, brands, logos, copyrighted characters, or a living artist's style? | Fictional people, generic marks, style described by its traits |

## Output shapes

Pick the shape the tool expects; `references/media-targets.md` says which one.

**A. Descriptive paragraph** (Gemini image, FLUX, Runway, Luma, simple GPT Image requests, single-shot video):
```text
A weathered lighthouse keeper in a navy wool peacoat repaints the red-and-white stripes of a stone lighthouse at dawn, balanced on a narrow iron ladder. Low-angle medium-wide shot, calm sea and pale pink sky behind him. Soft golden backlight with long shadows; fine salt spray catches the light. Photorealistic, medium-format film look with gentle grain.
```

**B. Short labeled lines** (complex GPT Image requests; edits):
```text
Use: poster for a seaside café opening
Scene: stone lighthouse on a cliff at dawn, calm sea
Subject: weathered lighthouse keeper repainting red-and-white stripes
Details: low-angle medium-wide shot; soft golden backlight; gouache texture
Text: "GRAND OPENING" in bold white condensed letters, centered at the top, once
Constraints: no watermark, no other text, no logos
```

**C. One line with parameters at the end** (Midjourney). Parameters go last, with no commas inside them:
```text
weathered lighthouse keeper repainting red-and-white stripes on a stone lighthouse at dawn, salt spray, soft golden backlight, low-angle medium-wide shot, gouache illustration --ar 3:2 --no boats
```

**D. Weighted tags plus a negative field** (Stable Diffusion):
```text
Positive: (weathered lighthouse keeper:1.2), red and white striped lighthouse, dawn, golden backlight, salt spray, low angle, gouache illustration
Negative: watermark, text, logo, blurry
```

**E. Video paragraph with audio lines** (Veo and other video models with sound):
```text
Medium close-up, slow dolly-in. An elderly lighthouse keeper sets a paint can down on the iron gallery at dawn and looks out to sea; wind tugs at his collar. Soft golden backlight, cool blue shadows, 35mm film look. He says quietly, "Another storm's coming." SFX: a gull cries overhead. Ambient noise: steady wind and distant surf.
```

**F. Timed shot list** (several shots in one clip):
```text
[00:00-00:02] Wide shot, static: a stone lighthouse on a cliff at dawn, waves breaking below.
[00:02-00:05] Medium shot, slow push-in: the keeper climbs the last rungs of an iron ladder, paint can in hand.
[00:05-00:08] Close-up: he paints one bold red stripe. SFX: wet brush strokes.
```
Give each segment one action and one camera move, long enough for the action. Vary shot size or location between segments so cuts read as cuts.

**G. Image to video: motion only.** Don't re-describe what the image shows. Describe the camera move, what moves and what stays still, and call the subject "the subject": "The camera slowly pushes in as the subject dips the brush; his coat flutters while the lighthouse stays perfectly still."

**H. Edits: change plus keep list.** "Change only: the coat → a bright yellow oilskin. Keep exactly: face and identity, pose, ladder, framing, camera angle, lighting." Repeat the keep list on every turn.

**Settings and exclusions.** For tools with separate fields, present them as separate blocks under "Full prompt": a `Negative prompt` block where the tool has that field, and a short `Settings` list (aspect ratio, duration, resolution, number of variations). Never write settings into the prose for those tools ("make it 4K"), because they're ignored there. Midjourney is the exception: its parameters belong at the end of the same line.

**Identity block.** When a character or product recurs, write a short block (name, age range, build, face, hair, clothing, distinguishing marks) and tell the user to paste it unchanged into every prompt. Small wording changes alter the result.

## Fix these before presenting

- A bare keyword list sent to a model that wants sentences → rewrite as description.
- Negation sent to a positive-only tool ("no cars") → describe the wanted result ("an empty street"), or move it to the tool's exclusion field.
- Settings written in prose → move them to Settings or parameters.
- Midjourney syntax errors → parameters last, whole-number ratios, double quotes for text, one word per `--no` item.
- Image-to-video prompts that re-describe the image → motion only.
- More than one camera move or action per shot, or more dialogue than the clip can hold → split into shots or simplify.
- Vague praise words ("beautiful", "epic", "cinematic") or quality tags ("8K, masterpiece") → concrete nouns, light sources, materials and framing.
- Mood words without visual cues → express the mood through light, color, scale and weather.
- Vague counts ("some birds") → exact numbers ("three gulls").
- Exact typography, logos or subtitles requested from a video model → add them in editing, and exclude auto-generated subtitles.
- Real people, minors, trademarks or a living artist's name → fictional people, generic marks and a description of the style's traits.
- Version-specific flags or features you aren't sure the user's version supports → ask, or state the assumption.
- A prompt over the tool's length guidance → shorten, keeping the essentials first.

## Language

How well each tool follows prompts in languages other than English varies, and vendors don't document it consistently. When the user writes in another language, ask which language the prompt should be in. In quick mode, keep their language and list it as an assumption they can change. Don't translate silently.
