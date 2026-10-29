#!/usr/bin/env node
// Bundles the stdio/HTTP server into one self-contained file for the MCPB
// (Claude Desktop) bundle: mcpb/server/index.js. Claude Desktop runs it with its
// own Node, so nothing is installed at runtime.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(pkg, 'mcpb', 'server');
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const result = await build({
  absWorkingDir: pkg,
  entryPoints: ['src/cli.ts'],
  outfile: join(outdir, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Bundled CommonJS code, if any, may call require(); give it a real one.
  banner: { js: "import { createRequire as __peCreateRequire } from 'node:module';\nconst require = __peCreateRequire(import.meta.url);" },
  legalComments: 'eof',
  sourcemap: false,
  metafile: true,
  logLevel: 'warning',
});

// The bundle is an ES module; say so next to it, because the folder Claude
// Desktop unpacks it into has no package.json of its own.
writeFileSync(join(outdir, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`bundled mcpb/server/index.js (${(bytes / 1024).toFixed(0)} KiB)`);
