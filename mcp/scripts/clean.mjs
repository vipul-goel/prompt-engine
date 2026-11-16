#!/usr/bin/env node
// Removes build output folders given as arguments (relative to the package root).
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of process.argv.slice(2)) {
  const target = resolve(pkg, dir);
  if (!target.startsWith(`${pkg}/`) && !target.startsWith(`${pkg}\\`)) throw new Error(`refusing to remove ${target} outside ${pkg}`);
  rmSync(target, { recursive: true, force: true });
}
