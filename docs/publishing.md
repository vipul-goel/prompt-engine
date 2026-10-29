# Publishing

This page is for maintainers. It covers where each part of Prompt Engine is published, the one-time setup, and how to cut a release. Facts about third-party services were checked on 2026-10-29; services change, so recheck anything that fails.

## Where each part goes

| Channel | What users get | How it's published | Needs |
|---|---|---|---|
| Claude Code and Claude.ai plugin marketplace | The plugin (this repository is the marketplace) | Merging to `main`. Users get the new version when `version` in `.claude-plugin/plugin.json` changes | Nothing |
| `npx skills add vipul-goel/prompt-engine`, manual copies | `skills/prompt-engine/` | Merging to `main` | Nothing |
| GitHub release | `prompt-engine.zip` (skill upload), `prompt-engine.mcpb` (Claude Desktop), the universal files and `SHA256SUMS` | The Release workflow, when you push a `v*` tag | Nothing beyond the workflow's built-in token |
| npm | `prompt-engine-mcp` | The Release workflow | An `NPM_TOKEN` secret, or a publish by hand |
| MCP Registry | `io.github.vipul-goel/prompt-engine` | The Release workflow, through GitHub OIDC | That version already on npm |
| Anthropic's directory (optional) | A listing on claude.ai, in Cowork and in Claude Code | A submission in the developer portal | A paid Claude plan |
| Hosted MCP server (optional) | A remote MCP URL | Your own deploy | A Cloudflare account or any Node host |

## One-time setup

1. **npm.** The package name `prompt-engine-mcp` was unclaimed when this was written. Pick one option:
   - Publish the first version by hand from a clean checkout: `cd mcp && npm ci && npm publish --access public` (the `prepublishOnly` script builds and tests first). Do this before you push the tag, and the workflow will skip npm and go on to the MCP Registry.
   - Or create an npm access token that can publish this package and save it as the repository secret `NPM_TOKEN` (Settings → Secrets and variables → Actions). The workflow then publishes with [provenance](https://docs.npmjs.com/generating-provenance-statements).
   - npm also offers trusted publishing, which needs no long-lived token and is set up in the package's settings on npmjs.com. Whether it can do the very first publish wasn't verified, and `release.yml` would need small changes to use it.
2. **MCP Registry.** No setup. The `io.github.vipul-goel/` namespace belongs to the GitHub account `vipul-goel`, and the workflow logs in with GitHub's OIDC token, so the release must run in this repository. The registry was in preview when this was written.
3. **GitHub.** Actions must be enabled. The Release workflow asks for `contents: write` (to create the release) and `id-token: write` (npm provenance and the registry login) in the workflow file itself.

## Cut a release

1. **Pick the version.** Use [semantic versioning](https://semver.org/). One number covers every part. While the version is 0.x, the GitHub release is marked as a pre-release.
2. **Set it everywhere:**

   ```bash
   node scripts/version.mjs 0.2.0
   ```

   This updates `.claude-plugin/plugin.json`, the skill's `metadata.version`, and `mcp/package.json`, `package-lock.json`, `server.json` and `manifest.json`, then regenerates derived files. The validator fails if any of them disagree.
3. **Update `CHANGELOG.md`.** Move the "Unreleased" entries under a `## [0.2.0] - YYYY-MM-DD` heading.
4. **Run the checks:**

   ```bash
   node scripts/build.mjs --check && node scripts/validate.mjs && node --test scripts/test/*.test.mjs && claude plugin validate . --strict
   ```

   ```bash
   cd mcp && npm ci && npm test && npm run test:inspector
   ```

   ```bash
   node scripts/release.mjs
   ```

   The last command builds every release file into `dist/` without publishing anything. For changes to the method, also run the behavior evals (see [CONTRIBUTING.md](../CONTRIBUTING.md#behavior-evals)).
5. **Merge to `main`, then tag the merge commit:**

   ```bash
   git tag v0.2.0
   ```

   ```bash
   git push origin v0.2.0
   ```

6. **Watch the Release workflow.** It tests the MCP server, builds the release files (and stops if the tag doesn't match the version), creates the GitHub release, publishes to npm, then publishes to the MCP Registry. The npm and registry steps print a warning and skip, instead of failing, when there's no `NPM_TOKEN` or the version isn't on npm.

If a registry publish was skipped, run it by hand once the npm version exists: download `mcp-publisher` from the [registry's releases](https://github.com/modelcontextprotocol/registry/releases), then in `mcp/` run `mcp-publisher login github` and `mcp-publisher publish`.

### How users receive it

- **Claude Code:** `claude plugin update prompt-engine@vipul-goel`, or automatically if they turned on auto-update for the marketplace (it's off by default for third-party marketplaces). Because `plugin.json` sets `version`, pushing commits without bumping it does not reach installed copies.
- **Claude.ai skill uploads and copied folders:** users replace the old copy themselves.
- **`npx skills add`:** users run the install command again.
- **MCP:** `npx -y prompt-engine-mcp` runs whatever npm resolves; users who pinned a version change it themselves. Claude Desktop users install the new `.mcpb`.
- **Universal prompt:** users paste the new file.

## Optional: Anthropic's directory

A directory listing reaches people on claude.ai, in Cowork and in Claude Code (where it loads as `prompt-engine@synced`). According to Anthropic's [publishing guide](https://code.claude.com/docs/en/plugins/publish.md#submit-to-anthropics-directory):
- you submit from the developer portal at [claude.ai/directory/manage](https://claude.ai/directory/manage), which needs a paid Claude plan;
- each version is reviewed before it's published;
- the portal applies more rules than `claude plugin validate`, so a clean local run doesn't guarantee approval.

The listing icon comes from `.claude-plugin/icon.png`. According to the validator, that icon is taken only the first time the plugin is saved or submitted in the portal, so changing the file later doesn't change the listing.

Submit only the plugin. Anthropic's directory no longer takes `.mcpb` submissions, so the bundle ships through GitHub releases.

## Optional: host the MCP server

The server can also run over HTTP for people who want a remote URL instead of a local process. It makes no outbound calls and stores nothing, so hosting it means running one stateless process. [mcp/README.md](../mcp/README.md) covers the HTTP mode, the allowed-hosts setting and the Cloudflare Worker.

## Secrets

| Secret | Used by | Needed for |
|---|---|---|
| `NPM_TOKEN` | Release | Publishing to npm from CI. Not needed if you publish by hand |
| `ANTHROPIC_API_KEY` | Evals (manual runs only) | Running the behavior evals in CI. Each run makes billed model calls; the workflow defaults to a $5 cost ceiling |

## Monthly data check

The "Re-verify tool data" workflow opens an issue once a month when an entry in `data/media-targets.json` hasn't been checked for 60 days. To handle it:
1. Check each listed tool against the vendor's current docs.
2. Update the entry's fields, `status` and `sources`, and set `last_verified` to today.
3. Run `node scripts/build.mjs` and commit the regenerated files.
