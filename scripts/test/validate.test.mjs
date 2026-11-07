// Mutation tests for scripts/validate.mjs. Each row of ROWS changes a temporary copy of the
// repository and validates it: the run must exit with the row's code (1 unless the row says
// otherwise) and print every message the row expects. Every reachable err() call in
// validate.mjs has a row, and some have several: each SUBSTITUTIONS pattern, each
// FORBIDDEN_ROOT name, each way the frontmatter can fail to parse.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Build output and tool state the checks don't read: copying them only slows the tests down.
const SKIP = new Set(['.git', 'node_modules', 'results', 'dist', 'dist-mcpb', 'mcpb', '.wrangler']);

function copyRepo(from = repo) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-validate-'));
  // The checkout itself is copied whatever its folder is called; SKIP applies to what's inside it.
  cpSync(from, dir, { recursive: true, filter: (src) => src === from || !SKIP.has(basename(src)) });
  return dir;
}

function validate(dir) {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'validate.mjs')], {
    env: { ...process.env, PE_ROOT: dir }, encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

// `expected` is a regex or a list of regexes that must all match the output.
function expectRun({ code: got, out }, expected, code) {
  assert.equal(got, code, `expected exit ${code}, got:\n${out}`);
  for (const re of [expected].flat()) assert.match(out, re);
}

function withMutation(mutate, expected, code = 1) {
  const dir = copyRepo();
  try {
    mutate(dir);
    expectRun(validate(dir), expected, code);
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
];

// Same list as FORBIDDEN_ROOT in scripts/validate.mjs; keep the two in step. It is copied on
// purpose: a name dropped from validate.mjs then fails its row.
const FORBIDDEN_ROOT = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'node_modules', 'bin',
  'CLAUDE.md', '.mcp.json', '.lsp.json', 'commands', 'agents', 'hooks', 'settings.json', 'SKILL.md',
  'output-styles', 'monitors', 'workflows', 'themes'];

const ROWS = [
  // ---- frontmatter
  ...FRONTMATTER_REJECTED.map(([name, mutate, msg]) => [`rejects frontmatter with ${name}, and reports only that`, mutate, onlyError(msg)]),
  ['accepts extra spaces after a frontmatter colon and trailing spaces', (d) => edit(d, SKILL, (t) => t.replace(/^description: /m, 'description:    ').replace('license: MIT', 'license: MIT   ')), /validate: OK/, 0],
  ['accepts a tab inside a quoted value and a line of spaces', (d) => edit(d, SKILL, (t) => t.replace('description: "Use to', 'description: "Use\tto').replace('license: MIT', 'license: MIT\n   ')), /validate: OK/, 0],
  ['rejects a SKILL.md without frontmatter', (d) => edit(d, SKILL, (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '')), /SKILL\.md: missing YAML frontmatter/],
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
  // ---- output contract
  ['rejects a contract artifact that does not exist', (d) => editJson(d, 'data/contract.json', (j) => { j.artifacts['docs/missing.md'] = ['markers']; }), /docs\/missing\.md: listed in data\/contract\.json but missing/],
  ['rejects a missing contract heading', (d) => edit(d, CORE, (t) => t.replaceAll('Fill before running', 'Fill in')), /universal\/prompt-engine\.md: missing contract string "Fill before running" \(headings\)/],
  // ---- plugin root
  ...FORBIDDEN_ROOT.map((f) => [`rejects ${f} at the plugin root`, (d) => writeFileSync(join(d, f), ''), new RegExp(`(^|\\n)error: ${reEsc(f)}: not allowed at the repo root`)]),
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
  ['requires https sources', (d) => editJson(d, 'data/media-targets.json', (j) => { j.targets[0].sources = ['http://example.com/docs']; }), /media-targets\.json \S+: needs https sources/],
  ['rejects a malformed last_verified date', (d) => editJson(d, 'data/media-targets.json', (j) => { j.targets[0].last_verified = '2026-1-29'; }), /media-targets\.json \S+: last_verified must be/],
  // ---- eval cases
  ['rejects an eval case without prompt.md or case.yaml', (d) => mkdirSync(join(d, 'evals/empty-case')), /evals\/empty-case: needs prompt\.md or case\.yaml/],
  ['rejects an eval case without graders', (d) => put(d, 'evals/no-graders/prompt.md', 'hello\n'), /evals\/no-graders: needs at least one grader in graders\//],
  // ---- generated files
  ['rejects a stale generated file', (d) => edit(d, `${REF}/media-targets.md`, (t) => `${t}\nhand edit\n`), /references\/media-targets\.md: stale; run node scripts\/build\.mjs/],
  // ---- text that must make no difference
  ['passes with CRLF line endings', (d) => {
    for (const f of [SKILL, `${REF}/media-targets.md`, CORE, 'data/contract.json']) edit(d, f, (t) => t.replace(/\n/g, '\r\n'));
  }, /validate: OK/, 0],
  ['ignores the files Finder and Explorer write into folders', (d) => {
    for (const f of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) {
      put(d, `skills/prompt-engine/${f}`, 'x');
      put(d, `${REF}/${f}`, 'x');
    }
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

for (const [name, mutate, expected, code] of ROWS) test(name, () => withMutation(mutate, expected, code));
