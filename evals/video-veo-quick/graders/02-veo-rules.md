---
# image-video.md: one continuous shot stated as such, or timed segments (shape E), and settings
# kept out of the prose, a repeated clip length included (D45). Only the Full prompt and its blocks
# are judged: output-format.md asks the Short version to carry the output format, which for media
# includes the tool's settings, so the method pulls both ways there (finding 61's arbitration).
type: llm
focus: last_message
weight: 1
---

PASS if the video prompt (1) states that it is one continuous shot, or uses timed segments with at most one camera move each, (2) includes sound direction such as 'SFX:' or 'Ambient noise:' lines or an explicit description of the audio, (3) puts aspect ratio and duration in a separate settings list or block, and its descriptive prose does not repeat them (segment timestamps in a timed shot list are fine), and (4) avoids on-screen text or subtitles. Judge the Full prompt block and the blocks that go with it, such as the settings and the negative prompt; the Short version may name the duration and aspect ratio. FAIL if any of the four is missing.
