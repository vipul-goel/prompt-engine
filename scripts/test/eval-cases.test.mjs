// Tests for scripts/eval-cases.mjs: the YAML subset (each form it reads, and each way it refuses
// a line, naming file:line), the front matter cut, and checks that are cheaper to test on a small
// tree than through validate.mjs. scripts/test/validate.test.mjs has a mutation row for each of
// the module's error messages on a copy of the repository.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseYaml, frontmatter, checkEvalCases, checkSuiteRules, checkConversations } from '../eval-cases.mjs';

// ---------- the YAML subset ----------
const READS = [
  ['comments, blank lines and plain text', '# a comment\n\nname: spanish-quick\ndescription: a b#c # note\n', { name: 'spanish-quick', description: 'a b#c' }],
  ['numbers, booleans and null', 'a: 16\nb: -3\nc: 0.5\nd: true\ne: false\nf: null\ng: ~\nh:\n', { a: 16, b: -3, c: 0.5, d: true, e: false, f: null, g: null, h: null }],
  ['text that only starts like a number or has a colon inside', 'a: 3 sentences\nb: count:3\nc: http://x.y/z\nd: -x\n', { a: '3 sentences', b: 'count:3', c: 'http://x.y/z', d: '-x' }],
  ['single-quoted values', "a: 'it''s # not a comment'\nb: '' # empty\n", { a: "it's # not a comment", b: '' }],
  ['double-quoted values with each supported escape', 'a: "q\\" b\\\\ s\\/ n\\n t\\t r\\r z\\0 x\\x41 u\\u00e9"\n', { a: 'q" b\\ s/ n\n t\t r\r z\0 xA u\u{e9}' }],
  ['flow lists and mappings', "a: [Read, 'x, y', \"z\", 1, true]\nb: {tool: Write, input_match: '\"x\"'}\nc: []\nd: {}\ne: [a, b,]\n",
    { a: ['Read', 'x, y', 'z', 1, true], b: { tool: 'Write', input_match: '"x"' }, c: [], d: {}, e: ['a', 'b'] }],
  ['a nested mapping and a nested list', 'context:\n  # a comment\n  history_file: history.jsonl\n  add_dirs:\ntags:\n  - a\n  - 2\n',
    { context: { history_file: 'history.jsonl', add_dirs: null }, tags: ['a', 2] }],
  ['a comment after a key with no value', 'focus: # a file\n  source: file\n  path: out.md\n', { focus: { source: 'file', path: 'out.md' } }],
  ['literal blocks and chomping', 'a: |\n  x\n\n    y\n  z\n\n\nb: |-\n  x\nc: |+\n  x\n\nd: | # note\n\n  # text\ne: |\nf: 1\n',
    { a: 'x\n\n  y\nz\n', b: 'x', c: 'x\n\n', d: '\n# text\n', e: '', f: 1 }],
  ['folded blocks', 'a: >\n  x\n  y\n\n  z\nb: >-\n  x  y\n  z\nc: >\n\n  x\n\n\n  y\n', { a: 'x y\nz\n', b: 'x  y z', c: '\nx\n\ny\n' }],
  ['a block under a nested key', 'execution:\n  prompt: |\n    hi\n  max_turns: 4\n', { execution: { prompt: 'hi\n', max_turns: 4 } }],
  ['CRLF line endings and a BOM', '\u{FEFF}a: 1\r\nb: |\r\n  x\r\n', { a: 1, b: 'x\n' }],
  // YAML separates with spaces only, so other white space at a value's edge is part of the value.
  ['a no-break space after a value and an ideographic space before one', 'a: x\u{A0}\nb: \u{3000}x\nc: [y\u{A0}, z]\nd: {e: f\u{A0}}\n',
    { a: 'x\u{A0}', b: '\u{3000}x', c: ['y\u{A0}', 'z'], d: { e: 'f\u{A0}' } }],
  ['a kept block with only blank lines, and one that ends the text', 'a: |+\n\n\nb: 1\nc: |+\n  x\n', { a: '\n\n', b: 1, c: 'x\n' }],
  ['a kept block whose last line of spaces ends with a line break', 'a: |+\n  x\n \n', { a: 'x\n\n' }],
];
for (const [name, text, want] of READS) {
  test(`parseYaml reads ${name}`, () => assert.deepEqual(parseYaml(text, 'f.yaml'), want));
}

test('parseYaml makes __proto__ an own key, not the prototype', () => {
  const data = parseYaml('__proto__: x\nconstructor: z\n', 'f.yaml');
  assert.deepEqual(Object.keys(data), ['__proto__', 'constructor']);
  assert.equal(Object.getPrototypeOf(data), Object.prototype);
});

// [name, text, message]: the message must name the file and line.
const REFUSES = [
  ['a tab', 'a: 1\n\tb: 2\n', 'f.yaml:2: a tab; indent with spaces'],
  ['a tab inside a quoted value', 'a: "x\ty"\n', 'f.yaml:1: a tab'],
  ['a control character', 'a: 1\nb: x\u{7}y\n', 'f.yaml:2: control character U+0007'],
  ['a lone carriage return', 'a: x\ry: z\n', 'f.yaml:1: control character U+000D'],
  ['a line separator', 'a: x\u{2028}y\n', 'f.yaml:1: control character U+2028'],
  ['a control character inside a block', 'a: |\n  x\u{85}\n', 'f.yaml:2: control character U+0085'],
  ['four spaces of indentation', 'a:\n    b: 1\n', 'f.yaml:2: unsupported indentation'],
  ['one space of indentation', 'a:\n b: 1\n', 'f.yaml:2: unsupported indentation'],
  ['a third level', 'a:\n  b:\n    c: 1\n', 'f.yaml:3: unsupported indentation'],
  ['an indented line under a key with a value', 'a: x\n  b: 1\n', 'f.yaml:2: unsupported indentation'],
  ['a list at the start of a line', 'a:\n- x\n', 'f.yaml:2: unsupported line: - x'],
  ['a key without a space after the colon', 'a:1\n', 'f.yaml:1: unsupported line: a:1'],
  ['a quoted key', '"a": 1\n', 'f.yaml:1: unsupported line: "a": 1'],
  ['a document marker', '---\na: 1\n', 'f.yaml:1: unsupported line: ---'],
  ['a key YAML 1.1 reads as a boolean', 'on: 1\n', 'f.yaml:1: YAML parsers read the key on as a boolean or null'],
  ['a duplicate key', 'a: 1\nb: 2\na: 3\n', 'f.yaml:3: duplicate key a'],
  ['a duplicate nested key', 'a:\n  b: 1\n  b: 2\n', 'f.yaml:3: duplicate key b'],
  ['a duplicate key in a flow mapping', 'a: {b: 1, b: 2}\n', 'f.yaml:1: duplicate key b'],
  ['a list entry among keys', 'a:\n  b: 1\n  - x\n', 'f.yaml:3: a list entry among the keys of a'],
  ['a key among list entries', 'a:\n  - x\n  b: 1\n', 'f.yaml:3: a key among the list entries of a'],
  ['a mapping in a list', 'a:\n  - b: 1\n', 'f.yaml:2: quote the value "b: 1"'],
  ['a block whose first lines have more spaces than its text', 'a: |\n     \n  x\n', 'f.yaml:1: a blank line before the block\'s first line has more spaces'],
  // YAML reads the spaces past the block's indentation as text.
  ['a block whose last lines have more spaces than its text', 'a: |\n  x\n    \nb: 1\n', 'f.yaml:1: a line of spaces after the block\'s last line has more spaces than its first line'],
  ['a nested block whose last lines have more spaces than its text', 'execution:\n  prompt: |-\n    x\n       \n  max_turns: 4\n', 'f.yaml:2: a line of spaces after the block\'s last line'],
  ['a block line indented less than the first', 'a: |\n    x\n  y\n', 'f.yaml:1: a line of the block is indented less than its first line'],
  // Without a line break, a last line of only spaces isn't a line to YAML: Bun.YAML (which claude
  // plugin eval uses), js-yaml and yaml read each of these blocks as "x\n", and this subset read
  // "x\n\n".
  ['a kept block that ends in a line of only spaces without a line break', 'a: |+\n  x\n ', 'f.yaml:3: a line of only spaces at the end of the file, without a line break'],
  ['a kept folded block that ends in a line of only spaces without a line break', 'a: >+\n  x\n  ', 'f.yaml:3: a line of only spaces at the end of the file, without a line break'],
  ['a nested kept block that ends in a line of only spaces without a line break', 'execution:\n  prompt: |+\n    x\n  ', 'f.yaml:4: a line of only spaces at the end of the file, without a line break'],
  ['a more-indented line in a folded block', 'a: >\n  x\n    y\n', 'f.yaml:1: a more-indented line in a > block'],
  ['a block with an indentation indicator', 'a: |2\n  x\n', 'f.yaml:1: unsupported YAML value |2'],
  ['a comment right after a block header', 'a: |#c\n  x\n', 'f.yaml:1: unsupported YAML value |#c'],
  ['an unterminated single-quoted value', "a: 'x\n", 'f.yaml:1: a single-quoted value must end on its line'],
  ['text after a single-quoted value', "a: 'x' y\n", 'f.yaml:1: a single-quoted value must end on its line'],
  ['a comment right after a quoted value', 'a: "x"#c\n', 'f.yaml:1: a double-quoted value must end on its line'],
  ['a no-break space after a quoted value', "a: 'x'\u{A0}\n", 'f.yaml:1: a single-quoted value must end on its line'],
  ['a no-break space after a block header', 'a: |\u{A0}\n  x\n', 'f.yaml:1: unsupported YAML value |\u{A0}'],
  ['the escape \\b', 'a: "\\bveo"\n', 'f.yaml:1: unsupported escape \\b'],
  ['the escape \\x without two hex digits', 'a: "\\xZ"\n', 'f.yaml:1: unsupported escape \\x'],
  ['the escape \\u for a surrogate half', 'a: "\\uD83D"\n', 'f.yaml:1: unsupported escape \\uD83D (a surrogate half)'],
  ['a nested flow', 'a: [x, [y]]\n', 'f.yaml:1: nested [ ] or { } isn\'t supported'],
  ['a comment inside a flow', 'a: [x #c]\n', 'f.yaml:1: a # comment inside [ ]'],
  ['an unclosed flow', 'a: [x, y\n', 'f.yaml:1: [ without its closing ] on the same line'],
  ['text after a flow', 'a: [x] y\n', 'f.yaml:1: text after the closing ]'],
  ['an empty flow entry', 'a: [x,,y]\n', 'f.yaml:1: an empty entry in [ ]'],
  ['a flow mapping entry without a value', 'a: {b}\n', 'f.yaml:1: write each { } entry as key: value: b'],
  ['a flow mapping entry without a space after its colon', 'a: {b:c}\n', 'f.yaml:1: write each { } entry as key: value: b:c'],
  ['an anchor', 'a: &x 1\n', 'f.yaml:1: unsupported YAML value &x 1'],
  ['a tag', 'a: !!str 1\n', 'f.yaml:1: unsupported YAML value !!str 1'],
  ['a value with ": " inside', 'a: b: c\n', 'f.yaml:1: quote the value "b: c"'],
  ['a value ending in a colon', 'a: b:\n', 'f.yaml:1: quote the value "b:"'],
  ['a value starting with "- "', 'a: - x\n', 'f.yaml:1: quote the value "- x"'],
  ['a value Psych reads as a symbol', 'a: :x\n', 'f.yaml:1: quote the value ":x"'],
  ...['True', 'yes', 'y', 'NULL', '+1', '012', '0x1F', '1e3', '.5', '.', '1_000', '1:30', '2026-11-07', '.inf'].map((v) => [`the plain value ${v}`, `a: ${v}\n`, `f.yaml:1: quote the value "${v}" (YAML parsers read it as a number, boolean, null or date`]),
  // Values that only one entry of NOT_TEXT reads: a date with a time, a number the yaml package
  // reads in YAML 1.1 mode, and YAML 1.1's merge and value keys.
  ...['2026-11-07T10:00:00Z', '2026-11-07 10:00', 'e1', 'E-2', '<<', '='].map((v) => [`the plain value ${v}`, `a: ${v}\n`, `f.yaml:1: quote the value "${v}" (YAML parsers read it as a number, boolean, null or date`]),
  ...['\u{FFFE}', '\u{FFFF}'].map((c) => [`the noncharacter U+${c.codePointAt(0).toString(16).toUpperCase()}`, `a: x${c}y\n`, `f.yaml:1: control character U+${c.codePointAt(0).toString(16).toUpperCase()}`]),
];
for (const [name, text, message] of REFUSES) {
  test(`parseYaml refuses ${name}`, () => assert.throws(() => parseYaml(text, 'f.yaml'), (e) => e.message.startsWith(message) || assert.fail(`got: ${e.message}`)));
}

test('parseYaml counts lines from firstLine', () => {
  assert.throws(() => parseYaml('a: 1\nb: c: d\n', 'g.md', 5), { message: 'g.md:6: quote the value "c: d"' });
});

// ---------- front matter ----------
test('frontmatter returns null data for a file without it, and the body trimmed', () => {
  assert.deepEqual(frontmatter('\nhello\n\n', 'p.md'), { data: null, body: 'hello' });
  assert.deepEqual(frontmatter('# notes\n---\n', 'p.md'), { data: null, body: '# notes\n---' });
});

test('frontmatter reads the block after a BOM and CRLF, and trims the body', () => {
  assert.deepEqual(frontmatter('\u{FEFF}---\r\ntype: llm\r\nweight: 1\r\n---\r\n\r\nPASS if fine.\r\n', 'g.md'), { data: { type: 'llm', weight: 1 }, body: 'PASS if fine.' });
  assert.deepEqual(frontmatter('---\n---\nbody\n', 'g.md'), { data: {}, body: 'body' });
});

test('frontmatter ends at the first "---", as claude plugin eval does', () => {
  // On the closing line, text after "---" starts the body.
  assert.deepEqual(frontmatter('---\ntype: llm\n---more\n', 'g.md'), { data: { type: 'llm' }, body: 'more' });
  assert.throws(() => frontmatter("---\npattern: 'a---b'\n---\n", 'g.md'), { message: 'g.md: "---" inside the front matter, where claude plugin eval ends it; keep "---" out of values and comments' });
  assert.throws(() => frontmatter('---\n# see --- below\ntype: llm\n---\n', 'g.md'), /g\.md: "---" inside the front matter/);
  assert.throws(() => frontmatter('---\ntype: llm\n', 'g.md'), { message: 'g.md: front matter without its closing "---"' });
});

test('frontmatter names the file line of a YAML error', () => {
  assert.throws(() => frontmatter('---\ntype: regex\npattern: "\\b"\n---\n', 'g.md'), /^Error: g\.md:3: unsupported escape \\b/);
  assert.throws(() => frontmatter('---\n\n\ntype: regex\nflags: True\n---\n', 'g.md'), /^Error: g\.md:5: quote the value "True"/);
});

// ---------- checkEvalCases on small trees ----------
const PROMPT = 'Improve my prompt.\n';
const REGEX = "---\ntype: regex\npattern: 'x'\n---\n";

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-evalcases-'));
  try {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), text);
    }
  } catch (e) {
    // A tree that can't be written leaves no folder behind.
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}
function check(files, prepare = () => {}) {
  const dir = tree(files);
  try {
    prepare(dir);
    const errors = [];
    const cases = checkEvalCases(dir, (m) => errors.push(m));
    return { errors, cases };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('tree() removes its folder when a file can\'t be written', () => {
  const t = mkdtempSync(join(tmpdir(), 'pe-leak-'));
  const saved = Object.fromEntries(['TMPDIR', 'TEMP', 'TMP'].map((k) => [k, process.env[k]]));
  try {
    Object.assign(process.env, { TMPDIR: t, TEMP: t, TMP: t });
    // "a" is a file, so the folder that a/b needs can't be made.
    assert.throws(() => tree({ a: 'x', 'a/b': 'y' }));
    assert.deepEqual(readdirSync(t), []);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(t, { recursive: true, force: true });
  }
});
const hasGit = spawnSync('git', ['--version']).status === 0;
const git = (dir, ...args) => assert.equal(spawnSync('git', args, { cwd: dir }).status, 0, `git ${args.join(' ')}`);

test('checkEvalCases returns each case with what it read', () => {
  const { errors, cases } = check({
    'evals/demo/case.yaml': 'schema_version: "1.1"\nname: demo\nexpected_outcome: |\n  Works.\n',
    'evals/demo/prompt.md': `---\ntags: [a]\n---\n\n${PROMPT}`,
    'evals/demo/graders/01-x.md': REGEX,
    'evals/demo/graders/02-judge.md': '---\ntype: llm\n---\n\nPASS if fine.\n',
    'evals/demo/graders/notes.txt': 'not a grader\n',
    'evals/.DS_Store': 'x',
    'evals/results/run/out.json': '{}',
  });
  assert.deepEqual(errors, ['evals/demo/graders/notes.txt: claude plugin eval reads only the files in graders/ whose names end in .md, so it skips this one']);
  assert.deepEqual(cases, [{
    name: 'demo', dir: 'evals/demo',
    caseYaml: { schema_version: '1.1', name: 'demo', expected_outcome: 'Works.\n' },
    prompt: { data: { tags: ['a'] }, body: 'Improve my prompt.' },
    graders: [
      { name: '01-x', file: 'evals/demo/graders/01-x.md', data: { type: 'regex', pattern: 'x' }, body: '' },
      { name: '02-judge', file: 'evals/demo/graders/02-judge.md', data: { type: 'llm' }, body: 'PASS if fine.' },
    ],
  }]);
});

test('checkEvalCases returns a case whose case.yaml does not parse, and still checks its graders', () => {
  const { errors, cases } = check({
    'evals/demo/case.yaml': 'name: demo\nname: again\n',
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-x.md': '---\ntype: regex\nweight: 0\npattern: x\n---\n',
  });
  assert.deepEqual(errors, ['evals/demo/case.yaml:2: duplicate key name', 'evals/demo/graders/01-x.md: weight must be a number above 0']);
  assert.equal(cases[0].caseYaml, null);
  assert.equal(cases[0].graders.length, 1);
});

test('checkEvalCases takes a pattern or criteria from the body, as the CLI does', () => {
  const { errors } = check({
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-x.md': '---\ntype: regex\n---\n\\bok\\b\n',
    'evals/demo/graders/02-y.md': '---\ntype: regex\n---\n([\n',
    'evals/demo/graders/03-z.md': '---\ntype: baseline\nbaseline_file: ref.jsonl\n---\nPASS if as good.\n',
    'evals/demo/ref.jsonl': '{}\n',
  });
  assert.deepEqual(errors.map((e) => e.replace(/: Invalid regular expression.*/, ': Invalid regular expression')), ['evals/demo/graders/02-y.md: pattern: Invalid regular expression']);
});

test('checkEvalCases reads an unset min as 1, as the CLI does', () => {
  const { errors } = check({
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-x.md': '---\ntype: tool_used\ntool: Write\nmax: 0\n---\n',
    'evals/demo/graders/02-y.md': '---\ntype: tool_used\ntool: Write\nmin: 0\nmax: 0\n---\n',
  });
  assert.deepEqual(errors, ['evals/demo/graders/01-x.md: min (1 when unset) is above max (0), so the grader never passes']);
});

// The CLI passes a tool_used grader when the matching calls number from min to max, and an unset
// max has no limit: with min: 0 and no max, every run passes it, a run without the skill included.
test('checkEvalCases refuses a tool_used grader that never fails: min: 0 without max', () => {
  const { errors } = check({
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-skill.md': '---\ntype: tool_used\ntool: Skill\nmin: 0\narm: both\n---\n',
    'evals/demo/graders/02-never.md': '---\ntype: tool_used\ntool: Write\nmin: 0\nmax: 0\n---\n',
    'evals/demo/graders/03-at-most-two.md': '---\ntype: tool_used\ntool: Write\nmin: 0\nmax: 2\n---\n',
    'evals/demo/graders/04-at-least-one.md': '---\ntype: tool_used\ntool: Skill\narm: both\n---\n',
  });
  assert.deepEqual(errors, ['evals/demo/graders/01-skill.md: min: 0 without max counts any number of calls, so the grader never fails; set max (max: 0 checks that the tool is never called), or drop min']);
});

test('checkEvalCases accepts an empty prompt.md body when case.yaml has execution.prompt, and a name set only in prompt.md', () => {
  const { errors } = check({
    'evals/demo/case.yaml': 'schema_version: "1.1"\nexecution:\n  prompt: Hi.\n',
    'evals/demo/prompt.md': '---\nname: demo\n---\n',
    'evals/demo/graders/01-x.md': REGEX,
  });
  assert.deepEqual(errors, []);
});

test('checkEvalCases refuses an add_dirs entry the CLI refuses: the case folder, graders/ or mocks/', () => {
  const { errors } = check({
    'evals/demo/case.yaml': "schema_version: '1.1'\nname: demo\ncontext:\n  add_dirs: [fixtures, '.', ./graders, mocks/x, ../other]\n",
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-x.md': REGEX,
    'evals/demo/fixtures/a.txt': 'a\n',
    'evals/demo/mocks/x/b.txt': 'b\n',
    'evals/other/prompt.md': PROMPT,
    'evals/other/graders/01-x.md': REGEX,
  });
  assert.deepEqual(errors, [
    ...['.', './graders', 'mocks/x', '../other'].map((d) => `evals/demo/case.yaml: add_dirs entry "${d}" is not a fixture folder in the case folder (one that isn't the case folder, graders/ or mocks/)`),
    'evals/demo/mocks: a case\'s own mocks aren\'t used in this repo, and validate.mjs doesn\'t check them (repo rule)',
  ]);
});

test('checkEvalCases refuses a fixture path that leaves the case folder on any platform', () => {
  // A plain file sits where joining each path to the case folder lands (<case>/tmp/ref.jsonl, and on
  // POSIX a file named C:\setup.sh, which Windows can't hold), so only the path rule can refuse
  // them: without the files, the plain-file check refused them whatever the path rule said.
  const { errors } = check({
    'evals/demo/case.yaml': 'schema_version: "1.1"\nname: demo\ncontext:\n  scaffold_script: C:\\setup.sh\n',
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-x.md': '---\ntype: baseline\nbaseline_file: /tmp/ref.jsonl\n---\nPASS if as good.\n',
    'evals/demo/tmp/ref.jsonl': '{}\n',
    ...(process.platform === 'win32' ? {} : { 'evals/demo/C:\\setup.sh': 'true\n' }),
  });
  assert.deepEqual(errors, [
    'evals/demo/case.yaml: context.scaffold_script "C:\\setup.sh" is not a plain file in the case folder',
    'evals/demo/graders/01-x.md: baseline_file "/tmp/ref.jsonl" is not a plain file in the case folder',
  ]);
});

test('checkEvalCases refuses a fixture that is a link or has a second name', { skip: process.platform === 'win32' && 'links need extra rights on Windows' }, () => {
  const { errors } = check({
    'evals/demo/case.yaml': 'schema_version: "1.1"\nname: demo\ncontext:\n  scaffold_script: setup.sh\n  history_file: history.jsonl\n',
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-x.md': REGEX,
    'evals/demo/real.sh': 'true\n',
    'evals/demo/real.jsonl': '{}\n',
  }, (dir) => {
    symlinkSync('real.sh', join(dir, 'evals/demo/setup.sh'));
    linkSync(join(dir, 'evals/demo/real.jsonl'), join(dir, 'evals/demo/history.jsonl'));
  });
  assert.deepEqual(errors, [
    'evals/demo/case.yaml: context.scaffold_script "setup.sh" is not a plain file in the case folder',
    'evals/demo/case.yaml: context.history_file "history.jsonl" is not a plain file in the case folder',
  ]);
});

test('checkEvalCases checks the form of each grader option, not only that it is there', () => {
  const { errors } = check({
    'evals/demo/prompt.md': PROMPT,
    // Accepted: a {tool, input_match} step, count:N, and a pattern that compiles with its flags.
    'evals/demo/graders/01-order.md': "---\ntype: tool_order\nbefore: {tool: Read, input_match: 'x'}\nafter: Write\n---\n",
    'evals/demo/graders/02-count.md': '---\ntype: regex\npattern: x\nmatch: count:3\n---\n',
    'evals/demo/graders/03-unicode.md': "---\ntype: regex\npattern: '\\p{L}'\nflags: u\n---\n",
    // Refused.
    'evals/demo/graders/04-order-extra-key.md': '---\ntype: tool_order\nbefore: {tool: Read, x: 1}\nafter: Write\n---\n',
    'evals/demo/graders/05-order-bad-match.md': "---\ntype: tool_order\nbefore:\n  tool: Read\n  input_match: '(['\nafter: Write\n---\n",
    'evals/demo/graders/06-order-no-after.md': '---\ntype: tool_order\nbefore: Read\n---\n',
    'evals/demo/graders/07-order-empty.md': "---\ntype: tool_order\nbefore: ''\nafter: Write\n---\n",
    // Compiles without a flag, but not with u: the flags count.
    'evals/demo/graders/08-flags-matter.md': "---\ntype: regex\npattern: 'a{'\nflags: u\n---\n",
    'evals/demo/graders/09-weight-string.md': "---\ntype: regex\npattern: x\nweight: '2'\n---\n",
    'evals/demo/graders/10-flags-list.md': '---\ntype: regex\npattern: x\nflags: []\n---\n',
    // The CLI fills a pattern from the body only when the key is missing, not when it is null.
    'evals/demo/graders/11-null-pattern.md': '---\ntype: regex\npattern: ~\n---\nx\n',
    'evals/demo/graders/12-focus-absolute.md': '---\ntype: llm\nfocus: {source: file, path: /abs}\n---\nPASS.\n',
    'evals/demo/graders/13-focus-extra-key.md': '---\ntype: llm\nfocus: {source: file, path: a, x: 1}\n---\nPASS.\n',
    'evals/demo/graders/14-focus-source.md': '---\ntype: llm\nfocus: {source: url, path: a}\n---\nPASS.\n',
  });
  const focus = 'focus must be trace, last_message, files, mock_calls or {source: file, path: <a relative path>}';
  assert.deepEqual(errors.map((e) => e.replace(/: Invalid regular expression.*/, ': Invalid regular expression')), [
    'evals/demo/graders/04-order-extra-key.md: before must be a tool name or {tool, input_match}',
    'evals/demo/graders/05-order-bad-match.md: before.input_match: Invalid regular expression',
    'evals/demo/graders/06-order-no-after.md: after must be a tool name or {tool, input_match}',
    'evals/demo/graders/07-order-empty.md: before must be a tool name or {tool, input_match}',
    'evals/demo/graders/08-flags-matter.md: pattern: Invalid regular expression',
    'evals/demo/graders/09-weight-string.md: weight must be a number above 0',
    'evals/demo/graders/10-flags-list.md: flags may use only d g i m s u v y',
    'evals/demo/graders/11-null-pattern.md: needs a pattern (the pattern key, or the file\'s body)',
    `evals/demo/graders/12-focus-absolute.md: ${focus}`,
    `evals/demo/graders/13-focus-extra-key.md: ${focus}`,
    `evals/demo/graders/14-focus-source.md: ${focus}`,
  ]);
});

test('checkEvalCases wants count: followed by a number in a regex grader\'s match', () => {
  const { errors } = check({
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-count.md': '---\ntype: regex\npattern: x\nmatch: count:12\n---\n',
    'evals/demo/graders/02-count-word.md': '---\ntype: regex\npattern: x\nmatch: count:x\n---\n',
  });
  assert.deepEqual(errors, ['evals/demo/graders/02-count-word.md: match must be contains, not_contains or count:N']);
});

test('checkEvalCases refuses a grader type that is not a string, as claude plugin eval does', () => {
  // A one-entry list looked up as an object key reads as its one string, so its options passed
  // unchecked; the CLI refuses a type that isn't a string when it loads the case.
  const { errors } = check({
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-ok.md': REGEX,
    'evals/demo/graders/02-list.md': "---\ntype: [regex]\npattern: '('\nflags: zz\nmatch: sometimes\ntarget: nowhere\n---\n",
    'evals/demo/graders/03-list-no-tool.md': '---\ntype: [tool_used]\n---\n',
    'evals/demo/graders/04-quoted-list.md': '---\ntype: ["llm"]\n---\nPASS.\n',
  });
  const types = 'type must be one of regex, tool_used, tool_order, file_exists, llm, baseline';
  assert.deepEqual(errors, ['02-list', '03-list-no-tool', '04-quoted-list'].map((n) => `evals/demo/graders/${n}.md: ${types}`));
});

test('checkEvalCases checks case values at the edges of the CLI\'s limits', () => {
  const at = (name, front) => ({ [`evals/${name}/prompt.md`]: `---\n${front}---\n\n${PROMPT}`, [`evals/${name}/graders/01-x.md`]: REGEX });
  const { errors } = check({
    ...at('runs-50', 'runs: 50\n'), ...at('runs-51', 'runs: 51\n'), ...at('runs-half', 'runs: 1.5\n'),
    ...at('turns-1', 'max_turns: 1\n'), ...at('turns-0', 'max_turns: 0\n'),
    ...at('timeout-3600', 'timeout_seconds: 3600\n'), ...at('timeout-3601', 'timeout_seconds: 3601\n'),
    ...at('env-lowercase', 'env: {EVAL_x: a}\n'),
    ...at('tags-number', 'tags: [1]\n'),
    ...at('schema-in-prompt', "schema_version: '2.0'\n"),
    'evals/schema-in-case/case.yaml': "schema_version: '2.0'\nname: schema-in-case\n",
    ...at('schema-in-case', ''),
  });
  assert.deepEqual(errors, [
    'evals/env-lowercase/prompt.md: env key "EVAL_x" must match EVAL_[A-Z0-9_]* (other keys fail the run)',
    'evals/runs-51/prompt.md: runs must be a whole number from 1 to 50',
    'evals/runs-half/prompt.md: runs must be a whole number from 1 to 50',
    'evals/schema-in-case/case.yaml: schema_version must be a quoted 1.x string, such as "1.1"',
    'evals/schema-in-prompt/prompt.md: schema_version must be a quoted 1.x string, such as "1.1"',
    'evals/tags-number/prompt.md: tags must be a list of strings, such as [a, b]',
    'evals/timeout-3601/prompt.md: timeout_seconds must be a whole number from 1 to 3600',
    'evals/turns-0/prompt.md: max_turns must be a whole number from 1 to 200',
  ]);
});

test('checkEvalCases reports only the parse error of a file that does not parse', () => {
  // case.yaml might have set execution.prompt, so the empty body isn't reported; a grader that
  // doesn't parse still counts as the case's grader.
  const { errors } = check({
    'evals/demo/case.yaml': 'name: demo\nname: again\n',
    'evals/demo/prompt.md': '---\ntags: [a]\n---\n',
    'evals/demo/graders/01-x.md': REGEX,
    'evals/other/prompt.md': PROMPT,
    'evals/other/graders/01-x.md': '---\ntype: regex\npattern: "\\b"\n---\n',
  });
  assert.deepEqual(errors, ['evals/demo/case.yaml:2: duplicate key name', 'evals/other/graders/01-x.md:3: unsupported escape \\b; YAML reads it differently from a regex, so write \\\\ for a backslash']);
});

test('checkEvalCases reads a case.yaml with nothing but comments as no file, as claude plugin eval does', () => {
  const { errors, cases } = check({
    'evals/demo/case.yaml': '# kept for notes\n',
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-x.md': REGEX,
    // With no prompt.md, the case still needs a prompt.
    'evals/bare/case.yaml': '\n',
    'evals/bare/graders/01-x.md': REGEX,
  });
  assert.deepEqual(errors, ['evals/bare: no prompt (a prompt.md body, or execution.prompt in case.yaml)']);
  assert.deepEqual(cases.find((c) => c.name === 'demo').caseYaml, {});
});

// claude plugin eval looks for case.yaml, prompt.md and graders/ by those exact names, reads only the
// .md files directly in graders/, and layers a case's own mocks/ over the suite's (its code, read in
// 2.1.321). It skips anything else without a word, so each such entry is named, and so is a
// recording that no context.history_file names. A name that differs only in letter case is read on
// macOS and Windows and skipped on Linux.
test('checkEvalCases names the entries that claude plugin eval skips for their name or place', () => {
  const ASKED = 'schema_version: "1.1"\nname: NAME\nexecution:\n  prompt: Improve my prompt.\n';
  const asked = (name) => ASKED.replace('NAME', name);
  const { errors } = check({
    'evals/a-yml/case.yml': asked('a-yml'),
    'evals/a-yml/prompt.md': PROMPT,
    'evals/a-yml/graders/01-x.md': REGEX,
    'evals/b-case/Case.yaml': asked('b-case'),
    'evals/b-case/prompt.md': PROMPT,
    'evals/b-case/graders/01-x.md': REGEX,
    'evals/c-markdown/case.yaml': asked('c-markdown'),
    'evals/c-markdown/prompt.markdown': PROMPT,
    'evals/c-markdown/graders/01-x.md': REGEX,
    'evals/d-upper/case.yaml': asked('d-upper'),
    'evals/d-upper/PROMPT.MD': PROMPT,
    'evals/d-upper/graders/01-x.md': REGEX,
    'evals/e-graders/prompt.md': PROMPT,
    'evals/e-graders/graders/01-x.md': REGEX,
    'evals/e-graders/graders/02-y.MD': REGEX,
    'evals/e-graders/graders/03-z.markdown': REGEX,
    'evals/e-graders/graders/safety/04-w.md': REGEX,
    'evals/e-graders/graders/.DS_Store': 'x',
    'evals/f-grader/prompt.md': PROMPT,
    'evals/f-grader/graders/01-x.md': REGEX,
    'evals/f-grader/grader/02-y.md': REGEX,
    'evals/g-mocks/prompt.md': PROMPT,
    'evals/g-mocks/graders/01-x.md': REGEX,
    'evals/g-mocks/mocks/github/list_issues.md': '---\ntype: fixed\n---\n[]\n',
    'evals/h-orphan/prompt.md': PROMPT,
    'evals/h-orphan/graders/01-x.md': REGEX,
    'evals/h-orphan/history.jsonl': '{}\n',
    'evals/i-comments/case.yaml': '# notes only\n',
    'evals/i-comments/prompt.md': PROMPT,
    'evals/i-comments/graders/01-x.md': REGEX,
    'evals/i-comments/history.jsonl': '{}\n',
    // Named by context.history_file: resumed.
    'evals/j-resumed/case.yaml': 'schema_version: "1.1"\nname: j-resumed\ncontext:\n  history_file: history.jsonl\n',
    'evals/j-resumed/prompt.md': PROMPT,
    'evals/j-resumed/graders/01-x.md': REGEX,
    'evals/j-resumed/history.jsonl': '{}\n',
    // Other files in a case folder, such as fixtures, are not checked here.
    'evals/k-fixtures/prompt.md': PROMPT,
    'evals/k-fixtures/graders/01-x.md': REGEX,
    'evals/k-fixtures/notes.txt': 'x\n',
  });
  const skipped = (p, want) => `evals/${p}: claude plugin eval reads ${want}, not this name, so it skips this one; name it ${want}`;
  const letterCase = (p, want) => `evals/${p}: claude plugin eval looks for ${want} by that exact name, which only a file system that ignores letter case, such as macOS's or Windows', matches to this one; name it ${want}`;
  const orphan = (c) => `evals/${c}/history.jsonl: no context.history_file in case.yaml names it, so claude plugin eval doesn't resume it; set context.history_file: history.jsonl, or delete the file`;
  assert.deepEqual(errors, [
    skipped('a-yml/case.yml', 'case.yaml'),
    letterCase('b-case/Case.yaml', 'case.yaml'),
    skipped('c-markdown/prompt.markdown', 'prompt.md'),
    letterCase('d-upper/PROMPT.MD', 'prompt.md'),
    'evals/e-graders/graders/02-y.MD: claude plugin eval reads only the files in graders/ whose names end in .md, so it skips this one',
    'evals/e-graders/graders/03-z.markdown: claude plugin eval reads only the files in graders/ whose names end in .md, so it skips this one',
    'evals/e-graders/graders/safety: a folder; claude plugin eval reads only the .md files directly in graders/, so it skips the graders in it',
    skipped('f-grader/grader', 'graders'),
    'evals/g-mocks/mocks: a case\'s own mocks aren\'t used in this repo, and validate.mjs doesn\'t check them (repo rule)',
    orphan('h-orphan'),
    orphan('i-comments'),
  ]);
});

// The git check (finding 67): a fixture the case names that git ignores.
const IGNORED = '12345678-1234-4123-8123-123456789abc.jsonl';
const ignoredCase = (baseline) => ({
  '.gitignore': 'evals/**/????????-????-????-????-????????????.jsonl\n',
  'evals/demo/prompt.md': PROMPT,
  'evals/demo/graders/01-x.md': `---\ntype: baseline\nbaseline_file: ${baseline}\n---\nPASS if as good.\n`,
});

test('checkEvalCases reports a fixture that git ignores, once', { skip: !hasGit && 'needs git' }, () => {
  const files = { ...ignoredCase(IGNORED), 'evals/demo/graders/02-y.md': `---\ntype: baseline\nbaseline_file: ${IGNORED}\n---\nPASS if as good.\n`, [`evals/demo/${IGNORED}`]: '{}\n' };
  const { errors } = check(files, (dir) => git(dir, 'init', '-q'));
  assert.deepEqual(errors, [`evals/demo/${IGNORED}: ignored by .gitignore, so a clean checkout lacks it (git check-ignore -v evals/demo/${IGNORED} names the rule)`]);
});

test('checkEvalCases reports an ignored history_file and scaffold_script too', { skip: !hasGit && 'needs git' }, () => {
  const { errors } = check({
    '.gitignore': '*.jsonl\n*.sh\n',
    'evals/demo/case.yaml': 'schema_version: "1.1"\nname: demo\ncontext:\n  scaffold_script: setup.sh\n  history_file: history.jsonl\n',
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-x.md': REGEX,
    'evals/demo/setup.sh': 'true\n',
    'evals/demo/history.jsonl': '{}\n',
  }, (dir) => git(dir, 'init', '-q'));
  const ignored = (p) => `evals/demo/${p}: ignored by .gitignore, so a clean checkout lacks it (git check-ignore -v evals/demo/${p} names the rule)`;
  assert.deepEqual(errors, [ignored('setup.sh'), ignored('history.jsonl')]);
});

test('checkEvalCases asks git only about fixtures that exist', { skip: !hasGit && 'needs git' }, () => {
  // git check-ignore would list the missing path too, since it matches the pattern.
  const { errors } = check(ignoredCase(IGNORED), (dir) => git(dir, 'init', '-q'));
  assert.deepEqual(errors, [`evals/demo/graders/01-x.md: baseline_file "${IGNORED}" is not a plain file in the case folder`]);
});

test('checkEvalCases skips the git check when .git is not a repository (exit 128) or git is missing', () => {
  const files = { ...ignoredCase(IGNORED), [`evals/demo/${IGNORED}`]: '{}\n' };
  assert.deepEqual(check(files, (dir) => mkdirSync(join(dir, '.git'))).errors, []);
  const path = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.deepEqual(check(files, (dir) => mkdirSync(join(dir, '.git'))).errors, []);
  } finally {
    process.env.PATH = path;
  }
});

// With .git there, a skipped check says why, as validate.mjs's rules on tracked files do: a run
// that only skipped it passed as if it had run. Without .git, it is skipped quietly.
test('checkEvalCases warns when .git is there but git check-ignore fails or git is missing', () => {
  const files = { ...ignoredCase(IGNORED), [`evals/demo/${IGNORED}`]: '{}\n' };
  const warned = (prepare) => {
    const dir = tree(files);
    try {
      prepare(dir);
      const errors = [];
      const warnings = [];
      checkEvalCases(dir, (m) => errors.push(m), (m) => warnings.push(m));
      assert.deepEqual(errors, []);
      return warnings;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const SKIPPED = 'the check that .gitignore hides no file a case names (scaffold_script, history_file, baseline_file) was skipped: ';
  // An empty .git folder: git check-ignore stops with "fatal: not a git repository", exit 128.
  const [notRepo, ...more] = warned((dir) => mkdirSync(join(dir, '.git')));
  assert.deepEqual(more, []);
  assert.ok(notRepo?.startsWith(`${SKIPPED}git check-ignore failed: fatal: `), notRepo);
  const path = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.deepEqual(warned((dir) => mkdirSync(join(dir, '.git'))), [`${SKIPPED}git isn't on PATH`]);
  } finally {
    process.env.PATH = path;
  }
  assert.deepEqual(warned(() => {}), []);
});

// ---------- checkSuiteRules: this repo's rules for how the cases run and score ----------
const MODEL = 'claude-sonnet-5-5';
// prompt.md with the given front matter lines and a model line, none when model is null.
const promptMd = (front = '', model = MODEL) => `---\n${front}${model === null ? '' : `model: ${model}\n`}---\n\n${PROMPT}`;
const SKILL_CHECK = (extra = '') => `---\ntype: tool_used\ntool: Skill\n${extra}---\n`;
// checkEvalCases's errors (schema) and checkSuiteRules's (errors) on a small tree.
function rules(files) {
  const dir = tree(files);
  try {
    const schema = [];
    const errors = [];
    checkSuiteRules(dir, checkEvalCases(dir, (m) => schema.push(m)), (m) => errors.push(m));
    return { schema, errors };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('checkSuiteRules scores a trigger case\'s Skill grader in both arms', () => {
  const trigger = (name, grader) => ({ [`evals/${name}/prompt.md`]: promptMd('tags: [trigger]\n'), [`evals/${name}/graders/01-skill.md`]: grader });
  const { schema, errors } = rules({
    ...trigger('unset', SKILL_CHECK()),
    ...trigger('with-only', SKILL_CHECK('arm: with-only\n')),
    ...trigger('both', SKILL_CHECK('arm: both\n')),
    ...trigger('no-skill-grader', '---\ntype: llm\n---\n\nPASS if fine.\n'),
    'evals/smoke/prompt.md': promptMd('tags: [smoke]\n'),
    'evals/smoke/graders/01-skill.md': SKILL_CHECK(),
  });
  assert.deepEqual(schema, []);
  assert.deepEqual(errors, [
    'evals/no-skill-grader: a case tagged trigger needs a tool_used grader on Skill (repo rule)',
    'evals/unset/graders/01-skill.md: a trigger case\'s Skill grader needs arm: both; without it, two-arm runs leave it out of the score (repo rule)',
    'evals/with-only/graders/01-skill.md: a trigger case\'s Skill grader needs arm: both; without it, two-arm runs leave it out of the score (repo rule)',
  ]);
});

// D27's rule wants the grader on Skill: one on another tool, even with arm: both, doesn't count.
test('checkSuiteRules wants a trigger case\'s tool_used grader on Skill, not on another tool', () => {
  const { schema, errors } = rules({
    'evals/read-only/prompt.md': promptMd('tags: [trigger]\n'),
    'evals/read-only/graders/01-read.md': '---\ntype: tool_used\ntool: Read\narm: both\n---\n',
  });
  assert.deepEqual(schema, []);
  assert.deepEqual(errors, ['evals/read-only: a case tagged trigger needs a tool_used grader on Skill (repo rule)']);
});

test('checkSuiteRules reads tags as claude plugin eval does: prompt.md\'s, else case.yaml\'s', () => {
  const caseYaml = (name) => `schema_version: "1.1"\nname: ${name}\ntags: [trigger]\nexecution:\n  model: ${MODEL}\n`;
  const { schema, errors } = rules({
    'evals/from-case-yaml/case.yaml': caseYaml('from-case-yaml'),
    'evals/from-case-yaml/prompt.md': PROMPT,
    'evals/from-case-yaml/graders/01-skill.md': SKILL_CHECK(),
    'evals/overridden/case.yaml': caseYaml('overridden'),
    'evals/overridden/prompt.md': promptMd('tags: [smoke]\n'),
    'evals/overridden/graders/01-skill.md': SKILL_CHECK(),
  });
  assert.deepEqual(schema, []);
  assert.deepEqual(errors, ['evals/from-case-yaml/graders/01-skill.md: a trigger case\'s Skill grader needs arm: both; without it, two-arm runs leave it out of the score (repo rule)']);
});

test('checkSuiteRules skips a case with a file that did not read, and leaves an unknown arm to checkGrader', () => {
  const { schema, errors } = rules({
    // Unread, each case would break a rule: no Skill grader (the CLI skips a grader without front
    // matter), case.yaml's tags in place of prompt.md's, and a Skill grader without arm: both.
    'evals/no-front-matter/prompt.md': promptMd('tags: [trigger]\n'),
    'evals/no-front-matter/graders/01-skill.md': 'type: tool_used\ntool: Skill\n',
    'evals/bad-prompt/case.yaml': 'schema_version: "1.1"\nname: bad-prompt\ntags: [trigger]\n',
    'evals/bad-prompt/prompt.md': promptMd('tags: [smoke]\ntags: [smoke]\n'),
    'evals/bad-prompt/graders/01-skill.md': SKILL_CHECK(),
    'evals/bad-case-yaml/case.yaml': 'schema_version: "1.1"\nname: bad-case-yaml\nname: again\n',
    'evals/bad-case-yaml/prompt.md': promptMd('tags: [trigger]\n'),
    'evals/bad-case-yaml/graders/01-skill.md': SKILL_CHECK(),
    'evals/bad-arm/prompt.md': promptMd('tags: [trigger]\n'),
    'evals/bad-arm/graders/01-skill.md': SKILL_CHECK('arm: bogus\n'),
  });
  assert.deepEqual(schema, [
    'evals/bad-arm/graders/01-skill.md: arm must be with-only or both',
    'evals/bad-case-yaml/case.yaml:3: duplicate key name',
    'evals/bad-prompt/prompt.md:3: duplicate key tags',
    'evals/no-front-matter/graders/01-skill.md: no front matter at the top, so claude plugin eval skips this file',
    'evals/no-front-matter: needs at least one grader in graders/ with front matter',
  ]);
  assert.deepEqual(errors, []);
});

const REGEX_CASE = (name, prompt) => ({ [`evals/${name}/prompt.md`]: prompt, [`evals/${name}/graders/01-x.md`]: REGEX });
const SET_MODEL = (file) => `${file}: set model: to pin the agent under test; without it, the model comes from --model, ANTHROPIC_MODEL or Claude Code's default (repo rule)`;

test('checkSuiteRules requires a model in prompt.md, or under execution: in case.yaml', () => {
  const { schema, errors } = rules({
    ...REGEX_CASE('unset', promptMd('', null)),
    ...REGEX_CASE('empty', promptMd('', "''")),
    ...REGEX_CASE('not-a-string', promptMd('', '5')),
    ...REGEX_CASE('in-case-yaml', promptMd('', null)),
    'evals/in-case-yaml/case.yaml': `schema_version: "1.1"\nname: in-case-yaml\nexecution:\n  model: ${MODEL}\n`,
    'evals/case-yaml-only/case.yaml': 'schema_version: "1.1"\nname: case-yaml-only\nexecution:\n  prompt: Hi.\n',
    'evals/case-yaml-only/graders/01-x.md': REGEX,
  });
  assert.deepEqual(schema, ['evals/not-a-string/prompt.md: model must be a string']);
  assert.deepEqual(errors, [
    "evals/case-yaml-only/case.yaml: set execution.model to pin the agent under test; without it, the model comes from --model, ANTHROPIC_MODEL or Claude Code's default (repo rule)",
    SET_MODEL('evals/empty/prompt.md'),
    SET_MODEL('evals/unset/prompt.md'),
  ]);
});

test('checkSuiteRules wants one model across the cases, prompt.md\'s winning over case.yaml\'s', () => {
  const { schema, errors } = rules({
    ...REGEX_CASE('a', promptMd()),
    ...REGEX_CASE('b', promptMd()),
    ...REGEX_CASE('c', promptMd()),
    ...REGEX_CASE('overrides', promptMd()),
    'evals/overrides/case.yaml': 'schema_version: "1.1"\nname: overrides\nexecution:\n  model: claude-opus-5-5\n',
    ...REGEX_CASE('odd', promptMd('', 'claude-opus-5-5')),
  });
  assert.deepEqual(schema, []);
  assert.deepEqual(errors, ['evals: cases pin different models (claude-sonnet-5-5 in 4 cases; claude-opus-5-5 in odd); pin one agent model in every case (repo rule)']);
  // With one case on each model, both are named.
  assert.deepEqual(rules({ ...REGEX_CASE('x', promptMd('', 'm-2')), ...REGEX_CASE('y', promptMd('', 'm-1')) }).errors,
    ['evals: cases pin different models (m-1 in y; m-2 in x); pin one agent model in every case (repo rule)']);
});

test('checkSuiteRules compares a history case\'s assistant messages with the model it pins', () => {
  const row = (type, model) => JSON.stringify({ type, message: { role: type, model, content: 'x' } });
  const history = [
    row('user', 'claude-haiku-5-5'), // only assistant messages count
    row('assistant', MODEL),
    row('assistant', '<synthetic>'), // a message Claude Code wrote itself
    row('assistant', 'claude-opus-5-5'),
    'not JSON', // scripts/build.mjs fails on this line
    row('assistant', 'claude-opus-5-5'),
    '',
  ].join('\n');
  const historyCase = (name, caseYaml, prompt) => ({
    [`evals/${name}/case.yaml`]: `schema_version: "1.1"\nname: ${name}\n${caseYaml}context:\n  history_file: history.jsonl\n`,
    [`evals/${name}/history.jsonl`]: history,
    ...REGEX_CASE(name, prompt),
  });
  const { schema, errors } = rules({
    ...historyCase('pinned-in-prompt', '', promptMd()),
    ...historyCase('pinned-in-case-yaml', `execution:\n  model: ${MODEL}\n`, PROMPT),
  });
  assert.deepEqual(schema, []);
  assert.deepEqual(errors, [
    'evals/pinned-in-case-yaml/history.jsonl: recorded on claude-opus-5-5, but case.yaml pins claude-sonnet-5-5; record it again on claude-sonnet-5-5 (repo rule)',
    'evals/pinned-in-prompt/history.jsonl: recorded on claude-opus-5-5, but prompt.md pins claude-sonnet-5-5; record it again on claude-sonnet-5-5 (repo rule)',
  ]);
});

test('checkSuiteRules wants the needs-write tag on a case that needs --allow-tools or --scaffold', () => {
  const READ_ONLY = 'Read, Glob, Grep, NotebookRead, Skill, AskUserQuestion, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate, TaskStop';
  const { schema, errors } = rules({
    ...REGEX_CASE('read-only', promptMd(`allowed_tools: [${READ_ONLY}]\n`)),
    ...REGEX_CASE('pattern', promptMd("allowed_tools: [Read, 'Bash(ls *)', 'Read(/etc/hosts)']\n")),
    // A read-only tool with a rule needs no grant, except Read, Glob or Grep with a rule outside the
    // workspace (2.1.319's code).
    ...REGEX_CASE('read-only-rules', promptMd("allowed_tools: ['Skill(prompt-engine)', 'Read(./src/**)', 'Glob(src/*.ts)', 'TodoWrite(x)', 'Agent(/abs)']\n")),
    ...REGEX_CASE('outside-rules', promptMd("allowed_tools: ['Read(~/notes)', 'Grep(../x)', 'Glob(C:/x)', 'Read(\\x)', 'Write(./x)']\n")),
    ...REGEX_CASE('scaffold', promptMd()),
    'evals/scaffold/case.yaml': 'schema_version: "1.1"\nname: scaffold\ncontext:\n  scaffold_script: setup.sh\n',
    'evals/scaffold/setup.sh': 'true\n',
    ...REGEX_CASE('tagged', promptMd('tags: [needs-write]\nallowed_tools: [Write]\n')),
    'evals/tagged/case.yaml': 'schema_version: "1.1"\nname: tagged\ncontext:\n  scaffold_script: setup.sh\n',
    'evals/tagged/setup.sh': 'true\n',
  });
  assert.deepEqual(schema, []);
  assert.deepEqual(errors, [
    'evals/outside-rules: allowed_tools lists Read(~/notes), Grep(../x), Glob(C:/x), Read(\\x), Write(./x), which only --allow-tools grants; tag it needs-write (repo rule)',
    'evals/pattern: allowed_tools lists Bash(ls *), Read(/etc/hosts), which only --allow-tools grants; tag it needs-write (repo rule)',
    'evals/scaffold: context.scaffold_script runs only with --scaffold; tag it needs-write (repo rule)',
  ]);
});

test('checkSuiteRules backs a check that passes with zero calls with a tools-granted check', () => {
  const zero = (tool, extra = 'max: 0\n') => `---\ntype: tool_used\ntool: ${tool}\nmin: 0\n${extra}---\n`;
  const granted = (pattern, extra = '') => `---\ntype: regex\ntarget: trace\npattern: '${pattern}'\n${extra}---\n`;
  const WRITE = '"tools":\\[(?=[^\\]]*"Write")';
  const gatedCase = (name, graders, allowed = 'Write') => ({
    [`evals/${name}/prompt.md`]: promptMd(`tags: [needs-write]\nallowed_tools: [${allowed}]\n`),
    ...Object.fromEntries(Object.entries(graders).map(([f, text]) => [`evals/${name}/graders/${f}`, text])),
  });
  const { schema, errors } = rules({
    ...gatedCase('backed', { '01-no-writes.md': zero('Write'), '02-granted.md': granted(WRITE) }),
    ...gatedCase('pattern-in-body', { '01-no-writes.md': zero('Write'), '02-granted.md': `---\ntype: regex\ntarget: trace\n---\n${WRITE}\n` }),
    ...gatedCase('listed-with-a-pattern', { '01-no-bash.md': zero('Bash'), '02-granted.md': granted('"tools":\\[(?=[^\\]]*"Bash")') }, "'Bash(ls *)'"),
    ...gatedCase('min-one', { '01-writes.md': zero('Write', 'max: 1\n').replace('min: 0', 'min: 1') }),
    ...gatedCase('read-only-tool', { '01-no-skill.md': zero('Skill') }, 'Skill'),
    ...gatedCase('at-most-two', { '01-few-writes.md': zero('Write', 'max: 2\n') }),
    ...gatedCase('inverted', { '01-no-writes.md': zero('Write'), '02-granted.md': granted(WRITE, 'match: not_contains\n') }),
    ...gatedCase('with-only', { '01-no-writes.md': zero('Write'), '02-granted.md': granted(WRITE, 'arm: with-only\n') }),
    ...gatedCase('last-message', { '01-no-writes.md': zero('Write'), '02-granted.md': `---\ntype: regex\npattern: '${WRITE}'\n---\n` }),
    ...gatedCase('other-tool', { '01-no-writes.md': zero('Write'), '02-granted.md': granted('"tools":\\[(?=[^\\]]*"Edit")') }, 'Write, Edit'),
    ...gatedCase('unlisted', { '01-no-writes.md': zero('Write'), '02-granted.md': granted(WRITE) }, 'Edit'),
    // A trace pattern that names the tool but not the init line's tool list checks for a call.
    ...gatedCase('no-tool-list', { '01-no-writes.md': zero('Write'), '02-called.md': granted('"name":"Write"') }),
  });
  assert.deepEqual(schema, []);
  const unbacked = (c, f) => `evals/${c}/graders/${f}: with min: 0 this check passes when Write isn't granted, with zero calls; add a tools-granted regex grader (target: trace) that requires "Write" (repo rule)`;
  assert.deepEqual(errors, [
    unbacked('at-most-two', '01-few-writes.md'),
    unbacked('inverted', '01-no-writes.md'),
    unbacked('last-message', '01-no-writes.md'),
    unbacked('no-tool-list', '01-no-writes.md'),
    unbacked('other-tool', '01-no-writes.md'),
    'evals/unlisted/graders/01-no-writes.md: list Write in allowed_tools, so that the progress output names it as not granted when --allow-tools leaves it out (repo rule)',
    unbacked('with-only', '01-no-writes.md'),
  ]);
});

test('checkSuiteRules counts only a regex grader as a tools-granted check', () => {
  // The CLI refuses a target or pattern on another grader type; the schema check says so.
  const { schema, errors } = rules({
    'evals/not-regex/prompt.md': promptMd('tags: [needs-write]\nallowed_tools: [Write]\n'),
    'evals/not-regex/graders/01-no-writes.md': '---\ntype: tool_used\ntool: Write\nmin: 0\nmax: 0\n---\n',
    'evals/not-regex/graders/02-granted.md': `---\ntype: file_exists\npath: x\ntarget: trace\npattern: '"tools":\\[(?=[^\\]]*"Write")'\n---\n`,
  });
  assert.deepEqual(schema, ['evals/not-regex/graders/02-granted.md: key "target" is not a file_exists grader option', 'evals/not-regex/graders/02-granted.md: key "pattern" is not a file_exists grader option']);
  assert.deepEqual(errors, ['evals/not-regex/graders/01-no-writes.md: with min: 0 this check passes when Write isn\'t granted, with zero calls; add a tools-granted regex grader (target: trace) that requires "Write" (repo rule)']);
});

test('checkSuiteRules wants an llm no-invention grader in every output case, the cases build.mjs lints', () => {
  const JUDGE = '---\ntype: llm\n---\n\nPASS if nothing is invented.\n';
  const NEED = (name) => `evals/${name}: an output case (LINT_GRADER_CASES in scripts/build.mjs) needs an llm grader named <n>-no-invention.md, which checks that every name, number, date or URL the user didn't give is a placeholder or an assumption (repo rule)`;
  const output = (name, graders) => ({ [`evals/${name}/prompt.md`]: promptMd(), ...Object.fromEntries(Object.entries(graders).map(([f, t]) => [`evals/${name}/graders/${f}`, t])) });
  const { schema, errors } = rules({
    ...output('spanish-quick', { '01-x.md': REGEX, '02-no-invention.md': JUDGE }), // has one
    ...output('video-veo-quick', { '01-x.md': REGEX }), // has none
    ...output('image-midjourney-quick', { '08-no-invention.md': REGEX }), // a regex grader doesn't count
    ...output('research-quick-vector-databases', { '06-no-invention-check.md': JUDGE }), // the name must end in -no-invention
    ...output('demo', { '01-x.md': REGEX }), // not an output case
    'evals/writing-quick-launch-email/prompt.md': promptMd(), // unread: its grader has no front matter
    'evals/writing-quick-launch-email/graders/11-no-invention.md': 'type: llm\n',
  });
  assert.deepEqual(schema, [
    'evals/writing-quick-launch-email/graders/11-no-invention.md: no front matter at the top, so claude plugin eval skips this file',
    'evals/writing-quick-launch-email: needs at least one grader in graders/ with front matter',
  ]);
  assert.deepEqual(errors, [NEED('image-midjourney-quick'), NEED('research-quick-vector-databases'), NEED('video-veo-quick')]);
});

// ---------- checkConversations: the history cases ----------
const CONTRACT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'contract.json'), 'utf8'));
const REPLY_LINE = 'Reply `ok` to accept every ★, or answer like `2b 3: get managers to pilot a 4-day week`. Anything you skip gets the ★.';
const userRow = (content, extra = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const assistantRow = (content, stop = 'end_turn') => ({
  type: 'assistant',
  message: { id: 'msg_1', role: 'assistant', model: MODEL, content: typeof content === 'string' ? [{ type: 'text', text: content }] : content, stop_reason: stop },
});
const toolUse = (name, input) => ({ type: 'tool_use', id: `toolu_${name}`, name, input });
const toolResult = (text) => userRow([{ type: 'tool_result', tool_use_id: 'toolu_x', content: text }]);
// A history case on a small tree: the recording's rows (a string is written as it is), the reply
// in prompt.md and the graders.
const recordedCase = (name, recording, reply, graders) => ({
  [`evals/${name}/case.yaml`]: `schema_version: "1.1"\nname: ${name}\ncontext:\n  history_file: history.jsonl\n`,
  [`evals/${name}/history.jsonl`]: `${recording.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`,
  [`evals/${name}/prompt.md`]: `---\nmodel: ${MODEL}\n---\n\n${reply}\n`,
  ...Object.fromEntries(Object.entries(graders).map(([f, text]) => [`evals/${name}/graders/${f}`, text])),
});
const judge = (criteria) => `---\ntype: llm\n---\n\n${criteria}\n`;
const savedFile = (pattern, extra = '', path = 'out/notes.md') => `---\ntype: regex\ntarget:\n  source: file\n  path: ${path}\npattern: '${pattern}'\n${extra}---\n`;
// The errors of the three checks on a small tree.
function histories(files, contract = CONTRACT) {
  const dir = tree(files);
  try {
    const errors = [];
    const err = (m) => errors.push(m);
    const cases = checkEvalCases(dir, err);
    checkSuiteRules(dir, cases, err);
    checkConversations(dir, cases, { err, contract });
    return { errors };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const notPicked = (file, option, quote) => `evals/${file}: quotes option ${option} ("${quote}"), which is neither the ★ answer nor one the reply in prompt.md picks (repo rule)`;

test('checkConversations reads options on lines of their own, on one shared line and on the question\'s line', () => {
  const round = [
    'A few quick questions so the prompt fits what you need (★ = recommended):',
    '',
    '1. Who will read it?',
    '   a) Employees  b) Team managers ★ (they decide remote-work policy)  c) Job seekers',
    '**2.** How long should it be? a) About 600 words  b) About 1,200 words ★ (room for examples)  c) 2,000+ words',
    '### 3. What\'s the main goal?',
    '   a) Inform',
    '   b) Persuade ★ (managers need a reason to act)',
    '   c) Rank on Google',
    '',
    REPLY_LINE,
  ].join('\n');
  // "1: c" picks 1c and "3a" picks 3a; "12c" doesn't pick 2c.
  const { errors } = histories(recordedCase('demo', [userRow('write a post'), assistantRow(round)], '1: c 3a 12c', {
    '01-answers.md': judge('The answers are "Team managers", "Job seekers", "About 600 words", "Inform", "Rank on Google" and "2,000+ words". The round asked "How long should it be?" and gave the example "4-day week".'),
  }));
  assert.deepEqual(errors, [
    notPicked('demo/graders/01-answers.md', '2a', 'About 600 words'),
    notPicked('demo/graders/01-answers.md', '3c', 'Rank on Google'),
    notPicked('demo/graders/01-answers.md', '2c', '2,000+ words'),
  ]);
});

test('checkConversations looks quotes up in what the model wrote, what the user typed and the reply, in one form', () => {
  const round = `Questions (★ = recommended):\n\n1. Afterwards?\n   a) Come away with 3\u{2013}5 ideas they can **use** this week ★\n   b) Be informed\n2. Facts?\n   a) Use \`[[placeholders]]\`  where needed ★\n   b) Use real figures\n\n${REPLY_LINE}`;
  const recording = [
    userRow('Use prompt-engine on: write the **launch** notes \u{2014} fast'),
    assistantRow([toolUse('Skill', { skill: 'prompt-engine' })], 'tool_use'),
    toolResult('TOOL RESULT TEXT'),
    userRow([{ type: 'text', text: 'Base directory for this skill: /plugin/skills/prompt-engine\n\nSKILL TEXT' }], { isMeta: true }),
    assistantRow(round),
  ];
  const { errors } = histories(recordedCase('demo', recording, 'ok', {
    '01-quotes.md': judge('Quotes: \u{201C}come away with 3-5 ideas they can use   this week\u{201D}, "use [[placeholders]] where needed", "write the launch notes - fast", "ok", "SKILL TEXT", "TOOL RESULT TEXT" and \u{201C}said nowhere\u{201D}.'),
  }));
  const missing = (q) => `evals/demo/graders/01-quotes.md: quotes "${q}", which isn't in the recorded conversation or prompt.md; in a history case's rubric, double quotes mark verbatim text (repo rule)`;
  assert.deepEqual(errors, [missing('SKILL TEXT'), missing('TOOL RESULT TEXT'), missing('said nowhere')]);
});

test('checkConversations names recording lines as the file numbers them, and checks how the recording ends', () => {
  const recording = [
    userRow('write the notes'),
    '',
    'not JSON',
    assistantRow([toolUse('ToolSearch', { query: 'select:Read' })], 'tool_use'),
    toolResult('found'),
    assistantRow([toolUse('AskUserQuestion', { questions: [] })], 'tool_use'),
    toolResult('no such tool'),
    assistantRow([toolUse('ToolSearch', { query: 'select:AskUserQuestion', max_results: 1 })], 'tool_use'),
    toolResult('No matching deferred tools found'),
    assistantRow('Pick one by number:\n\n1. Run it now ★', 'tool_use'),
  ];
  const output = '### Full prompt\n```text\nWrite the notes.\n```\n\n### What next?\n1. Run it now ★';
  const { errors } = histories({
    ...recordedCase('cut', recording, 'ok', { '01-x.md': REGEX }),
    ...recordedCase('round', [userRow('write the notes'), assistantRow(`1. Who?\n   a) Me ★\n\n${REPLY_LINE}`)], 'ok', { '01-x.md': REGEX }),
    ...recordedCase('output', [userRow('write the notes'), assistantRow(output)], '3', { '01-x.md': REGEX }),
  });
  const searched = (n) => `evals/cut/history.jsonl: line ${n} calls AskUserQuestion or searches for it; eval runs have no dialog tool, and SKILL.md says to use the text format straight away, so record it again (repo rule)`;
  assert.deepEqual(errors, [
    searched(6),
    searched(8),
    `evals/cut/history.jsonl: the last recorded assistant text is neither a question round (with "${CONTRACT.required.replyLine[0]}") nor an output with its Full prompt and What next? headings in one message; record it again (repo rule)`,
    'evals/cut/history.jsonl: line 10, the last assistant row, has stop_reason tool_use, not end_turn, so the recorded turn didn\'t end; record it again (repo rule)',
  ]);
});

// The end of a recording, each part on its own: an output needs its What next? menu in the same
// message, and the last assistant row has to say that it ended its turn.
test('checkConversations wants a recorded output with its menu, in a last row that ended its turn', () => {
  const output = '### Full prompt\n```text\nWrite the notes.\n```\n\n### What next?\n1. Run it now \u{2605}';
  const noStop = assistantRow(output);
  delete noStop.message.stop_reason;
  const { errors } = histories({
    ...recordedCase('no-menu', [userRow('write the notes'), assistantRow('### Full prompt\n```text\nWrite the notes.\n```')], '1', { '01-x.md': REGEX }),
    ...recordedCase('no-stop', [userRow('write the notes'), noStop], '1', { '01-x.md': REGEX }),
    ...recordedCase('whole', [userRow('write the notes'), assistantRow(output)], '1', { '01-x.md': REGEX }),
  });
  assert.deepEqual(errors, [
    `evals/no-menu/history.jsonl: the last recorded assistant text is neither a question round (with "${CONTRACT.required.replyLine[0]}") nor an output with its Full prompt and What next? headings in one message; record it again (repo rule)`,
    'evals/no-stop/history.jsonl: line 2, the last assistant row, has stop_reason (none), not end_turn, so the recorded turn didn\'t end; record it again (repo rule)',
  ]);
});

// The grader's flags count: a case-insensitive pattern that matches the Full prompt only in
// another letter case is fine, and so is one that the Short version matches only without them.
test('checkConversations compares a saved-file regex with the recorded output under its own flags', () => {
  const output = ['### Full prompt', '```text', '# Goal', 'Write the notes.', '```', '', '### Short version', '```text', 'Notes, goal first.', '```',
    '', '### What next?', '1. Run it now \u{2605}', '3. Save to file: `out/notes.md`'].join('\n');
  const { errors } = histories(recordedCase('flags', [userRow('write the notes'), assistantRow(output)], '3', {
    '01-insensitive.md': savedFile('WRITE THE NOTES', 'flags: i\n'),
    '02-sensitive.md': savedFile('Goal'),
    '03-insensitive-short.md': savedFile('GOAL', 'flags: i\n'),
  }));
  assert.deepEqual(errors, ['evals/flags/graders/03-insensitive-short.md: pattern also matches the recorded Short version, so it can\'t tell the two apart (repo rule)']);
});

test('checkConversations checks regexes on the menu\'s save path against the recorded Full prompt, closed by a fence as long as its opener', () => {
  const output = [
    '### Full prompt', '````markdown', '# Goal', 'Write the notes.', '```text', 'an example block', '```', '# Output', 'Plain text.', '````',
    '', '### Short version', '```text', 'Write the notes quickly.', '```',
    '', '### What next?', '1. Run it now ★', '2. Refine: reply `deep` for more questions', '3. Save to file: `out/notes.md`',
  ].join('\n');
  const { errors } = histories({
    ...recordedCase('saved', [userRow('write the notes'), assistantRow(output)], '3', {
      '01-sections.md': savedFile('Goal[\\s\\S]*Output[\\s\\S]*Plain text'),
      '02-too-loose.md': savedFile('notes'),
      '03-not-the-reply.md': savedFile('example block', 'match: not_contains\n'),
      '04-count.md': savedFile('zzz', 'match: count:2\n'),
      '05-other-path.md': savedFile('zzz', '', 'out/other.md'),
    }),
    // The menu names no path in backticks.
    ...recordedCase('no-path', [userRow('write the notes'), assistantRow(output.replace(': `out/notes.md`', ''))], '3', { '01-sections.md': savedFile('Goal') }),
  });
  assert.deepEqual(errors, [
    'evals/no-path: 01-sections.md read a saved file, but the recording shows no output whose What next? menu names a save path to check them against (repo rule)',
    'evals/saved/graders/02-too-loose.md: pattern also matches the recorded Short version, so it can\'t tell the two apart (repo rule)',
    'evals/saved/graders/03-not-the-reply.md: not_contains pattern matches the recorded Full prompt, so a correct save would fail; derive it again from history.jsonl (repo rule)',
  ]);
});

test('checkConversations holds the request text that a rubric quotes to the case, word for word', () => {
  const request = 'Usa prompt-engine en modo r\u{E1}pido:\n\nescribe un post sobre mi trabajo';
  const { errors } = histories({
    'evals/quick/prompt.md': `---\nmodel: ${MODEL}\n---\n\n${request}\n`,
    // Only the text inside the quotes counts, not the gloss after it.
    'evals/quick/graders/01-gloss.md': judge('The user\'s whole request, in Spanish, was "escribe un post sobre mi trabajo" (write a post about my job), in quick mode.'),
    'evals/quick/graders/02-curly.md': judge('The user\u{2019}s whole request was \u{201C}escribe un post sobre mi nuevo trabajo\u{201D}.'),
    'evals/quick/graders/03-original.md': judge(`<original_prompt>\n${request}\n</original_prompt>\nPASS if its wording is kept.`),
    'evals/quick/graders/04-spaces.md': judge('<original_prompt>escribe un post sobre mi  trabajo</original_prompt>'),
    // In a history case, the request can be in the first recorded message. A misquote is reported
    // once, not again by the rule for quotes in history cases.
    ...recordedCase('followup', [userRow('Use prompt-engine on: write the launch notes'), assistantRow(`1. Who?\n   a) Me ★\n\n${REPLY_LINE}`)], 'ok', {
      '01-request.md': judge('The user\'s whole request was "write the launch notes", and they replied "ok". <original_prompt>write the launch notes</original_prompt>'),
      '02-misquoted.md': judge('The user\'s whole request was "write the release notes".'),
    }),
  });
  assert.deepEqual(errors, [
    'evals/followup/graders/02-misquoted.md: the quoted request "write the release notes" isn\'t in prompt.md or a recorded user message word for word (repo rule)',
    'evals/quick/graders/02-curly.md: the quoted request "escribe un post sobre mi nuevo trabajo" isn\'t in prompt.md word for word (repo rule)',
    'evals/quick/graders/04-spaces.md: the <original_prompt> text isn\'t in prompt.md word for word (repo rule)',
  ]);
});

test('checkConversations wants a quoted request to run to the end of the request', () => {
  const round = assistantRow(`1. Who?\n   a) Me ★\n\n${REPLY_LINE}`);
  const command = (args) => `<command-message>prompt-engine:prompt-engine</command-message>\n<command-name>/prompt-engine:prompt-engine</command-name>\n<command-args>${args}</command-args>`;
  const quick = (request) => `---\nmodel: ${MODEL}\n---\n\nUse prompt-engine in quick mode on this prompt:\n\n${request}\n`;
  // Passed: a quote that ends where the request ends, after a lead-in on its line, at the end of a
  // recorded message, or right before </command-args>.
  const fine = histories({
    'evals/lead-in/prompt.md': `---\nmodel: ${MODEL}\n---\n\nUse prompt-engine (quick mode) to write a Midjourney prompt: a cabin at night\n`,
    'evals/lead-in/graders/01-no-invention.md': judge('The user\'s whole request was "write a Midjourney prompt: a cabin at night", in quick mode.'),
    ...recordedCase('typed', [userRow('Use prompt-engine to improve this prompt:\nwrite a blog post about remote work\n'), round], 'ok', {
      '01-request.md': judge('The user\'s whole request was "write a blog post about remote work". <original_prompt>write a blog post about remote work</original_prompt>'),
    }),
    ...recordedCase('command', [userRow(command('quick: write the launch notes for v2')), round], 'ok', {
      '01-request.md': judge('The user\'s whole request was "write the launch notes for v2", and they replied "ok".'),
    }),
  });
  assert.deepEqual(fine.errors, []);
  // Reported: a request that goes on past the quote, which tells the judge it is shorter than it is.
  const { errors } = histories({
    'evals/quick/prompt.md': quick('write a launch email for my productivity app, 120 words, for existing users, with a 20% discount'),
    'evals/quick/graders/01-no-invention.md': judge('The user\'s whole request was "write a launch email for my productivity app", in quick mode. It gives no length, audience or discount.'),
    'evals/block/prompt.md': quick('Summarize the notes below in a table.\nKeep it under 200 words.'),
    'evals/block/graders/01-kept.md': judge('<original_prompt>\nSummarize the notes below in a table.\n</original_prompt>\nPASS if the wording is kept.'),
    ...recordedCase('followup', [userRow(command('quick: write the launch notes for v2, in French')), round], 'ok', {
      '01-request.md': judge('The user\'s whole request was "write the launch notes for v2", and they replied "ok".'),
    }),
  });
  const rest = 'but the request goes on after it; quote it to its end, word for word (repo rule)';
  assert.deepEqual(errors, [
    `evals/block/graders/01-kept.md: the <original_prompt> text is in prompt.md, ${rest}`,
    `evals/followup/graders/01-request.md: the quoted request "write the launch notes for v2" is in prompt.md or a recorded user message, ${rest}`,
    `evals/quick/graders/01-no-invention.md: the quoted request "write a launch email for my productivity app" is in prompt.md, ${rest}`,
  ]);
});

test('checkConversations reports a contract without what the history checks read, skips those checks, and still checks quoted requests', () => {
  const { errors } = histories({
    'evals/quick/prompt.md': `---\nmodel: ${MODEL}\n---\n\nwrite a post\n`,
    'evals/quick/graders/01-request.md': judge('The user\'s whole request was "write a long post".'),
    ...recordedCase('round', [userRow('write the notes'), assistantRow(`1. Who?\n   a) Me ★\n\n${REPLY_LINE}`)], 'ok', { '01-x.md': REGEX }),
  }, { required: { headings: ['Full prompt'], menu: [], replyLine: [] } });
  assert.deepEqual(errors, [
    'data/contract.json: required lacks the heading "Short version", the heading "What next?", the menu entry "Save to file", a replyLine, which the history checks in scripts/eval-cases.mjs look for; change the two together',
    'evals/quick/graders/01-request.md: the quoted request "write a long post" isn\'t in prompt.md word for word (repo rule)',
  ]);
});

test('checkConversations finds a search for the dialog tool in any letter case, also as separate words', () => {
  const recording = (query) => [userRow('write the notes'), assistantRow([toolUse('ToolSearch', { query })], 'tool_use'), toolResult('none'),
    assistantRow(`1. Who?\n   a) Me ★\n\n${REPLY_LINE}`)];
  const { errors } = histories({
    ...recordedCase('lowercase', recording('select:askuserquestion'), 'ok', { '01-x.md': REGEX }),
    ...recordedCase('words', recording('ask user question dialog'), 'ok', { '01-x.md': REGEX }),
    ...recordedCase('title-case', recording('Ask User Question tool'), 'ok', { '01-x.md': REGEX }),
    ...recordedCase('other-tool', recording('select:Read'), 'ok', { '01-x.md': REGEX }),
  });
  const searched = (c) => `evals/${c}/history.jsonl: line 2 calls AskUserQuestion or searches for it; eval runs have no dialog tool, and SKILL.md says to use the text format straight away, so record it again (repo rule)`;
  assert.deepEqual(errors, [searched('lowercase'), searched('title-case'), searched('words')]);
});

test('checkConversations takes the save path that looks like a file, and compares paths in one form', () => {
  const output = (menu) => ['### Full prompt', '```text', 'Write the notes.', '```', '', '### Short version', '```text', 'Notes.', '```', '', '### What next?', '1. Run it now ★', menu].join('\n');
  const { errors } = histories({
    // A reply keyword in backticks before the path.
    ...recordedCase('keyword-first', [userRow('write the notes'), assistantRow(output('3. Save to file: reply `3` to save it to `out/notes.md`'))], '3', {
      '01-saved.md': savedFile('zzz'),
    }),
    // The grader spells the same path another way.
    ...recordedCase('spelled', [userRow('write the notes'), assistantRow(output('3. Save to file: `out/notes.md`'))], '3', {
      '01-dot-slash.md': savedFile('zzz', '', './out/notes.md'),
      '02-double-slash.md': savedFile('zzz', '', 'out//notes.md'),
    }),
  });
  const unmatched = (f) => `evals/${f}: pattern doesn't match the recorded Full prompt, so a correct save would fail; derive it again from history.jsonl (repo rule)`;
  assert.deepEqual(errors, [unmatched('keyword-first/graders/01-saved.md'), unmatched('spelled/graders/01-dot-slash.md'), unmatched('spelled/graders/02-double-slash.md')]);
});

test('checkConversations checks a scaffold case\'s saved-file regexes on the save path with -2 added, not on the menu\'s path', () => {
  const output = (save) => ['### Full prompt', '```text', 'Write the notes.', '```', '', '### Short version', '```text', 'Notes.', '```', '', '### What next?', '1. Run it now ★', save].join('\n');
  // A case whose scaffold_script can put a file at the save path first, so a save writes the -2 file.
  const scaffolded = (name, save, graders) => ({
    ...recordedCase(name, [userRow('write the notes'), assistantRow(output(save))], '3', graders),
    [`evals/${name}/case.yaml`]: `schema_version: "1.1"\nname: ${name}\ncontext:\n  history_file: history.jsonl\n  scaffold_script: setup.sh\n`,
    [`evals/${name}/prompt.md`]: `---\ntags: [needs-write]\nmodel: ${MODEL}\n---\n\n3\n`,
    [`evals/${name}/setup.sh`]: 'true\n',
  });
  const { errors } = histories({
    ...scaffolded('existing', '3. Save to file: `out/notes.md`', {
      // The scaffold's own text at the menu's path, which the save must keep: not checked.
      '01-original-kept.md': savedFile('^ORIGINAL$'),
      '02-second.md': savedFile('zzz', '', 'out/notes-2.md'),
      '03-second-spelled.md': savedFile('otes', '', './out/notes-2.md'),
    }),
    // A save path without an extension takes -2 at its end.
    ...scaffolded('no-extension', '3. Save to file: `out/notes`', { '01-second.md': savedFile('zzz', '', 'out/notes-2') }),
    // The file graders of a scaffold case can read the scaffold's own files, so a recording with
    // no save path is fine.
    ...scaffolded('no-path', '3. Save to file', { '01-workspace.md': savedFile('zzz', '', 'src/app.js') }),
  });
  assert.deepEqual(errors, [
    'evals/existing/graders/02-second.md: pattern doesn\'t match the recorded Full prompt, so a correct save would fail; derive it again from history.jsonl (repo rule)',
    'evals/existing/graders/03-second-spelled.md: pattern also matches the recorded Short version, so it can\'t tell the two apart (repo rule)',
    'evals/no-extension/graders/01-second.md: pattern doesn\'t match the recorded Full prompt, so a correct save would fail; derive it again from history.jsonl (repo rule)',
  ]);
});

test('checkConversations reports a request marker that it cannot read, instead of skipping it', () => {
  const { errors } = histories({
    'evals/quick/prompt.md': `---\nmodel: ${MODEL}\n---\n\nwrite a launch email\n`,
    'evals/quick/graders/01-next-line.md': judge('The user\'s whole request was:\n"write a launch email"'),
    'evals/quick/graders/02-two-lines.md': judge('The user\'s whole request was "write a\nlaunch email".'),
    'evals/quick/graders/03-unclosed.md': judge('<original_prompt>\nwrite a launch email\n</original-prompt>'),
    'evals/quick/graders/04-empty.md': judge('<original_prompt></original_prompt>'),
    'evals/quick/graders/05-fine.md': judge('The user\'s whole request was "write a launch email". <original_prompt>write a launch email</original_prompt>'),
  });
  const tag = (f) => `evals/quick/graders/${f}: an <original_prompt> tag without its closing tag, or an empty block, which validate.mjs can't check (repo rule)`;
  const mark = (f) => `evals/quick/graders/${f}: "The user's whole request" isn't followed by the request in quotes on the same line, which validate.mjs can't check (repo rule)`;
  assert.deepEqual(errors, [mark('01-next-line.md'), mark('02-two-lines.md'), tag('03-unclosed.md'), tag('04-empty.md')]);
});

// Word for word means in the request's own letter case and spacing too, unlike the looser
// comparison of the quotes from a recording.
test('checkConversations compares a quoted request with the case\'s in letter case and spacing', () => {
  const { errors } = histories({
    'evals/quick/prompt.md': `---\nmodel: ${MODEL}\n---\n\nwrite a launch email for my productivity app\n`,
    'evals/quick/graders/01-case.md': judge('The user\'s whole request was "Write a launch email for my productivity app".'),
    'evals/quick/graders/02-spacing.md': judge('The user\'s whole request was "write a launch  email for my productivity app".'),
  });
  assert.deepEqual(errors, [
    'evals/quick/graders/01-case.md: the quoted request "Write a launch email for my productivity app" isn\'t in prompt.md word for word (repo rule)',
    'evals/quick/graders/02-spacing.md: the quoted request "write a launch  email for my productivity app" isn\'t in prompt.md word for word (repo rule)',
  ]);
});

test('checkConversations reads the request markers in any letter case, and wants a quoted request to start a word', () => {
  const request = 'escribe un post de LinkedIn sobre mi nuevo trabajo';
  const { errors } = histories({
    'evals/quick/prompt.md': `---\nmodel: ${MODEL}\n---\n\nUsa prompt-engine en modo r\u{E1}pido:\n\n${request}\n`,
    // The phrase and the tags in other letter cases are read, not skipped.
    'evals/quick/graders/01-lowercase.md': judge('In quick mode, the user\'s whole request, in Spanish, was "escribe un post de LinkedIn sobre mi trabajo nuevo".'),
    'evals/quick/graders/02-tag-case.md': judge('<Original_Prompt>\nSomething the user never wrote.\n</Original_Prompt>\nPASS if its wording is kept.'),
    'evals/quick/graders/03-tag-unclosed.md': judge(`<ORIGINAL_PROMPT>\n${request}\n`),
    // The request in guillemets, then a double-quoted phrase that ends the request: the marker
    // can't be read, rather than the phrase taken for the request.
    'evals/quick/graders/04-guillemets.md': judge('The user\'s whole request was \u{AB}escribe un post de LinkedIn sobre mi trabajo nuevo\u{BB}, a "nuevo trabajo" post.'),
    // Quotes that run to the end of the request but start inside a word.
    'evals/quick/graders/05-mid-word.md': judge('The user\'s whole request was "ribe un post de LinkedIn sobre mi nuevo trabajo".'),
    'evals/quick/graders/06-mid-word-block.md': judge('<original_prompt>\nost de LinkedIn sobre mi nuevo trabajo\n</original_prompt>'),
    // Fine: the request from the start of a word, after a lead-in, with the markers in other cases.
    'evals/quick/graders/07-fine.md': judge(`the user\u{2019}s whole request, in Spanish, was "${request}". <ORIGINAL_PROMPT>${request}</ORIGINAL_PROMPT>`),
  });
  const midWord = 'is in prompt.md, but starts inside a word there; quote the request from the start of a word, word for word (repo rule)';
  assert.deepEqual(errors, [
    'evals/quick/graders/01-lowercase.md: the quoted request "escribe un post de LinkedIn sobre mi trabajo nuevo" isn\'t in prompt.md word for word (repo rule)',
    'evals/quick/graders/02-tag-case.md: the <original_prompt> text isn\'t in prompt.md word for word (repo rule)',
    'evals/quick/graders/03-tag-unclosed.md: an <original_prompt> tag without its closing tag, or an empty block, which validate.mjs can\'t check (repo rule)',
    'evals/quick/graders/04-guillemets.md: "The user\'s whole request" isn\'t followed by the request in quotes on the same line, which validate.mjs can\'t check (repo rule)',
    `evals/quick/graders/05-mid-word.md: the quoted request "ribe un post de LinkedIn sobre mi nuevo trabajo" ${midWord}`,
    `evals/quick/graders/06-mid-word-block.md: the <original_prompt> text ${midWord}`,
  ]);
});

test('checkConversations lets a rubric quote what the user typed, even where an option says the same', () => {
  const round = `1. What angle?\n   a) Balanced ★\n   b) Argue for remote work\n\n${REPLY_LINE}`;
  const { errors } = histories(recordedCase('topic', [userRow('write a blog post about remote work'), assistantRow(round)], 'ok', {
    '01-topic.md': judge('The post stays on the user\'s topic, "remote work".'),
    '02-angle.md': judge('It doesn\'t "Argue for remote work".'),
  }));
  assert.deepEqual(errors, [notPicked('topic/graders/02-angle.md', '1b', 'Argue for remote work')]);
});

test('checkConversations wants a rubric that judges the answers of the round the recording ends in to quote one', () => {
  const round = [
    'A few questions (★ = recommended):',
    '',
    '1. Who will read it?',
    '   a) Employees',
    '   b) Team managers ★ (they decide remote-work policy)',
    '2. How long? a) About 600 words · b) About 1,200 words. ★ (room for examples) · c) 2,000+ words',
    '',
    REPLY_LINE,
  ].join('\n');
  const recording = [userRow('write a post about remote work'), assistantRow(round)];
  const quotesNone = (f) => `evals/${f}: judges the answers to the question round the recording ends in, but quotes none of its options; quote each answer it checks word for word, in double quotes (repo rule)`;
  const { errors } = histories({
    ...recordedCase('round', recording, 'ok', {
      '01-quoted.md': judge('The user replied "ok", which accepts these answers: "Team managers" and "About 1,200 words".'),
      // Curly quotes, code marks and case don't matter, nor does the period after option 2b's answer;
      // the ★ alone marks an answer check.
      '02-star.md': judge('The prompt follows each ★: \u{201C}team **managers**\u{201D} and "About 1,200 words."'),
      '03-paraphrased.md': judge('The user replied "ok", which accepts every recommended answer: managers, about 1,200 words.'),
      '04-unquoted.md': judge('PASS if the prompt uses every answer the user accepted.'),
      // A part of an option isn't its answer.
      '05-partial.md': judge('The answers include "1,200 words".'),
      // A rubric that doesn't judge the answers needs no quote.
      '06-topic.md': judge('The post stays on the user\'s topic, "remote work".'),
      // Option 2b's answer without the period that ends it in the round.
      '07-period.md': judge('The answer "About 1,200 words" is used.'),
      // Other words for the answers, without "answer" or the ★: a recommended option, what the user
      // accepted.
      '08-recommended-option.md': judge('The user replied "ok", which accepts every recommended option of the round. PASS if the prompt reflects each one.'),
      '09-accepted.md': judge('PASS if the prompt reflects every default the user accepted.'),
      '10-options.md': judge('PASS if the prompt follows the options the user kept.'),
      // A rubric about the round's questions, not its answers, needs no quote either.
      '11-no-more-questions.md': judge('The reply asks no further questions.'),
      // The \u{2605} alone marks an answer check, so a rubric about it quotes an answer too.
      '12-star-unquoted.md': judge('PASS if the prompt follows each \u{2605}.'),
    }),
    // A recording that ends in an output: the answers were used already.
    ...recordedCase('output', [...recording, userRow('ok'), assistantRow('### Full prompt\n```text\nWrite the post.\n```\n\n### What next?\n1. Run it now ★')], 'Run it now', {
      '01-unquoted.md': judge('PASS if the prompt uses every answer the user accepted.'),
    }),
  });
  assert.deepEqual(errors, [
    quotesNone('round/graders/03-paraphrased.md'), quotesNone('round/graders/04-unquoted.md'), quotesNone('round/graders/05-partial.md'),
    quotesNone('round/graders/08-recommended-option.md'), quotesNone('round/graders/09-accepted.md'), quotesNone('round/graders/10-options.md'),
    quotesNone('round/graders/12-star-unquoted.md'),
  ]);
});

// The module's patterns take time in step with the text they read. Each input here took quadratic
// time on one long run of a character: the flow reader's checks of the entry so far, for each # and
// each quote (about 10 seconds at 400,000 characters), and the trailing punctuation that answerKey
// drops, in an option and in a rubric's quote (more than a minute at 200,000). Each must finish in
// under 2 seconds, which leaves room for a busy machine.
const RUN = 200_000;
const roundWith = (option) => `1. Who will read it?\n   a) ${option} ★ (they decide)\n   b) Employees\n\n${REPLY_LINE}`;
const FAST = [
  ['a flow entry with a run of #', () => parseYaml(`tags: [a${'#'.repeat(2 * RUN)}]\n`, 'f.yaml')],
  ['a flow entry with a run of quotes', () => parseYaml(`tags: [a${"'".repeat(2 * RUN)}]\n`, 'f.yaml')],
  ['an option with a run of dots inside it', () => histories(recordedCase('dots', [userRow('write a post'), assistantRow(roundWith(`Managers${'.'.repeat(RUN)}x`))], 'ok', {
    '01-answers.md': judge('The answer "Employees" is used.'),
  }))],
  ['a rubric quote with a run of dots inside it', () => histories(recordedCase('dots', [userRow('write a post'), assistantRow(roundWith('Managers'))], 'ok', {
    '01-answers.md': judge(`The answer "Managers${'.'.repeat(RUN)}x" is used.`),
  }))],
];
for (const [name, fn] of FAST) {
  test(`eval-cases.mjs finishes fast on ${name}`, () => {
    const t0 = performance.now();
    fn();
    assert.ok(performance.now() - t0 < 2_000, `${Math.round(performance.now() - t0)} ms`);
  });
}
