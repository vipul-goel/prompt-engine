#!/usr/bin/env node
// Bundles the stdio/HTTP server into one self-contained file for the MCPB
// (Claude Desktop) bundle: mcpb/server/index.js. Claude Desktop runs it with its
// own Node, so nothing is installed at runtime. The license texts of the bundled
// third-party code go next to it in mcpb/server/THIRD_PARTY_NOTICES.txt
// (scripts/notices.mjs). If one is missing, or the SDK doesn't match what
// notices.mjs was reviewed for, it deletes mcpb/server/ and exits 1.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { collectNotices, renderNotices } from './notices.mjs';

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
  // The major version of the supported floor (engines in package.json). The target
  // doesn't change the output: with esbuild 0.28.2 and these sources, node20,
  // node22, node22.19 and node24 give byte-identical bundles.
  target: 'node22',
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

let notices;
try {
  notices = collectNotices(result.metafile);
} catch (e) {
  rmSync(outdir, { recursive: true, force: true });
  console.error(e.message);
  process.exit(1);
}
writeFileSync(join(outdir, 'THIRD_PARTY_NOTICES.txt'), renderNotices(notices));

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`bundled mcpb/server/index.js (${(bytes / 1024).toFixed(0)} KiB), with the notices of ${notices.length} third-party packages`);
