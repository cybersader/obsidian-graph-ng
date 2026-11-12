# Pre-publish checklist

**Nothing is published by these scripts.** The owner must explicitly decide whether this local alpha is ready to become public. A public history cannot be made private again by deleting a later line. Green tooling is necessary, not sufficient.

## Owner decisions — still pending

- [ ] **History:** recommended fresh, scrubbed public repository assembled from the reviewed tree, retaining original slice-1 history privately/local. Alternative: publish the existing history only after a complete history audit. Do not create a remote or rewrite/delete private history without authority.
- [ ] **Distribution:** recommended BRAT-compatible releases first; community submission is a separate later decision after real-use evidence and planned renderer/runtime-dependency work.
- [ ] **CI residency/budget:** proposed hosted deterministic lanes only; GPU e2e on an explicitly approved isolated homelab runner. Alternatives are everything local or another reviewed allocation. Set spending limits; the present files have not run hosted CI. Manual GPU workflow defaults disabled and never runs unreviewed fork code on persistent hardware.
- [ ] **Public identity:** confirm repository/plugin name, maintainer identity/contact, whether any sibling project is named, and whether examples are generic only. Recommendation: generic examples and unnamed server seam. Existing human copyright attribution remains legitimate; do not infer a broader identity disclosure grant.
- [ ] **Support:** current stable Obsidian minor series plus two back; latest plugin release receives fixes. Execute those lanes, resolve mobile status and align `minAppVersion` with the actual supported minimum. Current 1.8.0 declaration is not proof.
- [ ] **Reporting:** enable/test private GitHub vulnerability reporting and confirm the owner-controlled contact before publication.

## Deterministic and independent acceptance

- [ ] Clean source/index, independently reviewed changes, plain human authorship, no AI co-authors/contributors. Preserve hooks; never bypass verification.
- [ ] Fresh dependency installation with `--frozen-lockfile --ignore-scripts`, empty trust list, no runtime install hooks, and only reviewed exact inert development declarations. Build and native smoke must still pass without installers.
- [ ] Run `./scripts/run.sh build`, `./scripts/run.sh test`, and `./scripts/run.sh gates`; record exact commands/subsets, source commit and uncovered lanes. Repeat gates immediately before a tag.
- [ ] Existing runtime permissive-license gate passes; actual license text/legal comments and notices included. Development/test-toolchain `7z-wasm` exception stays separate. No proprietary downloaded application bytes tracked.
- [ ] Review bundle raw/gzip/Brotli report and enforce the existing ceilings of 205,000 minified bytes and 66,000 gzip bytes. Brotli is reporting only; passing the size gate does not establish runtime acceptance.
- [ ] Run applicable synthetic native hardware/software lanes and current-plus-two-back matrix. Read captured screenshots; record real-use/mobile/integrated-GPU/literal-native gaps instead of inflating unit-green to release acceptance.
- [ ] Independent boundary review covers untrusted projection/labels and any changed runtime behavior. No remote grant/transport acceptance implied by local-file testing.
- [ ] `./scripts/verify-release.sh` passes on the clean source. Check candidate SHA256SUMS; version files match. Preserve legal files and deterministic asset names.

## Full privacy/history audit — local, immediately before publishing

- [ ] Populate the **full** local fixed-string private-terms list: private domains, personal names/paths, production details and private projection IDs/hashes. The initial local list is only a starting point; public CI's empty list is not clearance.
- [ ] Run `./scripts/run.sh gates` and `./scripts/run.sh audit:history` locally under the same lock/containment boundary. The history entry point runs the secrets, attribution and privacy scanners with `--history`: all reachable commits' metadata, filenames and blob contents, not just HEAD.
- [ ] Audit branch/tag/ref names, Git configuration/remotes, unreachable objects, stashes, LFS/external assets and backups separately. The script does not claim to erase or exhaustively scan those surfaces. A fresh scrubbed public repository is still recommended.
- [ ] Re-scan the **actual new public repository's complete history**, if the owner chooses a fresh repo; do not assume an export is clean because its source tree passed.
- [ ] README, all format examples and benchmark summaries use generic/synthetic data only, no expanded personal paths/hostnames, no unapproved sibling-project identity.
- [ ] Screenshots are synthetic only and visually inspected; inspect rendered labels, tabs, window chrome and image metadata. Filenames and bytes are scanned even in ignored `test-screenshots/`, but text inside pixels may evade byte scans. Do not publish raw screenshot/JSON bundles by default.
- [ ] Raw receipts/caches/worklogs/private-terms files remain ignored and local. Share only explicitly scrubbed per-commit summaries. No production endpoints, secrets or private sample data included.

## Actual publish — separate authority

- [ ] Owner approves the chosen history/distribution/identity/CI terms and the remaining acceptance gaps.
- [ ] Only then create the approved remote/tag/release with backups of retained private history. No current script performs these actions.
- [ ] Verify the real BRAT install/upgrade path with synthetic data, correct tag/version matching and legal/checksum assets. A local directory is not public-route or end-user acceptance.
