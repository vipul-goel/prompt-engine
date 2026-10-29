#!/usr/bin/env node
// Generates derived files from the hand-edited sources:
//   data/media-targets.json -> skills/prompt-engine/references/media-targets.md
// Zero dependencies: Node >= 20 built-ins only. Output is deterministic (no timestamps),
// so `node scripts/build.mjs && git diff --exit-code` detects stale generated files.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const STATUS_LABEL = {
  verified: '✓ verified against the vendor’s own documentation',
  secondary: '~ secondary: official documentation seen only in search results, so check the tool’s current docs before relying on details',
  unverified: '? unverified: check the tool’s current docs',
};

export function renderMediaTargets(data) {
  const lines = [
    '# Media targets',
    '',
    'Tool-specific syntax for image and video prompts, used with `references/image-video.md`. These tools change often. If an entry is not marked verified, or the user may be on a different version, ask the user or state your choice as an assumption.',
    '',
  ];
  for (const t of data.targets) {
    if (!STATUS_LABEL[t.status]) throw new Error(`media-targets: unknown status "${t.status}" for ${t.id}`);
    lines.push(`## ${t.name}`, '');
    lines.push(`*${t.kind} · ${STATUS_LABEL[t.status]} (last checked ${t.last_verified})*`, '');
    const fields = [
      ['Prompt style', t.prompt_style],
      ['Exclusions', t.exclusions],
      ['Settings', t.settings],
      ['References', t.references],
      ['Text in the image', t.text],
      ['Note', t.notes],
    ];
    for (const [label, value] of fields) {
      if (value && value !== '—') lines.push(`- **${label}:** ${value}`);
    }
    lines.push(`- **Sources:** ${t.sources.join(' · ')}`, '');
  }
  lines.push('_Generated from `data/media-targets.json` by `scripts/build.mjs`; edit the JSON, not this file._', '');
  return lines.join('\n');
}

function main() {
  const media = JSON.parse(read('data/media-targets.json'));
  const out = 'skills/prompt-engine/references/media-targets.md';
  writeFileSync(join(root, out), renderMediaTargets(media));
  console.log(`wrote ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
