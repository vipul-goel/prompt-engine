#!/usr/bin/env node
// npm pack/publish only include a LICENSE from the package folder, and the
// project's LICENSE lives at the repository root. prepack copies it in;
// postpack removes the copy again (never a LICENSE someone put here on purpose).
//
//   node scripts/license.mjs copy | remove
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(pkg, '..', 'LICENSE');
const target = join(pkg, 'LICENSE');
const marker = join(pkg, 'node_modules', '.cache', 'prompt-engine-license-copied');

const action = process.argv[2];
if (action === 'copy') {
  if (!existsSync(target) && existsSync(source)) {
    copyFileSync(source, target);
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, '');
  }
} else if (action === 'remove') {
  if (existsSync(marker)) {
    rmSync(target, { force: true });
    rmSync(marker, { force: true });
  }
} else {
  console.error('usage: node scripts/license.mjs copy|remove');
  process.exit(2);
}
