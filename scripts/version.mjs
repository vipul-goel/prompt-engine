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
import { root, normalize, splitFrontmatter, SEMVER } from './build.mjs';

const next = process.argv[2];
if (!SEMVER.test(next ?? '')) {
  console.error('usage: node scripts/version.mjs <major.minor.patch>, each part 0 or a number without a leading zero');
  process.exit(2);
}

const pending = [];
const fail = (msg) => { console.error(msg); process.exit(1); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Replace every "version": "…" value in the file, then check that the result is
// exactly the intended change, so an unexpected nested "version" key aborts.
function bumpJson(rel, intend) {
  const file = join(root, rel);
  if (!existsSync(file)) return;
  const text = normalize(readFileSync(file, 'utf8'));
  const want = JSON.parse(text);
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
  const text = normalize(readFileSync(lockFile, 'utf8'));
  const lock = JSON.parse(text);
  if (`${JSON.stringify(lock, null, 2)}\n` !== text) fail(`${lockRel}: unexpected formatting; run \`npm version ${next} --no-git-tag-version\` in mcp/ instead`);
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  pending.push([lockFile, `${JSON.stringify(lock, null, 2)}\n`, lockRel]);
}

// SKILL.md: only the metadata.version line inside the frontmatter, which ends where build.mjs
// and validate.mjs end it (splitFrontmatter).
const skillRel = 'skills/prompt-engine/SKILL.md';
const skillFile = join(root, skillRel);
const skill = normalize(readFileSync(skillFile, 'utf8'));
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
execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });

const changelog = join(root, 'CHANGELOG.md');
// Remind until the version has a dated heading, so "## [0.1.0] - not yet released" still gets it.
const dated = new RegExp(`^## \\[${next.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
if (!existsSync(changelog) || !dated.test(readFileSync(changelog, 'utf8'))) {
  console.log(`\nNext: give CHANGELOG.md a "## [${next}] - YYYY-MM-DD" heading with the release date.`);
}
console.log(`Then run the checks and tag v${next} (see docs/publishing.md).`);
