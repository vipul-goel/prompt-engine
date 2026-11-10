#!/usr/bin/env node
// Sets the release version in every file that carries it, then regenerates
// derived files. validate.mjs fails when any of these disagree.
//
//   node scripts/version.mjs 0.2.0
//
// Files: .claude-plugin/plugin.json, skills/prompt-engine/SKILL.md (metadata.version)
// and, when the MCP server is present, mcp/package.json, mcp/package-lock.json,
// mcp/server.json (its version and each package's version) and mcp/manifest.json.
// Edits are textual, so the files keep their formatting, except that they are written
// with LF line endings and without a byte-order mark (normalize() in build.mjs); each
// JSON edit is re-parsed and compared with the intended change before anything is written.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root, normalize, splitFrontmatter, isSemver } from './build.mjs';

const next = process.argv[2];
if (!isSemver(next)) {
  console.error('usage: node scripts/version.mjs <major.minor.patch>, each part 0 or a number without a leading zero, at most 9007199254740991');
  process.exit(2);
}

const pending = [];
const fail = (msg) => { console.error(msg); process.exit(1); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A file under the root, as normalized text, and a JSON one also parsed. One that can't be read or
// doesn't parse ends the run, before anything is written, with one line that names it by its path
// in the checkout, as in release.mjs: the throw printed a stack trace with the checkout's absolute
// path. Control characters in the message, such as the line breaks of the text that JSON.parse's
// message quotes, are written as escapes.
function readText(rel, parse = false) {
  const file = join(root, rel);
  try {
    const text = normalize(readFileSync(file, 'utf8'));
    return parse ? { text, value: JSON.parse(text) } : text;
  } catch (e) {
    return fail(`${rel}: ${e.code === 'ENOENT' ? 'missing' : e.message.replaceAll(file, rel).replace(/[\x00-\x1f]/g, (c) => JSON.stringify(c).slice(1, -1))}`);
  }
}
// Each JSON file here holds one object, whose keys the run sets.
function readJsonFile(rel) {
  const read = readText(rel, true);
  if (read.value === null || typeof read.value !== 'object' || Array.isArray(read.value)) fail(`${rel}: not a JSON object`);
  return read;
}

// Replace every "version": "…" value in the file, then check that the result is
// exactly the intended change, so an unexpected nested "version" key aborts.
function bumpJson(rel, intend) {
  const file = join(root, rel);
  if (!existsSync(file)) return;
  const { text, value: want } = readJsonFile(rel);
  intend(want);
  const updated = text.replace(/("version"\s*:\s*")[^"]*(")/g, `$1${next}$2`);
  if (!same(JSON.parse(updated), want)) fail(`${rel}: has "version" keys this script doesn't expect; update it by hand`);
  pending.push([file, updated, rel]);
}

bumpJson('.claude-plugin/plugin.json', (d) => { d.version = next; });
bumpJson('mcp/package.json', (d) => { d.version = next; });
bumpJson('mcp/manifest.json', (d) => { d.version = next; });
bumpJson('mcp/server.json', (d) => {
  d.version = next;
  for (const p of d.packages ?? []) if ('version' in p) p.version = next;
});

// The lockfile lists dependency versions too, so only its two root entries change.
const lockRel = 'mcp/package-lock.json';
const lockFile = join(root, lockRel);
if (existsSync(lockFile)) {
  const { text, value: lock } = readJsonFile(lockRel);
  if (`${JSON.stringify(lock, null, 2)}\n` !== text) fail(`${lockRel}: unexpected formatting; run \`npm version ${next} --no-git-tag-version\` in mcp/ instead`);
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  pending.push([lockFile, `${JSON.stringify(lock, null, 2)}\n`, lockRel]);
}

// SKILL.md: only the metadata.version line inside the frontmatter, which ends where build.mjs
// and validate.mjs end it (splitFrontmatter).
const skillRel = 'skills/prompt-engine/SKILL.md';
const skillFile = join(root, skillRel);
const skill = readText(skillRel);
let split;
try { split = splitFrontmatter(skill); } catch (e) { fail(`${skillRel}: ${e.message}`); }
// The frontmatter with its "---" lines: the text before the body.
const front = split && skill.slice(0, skill.length - split.body.length);
if (!front || !/^ {2}version: "[^"]*"$/m.test(split.front)) fail(`${skillRel}: no metadata.version line in the frontmatter`);
// Concatenate instead of skill.replace(front, …): a replacement string would expand any
// $$, $&, $` or $' in the frontmatter.
const newFront = front.replace(/^( {2}version: ")[^"]*(")$/m, `$1${next}$2`);
pending.push([skillFile, newFront + split.body, skillRel]);

for (const [file, text, rel] of pending) {
  writeFileSync(file, text);
  console.log(`${rel} → ${next}`);
}
// The build prints its own error; a throw here printed a stack trace after it, with node's and the
// checkout's absolute paths.
try {
  execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
} catch (e) {
  fail(`version.mjs stopped: node scripts/build.mjs ${typeof e.status === 'number' ? `exited with code ${e.status}` : `failed (${e.signal ?? e.code})`}; the version is set in the files above, so fix what the build names and run node scripts/build.mjs`);
}

const changelog = join(root, 'CHANGELOG.md');
// Remind until the version has a dated heading, so "## [0.1.0] - not yet released" still gets it.
const dated = new RegExp(`^## \\[${next.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
if (!existsSync(changelog) || !dated.test(readFileSync(changelog, 'utf8'))) {
  console.log(`\nNext: give CHANGELOG.md a "## [${next}] - YYYY-MM-DD" heading with the release date.`);
}
console.log(`Then run the checks and tag v${next} (see docs/publishing.md).`);
