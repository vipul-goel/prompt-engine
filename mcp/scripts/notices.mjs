// Third-party license notices for the MCPB bundle. server/index.js inlines the server's
// runtime dependencies, so their license texts ship next to it in
// server/THIRD_PARTY_NOTICES.txt: bundle.mjs writes the file, and pack-mcpb.mjs checks that
// the packed bundle carries it and that it names every package the packed index.js bundles.
//
// The MCP SDK's own dist already inlines more packages (ajv and others) without their
// license files, and they aren't installed as runtime dependencies. Their texts are vendored
// in third-party/<name>@<version>/LICENSE, each copied unchanged from that package's npm
// tarball. SDK_INLINED is pinned to the SDK version that inlines them, and each vendored text
// to the SHA-256 of the LICENSE in that tarball: when the SDK changes, or a text isn't the
// one pinned, the bundle stops until the list and the vendored texts are reviewed.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SDK = '@modelcontextprotocol/server';
export const SDK_VERSION = '2.4.0';
// Each package SDK_VERSION inlines, with the SHA-256 of the LICENSE in its npm tarball, which
// its text in third-party/ must match byte for byte. To pin one:
//   curl -sL "$(npm view <name>@<version> dist.tarball)" | tar -xzO package/LICENSE | shasum -a 256
// fast-deep-equal and json-schema-traverse ship the same text.
export const VENDORED_LICENSE_SHA256 = {
  'ajv@8.18.0': 'a05350a88e318e4f5f2c2a1ff1e2e88daa4dd38e6e78b71cccae422bdc762cc3',
  'ajv-formats@3.0.1': '9df3bb69929a3b650ed73b3bfa1756725aaff0ac296461605753547004eafeaf',
  'content-type@1.0.5': '257aed98914108e91a337912727b6a802eef218248507f74b76faffaff517a38',
  'fast-deep-equal@3.1.3': '7bf9b2de73a6b356761c948d0e9eeb4be6c1270bd04c79cd489c1e400ffdfc1a',
  'fast-uri@3.1.8': 'b010b0dfdfdb23d7396e03b82cd4621fc9bb8f95d6b0aea70b9c24e12074c786',
  'json-schema-traverse@1.0.0': '7bf9b2de73a6b356761c948d0e9eeb4be6c1270bd04c79cd489c1e400ffdfc1a',
};
export const SDK_INLINED = Object.keys(VENDORED_LICENSE_SHA256);

const RULE = '='.repeat(72);

// The license file in a folder (LICENSE, LICENCE.md, COPYING and the like), if there is one.
function licenseFile(dir) {
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && /^(licen[cs]e|copying)/i.test(d.name)).map((d) => d.name).sort()[0];
}

// A .pnpm folder name such as ajv-formats@3.0.1_ajv@8.18.0 or @cfworker+json-schema@4.1.1:
// the version is the text after the last @ before any _.
export function pnpmVersion(segment) {
  const head = segment.split('_')[0];
  return head.slice(head.lastIndexOf('@') + 1);
}

// esbuild's metafile -> [{ name, version, text, via? }], sorted by name. `via` names the
// package whose own dist inlines this one. Throws one error that lists every problem: a
// package without a license text or with an empty one, a vendored text without a pin or with
// another hash, an SDK other than SDK_VERSION, or an SDK that inlines a set other than
// SDK_INLINED (this also catches //#region comments that stop naming them).
// The options exist for the tests.
export function collectNotices(
  metafile,
  { root = pkg, thirdParty = join(root, 'third-party'), sdkVersion = SDK_VERSION, sdkInlined = SDK_INLINED, licenseSha256 = VENDORED_LICENSE_SHA256 } = {},
) {
  const packages = new Map(); // package folder -> { name, version, text }
  const inlined = new Map(); // name@version -> { name, version, text, via }
  const problems = [];
  for (const input of Object.keys(metafile.inputs)) {
    // The package folder is at the last node_modules/ in the path (two segments for @scope/name).
    const m = input.match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//);
    if (!m) continue; // the project's own src/
    const [, folder, name] = m;
    if (!packages.has(folder)) {
      const { version } = JSON.parse(readFileSync(join(root, folder, 'package.json'), 'utf8'));
      const file = licenseFile(join(root, folder));
      const text = file ? readFileSync(join(root, folder, file), 'utf8').trim() : '';
      if (!file) problems.push(`${name}@${version}: no license file in ${folder}`);
      else if (!text) problems.push(`${name}@${version}: ${folder}/${file} is empty`);
      packages.set(folder, { name, version, text });
    }
    // Code another package's own build inlined, as rolldown's //#region comments name it:
    // //#region ../../node_modules/.pnpm/<segment>/node_modules/<name>/<file>
    const src = readFileSync(join(root, input), 'utf8');
    for (const r of src.matchAll(/^\/\/#region \S*node_modules\/\.pnpm\/([^/\s]+)\/node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//gm)) {
      const version = pnpmVersion(r[1]);
      const key = `${r[2]}@${version}`;
      if (!inlined.has(key)) inlined.set(key, { name: r[2], version, text: '', via: name });
    }
  }

  const sdk = [...packages.values()].find((p) => p.name === SDK);
  if (!sdk) {
    problems.push(`the bundle has no input from ${SDK}, so SDK_INLINED in scripts/notices.mjs can't be checked`);
  } else {
    if (sdk.version !== sdkVersion) {
      problems.push(`${SDK} is ${sdk.version}, but SDK_INLINED in scripts/notices.mjs lists what ${sdkVersion} inlines; review it and third-party/`);
    }
    const fromSdk = [...inlined.values()].filter((p) => p.via === SDK).map((p) => `${p.name}@${p.version}`);
    const unlisted = fromSdk.filter((p) => !sdkInlined.includes(p)).sort();
    const unseen = sdkInlined.filter((p) => !fromSdk.includes(p)).sort();
    if (unlisted.length) problems.push(`${SDK} inlines ${unlisted.join(', ')}, which SDK_INLINED in scripts/notices.mjs doesn't list`);
    if (unseen.length) problems.push(`SDK_INLINED in scripts/notices.mjs lists ${unseen.join(', ')}, which ${SDK}'s //#region comments don't name`);
  }
  for (const p of inlined.values()) {
    const spec = `${p.name}@${p.version}`;
    const dir = join(thirdParty, spec);
    const file = licenseFile(dir);
    const bytes = file ? readFileSync(join(dir, file)) : undefined;
    if (bytes) p.text = bytes.toString('utf8').trim();
    const pinned = Object.hasOwn(licenseSha256, spec) ? licenseSha256[spec] : undefined;
    const hash = bytes && createHash('sha256').update(bytes).digest('hex');
    if (!file) problems.push(`${spec} (inlined in ${p.via}): no license text in third-party/${spec}/`);
    else if (!p.text) problems.push(`${spec} (inlined in ${p.via}): third-party/${spec}/${file} is empty`);
    else if (!pinned) problems.push(`${spec} (inlined in ${p.via}): no SHA-256 pinned for third-party/${spec}/${file} in VENDORED_LICENSE_SHA256 in scripts/notices.mjs`);
    else if (hash !== pinned) {
      problems.push(`${spec} (inlined in ${p.via}): third-party/${spec}/${file} has SHA-256 ${hash}, not the ${pinned} pinned in scripts/notices.mjs; copy the LICENSE from the package's npm tarball unchanged`);
    }
  }
  if (problems.length) throw new Error(`third-party notices:\n  ${problems.join('\n  ')}`);

  const all = new Map();
  for (const p of [...packages.values(), ...inlined.values()]) if (!all.has(`${p.name}@${p.version}`)) all.set(`${p.name}@${p.version}`, p);
  return [...all.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

// The text of server/THIRD_PARTY_NOTICES.txt: a header, then a ruled `name version` heading
// and the full license text for each package.
export function renderNotices(notices) {
  const body = notices.map((p) => `${RULE}\n${p.name} ${p.version}${p.via ? ` (inlined in ${p.via})` : ''}\n${RULE}\n\n${p.text}\n`).join('\n');
  return 'server/index.js is a single file built with esbuild from this project\'s own code and the\n'
    + 'third-party packages below, at the versions named. Their license texts follow. The\n'
    + 'project\'s own license is in LICENSE, next to manifest.json.\n\n'
    + body;
}

// The { name, version } in each heading renderNotices writes.
export function noticeHeadings(text) {
  return [...text.matchAll(new RegExp(`^${RULE}\\n(\\S+) (\\S+)(?: \\(inlined in \\S+\\))?\\n${RULE}$`, 'gm'))].map((m) => ({ name: m[1], version: m[2] }));
}

// The package names in the `// node_modules/<name>/...` path comments esbuild writes into
// index.js, taking the last node_modules/ in each path as collectNotices does.
export function bundledPackages(indexJs) {
  return [...new Set([...indexJs.matchAll(/^\/\/ \S*node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\/\S*$/gm)].map((m) => m[1]))].sort();
}
