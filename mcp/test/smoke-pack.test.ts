// scripts/smoke-pack.mjs (npm run test:pack), without packing or installing: a stub tar
// first on PATH records how the script lists the tarball, then fails, so the script
// stops before it runs npm.

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG } from './helpers.js';

// The stub is a shell script, so this runs where /bin/sh does.
describe.skipIf(process.platform === 'win32')('test:pack', () => {
  it('lists the tarball by its file name, from its folder', () => {
    // GNU tar reads an archive name with a colon before its first slash as host:file, and
    // every Windows absolute path has one (C:\...), so the script must never pass the path.
    const dir = mkdtempSync(join(tmpdir(), 'prompt-engine-tar-'));
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      const log = join(dir, 'tar-call.txt');
      writeFileSync(join(bin, 'tar'), `#!/bin/sh\n{ pwd -P; for a in "$@"; do printf '%s\\n' "$a"; done; } > '${log}'\nexit 2\n`);
      chmodSync(join(bin, 'tar'), 0o755);
      const tgz = join(dir, 'prompt-engine-mcp-0.0.0.tgz');
      writeFileSync(tgz, '');
      const run = spawnSync(process.execPath, [join(PKG, 'scripts', 'smoke-pack.mjs'), tgz], {
        env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` },
        encoding: 'utf8',
      });
      expect(run.status).toBe(1);
      const [cwd, ...args] = readFileSync(log, 'utf8').split('\n').filter(Boolean);
      expect(args).toEqual(['-tzf', 'prompt-engine-mcp-0.0.0.tgz']);
      expect(cwd).toBe(realpathSync(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
