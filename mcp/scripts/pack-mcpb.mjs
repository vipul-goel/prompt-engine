#!/usr/bin/env node
// Packs the MCPB bundle for Claude Desktop: dist-mcpb/prompt-engine.mcpb.
// Run `npm run bundle` first (`npm run pack:mcpb` does both). The bundle holds
// manifest.json, server/index.js (one self-contained file), the project's LICENSE
// and, when the plugin has one, its icon. After packing, the archive is unpacked
// and its server is started the way Claude Desktop does, and must list the tools.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(pkg, '..');
const bundle = join(pkg, 'mcpb', 'server', 'index.js');
const out = join(pkg, 'dist-mcpb', 'prompt-engine.mcpb');
// The CLI file isn't in the package's exports map; find it next to the (pinned) main entry.
const mcpbCli = join(dirname(createRequire(import.meta.url).resolve('@anthropic-ai/mcpb')), 'cli', 'cli.js');
const mcpb = (cwd, ...args) => execFileSync(process.execPath, [mcpbCli, ...args], { cwd, stdio: 'inherit' });

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
try {
  cpSync(join(pkg, 'mcpb', 'server'), join(stage, 'server'), { recursive: true });
  const license = join(repo, 'LICENSE');
  if (existsSync(license)) copyFileSync(license, join(stage, 'LICENSE'));
  const icon = join(repo, '.claude-plugin', 'icon.png');
  if (existsSync(icon)) {
    copyFileSync(icon, join(stage, 'icon.png'));
    manifest.icon = 'icon.png';
  }
  writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  mcpb(stage, 'validate', 'manifest.json');
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  mcpb(stage, 'pack', '.', out);

  // Start the packed server as Claude Desktop would (node ${__dirname}/server/index.js).
  mcpb(unpacked, 'unpack', out, unpacked);
  const packed = JSON.parse(readFileSync(join(unpacked, 'manifest.json'), 'utf8'));
  const args = packed.server.mcp_config.args.map((a) => a.replace('${__dirname}', unpacked));
  const client = new Client({ name: 'mcpb-check', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args, cwd: unpacked, stderr: 'inherit' }));
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort().join(', ');
    if (tools.length !== manifest.tools.length) throw new Error(`the packed server lists ${tools.length} tools (${names}); manifest.json lists ${manifest.tools.length}`);
    console.log(`the packed server starts and lists: ${names}`);
  } finally {
    await client.close();
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
  rmSync(unpacked, { recursive: true, force: true });
}
console.log(`packed dist-mcpb/prompt-engine.mcpb (${(statSync(out).size / 1024).toFixed(0)} KiB)`);
