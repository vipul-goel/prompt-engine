// package.json, the MCPB manifest and the MCP Registry server.json agree with
// each other and with the plugin version, and validate against their schemas;
// the MCPB bundle's third-party notices cover what it bundles.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, type Metafile } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { DOMAINS } from '../src/brief.js';
import { VERSION } from '../src/generated/content.js';
import { TOOL_NAMES } from '../src/server.js';
import { PKG, REPO, schemaErrors } from './helpers.js';

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const pkg = readJson(join(PKG, 'package.json'));
const manifest = readJson(join(PKG, 'manifest.json'));
const server = readJson(join(PKG, 'server.json'));
const lock = readJson(join(PKG, 'package-lock.json'));
const pluginPath = join(REPO, '.claude-plugin', 'plugin.json');

describe('versions', () => {
  it('match everywhere', () => {
    expect(pkg.version).toBe(VERSION);
    expect(manifest.version).toBe(VERSION);
    expect(server.version).toBe(VERSION);
    expect(server.packages.map((p: { version: string }) => p.version)).toEqual([VERSION]);
    // scripts/version.mjs writes both of the lockfile's; npm ci reads neither.
    expect([lock.version, lock.packages[''].version]).toEqual([VERSION, VERSION]);
    if (existsSync(pluginPath)) expect(readJson(pluginPath).version).toBe(VERSION);
  });
});

describe('package.json', () => {
  it('is set up for npx and the MCP Registry', () => {
    expect(pkg.name).toBe('prompt-engine-mcp');
    expect(pkg.type).toBe('module');
    expect(pkg.bin).toEqual({ 'prompt-engine-mcp': 'dist/cli.js' });
    // The Cloudflare Worker entry is built into dist/ but isn't part of the npm package.
    expect(pkg.files).toEqual(['dist', '!dist/worker.js']);
    expect(pkg.engines).toEqual({ node: '>=22.19.0' });
    expect(pkg.license).toBe('MIT');
    expect(pkg.mcpName).toBe(server.name);
    expect(pkg.repository).toMatchObject({ url: 'git+https://github.com/vipul-goel/prompt-engine.git', directory: 'mcp' });
    for (const script of ['build', 'test', 'test:inspector', 'test:pack', 'bundle', 'pack:mcpb', 'prepublishOnly']) expect(pkg.scripts[script], script).toBeTruthy();
    // CI and the release build call `npm run test:pack [-- <tgz>]`; the tarball path reaches
    // smoke-pack.mjs as its first argument.
    expect(pkg.scripts['test:pack']).toBe('node scripts/smoke-pack.mjs');
  });

  // A copy of scripts/license.mjs in a temporary tree, so the real LICENSE files stay put.
  const licenseTree = () => {
    const root = mkdtempSync(join(tmpdir(), 'prompt-engine-license-'));
    const script = join(root, 'mcp', 'scripts', 'license.mjs');
    mkdirSync(dirname(script), { recursive: true });
    cpSync(join(PKG, 'scripts', 'license.mjs'), script);
    const run = (action: string) => spawnSync(process.execPath, [script, action], { encoding: 'utf8' });
    return { root, run, copy: join(root, 'mcp', 'LICENSE') };
  };

  it('copies the root LICENSE in for npm pack, keeps a hand-placed one, and fails when there is none', () => {
    const { root, run, copy } = licenseTree();
    try {
      // No LICENSE in either place: prepack fails, so npm pack and npm publish stop.
      const none = run('copy');
      expect(none.status).toBe(1);
      expect(none.stderr).toMatch(/no LICENSE at .* or .*; the npm package must carry one/);
      expect(existsSync(copy)).toBe(false);

      // The root LICENSE is copied in, and remove deletes that copy.
      writeFileSync(join(root, 'LICENSE'), 'root license\n');
      expect(run('copy').status).toBe(0);
      expect(readFileSync(copy, 'utf8')).toBe('root license\n');
      expect(run('remove').status).toBe(0);
      expect(existsSync(copy)).toBe(false);

      // A LICENSE put in mcp/ by hand is used as it is and kept: next to the root LICENSE, as in
      // this repository, and with no root LICENSE.
      writeFileSync(copy, 'hand-placed\n');
      expect(run('copy').status).toBe(0);
      expect(readFileSync(copy, 'utf8')).toBe('hand-placed\n');
      expect(run('remove').status).toBe(0);
      expect(readFileSync(copy, 'utf8')).toBe('hand-placed\n');
      rmSync(join(root, 'LICENSE'));
      expect(run('copy').status).toBe(0);
      expect(run('remove').status).toBe(0);
      expect(readFileSync(copy, 'utf8')).toBe('hand-placed\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // A pack that fails between prepack and postpack, such as one given a --pack-destination
  // that doesn't exist, leaves the copy and its marker behind.
  it('keeps a LICENSE written over a copy that a failed pack left behind', () => {
    const { root, run, copy } = licenseTree();
    try {
      writeFileSync(join(root, 'LICENSE'), 'root license\n');
      expect(run('copy').status).toBe(0);
      writeFileSync(copy, 'hand-placed\n');
      expect(run('copy').status).toBe(0);
      expect(readFileSync(copy, 'utf8')).toBe('hand-placed\n');
      expect(run('remove').status).toBe(0);
      expect(existsSync(copy) ? readFileSync(copy, 'utf8') : 'deleted').toBe('hand-placed\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('replaces a copy that a failed pack left behind with the root LICENSE as it is now, and removes it after the pack', () => {
    const { root, run, copy } = licenseTree();
    try {
      writeFileSync(join(root, 'LICENSE'), 'root license\n');
      expect(run('copy').status).toBe(0);
      writeFileSync(join(root, 'LICENSE'), 'root license, updated\n');
      expect(run('copy').status).toBe(0);
      expect(readFileSync(copy, 'utf8')).toBe('root license, updated\n');
      expect(run('remove').status).toBe(0);
      expect(existsSync(copy)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('packs the built server without the Cloudflare Worker entry', () => {
    // npm sets npm_execpath when it runs the tests; fall back to npm on PATH.
    const npm = process.env.npm_execpath?.endsWith('.js') ? [process.execPath, process.env.npm_execpath] : ['npm'];
    const r = spawnSync(npm[0]!, [...npm.slice(1), 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: PKG, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const files: string[] = JSON.parse(r.stdout)[0].files.map((f: { path: string }) => f.path);
    expect(files).toContain('dist/cli.js');
    expect(files).toContain('dist/generated/content.js');
    expect(files).not.toContain('dist/worker.js');
    // A LICENSE is listed only when one is in mcp/: put there by hand, which license.mjs keeps, or
    // left by a pack that failed. npm run test:pack checks that the packed tarball carries one.
    expect(files.filter((f) => !f.startsWith('dist/') && f !== 'LICENSE').sort()).toEqual(['README.md', 'package.json']);
  });

  it("agrees with the lockfile's root entry, which npm ci doesn't compare", () => {
    // npm ci accepts a lockfile whose root version, engines, license or bin differ from
    // package.json and leaves them as they are; `npm install` in mcp/ writes them again.
    const root = lock.packages[''];
    expect(lock.name).toBe(pkg.name);
    for (const key of ['name', 'version', 'license', 'bin', 'engines']) expect(root[key], key).toEqual(pkg[key]);
  });

  it('pins every dependency exactly', () => {
    for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(range, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('how the server describes itself', () => {
  // With --http the server answers network requests, so the npm description, the MCPB
  // description and --help say what it never does instead: call a model or any other service.
  it('says it never calls a model or any other service, not that it makes no network calls', () => {
    const help = spawnSync(process.execPath, [join(PKG, 'dist', 'cli.js'), '--help'], { encoding: 'utf8' });
    expect(help.status, help.stderr).toBe(0);
    const texts = { 'package.json description': pkg.description, 'manifest.json long_description': manifest.long_description, '--help': help.stdout };
    for (const [where, text] of Object.entries(texts)) {
      expect(text, where).toMatch(/never calls a model or any other service/);
      expect(text, where).not.toMatch(/network calls/i);
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

  // This reads the source file; pack-mcpb.mjs (npm run pack:mcpb) checks the copy the bundle ships.
  it('mcp/icon.png is a 512x512 PNG', () => {
    const png = readFileSync(join(PKG, 'icon.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
  });

  it('runs the single-file bundle with node and lists the real tools', () => {
    expect(manifest.manifest_version).toBe('0.3');
    expect(manifest.server).toEqual({
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: { command: 'node', args: ['${__dirname}/server/index.js'] },
    });
    expect(Object.keys(manifest.compatibility.runtimes)).toEqual(['node']);
    expect(manifest.tools.map((t: { name: string }) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('states the same Node floor as package.json engines', () => {
    // The lowest version a range such as ">=22.19" or ">=22.19.0" allows, as x.y.z. Any other
    // shape of range throws: if engines or the manifest switch to one, update this helper too.
    const floor = (range: string) => {
      const m = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range);
      if (!m) throw new Error(`unexpected Node range ${JSON.stringify(range)}: expected >=x, >=x.y or >=x.y.z`);
      return [m[1], m[2] ?? '0', m[3] ?? '0'].join('.');
    };
    expect(floor('>=22.19')).toBe('22.19.0');
    expect(() => floor('^22.19.0')).toThrow(/unexpected Node range/);
    expect(floor(manifest.compatibility.runtimes.node)).toBe(floor(pkg.engines.node));
  });

  // These tool descriptions ship in the .mcpb and are written apart from the server's own, the ones
  // the model reads, which brief.test.ts and integration.test.ts check.
  const toolDescription = (name: string): string => manifest.tools.find((t: { name: string }) => t.name === name)?.description ?? '';

  it('says ask_user shows a form only where the app supports one', () => {
    // In an app without forms it returns the questions as text (finding 69).
    expect(toolDescription('ask_user')).toMatch(/\bin a form where the app supports one\b.*\botherwise as a numbered list\b/);
  });

  it('names every domain get_checklist takes, in order', () => {
    expect(toolDescription('get_checklist')).toContain(`a domain: ${DOMAINS.slice(0, -1).join(', ')} or ${DOMAINS.at(-1)}.`);
  });

  it('covers the prompts the server lists', () => {
    // MCPB reads a missing prompts_generated as false: no prompts beyond manifest.prompts, and
    // Claude Desktop is reported to refuse an undeclared one. The server lists `enhance`
    // (integration.test.ts pins that), whose text changes with its mode, so the manifest
    // doesn't declare it statically. pack-mcpb.mjs checks the packed server's list.
    expect(manifest.prompts).toBeUndefined();
    expect(manifest.prompts_generated).toBe(true);
  });
});

describe('third-party notices (MCPB bundle)', () => {
  // scripts/notices.mjs is plain JavaScript with no type declarations, so import it untyped.
  const notices = () => import(pathToFileURL(join(PKG, 'scripts', 'notices.mjs')).href);
  // The bundle's inputs, resolved as scripts/bundle.mjs resolves them, without writing a file.
  let bundled: { metafile: Metafile; indexJs: string } | undefined;
  const bundle = async () => {
    if (!bundled) {
      const r = await build({
        absWorkingDir: PKG, entryPoints: ['src/cli.ts'], outfile: join(PKG, 'mcpb', 'server', 'index.js'), write: false,
        bundle: true, platform: 'node', format: 'esm', target: 'node22', metafile: true, logLevel: 'silent',
      });
      bundled = { metafile: r.metafile, indexJs: r.outputFiles[0]!.text };
    }
    return bundled;
  };
  const temp = () => mkdtempSync(join(tmpdir(), 'prompt-engine-notices-'));

  it('reads the version from a .pnpm folder name', async () => {
    const { pnpmVersion } = await notices();
    expect(pnpmVersion('ajv@8.18.0')).toBe('8.18.0');
    expect(pnpmVersion('ajv-formats@3.0.1_ajv@8.18.0')).toBe('3.0.1');
    expect(pnpmVersion('@cfworker+json-schema@4.1.1')).toBe('4.1.1');
  });

  it('gives every bundled package and every package the SDK inlines a heading and a license text', async () => {
    const { SDK, SDK_INLINED, bundledPackages, collectNotices, noticeHeadings, renderNotices } = await notices();
    const { metafile, indexJs } = await bundle();
    const list: { name: string; version: string; text: string; via?: string }[] = collectNotices(metafile);
    for (const p of list) expect(p.text.length, `${p.name}@${p.version}`).toBeGreaterThan(100);
    expect(list.filter((p) => p.via).map((p) => `${p.name}@${p.version}`).sort()).toEqual([...SDK_INLINED].sort());
    expect(new Set(list.filter((p) => p.via).map((p) => p.via))).toEqual(new Set([SDK]));
    // What pack-mcpb.mjs checks in the packed copy: a heading for each name in esbuild's path comments.
    const headings: { name: string; version: string }[] = noticeHeadings(renderNotices(list));
    expect(headings).toEqual(list.map((p) => ({ name: p.name, version: p.version })));
    const names = bundledPackages(indexJs);
    expect(names).toEqual(expect.arrayContaining(['@modelcontextprotocol/server', 'zod']));
    for (const name of names) expect(headings.map((h) => h.name), name).toContain(name);
  });

  it('fails, naming the package, when a vendored license text is missing or empty', async () => {
    const { collectNotices } = await notices();
    const { metafile } = await bundle();
    const thirdParty = temp();
    try {
      cpSync(join(PKG, 'third-party'), thirdParty, { recursive: true });
      rmSync(join(thirdParty, 'fast-uri@3.1.8'), { recursive: true });
      expect(() => collectNotices(metafile, { thirdParty })).toThrow(/fast-uri@3\.1\.8 \(inlined in @modelcontextprotocol\/server\): no license text/);
      writeFileSync(join(thirdParty, 'content-type@1.0.5', 'LICENSE'), '\n \n');
      expect(() => collectNotices(metafile, { thirdParty })).toThrow(/content-type@1\.0\.5 \(inlined in @modelcontextprotocol\/server\): third-party\/content-type@1\.0\.5\/LICENSE is empty/);
    } finally {
      rmSync(thirdParty, { recursive: true, force: true });
    }
  });

  it('fails when the SDK is not the version its inlined list was reviewed for, or inlines another set', async () => {
    const { SDK_INLINED, collectNotices } = await notices();
    const { metafile } = await bundle();
    expect(() => collectNotices(metafile, { sdkVersion: '2.4.1' })).toThrow(/@modelcontextprotocol\/server is \d+\.\d+\.\d+, but SDK_INLINED .* lists what 2\.4\.1 inlines/);
    const fewer = SDK_INLINED.filter((p: string) => !p.startsWith('ajv@'));
    expect(() => collectNotices(metafile, { sdkInlined: fewer })).toThrow(/@modelcontextprotocol\/server inlines ajv@8\.18\.0, which SDK_INLINED in scripts\/notices\.mjs doesn't list/);
    expect(() => collectNotices(metafile, { sdkInlined: [...SDK_INLINED, 'leftpad@1.0.0'] })).toThrow(/SDK_INLINED in scripts\/notices\.mjs lists leftpad@1\.0\.0, which @modelcontextprotocol\/server's \/\/#region comments don't name/);
  });

  it('fails when a bundled package has no license file or an empty one, or the SDK is missing or names nothing it inlines', async () => {
    const { collectNotices } = await notices();
    const root = temp();
    try {
      const write = (path: string, text: string) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      };
      write('node_modules/bare/package.json', '{ "name": "bare", "version": "1.0.0" }');
      write('node_modules/bare/index.js', 'export {};\n');
      write('node_modules/blank/package.json', '{ "name": "blank", "version": "2.0.0" }');
      write('node_modules/blank/LICENSE.md', '\n');
      write('node_modules/blank/index.js', 'export {};\n');
      write('node_modules/@modelcontextprotocol/server/package.json', '{ "name": "@modelcontextprotocol/server", "version": "2.4.0" }');
      write('node_modules/@modelcontextprotocol/server/LICENSE', 'Apache-2.0\n');
      write('node_modules/@modelcontextprotocol/server/dist/index.mjs', '//#region src/index.ts\nexport {};\n//#endregion\n');
      const failure = (inputs: string[]) => {
        try {
          collectNotices({ inputs: Object.fromEntries(inputs.map((i) => [i, {}])) }, { root });
        } catch (e) {
          return (e as Error).message;
        }
        return 'no error';
      };
      const message = failure(['src/cli.ts', 'node_modules/bare/index.js', 'node_modules/blank/index.js', 'node_modules/@modelcontextprotocol/server/dist/index.mjs']);
      expect(message).toMatch(/bare@1\.0\.0: no license file in node_modules\/bare/);
      expect(message).toMatch(/blank@2\.0\.0: node_modules\/blank\/LICENSE\.md is empty/);
      expect(message).toMatch(/lists ajv-formats@3\.0\.1, ajv@8\.18\.0, .*json-schema-traverse@1\.0\.0, which @modelcontextprotocol\/server's \/\/#region comments don't name/);
      expect(failure(['src/cli.ts'])).toMatch(/the bundle has no input from @modelcontextprotocol\/server/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads package names from esbuild path comments, at the last node_modules/', async () => {
    const { bundledPackages } = await notices();
    const js = [
      '// src/cli.ts',
      '// node_modules/zod/v4/core/core.js',
      '// node_modules/@hono/node-server/dist/index.mjs',
      '// node_modules/outer/node_modules/@scope/inner/lib/x.js',
      '// @__NO_SIDE_EFFECTS__',
      'const s = "// node_modules/not-a-comment/x.js";',
    ].join('\n');
    expect(bundledPackages(js)).toEqual(['@hono/node-server', '@scope/inner', 'zod']);
  });

  it('reads back the headings it writes, and no look-alike lines in a license text', async () => {
    const { noticeHeadings, renderNotices } = await notices();
    const text: string = renderNotices([
      { name: 'a', version: '1.0.0', text: 'Section\n=====\nlooks 2.0\n=====\nb 2.0.0' },
      { name: '@s/b', version: '2.0.0', text: 'B', via: 'x' },
    ]);
    expect(text).toMatch(/^server\/index\.js is a single file built with esbuild from this project's own code/);
    expect(noticeHeadings(text)).toEqual([{ name: 'a', version: '1.0.0' }, { name: '@s/b', version: '2.0.0' }]);
  });
});
