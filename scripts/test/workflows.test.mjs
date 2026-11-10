// Checks of the GitHub workflow files. Nothing else reads them: actionlint, which CI runs on them,
// checks their syntax and shell code, not what they promise, so a workflow with a safeguard taken
// out is still valid. These tests pin down those promises, each with the review finding or owner
// decision it comes from. Many read the run: scripts as text. The steps that hold a safeguard also
// run under bash, with stand-ins for gh, npm and curl, so nothing reaches GitHub, npm or the network:
// the on-main, CHANGELOG and tag checks, the release build's MCP tests, the npm, MCP Registry and
// GitHub release steps, the two steps that download a tool, and the data check's filter and issue.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(join(repo, file), 'utf8').replace(/\r\n/g, '\n');

// A reader for the YAML these files are written in. It throws on anything else, so that a
// construct it doesn't know fails here instead of being misread: maps nested by indentation; lists
// of maps or of single values; plain, 'single-quoted' and simple "double-quoted" values; flow lists
// such as [main] and the empty map {}; | blocks; comments on their own line or after a value.
// Every plain value stays a string, so `node-version: 22` reads as '22' and `false` as 'false'.
// On the four workflow files it gives what Ruby's YAML parser gives, with values as strings.
// It also throws on a tab, a control character, and a line break other than LF (a CRLF reads as
// LF). YAML 1.1 readers, among them Ruby's, actionlint's and the YamlDotNet in GitHub's runner
// code, end a line at CR, NEL (U+0085), LS (U+2028) and PS (U+2029) too, even inside a comment,
// so the rest of such a line would be YAML or shell code to them and a comment here.
function readYaml(text, file) {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const fail = (n, why) => { throw new Error(`${file}:${n + 1}: ${why}`); };
  const spaces = (l) => l.match(/^ */)[0].length;
  const ITEM = /^-(?: |$)/;
  const KEY = /^([A-Za-z_][\w.-]*):(?: +(.*))?$/;
  const CONTROL = /[\x00-\x08\x0B-\x1F\x7F-\x9F\u{2028}\u{2029}\u{FEFF}\u{FFFE}\u{FFFF}]/u;
  raw.forEach((l, n) => {
    if (l.includes('\t')) fail(n, 'a tab');
    const c = CONTROL.exec(l)?.[0];
    if (c) fail(n, `a control character or a line break other than LF (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
  });
  let pos = 0;
  let pending = null; // the rest of a "- key: value" line: the first key of the entry's map
  const peek = () => {
    if (pending) return pending;
    while (pos < raw.length && /^ *(?:#.*)?$/.test(raw[pos])) pos++;
    return pos < raw.length ? { n: pos, indent: spaces(raw[pos]), text: raw[pos].trimStart() } : null;
  };
  const take = () => { const t = peek(); if (pending) pending = null; else pos++; return t; };
  const node = (t) => (ITEM.test(t.text) ? list(t.indent) : map(t.indent));

  function list(indent) {
    const out = [];
    for (let t = peek(); t && t.indent === indent && ITEM.test(t.text); t = peek()) {
      take();
      const rest = t.text.slice(1).trimStart();
      if (rest === '' || rest.startsWith('#')) fail(t.n, 'a list entry with its value on the next line');
      if (KEY.test(rest)) {
        pending = { n: t.n, indent: indent + t.text.length - rest.length, text: rest };
        out.push(map(pending.indent));
      } else out.push(scalar(rest, t.n));
    }
    return out;
  }

  function map(indent) {
    const out = {};
    for (let t = peek(); t && t.indent === indent && !ITEM.test(t.text); t = peek()) {
      take();
      const m = KEY.exec(t.text);
      if (!m) fail(t.n, `expected "key:" or "key: value": ${t.text}`);
      const key = m[1];
      if (Object.hasOwn(out, key)) fail(t.n, `duplicate key ${key}`);
      const rest = m[2] ?? '';
      if (/^\|(?: +#.*)?$/.test(rest)) out[key] = block(indent, t.n);
      else if (/^[|>]/.test(rest)) fail(t.n, `only plain | blocks are read: ${rest}`);
      else if (rest === '' || rest.startsWith('#')) {
        const c = peek();
        out[key] = c && (c.indent > indent || (c.indent === indent && ITEM.test(c.text))) ? node(c) : null;
      } else out[key] = scalar(rest, t.n);
    }
    const t = peek();
    if (t && t.indent > indent) fail(t.n, 'indented more than the keys before it');
    return out;
  }

  // A | block: the lines after its key that are blank or indented more than the key, without
  // their common indentation, ending in one line break.
  function block(indent, n) {
    const body = [];
    while (pos < raw.length && (raw[pos].trim() === '' || spaces(raw[pos]) > indent)) body.push(raw[pos++]);
    while (body.length && body.at(-1).trim() === '') body.pop();
    if (!body.length) fail(n, 'an empty | block');
    const cut = spaces(body.find((l) => l.trim() !== ''));
    body.forEach((l, i) => { if (l.trim() !== '' && spaces(l) < cut) fail(n + 1 + i, 'a block line indented less than the first'); });
    return `${body.map((l) => l.slice(cut)).join('\n')}\n`;
  }

  function scalar(v, n) {
    if (v.startsWith("'")) {
      const m = /^'((?:[^']|'')*)'(?: +#.*)?$/.exec(v);
      if (!m) fail(n, `unreadable single-quoted value: ${v}`);
      return m[1].replace(/''/g, "'");
    }
    if (v.startsWith('"')) {
      const m = /^"([^"\\]*)"(?: +#.*)?$/.exec(v);
      if (!m) fail(n, `unreadable double-quoted value (escapes aren't read): ${v}`);
      return m[1];
    }
    if (v.startsWith('[')) {
      const m = /^\[([^[\]{}#]*)\](?: +#.*)?$/.exec(v);
      if (!m) fail(n, `unreadable flow list: ${v}`);
      return m[1].trim() === '' ? [] : m[1].split(',').map((e) => scalar(e.trim(), n));
    }
    if (v.startsWith('{')) {
      if (!/^\{\}(?: +#.*)?$/.test(v)) fail(n, `only the empty map {} is read: ${v}`);
      return {};
    }
    if (/^[&*!%@`|>]/.test(v)) fail(n, `unsupported value: ${v}`);
    const plain = v.replace(/ +#.*$/, '').trim();
    if (/: |:$/.test(plain)) fail(n, `a plain value with ": " in it: ${plain}`);
    return plain;
  }

  const doc = peek() ? map(0) : {};
  const left = peek();
  if (left) fail(left.n, 'not read');
  return doc;
}

const FILES = ['ci.yml', 'release.yml', 'evals.yml', 'verify-data.yml'];
const wf = Object.fromEntries(FILES.map((f) => [f, readYaml(read(`.github/workflows/${f}`), `.github/workflows/${f}`)]));
const { 'ci.yml': ci, 'release.yml': release, 'evals.yml': evals, 'verify-data.yml': verify } = wf;
const releaseText = read('.github/workflows/release.yml');

const jobs = (doc) => Object.entries(doc.jobs);
const steps = (doc) => jobs(doc).flatMap(([job, j]) => j.steps.map((s, i) => ({ ...s, job, i })));
const uses = (s, action) => typeof s.uses === 'string' && s.uses.startsWith(`${action}@`);
const label = (s) => `job ${s.job}, step ${s.i + 1} (${s.name ?? s.uses})`;
// The first step of a job with this name, or that `find` accepts, with its job and index.
function step(doc, job, find, what) {
  const i = (doc.jobs[job]?.steps ?? []).findIndex((x, k) => (typeof find === 'string' ? x.name === find : find(x, k)));
  assert.ok(i >= 0, `no step ${what ?? `named "${find}"`} in job ${job}`);
  return { ...doc.jobs[job].steps[i], job, i };
}
const runs = (re) => (s) => typeof s.run === 'string' && re.test(s.run);
// The jobs that a job waits for, directly or through other jobs.
function after(doc, name, seen = new Set()) {
  const needs = doc.jobs[name].needs;
  for (const n of needs === undefined ? [] : [].concat(needs)) if (!seen.has(n)) { seen.add(n); after(doc, n, seen); }
  return seen;
}
// Asserts that the strings appear in `text`, each once at least, in this order.
function inOrder(text, parts, what) {
  let at = -1;
  for (const p of parts) {
    const i = text.indexOf(p, at + 1);
    assert.ok(i > at, `${what}: "${p}" missing, or not after "${parts[parts.indexOf(p) - 1] ?? ''}"`);
    at = i;
  }
}

// Runs a step's script under bash -e, as GitHub runs a run: block on Linux when no shell is set,
// in a new folder (or the folder cwd names in it, as a step's working-directory), with stand-ins
// first on PATH. Each stand-in logs its arguments, then runs the shell code given for it.
// RUNNER_TEMP is a folder of its own in it. GH_CONFIG_DIR and npm's user config point at the empty
// folder, so even a real gh or npm reached by mistake would have no login. The tester's tokens, npm
// settings and variables that change how bash or node start don't reach the step, and neither do
// the files through which a step on GitHub sets variables, PATH or outputs for later steps, so a
// step run here can't change the CI job that runs these tests. With errexit: false the script runs
// without -e, as it would after a line that turns errexit off. The files that readBack names, in
// the step's folder, come back in files.
const NO_BASH = (process.platform === 'win32' && 'the stand-ins for gh and npm are shell scripts')
  || (spawnSync('bash', ['--version']).error && 'needs bash');
const NO_JQ = NO_BASH || (spawnSync('jq', ['--version']).error && 'needs jq');
function runStep(script, { stubs, env = {}, files = {}, cwd = '.', errexit = true, readBack = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-workflow-step-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    mkdirSync(join(dir, 'runner-temp'));
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(join(bin, name), `#!/bin/bash\n{ printf '%s' ${name}; printf ' [%s]' "$@"; printf '\\n'; } >> "$STUB_LOG"\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), text);
    }
    mkdirSync(join(dir, cwd), { recursive: true });
    writeFileSync(join(dir, 'step.sh'), script);
    writeFileSync(join(dir, 'npmrc'), '');
    const log = join(dir, 'calls.log');
    writeFileSync(log, '');
    const keep = Object.entries(process.env).filter(([k]) => !/^(PATH|GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN|NPM_OWNER|npm_config_.*|BASH_ENV|ENV|SHELLOPTS|BASHOPTS|NODE_OPTIONS|GITHUB_(?:ENV|PATH|OUTPUT|STATE|STEP_SUMMARY))$/i.test(k));
    const r = spawnSync('bash', ['--noprofile', '--norc', ...(errexit ? ['-e'] : []), join(dir, 'step.sh')], {
      cwd: join(dir, cwd),
      encoding: 'utf8',
      env: {
        ...Object.fromEntries(keep),
        PATH: [bin, dirname(process.execPath), process.env.PATH ?? ''].join(delimiter),
        STUB_LOG: log,
        RUNNER_TEMP: join(dir, 'runner-temp'),
        GH_CONFIG_DIR: dir,
        NPM_CONFIG_USERCONFIG: join(dir, 'npmrc'),
        npm_config_registry: 'http://127.0.0.1:9/',
        ...env,
      },
    });
    const back = readBack.filter((f) => existsSync(join(dir, cwd, f))).map((f) => [f, readFileSync(join(dir, cwd, f), 'utf8')]);
    return { code: r.status, out: `${r.stdout}${r.stderr}`, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean), files: Object.fromEntries(back) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the reader reads all four workflows, and every step runs an action or a script', () => {
  for (const f of FILES) {
    assert.ok(jobs(wf[f]).length > 0, `${f} has jobs`);
    for (const s of steps(wf[f])) assert.ok(typeof s.uses === 'string' || typeof s.run === 'string', `${f}, ${label(s)}`);
  }
  assert.throws(() => readYaml('a:\n  b: >\n    folded\n', 'x.yml'), /x\.yml:2: only plain \| blocks are read/);
  assert.throws(() => readYaml('a: {b: c}\n', 'x.yml'), /x\.yml:1: only the empty map/);
  assert.throws(() => readYaml('a:\n  b: c\n    d: e\n', 'x.yml'), /x\.yml:3: indented more than/);
  // A line break other than LF in a comment, inside a run: block (line 6) and between steps (line 4):
  // YAML 1.1 readers start a new line there, so `exit 0` and the hidden step would be code to them.
  for (const c of ['\r', '\u{85}', '\u{2028}', '\u{2029}', '\u{B}']) {
    const code = `U\\+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
    assert.throws(() => readYaml(`jobs:\n  a:\n    steps:\n      - run: |\n          echo a\n          # note${c}          exit 0\n`, 'x.yml'), new RegExp(`x\\.yml:6: .*${code}`));
    assert.throws(() => readYaml(`jobs:\n  a:\n    steps:\n      # note${c}      - run: echo hidden\n      - run: echo shown\n`, 'x.yml'), new RegExp(`x\\.yml:4: .*${code}`));
  }
  assert.deepEqual(readYaml('a:\r\n  b: c\r\n', 'x.yml'), { a: { b: 'c' } }, 'CRLF line ends read as LF');
});

// GitHub runs every .yml or .yaml file in .github/workflows, and CI's actionlint step lints only
// *.yml. So a workflow that these tests don't read would escape all of them, and actionlint too as
// .yaml. The folder holds the four files above and nothing else, apart from the files an operating
// system leaves in a folder, which .gitignore lists.
test('.github/workflows holds only the four workflows these tests read, so a new one needs tests of its own', () => {
  const found = readdirSync(join(repo, '.github', 'workflows')).filter((f) => !['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(f));
  assert.deepEqual(found.sort(), [...FILES].sort(), 'GitHub runs every .yml and .yaml file in .github/workflows: a new workflow needs tests here');
});

test('no run: script holds a ${{ }} expression; values reach scripts through env: (finding 30)', () => {
  for (const f of FILES) {
    for (const s of steps(wf[f])) assert.ok(!(s.run ?? '').includes('${{'), `${f}, ${label(s)}: pass the value through env: instead`);
  }
});

// The tests below look for each safeguard's lines, which stay in place when the safeguard is switched
// off where it stands. A step with continue-on-error lets its job pass when it fails, and a job with
// it lets the run pass; GitHub runs a run: script with bash -e, which `|| true`, `set +e`, `shopt -u
// errexit` or a shell of the step's own can undo. So none of these appear in the four workflows (the
// Windows job names bash, which GitHub runs with -e and pipefail). ERREXIT_OFF also finds set +e
// among other options (set -u +e, set +eu), quoted, or after builtin, command or eval. A text check
// can't find every way to turn errexit off, so the checksum lines also stop their steps on their own,
// and the steps that download a tool run without -e as well, further down.
const ERREXIT_OFF = /\bset\b[^\n;&|]*?[ \t]["']?\+(?:[a-zA-Z]*e|o["']?[ \t]+["']?errexit\b)|\bshopt\b[^\n;&|]*\berrexit\b/;
test('no job or step lets a failure through: no continue-on-error, no || true or set +e, no shell but bash', () => {
  for (const l of ['set +e', 'set -u +e', 'set +eu', 'set +o errexit', 'shopt -uo errexit', 'builtin set +e', 'command set +e', '{ set +e; }', 'true; set +e', 'eval "set +e"', 'set "+e"']) assert.match(l, ERREXIT_OFF, l);
  for (const l of ['set -e', 'set -euo pipefail', 'set +x', 'set +o pipefail', 'set -o errexit', 'echo "${X:-not set}" +1']) assert.doesNotMatch(l, ERREXIT_OFF, l);
  for (const f of FILES) {
    assert.equal(wf[f].defaults, undefined, `${f}: defaults for the whole workflow`);
    for (const [name, j] of jobs(wf[f])) {
      assert.equal(j['continue-on-error'], undefined, `${f}, job ${name}`);
      assert.ok([undefined, 'bash'].includes(j.defaults?.run?.shell), `${f}, job ${name}: shell ${j.defaults?.run?.shell}`);
    }
    for (const s of steps(wf[f])) {
      assert.equal(s['continue-on-error'], undefined, `${f}, ${label(s)}`);
      assert.ok([undefined, 'bash'].includes(s.shell), `${f}, ${label(s)}: shell ${s.shell}`);
      assert.doesNotMatch(s.run ?? '', /\|\|\s*(?:true|:)(?=[\s;)&|#]|$)/m, `${f}, ${label(s)}: a command whose failure is ignored`);
      assert.doesNotMatch(s.run ?? '', ERREXIT_OFF, `${f}, ${label(s)}: errexit turned off`);
    }
  }
});

// GitHub skips a job or step whose if: is false, and reports a skipped job as a success, which a
// required check accepts (docs.github.com, "Control jobs with conditions"). So these are the only
// conditions; the release and data-check jobs' repository guards are tested further down.
test('the only if: conditions are the Node 22 steps in ci.yml and the evals.yml steps that run after a failure', () => {
  const allowed = { 'ci.yml': ['matrix.node == 22'], 'evals.yml': ['${{ !cancelled() }}', 'always()'], 'release.yml': [], 'verify-data.yml': [] };
  for (const f of FILES) {
    for (const s of steps(wf[f])) if (s.if !== undefined) assert.ok(allowed[f].includes(s.if), `${f}, ${label(s)}: if: ${s.if}`);
  }
  for (const f of ['ci.yml', 'evals.yml']) for (const [name, j] of jobs(wf[f])) assert.equal(j.if, undefined, `${f}, job ${name}`);
});

// bash runs the file that BASH_ENV names before a step's script, so an env: entry could redefine exit
// or turn errexit off there without a change to the script. ENV, SHELLOPTS and BASHOPTS also change
// how bash starts, NODE_OPTIONS how node does, and NPM_CONFIG_* variables what npm does. So the env:
// maps set only these variables, and no script writes to GITHUB_ENV or GITHUB_PATH, which set
// variables and PATH for the job's later steps.
const ENV_KEYS = ['GH_TOKEN', 'GH_REPO', 'NPM_OWNER', 'MCP_PUBLISHER_VERSION', 'MCP_PUBLISHER_SHA256', 'ACTIONLINT_VERSION', 'ACTIONLINT_SHA256', 'ANTHROPIC_API_KEY', 'RUNS', 'MAX_COST_USD'];
test('env: sets only the variables listed here, none of which changes how bash, node or npm start, and no script writes to GITHUB_ENV or GITHUB_PATH', () => {
  for (const f of FILES) {
    const maps = [['workflow', wf[f].env], ...jobs(wf[f]).flatMap(([name, j]) => [[`job ${name}`, j.env], ...j.steps.map((s, i) => [label({ ...s, job: name, i }), s.env])])];
    for (const [where, env] of maps) for (const k of Object.keys(env ?? {})) assert.ok(ENV_KEYS.includes(k), `${f}, ${where}: env: ${k}`);
    for (const s of steps(wf[f])) assert.doesNotMatch(s.run ?? '', /GITHUB_(?:ENV|PATH)\b/, `${f}, ${label(s)}: writes to GITHUB_ENV or GITHUB_PATH`);
  }
});

// A tag such as actions/checkout@v7 is moved by the action's publisher with each release, so what
// runs with the release's OIDC token or write permission could change with no commit here.
test('every action is pinned to a full commit SHA, with its version in a comment, the same in every workflow', () => {
  const pins = new Map();
  for (const f of FILES) {
    for (const line of read(`.github/workflows/${f}`).split('\n').filter((l) => /^ *(?:- )?uses:/.test(l))) {
      const m = /^ *(?:- )?uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)$/.exec(line);
      assert.ok(m, `${f}: "${line.trim()}" isn't written as owner/repo@<full commit SHA> # vX.Y.Z`);
      const pin = `${m[2]} # ${m[3]}`;
      assert.equal(pins.get(m[1]) ?? pin, pin, `${m[1]} is pinned to one commit in every workflow`);
      pins.set(m[1], pin);
    }
  }
  assert.deepEqual([...pins.keys()].sort(), ['actions/checkout', 'actions/download-artifact', 'actions/setup-node', 'actions/upload-artifact']);
});

test('release.yml runs only for a pushed v* tag, and with no secrets (D15)', () => {
  assert.deepEqual(release.on, { push: { tags: ['v*'] } });
  assert.doesNotMatch(releaseText, /secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/, 'npm and the MCP Registry log in with GitHub OIDC');
});

// GitHub runs a fork's workflows once its owner turns Actions on. A fork can't publish this package
// or these registry names, so the release would only fail there, and the data check would fail on
// the fork's issues, which start turned off. So the first job of each names this repository, the one
// mcp/package.json names (npm's trusted publishing checks that too); the release's other jobs wait
// for its build job, so they skip with it.
test('release.yml and verify-data.yml run only in the repository mcp/package.json names, so a fork skips them', () => {
  const url = JSON.parse(read('mcp/package.json')).repository?.url ?? '';
  const home = /^git\+https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\.git$/.exec(url)?.[1];
  assert.ok(home, `mcp/package.json's repository.url names a GitHub repository: ${url}`);
  const guard = `github.repository == '${home}'`;
  assert.equal(release.jobs.build.if, guard, "release.yml's build job");
  for (const [name, j] of jobs(release)) {
    if (name === 'build') continue;
    assert.ok(after(release, name).has('build'), `${name} waits for build`);
    assert.equal(j.if, undefined, `release.yml's ${name} job has no if: of its own, which could start it when build is skipped`);
  }
  for (const [name, j] of jobs(verify)) assert.equal(j.if, guard, `verify-data.yml's ${name} job`);
});

test('release.yml grants nothing to the whole workflow, and to each job only what it needs (finding 27, D16)', () => {
  assert.deepEqual(release.permissions, {});
  assert.deepEqual(Object.fromEntries(jobs(release).map(([name, j]) => [name, j.permissions])), {
    build: { contents: 'read' },
    'pack-check': { contents: 'read' },
    'github-release': { contents: 'write' },
    npm: { contents: 'read', 'id-token': 'write' },
    registry: { contents: 'read', 'id-token': 'write' },
  });
});

test('release.yml: the jobs that can request an OIDC token run in the release environment, meant for v* tags only', () => {
  // npm's trusted publisher matches the owner, repository, workflow file and environment, and the
  // MCP Registry only the owner: neither looks at the branch or tag. The environment's tag rule,
  // which the owner creates in the repository's settings before the first tag (docs/publishing.md),
  // is what ties publishing to v* tags.
  const oidc = jobs(release).filter(([, j]) => j.permissions?.['id-token'] === 'write').map(([name]) => name);
  assert.deepEqual(oidc, ['npm', 'registry']);
  for (const name of oidc) assert.equal(release.jobs[name].environment, 'release', `job ${name}`);
});

test('release.yml: every checkout drops the token it was given (finding 27)', () => {
  const checkouts = steps(release).filter((s) => uses(s, 'actions/checkout'));
  assert.ok(checkouts.length > 0);
  for (const s of checkouts) assert.equal(s.with?.['persist-credentials'], 'false', label(s));
});

// A stand-in for `gh api <path>` that answers API_PATH with API_BODY. With API_ERROR set, it fails as
// gh does on an HTTP error: the error body on stdout, unfiltered, and the error on stderr. Like gh, it
// applies only the last --jq or -q filter given, here with real jq, and it fails on any other option,
// so that the step's own filter decides what the step reads from the answer.
const GH_API = `[ "$1 $2" = "api $API_PATH" ] || { echo "gh stand-in: unexpected call: gh $*" >&2; exit 64; }
shift 2
q=""
while [ $# -gt 0 ]; do
  case "$1" in
    --jq|-q) q="$2"; shift;;
    --jq=*) q="\${1#--jq=}";;
    -q?*) q="\${1#-q}"; q="\${q#=}";;
    *) echo "gh stand-in: $1 isn't modelled" >&2; exit 64;;
  esac
  shift
done
[ -z "$API_ERROR" ] || { printf '%s\\n' "$API_BODY"; echo "gh: $API_ERROR" >&2; exit 1; }
if [ -n "$q" ]; then printf '%s' "$API_BODY" | jq -r "$q"; else printf '%s\\n' "$API_BODY"; fi`;

test('release.yml: the build job first stops unless the tagged commit is on main, and every other job waits for it (finding 32, D16)', { skip: NO_JQ }, () => {
  const [first] = release.jobs.build.steps;
  assert.match(first.run ?? '', /^status="\$\(gh api "repos\/\$\{GITHUB_REPOSITORY\}\/compare\/main\.\.\.\$\{GITHUB_SHA\}" --jq \.status\)"$/m, 'the first step compares the commit with main');
  // GitHub's answer for main...<commit>: the status, with the counts that go with it.
  const compare = (status) => JSON.stringify({
    status,
    ahead_by: ['ahead', 'diverged'].includes(status) ? 2 : 0,
    behind_by: ['behind', 'diverged'].includes(status) ? 3 : 0,
    base_commit: { sha: '89abcde' },
    merge_base_commit: { sha: 'fedcba9' },
  });
  const go = (env) => runStep(first.run, { stubs: { gh: GH_API }, env: { GITHUB_REPOSITORY: 'example/repo', GITHUB_SHA: '0123abc', GITHUB_REF_NAME: 'v0.1.0', API_PATH: 'repos/example/repo/compare/main...0123abc', ...env } });
  for (const status of ['identical', 'behind']) {
    const r = go({ API_BODY: compare(status) });
    assert.equal(r.code, 0, `${status}: a commit on main goes on: ${r.out}`);
  }
  for (const status of ['ahead', 'diverged', '']) {
    const r = go({ API_BODY: compare(status) });
    assert.equal(r.code, 1, `${status || 'no status'} stops the run: ${r.out}`);
    assert.match(r.out, /^::error::v0\.1\.0 \(0123abc\) is not on main/m);
  }
  assert.notEqual(go({ API_BODY: '{"message":"Not Found","status":"404"}', API_ERROR: 'Not Found (HTTP 404)' }).code, 0, 'a failed compare stops the run');
  for (const [name] of jobs(release)) if (name !== 'build') assert.ok(after(release, name).has('build'), `${name} waits for build`);
});

test('release.yml: the build stops on a tag that differs from the version before anything is packed (finding 32)', () => {
  const all = release.jobs.build.steps;
  const tag = all.findIndex(runs(/^node scripts\/release\.mjs --tag "\$\{GITHUB_REF_NAME\}"$/m));
  const pack = all.findIndex(runs(/\bnpm pack\b/));
  assert.ok(tag > 0 && pack > tag, 'release.mjs --tag "${GITHUB_REF_NAME}" runs, before npm pack');
});

// Step 3 of Cut a release dates the version's CHANGELOG.md heading, and the tagged tree is what
// ships. version.mjs only reminds, so a tag pushed before then must stop in the build job.
test("release.yml stops unless CHANGELOG.md has a dated heading for the tag's version, before it builds anything", { skip: NO_BASH }, () => {
  const s = step(release, 'build', runs(/CHANGELOG\.md/), 'that reads CHANGELOG.md');
  assert.ok(s.i < step(release, 'build', runs(/release\.mjs --tag/), 'that builds the release files').i, 'before the release files are built');
  const go = (tag, heading) => runStep(s.run, {
    stubs: {},
    env: { GITHUB_REF_NAME: tag },
    files: heading === undefined ? {} : { 'CHANGELOG.md': `# Changelog\n\n## [Unreleased]\n\n${heading}\n\nFirst version.\n` },
  });
  for (const [tag, heading] of [['v0.2.0', '## [0.2.0] - 2026-11-10'], ['v0.2.0', '## [0.2.0] - 2026-11-10\r'], ['v1.0.0-rc.1', '## [1.0.0-rc.1] - 2027-01-31']]) {
    const r = go(tag, heading);
    assert.equal(r.code, 0, `${tag} with ${JSON.stringify(heading)}: ${r.out}`);
  }
  for (const heading of [undefined, '## [0.2.0] - not yet released', '## [0.2.0]', '## [0.1.0] - 2026-11-10', '## [10.2.0] - 2026-11-10', '## [0x2y0] - 2026-11-10', '### [0.2.0] - 2026-11-10', ' ## [0.2.0] - 2026-11-10', '## [0.2.0] - 2026-11-10 (yanked)', '## [0.2.0] - 10/11/2026']) {
    const r = go('v0.2.0', heading);
    assert.equal(r.code, 1, `${heading === undefined ? 'no CHANGELOG.md' : JSON.stringify(heading)} stops the release: ${r.out}`);
    assert.match(r.out, /^::error::CHANGELOG\.md has no "## \[0\.2\.0\] - YYYY-MM-DD" heading/m);
  }
});

// publishing.md's step 6 says the release tests the MCP server before it builds anything. So the
// build job's install, build or test failing stops the job, with nothing run after the failed command.
test('release.yml: the build job stops when installing, building or testing the MCP server fails, before the release files are built', { skip: NO_BASH }, () => {
  const s = step(release, 'build', runs(/^npm test$/m), 'that runs the MCP tests');
  assert.ok(s.i < step(release, 'build', runs(/release\.mjs --tag/), 'that builds the release files').i, 'the tests run before the release files are built');
  // The stand-in npm fails the command NPM_FAILS names.
  const npm = `case "$*" in
  "$NPM_FAILS") echo "npm error code 1" >&2; exit 1;;
  ci|"run build"|test) exit 0;;
  *) exit 64;;
esac`;
  const go = (NPM_FAILS = 'nothing') => runStep(s.run, { stubs: { npm }, cwd: s['working-directory'] ?? '.', env: { NPM_FAILS } });
  let r = go();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.calls, ['npm [ci]', 'npm [run] [build]', 'npm [test]'], 'it installs what the lockfile pins, builds and runs the tests');
  for (const [fails, call] of [['ci', 'npm [ci]'], ['run build', 'npm [run] [build]'], ['test', 'npm [test]']]) {
    r = go(fails);
    assert.notEqual(r.code, 0, `a failed npm ${fails} fails the step: ${r.out}`);
    assert.equal(r.calls.at(-1), call, `nothing runs after the failed npm ${fails}: ${r.calls.join(' | ')}`);
  }
});

// test:pack installs the packed package as npx does, so its dependencies' own dependencies come
// fresh from the registry, outside mcp/package-lock.json, as npm install, update or exec would. Code
// that nothing pins must not run where it could change the files that the publishing jobs take, or
// in a job that can request an OIDC token. So outside the pack-check job, npm runs only the commands
// below, which install nothing or only what the lockfile pins. A command is the word after npm where
// a command starts (a line, or after if, then, else, elif, do, while, until, !, ;, &, |, (, ), { or a
// backquote), with run's script name. It counts after NAME=value words, or after a wrapper command
// such as sudo, env, time, exec or bash -c and the words that follow it, and for npm quoted, escaped
// or named by its path. npm also takes any unambiguous start of a command's name, so a list of what's
// barred would miss some.
const PINNED_NPM = ['ci', 'run build', 'test', 'pack', 'view', 'publish'];
const NPM_COMMAND = new RegExp([
  String.raw`(?:^|[;&|()!{\x60]|\b(?:if|then|else|elif|do|while|until)\b)[ \t]*`,
  String.raw`(?:(?:[A-Za-z_]\w*=|(?:sudo|doas|env|command|builtin|exec|eval|time|nice|nohup|timeout|stdbuf|xargs|setsid|(?:ba|da|z|k)?sh)\b)[^\n;&|]*?[ \t])?`,
  String.raw`["'\\]?(?:[^\s;&|"'\x60]*\/)?npm["']?[ \t]+([^\s;&|)\x60]+)(?:[ \t]+([^\s;&|)\x60]+))?`,
].join(''), 'gm');
function npmCommands(run) {
  const code = run.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  return [...code.matchAll(NPM_COMMAND)].map((m) => (m[1] === 'run' || m[1] === 'run-script' ? `run ${m[2]}` : m[1]));
}
// Other package runners and ways to fetch code: npx, pnpm, yarn, bun, corepack, deno, pip, uv, wget,
// docker or podman; a gh command other than api and release create; git clone, fetch, pull, submodule
// or remote; fetch( in node code; a URL; and a pipe into a shell.
const FETCHES = /\b(?:npx|pnpm|pnpx|yarn|bunx?|corepack|deno|pipx?|uvx?|wget|docker|podman)\b|smoke-pack|\bgh[ \t]+(?!api\b|release[ \t]+create\b)[\w-]|\bgit\b[^\n;&|]*?\b(?:clone|fetch|pull|submodule|remote)\b|\bfetch\(|\b[a-z][a-z0-9+.-]*:\/\/|\|[ \t]*(?:sudo[ \t]+)?(?:ba|da|z|k)?sh\b/;

// These read the commands as written: one that runs npm or fetches code through a variable or through
// another program, such as node, gets past them, so a reviewer still reads each change to these jobs.
test('release.yml: outside the pack-check job, npm runs only commands that install what the lockfile pins or nothing, no step runs another package runner or fetches code in the ways listed, and only the registry step runs curl or names a URL', () => {
  assert.deepEqual(npmCommands('npm ci\nif npm view x version; then\n  # npm install x\n  a="$(npm run test:pack -- y)"\nfi\nnpm -g i z\n'), ['ci', 'view', 'run test:pack', '-g']);
  assert.deepEqual(npmCommands('CI=1 npm install x\nenv -u CI npm update\nsudo -E npm i -g npm@latest\ntime -p "npm" install x\n\\npm exec y\n/usr/bin/npm ci;\n{ npm test; }\nbash -c "npm install x"\ncommand -v npm\necho "not on npm yet"\n'),
    ['install', 'update', 'i', 'install', 'exec', 'ci', 'test', 'install']);
  for (const l of ['npx y', 'pnpm dlx y', 'yarn dlx y', 'bunx y', 'corepack enable', 'pip install y', 'wget y', 'gh release download v1 -R a/b', 'git -C d clone a', `node -e 'fetch(u)'`, 'echo https://example.com/x', 'x | bash']) assert.match(l, FETCHES, l);
  for (const l of ['gh api "repos/a/b" --jq .sha', 'gh release create "$t" --verify-tag', 'x | sha256sum -c -', 'printf x | node -e "y"']) assert.doesNotMatch(l, FETCHES, l);
  for (const [name, j] of jobs(release)) {
    if (name === 'pack-check') continue;
    for (const [i, s] of j.steps.entries()) {
      const what = label({ ...s, job: name, i });
      const code = (s.run ?? '').replace(/^\s*#.*$/gm, '');
      for (const c of npmCommands(code)) assert.ok(PINNED_NPM.includes(c), `${what}: npm ${c}`);
      // The registry step's two curl calls, the lookup and the download that its checksum checks, run
      // below with a stand-in curl that fails on any other URL, so their URLs are the only ones here.
      const registry = name === 'registry' && s.name === 'Publish to the MCP Registry';
      assert.equal((code.match(/\bcurl\b/g) ?? []).length, registry ? 2 : 0, `${what}: curl calls`);
      const rest = registry ? code.replace(/\bcurl\b[^\n;&|]*?"https:\/\/[^"\s]*"/g, 'curl') : code;
      assert.doesNotMatch(rest, FETCHES, `${what}: ${FETCHES.exec(rest)?.[0]}`);
    }
  }
});

test('release.yml: the packed npm package is installed and started in a read-only job of its own, and nothing is published before it passes (finding 79)', () => {
  const check = steps(release).find(runs(/^npm run test:pack -- "\.\.\/dist\/prompt-engine-mcp-\$\{GITHUB_REF_NAME#v\}\.tgz"$/m));
  assert.ok(check, 'a step runs test:pack on the tarball the release publishes');
  assert.equal(check['working-directory'], 'mcp');
  inOrder(check.run, ['npm ci\n', 'npm run build\n', 'npm run test:pack -- '], 'the pack check installs from the lockfile and builds before test:pack');
  const job = release.jobs[check.job];
  assert.ok(!job.steps.some((s) => uses(s, 'actions/upload-artifact')), `job ${check.job} uploads nothing`);
  assert.deepEqual(job.permissions, { contents: 'read' });
  const download = job.steps.findIndex((s) => uses(s, 'actions/download-artifact'));
  assert.ok(download >= 0 && download < check.i, 'it checks the uploaded tarball');
  for (const name of ['github-release', 'npm']) assert.ok([].concat(release.jobs[name].needs).includes(check.job), `${name} waits for job ${check.job}`);
});

test('release.yml: only the build job uploads the release files, as its last step', () => {
  const uploading = jobs(release).filter(([, j]) => j.steps.some((s) => uses(s, 'actions/upload-artifact'))).map(([n]) => n);
  assert.deepEqual(uploading, ['build'], 'one job uploads the release files');
  const all = release.jobs.build.steps;
  const upload = all.findIndex((s) => uses(s, 'actions/upload-artifact'));
  assert.equal(upload, all.length - 1, 'the upload is the build job\'s last step');
});

test("release.yml: every job takes the release files by the ID the build job's upload returned, not by name", () => {
  // Any job of the run can upload an artifact under a name that's taken (overwrite deletes the
  // old one); an ID names one upload. download-artifact also checks the artifact's digest.
  const up = step(release, 'build', (s) => uses(s, 'actions/upload-artifact'), 'that uploads the release files');
  assert.ok(up.id, 'the upload step has an id');
  assert.deepEqual(release.jobs.build.outputs, { 'artifact-id': `\${{ steps.${up.id}.outputs.artifact-id }}` });
  const downloads = steps(release).filter((s) => uses(s, 'actions/download-artifact'));
  assert.deepEqual([...new Set(downloads.map((s) => s.job))].sort(), ['github-release', 'npm', 'pack-check']);
  for (const s of downloads) {
    assert.deepEqual(s.with, { 'artifact-ids': '${{ needs.build.outputs.artifact-id }}', path: 'dist' }, label(s));
    assert.ok([].concat(release.jobs[s.job].needs).includes('build'), `${s.job} lists build in needs:, so needs.build.outputs is set`);
  }
});

test('release.yml: npm publishes the packed tarball through trusted publishing, on Node 24 (findings 26 and 27, D15)', () => {
  const setup = step(release, 'npm', (s) => uses(s, 'actions/setup-node'), 'that sets up Node');
  assert.equal(setup.with['node-version'], '24', 'npm 11.5.1 or later, which Node 22 lacks');
  assert.equal(setup.with['registry-url'], 'https://registry.npmjs.org');
  assert.ok(!release.jobs.npm.steps.some((s) => uses(s, 'actions/checkout')), 'the npm job has no checkout: it publishes the built tarball');
  const { run } = step(release, 'npm', 'Publish to npm');
  assert.match(run, /^ *npm publish "\.\/dist\/prompt-engine-mcp-\$\{version\}\.tgz" --access public --ignore-scripts$/m);
});

// The npm job's publish step, run with a stand-in npm: `npm view <pkg>@<v> version` finds the
// version when ON_NPM is set, `npm view <pkg> maintainers --json` prints MAINTAINERS (or fails when
// LOOKUP_FAILS is set), and a publish succeeds. The tag is v0.1.0.
function npmStep(env) {
  const npm = `case "$1 $2" in
  "view prompt-engine-mcp@"*) [ -n "$ON_NPM" ] && { echo "\${2#*@}"; exit 0; }; echo "npm error 404" >&2; exit 1;;
  "view prompt-engine-mcp") [ -z "$LOOKUP_FAILS" ] || { echo "npm error code E500" >&2; exit 1; }; printf '%s\\n' "$MAINTAINERS"; exit 0;;
  "publish "*) exit 0;;
  *) exit 64;;
esac`;
  return runStep(step(release, 'npm', 'Publish to npm').run, { stubs: { npm }, env: { GITHUB_REF_NAME: 'v0.1.0', ...env } });
}

test('release.yml: a version already on npm counts as published only when NPM_OWNER maintains the package (finding 37)', { skip: NO_BASH }, () => {
  const s = step(release, 'npm', 'Publish to npm');
  assert.equal(s.env?.NPM_OWNER, '${{ vars.NPM_OWNER }}');
  const publish = 'npm [publish] [./dist/prompt-engine-mcp-0.1.0.tgz] [--access] [public] [--ignore-scripts]';

  let r = npmStep({ NPM_OWNER: 'vipul-goel' });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.calls.at(-1), publish, 'a new version is published');
  // npm view prints a maintainer as "name <address> (url)", leaving out the parts it lacks.
  for (const MAINTAINERS of ['["vipul-goel <npm-address>"]', '"vipul-goel <npm-address>"', '[{"name":"vipul-goel"}]', '["vipul-goel <npm-address> (https://example.com/owner)"]', '["vipul-goel (https://example.com/owner)"]', '["vipul-goel"]']) {
    r = npmStep({ ON_NPM: '1', MAINTAINERS, NPM_OWNER: 'vipul-goel' });
    assert.equal(r.code, 0, `${MAINTAINERS}: ${r.out}`);
    assert.ok(!r.calls.includes(publish), `${MAINTAINERS}: skipped, as already published`);
  }
  for (const env of [
    { MAINTAINERS: '["someone-else <npm-address>"]', NPM_OWNER: 'vipul-goel' },
    { MAINTAINERS: '["vipul-goel <npm-address>"]' },
    { MAINTAINERS: '[]', NPM_OWNER: '' },
    { MAINTAINERS: '["vipul-goel-2 <npm-address>"]', NPM_OWNER: 'vipul-goel' },
    { MAINTAINERS: '["vipul-goel <npm-address>"]', NPM_OWNER: 'Vipul-Goel' },
    { LOOKUP_FAILS: '1', NPM_OWNER: 'vipul-goel' },
  ]) {
    r = npmStep({ ON_NPM: '1', ...env });
    assert.equal(r.code, 1, `${JSON.stringify(env)} fails the job: ${r.out}`);
    assert.ok(!r.calls.includes(publish));
  }
});

// npm lists an e-mail address beside each maintainer's name, and the check compares the names
// only. Whatever the step prints goes into the run log and its annotation, so the error names the
// accounts and nothing more.
test("release.yml: the NPM_OWNER error names the package's maintainers by account, without their e-mail addresses", { skip: NO_BASH }, () => {
  const ADDRESS = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/;
  for (const [MAINTAINERS, accounts] of [
    // npm 11 prints "name <address>" strings, over several lines, and "name <address> (url)" for an
    // entry with a URL. The step also reads a single string, and objects, which npm 11 prints for an
    // entry with fields other than a name, an address and a URL.
    ['[\n  "someone-else <someone-else@example.com>",\n  "second-owner <second.owner@example.org>"\n]', 'someone-else, second-owner'],
    ['["someone-else <someone-else@example.com> (https://example.com/someone-else)"]', 'someone-else'],
    ['"someone-else <someone-else@example.com>"', 'someone-else'],
    ['[{"name":"someone-else","email":"someone-else@example.com"},{"name":"second-owner","email":"second.owner@example.org"}]', 'someone-else, second-owner'],
    ['[]', 'none listed'],
  ]) {
    for (const [NPM_OWNER, shown] of [['vipul-goel', 'vipul-goel'], ['', 'not set']]) {
      const r = npmStep({ ON_NPM: '1', MAINTAINERS, NPM_OWNER });
      assert.equal(r.code, 1, r.out);
      // One line, so that the annotation shows all of it.
      assert.deepEqual(r.out.split('\n').filter((l) => l.startsWith('::error::')),
        [`::error::prompt-engine-mcp@0.1.0 is already on npm, but the package's maintainers don't include NPM_OWNER (${shown}): ${accounts}`], r.out);
      assert.doesNotMatch(r.out, ADDRESS, `no e-mail address in the step's output: ${r.out}`);
    }
  }
  // Output that isn't JSON fails the check too, and isn't quoted back: Node's error for it would.
  for (const MAINTAINERS of ['someone-else <someone-else@example.com>', '']) {
    const r = npmStep({ ON_NPM: '1', MAINTAINERS, NPM_OWNER: 'vipul-goel' });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.out, "::error::prompt-engine-mcp@0.1.0 is already on npm, but the package's maintainers don't include NPM_OWNER (vipul-goel): none could be read\n");
  }
});

test('release.yml: the GitHub release is made only for a tag that still exists, and skipped when it is published already (finding 25)', { skip: NO_BASH }, () => {
  // Without --verify-tag, gh release create makes a missing tag from the default branch's head,
  // so a release whose tag was deleted during the run would come back on another commit.
  const s = step(release, 'github-release', runs(/gh release create/), 'that creates the release');
  const gh = `case "$1 $2" in
  "api repos/"*) [ -n "$PUBLISHED" ] && exit 0; echo "HTTP 404: Not Found" >&2; exit 1;;
  "release create") [ -z "$CREATE_FAILS" ] || { echo "tag v0.1.0 doesn't exist in the repo example/repo, aborting due to --verify-tag flag" >&2; exit 1; }; exit 0;;
  *) exit 64;;
esac`;
  const go = (env) => runStep(s.run, { stubs: { gh }, env: { GITHUB_REPOSITORY: 'example/repo', ...env } });
  let r = go({ GITHUB_REF_NAME: 'v0.1.0' });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.calls.at(-1), 'gh [release] [create] [v0.1.0] [--verify-tag] [--generate-notes] [--prerelease] [dist/prompt-engine.zip] [dist/prompt-engine.mcpb] [dist/prompt-engine.md] [dist/prompt-engine-knowledge.md] [dist/SHA256SUMS]');
  r = go({ GITHUB_REF_NAME: 'v1.2.0' });
  assert.match(r.calls.at(-1), /^gh \[release\] \[create\] \[v1\.2\.0\] \[--verify-tag\] \[--generate-notes\] \[dist\//, 'no --prerelease from 1.0 on');
  r = go({ GITHUB_REF_NAME: 'v0.1.0', PUBLISHED: '1' });
  assert.equal(r.code, 0, r.out);
  assert.ok(!r.calls.some((c) => c.startsWith('gh [release] [create]')), 'a published release is left alone');
  // A failed create fails the job, with no second try: one without --verify-tag would make the tag.
  r = go({ GITHUB_REF_NAME: 'v0.1.0', CREATE_FAILS: '1' });
  assert.notEqual(r.code, 0, r.out);
  assert.equal(r.calls.filter((c) => c.startsWith('gh [release]')).length, 1, `one release call: ${r.calls.join('\n')}`);
  assert.match(r.calls.at(-1), /^gh \[release\] \[create\] \[v0\.1\.0\] \[--verify-tag\]/, 'and nothing after it');
});

// The checksum line of each step that downloads a tool. It stops the step on its own when the archive
// doesn't match, not only through bash -e, which a line before it could turn off.
const MCP_CHECK = 'echo "${MCP_PUBLISHER_SHA256}  ${archive}" | sha256sum -c - || { echo "::error::The mcp-publisher archive doesn\'t match MCP_PUBLISHER_SHA256"; exit 1; }';
const LINT_CHECK = 'echo "${ACTIONLINT_SHA256}  ${archive}" | sha256sum -c - || { echo "::error::The actionlint archive doesn\'t match ACTIONLINT_SHA256"; exit 1; }';

// The lines of a run: script after its one checksum line, trimmed. After the check, a script that
// downloads a tool may only unpack the archive and run the tool, so nothing fetches or swaps it again.
function afterCheck(run, check) {
  const lines = run.trimEnd().split('\n').map((l) => l.trim());
  assert.equal(lines.filter((l) => l === check).length, 1, `one line is exactly: ${check}`);
  return lines.slice(lines.indexOf(check) + 1);
}

// A re-run publishes the run's own commit, with its own release.yml, whatever the tag names by then,
// and gh release create --verify-tag only checks that the tag exists. So each job that can publish (it
// can write to the repository or request an OIDC token) first checks that the tag still names the
// run's commit. The commits endpoint gives an annotated tag's commit, and fails for a deleted tag.
test("release.yml: each publishing job first stops unless the tag still names the run's commit (finding 25)", { skip: NO_JQ }, () => {
  const publishing = jobs(release).filter(([, j]) => j.permissions?.contents === 'write' || j.permissions?.['id-token'] === 'write').map(([n]) => n);
  assert.deepEqual(publishing, ['github-release', 'npm', 'registry']);
  const firsts = publishing.map((job) => ({ ...release.jobs[job].steps[0], job, i: 0 }));
  for (const s of firsts) {
    assert.equal(s.name, "The tag still names this run's commit", label(s));
    assert.deepEqual(s.env, { GH_TOKEN: '${{ github.token }}' }, label(s));
    assert.equal(s.run, firsts[0].run, `${label(s)}: the same check in each job`);
  }
  assert.match(firsts[0].run, /^tagged="\$\(gh api "repos\/\$\{GITHUB_REPOSITORY\}\/commits\/\$\{GITHUB_REF\}" --jq \.sha\)"$/m, 'the check reads the commit that the tag names');
  // GitHub's answer for refs/tags/<tag>: the commit the tag names, with its tree and its parent.
  const commit = (sha) => JSON.stringify({ sha, commit: { tree: { sha: '89abcde' }, message: 'Release' }, parents: [{ sha: 'fedcba9' }] });
  const go = (env) => runStep(firsts[0].run, { stubs: { gh: GH_API }, env: { GITHUB_REPOSITORY: 'example/repo', GITHUB_REF: 'refs/tags/v0.1.0', GITHUB_REF_NAME: 'v0.1.0', GITHUB_SHA: '0123abc', API_PATH: 'repos/example/repo/commits/refs/tags/v0.1.0', ...env } });
  let r = go({ API_BODY: commit('0123abc') });
  assert.equal(r.code, 0, `the tag still names the run's commit: ${r.out}`);
  r = go({ API_BODY: commit('4567def') });
  assert.equal(r.code, 1, `a moved tag stops the job: ${r.out}`);
  assert.match(r.out, /^::error::v0\.1\.0 now names 4567def, not this run's commit 0123abc$/m);
  // GitHub's API fails for a deleted tag, and gh prints the error body on stdout.
  r = go({ API_BODY: '{"message":"No commit found for SHA: refs/tags/v0.1.0","status":"422"}', API_ERROR: 'No commit found for SHA: refs/tags/v0.1.0 (HTTP 422)' });
  assert.notEqual(r.code, 0, `a deleted tag stops the job: ${r.out}`);
});

test('release.yml: mcp-publisher is checked against its pinned SHA-256 before it is unpacked or run (finding 28, D17)', () => {
  const { env } = release.jobs.registry;
  assert.match(env?.MCP_PUBLISHER_VERSION ?? '', /^v\d+\.\d+\.\d+$/);
  assert.match(env?.MCP_PUBLISHER_SHA256 ?? '', /^[0-9a-f]{64}$/);
  const { run } = step(release, 'registry', 'Publish to the MCP Registry');
  inOrder(run, [
    'curl -fsSL -o "${archive}" "https://github.com/modelcontextprotocol/registry/releases/download/${MCP_PUBLISHER_VERSION}/',
    MCP_CHECK,
    'tar xzf "${archive}"',
    '"${RUNNER_TEMP}/mcp-publisher" login github-oidc',
    '"${RUNNER_TEMP}/mcp-publisher" publish',
  ], 'the registry job');
  assert.deepEqual(afterCheck(run, MCP_CHECK), [
    'tar xzf "${archive}" -C "${RUNNER_TEMP}" mcp-publisher',
    '"${RUNNER_TEMP}/mcp-publisher" login github-oidc',
    '"${RUNNER_TEMP}/mcp-publisher" publish',
  ], 'after the check, the job only unpacks the archive and runs mcp-publisher');
  assert.deepEqual([].concat(release.jobs.registry.needs), ['npm'], 'the registry checks the npm package, so npm goes first');
});

// The steps that download a tool, run with stand-ins. curl serves an archive that holds a stand-in
// for the tool, which logs "ran <tool>" when it runs, and tar logs each call, then runs the real tar.
// The registry step first looks the version up in the MCP Registry and waits until npm shows it.
const REAL_TAR = NO_BASH ? '' : spawnSync('bash', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim();
const NO_ARCHIVE = NO_BASH || (!REAL_TAR && 'needs tar') || (spawnSync('sha256sum', ['--version']).error && 'needs sha256sum');

// A stand-in for curl that reads the options these steps use as curl does: with -f (--fail) an HTTP
// error exits 22, without it curl exits 0; -o writes the body to a file. It serves FAKE_ARCHIVE for
// DOWNLOAD_URL, answers LOOKUP_URL with LOOKUP_STATUS (404 unless set; "down" fails to connect) and
// any other MCP Registry URL with 200, as for a server with earlier versions. It fails on any other
// option or URL, so a change to these calls shows here.
const CURL = `out=""; url=""; fail=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fail) fail=1;;
    --silent|--show-error|--location) ;;
    --output) out="$2"; shift;;
    --*) echo "curl stand-in: $1 isn't modelled" >&2; exit 64;;
    -?*)
      opts="\${1#-}"
      while [ -n "$opts" ]; do
        o="\${opts:0:1}"; opts="\${opts:1}"
        case "$o" in
          f) fail=1;;
          s|S|L) ;;
          o) if [ -n "$opts" ]; then out="$opts"; else out="$2"; shift; fi; opts="";;
          *) echo "curl stand-in: -$o isn't modelled" >&2; exit 64;;
        esac
      done;;
    *) url="$1";;
  esac
  shift
done
case "$url" in
  "$DOWNLOAD_URL") if [ -n "$out" ]; then cp "$FAKE_ARCHIVE" "$out"; else cat "$FAKE_ARCHIVE"; fi; exit 0;;
  "$LOOKUP_URL") status="\${LOOKUP_STATUS:-404}";;
  https://registry.modelcontextprotocol.io/*) status=200;;
  *) echo "curl stand-in: unexpected URL $url" >&2; exit 64;;
esac
case "$status" in
  200) exit 0;;
  down) echo "curl: (7) Failed to connect" >&2; exit 7;;
  *) [ -z "$fail" ] && exit 0; echo "curl: (22) The requested URL returned error: $status" >&2; exit 22;;
esac`;

// npm view <package>@<version> version, as the registry step's wait calls it: it finds the version
// when NPM_VISIBLE is set.
const REGISTRY_NPM = `case "$1 $2" in
  "view prompt-engine-mcp@"*) [ -n "$NPM_VISIBLE" ] && { echo "\${2#*@}"; exit 0; }; echo "npm error code E404" >&2; exit 1;;
  *) exit 64;;
esac`;

// A .tar.gz in dir that holds a stand-in for the tool, with its SHA-256.
function fakeArchive(dir, tool) {
  const src = join(dir, `${tool}-src`);
  mkdirSync(src);
  writeFileSync(join(src, tool), `#!/bin/bash\n{ printf 'ran %s' ${tool}; printf ' [%s]' "$@"; printf '\\n'; } >> "$STUB_LOG"\n`);
  chmodSync(join(src, tool), 0o755);
  const file = join(dir, `${tool}.tar.gz`);
  const r = spawnSync(REAL_TAR, ['czf', file, '-C', src, tool], { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } });
  assert.equal(r.status, 0, `tar: ${r.stderr}`);
  return { file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') };
}

// The two steps that download a tool, each with the stand-ins and environment it runs with here (its
// own env:, so the pinned SHA-256, and the URLs the stand-in curl answers), and the calls of the tool
// that the step makes when the archive matches.
function downloadSteps() {
  const { name, version } = JSON.parse(read('mcp/server.json'));
  const pins = release.jobs.registry.env;
  const lint = step(ci, 'skill', runs(/actionlint/), 'that runs actionlint');
  return [{
    s: step(release, 'registry', 'Publish to the MCP Registry'),
    tool: 'mcp-publisher',
    pin: 'MCP_PUBLISHER_SHA256',
    stubs: { curl: CURL, npm: REGISTRY_NPM, sleep: 'exit 0' },
    files: { 'mcp/server.json': read('mcp/server.json') },
    env: {
      ...pins,
      DOWNLOAD_URL: `https://github.com/modelcontextprotocol/registry/releases/download/${pins.MCP_PUBLISHER_VERSION}/mcp-publisher_linux_amd64.tar.gz`,
      LOOKUP_URL: `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(name)}/versions/${version}?include_deleted=true`,
      NPM_VISIBLE: '1',
    },
    calls: [/^ran mcp-publisher \[login\] \[github-oidc\]$/, /^ran mcp-publisher \[publish\]$/],
  }, {
    s: lint,
    tool: 'actionlint',
    pin: 'ACTIONLINT_SHA256',
    stubs: { curl: CURL, shellcheck: 'exit 0' },
    files: {},
    env: {
      ...lint.env,
      DOWNLOAD_URL: `https://github.com/rhysd/actionlint/releases/download/v${lint.env.ACTIONLINT_VERSION}/actionlint_${lint.env.ACTIONLINT_VERSION}_linux_amd64.tar.gz`,
    },
    // With the runner's shellcheck, here the stand-in's.
    calls: [/^ran actionlint \[-shellcheck\] \[.+\/bin\/shellcheck\] \[\.github\/workflows\/\*\.yml\]$/],
  }];
}

// GitHub runs these scripts with bash -e, which a line in the script can turn off in more ways than a
// text check finds, so each checksum line stops its step on its own, and the steps also run without -e.
test("release.yml and ci.yml: a downloaded tool whose archive doesn't match its pinned SHA-256 is never unpacked or run, with errexit on or off (finding 28, D17)", { skip: NO_ARCHIVE }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pe-workflow-archive-'));
  try {
    for (const d of downloadSteps()) {
      const fake = fakeArchive(tmp, d.tool);
      const go = (env, errexit = true) => runStep(d.s.run, {
        stubs: { ...d.stubs, tar: 'exec "$REAL_TAR" "$@"' },
        files: d.files,
        cwd: d.s['working-directory'] ?? '.',
        errexit,
        env: { ...d.env, REAL_TAR, FAKE_ARCHIVE: fake.file, ...env },
      });
      for (const errexit of [true, false]) {
        const what = `${d.tool}, ${errexit ? 'under bash -e' : 'without errexit'}`;
        const r = go({}, errexit);
        assert.notEqual(r.code, 0, `${what}: the step fails: ${r.out}`);
        assert.match(r.out, /: FAILED$/m, `${what}: sha256sum checked the download: ${r.out}`);
        assert.deepEqual(r.calls.filter((c) => /^(?:tar|ran) /.test(c)), [], `${what}: nothing is unpacked or run`);
      }
      // The same archive with its own SHA-256 as the pin: the step unpacks it once and runs the tool.
      const r = go({ [d.pin]: fake.sha256 });
      assert.equal(r.code, 0, `${d.tool}: ${r.out}`);
      assert.equal(r.calls.filter((c) => c.startsWith('tar ')).length, 1, `${d.tool}: unpacked once: ${r.calls.join(' | ')}`);
      const ran = r.calls.filter((c) => c.startsWith('ran '));
      assert.ok(ran.length === d.calls.length && ran.every((c, i) => d.calls[i].test(c)), `${d.tool} runs as the step means it to: ${ran.join(' | ')}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// The registry step skips a version only when the registry answers for that version, and sends it
// only once npm shows it, since the registry checks the npm package. The lookup is curl -f: without
// -f, curl exits 0 for a 404 too, and the step would skip every release.
test('release.yml: the MCP Registry step skips only a version the registry has, and publishes only a version npm shows (finding 25)', { skip: NO_ARCHIVE }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pe-workflow-archive-'));
  try {
    const [d] = downloadSteps();
    const version = JSON.parse(read('mcp/server.json')).version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fake = fakeArchive(tmp, d.tool);
    const go = (env) => runStep(d.s.run, { stubs: d.stubs, files: d.files, cwd: d.s['working-directory'], env: { ...d.env, FAKE_ARCHIVE: fake.file, [d.pin]: fake.sha256, ...env } });
    const ran = (r) => r.calls.filter((c) => c.startsWith('ran '));
    let r = go({ LOOKUP_STATUS: '200' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`^Version ${version} is already in the MCP Registry$`, 'm'));
    assert.deepEqual(r.calls.map((c) => c.split(' ')[0]), ['curl'], 'a version the registry has: nothing runs after the lookup');
    for (const LOOKUP_STATUS of ['404', 'down']) {
      r = go({ LOOKUP_STATUS });
      assert.equal(r.code, 0, `${LOOKUP_STATUS}: ${r.out}`);
      assert.ok(ran(r).length === d.calls.length && ran(r).every((c, i) => d.calls[i].test(c)), `a lookup that answers ${LOOKUP_STATUS} doesn't skip: ${r.calls.join(' | ')}`);
    }
    r = go({ NPM_VISIBLE: '' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`^::error::prompt-engine-mcp@${version} is not visible on npm yet`, 'm'));
    assert.equal(r.calls.filter((c) => c.startsWith('curl ')).length, 1, `nothing is downloaded: ${r.calls.join(' | ')}`);
    assert.deepEqual(ran(r), [], "a version npm doesn't show yet is never sent to the registry");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('release.yml: each publishing job skips what is already published, so a failed run can be re-run (finding 25)', () => {
  inOrder(step(release, 'github-release', runs(/gh release create/), 'that creates the release').run,
    ['gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${GITHUB_REF_NAME}" --silent', 'exit 0', 'gh release create'], 'github-release');
  inOrder(step(release, 'registry', 'Publish to the MCP Registry').run,
    ['?include_deleted=true"', 'exit 0', 'login github-oidc'], 'registry');
  const upload = step(release, 'build', (s) => uses(s, 'actions/upload-artifact'), 'that uploads the release files');
  assert.equal(upload.with.overwrite, 'true', 'a re-run of the build job replaces its artifact');
  assert.equal(upload.with['if-no-files-found'], 'error');
});

test('evals.yml runs only by hand; its inputs reach the script as checked environment variables, and only the eval step sees the API key (finding 30)', () => {
  assert.deepEqual(Object.keys(evals.on), ['workflow_dispatch'], 'billed model calls run only when started by hand');
  const all = steps(evals);
  const s = step(evals, 'evals', 'Run the eval suite');
  assert.equal(s.env.RUNS, '${{ inputs.runs }}');
  assert.equal(s.env.MAX_COST_USD, '${{ inputs.max_cost_usd }}');
  inOrder(s.run, [`case "$RUNS" in ''|*[!0-9]*)`, 'exit 1;;', `case "$MAX_COST_USD" in ''|*[!0-9.]*)`, 'exit 1;;', 'claude plugin eval '], 'the eval step checks both inputs before the billed call');
  assert.match(s.run, /--runs "\$RUNS" --max-cost-usd "\$MAX_COST_USD"/);
  assert.equal(s.env.ANTHROPIC_API_KEY, '${{ secrets.ANTHROPIC_API_KEY }}');
  assert.equal(JSON.stringify(evals).split('secrets.').length, 2, 'no other secret, and the key nowhere else (not in a job or workflow env:)');
  assert.deepEqual(all.filter((x) => JSON.stringify(x).includes('ANTHROPIC_API_KEY')).map(label), [label(all[s.i])]);
  const install = all.findIndex(runs(/^npm install -g @anthropic-ai\/claude-code@\d+\.\d+\.\d+$/m));
  assert.ok(install >= 0 && install < s.i, 'Claude Code is installed, at a fixed version, in an earlier step');
});

test('evals.yml pins the judge and leaves the agent model to each case (finding 47, D28)', () => {
  const { run } = step(evals, 'evals', 'Run the eval suite');
  assert.match(run, /--judge-model claude-haiku-5-5\b/);
  assert.doesNotMatch(run, /(?:^|\s)--model\b/, '--model would replace every case\'s pinned model');
});

test("evals.yml fails the run when a skill-started indicator failed, with CONTRIBUTING.md's jq lines (finding 46, D27)", () => {
  const strip = (l) => l.trim().replace(/ (?:"\$out\/aggregate-result\.json"|eval-results\.json)$/, '');
  const documented = read('CONTRIBUTING.md').split('\n').filter((l) => /^jq /.test(l)).map(strip);
  assert.equal(documented.length, 3, "CONTRIBUTING.md's full-suite block has three jq lines");
  const s = step(evals, 'evals', runs(/^jq -e /m), 'that runs the jq -e gate');
  const lines = s.run.split('\n').filter((l) => l.trim() !== '').map(strip);
  for (const l of documented) assert.ok(lines.includes(l), `evals.yml runs: ${l}`);
  assert.match(lines.at(-1), /^jq -e /, "the gate is the last command, so its status is the step's");
  assert.equal(s.if, '${{ !cancelled() }}', 'it also runs when the eval step failed');
  assert.ok(s.i > evals.jobs.evals.steps.findIndex(runs(/claude plugin eval/)));
});

test('verify-data.yml runs weekly with a 45-day window, under the 60 days after which GitHub turns it off (finding 31, D18)', () => {
  assert.deepEqual(verify.on.schedule, [{ cron: '17 6 * * 1' }]);
  assert.ok(Object.hasOwn(verify.on, 'workflow_dispatch'));
  assert.match(step(verify, 'stale', 'Find stale entries').run, /Date\.now\(\) - 45 \* 864e5/);
  assert.deepEqual(verify.permissions, { contents: 'read', issues: 'write' });
});

test('verify-data.yml lists exactly the entries last checked over 45 days ago or without a date it can read (finding 31, D18)', { skip: NO_BASH }, () => {
  // Day 44 is dated 43.5 days back, so it stays inside the window even when the step starts a moment
  // after this line, just before midnight UTC.
  const ago = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const targets = [['Old', '2020-01-01'], ['Day 46', ago(46)], ['Day 44', ago(43.5)], ['Fresh', ago(5)], ['No date', undefined], ['Month 13', '2026-13-01'], ['Not a date', 'soon']]
    .map(([name, last_verified]) => ({ name, last_verified, status: 'verified' }));
  const r = runStep(step(verify, 'stale', 'Find stale entries').run, { stubs: {}, files: { 'data/media-targets.json': JSON.stringify({ targets }) }, readBack: ['stale.md'] });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([...(r.files['stale.md'] ?? '').matchAll(/^- (.+?) \(last checked /gm)].map((m) => m[1]), ['Old', 'Day 46', 'No date', 'Month 13', 'Not a date']);
});

// verify-data.yml's issue step, run with a stand-in gh. `gh issue list` answers from a canned list,
// keeping only the --json fields as gh does and applying the step's own --jq with real jq; every
// other gh call is only logged. Returns every gh call (all), and the calls after the lookup as
// "edit 12" or "create" (calls).
const TITLE = 'Re-verify image/video tool data';
const BOT = { is_bot: true, login: 'app/github-actions' };
function issueStep(issues, env = {}) {
  const gh = `case "$1 $2" in
  "issue list")
    [ "\${LIST_FAILS:-}" = "" ] || exit 1
    q=""; fields=""
    while [ $# -gt 0 ]; do case "$1" in --jq) q="$2";; --json) fields="$2";; esac; shift; done
    printf '%s' "$ISSUES" | jq -c --arg f "$fields" '[.[] | with_entries(select(.key as $k | $f | split(",") | index($k)))]' | jq -r "$q";;
  "issue edit"|"issue comment"|"issue create") ;;
  *) exit 64;;
esac`;
  const r = runStep(step(verify, 'stale', 'Open or update the issue').run, {
    stubs: { gh },
    env: { ISSUES: JSON.stringify(issues), ...env },
    files: { 'stale.md': '- Example tool (last checked 2026-01-01, status verified)\n' },
  });
  const calls = r.calls.filter((c) => !c.startsWith('gh [issue] [list]'))
    .map((c) => { const [, verb, arg] = /^gh \[issue\] \[(\w+)\] \[([^\]]*)\]/.exec(c) ?? [, c]; return verb === 'create' ? 'create' : `${verb} ${arg}`; });
  return { ...r, all: r.calls, calls };
}

test('verify-data.yml keeps one issue: it updates the open one, and opens one only when there is none (finding 29, D18)', { skip: NO_JQ }, () => {
  assert.deepEqual(issueStep([]).calls, ['create']);
  assert.deepEqual(issueStep([{ number: 12, title: TITLE, author: BOT }]).calls, ['edit 12', 'comment 12']);
  assert.deepEqual(issueStep([{ number: 13, title: `${TITLE}, follow-up`, author: BOT }]).calls, ['create'], 'only the exact title counts');
  const failed = issueStep([], { LIST_FAILS: '1' });
  assert.notEqual(failed.code, 0, 'a failed lookup fails the step');
  assert.deepEqual(failed.calls, [], 'instead of opening a second issue');
});

test("verify-data.yml reuses only an issue it opened itself, never someone else's with the same title", { skip: NO_JQ }, () => {
  // The repository is public, so anyone can open an issue with the workflow's title. The stand-in
  // returns every canned issue whatever --author says, so the step's own --jq filter is tested.
  const STRANGER = { is_bot: false, login: 'someone', id: 'U_1', name: '' };
  assert.deepEqual(issueStep([{ number: 57, title: TITLE, author: STRANGER }]).calls, ['create']);
  assert.deepEqual(issueStep([{ number: 57, title: TITLE, author: STRANGER }, { number: 12, title: TITLE, author: BOT }]).calls, ['edit 12', 'comment 12']);
  assert.deepEqual(issueStep([{ number: 58, title: TITLE, author: { is_bot: true, login: 'app/other-app' } }]).calls, ['create'], "another app's issue");
  const lookup = issueStep([]).all.find((c) => c.startsWith('gh [issue] [list]'));
  assert.match(lookup, / \[--author\] \[app\/github-actions\]/, 'the search asks for its own issues');
});

test('ci.yml runs on pull requests and on main, with read-only permissions', () => {
  assert.deepEqual(ci.on, { push: { branches: ['main'] }, pull_request: null });
  assert.deepEqual(ci.permissions, { contents: 'read' });
});

test('ci.yml: the skill job runs the root checks, the zip and the plugin validator with the directory profile (finding 72)', () => {
  const all = ci.jobs.skill.steps;
  for (const re of [/^node scripts\/build\.mjs --check$/m, /^node scripts\/validate\.mjs$/m, /^node --test scripts\/test\/\*\.test\.mjs$/m, /^node scripts\/release\.mjs --zip$/m]) {
    assert.ok(all.some(runs(re)), `the skill job runs ${re.source}`);
  }
  const v = step(ci, 'skill', runs(/claude plugin validate/), 'that validates the plugin');
  assert.match(v.run, /^npm install -g @anthropic-ai\/claude-code@\d+\.\d+\.\d+$/m, 'a fixed Claude Code version');
  assert.match(v.run, /^claude plugin validate \. --strict --profile directory$/m);
});

test('ci.yml: the Windows job runs the three root checks under bash (findings 13 and 16)', () => {
  const win = ci.jobs.windows;
  assert.equal(win['runs-on'], 'windows-latest');
  assert.equal(win.defaults?.run?.shell, 'bash', 'bash expands the test glob as on Linux');
  for (const re of [/^node scripts\/build\.mjs --check$/m, /^node scripts\/validate\.mjs$/m, /^node --test scripts\/test\/\*\.test\.mjs$/m]) {
    assert.ok(win.steps.some(runs(re)), `the Windows job runs ${re.source}`);
  }
});

// Every leg meets the Inspector's Node floor (22.19), so every leg runs its gates.
test('ci.yml: the MCP job tests both Node versions, runs the Inspector gates and packs and starts both packages on each, and again on Node 22.19.0 (findings 71 and 79, D26)', () => {
  const mcp = ci.jobs.mcp;
  assert.deepEqual(mcp.strategy.matrix.node, ['22', '24']);
  const plain = (re) => mcp.steps.find((s) => runs(re)(s) && s.if === undefined);
  for (const re of [/^npm ci$/, /^npm run build$/, /^npm test$/, /^npm run test:inspector$/, /^npm run test:pack$/, /^npm run pack:mcpb$/]) assert.ok(plain(re), `both legs run ${re.source}`);
  const floor = step(ci, 'mcp', (s) => uses(s, 'actions/setup-node') && s.with?.['node-version'] === '22.19.0', 'that switches to Node 22.19.0');
  const again = step(ci, 'mcp', (s, i) => i > floor.i && runs(/npm run test:pack/)(s), 'that packs again on 22.19.0');
  assert.equal(floor.if, 'matrix.node == 22');
  assert.equal(again.if, 'matrix.node == 22');
  inOrder(again.run, ['[ "$(node --version)" = v22.19.0 ]', 'exit 1;', 'npm run pack:mcpb', 'npm run test:pack'], 'the 22.19.0 step');
});

// release.yml's build and pack-check jobs run only on a tag push, so a change that breaks them would
// first show there. The MCP job runs their commands on each pull request, on the release's Node
// version, with the tag this version would get: release.mjs's full build and tag check, npm pack, and
// test:pack on that tarball. Each line is release.yml's own, run from mcp/.
test("ci.yml runs the release build's commands on the release's Node version, with the version's tag, and publishes nothing", () => {
  const s = step(ci, 'mcp', runs(/release\.mjs --tag/), "that runs release.yml's build commands");
  const node = step(release, 'build', (x) => uses(x, 'actions/setup-node'), 'that sets up Node').with['node-version'];
  assert.equal(step(release, 'pack-check', (x) => uses(x, 'actions/setup-node'), 'that sets up Node').with['node-version'], node);
  assert.deepEqual(ci.jobs.mcp.strategy.matrix.node.filter((n) => n === node), [node], `the MCP job has a Node ${node} leg`);
  assert.equal(s.if, `matrix.node == ${node}`, `the Node ${node} leg, as release.yml builds on Node ${node}`);
  assert.equal(s['working-directory'], undefined, 'it runs in mcp/, the MCP job\'s working directory');
  const lines = s.run.split('\n');
  assert.equal(lines[0], `tag="v$(node -p 'require("../.claude-plugin/plugin.json").version')"`, 'the tag comes from plugin.json, as a release tag must');
  const asCi = (rs, re) => {
    const line = re.exec(rs.run)?.[0];
    assert.ok(line, `${label(rs)} runs ${re.source}`);
    const fromMcp = rs['working-directory'] === 'mcp' ? line : line.replace(/^node scripts\//, 'node ../scripts/');
    return fromMcp.replaceAll('${GITHUB_REF_NAME#v}', '${tag#v}').replaceAll('${GITHUB_REF_NAME}', '${tag}');
  };
  inOrder(s.run, [
    asCi(step(release, 'build', runs(/release\.mjs --tag/), 'that builds the release files'), /^node scripts\/release\.mjs .*$/m),
    asCi(step(release, 'build', runs(/\bnpm pack\b/), 'that packs the npm package'), /^npm pack .*$/m),
    asCi(step(release, 'pack-check', runs(/npm run test:pack/), 'that starts the packed package'), /^npm run test:pack .*$/m),
  ].map((l) => `\n${l}\n`), 'the release build step runs release.yml\'s commands in order');
  assert.doesNotMatch(s.run, /\bnpm publish\b|\bgh release\b|mcp-publisher|\bgit (?:push|tag)\b/, 'nothing is published');
  const after = step(ci, 'mcp', (x) => uses(x, 'actions/setup-node') && x.with?.['node-version'] === '22.19.0', 'that switches to Node 22.19.0');
  assert.ok(s.i < after.i, 'before the switch to Node 22.19.0');
});

test('ci.yml lints the workflow files with actionlint and shellcheck, at a pinned version checked against its SHA-256 before it runs', () => {
  const s = step(ci, 'skill', runs(/actionlint/), 'that runs actionlint');
  assert.match(s.env?.ACTIONLINT_VERSION ?? '', /^\d+\.\d+\.\d+$/);
  assert.match(s.env?.ACTIONLINT_SHA256 ?? '', /^[0-9a-f]{64}$/);
  inOrder(s.run, [
    'shellcheck="$(command -v shellcheck)" || {',
    'exit 1; }',
    'curl -fsSL -o "${archive}" "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"',
    LINT_CHECK,
    'tar xzf "${archive}"',
    '"${RUNNER_TEMP}/actionlint" -shellcheck "${shellcheck}" .github/workflows/*.yml',
  ], 'the actionlint step');
  assert.deepEqual(afterCheck(s.run, LINT_CHECK), [
    'tar xzf "${archive}" -C "${RUNNER_TEMP}" actionlint',
    '"${RUNNER_TEMP}/actionlint" -shellcheck "${shellcheck}" .github/workflows/*.yml',
  ], 'after the check, the step only unpacks the archive and runs actionlint');
});
