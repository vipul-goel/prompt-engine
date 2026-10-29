#!/usr/bin/env node
// Sets the release version in every file that carries it, then regenerates
// derived files. validate.mjs fails when any of these disagree.
//
//   node scripts/version.mjs 0.2.0
//
// Files: .claude-plugin/plugin.json, skills/prompt-engine/SKILL.md (metadata.version)
// and, when the MCP server is present, mcp/package.json, mcp/package-lock.json,
// mcp/server.json (its version and each package's version) and mcp/manifest.json.
// Edits are textual, so the files keep their formatting; each JSON edit is
// re-parsed and compared with the intended change before anything is written.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from './build.mjs';

const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) {
  console.error('usage: node scripts/version.mjs <major.minor.patch>');
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
  const text = readFileSync(file, 'utf8');
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
  const text = readFileSync(lockFile, 'utf8');
  const lock = JSON.parse(text);
  if (`${JSON.stringify(lock, null, 2)}\n` !== text) fail(`${lockRel}: unexpected formatting; run \`npm version ${next} --no-git-tag-version\` in mcp/ instead`);
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  pending.push([lockFile, `${JSON.stringify(lock, null, 2)}\n`, lockRel]);
}

// SKILL.md: only the metadata.version line inside the frontmatter.
const skillRel = 'skills/prompt-engine/SKILL.md';
const skillFile = join(root, skillRel);
const skill = readFileSync(skillFile, 'utf8');
const front = skill.match(/^---\n[\s\S]*?\n---\n/);
if (!front || !/^ {2}version: "[^"]*"$/m.test(front[0])) fail(`${skillRel}: no metadata.version line in the frontmatter`);
pending.push([skillFile, skill.replace(front[0], front[0].replace(/^( {2}version: ")[^"]*(")$/m, `$1${next}$2`)), skillRel]);

for (const [file, text, rel] of pending) {
  writeFileSync(file, text);
  console.log(`${rel} → ${next}`);
}
execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });

const changelog = join(root, 'CHANGELOG.md');
if (!existsSync(changelog) || !readFileSync(changelog, 'utf8').includes(`## [${next}]`)) {
  console.log(`\nNext: add a "## [${next}] - YYYY-MM-DD" section to CHANGELOG.md.`);
}
console.log(`Then run the checks and tag v${next} (see docs/publishing.md).`);
