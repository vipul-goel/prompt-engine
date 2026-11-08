// Tests for scripts/eval-cases.mjs: the YAML subset (each form it reads, and each way it refuses
// a line, naming file:line), the front matter cut, and checks that are cheaper to test on a small
// tree than through validate.mjs. scripts/test/validate.test.mjs has a mutation row for each of
// the module's error messages on a copy of the repository.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  ['a block line indented less than the first', 'a: |\n    x\n  y\n', 'f.yaml:1: a line of the block is indented less than its first line'],
  ['a more-indented line in a folded block', 'a: >\n  x\n    y\n', 'f.yaml:1: a more-indented line in a > block'],
  ['a block with an indentation indicator', 'a: |2\n  x\n', 'f.yaml:1: unsupported YAML value |2'],
  ['a comment right after a block header', 'a: |#c\n  x\n', 'f.yaml:1: unsupported YAML value |#c'],
  ['an unterminated single-quoted value', "a: 'x\n", 'f.yaml:1: a single-quoted value must end on its line'],
  ['text after a single-quoted value', "a: 'x' y\n", 'f.yaml:1: a single-quoted value must end on its line'],
  ['a comment right after a quoted value', 'a: "x"#c\n', 'f.yaml:1: a double-quoted value must end on its line'],
  ['the escape \\b', 'a: "\\bveo"\n', 'f.yaml:1: unsupported escape \\b'],
  ['the escape \\x without two hex digits', 'a: "\\xZ"\n', 'f.yaml:1: unsupported escape \\x'],
  ['the escape \\u for a surrogate half', 'a: "\\uD83D"\n', 'f.yaml:1: unsupported escape \\uD83D (a surrogate half)'],
  ['a nested flow', 'a: [x, [y]]\n', 'f.yaml:1: nested [ ] or { } isn\'t supported'],
  ['a comment inside a flow', 'a: [x #c]\n', 'f.yaml:1: a # comment inside [ ]'],
  ['an unclosed flow', 'a: [x, y\n', 'f.yaml:1: [ without its closing ] on the same line'],
  ['text after a flow', 'a: [x] y\n', 'f.yaml:1: text after the closing ]'],
  ['an empty flow entry', 'a: [x,,y]\n', 'f.yaml:1: an empty entry in [ ]'],
  ['a flow mapping entry without a value', 'a: {b}\n', 'f.yaml:1: write each { } entry as key: value: b'],
  ['an anchor', 'a: &x 1\n', 'f.yaml:1: unsupported YAML value &x 1'],
  ['a tag', 'a: !!str 1\n', 'f.yaml:1: unsupported YAML value !!str 1'],
  ['a value with ": " inside', 'a: b: c\n', 'f.yaml:1: quote the value "b: c"'],
  ['a value ending in a colon', 'a: b:\n', 'f.yaml:1: quote the value "b:"'],
  ['a value starting with "- "', 'a: - x\n', 'f.yaml:1: quote the value "- x"'],
  ['a value Psych reads as a symbol', 'a: :x\n', 'f.yaml:1: quote the value ":x"'],
  ...['True', 'yes', 'y', 'NULL', '+1', '012', '0x1F', '1e3', '.5', '.', '1_000', '1:30', '2026-11-07', '.inf'].map((v) => [`the plain value ${v}`, `a: ${v}\n`, `f.yaml:1: quote the value "${v}" (YAML parsers read it as a number, boolean, null or date`]),
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
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
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
  assert.deepEqual(errors, []);
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
  assert.deepEqual(errors, ['.', './graders', 'mocks/x', '../other'].map((d) => `evals/demo/case.yaml: add_dirs entry "${d}" is not a fixture folder in the case folder (one that isn't the case folder, graders/ or mocks/)`));
});

test('checkEvalCases refuses a fixture path that leaves the case folder on any platform', () => {
  const { errors } = check({
    'evals/demo/case.yaml': 'schema_version: "1.1"\nname: demo\ncontext:\n  scaffold_script: C:\\setup.sh\n',
    'evals/demo/prompt.md': PROMPT,
    'evals/demo/graders/01-x.md': '---\ntype: baseline\nbaseline_file: /tmp/ref.jsonl\n---\nPASS if as good.\n',
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
    ...REGEX_CASE('scaffold', promptMd()),
    'evals/scaffold/case.yaml': 'schema_version: "1.1"\nname: scaffold\ncontext:\n  scaffold_script: setup.sh\n',
    'evals/scaffold/setup.sh': 'true\n',
    ...REGEX_CASE('tagged', promptMd('tags: [needs-write]\nallowed_tools: [Write]\n')),
    'evals/tagged/case.yaml': 'schema_version: "1.1"\nname: tagged\ncontext:\n  scaffold_script: setup.sh\n',
    'evals/tagged/setup.sh': 'true\n',
  });
  assert.deepEqual(schema, []);
  assert.deepEqual(errors, [
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
  });
  assert.deepEqual(schema, []);
  const unbacked = (c, f) => `evals/${c}/graders/${f}: with min: 0 this check passes when Write isn't granted, with zero calls; add a tools-granted regex grader (target: trace) that requires "Write" (repo rule)`;
  assert.deepEqual(errors, [
    unbacked('at-most-two', '01-few-writes.md'),
    unbacked('inverted', '01-no-writes.md'),
    unbacked('last-message', '01-no-writes.md'),
    unbacked('other-tool', '01-no-writes.md'),
    'evals/unlisted/graders/01-no-writes.md: list Write in allowed_tools, so that the progress output names it as not granted when --allow-tools leaves it out (repo rule)',
    unbacked('with-only', '01-no-writes.md'),
  ]);
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
// The errors and warnings of the three checks on a small tree.
function histories(files, contract = CONTRACT) {
  const dir = tree(files);
  try {
    const errors = [];
    const warnings = [];
    const err = (m) => errors.push(m);
    const cases = checkEvalCases(dir, err);
    checkSuiteRules(dir, cases, err);
    checkConversations(dir, cases, { err, warn: (m) => warnings.push(m), contract });
    return { errors, warnings };
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
  const { errors, warnings } = histories(recordedCase('demo', [userRow('write a post'), assistantRow(round)], '1: c 3a 12c', {
    '01-answers.md': judge('The answers are "Team managers", "Job seekers", "About 600 words", "Inform", "Rank on Google" and "2,000+ words". The round asked "How long should it be?" and gave the example "4-day week".'),
  }));
  assert.deepEqual(warnings, []);
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
