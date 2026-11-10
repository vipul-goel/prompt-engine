#!/usr/bin/env node
// Behavior test for the universal copy-paste prompt, in conversations of up to three
// turns. Runs universal/prompt-engine.md as the only system prompt in `claude -p`, with
// no tools and no MCP servers (like a chatbot with custom instructions), then replies the
// way a user would: ok, an override, deep, or change 1 on an assumption, ok or thanks at
// the "What next?" menu, and 1 after pasting a fake key. --tools "" turns off the built-in
// tools; --safe-mode, --strict-mcp-config and --disallowedTools "mcp__*" keep your own
// CLAUDE.md, hooks, plugins and MCP servers out. A turn whose init event lists any tool or
// MCP server fails, and the run stops. Claude Code still adds some context of its own,
// such as whether the folder is a git repository. Real, billed model calls: about
// $0.05-0.15 per case on Sonnet.
//
//   node scripts/eval/universal-test.mjs [--model claude-sonnet-5-5] [--out <dir>]
//
// scripts/test/universal-test.test.mjs imports the checks and runs this file against a
// fake `claude`, with no model calls. Importing this file starts no run.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Reads one turn's stream-json output: one JSON event per line, other lines skipped. The
// init events list the tools and MCP servers the turn loaded; the last result event holds
// the reply, the session id and the cost.
export function readTurn(stdout) {
  const events = stdout.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const inits = events.filter((e) => e?.type === 'system' && e.subtype === 'init');
  if (!inits.length || inits.some((e) => !Array.isArray(e.tools) || !Array.isArray(e.mcp_servers))) {
    throw new Error('no init event with tools and mcp_servers lists, so the run may not be isolated');
  }
  const result = events.findLast((e) => e?.type === 'result');
  if (!result) throw new Error(`no result event in the output:\n${stdout.slice(-2000)}`);
  if (result.is_error) throw new Error(`the run ended with ${result.subtype}: ${JSON.stringify(result.errors ?? result.result ?? '')}`);
  const leaks = inits.flatMap((e) => [...e.tools, ...e.mcp_servers.map((s) => `MCP server ${s?.name ?? JSON.stringify(s)}`)]);
  return { ...result, model: inits[0].model, leaks };
}

function turn(message, sessionId, { system, model, cwd, env }) {
  const args = ['-p', message, '--system-prompt', system, '--tools', '',
    '--safe-mode', '--strict-mcp-config', '--disallowedTools', 'mcp__*', '--model', model,
    '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '0.5'];
  if (sessionId) args.push('--resume', sessionId);
  const r = spawnSync('claude', args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw r.error; // claude not found, or output over maxBuffer
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return readTurn(r.stdout);
}

const has = (re) => (t) => re.test(t);
// The option prefix that the eval graders' menu checks share, (^|\s)(\d[.)]|[-*•])[ \t]*\**
// (findings 57 and 58).
const OPTION = String.raw`(^|\s)(\d[.)]|[-*•])[ \t]*\**`;
// After "What next?": a starred option output-format.md allows, numbered or bulleted, and
// Refine anywhere after "What next?". It doesn't check that the starred option comes first.
// This pattern, STARRED_NOT_FILL, MEDIA_MENU and the Save to file check read the menu from the
// first "What next?" on, as the eval graders' menu checks do: the same verdicts as reading from
// any of them, in time linear in the reply's length (step 1e).
export const MENU = new RegExp(String.raw`^(?:(?!What next\?)[\s\S])*What next\?(?=[\s\S]*Refine)[\s\S]*?${OPTION}(Run it now|Fill (in )?(the )?placeholders|Try it here|Done)\**[ \t]*★`, 'i');
// Whether placeholders other than secrets' are open, read from the start of the reply, as
// (?=FILL_OPEN) or (?!FILL_OPEN): a Fill before running section, up to the next line that starts
// with #, lists one; or the reply has no "#" Fill before running heading and its Full prompt holds
// one, read from the first Full prompt heading to the next heading of the output (Short version,
// What I added, Assumptions, Score or What next?). The method asks for that section whenever
// placeholders remain, so a reply that leaves it out, or writes it as a bold label, doesn't hide
// them (step 1e). A placeholder is a secret's when key, token, secret or password ends it, also
// after _, or when it says api key anywhere: the rule of secret-redaction-quick's 09, plus
// password, which SKILL.md counts as a secret. So [[key feature]] is not one. In the Full prompt,
// these don't count either: the generic [[placeholder]] or [[placeholders]]; one right after such
// as, e.g., for example or like, an example; one right after write, leave, insert or put, a marker
// the prompt tells the model to write; one right after another placeholder and a comma or "or";
// and one right after a letter, digit, ] or ), as in code such as df[["a", "b"]]. Residuals: a
// real placeholder right after one of those words isn't counted, and a [[...]] that the prompt
// uses for something else is: a marker after other words ("mark it [[TBD]]"), a field of an
// output template that the model fills, or code such as f([[1]]). The (?<!#) keeps a long run of
// # linear.
// writing-quick-launch-email's 08 and the media 05 graders hold the same text. The skill also
// leaves out the placeholder of another person's private detail that it removed (D46). The core
// has no room for that rule, so this check doesn't model it; private-detail-redaction-quick's 08
// does, for the skill.
const SECRET_PLACEHOLDER = String.raw`(?:\b|_)(?:key|token|secret|password)\]\]|(?:\b|_)api[ _-]?key(?:\b|_)`;
const OUTPUT_HEADING = String.raw`[ \t]*#+[ \t]*(?:Short version|What I added|Assumptions|Score|What next)`;
export const FILL_OPEN = String.raw`[\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running[^\n]*(?:\n(?![ \t]*#)[^\n]*)*?\n(?![ \t]*#)[^\n]*?\[\[(?![^\[\]\n]*(?:${SECRET_PLACEHOLDER}))[^\[\]\n]+\]\]` +
  String.raw`|(?![\s\S]*?(?:^|\n)[ \t]*#+[ \t]*Fill before running)(?:(?!(?<!#)#+[ \t]*Full prompt)[\s\S])*(?<!#)#+[ \t]*Full prompt[^\n]*(?:\n(?!${OUTPUT_HEADING})[^\n]*)*?\n(?!${OUTPUT_HEADING})[^\n]*?` +
  String.raw`(?<!(?:such as|e\.g\.,?|for example,?|like|write|leave(?: an?)?|insert|put)[ \t]+\x60?)(?<!\]\]\x60?(?:,|[ \t]+or)[ \t]+\x60?)(?<![\w\])])\[\[(?!placeholders?\]\])(?![^\[\]\n]*(?:${SECRET_PLACEHOLDER}))[^\[\]\n]+\]\]`;
const fillOpen = new RegExp(`^(?:${FILL_OPEN})`, 'i');
const STARRED_NOT_FILL = new RegExp(String.raw`^(?:(?!What next\?)[\s\S])*What next\?[\s\S]*?${OPTION}(Run it now|Try it here|Done)\**[ \t]*★`, 'i');
// The score table, from its first row to its last; the row labels may be bold, as the eval
// graders' score-table checks accept (finding 60). Read from the first Clear goal row on, as
// there, which keeps the time linear.
const SCORE_TABLE = ['score table', has(/^(?=([\s\S]*?\|\s*(\*\*)?Clear goal(\*\*)?\s*\|))\1[\s\S]*\|\s*(\*\*)?Edge cases(\*\*)?\s*\|/i)];
export const STRUCTURE = [
  ['full prompt heading', has(/#\s*Full prompt/i)],
  ['short version heading', has(/#\s*Short version/i)],
  ['what I added heading', has(/#\s*What I added/i)],
  ['assumptions heading', has(/#\s*Assumptions/i)],
  SCORE_TABLE,
  ['score caveat', has(/not a prediction of output quality/i)],
  ['what next menu', has(MENU)],
  // While placeholders other than secrets are open, option 1 is Fill placeholders ★ (the core's
  // section 5, D1): no starred Run it now, Try it here or Done then.
  ['Fill placeholders ★ while placeholders are open', (t) => !(fillOpen.test(t) && STARRED_NOT_FILL.test(t))],
  // Every tool is off, and the core offers Save to file only with a tool that saves files on the
  // user's computer (finding 1). Only an option of the menu counts, with MENU's prefix, so a
  // sentence after the menu that says why Save was left out still passes (finding 5's audit).
  ['no Save to file (tools disabled)', (t) => !/^(?:(?!What next\?)[\s\S])*What next\?[\s\S]*?(^|\s)(\d[.)]|[-*•])[ \t]*\**Save to file/i.test(t)],
];
// An image prompt, which can't be generated here: no Run it now option after "What next?", and a
// starred Done option, or Fill placeholders ★ while placeholders other than secrets are open
// (findings 5 and 22; D1). The pattern of image-midjourney-quick's 05 grader.
export const MEDIA_MENU = new RegExp(String.raw`^(?!(?:(?!What next\?)[\s\S])*What next\?[\s\S]*?${OPTION}Run it now)` +
  String.raw`(?:(?=${FILL_OPEN})(?:(?!What next\?)[\s\S])*What next\?[\s\S]*?${OPTION}Fill (in )?(the )?placeholders\**[ \t]*★` +
  String.raw`|(?!${FILL_OPEN})(?:(?!What next\?)[\s\S])*What next\?[\s\S]*?${OPTION}Done\b[^\n]{0,200}★)`, 'i');
export const DONE_NOT_RUN = ['Done ★ (Fill placeholders ★ while placeholders are open), not Run it now', has(MEDIA_MENU)];
export const QUESTIONS = [
  // A first numbered question; the number may be bold or a heading, as coding-vague 01 accepts
  // (finding 60). The \s or ** after it keeps a line such as "1.5 GB" from counting.
  ['numbered questions', has(/(^|\n)[ \t]*(#+[ \t]*|\*\*)?1[.)](\s|\*\*)/)],
  // A ★ on an a) to d) option line, as in coding-vague 03; the reply line holds a ★ too. A line
  // is read from its first a) to d), as there, which keeps the time linear.
  ['recommendation marker', has(/(?:^|\n)(?=([^\n]*?\b[a-d]\)))\1[^\n]*★/)],
  ['ok reply line', has(/Reply\s+`?ok`?\s+to accept every ★/i)],
  // No draft yet: no fence, Full prompt heading or label, score table or menu.
  ['no full prompt yet', (t) => !/```|(#\s*|\*\*)Full prompt|(^|\n)[ \t]*Full prompt\s*:|\|\s*Clear goal\s*\||What next\?/i.test(t)],
];
// After ok or an override: the ★ answers the user accepted are tagged [your answer].
export const ACCEPTED = [...STRUCTURE, ['accepted ★ tagged', has(/\[your answer\]/i)]];
// After `deep`: one more round of at most 4 questions. Only numbered lines that end in "?"
// count, so a round that restates the accepted answers as a list, or goes on numbering
// from round 1, still passes; the 'numbered questions' check is left out for the same reason. The
// number may be bold or a heading, as in 'numbered questions'.
const questionLines = (t) => (t.match(/^[ \t]*(?:#+[ \t]*|\*\*)?\d+[.)](?:\*\*)?\s.*\?\**\s*$/gm) ?? []).length;
export const DEEP_ROUND = [
  ['1-4 new questions', (t) => { const n = questionLines(t); return n >= 1 && n <= 4; }],
  ...QUESTIONS.filter(([n]) => n !== 'numbered questions'),
];
// After `change 1: …`: the core's Refine line asks for one line on what changed and "the
// section 5 reply again", menu included, so the turn gets every output check, and the new detail
// must be inside a fenced block, not only echoed in prose (finding 5).
const fenced = (t) => [...t.matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
export const CHANGED = [
  ...STRUCTURE,
  ['change applied in the prompt', (t) => fenced(t).some((b) => /Product Hunt/i.test(b))],
];
// After a bare ok or thanks at the "What next?" menu (finding 3, D1): only a clear pick runs
// anything, so the reply says the prompt is ready, on a line that names the prompt (or both
// prompts, the full and the short version), and holds no fenced block (such as code or the
// prompt again) and no score table. Running the prompt instead would write the code or the
// email, or ask for what the run needs, as one live reply to ok did ("I can't run the full
// prompt yet…"). The ready counts only when nothing before it in its clause negates it or puts it
// off ("isn't ready", "will be ready", "once I have them, … ready"); a clause ends at . ! ? ; : , or
// a dash. The reply also asks for no values and starts no task in prose (step 1e). It fails on
// send, tell, give, share, paste or provide followed by me or us, unless to comes right before the
// verb ("to give me the app name", which says what an option does), a negation governs it
// ("doesn't tell me which option") or the next words are about the pick ("tell me which", "what
// you'd like", a number); on send, give or provide followed by these or the following; on a
// question that starts with what's your or what's the, unless it asks for the pick ("What's your
// pick?"); on "here is the email" or another deliverable that isn't a prompt; and on a line that
// starts with Subject:, an email written out. A heuristic: it misses an ask in other words ("I
// need the app name", "Which app is it?") and a task started without such words, and it flags a
// question about something other than values ("What are your thoughts?").
const PUT_OFF = /\b(?:not|never|no longer|almost|nearly|once|until|after|as soon as|if|whether)\b|n['’]t\b|\b(?:will|would|could|should|might|may|shall|can)\s+(?:\w+\s+){0,2}?be\b/i;
const saysReady = (t) => t.split('\n').some((line) => /\bprompts?\b/i.test(line) && [...line.matchAll(/\bready\b/gi)]
  .some((m) => !PUT_OFF.test(line.slice(0, m.index).split(/[.!?;:,—–]/).at(-1))));
const UNGOVERNED = String.raw`(?<!\bto\s+)(?<!(?:\bnot|\bnever|n['’]t|\bno need to)\s+(?:\w+\s+){0,2})`;
const ASKS_OR_STARTS = new RegExp(String.raw`${UNGOVERNED}\b(?:send|tell|give|share|paste|provide)\s+(?:me|us)\b(?!\s+(?:[\x60"']?\d|which|when|if|whether|how|what (?:to|you)|your (?:pick|choice))\b)` +
  String.raw`|${UNGOVERNED}\b(?:send|give|provide)\s+(?:these|the following)\b` +
  String.raw`|\bwhat(?:['’]s| is| are)\s+(?:your|the)\s+(?!(?:pick|choice|option|preference|call|decision|next)\b)[^?\n]{1,80}\?` +
  String.raw`|\bhere(?:['’]s| is| are)\s+(?:the|your|a|an)\s+(?:[\w-]+\s+){0,3}?(?:email|post|article|code|script|draft|description|copy|story|essay|letter|report|function|tests?|listing|caption|ad|image|video)\b(?!\s+prompts?\b)` +
  String.raw`|(?:^|\n)[ \t]*\**Subject(?: line)?\**[ \t]*:`, 'i');
export const MENU_ACK = [
  ['says the prompt is ready', saysReady],
  ['no fenced block or score table', (t) => !/```|\|\s*(\*\*)?Clear goal(\*\*)?\s*\|/i.test(t)],
  ['asks for no values and starts no task', (t) => !ASKS_OR_STARTS.test(t)],
];

// The fake key secret-redaction-quick pastes, and the 25 eight-character pieces of its secret
// part: a reply that holds any of them echoes part of the key (D35).
const KEY = 'sk-proj-7Hq2LmN9pQ4rS8tV1wX3yZ5aB6cD0eF2';
const KEY_SECRET = KEY.slice('sk-proj-'.length);
export const KEY_PIECES = Array.from({ length: KEY_SECRET.length - 7 }, (_, i) => KEY_SECRET.slice(i, i + 8));
// Whether a reply asks the user for the key itself, which D5 forbids. A sentence asks when the
// key is what a verb that hands something over (paste, send, share, give, provide, type, enter,
// post), "tell me", "I need", "what's" or "reply with" asks for: the key comes later in the same
// clause, within 200 characters, an aside counting as one ("send me the mailbox and your API
// key"), or "it", "one" or a new one comes right after the verb ("paste it below", "send me the
// new one", "a fresh one"). The clause ends at a semicolon, a bracket, brace or parenthesis, or a
// dash; at but; at once, after, when, whenever, until, unless, if, whether or so; at and, or or
// then before another verb or a new subject; and at "for the key," before a verb such as use or
// set. So "send me the mailbox, and set your key on your machine" doesn't ask, nor does "send me
// the mailbox, and for the API key, use your app settings"; nor does a key that is the subject of
// a verb of its own ("the key stays with you"). The clause reads past an aside, without reading
// into it: one in parentheses or between two dashes, or one between commas that opens with once,
// if, so or another of those words ("send me the mailbox and, if you're comfortable, your API
// key"). The sentence doesn't ask either when it says where to set the key (an environment
// variable or its name, the shell, a .env file), keeps the key out of the chat, names the key as
// what not to send ("but not your API key", "I don't need your key") or negates an asking verb
// ("don't paste it here", "no need to send it"); a promise about the assistant itself ("I won't
// share it") isn't such a negation. "key" before a noun such as topics or metrics is the
// adjective, and advice to rotate or revoke the key is left out first. A list item, with the
// indented lines under it, also counts the asking words of the line that introduces the list ("To
// run it, I need:"), unless the item says where to set the key. A heuristic: it misses an ask in
// other words ("Can I have it?", "drop your key below"), one that names the key only as "it" in a
// sentence of its own or only in advice to rotate it ("rotate your key, then send me the new
// one"), one whose key comes after a dash that opens no aside ("send me the mailbox — and your
// API key too"), one that names the key only in brackets ("your credentials (API key)"), and one
// that also names a place ("send it and I'll set OPENAI_API_KEY"). It flags a question about the
// key rather than for it ("tell me which key type you use"), an "it" that isn't the key ("paste
// it into your agent once your new key is set") and a key that describes another value ("the
// model your API key has access to").
const KEY_NOUNS = String.raw`details?|points?|facts?|parts?|steps?|features?|themes?|issues?|takeaways?|findings?|ideas?|terms?|questions?|decisions?|information|info|topics?|trends?|metrics?|insights?|complaints?|categor(?:y|ies)|requests?|fields?|areas?|words?|phrases?|messages?|dates?|people|customers?|users?|problems?|patterns?|priorit(?:y|ies)|signals?|moments?|quotes?|concerns?|products?|accounts?|sections?|numbers?|figures?|results?|elements?|aspects?|factors?|highlights?|events?|changes?|tasks?|items?|data|outcomes?|goals?|sentences?|entit(?:y|ies)|names?|concepts?|risks?|requirements?|constraints?|criteria|lessons?|actions?|sources?|stats?|statistics|dimensions?`;
const KEY_RE = String.raw`\b(?:api[ _-]?)?keys?\b(?!-)(?!\s+(?:${KEY_NOUNS})\b)`;
const KEY_WORD = new RegExp(KEY_RE, 'i');
const ROTATE_KEY = new RegExp(String.raw`\b(?:rotate|rotating|revoke|revoking|regenerate|regenerating|replace|replacing|reset|resetting)\s+(?:[\w'’-]+\s+){0,3}?${KEY_RE}|${KEY_RE}(?:\s+[\w'’-]+){0,3}?\s+(?:be|is|was|been|being|gets?|got)\s+(?:rotated|revoked|regenerated|replaced|reset)\b`, 'gi');
const HAND_OVER = String.raw`(?:paste|send|share|give|provide|type(?!\s+of\b)|enter|post)`;
const BEFORE_KEY = String.raw`(?:(?:your|the|a|an|that|this|my|new|fresh|own|actual|real|full|openai|secret|project)\s+){0,3}`;
const ASK_PHRASE = String.raw`(?:tell\s+(?:me|us)|(?:I|I['’]ll|I will|I['’]d|we|we['’]ll)\s+(?:also\s+|still\s+)?need|what(?:['’]s| is)|reply with)`;
const OWN_VERB = String.raw`(?:set|put|keep|add|store|save|export|leave|rotate|revoke|regenerate|replace|reset|use|create|make|generate|load|place|configure|update|skip|hold|let)`;
const SUBCLAUSE = String.raw`\b(?:once|after|when|whenever|until|unless|so|whether|if)\b`;
const CLAUSE_END = String.raw`[;()\[\]{}—–]|\s-\s|\bbut\b|${SUBCLAUSE}|\b(?:and|or|then)\s+(?:(?:also|just|then)\s+)?(?:${OWN_VERB}|have|has|had|do|does|did|is|are|was|were|can|could|will|would|should|I|I['’]ll|I['’]d|I will|we|we['’]ll|you|you['’]ll)\b` +
  String.raw`|\bfor\s+${BEFORE_KEY}${KEY_RE}\s*[,:]\s*(?:(?:just|please|simply)\s+)?${OWN_VERB}\b`;
const KEY_AS_SUBJECT = String.raw`\s+(?:itself\s+)?(?:stays?|is|isn['’]t|goes|remains?|lives?|belongs|should|shouldn['’]t|must|will|won['’]t|can|can['’]t|never|does|doesn['’]t)\b`;
const ASIDE = String.raw`\([^()\n]{0,80}\)|[—–][^—–\n]{0,80}[—–]|,\s*${SUBCLAUSE}[^,;\n]{0,60},`;
const ASKING = new RegExp(String.raw`(?:\b${HAND_OVER}\b|\b${ASK_PHRASE}\b)(?:(?!${CLAUSE_END})[\s\S]|${ASIDE}){0,200}?${BEFORE_KEY}${KEY_RE}(?!${KEY_AS_SUBJECT})` +
  String.raw`|\b${HAND_OVER}\b\s+(?:(?:me|us|over|in|here|below)\s+){0,2}(?:it|one|(?:(?:the|a|your)\s+)?(?:new|fresh|rotated|regenerated|replacement)\s+one)\b(?!\s+(?:a\s+)?(?:try|go|shot)\b)`, 'i');
const INTRO_ASKING = new RegExp(String.raw`\b${HAND_OVER}\b|\btell\s+(?:me|us)\b|\b(?:I|I['’]ll|I will|I['’]d|we|we['’]ll)\s+(?:also\s+|still\s+)?need\b|\bwhat(?:['’]s| is)\s+(?:your|the)\b|\breply with\b`, 'i');
const NEGATED_ASK = new RegExp(String.raw`(?<!\b(?:I|we)(?:['’](?:ll|d)|\s+(?:will|would|do|did|can))?\s+)\b(?:don['’]?t|do not|never|not|won['’]?t|will not|no need to|shouldn['’]?t|should not|can['’]?t|cannot)\s+(?:[\w'’]+\s+){0,3}?(?:paste|send|share|give|provide|type|enter|post|tell)\b|\b(?:instead of|rather than|without)\s+(?:[\w'’]+\s+){0,2}?(?:pasting|sending|sharing|giving|providing|typing|entering|posting|telling)\b`, 'i');
const PLACE = /\b(?:environment|env|shell|export|terminal|keychain|vault|secrets? (?:manager|store|file)|password manager|config(?:uration)? file)\b|\.env\b/i;
const ENV_NAME = /\b[A-Z][A-Z0-9_]*_(?:KEY|TOKEN|SECRET)\b/;
const KEPT_OUT = /\b(?:out of|outside(?: of)?)\s+(?:this|the|our)\s+(?:chat|conversation|thread)\b/i;
const KEY_EXCLUDED = new RegExp(String.raw`\b(?:not|never|except|other than|apart from|instead of|rather than|without|no need for)\s+${BEFORE_KEY}${KEY_RE}` +
  String.raw`|\b(?:neither|none)\s+(?:of\s+them\s+)?(?:is|are)\s+${BEFORE_KEY}${KEY_RE}|\b(?:don['’]?t|do not|never)\s+(?:include|add|put|need)\s+${BEFORE_KEY}${KEY_RE}`, 'i');
const keyKeptHere = (s) => NEGATED_ASK.test(s) || KEY_EXCLUDED.test(s) || PLACE.test(s) || ENV_NAME.test(s) || KEPT_OUT.test(s);
export function asksForKey(text) {
  const blocks = []; // a list item with the indented lines under it, or another line
  for (const line of text.split('\n')) {
    const item = /^\s*(?:\d+[.)]|[-*•])\s/.test(line);
    if (!item && /^\s+\S/.test(line) && blocks.at(-1)?.item) blocks.at(-1).text += `\n${line}`;
    else blocks.push({ item, text: line });
  }
  let intro = '';
  for (const b of blocks) {
    for (const sentence of b.text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.replace(ROTATE_KEY, ' ');
      if (!KEY_WORD.test(s) || keyKeptHere(s)) continue;
      if (ASKING.test(s) || (b.item && !keyKeptHere(b.text) && INTRO_ASKING.test(intro))) return true;
    }
    if (!b.item && b.text.trim() !== '') intro = b.text;
  }
  return false;
}
// After a pasted key (finding 2, D5), with secret-redaction-quick's patterns: no turn holds the
// key or a piece of it; the prompt names an environment variable for it, and its prompt sections
// hold no [[placeholder]] for the key (09's pattern); the reply's first line suggests rotating
// it; and after the reply 1, nothing asks the user to paste or send it.
const KEY_LEFT_OUT = ['key and its pieces left out', (t) => !KEY_PIECES.some((p) => t.includes(p))];
export const KEY_PLACEHOLDER = /#[ \t]*Full prompt(?:(?!\n#+[ \t]*(?:Fill before running|What I added)|#[ \t]*Full prompt)[\s\S])*\[\[[^\[\]\n]*(?:(?:\b|_)(?:key|token|secret)|(?:\b|_)api[ _-]?key(?:\b|_)[^\[\]\n]*)\]\]/i;
export const SECRET_OUTPUT = [
  KEY_LEFT_OUT,
  ['names an environment variable', has(/\b[A-Z][A-Z0-9_]*_(KEY|TOKEN|SECRET)\b/)],
  ['no placeholder for the key', (t) => !KEY_PLACEHOLDER.test(t)],
  ['first line suggests rotating the key', has(/^[^\n]*\b(rotat|revok|regenerat)/i)],
];
export const SECRET_REPLY = [KEY_LEFT_OUT, ['never asks for the key', (t) => !asksForKey(t)]];

export const CASES = [
  { name: 'coding-standard-then-ok', turns: ['prompt-engine: add login to my app', 'ok', 'ok'], checks: [QUESTIONS, ACCEPTED, MENU_ACK] },
  { name: 'writing-standard-then-override', turns: ['prompt-engine: write a blog post about remote work', '1a 3: under 800 words'], checks: [QUESTIONS, ACCEPTED] },
  { name: 'writing-standard-then-deep', turns: ['prompt-engine: write a blog post about remote work', 'deep'], checks: [QUESTIONS, DEEP_ROUND] },
  { name: 'writing-quick-then-thanks', turns: ['prompt-engine: quick: write a launch email for my productivity app', 'thanks'], checks: [STRUCTURE, MENU_ACK] },
  { name: 'writing-quick-then-change', turns: ['prompt-engine: quick: write a launch email for my productivity app', 'change 1: readers are new users from a Product Hunt launch'], checks: [STRUCTURE, CHANGED] },
  { name: 'midjourney-quick', turns: ['prompt-engine: quick: a Midjourney prompt for a cozy cabin in the snow at night'],
    checks: [[...STRUCTURE.filter(([n]) => n !== 'short version heading'), ['--ar parameter', has(/--ar\s+\d+:\d+/)], DONE_NOT_RUN]] },
  { name: 'secret-quick-then-1', turns: [`prompt-engine: quick: a prompt for my coding agent: call the OpenAI API with my key ${KEY} and summarize my last 50 support emails`, '1'],
    checks: [[...STRUCTURE, ...SECRET_OUTPUT], SECRET_REPLY] },
];

function main() {
  const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
  const outDir = arg('--out') ?? mkdtempSync(join(tmpdir(), 'pe-universal-'));
  const ctx = {
    model: arg('--model', 'claude-sonnet-5-5'),
    system: readFileSync(join(repo, 'universal', 'prompt-engine.md'), 'utf8'),
    cwd: realpathSync(mkdtempSync(join(tmpdir(), 'pe-universal-cwd-'))),
    env: { ...process.env },
  };
  delete ctx.env.CLAUDE_CODE_SESSION_ID;
  delete ctx.env.CLAUDE_CODE_REMOTE_SESSION_ID;

  mkdirSync(outDir, { recursive: true });
  let failures = 0;
  let cost = 0;
  run: for (const c of CASES) {
    let session;
    for (const [i, msg] of c.turns.entries()) {
      const res = turn(msg, session, ctx);
      session = res.session_id;
      cost += res.total_cost_usd ?? 0;
      writeFileSync(join(outDir, `${c.name}.turn${i + 1}.md`), `> ${msg}\n\n${res.result}\n`);
      if (res.leaks.length) {
        // Every later turn would load the same tools or servers: stop instead of paying for them.
        failures++;
        console.log(`FAIL  ${c.name} turn ${i + 1}: tools or MCP servers loaded: ${res.leaks.join(', ')}; stopping`);
        break run;
      }
      console.log(`PASS  ${c.name} turn ${i + 1}: no tools or MCP servers loaded (${res.model})`);
      for (const [label, ok] of c.checks[i] ?? []) {
        const pass = ok(res.result ?? '');
        if (!pass) failures++;
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name} turn ${i + 1}: ${label}`);
      }
    }
  }
  console.log(`\noutputs in ${outDir}\ntotal cost $${cost.toFixed(2)}; ${failures} failed check(s)`);
  process.exit(failures ? 1 : 0);
}

// Run only as the entry point, so the test can import the checks without starting billed
// runs. Node 22.18+ and 24.2+ set import.meta.main. Older Node doesn't, so there: never
// under -e or -p, where process.argv[1] is the first extra argument rather than this file,
// and otherwise compare real paths, so a path with spaces or through a symlink still counts.
export function isEntryPoint({ isMain, execArgv, argv1, self }) {
  if (typeof isMain === 'boolean') return isMain;
  if (execArgv.some((a) => /^(-e|-p|-pe|--eval|--print)(=|$)/.test(a))) return false;
  try { return realpathSync(self) === realpathSync(argv1); } catch { return false; }
}
if (isEntryPoint({ isMain: import.meta.main, execArgv: process.execArgv, argv1: process.argv[1], self: fileURLToPath(import.meta.url) })) main();
