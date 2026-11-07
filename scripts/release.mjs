#!/usr/bin/env node
// Prepares release artifacts in dist/. Publishing itself (GitHub release, npm,
// MCP Registry) happens in .github/workflows/release.yml, which calls this first.
//
//   node scripts/release.mjs --zip            # only dist/prompt-engine.zip (for Claude.ai / Skills API upload)
//   node scripts/release.mjs                  # zip + universal files + MCPB bundle + checksums
//   node scripts/release.mjs --tag v0.1.0     # same, and fail unless the tag matches the version
//
// Needs the `zip` and `unzip` commands, plus npm for the MCPB bundle. No other dependencies.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root, OS_JUNK } from './build.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const run = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...opts });
const dist = join(root, 'dist');

const version = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const tag = value('--tag');
if (tag && tag !== `v${version}`) {
  console.error(`tag ${tag} does not match plugin version v${version}; bump .claude-plugin/plugin.json (and the versions it is synced with) first`);
  process.exit(1);
}

run(process.execPath, ['scripts/validate.mjs']);
mkdirSync(dist, { recursive: true });

// 1. Skill zip: the archive's top-level entry must be the prompt-engine/ folder (claude.ai rejects a bare SKILL.md at the root).
const zipPath = join(dist, 'prompt-engine.zip');
rmSync(zipPath, { force: true });
// zip and unzip are external commands. Stock Windows has neither, so say what to do instead of a stack trace.
const needs = (cmd, fn) => {
  try {
    return fn();
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.error(`release.mjs needs the ${cmd} command, which isn't installed. On Linux, install the zip and unzip packages. On Windows, zip the skills/prompt-engine folder yourself instead: in File Explorer, right-click it, then Show more options > Send to > Compressed (zipped) folder (on Windows 10, Send to is in the first menu); the archive must have prompt-engine/ at its top level.`);
    process.exit(1);
  }
};
needs('zip', () => run('zip', ['-q', '-r', zipPath, 'prompt-engine', '-x', ...[...OS_JUNK].map((f) => `*${f}`)], { cwd: join(root, 'skills') }));
const listing = needs('unzip', () => execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })).split('\n').filter(Boolean);
if (!listing.includes('prompt-engine/SKILL.md') || listing.some((f) => !f.startsWith('prompt-engine/'))) {
  console.error('zip layout is wrong: expected everything under prompt-engine/');
  process.exit(1);
}
console.log(`dist/prompt-engine.zip (${listing.length} entries)`);
if (flag('--zip')) process.exit(0);

// 2. Universal copy-paste files.
for (const f of ['prompt-engine.md', 'prompt-engine-knowledge.md']) copyFileSync(join(root, 'universal', f), join(dist, f));

// 3. MCPB bundle for Claude Desktop, if the MCP server is present.
const assets = ['prompt-engine.zip', 'prompt-engine.md', 'prompt-engine-knowledge.md'];
if (existsSync(join(root, 'mcp', 'package.json'))) {
  run('npm', ['run', 'pack:mcpb'], { cwd: join(root, 'mcp') });
  const bundle = join(root, 'mcp', 'dist-mcpb', 'prompt-engine.mcpb');
  if (!existsSync(bundle)) { console.error('mcp: pack:mcpb did not produce dist-mcpb/prompt-engine.mcpb'); process.exit(1); }
  copyFileSync(bundle, join(dist, 'prompt-engine.mcpb'));
  assets.push('prompt-engine.mcpb');
}

// 4. Checksums, for anyone checking a download: shasum -a 256 -c --ignore-missing SHA256SUMS (sha256sum on Linux).
const sums = assets.map((f) => `${createHash('sha256').update(readFileSync(join(dist, f))).digest('hex')}  ${f}`);
writeFileSync(join(dist, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(`\nrelease artifacts for v${version} in dist/:\n${sums.join('\n')}`);
