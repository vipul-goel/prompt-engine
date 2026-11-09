// Mutation tests for scripts/validate.mjs. Each row of ROWS changes a temporary copy of the
// repository and validates it: the run must exit with the row's code (1 unless the row says
// otherwise), print every message the row expects and none that it rules out. Every
// reachable err() call in validate.mjs and scripts/eval-cases.mjs has a row, and some have
// several: each SUBSTITUTIONS pattern, each FORBIDDEN_ROOT name, each way the frontmatter can
// fail to parse. scripts/test/eval-cases.test.mjs tests the eval-case YAML subset directly.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LINT_GRADER_CASES } from '../build.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Build output and tool state the checks don't read: copying them only slows the tests down.
const SKIP = new Set(['.git', 'node_modules', 'results', 'dist', 'dist-mcpb', 'mcpb', '.wrangler']);

function copyRepo(from = repo) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-validate-'));
  // The checkout itself is copied whatever its folder is called; SKIP applies to what's inside it.
  cpSync(from, dir, { recursive: true, filter: (src) => src === from || !SKIP.has(basename(src)) });
  return dir;
}

// git exports variables such as GIT_DIR and GIT_INDEX_FILE to the hooks it runs. Inherited, they
// would point the git commands in a copy, and validate.mjs's own, at the repository being committed
// to. The copies' commands and validate runs leave out every variable git itself clears when it
// moves to another repository.
const hasGit = spawnSync('git', ['--version']).status === 0;
const LOCAL_GIT_VARS = new Set(hasGit ? spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean) : []);
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !LOCAL_GIT_VARS.has(k)));

function validate(dir) {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'validate.mjs')], {
    env: { ...gitEnv(), PE_ROOT: dir }, encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

// `expected` is a regex or a list of regexes that must all match the output; none of
// `unexpected` may match it.
function expectRun({ code: got, out }, expected, code, unexpected = []) {
  assert.equal(got, code, `expected exit ${code}, got:\n${out}`);
  for (const re of [expected].flat()) assert.match(out, re);
  for (const re of [unexpected].flat()) assert.doesNotMatch(out, re);
}

function withMutation(mutate, expected, code = 1, unexpected = []) {
  const dir = copyRepo();
  try {
    mutate(dir);
    expectRun(validate(dir), expected, code, unexpected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A copy that is also a git repository, for the rules that read `git ls-files`. It tracks
// the files this checkout tracks (everything, when the checkout has no .git); files the
// checkout doesn't track are copied but stay untracked. The checkout's files are added with -f:
// git refuses a named path that a gitignore covers (the project's, or a contributor's global one),
// and these are tracked on purpose.
function gitCopy() {
  const dir = copyRepo();
  const git = (args, input) => {
    const r = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8', input, env: gitEnv() });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  git(['init', '-q']);
  const listed = existsSync(join(repo, '.git')) ? spawnSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8', env: gitEnv() }) : null;
  if (listed?.status === 0) git(['--literal-pathspecs', 'add', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], listed.stdout.split('\0').filter((f) => f && existsSync(join(dir, f))).join('\0'));
  else git(['add', '-A']);
  return { dir, git };
}

function inGitCopy(mutate, expected, code = 1, unexpected = []) {
  const { dir, git } = gitCopy();
  try {
    mutate(dir, git);
    expectRun(validate(dir), expected, code, unexpected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const read = (dir, file) => readFileSync(join(dir, file), 'utf8');
// edit and editJson fail loudly when a mutation no longer applies (for example after the text
// it edits was reworded), instead of letting the row pass or fail for another reason.
const edit = (dir, file, fn) => {
  const before = read(dir, file);
  const after = fn(before);
  assert.notEqual(after, before, `${file}: the mutation changed nothing`);
  writeFileSync(join(dir, file), after);
};
const editJson = (dir, file, fn) => {
  const data = JSON.parse(read(dir, file));
  const before = JSON.stringify(data);
  fn(data);
  assert.notEqual(JSON.stringify(data), before, `${file}: the mutation changed nothing`);
  writeFileSync(join(dir, file), `${JSON.stringify(data, null, 2)}\n`);
};
const put = (dir, file, text) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), text); };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Runs the copy's own build, for a row that edits method text and expects validate to pass: the
// generated files that copy the text would be stale otherwise.
const rebuild = (dir) => {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'build.mjs')], { env: { ...gitEnv(), PE_ROOT: dir }, encoding: 'utf8' });
  assert.equal(r.status, 0, `build failed:\n${r.stdout}${r.stderr}`);
};

const SKILL = 'skills/prompt-engine/SKILL.md';
const REF = 'skills/prompt-engine/references';
const CORE = 'universal/prompt-engine.md';
// Limits and rules as the repository sets them; the copies start out identical. Sizes below
// are computed from the current files, so the rows keep working when the method text grows
// or shrinks.
const BUDGETS = JSON.parse(readFileSync(join(repo, 'data/contract.json'), 'utf8')).budgets;
const LINT_RULES = JSON.parse(readFileSync(join(repo, 'data/lint-rules.json'), 'utf8')).rules;
const PLAIN_RULE = LINT_RULES.find((r) => !r.selfCheck).id;
const SELF_CHECK_RULE = LINT_RULES.find((r) => r.selfCheck).id;
const chars = (s) => [...s].length;
// SKILL.md's body as validate.mjs measures it: the text after the frontmatter.
const bodyOf = (t) => t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
// Neutral text: no lint hits and no substitution syntax.
const filler = (n) => 'filler '.repeat(Math.ceil(Math.max(n, 1) / 7)).slice(0, Math.max(n, 1));
const setFront = (key, line) => (d) => edit(d, SKILL, (t) => t.replace(new RegExp(`^${key}:.*$`, 'm'), () => line));
// The first entry of data/media-targets.json.
const MEDIA_ID_RE = reEsc(JSON.parse(readFileSync(join(repo, 'data/media-targets.json'), 'utf8')).targets[0].id);
const target = (fn) => (d) => editJson(d, 'data/media-targets.json', (j) => fn(j.targets[0]));

// Frontmatter that doesn't parse, or that strict YAML parsers read differently (finding 76).
// validate.mjs reports the parse error alone: "\n\n1 error(s)" follows its line.
const onlyError = (msg) => new RegExp(`^error: ${reEsc(`${SKILL}: ${msg}`)}\\n\\n1 error\\(s\\)$`, 'm');
const VALUE_RULE = 'frontmatter value must be a "double-quoted string" without " or \\ inside, or a single bare word: ';
const KEY_RULE = 'frontmatter key must start with a letter and not read as a YAML boolean, null or number: ';
// These messages print the line as a JSON string, so a tab or a control character shows.
const TAB_RULE = (line) => `frontmatter must not contain tabs outside a "double-quoted string": ${JSON.stringify(line)}`;
const CONTROL_RULE = (line) => `frontmatter must not contain control characters: ${JSON.stringify(line)}`;
const metadataLine = (line) => (d) => edit(d, SKILL, (t) => t.replace(/^ {2}version:/m, () => `${line}\n  version:`));
const FRONTMATTER_REJECTED = [
  ['a line that is not a key', (d) => edit(d, SKILL, (t) => t.replace('license: MIT', 'license: MIT\n- stray')), 'unsupported frontmatter line: - stray'],
  ['an unquoted value with ": "', setFront('description', 'description: Use to improve: critique or write a prompt'), `${VALUE_RULE}description: Use to improve: critique or write a prompt`],
  ['an unclosed flow sequence', setFront('description', 'description: [unclosed'), `${VALUE_RULE}description: [unclosed`],
  ['a double quote inside a quoted value', setFront('description', 'description: "Use to "improve" a prompt"'), `${VALUE_RULE}description: "Use to "improve" a prompt"`],
  ['a value starting with #', setFront('description', 'description: # Use to improve a prompt'), `${VALUE_RULE}description: # Use to improve a prompt`],
  ['an inline # comment', setFront('description', 'description: Use to improve #1 prompts'), `${VALUE_RULE}description: Use to improve #1 prompts`],
  ['a duplicate key', (d) => edit(d, SKILL, (t) => t.replace('license: MIT', 'license: MIT\ndescription: "Again"')), 'duplicate frontmatter key: description'],
  ['a duplicate metadata key', metadataLine('  version: "9.9.9"'), 'duplicate frontmatter key: metadata.version'],
  ['a YAML 1.1 boolean as a value', setFront('description', 'description: yes'), `${VALUE_RULE}description: yes`],
  ['a YAML 1.1 boolean as a metadata key', metadataLine('  on: "x"'), `${KEY_RULE}  on: "x"`],
  ['a number as a metadata key', metadataLine('  0x1: "x"'), `${KEY_RULE}  0x1: "x"`],
  ['a flow sequence under metadata', metadataLine('  tags: [a, b]'), `${VALUE_RULE}  tags: [a, b]`],
  ['a number under metadata', metadataLine('  count: 5'), `${VALUE_RULE}  count: 5`],
  ['a word the yaml package reads as a number', metadataLine('  build: e1'), `${VALUE_RULE}  build: e1`],
  ['a single-quoted value', setFront('license', "license: 'MIT'"), `${VALUE_RULE}license: 'MIT'`],
  ['a tab after the colon', setFront('license', 'license:\tMIT'), TAB_RULE('license:\tMIT')],
  ['a line of a space and a tab', (d) => edit(d, SKILL, (t) => t.replace('license: MIT', 'license: MIT\n \t')), TAB_RULE(' \t')],
  ['a control character in a quoted value', setFront('description', 'description: "Use to improve\u{7} a prompt"'), CONTROL_RULE('description: "Use to improve\u{7} a prompt"')],
  // JSON.stringify leaves a C1 control character as it is; the message escapes it, so it shows.
  ['a C1 control character in a quoted value', setFront('description', 'description: "Use to improve\u{85} a prompt"'),
    CONTROL_RULE('description: "Use to improve a prompt"').replace('improve', 'improve\\u0085')],
];

// Eval cases (scripts/eval-cases.mjs): a grader file with front matter, then its body.
const grader = (type, extra = '', body = '') => `---\ntype: ${type}\n${extra}weight: 1\n---\n${body}`;
// A fixture named like a session transcript, which .gitignore hides under evals/.
const SESSION = '12345678-1234-4123-8123-123456789abc.jsonl';
const SPANISH = 'evals/spanish-quick';
const VEO = 'evals/video-veo-quick/graders';
// History cases (findings 54-56): the two follow-up cases resume copies of one recording, which
// ends in a question round; save-to-file's recording, made again in step 1d (D34), ends in an
// output with its What next? menu, in one message.
const OK_CASE = 'evals/followup-ok-accepts-recommendations';
const PARTIAL_CASE = 'evals/followup-partial-answers';
const SAVE_CASE = 'evals/save-to-file';
const OK6 = `${OK_CASE}/graders/06-accepted-not-assumed.md`;
const PARTIAL6 = `${PARTIAL_CASE}/graders/06-accepted-not-assumed.md`;
const SAVE05 = `${SAVE_CASE}/graders/05-file-is-the-full-prompt.md`;
const SAVE06 = `${SAVE_CASE}/graders/06-file-is-not-the-whole-reply.md`;
// save-to-file-existing resumes a copy of save-to-file's recording, with a scaffold_script that
// puts a file at the save path first; its 05 reads the -2 file that the save writes instead.
const SAVE_EXISTING05 = 'evals/save-to-file-existing/graders/05-file-is-the-full-prompt.md';
// The save path that save-to-file's recorded menu offers.
const SAVE_PATH = 'prompts/etsy-mug-description.md';
// The message id of the repeated menu in save-to-file's old recording, whose problems only warned
// until step 1d recorded the case again (D34).
const OLD_MENU = 'msg_011CgWkHqm4wmTHWit6mebGp';
// The fake key that the safety eval's prompt.md pastes, read at run time.
const FAKE_KEY = readFileSync(join(repo, 'evals/secret-redaction-quick/prompt.md'), 'utf8').match(/\bsk-[\w-]{20,}/)[0];
// A history.jsonl edited row by row: fn changes the parsed rows and returns them.
const editRows = (d, file, fn) => edit(d, file, (t) => `${fn(t.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))).map((r) => JSON.stringify(r)).join('\n')}\n`);
// The text of save-to-file's recorded output (the text of its last assistant row), changed by fn.
const editOutput = (d, fn) => editRows(d, `${SAVE_CASE}/history.jsonl`, (rows) => {
  const part = rows.findLast((r) => r.type === 'assistant').message.content.find((p) => p.type === 'text');
  assert.match(part?.text ?? '', /### Full prompt[\s\S]*### What next\?/, 'the last assistant row holds the recorded output');
  part.text = fn(part.text);
  return rows;
});
// Every case.yaml, prompt.md and grader of the copy, with CRLF line endings.
const crlfEvalFiles = (d) => {
  for (const c of readdirSync(join(d, 'evals'), { withFileTypes: true })) {
    if (!c.isDirectory()) continue;
    const dir = `evals/${c.name}`;
    const graders = existsSync(join(d, dir, 'graders')) ? readdirSync(join(d, dir, 'graders')).filter((f) => f.endsWith('.md')).map((f) => `graders/${f}`) : [];
    for (const f of ['case.yaml', 'prompt.md', ...graders]) if (existsSync(join(d, dir, f))) edit(d, `${dir}/${f}`, (t) => t.replace(/\n/g, '\r\n'));
  }
};

// Same list as FORBIDDEN_ROOT in scripts/validate.mjs; keep the two in step. It is copied on
// purpose: a name dropped from validate.mjs then fails its row.
const FORBIDDEN_ROOT = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'node_modules', 'bin',
  'CLAUDE.md', '.mcp.json', '.lsp.json', 'commands', 'agents', 'hooks', 'settings.json', 'SKILL.md',
  'output-styles', 'monitors', 'workflows', 'themes'];

// [name, mutate(dir), expected, code = 1, unexpected = []], as in expectRun.
const ROWS = [
  // ---- frontmatter
  ...FRONTMATTER_REJECTED.map(([name, mutate, msg]) => [`rejects frontmatter with ${name}, and reports only that`, mutate, onlyError(msg)]),
  ['accepts extra spaces after a frontmatter colon and trailing spaces', (d) => edit(d, SKILL, (t) => t.replace(/^description: /m, 'description:    ').replace('license: MIT', 'license: MIT   ')), /validate: OK/, 0],
  ['accepts a tab inside a quoted value and a line of spaces', (d) => edit(d, SKILL, (t) => t.replace('description: "Use to', 'description: "Use\tto').replace('license: MIT', 'license: MIT\n   ')), /validate: OK/, 0],
  ['rejects a SKILL.md without frontmatter', (d) => edit(d, SKILL, (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '')), /SKILL\.md: missing YAML frontmatter/],
  // build.mjs reads past the mark, so this is the only error.
  ['rejects a SKILL.md that starts with a byte-order mark', (d) => edit(d, SKILL, (t) => `\u{FEFF}${t}`),
    new RegExp(`^error: ${reEsc(SKILL)}: starts with a byte-order mark, which some skill validators refuse; save it as UTF-8 without one\\n\\n1 error\\(s\\)$`, 'm')],
  // A __proto__ key would otherwise set the parsed object's prototype, which hides it and makes its
  // mapping's name look like the top-level name.
  ['rejects a __proto__ key in the frontmatter, instead of reading its mapping as the prototype', (d) => edit(d, SKILL, (t) => t.replace(/^name: prompt-engine$/m, '__proto__:\n  name: prompt-engine')),
    [/SKILL\.md: frontmatter key "__proto__" is not portable/, /SKILL\.md: name "" must be 1-64 chars/]],
  ['rejects a Claude Code-only frontmatter key', (d) => edit(d, SKILL, (t) => t.replace('license: MIT', 'license: MIT\nargument-hint: "[prompt]"')), /frontmatter key "argument-hint" is not portable/],
  ['rejects a name that is not lowercase and hyphenated', setFront('name', 'name: Prompt_Engine'), /name "Prompt_Engine" must be 1-64 chars of a-z/],
  ['rejects a name that differs from the folder name', setFront('name', 'name: prompt-engines'), /name "prompt-engines" must equal the folder name "prompt-engine"/],
  ['rejects a reserved word in the name', setFront('name', 'name: claude-prompts'), /name "claude-prompts" uses a reserved word/],
  ['requires a description', (d) => edit(d, SKILL, (t) => t.replace(/^description:.*\n/m, '')), /SKILL\.md: description is required/],
  ['rejects angle brackets in the description', setFront('description', 'description: "Use <when> asked to improve a prompt."'), /description must not contain < or >/],
  ['rejects a description that starts like a YAML block scalar', setFront('description', 'description: "| Improve prompts for any AI tool."'), /description must be a single-line string, not a YAML block scalar/],
  ['rejects a description over the hard limit', setFront('description', `description: "${'word '.repeat(220).trim()}"`), new RegExp(`description is \\d+ chars \\(hard limit ${BUDGETS.descriptionHardMaxChars}\\)`)],
  ['rejects a description over the cap', setFront('description', `description: "${'word '.repeat(60).trim()}"`), new RegExp(`description is \\d+ chars \\(current cap ${BUDGETS.descriptionMaxChars};`)],
  ['requires license MIT', setFront('license', 'license: Apache-2.0'), /license should be MIT/],
  ['allows only Read in allowed-tools', setFront('allowed-tools', 'allowed-tools: Bash'), /allowed-tools should be exactly "Read"/],
  ['requires metadata to be a mapping', (d) => edit(d, SKILL, (t) => t.replace(/^metadata:\n(?: {2}.*\n)+/m, 'metadata: none\n')), /SKILL\.md: metadata must be a mapping/],
  ['requires a semver metadata.version', (d) => edit(d, SKILL, (t) => t.replace(/^ {2}version: "[^"]*"$/m, '  version: "1.0"')), /SKILL\.md: metadata\.version must be semver/],
  // ---- skill folder
  ['rejects more files in the skill folder than its budget', (d) => { for (let i = 0; i < BUDGETS.skillFolderMaxFiles; i++) put(d, `skills/prompt-engine/extra/f${i}.md`, '# Extra\n'); },
    new RegExp(`skills/prompt-engine: \\d+ files \\(max ${BUDGETS.skillFolderMaxFiles}\\)`)],
  ['rejects a skill file over the per-file size limit', (d) => put(d, 'skills/prompt-engine/extra/big.md', filler(BUDGETS.skillFileMaxBytes + 1)),
    new RegExp(`extra/big\\.md: ${BUDGETS.skillFileMaxBytes + 1} bytes \\(max ${BUDGETS.skillFileMaxBytes} per file\\)`)],
  ['rejects a non-Markdown file in the skill folder', (d) => put(d, 'skills/prompt-engine/helper.py', 'print(1)\n'), /helper\.py: only Markdown files belong in the skill folder/],
  ['rejects a second SKILL.md', (d) => put(d, 'skills/prompt-engine/extra/SKILL.md', '# Extra\n'), /extra\/SKILL\.md: a skill must contain exactly one SKILL\.md/],
  ['rejects a skill folder over its total size budget', (d) => {
    // Files just under the per-file limit, enough of them to pass the folder's total.
    const n = Math.ceil(BUDGETS.skillFolderMaxBytes / (BUDGETS.skillFileMaxBytes - 1)) + 1;
    for (let i = 0; i < n; i++) put(d, `skills/prompt-engine/extra/f${i}.md`, filler(BUDGETS.skillFileMaxBytes - 1));
  }, new RegExp(`skills/prompt-engine: \\d+ bytes \\(max ${BUDGETS.skillFolderMaxBytes}\\)$`, 'm')],
  // ---- text Claude Code substitutes (one row per pattern)
  ['rejects $ARGUMENTS in skill text', (d) => edit(d, `${REF}/writing.md`, (t) => `${t}\nUse $ARGUMENTS here.\n`), /writing\.md: contains \$ARGUMENTS,/],
  ['rejects a $N placeholder that Claude Code would substitute', (d) => edit(d, `${REF}/writing.md`, (t) => `${t}\nPrices start at $1 per month.\n`), /writing\.md: contains \$N \(e\.g\. "\$1"\),/],
  ['rejects a ${CLAUDE_ variable in skill text', (d) => edit(d, `${REF}/writing.md`, (t) => `${t}\nSee \${CLAUDE_PLUGIN_ROOT}/x.\n`), /writing\.md: contains \$\{CLAUDE_\.\.\.\},/],
  ['rejects a !`command` line in skill text', (d) => edit(d, `${REF}/writing.md`, (t) => `${t}\n!\`date\`\n`), /writing\.md: contains !`command`,/],
  ['rejects a ```! fence in skill text', (d) => edit(d, `${REF}/writing.md`, (t) => `${t}\n\`\`\`!\ndate\n\`\`\`\n`), /writing\.md: contains ```! fence,/],
  // ---- lint rules
  ['reports a lint rule whose pattern does not compile', (d) => editJson(d, 'data/lint-rules.json', (j) => { j.rules.find((r) => r.id === PLAIN_RULE).pattern = '('; }),
    new RegExp(`error: data/lint-rules\\.json ${PLAIN_RULE}: bad pattern \\(`)],
  ['reports a self-check rule whose pattern does not compile, instead of crashing', (d) => editJson(d, 'data/lint-rules.json', (j) => { j.rules.find((r) => r.id === SELF_CHECK_RULE).pattern = '('; }),
    new RegExp(`error: data/lint-rules\\.json ${SELF_CHECK_RULE}: bad pattern \\([\\s\\S]*\\n\\d+ error\\(s\\)`)],
  ['rejects capitalized pressure words in SKILL.md', (d) => edit(d, SKILL, (t) => `${t}\nYou MUST do this.\n`), /SKILL\.md: "MUST" \(pressure-words\)/],
  ['rejects a request to expose reasoning in the universal prompt', (d) => edit(d, CORE, (t) => `${t}\nThink step by step before answering.\n`), /universal\/prompt-engine\.md: "Think step by step" \(visible-reasoning-request\)/],
  // D48: the hyphenated form, as Google's Gemini 3 template writes it.
  ['rejects a hyphenated request to expose reasoning in a reference file', (d) => edit(d, `${REF}/questions.md`, (t) => `${t}\nRemember to think step-by-step before answering.\n`), /questions\.md: "think step-by-step" \(visible-reasoning-request\)/],
  // The references are linted too, with `code spans` skipped: there they name a pattern, often to
  // warn against it (finding 17, D11). Double-quoted text and fenced example prompts still count.
  ['rejects capitalized pressure words in a reference file', (d) => edit(d, `${REF}/questions.md`, (t) => `${t}\nYou MUST ask at least three questions.\n`), /questions\.md: "MUST" \(pressure-words\)/],
  ['accepts pressure words and reasoning requests named in code spans in a reference file', (d) => {
    edit(d, `${REF}/questions.md`, (t) => `${t}\nDon't write \`MUST\` or \`think step by step\` into a prompt.\n`);
    rebuild(d);
  }, /validate: OK/, 0],
  ['rejects a double-quoted pressure word in SKILL.md', (d) => edit(d, SKILL, (t) => `${t}\nAvoid "MUST" in prompts.\n`), /SKILL\.md: "MUST" \(pressure-words\)/],
  ['rejects capitalized pressure words in a fenced example prompt in a reference file', (d) => edit(d, `${REF}/writing.md`, (t) => t.replace('\n# Facts\n', '\n# Facts\nYou MUST use only the facts above.\n')),
    /writing\.md: "MUST" \(pressure-words\)/],
  // ---- size budgets (finding 42)
  ['rejects a SKILL.md body over the character budget', (d) => edit(d, SKILL, (t) => `${t}\n${filler(BUDGETS.skillBodyMaxChars - chars(bodyOf(t)) + 100)}\n`),
    new RegExp(`SKILL\\.md: body is \\d+ chars \\(max ${BUDGETS.skillBodyMaxChars}\\)`)],
  ['rejects a SKILL.md body over the line budget', (d) => edit(d, SKILL, (t) => `${t}${'\n'.repeat(BUDGETS.skillBodyMaxLines - bodyOf(t).split('\n').length + 10)}`),
    new RegExp(`SKILL\\.md: body is \\d+ lines \\(max ${BUDGETS.skillBodyMaxLines}\\)`)],
  ...BUDGETS.skillKeySections.map((h) => [`rejects "${h}" starting past the first ${BUDGETS.skillKeySectionsWithinChars} characters`,
    (d) => edit(d, SKILL, (t) => t.replace(h, () => `${filler(BUDGETS.skillKeySectionsWithinChars - bodyOf(t).indexOf(h) + 100)}\n\n${h}`)),
    new RegExp(`SKILL\\.md: section "${reEsc(h)}" starts at char \\d+; keep it within the first ${BUDGETS.skillKeySectionsWithinChars}`)]),
  ['rejects a missing key section', (d) => edit(d, SKILL, (t) => t.replaceAll(BUDGETS.skillKeySections[0], '### Renamed section')),
    new RegExp(`SKILL\\.md: missing section "${reEsc(BUDGETS.skillKeySections[0])}"`)],
  ['rejects a universal core over its character budget', (d) => edit(d, CORE, (t) => `${t}\n${filler(BUDGETS.universalCoreMaxChars - chars(t) + 100)}\n`),
    new RegExp(`universal/prompt-engine\\.md: \\d+ chars \\(max ${BUDGETS.universalCoreMaxChars}\\)`)],
  // ---- references
  ['rejects a nested references folder', (d) => put(d, `${REF}/sub/extra.md`, '# Extra\n'), /references\/sub: keep references one level deep/],
  ['rejects an unlinked reference file', (d) => put(d, `${REF}/extra.md`, '# Extra\n'), /references\/extra\.md: not linked from SKILL\.md/],
  ['rejects a link to a reference that does not exist', (d) => edit(d, SKILL, (t) => `${t}\nSee references/missing.md.\n`), /SKILL\.md: links references\/missing\.md, which does not exist/],
  ['rejects a reference missing from KNOWLEDGE_ORDER', (d) => { put(d, `${REF}/extra.md`, '# Extra\n'); edit(d, SKILL, (t) => `${t}\nSee references/extra.md.\n`); },
    /references\/extra\.md: add "extra" to KNOWLEDGE_ORDER in scripts\/build\.mjs/],
  // The build can't read the missing file either: its error is listed with the others (finding 21's guard).
  ['rejects a KNOWLEDGE_ORDER entry whose file is missing, and still lists the other errors', (d) => rmSync(join(d, `${REF}/research.md`)),
    [/SKILL\.md: links references\/research\.md, which does not exist/, /scripts\/build\.mjs: KNOWLEDGE_ORDER lists research, but references\/research\.md does not exist/, /error: build failed: ENOENT/]],
  // ---- output contract
  ['rejects a contract artifact that does not exist', (d) => editJson(d, 'data/contract.json', (j) => { j.artifacts['docs/missing.md'] = ['markers']; }), /docs\/missing\.md: listed in data\/contract\.json but missing/],
  ['rejects a missing contract string', (d) => edit(d, `${REF}/questions.md`, (t) => t.replaceAll('Reply `ok` to accept every ★', 'Reply yes to accept')),
    /questions\.md: missing contract string "Reply `ok` to accept every ★" \(replyLine\)/],
  // A contract heading counts only as a heading line or as a bold label that starts a list item,
  // so the word left elsewhere in the text doesn't hide a renamed heading (finding 23).
  ['rejects a missing contract heading', (d) => edit(d, CORE, (t) => t.replaceAll('Fill before running', 'Fill in')), /universal\/prompt-engine\.md: missing contract heading "Fill before running"/],
  ['rejects a renamed Score heading, though "Score anchors" remains', (d) => edit(d, `${REF}/output-format.md`, (t) => t.replace('\n### Score\n', '\n### Rating\n')),
    /output-format\.md: missing contract heading "Score"/],
  ['rejects a heading with words after it', (d) => edit(d, `${REF}/output-format.md`, (t) => t.replace('\n### Score\n', '\n### Score (0-5)\n')),
    /output-format\.md: missing contract heading "Score" \(a ## to #### heading followed by a colon or the end of the line/],
  ['rejects a renamed What next? heading, though a bold "What next?" outside a list remains',(d) => edit(d, `${REF}/output-format.md`, (t) => t.replace('\n### What next?\n', '\n### Next steps\n')),
    /output-format\.md: missing contract heading "What next\?"/],
  ['rejects a renamed heading in a list item', (d) => edit(d, CORE, (t) => t.replace('\n- ### Score:', '\n- ### Rating:')), /universal\/prompt-engine\.md: missing contract heading "Score"/],
  ['rejects a renamed bold label in a list item', (d) => edit(d, SKILL, (t) => t.replace('\n7. **Score**', '\n7. **Rating**')), /SKILL\.md: missing contract heading "Score"/],
  // ---- plugin root
  ...FORBIDDEN_ROOT.map((f) => [`rejects ${f} at the plugin root`, (d) => writeFileSync(join(d, f), ''), new RegExp(`(^|\\n)error: ${reEsc(f)}: not allowed at the repo root`)]),
  // Memory files in the folders that Claude Code walks through to a reference, tracked or not.
  ...['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md'].map((f) => [`rejects ${f} in the skill folder`, (d) => put(d, `skills/prompt-engine/${f}`, '# Notes\n'),
    new RegExp(`(^|\\n)error: skills/prompt-engine/${reEsc(f)}: don't keep it in a folder the skill reads from: Claude Code can load it as project memory`)]),
  ['rejects a .claude folder in skills/', (d) => put(d, 'skills/.claude/settings.json', '{}\n'),
    /^error: skills\/\.claude: don't keep it in a folder the skill reads from[^\n]*\n\n1 error\(s\)$/m],
  ['rejects a memory file in the references folder', (d) => put(d, `${REF}/CLAUDE.md`, '# Notes\n'),
    /(^|\n)error: skills\/prompt-engine\/references\/CLAUDE\.md: don't keep it in a folder the skill reads from/],
  // ---- manifests
  ['requires the plugin name prompt-engine', (d) => editJson(d, '.claude-plugin/plugin.json', (j) => { j.name = 'prompt-engine-x'; }), /plugin\.json: name must be prompt-engine/],
  ['requires a semver plugin version', (d) => editJson(d, '.claude-plugin/plugin.json', (j) => { j.version = '1.0'; }), /plugin\.json: version must be semver/],
  ['requires a marketplace entry for prompt-engine', (d) => editJson(d, '.claude-plugin/marketplace.json', (j) => { j.plugins[0].name = 'other'; }), /marketplace\.json: no entry for prompt-engine/],
  ['requires the marketplace source ./', (d) => editJson(d, '.claude-plugin/marketplace.json', (j) => { j.plugins[0].source = './plugin'; }), /prompt-engine source should be "\.\/"/],
  ['rejects a version in the marketplace entry', (d) => editJson(d, '.claude-plugin/marketplace.json', (j) => { j.plugins[0].version = '0.1.0'; }), /marketplace\.json: set version only in plugin\.json/],
  ['rejects a version mismatch between SKILL.md and plugin.json', (d) => edit(d, SKILL, (t) => t.replace(/^ {2}version: "[^"]*"$/m, '  version: "9.9.9"')), /SKILL\.md: metadata\.version 9\.9\.9 != plugin\.json/],
  ['rejects an mcp/package.json version mismatch', (d) => editJson(d, 'mcp/package.json', (j) => { j.version = '9.9.9'; }), /mcp\/package\.json: version 9\.9\.9 != plugin\.json/],
  ['rejects an mcpName that differs from server.json', (d) => editJson(d, 'mcp/package.json', (j) => { j.mcpName = 'io.github.someone/other'; }), /mcpName "io\.github\.someone\/other" != server\.json name/],
  ['rejects a server.json version mismatch', (d) => editJson(d, 'mcp/server.json', (j) => { j.version = '9.9.9'; }), /mcp\/server\.json: version 9\.9\.9 != /],
  ['rejects a server.json description over 100 characters', (d) => editJson(d, 'mcp/server.json', (j) => { j.description = 'x'.repeat(101); }), /server\.json: description must be 100 characters or fewer/],
  ['rejects a server.json package version mismatch', (d) => editJson(d, 'mcp/server.json', (j) => { j.packages[0].version = '9.9.9'; }), /server\.json: package \S+ version 9\.9\.9 != /],
  ['rejects an mcp/manifest.json version mismatch', (d) => editJson(d, 'mcp/manifest.json', (j) => { j.version = '9.9.9'; }), /mcp\/manifest\.json: version 9\.9\.9 != /],
  // ---- data
  ['requires https sources', target((t) => { t.sources = ['http://example.com/docs']; }), new RegExp(`media-targets\\.json ${MEDIA_ID_RE}: needs https sources`)],
  ['rejects a malformed last_verified date', target((t) => { t.last_verified = '2026-1-29'; }), new RegExp(`media-targets\\.json ${MEDIA_ID_RE}: last_verified must be a real YYYY-MM-DD date`)],
  ['rejects an impossible last_verified date', target((t) => { t.last_verified = '2024-02-30'; }), new RegExp(`media-targets\\.json ${MEDIA_ID_RE}: last_verified must be a real YYYY-MM-DD date`)],
  ['rejects a last_verified date in the future', target((t) => { t.last_verified = '2099-01-01'; }), new RegExp(`media-targets\\.json ${MEDIA_ID_RE}: last_verified 2099-01-01 is in the future`)],
  // Data the build can't render: the build's error is listed with the others, not a stack trace.
  ['lists every data error when the build throws', target((t) => { t.status = 'verifed'; t.sources = ['http://example.com/docs']; }),
    [new RegExp(`media-targets\\.json ${MEDIA_ID_RE}: bad status "verifed"`), new RegExp(`media-targets\\.json ${MEDIA_ID_RE}: needs https sources`),
      new RegExp(`error: build failed: media-targets: unknown status "verifed" for ${MEDIA_ID_RE}`)]],
  ['names the entry whose sources array is missing', target((t) => { delete t.sources; }),
    [new RegExp(`media-targets\\.json ${MEDIA_ID_RE}: needs https sources`), new RegExp(`error: build failed: media-targets: ${MEDIA_ID_RE} needs a sources array`)]],
  // ---- eval cases
  ['rejects an eval case without prompt.md or case.yaml', (d) => mkdirSync(join(d, 'evals/empty-case')), /evals\/empty-case: needs prompt\.md or case\.yaml/],
  ['rejects an eval case without graders', (d) => put(d, 'evals/no-graders/prompt.md', 'hello\n'), /evals\/no-graders: needs at least one grader in graders\//],
  // claude plugin eval drops an unknown case.yaml key and skips a grader without front matter
  // without a message, and a pattern that doesn't compile fails after the billed run (finding 65).
  ['rejects a misspelled context key', (d) => edit(d, 'evals/imperative-coding-no-action/case.yaml', (t) => t.replace('scaffold_script:', 'scaffold:')),
    /error: evals\/imperative-coding-no-action\/case\.yaml: unknown key "context\.scaffold" \(claude plugin eval drops it without a message\)/],
  ['rejects a misspelled history_file', (d) => edit(d, 'evals/save-to-file/case.yaml', (t) => t.replace('history_file:', 'history:')), /save-to-file\/case\.yaml: unknown key "context\.history"/],
  ['rejects a misspelled execution block', (d) => edit(d, 'evals/writing-quick-launch-email/case.yaml', (t) => `${t}executoin:\n  max_turns: 4\n`),
    /writing-quick-launch-email\/case\.yaml: unknown key "executoin" \(claude plugin eval drops it without a message\)/],
  ['rejects a misspelled prompt.md key', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('max_turns:', 'max-turns:')),
    /spanish-quick\/prompt\.md: unknown front matter key "max-turns" \(claude plugin eval refuses to load the case\)/],
  ['rejects a misspelled grader type', (d) => edit(d, 'evals/trigger-natural-phrasing/graders/02-skill-fired.md', (t) => t.replace('type: tool_used', 'type: tool-used')),
    /02-skill-fired\.md: type must be one of regex, tool_used, tool_order, file_exists, llm, baseline/],
  // YAML keeps a no-break space at a value's edge, so claude plugin eval reads "regex\u{A0}".
  ['rejects a grader type followed by a no-break space', (d) => edit(d, `${VEO}/03-assumptions-heading.md`, (t) => t.replace('type: regex', 'type: regex\u{A0}')),
    /03-assumptions-heading\.md: type must be one of regex, tool_used, tool_order, file_exists, llm, baseline/],
  ['rejects a misspelled match mode', (d) => edit(d, 'evals/coding-vague-asks-questions/graders/02-at-most-eight-questions.md', (t) => t.replace('not_contains', 'not-contains')),
    /02-at-most-eight-questions\.md: match must be contains, not_contains or count:N/],
  ['rejects a pattern that does not compile', (d) => put(d, `${VEO}/05-bad-regex.md`, grader('regex', "pattern: '([unclosed'\n")), /05-bad-regex\.md: pattern: Invalid regular expression/],
  ['rejects a grader file without front matter', (d) => put(d, 'evals/no-trigger-plain-task/graders/README.md', '# notes\n'),
    /no-trigger-plain-task\/graders\/README\.md: no front matter at the top, so claude plugin eval skips this file/],
  ['rejects a case.yaml name that differs from the folder', (d) => edit(d, `${SPANISH}/case.yaml`, (t) => t.replace('name: spanish-quick', 'name: spanish-quik')),
    /spanish-quick\/case\.yaml: name "spanish-quik" must equal the folder name \(repo rule\)/],
  // The YAML subset: anything else is an error naming file:line.
  ['rejects unsupported indentation in case.yaml', (d) => edit(d, 'evals/save-to-file/case.yaml', (t) => t.replace('  history_file:', '    history_file:')),
    /error: evals\/save-to-file\/case\.yaml:\d+: unsupported indentation/],
  ['rejects a duplicate case.yaml key', (d) => edit(d, `${SPANISH}/case.yaml`, (t) => `${t}name: spanish-quick\n`), /spanish-quick\/case\.yaml:\d+: duplicate key name/],
  ['rejects a front matter value that YAML reads as a mapping', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('max_turns: 16', 'max_turns: 16\ndescription: a: b')),
    /spanish-quick\/prompt\.md:\d+: quote the value "a: b"/],
  ['rejects a double-quoted escape that YAML reads differently from a regex', (d) => put(d, `${VEO}/05-esc.md`, grader('regex', 'pattern: "\\bveo"\n')),
    /05-esc\.md:3: unsupported escape \\b/],
  // Keys the CLI accepts but this repo doesn't use.
  ['rejects a graders list in case.yaml', (d) => edit(d, `${SPANISH}/case.yaml`, (t) => `${t}graders:\n  - name: x\n    type: regex\n`),
    /spanish-quick\/case\.yaml: graders: write each grader as graders\/<name>\.md, which validate\.mjs checks \(repo rule\)/],
  ['rejects an undocumented execution key', (d) => edit(d, 'evals/writing-quick-launch-email/case.yaml', (t) => `${t}execution:\n  artifact_publish: false\n`),
    /case\.yaml: execution\.artifact_publish: not used in this repo; claude plugin eval accepts it, but its docs don't list it \(repo rule\)/],
  ['rejects an undocumented prompt.md key', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('max_turns: 16', 'max_turns: 16\ngrowthbook_overrides: {a: b}')),
    /spanish-quick\/prompt\.md: growthbook_overrides: not used in this repo.*\(repo rule\)/],
  ['rejects disallowed_tools, which the CLI reads but its docs leave out', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('max_turns: 16', 'max_turns: 16\ndisallowed_tools: [Bash]')),
    /spanish-quick\/prompt\.md: disallowed_tools: not used in this repo.*\(repo rule\)/],
  ['rejects a grader name key', (d) => edit(d, `${VEO}/03-assumptions-heading.md`, (t) => t.replace('type: regex', 'type: regex\nname: other')),
    /03-assumptions-heading\.md: name: the file name is the grader's name; don't override it \(repo rule\)/],
  ['rejects a case.yaml without a name', (d) => edit(d, `${SPANISH}/case.yaml`, (t) => t.replace('name: spanish-quick\n', '')),
    /spanish-quick\/case\.yaml: name is required \(claude plugin eval refuses the case without it\)/],
  ['rejects an unquoted schema_version', (d) => edit(d, `${SPANISH}/case.yaml`, (t) => t.replace('"1.1"', '1.1')), /spanish-quick\/case\.yaml: schema_version must be a quoted 1\.x string/],
  ['rejects a prompt.md name that differs from the folder', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('max_turns: 16', 'max_turns: 16\nname: other')),
    /spanish-quick\/prompt\.md: name "other" must equal the folder name \(repo rule\)/],
  ['rejects an empty prompt body', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace(/\n---\n[\s\S]*$/, '\n---\n')), /spanish-quick\/prompt\.md: the body \(the prompt\) is empty/],
  ['rejects a case.yaml-only case without execution.prompt', (d) => rmSync(join(d, `${SPANISH}/prompt.md`)),
    /error: evals\/spanish-quick: no prompt \(a prompt\.md body, or execution\.prompt in case\.yaml\)/],
  ['rejects a context that is not a mapping', (d) => edit(d, 'evals/save-to-file/case.yaml', (t) => t.replace('context:\n  history_file: history.jsonl', 'context: history.jsonl')),
    /save-to-file\/case\.yaml: context must be a mapping/],
  ['rejects a value of the wrong type', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace(/^model: .*$/m, 'model: 5')), /spanish-quick\/prompt\.md: model must be a string/],
  ['rejects tags that are not a list', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace(/^tags: .*$/m, 'tags: smoke')),
    /spanish-quick\/prompt\.md: tags must be a list of strings, such as \[a, b\]/],
  // Grader options.
  ['rejects an option of another grader type', (d) => edit(d, `${VEO}/03-assumptions-heading.md`, (t) => t.replace('type: regex', 'type: regex\npath: x.md')),
    /03-assumptions-heading\.md: key "path" is not a regex grader option/],
  ['rejects weight 0', (d) => edit(d, `${VEO}/03-assumptions-heading.md`, (t) => t.replace('weight: 1', 'weight: 0')), /03-assumptions-heading\.md: weight must be a number above 0/],
  ['rejects an unknown arm', (d) => edit(d, `${VEO}/03-assumptions-heading.md`, (t) => t.replace('weight: 1', 'weight: 1\narm: bogus')), /03-assumptions-heading\.md: arm must be with-only or both/],
  ['rejects an unknown regex flag', (d) => edit(d, `${VEO}/03-assumptions-heading.md`, (t) => t.replace('flags: i', 'flags: iq')), /03-assumptions-heading\.md: flags may use only d g i m s u v y/],
  ['rejects an unknown target', (d) => edit(d, `${VEO}/03-assumptions-heading.md`, (t) => t.replace('type: regex', 'type: regex\ntarget: reply')),
    /03-assumptions-heading\.md: target must be trace, last_message, files, mock_calls or \{source: file, path: <a relative path>\}/],
  ['rejects a regex grader without a pattern', (d) => put(d, `${VEO}/05-empty.md`, grader('regex')), /05-empty\.md: needs a pattern \(the pattern key, or the file's body\)/],
  ['rejects a tool_used grader without a tool', (d) => put(d, `${VEO}/05-t.md`, grader('tool_used')), /05-t\.md: needs tool/],
  ['rejects an input_match that does not compile', (d) => edit(d, `${VEO}/04-skill-fired.md`, (t) => t.replace(/input_match: .*/, "input_match: '(['")),
    /04-skill-fired\.md: input_match: Invalid regular expression/],
  ['rejects an input_match that is not a string', (d) => edit(d, `${VEO}/04-skill-fired.md`, (t) => t.replace(/input_match: .*/, 'input_match: 5')), /04-skill-fired\.md: input_match must be a string/],
  ['rejects a negative min', (d) => put(d, `${VEO}/05-t.md`, grader('tool_used', 'tool: Write\nmin: -1\n')), /05-t\.md: min must be a whole number of 0 or more/],
  ['rejects a min above max', (d) => put(d, `${VEO}/05-t.md`, grader('tool_used', 'tool: Write\nmin: 2\nmax: 1\n')), /05-t\.md: min \(2\) is above max \(1\), so the grader never passes/],
  ['rejects a tool_order grader without before', (d) => put(d, `${VEO}/05-o.md`, grader('tool_order', 'after: Write\n')), /05-o\.md: before must be a tool name or \{tool, input_match\}/],
  ['rejects a file_exists grader without a path', (d) => put(d, 'evals/save-to-file/graders/05-f.md', grader('file_exists')), /05-f\.md: needs path/],
  ['rejects an exists that is not a boolean', (d) => put(d, 'evals/save-to-file/graders/05-f.md', grader('file_exists', "path: a.md\nexists: 'yes'\n")), /05-f\.md: exists must be true or false/],
  ['rejects an llm grader without criteria', (d) => put(d, `${VEO}/05-l.md`, grader('llm', 'focus: last_message\n')), /05-l\.md: needs criteria \(the criteria key, or the file's body\)/],
  ['rejects an unknown focus', (d) => put(d, `${VEO}/05-l.md`, grader('llm', 'focus: reply\n', '\nPASS if fine.\n')), /05-l\.md: focus must be trace, last_message, files, mock_calls or/],
  ['rejects a missing baseline_file', (d) => put(d, `${VEO}/05-b.md`, grader('baseline', 'baseline_file: ref.jsonl\n', '\nPASS if as good.\n')),
    /05-b\.md: baseline_file "ref\.jsonl" is not a plain file in the case folder/],
  ['rejects a case whose only grader has no front matter', (d) => {
    const g = 'evals/no-trigger-prompting-tips/graders';
    for (const f of readdirSync(join(d, g))) rmSync(join(d, g, f));
    put(d, `${g}/README.md`, 'notes\n');
  }, /error: evals\/no-trigger-prompting-tips: needs at least one grader in graders\/ with front matter/],
  // Folders under evals/ (claude plugin eval also reads case groups and suite-wide mocks).
  ['rejects a group folder of cases', (d) => { put(d, 'evals/group/inner/prompt.md', 'hi\n'); put(d, 'evals/group/inner/graders/01.md', grader('regex', "pattern: 'x'\n")); },
    /error: evals\/group: needs prompt\.md or case\.yaml; cases sit directly under evals\/, because scripts\/build\.mjs refreshes only evals\/<case>\/history\.jsonl \(repo rule\)/],
  ['rejects a suite-wide mocks folder', (d) => put(d, 'evals/mocks/server/tool.md', 'result\n'),
    /error: evals\/mocks: suite-wide mocks aren't used in this repo, and validate\.mjs doesn't check them \(repo rule\)/],
  // Files a case names (finding 67 too).
  ['rejects a missing scaffold_script', (d) => rmSync(join(d, 'evals/imperative-coding-no-action/place-files.sh')),
    /imperative-coding-no-action\/case\.yaml: context\.scaffold_script "place-files\.sh" is not a plain file in the case folder/],
  ['rejects a history_file with another name', (d) => {
    put(d, 'evals/save-to-file/other.jsonl', read(d, 'evals/save-to-file/history.jsonl'));
    edit(d, 'evals/save-to-file/case.yaml', (t) => t.replace('history_file: history.jsonl', 'history_file: other.jsonl'));
  }, /save-to-file\/case\.yaml: context\.history_file must be history\.jsonl, the only name scripts\/build\.mjs refreshes \(repo rule\)/, 1, /is not a plain file/],
  ['rejects a fixture outside the case folder', (d) => edit(d, 'evals/save-to-file/case.yaml', (t) => t.replace('history_file: history.jsonl', 'history_file: ../followup-partial-answers/history.jsonl')),
    /context\.history_file "\.\.\/followup-partial-answers\/history\.jsonl" is not a plain file in the case folder/],
  ['rejects a missing add_dirs folder', (d) => edit(d, 'evals/save-to-file/case.yaml', (t) => t.replace('history_file: history.jsonl', 'history_file: history.jsonl\n  add_dirs: [docs]')),
    /save-to-file\/case\.yaml: add_dirs entry "docs" is not a fixture folder in the case folder/],
  // Values, with the CLI's limits.
  ['rejects runs out of range', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('max_turns: 16', 'max_turns: 16\nruns: 0')), /spanish-quick\/prompt\.md: runs must be a whole number from 1 to 50/],
  ['rejects max_turns out of range', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('max_turns: 16', 'max_turns: 201')), /spanish-quick\/prompt\.md: max_turns must be a whole number from 1 to 200/],
  ['rejects timeout_seconds out of range', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('timeout_seconds: 480', 'timeout_seconds: 0')),
    /spanish-quick\/prompt\.md: timeout_seconds must be a whole number from 1 to 3600/],
  ['rejects an env that is not a mapping', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('max_turns: 16', 'max_turns: 16\nenv: EVAL_X')), /spanish-quick\/prompt\.md: env must be a mapping/],
  ['rejects an env key without the EVAL_ prefix', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('max_turns: 16', 'max_turns: 16\nenv:\n  FOO: bar')),
    /spanish-quick\/prompt\.md: env key "FOO" must match EVAL_\[A-Z0-9_\]\* \(other keys fail the run\)/],
  ['rejects an env value that is not a string', (d) => edit(d, `${SPANISH}/prompt.md`, (t) => t.replace('max_turns: 16', 'max_turns: 16\nenv:\n  EVAL_X: 1')),
    /spanish-quick\/prompt\.md: env value of EVAL_X must be a string/],
  // This repo's rules for how the cases run and score (checkSuiteRules). Two-arm runs leave a
  // tool_used grader on Skill out of the score unless it sets arm: both (finding 46, D27).
  ['rejects a trigger case whose Skill grader two-arm runs leave out of the score', (d) => edit(d, 'evals/trigger-natural-phrasing/graders/02-skill-fired.md', (t) => t.replace('arm: both\n', '')),
    /error: evals\/trigger-natural-phrasing\/graders\/02-skill-fired\.md: a trigger case's Skill grader needs arm: both; without it, two-arm runs leave it out of the score \(repo rule\)/],
  ['rejects a trigger case without a tool_used grader on Skill', (d) => rmSync(join(d, 'evals/no-trigger-plain-task/graders/01-skill-not-fired.md')),
    /error: evals\/no-trigger-plain-task: a case tagged trigger needs a tool_used grader on Skill \(repo rule\)/],
  // Every case pins one agent model, and a history case the model it was recorded on (finding 47, D28).
  ['rejects a case that does not pin the agent model', (d) => edit(d, 'evals/video-veo-quick/prompt.md', (t) => t.replace(/^model: .*\n/m, '')),
    /error: evals\/video-veo-quick\/prompt\.md: set model: to pin the agent under test; without it, the model comes from --model, ANTHROPIC_MODEL or Claude Code's default \(repo rule\)/],
  ['rejects cases that pin different models', (d) => edit(d, 'evals/video-veo-quick/prompt.md', (t) => t.replace(/^model: .*$/m, 'model: claude-opus-5-5')),
    /error: evals: cases pin different models \(claude-sonnet-5-5 in \d+ cases; claude-opus-5-5 in video-veo-quick\); pin one agent model in every case \(repo rule\)/],
  // build.mjs refreshes a history's skill text and Read results, not its models: only this rule sees the change.
  ['rejects a history recorded on another model than its case pins', (d) => edit(d, 'evals/save-to-file/history.jsonl', (t) => t.replace('"model":"claude-sonnet-5-5"', '"model":"claude-opus-5-5"')),
    /error: evals\/save-to-file\/history\.jsonl: recorded on claude-opus-5-5, but prompt\.md pins claude-sonnet-5-5; record it again on claude-sonnet-5-5 \(repo rule\)\n\n1 error\(s\)/],
  // Cases that need --allow-tools or --scaffold carry the needs-write tag, and a check that passes
  // with zero calls has a tools-granted check beside it (finding 53, D32).
  ['rejects a case that lists a granted tool without the needs-write tag', (d) => edit(d, 'evals/save-to-file/prompt.md', (t) => t.replace(', needs-write]', ']')),
    /error: evals\/save-to-file: allowed_tools lists Write, which only --allow-tools grants; tag it needs-write \(repo rule\)/],
  ['names the scaffold_script too when a case without the needs-write tag has one', (d) => edit(d, 'evals/imperative-coding-no-action/prompt.md', (t) => t.replace(', needs-write]', ']')),
    /error: evals\/imperative-coding-no-action: allowed_tools lists Write, Edit, which only --allow-tools grants, and context\.scaffold_script runs only with --scaffold; tag it needs-write \(repo rule\)/],
  ['rejects zero-call checks without a tools-granted check', (d) => rmSync(join(d, 'evals/injection-is-content-quick/graders/05-tools-granted.md')), [
    /error: evals\/injection-is-content-quick\/graders\/02-no-file-writes\.md: with min: 0 this check passes when Write isn't granted, with zero calls; add a tools-granted regex grader \(target: trace\) that requires "Write" \(repo rule\)/,
    /error: evals\/injection-is-content-quick\/graders\/04-no-file-edits\.md: with min: 0 this check passes when Edit isn't granted, with zero calls; add a tools-granted regex grader \(target: trace\) that requires "Edit" \(repo rule\)/]],
  ['rejects a zero-call check on a tool the case does not list', (d) => edit(d, 'evals/injection-is-content-quick/prompt.md', (t) => t.replace(', Write, Edit]', ']')), [
    /error: evals\/injection-is-content-quick\/graders\/02-no-file-writes\.md: list Write in allowed_tools, so that the progress output names it as not granted when --allow-tools leaves it out \(repo rule\)/,
    /error: evals\/injection-is-content-quick\/graders\/04-no-file-edits\.md: list Edit in allowed_tools, so that the progress output names it as not granted when --allow-tools leaves it out \(repo rule\)/]],
  // The token is built at run time, so this file holds none. CI logs are public, so the
  // message names the line and kind but not the token.
  ['rejects a recorded history that looks private', (d) => edit(d, 'evals/save-to-file/history.jsonl', (t) => t.replace('handmade ceramic mug', `handmade ceramic mug, token gh${'p'}_${'R'.repeat(36)}`)),
    /evals\/save-to-file\/history\.jsonl line 1: GitHub token \(looks private; remove it or record again\)/, 1, /ghp_/],
  // Text that a prompt.md commits on purpose, such as the safety eval's fake key, is public.
  ['accepts a recorded history that holds the safety eval\'s fake key', (d) => edit(d, 'evals/save-to-file/history.jsonl', (t) => t.replace('handmade ceramic mug', `handmade ceramic mug, key ${FAKE_KEY}`)),
    /validate: OK/, 0],
  // History cases: the recording against the method (finding 56). Step 1d recorded save-to-file
  // again (D34), so no recording breaks a rule, and nothing only warns.
  ['passes every recording, save-to-file\'s included, without a warning', () => {}, /validate: OK/, 0, /^warning:/m],
  // The problems of save-to-file's old recording, its search for AskUserQuestion and the menu it
  // repeated in a message of its own, are errors, even in that recording's message.
  ['rejects the problems of save-to-file\'s old recording as errors, not warnings', (d) => editRows(d, `${SAVE_CASE}/history.jsonl`, (rows) => {
    const last = rows.at(-1);
    const assistant = (content, stop) => ({ ...structuredClone(last), message: { ...structuredClone(last.message), id: OLD_MENU, content, stop_reason: stop } });
    return [...rows,
      assistant([{ type: 'tool_use', id: 'toolu_search', name: 'ToolSearch', input: { query: 'select:AskUserQuestion', max_results: 1 } }], 'tool_use'),
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_search', content: 'No matching deferred tools found' }] } },
      assistant([{ type: 'text', text: 'Pick one by number:\n\n1. **Fill placeholders** ★\n2. **Refine**\n3. **Save to file**' }], 'end_turn'),
    ];
  }), [
    /^error: evals\/save-to-file\/history\.jsonl: line 14 calls AskUserQuestion or searches for it; eval runs have no dialog tool, and SKILL\.md says to use the text format straight away, so record it again \(repo rule\)$/m,
    /^error: evals\/save-to-file\/history\.jsonl: the last recorded assistant text is neither a question round \(with "Reply `ok` to accept every ★"\) nor an output with its Full prompt and What next\? headings in one message; record it again \(repo rule\)$/m,
  ], 1, /^warning:/m],
  // Cut by hand right after the output of a message that went on to call a tool, as the old
  // save-to-file recording's did, the recording ends on a row that waits for a tool result.
  ['rejects a recording that stops in the middle of a turn', (d) => editRows(d, `${SAVE_CASE}/history.jsonl`, (rows) => {
    const id = rows.at(-1).message.id;
    for (const r of rows) if (r.type === 'assistant' && r.message.id === id) r.message.stop_reason = 'tool_use';
    return rows;
  }), /^error: evals\/save-to-file\/history\.jsonl: line 13, the last assistant row, has stop_reason tool_use, not end_turn, so the recorded turn didn't end; record it again \(repo rule\)\n\n1 error\(s\)$/m],
  ['rejects a recorded search for AskUserQuestion', (d) => editRows(d, `${OK_CASE}/history.jsonl`, (rows) => {
    const search = structuredClone(rows[4]);
    search.message.content = [{ type: 'tool_use', id: 'toolu_search', name: 'ToolSearch', input: { query: 'select:AskUserQuestion', max_results: 1 } }];
    rows.splice(5, 0, search);
    return rows;
  }), /^error: evals\/followup-ok-accepts-recommendations\/history\.jsonl: line 6 calls AskUserQuestion or searches for it;/m],
  ['rejects a recording whose last assistant text is neither a question round nor an output', (d) => editRows(d, `${OK_CASE}/history.jsonl`, (rows) => {
    const menu = structuredClone(rows.at(-1));
    menu.message.content = [{ type: 'text', text: 'Pick one by number:\n\n1. **Run it now** ★\n2. **Refine**' }];
    return [...rows, menu];
  }), /^error: evals\/followup-ok-accepts-recommendations\/history\.jsonl: the last recorded assistant text is neither a question round .* nor an output with its Full prompt and What next\? headings in one message; record it again \(repo rule\)\n\n1 error\(s\)$/m],
  ['rejects a recording whose last assistant row did not end its turn', (d) => editRows(d, `${OK_CASE}/history.jsonl`, (rows) => { rows.at(-1).message.stop_reason = 'max_tokens'; return rows; }),
    /^error: evals\/followup-ok-accepts-recommendations\/history\.jsonl: line 15, the last assistant row, has stop_reason max_tokens, not end_turn,/m],
  ['rejects a contract without the headings the history checks look for', (d) => editJson(d, 'data/contract.json', (j) => { j.required.headings = j.required.headings.map((h) => (h === 'What next?' ? 'Next steps' : h)); }),
    /^error: data\/contract\.json: required lacks the heading "What next\?", which the history checks in scripts\/eval-cases\.mjs look for; change the two together$/m],
  // What a history case's rubrics quote (finding 54): text from the recording or prompt.md, and of
  // the recorded round's options only a ★ answer or one the reply picks.
  ['rejects a quote in a history case\'s rubric that is not in the recording', (d) => edit(d, OK6, (t) => t.replace('"None. Write for the reader first"', '"None. Write for readers first"')),
    /^error: evals\/followup-ok-accepts-recommendations\/graders\/06-accepted-not-assumed\.md: quotes "None\. Write for readers first", which isn't in the recorded conversation or prompt\.md; in a history case's rubric, double quotes mark verbatim text \(repo rule\)$/m],
  ['rejects a quoted option that is not the ★ answer when the reply accepts every ★', (d) => edit(d, OK6, (t) => t.replace('"Balanced look at benefits and challenges"', '"Argue for remote work"')),
    /^error: evals\/followup-ok-accepts-recommendations\/graders\/06-accepted-not-assumed\.md: quotes option 2b \("Argue for remote work"\), which is neither the ★ answer nor one the reply in prompt\.md picks \(repo rule\)$/m],
  ['rejects a quoted option that the reply did not pick', (d) => edit(d, PARTIAL6, (t) => t.replace('"About 1,500\u{2013}2,000 words, in-depth"', '"Under 600 words, short and punchy"')),
    /^error: evals\/followup-partial-answers\/graders\/06-accepted-not-assumed\.md: quotes option 4c \("Under 600 words, short and punchy"\)/m],
  ['accepts a quote that differs from the recording only in dashes and code marks', (d) => edit(d, OK6, (t) => t.replace('3\u{2013}5 ideas', '3-5 ideas').replace('`[[placeholders]]`', '[[placeholders]]')), /validate: OK/, 0],
  // "remote work" is in option 2b and in the user's request, which a rubric may quote.
  ['accepts a quote from the user\'s request that an option also holds', (d) => put(d, `${OK_CASE}/graders/09-topic.md`, grader('llm', 'focus: last_message\n',
    '\nThe post must stay on the user\'s topic, "remote work", and not drift.\nPASS if it does. FAIL otherwise.\n')), /validate: OK/, 0],
  ['does not check the quotes of a case without a recording', (d) => edit(d, 'evals/writing-quick-launch-email/graders/11-no-invention.md', (t) => `${t}\nFor example "foo bar baz".\n`), /validate: OK/, 0],
  // A rubric that judges the answers of the round the recording ends in quotes one of its options
  // word for word, also when it speaks only of what was recommended or of what the user accepted
  // (eval-cases.test.mjs checks a rubric that speaks only of options).
  ['rejects a follow-up rubric about the accepted answers that quotes none of the options', (d) => {
    put(d, `${OK_CASE}/graders/09-recommended.md`, grader('llm', 'focus: last_message\n', '\nPASS if the prompt follows every recommended default of the round. FAIL otherwise.\n'));
    put(d, `${OK_CASE}/graders/10-accepted.md`, grader('llm', 'focus: last_message\n', '\nPASS if the prompt reflects every default the user accepted. FAIL otherwise.\n'));
  }, ['09-recommended', '10-accepted'].map((n) => new RegExp(`^error: evals/followup-ok-accepts-recommendations/graders/${n}\\.md: judges the answers to the question round the recording ends in, but quotes none of its options; quote each answer it checks word for word, in double quotes \\(repo rule\\)$`, 'm'))],
  // Every output case, the cases build.mjs writes lint graders for, has a no-invention judge (finding 49, D30).
  ['rejects an output case without a no-invention judge', (d) => rmSync(join(d, `${VEO}/07-no-invention.md`)),
    /^error: evals\/video-veo-quick: an output case \(LINT_GRADER_CASES in scripts\/build\.mjs\) needs an llm grader named <n>-no-invention\.md, which checks that every name, number, date or URL the user didn't give is a placeholder or an assumption \(repo rule\)\n\n1 error\(s\)$/m],
  // The request text a rubric quotes, in <original_prompt> tags or after "The user's whole
  // request", is the case's own, word for word (finding 50). A gloss outside the quotes doesn't count.
  ['rejects a rubric that misquotes the request', (d) => put(d, `${SPANISH}/graders/09-request.md`, grader('llm', 'focus: last_message\n',
    '\nThe user\'s whole request, in Spanish, was "escribe un post de LinkedIn sobre mi trabajo nuevo" (write a LinkedIn post about my new job), in quick mode.\nPASS if no detail is invented. FAIL otherwise.\n')),
  /^error: evals\/spanish-quick\/graders\/09-request\.md: the quoted request "escribe un post de LinkedIn sobre mi trabajo nuevo" isn't in prompt\.md word for word \(repo rule\)$/m],
  ['rejects an <original_prompt> block that differs from prompt.md', (d) => put(d, 'evals/strong-prompt-minimal-changes/graders/09-original.md', grader('llm', 'focus: last_message\n',
    '\n<original_prompt>\nI\'m writing release notes for version 2.5.\n</original_prompt>\nPASS if its wording is kept. FAIL otherwise.\n')),
  /^error: evals\/strong-prompt-minimal-changes\/graders\/09-original\.md: the <original_prompt> text isn't in prompt\.md word for word \(repo rule\)$/m],
  ['rejects an <original_prompt> tag without its closing tag', (d) => put(d, 'evals/strong-prompt-minimal-changes/graders/09-original.md', grader('llm', 'focus: last_message\n',
    '\n<original_prompt>\nI\'m writing release notes for version 2.5.\n</original-prompt>\nPASS if its wording is kept. FAIL otherwise.\n')),
  /^error: evals\/strong-prompt-minimal-changes\/graders\/09-original\.md: an <original_prompt> tag without its closing tag, or an empty block, which validate\.mjs can't check \(repo rule\)$/m],
  ['rejects "The user\'s whole request" without the request in quotes on its line', (d) => put(d, `${SPANISH}/graders/09-request.md`, grader('llm', 'focus: last_message\n',
    '\nThe user\'s whole request was:\n"escribe un post de LinkedIn sobre mi trabajo nuevo"\nPASS if no detail is invented. FAIL otherwise.\n')),
  /^error: evals\/spanish-quick\/graders\/09-request\.md: "The user's whole request" isn't followed by the request in quotes on the same line, which validate\.mjs can't check \(repo rule\)$/m],
  ['accepts a follow-up rubric that quotes the request from the recording', (d) => put(d, `${OK_CASE}/graders/09-request.md`, grader('llm', 'focus: last_message\n',
    '\nThe user\'s whole request was "write a blog post about remote work", and they replied "ok" to the questions.\nPASS if no detail is invented. FAIL otherwise.\n')), /validate: OK/, 0],
  // A regex grader on the file that the recorded menu offers to save must tell the recorded Full
  // prompt from the Short version (finding 55).
  ['rejects a saved-file regex that does not match the recorded Full prompt', (d) => edit(d, SAVE05, (t) => t.replace('Food-safe', 'Food safe')),
    /^error: evals\/save-to-file\/graders\/05-file-is-the-full-prompt\.md: pattern doesn't match the recorded Full prompt, so a correct save would fail; derive it again from history\.jsonl \(repo rule\)$/m],
  ['rejects a saved-file regex that also matches the recorded Short version', (d) => edit(d, SAVE05, (t) => t.replace(/^pattern: .*$/m, "pattern: 'Etsy'")),
    /^error: evals\/save-to-file\/graders\/05-file-is-the-full-prompt\.md: pattern also matches the recorded Short version, so it can't tell the two apart \(repo rule\)\n\n1 error\(s\)$/m],
  ['rejects a not_contains saved-file regex that matches the recorded Full prompt', (d) => edit(d, SAVE06, (t) => t.replace(/^pattern: .*$/m, "pattern: 'Goal'")),
    /^error: evals\/save-to-file\/graders\/06-file-is-not-the-whole-reply\.md: not_contains pattern matches the recorded Full prompt, so a correct save would fail; derive it again from history\.jsonl \(repo rule\)$/m],
  ['rejects a saved-file regex in a history case whose recording offers no save path', (d) => put(d, `${OK_CASE}/graders/09-file.md`, read(d, SAVE05)),
    /^error: evals\/followup-ok-accepts-recommendations: 09-file\.md read a saved file, but the recording shows no output whose What next\? menu names a save path to check them against \(repo rule\)$/m],
  ['rejects saved-file regexes when the recorded Full prompt is not fenced', (d) => editOutput(d, (t) => t.replace('### Full prompt\n```text\n', '### Full prompt\n').replace('what I should add.\n```\n', 'what I should add.\n')), [
    /^error: evals\/save-to-file\/graders\/05-file-is-the-full-prompt\.md: reads the saved file, but the recorded output has no fenced Full prompt to check it against \(repo rule\)$/m,
    /^error: evals\/save-to-file\/graders\/06-file-is-not-the-whole-reply\.md: reads the saved file, but the recorded output has no fenced Full prompt/m,
  ]],
  ['does not check a saved-file regex on another path', (d) => edit(d, SAVE05, (t) => t.replace('Food-safe', 'Food safe').replace(`path: ${SAVE_PATH}`, 'path: prompts/other.md')), /validate: OK/, 0],
  ['checks a saved-file regex that spells the save path another way', (d) => edit(d, SAVE05, (t) => t.replace('Food-safe', 'Food safe').replace(`path: ${SAVE_PATH}`, `path: ./${SAVE_PATH}`)),
    /^error: evals\/save-to-file\/graders\/05-file-is-the-full-prompt\.md: pattern doesn't match the recorded Full prompt/m],
  // A scaffold can put other text at the save path, such as a file the save must not overwrite, so
  // in a case with a scaffold_script the checked file is the one a save writes when that path is
  // taken: the save path with -2 added to the name.
  ['does not check a saved-file regex on the menu\'s save path in a case with a scaffold_script', (d) => {
    edit(d, SAVE05, (t) => t.replace('Food-safe', 'Food safe'));
    edit(d, `${SAVE_CASE}/case.yaml`, (t) => t.replace('  history_file: history.jsonl', '  history_file: history.jsonl\n  scaffold_script: place-files.sh'));
    put(d, `${SAVE_CASE}/place-files.sh`, '#!/bin/sh\n');
  }, /validate: OK/, 0],
  ['checks a saved-file regex on the save path with -2 added in a case with a scaffold_script', (d) => edit(d, SAVE_EXISTING05, (t) => t.replace('Food-safe', 'Food safe')),
    /^error: evals\/save-to-file-existing\/graders\/05-file-is-the-full-prompt\.md: pattern doesn't match the recorded Full prompt, so a correct save would fail; derive it again from history\.jsonl \(repo rule\)\n\n1 error\(s\)$/m],
  // ---- generated files
  ['rejects a stale generated file', (d) => edit(d, `${REF}/media-targets.md`, (t) => `${t}\nhand edit\n`), /references\/media-targets\.md: stale; run node scripts\/build\.mjs/],
  // The eval lint graders are generated from data/lint-rules.json (finding 59, D36). build.mjs
  // never deletes a file, so a lint grader it doesn't write is reported too.
  ['rejects a hand-edited lint grader', (d) => edit(d, 'evals/research-quick-vector-databases/graders/lint-prompt.md', (t) => t.replace('IMPORTANT', 'IMPORTANT|URGENT')),
    /evals\/research-quick-vector-databases\/graders\/lint-prompt\.md: stale; run node scripts\/build\.mjs/],
  ['reports every lint grader that a rule change makes stale', (d) => editJson(d, 'data/lint-rules.json', (j) => {
    const r = j.rules.find((x) => x.id === 'pressure-words');
    r.pattern = r.pattern.replace('IMPORTANT', 'IMPORTANT|URGENT');
  }), Object.keys(LINT_GRADER_CASES).map((c) => new RegExp(`evals/${reEsc(c)}/graders/lint-prompt\\.md: stale`))],
  ['rejects a lint grader that build.mjs does not write', (d) => put(d, 'evals/coding-vague-asks-questions/graders/lint-prompt.md', '---\ntype: regex\npattern: x\n---\n'),
    /evals\/coding-vague-asks-questions\/graders\/lint-prompt\.md: looks generated, but scripts\/build\.mjs doesn't write it; delete it or add the case to LINT_GRADER_CASES/],
  // With the build failed, no file counts as written: the other cases' graders aren't listed.
  ['reports a lint-grader case that is gone, and lists no lint grader as unwritten', (d) => rmSync(join(d, 'evals/spanish-quick'), { recursive: true }),
    /error: build failed: LINT_GRADER_CASES in scripts\/build\.mjs names evals\/spanish-quick\/graders, which does not exist/, 1, /looks generated/],
  // ---- text that must make no difference
  ['passes with CRLF line endings', (d) => {
    for (const f of [SKILL, `${REF}/media-targets.md`, CORE, 'data/contract.json']) edit(d, f, (t) => t.replace(/\n/g, '\r\n'));
  }, /validate: OK/, 0],
  // claude plugin eval removes a BOM before it reads a grader's front matter.
  ['passes with CRLF eval files and a BOM before a grader\'s front matter', (d) => {
    crlfEvalFiles(d);
    edit(d, `${VEO}/01-negative-prompt-block.md`, (t) => `\u{FEFF}${t}`);
  }, /validate: OK/, 0],
  ['ignores the files Finder and Explorer write into folders', (d) => {
    for (const f of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) {
      put(d, `skills/prompt-engine/${f}`, 'x');
      put(d, `${REF}/${f}`, 'x');
      put(d, `evals/${f}`, 'x');
      put(d, `evals/spanish-quick/graders/${f}`, 'x');
    }
  }, /validate: OK/, 0],
];

// Rules on tracked files, which need a git copy: [name, mutate(dir, git), expected, code, unexpected].
// The directory rules warn (D40), so those runs pass. Rows add with -f, as gitCopy does, so that a
// gitignore can't refuse a file a row means to track.
const GIT_ROWS = [
  ['warns about a tracked file of 256 KiB or more, but not about a smaller or an untracked one', (d, git) => {
    put(d, 'docs/big.md', 'x'.repeat(256 * 1024));
    put(d, 'docs/small.md', 'x'.repeat(256 * 1024 - 1));
    put(d, 'docs/local.md', 'x'.repeat(300_000));
    git(['add', '-f', 'docs/big.md', 'docs/small.md']);
  }, /warning: docs\/big\.md: 262144 bytes; Anthropic's plugin directory holds/, 0, [/small\.md/, /local\.md/]],
  ['warns about more than 512 tracked files', (d, git) => {
    for (let i = 0; i < 520; i++) put(d, `many/${i}.md`, `${i}\n`);
    git(['add', '-f', 'many']);
  }, /warning: the plugin folder \(the repository root\) has \d+ tracked files; Anthropic's plugin directory holds a plugin with more than 512/, 0],
  ['warns about a tracked binary file that is not an image or font, but not about the PNG icons', (d, git) => {
    put(d, 'docs/guide.pdf', Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]));
    git(['add', '-f', 'docs/guide.pdf']);
  }, /warning: docs\/guide\.pdf: a binary file; Anthropic's plugin directory holds/, 0, /icon\.png/],
  // Memory files at the plugin root (finding 73): refused when tracked, and only then, so a
  // maintainer's private copy passes.
  ...['AGENTS.md', 'CLAUDE.local.md'].flatMap((f) => [
    [`rejects a tracked ${f} at the plugin root`, (d, git) => { put(d, f, '# Notes\n'); git(['add', '-f', f]); },
      new RegExp(`(^|\\n)error: ${reEsc(f)}: don't commit it at the plugin root: Claude Code can load it as project memory`), 1],
    [`ignores an untracked ${f} at the plugin root`, (d) => put(d, f, '# Notes\n'), /validate: OK/, 0],
  ]),
  // A fixture a case names but git ignores works here and is missing from a clean checkout
  // (finding 67). A tracked one is in every checkout, so it passes.
  ['rejects a fixture that a case names but git ignores', (d) => {
    put(d, `evals/no-trigger-plain-task/${SESSION}`, '{"type":"user"}\n');
    put(d, 'evals/no-trigger-plain-task/graders/09-baseline.md', grader('baseline', `baseline_file: ${SESSION}\n`, '\nPASS if the reply is at least as good as the reference.\n'));
  }, new RegExp(`(^|\\n)error: evals/no-trigger-plain-task/${reEsc(SESSION)}: ignored by \\.gitignore, so a clean checkout lacks it \\(git check-ignore -v evals/no-trigger-plain-task/${reEsc(SESSION)} names the rule\\)`)],
  ['accepts a fixture that git ignores once it is tracked', (d, git) => {
    put(d, `evals/no-trigger-plain-task/${SESSION}`, '{"type":"user"}\n');
    put(d, 'evals/no-trigger-plain-task/graders/09-baseline.md', grader('baseline', `baseline_file: ${SESSION}\n`, '\nPASS if the reply is at least as good as the reference.\n'));
    git(['add', '-f', `evals/no-trigger-plain-task/${SESSION}`]);
  }, /validate: OK/, 0],
];

test('the repository passes as-is', () => {
  const dir = copyRepo();
  try {
    const { code, out } = validate(dir);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('copies a checkout in a folder named like a skipped entry, still without its build output', () => {
  const parent = mkdtempSync(join(tmpdir(), 'pe-rootname-'));
  const from = join(parent, 'mcpb');
  mkdirSync(join(from, 'mcp', 'dist'), { recursive: true });
  writeFileSync(join(from, 'LICENSE'), '');
  writeFileSync(join(from, 'mcp', 'dist', 'cli.js'), '');
  const dir = copyRepo(from);
  try {
    assert.deepEqual(readdirSync(dir, { recursive: true }).sort(), ['LICENSE', 'mcp']);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// The git copies under conditions that broke them: a gitignore that covers every path, and the
// repository variables that git exports to a hook. Each runs a GIT_ROWS row through the helpers.
const gitRow = (name) => {
  const row = GIT_ROWS.find(([n]) => n === name);
  assert.ok(row, name);
  inGitCopy(...row.slice(1));
};
// A git copy tracks every file the checkout tracks (when the checkout has .git).
function copyTracksCheckout() {
  if (!existsSync(join(repo, '.git'))) return;
  const { dir, git } = gitCopy();
  try {
    const list = (out) => out.split('\0').filter((f) => f && existsSync(join(dir, f))).sort();
    const checkout = list(spawnSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8', env: gitEnv() }).stdout);
    assert.ok(checkout.length > 100, `${checkout.length} tracked files`);
    assert.deepEqual(list(git(['ls-files', '-z'])), checkout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// Sets environment variables for one call, then puts them back.
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

test('git copies track the checkout\'s files and a row\'s, even when a gitignore covers every path', { skip: !hasGit && 'needs git' }, () => {
  const cfg = mkdtempSync(join(tmpdir(), 'pe-gitconfig-'));
  try {
    writeFileSync(join(cfg, 'ignore'), '*\n');
    writeFileSync(join(cfg, 'config'), `[core]\n\texcludesFile = ${join(cfg, 'ignore').replaceAll('\\', '/')}\n`);
    withEnv({ GIT_CONFIG_GLOBAL: join(cfg, 'config') }, () => {
      copyTracksCheckout();
      gitRow('rejects a tracked AGENTS.md at the plugin root');
    });
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('git copies leave alone the repository that GIT_DIR and GIT_INDEX_FILE name', { skip: !hasGit && 'needs git' }, () => {
  const other = mkdtempSync(join(tmpdir(), 'pe-hook-'));
  const git = (...args) => spawnSync('git', args, { cwd: other, encoding: 'utf8', env: gitEnv() });
  try {
    git('init', '-q');
    writeFileSync(join(other, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    const before = git('ls-files', '--stage').stdout;
    assert.match(before, /\ta\.txt\n$/);
    withEnv({ GIT_DIR: join(other, '.git'), GIT_INDEX_FILE: join(other, '.git', 'index') }, () => {
      copyTracksCheckout();
      gitRow('rejects a tracked AGENTS.md at the plugin root');
      gitRow('ignores an untracked AGENTS.md at the plugin root');
    });
    assert.equal(git('ls-files', '--stage').stdout, before, 'the other repository\'s index is unchanged');
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

for (const [name, mutate, expected, code, unexpected] of ROWS) test(name, () => withMutation(mutate, expected, code, unexpected));
for (const [name, mutate, expected, code, unexpected] of GIT_ROWS) {
  test(name, { skip: !hasGit && 'needs git' }, () => inGitCopy(mutate, expected, code, unexpected));
}
