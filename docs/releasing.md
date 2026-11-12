# Local release preparation

The tooling creates BRAT-shaped assets **locally only**. It does not create a remote, commit, tag, GitHub release, upload, publish a repository, or submit to the community list. The repository remains private/local until the owner approves the [publication checklist](publish-checklist.md).

## Preconditions

- Clean, independently reviewed source/index; all changes committed with human authorship.
- Bun exactly `1.3.14` (`packageManager`), reviewed pinned Node 22.x (CI 22.14.0), pinned esbuild from `bun.lock`.
- Dependencies installed with `./scripts/run.sh install --frozen-lockfile`; the wrapper always adds `--ignore-scripts`. No lifecycle execution or trusted dependencies. A fresh-install build/native smoke proves optional platform binaries work without installers.
- A populated local private-terms file; complete gates, unit subset and relevant synthetic native evidence. A successful local package is not blanket version/mobile/native-scale acceptance.
- `package.json.version` = `manifest.json.version`; `versions.json[version]` = `manifest.json.minAppVersion`. Keep older version entries. The supply-chain gate enforces this lockstep.

## Build and compare

Run `./scripts/run.sh release:local` from the repository. Default destination is `.workspace/releases/<version>/`; it must not already exist. To keep a separate candidate, pass `--out .workspace/releases/candidate-1`. Existing evidence is never overwritten.

The script checks a clean working tree and exact Bun version, runs **build → gates → unit tests**, rechecks clean tracked inputs, then copies:

- `main.js`, `manifest.json`, `styles.css`: the conventional Obsidian/BRAT runtime assets;
- `versions.json`: the version/minimum-app map, also tracked at repository root for eventual distribution;
- `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.txt`: required legal materials for bundled runtime dependencies;
- `release.json`: source commit and Bun/Node/esbuild versions, with no hostname, username, wall-clock timestamp, or personal path;
- `SHA256SUMS`: sorted SHA-256 checksums of every preceding asset, including provenance.

The worker source is embedded in `main.js`; no separate worker download is needed. Version files are validated tracked source inputs, not guessed from a dirty checkout or release tag. The metadata still says `isDesktopOnly: false`; this is not evidence of mobile acceptance. Reconcile compatibility and the minimum version before a public release.

`./scripts/verify-release.sh` performs **two complete local builds** into distinct ignored directories and compares file sets and every byte, including checksums. Evidence is retained in `.workspace/reproducibility/`. This establishes repeatability for the current source, exact lock/tool versions and platform; it does not promise bitwise-identical layout coordinates across JavaScript engines or universal cross-platform build reproducibility. To check a future approved tag, check out that tag in a clean local checkout, install with scripts disabled and run this verifier there. The script itself creates/checks out no tag.

For an existing candidate, run `sha256sum -c SHA256SUMS` in its output directory. No archive timestamps or absolute source paths are embedded by this packaging step. Any source, dependency, notice, or tool-version change requires a new comparison and review.

## Future distribution, not performed here

BRAT expects a reachable GitHub repository and release assets named `main.js`/`manifest.json`/`styles.css`; the local directory is only compatible material, not an installable public URL. Proposed tag convention is `vX.Y.Z`. Exact tag naming and BRAT end-to-end install need confirmation against the chosen release flow before the first real tag. Keep the version map available at repository root. Publish legal notices and checksums alongside the assets and checksum text in release notes. No automated upload workflow is included.

Recommended first path is BRAT-compatible releases, with community-list submission later after the planned renderer/runtime-dependency work and real-use acceptance. Both are owner decisions. Configure private advisory reporting and GitHub spending/runner boundaries before enabling public intake or CI.

## Artifact lifecycle

Keep accepted release assets/checksums per version; do not overwrite them after tagging. Retain local double-build and native receipts until the release decision lands. Age-prune only owned caches/downloads/reproducible synthetic artifacts after preserving evidence; no volume/vault pruning, rollback, or permanent evidence deletion is authorized by this guide. The default scripts do not auto-delete release outputs. Privacy/history clearance is separate and must be repeated immediately before publication.
