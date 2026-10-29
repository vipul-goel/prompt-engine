// package.json, the MCPB manifest and the MCP Registry server.json agree with
// each other and with the plugin version, and validate against their schemas.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/generated/content.js';
import { TOOL_NAMES } from '../src/server.js';
import { PKG, REPO, schemaErrors } from './helpers.js';

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const pkg = readJson(join(PKG, 'package.json'));
const manifest = readJson(join(PKG, 'manifest.json'));
const server = readJson(join(PKG, 'server.json'));
const pluginPath = join(REPO, '.claude-plugin', 'plugin.json');

describe('versions', () => {
  it('match everywhere', () => {
    expect(pkg.version).toBe(VERSION);
    expect(manifest.version).toBe(VERSION);
    expect(server.version).toBe(VERSION);
    expect(server.packages.map((p: { version: string }) => p.version)).toEqual([VERSION]);
    if (existsSync(pluginPath)) expect(readJson(pluginPath).version).toBe(VERSION);
  });
});

describe('package.json', () => {
  it('is set up for npx and the MCP Registry', () => {
    expect(pkg.name).toBe('prompt-engine-mcp');
    expect(pkg.type).toBe('module');
    expect(pkg.bin).toEqual({ 'prompt-engine-mcp': 'dist/cli.js' });
    expect(pkg.files).toEqual(['dist']);
    expect(pkg.engines).toEqual({ node: '>=20' });
    expect(pkg.license).toBe('MIT');
    expect(pkg.mcpName).toBe(server.name);
    expect(pkg.repository).toMatchObject({ url: 'git+https://github.com/vipul-goel/prompt-engine.git', directory: 'mcp' });
    for (const script of ['build', 'test', 'test:inspector', 'bundle', 'pack:mcpb', 'prepublishOnly']) expect(pkg.scripts[script], script).toBeTruthy();
  });

  it('pins every dependency exactly', () => {
    for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(range, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('server.json (MCP Registry)', () => {
  it('validates against the 2025-12-11 schema', () => {
    const schema = readJson(join(PKG, 'test', 'fixtures', 'server.schema.2025-12-11.json'));
    expect(server.$schema).toBe(schema.$id);
    expect(schemaErrors(schema, server)).toBeUndefined();
  });

  it('describes the npm package over stdio, with no remotes yet', () => {
    expect(server.name).toBe('io.github.vipul-goel/prompt-engine');
    expect([...server.description].length).toBeLessThanOrEqual(100);
    expect(server.packages).toEqual([
      expect.objectContaining({ registryType: 'npm', identifier: pkg.name, version: VERSION, transport: { type: 'stdio' } }),
    ]);
    expect(server.repository).toMatchObject({ url: 'https://github.com/vipul-goel/prompt-engine', source: 'github' });
    expect(server.remotes).toBeUndefined();
  });
});

describe('manifest.json (MCPB)', () => {
  it('validates against the MCPB 0.3 schema', () => {
    const require = createRequire(import.meta.url);
    const schemaPath = join(dirname(require.resolve('@anthropic-ai/mcpb')), 'mcpb-manifest-v0.3.schema.json');
    expect(schemaErrors(readJson(schemaPath), manifest)).toBeUndefined();
  });

  it('runs the single-file bundle with node and lists the real tools', () => {
    expect(manifest.manifest_version).toBe('0.3');
    expect(manifest.server).toEqual({
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: { command: 'node', args: ['${__dirname}/server/index.js'] },
    });
    expect(manifest.compatibility.runtimes).toEqual({ node: '>=20.0.0' });
    expect(manifest.tools.map((t: { name: string }) => t.name)).toEqual([...TOOL_NAMES]);
  });
});
