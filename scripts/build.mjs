#!/usr/bin/env node
// Generates derived files from the hand-edited sources:
//   data/media-targets.json              -> skills/prompt-engine/references/media-targets.md
//   skills/prompt-engine/references/*.md -> universal/prompt-engine-knowledge.md
// Zero dependencies: Node >= 20 built-ins only. Output is deterministic (no timestamps),
// so `node scripts/build.mjs && git diff --exit-code` detects stale generated files.
// `node scripts/build.mjs --check` exits 1 instead of writing when anything is stale.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// PE_ROOT lets tests point the scripts at a temporary copy of the repository.
export const root = process.env.PE_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
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

// Order of sections in the knowledge file: how to respond first, then the domain packs.
export const KNOWLEDGE_ORDER = [
  'output-format', 'questions', 'blueprint', 'general',
  'coding', 'writing', 'research', 'image-video', 'media-targets',
];

const titleOf = (md) => (md.match(/^# (.+)$/m) || [, 'Untitled'])[1].trim();

// Shift markdown headings down one level outside fenced code blocks.
function demoteHeadings(md) {
  let fence = null;
  return md.split('\n').map((line) => {
    const f = line.match(/^(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1];
      else if (line.startsWith(fence)) fence = null;
      return line;
    }
    return !fence && /^#{1,5} /.test(line) ? `#${line}` : line;
  }).join('\n');
}

export function renderKnowledge(refs) {
  const titles = Object.fromEntries(Object.entries(refs).map(([k, md]) => [k, titleOf(md)]));
  const rewritePaths = (md) => md.replace(/`?references\/([a-z-]+)\.md`?/g, (m, name) =>
    titles[name] ? `the "${titles[name]}" section` : m);
  const parts = [
    '# Prompt Engine knowledge file',
    '',
    'Detailed checklists and rules for Prompt Engine. Use this file together with the Prompt Engine instructions (`prompt-engine.md`). If the two ever disagree, follow the instructions.',
    '',
    'Sections:',
    ...KNOWLEDGE_ORDER.map((k, i) => `${i + 1}. ${titles[k]}`),
    '',
  ];
  for (const k of KNOWLEDGE_ORDER) {
    parts.push('---', '', demoteHeadings(rewritePaths(refs[k].trim())), '');
  }
  parts.push('_Generated from `skills/prompt-engine/references/` by `scripts/build.mjs`; edit those files, not this one._', '');
  return parts.join('\n');
}

export function buildAll() {
  const outputs = {};
  const media = JSON.parse(read('data/media-targets.json'));
  outputs['skills/prompt-engine/references/media-targets.md'] = renderMediaTargets(media);
  const refs = {};
  for (const k of KNOWLEDGE_ORDER) {
    const p = `skills/prompt-engine/references/${k}.md`;
    refs[k] = outputs[p] ?? read(p);
  }
  outputs['universal/prompt-engine-knowledge.md'] = renderKnowledge(refs);
  return outputs;
}

function main() {
  const check = process.argv.includes('--check');
  const outputs = buildAll();
  let stale = 0;
  for (const [p, content] of Object.entries(outputs)) {
    const abs = join(root, p);
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (current === content) continue;
    if (check) { console.error(`stale: ${p}`); stale++; continue; }
    writeFileSync(abs, content);
    console.log(`wrote ${p}`);
  }
  if (check && stale) process.exit(1);
  if (check) console.log('generated files are up to date');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
