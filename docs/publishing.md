# Publishing

This page is for maintainers. It covers where each part of Prompt Engine is published, the one-time setup, and how to cut a release. Facts about third-party services were checked on 2026-10-29. npm's trusted-publishing rules, the MCP Registry's release files, this repository's rulesets, Claude Code's and claude.com's plugin docs, what a plugin install copies (with Claude Code 2.1.319), and GitHub's rule for idle scheduled workflows were checked on 2026-11-08. The npm package's versions, maintainer and contents were checked on 2026-11-09. The MCP Registry's rule for GitHub OIDC logins was checked on 2026-11-10, in its code at v1.8.6 (the `mcp-publisher` release the workflow uses) and at v1.8.8 (the deployed registry). Services change, so recheck anything that fails.

## Where each part goes

| Channel | What users get | How it's published | Needs |
|---|---|---|---|
| Claude Code plugin marketplace | The plugin (this repository is the marketplace) | Merging to `main`. A new install (`prompt-engine@vipul-goel`) gets `main` as it is then, under the version in `.claude-plugin/plugin.json`. An existing install changes only when that version changes and the user updates; see [How users receive it](#how-users-receive-it) | Nothing |
| Claude.ai and Cowork (marketplace added there) | The same plugin, which also loads in Claude Code as `prompt-engine@synced` | Merging to `main`. Users select **Check for updates** on the marketplace, or rely on **Sync automatically** where it's on. Whether a commit without a version change reaches them isn't documented and wasn't tested here | Nothing |
| `npx skills add vipul-goel/prompt-engine`, manual copies | `skills/prompt-engine/` | Merging to `main` | Nothing |
| GitHub release | `prompt-engine.zip` (skill upload), `prompt-engine.mcpb` (Claude Desktop), the universal files and `SHA256SUMS` | The Release workflow, when you push a `v*` tag | Nothing beyond the workflow's built-in token |
| npm | `prompt-engine-mcp` | The Release workflow, through npm's trusted publishing (GitHub OIDC) | A first version published by hand (done on 2026-11-09), then a trusted publisher on npmjs.com |
| MCP Registry | `io.github.vipul-goel/prompt-engine` | The Release workflow, through GitHub OIDC | That version already on npm |
| Anthropic's directory (optional) | A listing on claude.ai, in Cowork and in Claude Code | A submission in the developer portal | A paid Claude plan |
| Hosted MCP server (optional) | A remote MCP URL | Your own deploy | A Cloudflare account or any Node host |

The plugin's source is the repository root (`"source": "./"` in `.claude-plugin/marketplace.json`), so every file committed to `main` reaches every Claude Code user who installs it from GitHub, twice: in the marketplace clone and in the plugin cache. Keep handoff notes, review records and large files off `main`.

## One-time setup

1. **npm.** The package name `prompt-engine-mcp` was claimed on 2026-11-09: the npm account `vipul-goel` published the placeholder version `0.0.1` by hand, as the first item below describes, and `npm view prompt-engine-mcp maintainers` lists that account. The placeholder is npm's `latest`, and so what `npx -y prompt-engine-mcp` runs, until a release publishes a higher version: it is the server built from commit 60f4ef1 with the version set to `0.0.1` (a rebuild of that commit gave the same tarball, byte for byte), published without a provenance statement. The registry also lists `0.0.0-stage`, published from the same account three minutes earlier, which `latest` doesn't point to: a holding version of two files, a `package.json` marked `stub` (no `bin`, no `mcpName`) and a README that calls it a temporary placeholder awaiting a staged release. The workflow publishes with npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers), which uses GitHub's OIDC token instead of a stored npm token, and npm adds [provenance](https://docs.npmjs.com/generating-provenance-statements) automatically. npm can only set up trusted publishing for a package that already exists, so:
   - Publish a first version by hand. This was done on 2026-11-09; the steps stay here as the record of how. Run `npm login` and make a clean copy of the repository (for example `git archive HEAD` unpacked into an empty folder). To claim the name before the first release, first set that copy, not the clone you commit from, to the placeholder version `0.0.1`. npm never accepts the same name and version twice, even after an unpublish, so the placeholder keeps the release's number free. `version.mjs` then reminds you to add a CHANGELOG heading and push a tag: skip both, because the placeholder gets neither, and a `v0.0.1` tag would start the Release workflow.

     ```bash
     node scripts/version.mjs 0.0.1
     ```

     Then publish from the copy:

     ```bash
     cd mcp && npm ci && npm run build && npm run test:pack && npm publish --access public
     ```

     `npm run test:pack` installs the packed package in a temporary folder and starts it, and the `prepublishOnly` script builds it again and runs the tests before the upload. Then check that `npm view prompt-engine-mcp maintainers` lists your account. If the version you publish by hand is the one you're about to release, the workflow skips npm and goes on to the MCP Registry.
   - Set the repository variable `NPM_OWNER` to the npm account that owns the package (Settings → Secrets and variables → Actions → Variables). It has been `vipul-goel` since 2026-11-09. When the version being released is already on npm, the workflow treats it as published only if that account is one of the package's maintainers. Otherwise, and when the variable isn't set, the npm job fails and the MCP Registry job doesn't run.
   - Then add a trusted publisher on npmjs.com: open the package's settings, find **Trusted Publisher**, choose **GitHub Actions**, and enter `vipul-goel`, `prompt-engine` and the workflow file name `release.yml` (it must be in `.github/workflows/`). Under **Allowed actions**, also allow `npm publish`; a configuration created after 2026-09-03 allows only `npm stage publish` unless you do. Add it no more than 2 days before you push the first tag whose version isn't on npm yet: a new configuration that hasn't completed a publish within 2 days expires.
   - Don't add an npm token to the repository: npm plans to end direct publishing with granular access tokens in January 2027. Once a release has published through the trusted publisher, you can set the package's **Publishing access** to "Require two-factor authentication and disallow tokens"; trusted publishing keeps working.
2. **MCP Registry.** No setup. The workflow logs in with GitHub's OIDC token, and the registry gives that login every name under `io.github.vipul-goel/`, whichever of the `vipul-goel` account's repositories it comes from: it looks only at the token's repository owner, not at its repository, workflow, branch or tag. So a fork under another account can't publish these names, but a workflow with `id-token: write` in another of the account's repositories could. The registry was in preview when this was written.
3. **GitHub.** Actions must be enabled. The Release workflow sets its permissions job by job: only the job that creates the GitHub release can write to the repository (`contents: write`), and only the npm and MCP Registry jobs can request an OIDC token (`id-token: write`). The jobs that install and run dependencies can only read the repository. That stops a compromised dependency from writing to the repository or using the publishing credentials. The build job installs only the versions that `mcp/package-lock.json` pins, but a compromised one of those can still alter the files that job builds, which the other jobs then publish. `npm run test:pack` installs the packed package the way `npx` does, so the dependencies' own dependencies come fresh from the registry, at whatever versions are current when the tag is pushed. That's why it runs in a job of its own after the upload, where it can't change the files the publishing jobs take: they wait for it, and download the files by the ID the upload returned. Two repository rulesets back up the release steps (Settings → Rules → Rulesets): "Protect main" lets changes reach `main` only through a pull request whose four CI checks pass, and blocks force pushes and deletion; "Release tags" lets only repository admins create, move or delete `v*` tags.

## Cut a release

1. **Pick the version.** Use [semantic versioning](https://semver.org/). One number covers every part. While the version is 0.x, the GitHub release is marked as a pre-release.
2. **Set it everywhere:**

   ```bash
   node scripts/version.mjs 0.2.0
   ```

   This updates `.claude-plugin/plugin.json`, the skill's `metadata.version`, and `mcp/package.json`, `package-lock.json`, `server.json` and `manifest.json`, then regenerates derived files. The validator fails if any of them except `package-lock.json` disagrees with `plugin.json`; neither it nor the MCP tests read the lockfile's version.
3. **Update `CHANGELOG.md`.** Move the "Unreleased" entries under a `## [0.2.0] - YYYY-MM-DD` heading. For the first release, replace "not yet released" in the `## [0.1.0]` heading with the date.
4. **Run the checks:**

   ```bash
   node scripts/build.mjs --check && node scripts/validate.mjs && node --test scripts/test/*.test.mjs && claude plugin validate . --strict
   ```

   ```bash
   cd mcp && npm ci && npm test && npm run test:inspector && npm run test:pack
   ```

   The MCP checks need Node.js 22.19 or later, because `npm run test:inspector` uses the MCP Inspector. `npm run test:pack` installs the packed npm package in a temporary folder and starts it; the install needs the npm registry.

   ```bash
   node scripts/release.mjs
   ```

   The last command builds every release file into `dist/` without publishing anything. For changes to the method, also run the behavior evals (see [CONTRIBUTING.md](../CONTRIBUTING.md#behavior-evals)).

   If you have Claude Desktop, also install `dist/prompt-engine.mcpb` in it, run the [Claude Desktop checks](manual-checks.md#claude-desktop-with-the-mcp-bundle) and record the result in [compatibility.md](compatibility.md). A release doesn't wait for this: until a result is recorded, the download links in `README.md`, `docs/install.md` and `mcp/README.md` say the bundle is not yet tested in Claude Desktop, and compatibility.md lists it as unverified. The bundle and the release notes carry no such label. Once a result is recorded, update the Claude Desktop row's status in compatibility.md and those "(not yet tested in Claude Desktop)" notes.
5. **Merge to `main`, then tag the merge commit:**

   ```bash
   git tag v0.2.0
   ```

   ```bash
   git push origin v0.2.0
   ```

   The Release workflow refuses a tag whose commit isn't on `main`, such as the last commit of a branch that was squash-merged, and only repository admins can push a `v*` tag.

6. **Watch the Release workflow.** It first stops unless the tagged commit is on `main`. Then it tests the MCP server, builds the release files (and stops if the tag doesn't match the version) and packs the npm package. A separate job then installs the packed package and starts it, as `npx` would. After that, the GitHub release and the npm publish run side by side, and the MCP Registry publish runs once npm has the version. To stop a release that has started, cancel the run (**Cancel workflow** on its page). Deleting the tag doesn't stop it: the GitHub release job then fails instead of making the tag again, but the npm job can still publish, and npm never accepts that version number again, even after an unpublish. Each publishing job skips what is already published, so if a job fails, fix the cause and choose **Re-run failed jobs** on the run's page (possible for 30 days). A re-run uses the same commit and the same `release.yml`; if the fix needs a change to the repository, finish by hand or release a new version. If the npm job failed, you can also publish that version by hand and then re-run: the npm job skips and the registry job runs. Publish by hand from a clean checkout of the tag (for example `git checkout v0.2.0` in a fresh clone), not from `main`, which may already hold later changes under the same version number; for npm, run `npm login` and the `cd mcp && …` publish command from One-time setup, step 1, there, without `version.mjs`, which is only for the placeholder.

   If a registry publish was skipped or failed, run it by hand from that checkout once the npm version exists. Download the `mcp-publisher` archive for your system and `registry_<version>_checksums.txt` from the same [registry release](https://github.com/modelcontextprotocol/registry/releases) into one folder (for release v1.8.6, the file is `registry_1.8.6_checksums.txt`), and check the archive there with `shasum -a 256 -c --ignore-missing registry_<version>_checksums.txt` (or `sha256sum -c --ignore-missing registry_<version>_checksums.txt`). Both files come from the same release, so this catches a broken download, not a swapped one. Then unpack it, and in `mcp/` run `mcp-publisher login github` and `mcp-publisher publish`.
7. **After the first release only:** delete the notes that say the release files come with the first release and that `npx -y prompt-engine-mcp` runs the `0.0.1` placeholder until then, below the install table in `README.md` and under MCP clients in `docs/install.md`. Then delete the first-release sentence in step 3 and this step.

### How users receive it

- **Claude Code:** `claude plugin update prompt-engine@vipul-goel`, or automatically if they turned on auto-update for the marketplace (it's off by default for third-party marketplaces). Because `plugin.json` sets `version`, pushing commits without bumping it does not reach installed copies, while new installs get those commits under the old number.
- **Claude.ai and Cowork (marketplace added there):** according to claude.com's plugin docs, users select **Check for updates** on the marketplace in Customize → Plugins, or rely on **Sync automatically** where it's on; it's offered for marketplaces added from github.com. Claude Code downloads the account's copy, `prompt-engine@synced`, in the background each time it starts, when it's signed in with that account (Claude Code 2.1.273 or later). Whether a commit without a version change reaches these users isn't documented. Not tested here.
- **Claude.ai skill uploads and copied folders:** users replace the old copy themselves.
- **`npx skills add`:** users run the install command again.
- **MCP:** `npx -y prompt-engine-mcp` runs whatever npm resolves; users who pinned a version change it themselves. Claude Desktop users install the new `.mcpb`.
- **Universal prompt:** users paste the new file.

## Optional: Anthropic's directory

A directory listing reaches people on claude.ai, in Cowork and in Claude Code (where it loads as `prompt-engine@synced`). According to Anthropic's [publishing guide](https://code.claude.com/docs/en/plugins/publish.md#submit-to-anthropics-directory):
- you submit from the developer portal at [claude.ai/directory/manage](https://claude.ai/directory/manage), which needs a paid Claude plan;
- each version is reviewed before it's published;
- the portal applies more rules than `claude plugin validate`, so a clean local run doesn't guarantee approval.

The listing icon comes from `.claude-plugin/icon.png`. According to the validator, that icon is taken only the first time the plugin is saved or submitted in the portal, so changing the file later doesn't change the listing. The `.mcpb` bundle uses `mcp/icon.png`, the same image at 512×512 pixels; if you change the plugin icon, resize it into that file too. `npm run pack:mcpb` fails if that file is missing or the packed icon isn't a 512×512 PNG.

Submit only the plugin. Anthropic's directory no longer takes `.mcpb` submissions, so the bundle ships through GitHub releases.

## Optional: host the MCP server

The server can also run over HTTP for people who want a remote URL instead of a local process. It makes no outbound calls and stores nothing, so hosting it means running one stateless process. [mcp/README.md](../mcp/README.md) covers the HTTP mode, its limits and what a proxy in front of it should add, the allowed-hosts setting and the Cloudflare Worker.

## Secrets

| Secret | Used by | Needed for |
|---|---|---|
| `ANTHROPIC_API_KEY` | Evals (manual runs only) | Running the behavior evals in CI. Each run makes billed model calls; the workflow defaults to a $5 cost ceiling |

## Weekly data check

The "Re-verify tool data" workflow runs once a week. When entries in `data/media-targets.json` haven't been checked for 45 days, it opens one issue that lists them; while that issue stays open, each run that finds stale entries updates the list and adds a comment. It reuses only an issue it opened itself, so an issue that someone else opens with the same title is left alone. To handle it:
1. Check each listed tool against the vendor's current docs.
2. Update the entry's fields, `status` and `sources`, and set `last_verified` to today.
3. Run `node scripts/build.mjs` and commit the regenerated files.
4. Close the issue once that commit is on `main`. The workflow never closes it; an issue left open gets the next round of stale entries, with a "Still stale" comment, instead of a new issue.

GitHub turns off a public repository's scheduled workflows after 60 days without repository activity, and a turned-off workflow doesn't run until it's turned on again. The weekly runs and the 45-day window are set so that the issue opens before then. After a longer quiet spell, open Actions → Re-verify tool data. If GitHub has turned it off, select **Enable workflow**, then **Run workflow** (or run `gh workflow enable verify-data.yml`, then `gh workflow run verify-data.yml`).
