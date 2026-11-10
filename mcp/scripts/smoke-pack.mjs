#!/usr/bin/env node
// Installs the npm package from its tarball and starts it. Every other gate runs the server
// from this folder (the tests, the Inspector gates, the MCPB bundle), so without this a
// tarball that can't install or start would pass them all.
//
//   npm run test:pack                            # packs this folder first (run npm run build before)
//   npm run test:pack -- path/to/prompt-engine-mcp-x.y.z.tgz
//
// It checks that:
// 1. the tarball holds exactly LICENSE, README.md, package.json and every built file in
//    dist/ except dist/worker.js;
// 2. `npm install <tgz>` into a temporary folder succeeds;
// 3. the installed bin prints package.json's version;
// 4. over stdio, the installed server lists manifest.json's tools and answers get_checklist.
// It exits 1 on any failure. The install needs the npm registry, and it resolves the
// dependencies' own dependencies afresh, as a user's npx does, so an upstream release can
// make it fail.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const { name, version, bin } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const tools = JSON.parse(readFileSync(join(pkg, 'manifest.json'), 'utf8')).tools.map((t) => t.name).sort();
// npm sets npm_execpath to its npm-cli.js when it runs this script; otherwise use npm from PATH.
const npmCmd = /npm-cli\.js$/.test(process.env.npm_execpath ?? '') ? [process.execPath, process.env.npm_execpath] : ['npm'];
const npm = (args, opts = {}) => execFileSync(npmCmd[0], [...npmCmd.slice(1), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
const fail = (msg) => {
  throw new Error(msg);
};

const tmp = mkdtempSync(join(tmpdir(), 'prompt-engine-pack-'));
try {
  let tgz = process.argv[2] && resolve(process.argv[2]);
  // With scripts on, so prepack copies LICENSE in and postpack removes it again.
  if (!tgz) tgz = join(tmp, JSON.parse(npm(['pack', '--json', '--pack-destination', tmp], { cwd: pkg }))[0].filename);
  if (!existsSync(tgz)) fail(`${tgz} doesn't exist`);

  // 1. The file list. The build writes no dot-files, and npm leaves some out of every package
  // (.DS_Store, and the ._* files macOS writes on some drives), so dot-files in dist/ aren't
  // expected in the tarball. tar gets the file name, run from its folder: GNU tar, which
  // Git Bash puts on PATH on Windows, reads a name with a colon before its first slash
  // (C:\...) as host:file, and the --force-local that stops it isn't in bsdtar.
  const files = execFileSync('tar', ['-tzf', basename(tgz)], { cwd: dirname(tgz), encoding: 'utf8' }).split('\n').filter((f) => f && !f.endsWith('/')).map((f) => f.replace(/^package\//, '')).sort();
  const dist = join(pkg, 'dist');
  const built = existsSync(dist)
    ? readdirSync(dist, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && !d.name.startsWith('.')).map((d) => relative(pkg, join(d.parentPath, d.name)).split('\\').join('/'))
    : [];
  if (!built.includes(bin[name])) fail(`${bin[name]} is missing from this folder; run npm run build first`);
  const want = ['LICENSE', 'README.md', 'package.json', ...built.filter((f) => f !== 'dist/worker.js')];
  const extra = files.filter((f) => !want.includes(f));
  const missing = want.filter((f) => !files.includes(f)).sort();
  if (extra.length || missing.length) {
    fail(`the tarball's files aren't LICENSE, README.md, package.json and the built dist/ files except dist/worker.js. Extra: ${extra.join(', ') || 'none'}. Missing: ${missing.join(', ') || 'none'}.`);
  }

  // 2. Install it. A dependency's devDependencies are never installed, so --omit=dev changes
  // nothing. --ignore-scripts keeps the check from running install scripts; npx would run
  // them, but no runtime dependency has one today.
  const inst = join(tmp, 'inst');
  npm(['install', '--prefix', inst, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', tgz]);
  const exe = join(inst, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
  if (!existsSync(exe)) fail(`the install has no ${relative(inst, exe)}`);

  // 3. The installed bin starts and prints the version. A .cmd needs a shell on Windows. Its
  // stderr is kept for the error message below rather than printed twice.
  const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  const printed = (process.platform === 'win32' ? execSync(`"${exe}" --version`, quiet) : execFileSync(exe, ['--version'], quiet)).trim();
  if (printed !== version) fail(`${name} --version printed ${JSON.stringify(printed)}, expected ${version}`);

  // 4. Over stdio it lists the tools and answers a call that reads the generated content.
  const client = new Client({ name: 'pack-check', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: exe, args: [], cwd: inst, stderr: 'inherit' }));
  try {
    const listed = (await client.listTools()).tools.map((t) => t.name).sort();
    if (listed.join() !== tools.join()) fail(`the installed server lists ${listed.join(', ')}; manifest.json lists ${tools.join(', ')}`);
    const r = await client.callTool({ name: 'get_checklist', arguments: { domain: 'coding' } });
    const text = r.content?.[0]?.type === 'text' ? r.content[0].text : '';
    if (r.isError || !/coding/i.test(text)) fail(`get_checklist {domain: "coding"} returned ${JSON.stringify(r).slice(0, 300)}`);
  } finally {
    await client.close();
  }
  console.log(`${process.argv[2] ?? basename(tgz)}: ${files.length} files; installed, starts (${version}) and lists ${tools.join(', ')}`);
} catch (e) {
  console.error(`test:pack: ${e.message.split('\n').slice(0, 16).join('\n')}`);
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
