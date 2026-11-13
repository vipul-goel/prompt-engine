---
# image-video.md: one continuous shot stated as such (shape E) or timed segments (shape F), and
# settings kept out of the prose, a repeated clip length included (D45). The Full prompt and its
# blocks are judged on all four points. The Short version shares those blocks and keeps the
# settings out of its prose too (image-video.md, "Settings and exclusions"; finding 61's
# arbitration asked the skill fix to cover the media Short version).
type: llm
focus: last_message
weight: 1
---

PASS if the video prompt (1) states that it is one continuous shot, or uses timed segments with at most one camera move each, (2) includes sound direction such as 'SFX:' or 'Ambient noise:' lines or an explicit description of the audio, (3) puts aspect ratio and duration in a separate settings list or block, and its descriptive prose does not repeat them (segment timestamps in a timed shot list are fine), and (4) avoids on-screen text or subtitles. Judge the Full prompt block and the blocks that go with it, such as the settings and the negative prompt. The Short version shares those blocks and needs none of its own, but its prose must not repeat the duration or the aspect ratio either (segment timestamps are fine there too). FAIL if any of the four is missing, or if the Short version's prose repeats the duration or the aspect ratio.
