#!/usr/bin/env node
// npm pack/publish only include a LICENSE from the package folder, and the
// project's LICENSE lives at the repository root. prepack copies it in;
// postpack removes the copy again, never a LICENSE someone put here on purpose.
// If there is no LICENSE in either place, copy fails, so npm pack and npm publish
// stop instead of shipping a package without one.
//
// The marker records the copy's SHA-256, and a file is the copy only while it
// still has that hash. A pack that fails between prepack and postpack leaves the
// copy and the marker behind; the next prepack copies the root LICENSE in again,
// and its postpack removes it, but a LICENSE with other text written over the
// left-over copy stays.
//
//   node scripts/license.mjs copy | remove
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(pkg, '..', 'LICENSE');
const target = join(pkg, 'LICENSE');
const marker = join(pkg, 'node_modules', '.cache', 'prompt-engine-license-copied');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
// Whether mcp/LICENSE is still the copy this script made.
const isCopy = () => existsSync(marker) && existsSync(target) && readFileSync(marker, 'utf8') === sha256(target);

const action = process.argv[2];
if (action === 'copy') {
  if (isCopy() && existsSync(source)) rmSync(target, { force: true });
  if (!existsSync(target) && !existsSync(source)) {
    console.error(`license.mjs: no LICENSE at ${source} or ${target}; the npm package must carry one`);
    process.exit(1);
  }
  if (!existsSync(target)) {
    copyFileSync(source, target);
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, sha256(target));
  }
} else if (action === 'remove') {
  if (isCopy()) rmSync(target, { force: true });
  rmSync(marker, { force: true });
} else {
  console.error('usage: node scripts/license.mjs copy|remove');
  process.exit(2);
}
