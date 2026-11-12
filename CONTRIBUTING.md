# Contributing

Keep the core ontology-neutral, use public host APIs, and ship one evidence-backed vertical slice at a time. Read [AGENTS.md](AGENTS.md), the [decision records](docs/decisions/README.md), and the [known limits](README.md#not-implemented--not-proven) before changing behavior.

## Simple contribution policy

Contributions are licensed under the repository's MIT license. Submit only work you have the right to contribute. No CLA, DCO, or `Signed-off-by` trailer is required. Use your own human author identity and plain, specific commit messages. Do not name an AI system as an author, contributor, or co-author in commit trailers, package metadata, notices, or documentation. Tool assistance does not transfer authorship.

No remote, publication, real-vault testing, or release is implied by a local change. Never commit private content, personal paths, downloaded Obsidian bytes, generated test vaults, screenshots, raw receipts, or secrets. All fixtures must be synthetic. Human plugin trust and login decisions remain human.

## Setup and verification

Use Bun **1.3.14**, Node.js **22.x** (CI pins 22.14.0), `flock`, and an installed `build-contained` wrapper for local verification. `scripts/run.sh` acquires `/tmp/openclast-local-verification.lock` and enters containment; do not call it inside an already held copy of that lock. The deterministic hosted CI plan uses an isolated ephemeral runner VM instead of the local wrapper. CI has not been run by this change.

1. Configure the local private-terms file described below.
2. `./scripts/run.sh install --frozen-lockfile` installs without lifecycle execution.
3. `./scripts/run.sh build` typechecks and bundles the plugin/worker.
4. `./scripts/run.sh test` runs exactly `tests/core.test.ts`, `tests/adapter.test.ts`, `tests/gates.test.ts`, `tests/pipeline.test.ts`, `tests/declaration-v2.test.ts`, `tests/renderer.test.ts`, `tests/view-lifecycle.test.ts`, `tests/contribution-page.test.ts`, `tests/layout.test.ts`, `tests/explore.test.ts`, and `tests/expr.test.ts`.
5. `./scripts/run.sh gates` runs the full deterministic gates. `bun run gates` is the same entry point when already inside the lock/containment boundary.
6. For authorized synthetic native testing, use `./scripts/run-native-smoke.sh`; `GRAPH_SOFTWARE=1 ./scripts/run-native-smoke.sh` selects the software fallback. This creates/replaces only the documented synthetic fixture destinations, not personal vaults.

`./scripts/install-hooks.sh` is an explicit opt-in local pre-commit installer. It refuses existing/custom hooks rather than replacing them. The hook runs `gates:fast` under the same lock and containment. It checks both current files and staged bytes; it never stages generated notices. Fast means no bundle compression report, build, or unit/native tests. Full verification and independent review are still required before a commit/tag/release. Never use `--no-verify`.

## Gate contract

| Lane | Implementation / scope |
| --- | --- |
| Secrets | `scripts/check-content.mjs secrets`: pattern-based, no network; current tracked/nonignored files plus staged bytes, source paths and ignored screenshot filenames/bytes. Prints locations, never matched values. Not an entropy scanner or guarantee of absence. |
| Attribution | `scripts/check-content.mjs attribution`: author/contributor metadata and attribution trailers in current/index files; all reachable commit messages and identities by default. `GATE_COMMIT_RANGE=BASE..HEAD` explicitly narrows messages; invalid/shallow ranges fail closed. |
| Privacy | `scripts/check-content.mjs privacy`: local fixed-string private terms in current/index content, README, filenames and ignored `test-screenshots/` bytes/names. Binary metadata is scanned as bytes; visual content still requires human/approved visual inspection. |
| Supply chain | `scripts/check-supply-chain.mjs`: exact direct pins, version lockstep, empty trust list, no root install hooks, no runtime install hooks, exact hashed inert dev exceptions, and isolated `bun install --lockfile-only --frozen-lockfile --ignore-scripts` with unchanged lock bytes. |
| Runtime licenses | `scripts/check-licenses.mjs`: enforces zero runtime dependencies and generates an empty notice file. The build separately rejects bundled node_modules inputs; the development-only layout oracle is not shipped. Separate from dev-toolchain exceptions. |
| Bundle report | `scripts/bundle-size.mjs`: raw/gzip/Brotli bytes and SHA-256 for existing `main.js`, plus source commit, in ignored `.workspace/evidence/bundle-size.json`. Build first. Enforces ceilings of 205,000 minified bytes and 66,000 gzip bytes; Brotli is reporting only. |

To scan **all reachable history** before publication, run `./scripts/run.sh gates` and `./scripts/run.sh audit:history`. The latter runs the three standalone content scanners with `--history` inside the verification boundary. Unlike default content scans, `--history` checks every reachable commit's metadata, filenames, and unique blobs. See [the publication checklist](docs/publish-checklist.md). Unreachable objects, external backups, screenshots' rendered content, and unknown private terms still need separate scrutiny.

### Local private terms

Default location: the common Git directory's `info/private-terms` (normally `.git/info/private-terms`). Alternatively set `PRIVATE_TERMS_FILE` to a local gitignored file. Never commit the real list. A root `private-terms` file is ignored as a convenience.

Format matches the existing fixed-string convention: one **literal, case-insensitive** term per line; blank lines and lines whose first nonspace character is `#` are ignored; CRLF is accepted. All other whitespace is significant. Add private domains, personal path prefixes, private projection IDs/hashes and names that must not escape. The local gate fails if the list is missing/empty. It never prints a matching term or private content. A new clone must configure its own list; hooks cannot import someone else's privacy clearance.

Hosted CI deliberately has a comment-only list and prints **not owner privacy clearance**; private terms are never sent to hosted runners or stored as CI secrets. The owner's full local list/history rescan is a separate mandatory publication gate.

### No lifecycle execution

All dependency installations use `--frozen-lockfile --ignore-scripts`; `trustedDependencies: []` prevents Bun's default trusted-package behavior. Root install hooks are forbidden. Runtime `preinstall`, `install`, and `postinstall` declarations fail the gate. Published registry packages' source-build `prepare` declarations are not registry install hooks; no lifecycle execution is allowed in any event. Git/file/ranged direct dependencies are forbidden by exact-pin validation.

Four exact dev-toolchain packages currently contain inert install declarations, accepted only while **not executed**:

- `esbuild@0.28.2`: platform binary obtained through its optional dependency, not its installer.
- `geckodriver@6.1.1` and `edgedriver@6.3.1`: unused Firefox/Edge installers; native tests run Obsidian/Chromium.
- `classic-level@3.0.0`: native tooling dependency; packaged prebuilds, never a node-gyp install.

`scripts/inert-dev-hooks.json` records versions, hook-command hashes and reasons. New/changed declarations fail until explicitly reviewed; never regenerate an allowlist blindly. A clean `node_modules` install with scripts disabled, build, and native smoke must prove the toolchain still works. Do not re-enable scripts if it fails.

**Separate legal exception:** `wdio-obsidian-service`'s `7z-wasm` is an e2e extraction tool under LGPL with the unRAR restriction. It is neither imported nor shipped in the plugin. The runtime permissive-license gate remains unchanged. Obsidian itself is downloaded into ignored storage only.

## Knowledge and artifact lifecycle

Update the owning format doc/ADR when behavior changes, retain truthful gaps in the README, add a changelog entry, and record exact test commands/subsets. Receipts belong to a commit and hardware class, never a hostname/username. Keep release assets and checksums per version; local reproducibility receipts are retained until accepted. Test app caches and synthetic artifacts are ignored; prune only owned, reproducible outputs after review, never personal vaults or unbacked evidence. See [releasing](docs/releasing.md) for the local-only flow and the owner decisions that still gate publication.

Expression callable metadata lives in `src/core/expr/syntax.ts`; regenerate its reference with `./scripts/run.sh docs:expressions`. `esbuild.config.mjs` performs used-export discovery before the final shared-core/worker/main build and records nested metafiles. UI autocomplete must remain outside the worker/core inputs. Run build before expression tests/benchmarks: packaged-worker tests use the built main bundle to reproduce the production export inventory.

For the expression-native lane generate its neutral synthetic fixture first: `./scripts/run.sh fixture --small --expressions`, then `GRAPH_EXPRESSIONS=1 ./scripts/run.sh e2e`. Historical fixture modes are unchanged. Preview counts and member reads must never cancel an applied explore view; supersession is scoped to request kind. Scanner checks cover expression/view payload string values, not schema keys or legacy declaration fields. Preserve legacy operation-output string-label collisions while raw groups retain typed keys.
