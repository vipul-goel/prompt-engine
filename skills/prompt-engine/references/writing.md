# Domain pack: writing and marketing

Use this pack for prompts that produce text for people to read: emails, landing pages, ads, social posts, blog articles, newsletters, scripts, product descriptions, press releases, speeches and stories. Signals: write, draft, copy, post, email, article, blog, caption, slogan, story, tone, audience, brand.

## Must-haves in the enhanced prompt

Writing goes wrong when the model fills in audience, voice and facts on its own, so pin these down:

1. **Audience and goal** — who reads it, and what they should do or feel afterwards (one primary call to action).
2. **Voice** — how it should sound. A short sample of the user's own writing beats any description, so ask for one when voice matters.
3. **Length and format** — channel, length range and required parts (subject line, headline, call-to-action button).
4. **Facts and claims** — only facts the user supplied. Placeholders mark missing proof such as numbers, testimonials and prices, instead of invented statistics or quotes. No guarantees or superlatives the user can't back up.
5. **Words to avoid** — the user's banned phrases plus stock filler ("unlock", "elevate", "in today's fast-paced world") where they'd hurt.

## Checklist

★ marks the recommended default.

| # | Item | Example question | ★ Default |
|---|---|---|---|
| 1 | Deliverable and channel | What exactly is this, and where will it run? | Infer it from the request and state it as an assumption |
| 2 | Goal and call to action | What should the reader do or feel afterwards? | One primary call to action that matches the goal |
| 3 | Audience | Who is the reader, what do they know, what do they care about? | A busy, intelligent non-expert; plain language |
| 4 | Key messages and proof | Which 1–3 points must land, and which facts, numbers or testimonials can I use? | Only supplied facts; placeholders where proof is missing |
| 5 | Offer and difference | What's offered, and how is it different from alternatives? | Lead with the main benefit tied to the reader's problem; don't disparage competitors |
| 6 | Voice and tone | How should it sound? Can you share a sample? | Clear, confident and conversational; active voice; no hype |
| 7 | Length and platform limits | Any word or character limits? | A typical length for the channel, stated as a range; the user confirms hard platform limits |
| 8 | Structure | Required parts: subject line, headline, subhead, bullets, call to action, P.S.? | Headline, hook, body, call to action |
| 9 | Point of view and sender | Who is the author, and is it "we", "I" or "you"? | Brand "we" speaking to reader "you" |
| 10 | Banned words and style | Words, phrases or emoji to avoid? | No stock AI phrases; emoji only where usual for the channel |
| 11 | Compliance and claims | Claims you can't make, disclaimers, regulated topics? | No unverifiable superlatives or guarantees; flag health, finance and legal claims for review |
| 12 | SEO (web pages) | Is there a target keyword or search intent? | Write for the reader first; if a keyword is given, use it naturally in the title and opening |
| 13 | Reference samples | Is there a piece you like, or one to avoid? | None; examples steer strongly, so use one only if it shows exactly what's wanted |
| 14 | Variants | How many versions or alternatives? | One main draft plus 2–3 alternative headlines or subject lines |
| 15 | Language and locale | Which language and regional spelling? | The user's language; US English if English and unspecified |
| 16 | Readability | Target reading level or accessibility needs? | Short paragraphs, scannable structure, descriptive link text |
| 17 | Timing | Is it tied to a date, launch or season? | Evergreen; no invented dates or deadlines |

For stories and creative writing, ask about genre, point of view, length, the reader's age group, tone and the ending the user wants; skip channel, CTA and SEO.

## Example

Rough prompt: "write a launch email for my productivity app" (quick mode)

Assumptions it produces include: audience = existing newsletter subscribers; goal = start a free trial; body of 150–250 words; subject line under 50 characters; friendly and direct tone. Placeholders: `[[app name]]`, `[[key feature]]`, `[[trial length]]`, `[[sign-up link]]`.

Enhanced prompt (excerpt):

```text
# Goal
Write a launch email announcing [[app name]], a productivity app, to existing newsletter subscribers, so that as many as possible start a free trial.

# Output
- A subject line (under 50 characters, because longer ones get cut off on phones) plus two alternatives.
- Body of 150–250 words: a hook naming the reader's problem, what [[app name]] does about it ([[key feature]]), one short proof point if provided, and one call to action: "Start your [[trial length]] free trial" linking to [[sign-up link]].
- Tone: friendly and direct, like a founder writing to people who already know the brand. Avoid hype words such as "revolutionary" and "game-changing".

# Facts
Use only the facts above. If a number or testimonial would help but isn't provided, leave a placeholder instead of inventing one.
```
