// Tests for the eval lint graders that scripts/build.mjs generates from data/lint-rules.json (D36):
// which rules each case gets, how the files read as claude plugin eval reads them, which parts
// of a reply the patterns check, and how long they take.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { LINT_GRADER_CASES, buildAll, inFencedBlock, normalize, renderLintGraders } from '../build.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rules = JSON.parse(readFileSync(join(repo, 'data/lint-rules.json'), 'utf8')).rules;
const FILES = ['lint-prompt.md', 'lint-prompt-i.md'];

// The front matter as claude plugin eval 2.1.319 reads a grader file (seen in its code): from
// the "---" on the first line to the next "---" anywhere, parsed as YAML. These files use only
// comment lines, bare words and single-quoted strings, in which '' stands for '.
function frontMatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)---\s*\n?/);
  assert.ok(m, 'no front matter');
  const data = {};
  for (const line of m[1].split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const kv = line.match(/^(\w+): (?:'((?:[^']|'')*)'|([\w-]+))$/);
    assert.ok(kv, `unexpected front matter line: ${line}`);
    data[kv[1]] = kv[2] !== undefined ? kv[2].replace(/''/g, "'") : kv[3];
  }
  return data;
}
// As the runner applies a regex grader: new RegExp(pattern, flags) on the reply. Both graders
// are not_contains, so a reply passes when the pattern doesn't match it.
function grader(text) {
  const { type, pattern, flags = '', match, weight, ...rest } = frontMatter(text);
  assert.deepEqual([type, match, weight, rest], ['regex', 'not_contains', '1', {}]);
  return new RegExp(pattern, flags);
}
const passes = (text, reply) => !grader(text).test(reply);
const byId = Object.fromEntries(rules.map((r) => [r.id, r]));
const holds = (text, id) => frontMatter(text).pattern.includes(`(?:${byId[id].pattern})`);

// A reply in the skill's output format, with a pressure word in the commentary.
const reply = (prompt, extra = '') => `Made a prompt.\n\n### Full prompt\n\`\`\`text\n${prompt}\n\`\`\`\n\n### Short version\n\`\`\`text\nShort.\n\`\`\`\n\n### What I added & why\n- **Plain wording** [best practice]: no pressure words such as IMPORTANT.${extra}\n\n### What next?\n1. Run it now ★\n2. Refine\n3. Save to file`;
// A prompt that holds a code block, wrapped in four backticks as references/output-format.md asks.
const nested = (inner, after) => reply('x').replace('```text\nx\n```', `\`\`\`\`text\nBefore.\n\`\`\`json\n${inner}\n\`\`\`\n${after}\n\`\`\`\``);

test('every listed case gets the two graders, each current, and no other case gets one', () => {
  const out = buildAll();
  const expected = Object.keys(LINT_GRADER_CASES).flatMap((c) => FILES.map((f) => `evals/${c}/graders/${f}`));
  assert.deepEqual(Object.keys(out).filter((p) => p.includes('/graders/')).sort(), expected.sort());
  for (const p of expected) assert.equal(normalize(readFileSync(join(repo, p), 'utf8')), out[p], `${p} is stale`);
});

test('rules split by flags; open-placeholder never; vague-quality-words only for media; skips honored', () => {
  const plain = renderLintGraders(rules);
  const media = renderLintGraders(rules, { media: true });
  assert.deepEqual(Object.keys(plain).sort(), [...FILES].sort());
  assert.equal(frontMatter(plain['lint-prompt.md']).flags, undefined);
  assert.equal(frontMatter(plain['lint-prompt-i.md']).flags, 'i');
  for (const id of ['pressure-words', 'template-leftover']) assert.ok(holds(plain['lint-prompt.md'], id), id);
  for (const id of ['visible-reasoning-request', 'magic-phrase', 'prefill-instruction']) assert.ok(holds(plain['lint-prompt-i.md'], id), id);
  assert.match(plain['lint-prompt.md'], /^# Fails when a fenced block of the reply matches: pressure-words, template-leftover\.$/m);
  assert.ok(!holds(plain['lint-prompt-i.md'], 'vague-quality-words'));
  assert.ok(holds(media['lint-prompt-i.md'], 'vague-quality-words'));
  for (const t of [...Object.values(plain), ...Object.values(media)]) assert.ok(!t.includes('open-placeholder') && !holds(t, 'open-placeholder'));
  const skipped = renderLintGraders(rules, { skip: ['template-leftover'] })['lint-prompt.md'];
  assert.ok(holds(skipped, 'pressure-words') && !holds(skipped, 'template-leftover'));
  assert.throws(() => renderLintGraders([{ id: 'x', pattern: 'x', flags: 'u' }]), /^Error: data\/lint-rules\.json x: flags "u" have no generated eval grader; add one to LINT_FILES in scripts\/build\.mjs$/);
});

test('refuses a grader the eval runner would misread or could not compile, and a skip of a missing rule', () => {
  assert.throws(() => renderLintGraders([{ id: 'hr', pattern: '^---$', flags: '' }]), /data\/lint-rules\.json hr: a generated eval grader can't hold "---" or a line break/);
  assert.throws(() => renderLintGraders([{ id: 'nl', pattern: 'a\nb', flags: '' }]), /data\/lint-rules\.json nl: a generated eval grader can't hold "---" or a line break/);
  // The pattern compiles alone, but its group name clashes with the wrapper's.
  assert.throws(() => renderLintGraders([{ id: 'g', pattern: '(?<f>x)', flags: '' }]), /data\/lint-rules\.json g: the generated eval grader doesn't compile/);
  assert.throws(() => renderLintGraders(rules, { skip: ['no-such-rule'] }), /LINT_GRADER_CASES in scripts\/build\.mjs skips no-such-rule, which data\/lint-rules\.json doesn't have/);
  // check_prompt matches one line at a time, so an anchor works there; in a grader it would match
  // only at the start or end of the whole reply.
  for (const pattern of ['^IMPORTANT', '(System|Assistant):$', 'a(?=$)']) {
    assert.throws(() => renderLintGraders([{ id: 'anchored', pattern, flags: '' }]), /data\/lint-rules\.json anchored: a generated eval grader can't carry \^ or \$/, pattern);
  }
  // Escaped, or inside a character class, they are ordinary characters.
  for (const pattern of ['[^{}\\n]{0,80}', '\\$\\{', '[$^]x']) assert.doesNotThrow(() => renderLintGraders([{ id: 'plain', pattern, flags: '' }]), pattern);
});

test('an anchored rule would miss a line of a fenced block, which is why the build refuses one', () => {
  const anchored = new RegExp(inFencedBlock('^IMPORTANT'));
  assert.ok(!anchored.test(reply('IMPORTANT: cite a source.')), 'the grader would pass a reply that check_prompt flags');
});

test('a single quote in a rule survives YAML quoting', () => {
  const t = renderLintGraders([{ id: 'q', pattern: "don't", flags: '' }])['lint-prompt.md'];
  assert.match(t, /^pattern: '.*don''t.*'$/m);
  assert.ok(!passes(t, reply("Please don't stop.")));
});

test('the graders check only fenced blocks: the full prompt, the short version and any later block', () => {
  const [plain, i] = FILES.map((f) => renderLintGraders(rules, { media: true })[f]);
  const iText = renderLintGraders(rules)['lint-prompt-i.md'];
  assert.ok(passes(plain, reply('Write a launch email.')) && passes(i, reply('Write a launch email.')), 'clean reply');
  assert.ok(!passes(plain, reply('IMPORTANT: cite a source.')), 'pressure word in the full prompt');
  assert.ok(passes(plain, reply('You must cite a source.')), 'lowercase "must"');
  assert.ok(!passes(plain, reply('Address it to {{team_name}}.')), 'template leftover');
  assert.ok(!passes(i, reply('Think step by step.')), 'reasoning request');
  assert.ok(!passes(i, reply('Photorealistic, 8k.')), 'quality tag in an image or video case');
  assert.ok(passes(iText, reply('Photorealistic, 8k.')), 'quality tag in another case');
  assert.ok(passes(plain, reply('Write a launch email.', '\n- IMPORTANT caveat [best practice]: dates.')), 'same word in the commentary');
  assert.ok(passes(plain, reply('Write a launch email.').replace('### Short version', 'IMPORTANT, between the blocks.\n\n### Short version')), 'same word between the blocks');
  assert.ok(!passes(plain, reply('Write a launch email.').replace('Short.', 'Short. ALWAYS cite.')), 'short version');
  const fourth = reply('Prompt.').replace('### Short version', '### Negative prompt\n```text\ntext\n```\n\n### Settings\n```text\n16:9\n```\n\n### Short version').replace('Short.', 'Short, IMPORTANT.');
  assert.ok(!passes(plain, fourth), 'fourth fenced block');
  assert.ok(passes(plain, nested('{"a": 1}', 'After.')), 'clean four-backtick fence with an inner block');
  assert.ok(!passes(plain, nested('{"a": "IMPORTANT"}', 'After.')), 'inside the inner block of a four-backtick fence');
  assert.ok(!passes(plain, nested('{"a": 1}', 'IMPORTANT: after the inner block.')), 'after the inner block of a four-backtick fence');
  assert.ok(passes(plain, 'A few questions (★ = recommended):\n\n1. IMPORTANT question?\n   a) yes ★  b) no'), 'a question round has no fence');
});

test('secret-redaction-quick leaves template-leftover out, for ${{ secrets.NAME }} in GitHub Actions', () => {
  const out = buildAll();
  const gha = reply('In the workflow, pass the key as env: OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}');
  assert.ok(passes(out['evals/secret-redaction-quick/graders/lint-prompt.md'], gha));
  assert.ok(!passes(out['evals/research-quick-vector-databases/graders/lint-prompt.md'], gha), 'another case still checks it');
});

test('checking a reply takes linear time, however many four-backtick blocks it has', () => {
  // When an opening fence could give back backticks, the time doubled with each such block (7 s
  // for 24 of these in Node). The timeout turns a slow pattern into a failure instead of a hang.
  const texts = ['````text\nPrompt.\n```json\n{"a": 1}\n```\nMore.\n````\n\nCommentary.\n\n'.repeat(40), '`'.repeat(50_000)];
  for (const t of Object.values(renderLintGraders(rules, { media: true }))) {
    const { pattern, flags = '' } = frontMatter(t);
    for (const s of texts) assert.equal(vm.runInNewContext('new RegExp(p, f).test(s)', { p: pattern, f: flags, s }, { timeout: 2_000 }), false);
  }
});
