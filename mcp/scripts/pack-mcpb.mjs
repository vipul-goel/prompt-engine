#!/usr/bin/env node
// Packs the MCPB bundle for Claude Desktop: dist-mcpb/prompt-engine.mcpb.
// Run `npm run bundle` first (`npm run pack:mcpb` does both). The bundle holds
// manifest.json, server/index.js (one self-contained file), the third-party license
// notices next to it (server/THIRD_PARTY_NOTICES.txt), the project's LICENSE and
// icon.png (mcp/icon.png: the plugin icon at 512x512, the size mcpb recommends).
// After packing, the archive is unpacked and checked:
// - its manifest names icon.png, and that file is a 512x512 PNG;
// - the notices name every package index.js bundles, and the packages the MCP SDK
//   inlines (scripts/notices.mjs);
// - its server, started as manifest.json's mcp_config describes
//   (node ${__dirname}/server/index.js), lists exactly the manifest's tools, and no
//   prompt the manifest doesn't cover, answers a call to each tool, answers the
//   enhance prompt and completions of its mode and of a checklist's domain, lists the
//   resources, and reads prompt-engine://method, prompt-engine://questions and
//   prompt-engine://checklists/coding; started twice more, it answers ask_user through
//   a form for a client on the 2025-era protocol and for one on 2026-07-28
//   (scripts/check-server.mjs).
// Claude Desktop is reported to run some Node extensions in its own host instead
// (anthropics/claude-code#35175); that isn't checked here. If a check fails, the
// bundle is deleted.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { checkServer } from './check-server.mjs';
import { SDK_INLINED, bundledPackages, noticeHeadings } from './notices.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(pkg, '..');
const bundle = join(pkg, 'mcpb', 'server', 'index.js');
const out = join(pkg, 'dist-mcpb', 'prompt-engine.mcpb');
// The CLI file isn't in the package's exports map; find it next to the (pinned) main entry.
const mcpbCli = join(dirname(createRequire(import.meta.url).resolve('@anthropic-ai/mcpb')), 'cli', 'cli.js');
const mcpb = (cwd, ...args) => execFileSync(process.execPath, [mcpbCli, ...args], { cwd, stdio: 'inherit' });

// The width x height in a PNG's IHDR chunk, or why there is none.
function pngSize(file) {
  if (!existsSync(file)) return 'missing';
  const png = readFileSync(file);
  if (png.length < 24 || png.toString('latin1', 0, 8) !== '\x89PNG\r\n\x1a\n' || png.toString('latin1', 12, 16) !== 'IHDR') return 'not a PNG';
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

if (!existsSync(bundle)) {
  console.error('mcpb/server/index.js is missing; run npm run bundle first');
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
const manifest = JSON.parse(readFileSync(join(pkg, 'manifest.json'), 'utf8'));
if (manifest.version !== version) {
  console.error(`manifest.json version ${manifest.version} != package.json ${version}`);
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), 'prompt-engine-mcpb-'));
const unpacked = mkdtempSync(join(tmpdir(), 'prompt-engine-mcpb-check-'));
let checked = false;
try {
  cpSync(join(pkg, 'mcpb', 'server'), join(stage, 'server'), { recursive: true });
  const license = join(repo, 'LICENSE');
  if (!existsSync(license)) throw new Error(`${license} is missing`);
  copyFileSync(license, join(stage, 'LICENSE'));
  const icon = join(pkg, 'icon.png');
  if (!existsSync(icon)) throw new Error(`${icon} is missing`);
  copyFileSync(icon, join(stage, 'icon.png'));
  manifest.icon = 'icon.png';
  writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  mcpb(stage, 'validate', 'manifest.json');
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  mcpb(stage, 'pack', '.', out);

  mcpb(unpacked, 'unpack', out, unpacked);
  const packed = JSON.parse(readFileSync(join(unpacked, 'manifest.json'), 'utf8'));
  // mcpb validate prints the same icon note for a PNG of any size, so check the packed icon here.
  const iconSize = pngSize(join(unpacked, 'icon.png'));
  if (packed.icon !== 'icon.png' || iconSize !== '512x512') {
    throw new Error(`the packed manifest's icon is ${JSON.stringify(packed.icon)} and the packed icon.png is ${iconSize}; expected "icon.png" at 512x512`);
  }

  // The license notices ship, and have a heading for every package esbuild bundled (its
  // path comments in index.js) and for each package the SDK inlines, which those comments
  // never name, at the version SDK_INLINED pins.
  const noticesFile = join(unpacked, 'server', 'THIRD_PARTY_NOTICES.txt');
  if (!existsSync(noticesFile)) throw new Error('the packed bundle has no server/THIRD_PARTY_NOTICES.txt');
  const headings = noticeHeadings(readFileSync(noticesFile, 'utf8'));
  const markers = bundledPackages(readFileSync(join(unpacked, 'server', 'index.js'), 'utf8'));
  if (!markers.length) throw new Error('the packed index.js has no `// node_modules/` path comments to check the notices against (was it minified?)');
  const unnamed = [
    ...markers.filter((name) => !headings.some((h) => h.name === name)),
    ...SDK_INLINED.filter((spec) => !headings.some((h) => `${h.name}@${h.version}` === spec)),
  ];
  if (unnamed.length) throw new Error(`server/THIRD_PARTY_NOTICES.txt doesn't name: ${unnamed.join(', ')}`);

  // Start the packed server as manifest.json's mcp_config describes (node ${__dirname}/server/index.js),
  // once for each client the check connects.
  const args = packed.server.mcp_config.args.map((a) => a.replace('${__dirname}', unpacked));
  const open = () => new StdioClientTransport({ command: process.execPath, args, cwd: unpacked, stderr: 'inherit' });
  const client = new Client({ name: 'mcpb-check', version: '0.0.0' });
  await client.connect(open());
  try {
    console.log(await checkServer(client, manifest, open));
  } finally {
    await client.close();
  }
  checked = true;
} finally {
  rmSync(stage, { recursive: true, force: true });
  rmSync(unpacked, { recursive: true, force: true });
  if (!checked) rmSync(out, { force: true });
}
console.log(`packed dist-mcpb/prompt-engine.mcpb (${(statSync(out).size / 1024).toFixed(0)} KiB)`);
