# Changelog

All notable changes are recorded here. The format follows Keep a Changelog; versions follow Semantic Versioning. Entries describe accepted behavior and evidence, not an automatic summary of commits.

## [Unreleased]

### Added

- Slice 2 worker-owned projection/CSR/contraction/digests, revision-tagged columnar transfer, progressive group paint and position streaming, cooperative ingestion/detail construction and paged contribution reads.
- Separate checksummed binary layout generations with at-most-1-MiB files, resumable matching chunks, scoped source/producer/format labels, bounded retention, corruption quarantine and v1 position-hint migration.
- Cached provisional group paint followed by public-metadata verification; no persisted property/fact store. Settings JSON now contains settings only.
- Declaration v2 property field names and folder-path segments, with v1 input migration and independent tests for reported settings-sharing false positives. Finite default aggregate envelopes and pre-parse byte budgets.

- Local deterministic secrets, attribution, privacy, supply-chain and frozen-lock gates, bundle-size reporting, and opt-in pre-commit hooks.
- Local reproducible release packaging and checksum comparison, pinned deterministic CI definitions, and a disabled-by-default manual homelab GPU lane. No remote/publication or hosted CI execution.
- Contribution/security policies, declaration/projection references, benchmark methodology, architecture decisions and publication checklist.

### Changed

- Dependency installation explicitly disables lifecycle execution. Four exact development-only install declarations are inert reviewed exceptions; runtime install hooks are rejected.

## [0.1.0] - 2026-11-10

### Added

- Slice 1: standalone ontology-neutral graph core with dense IDs, typed columns, bidirectional CSR, exact filters and declared identity/edge/group/color/carrier rules.
- Public-API Obsidian adapter, coalesced event-driven updates, duplicate-identity quarantine, group-first paged Canvas overview and optional Sigma detail renderer.
- Worker ForceAtlas2, deterministic generation keys, persisted exact-cache restore and topology-aware warm starts.
- Aggregate-only `graph-projection` v0 draft file input and independent headless local projection builder.
- Synthetic unit/native/browser evidence, runtime permissive-license audit and bundled notices. See [benchmarks](docs/benchmarks.md) for exact commands and limits.

### Fixed

- Stable cache keys across irrelevant metadata/link enumeration changes; startup metadata races cannot replace complete generations.
- Bounded group/list rendering, ambiguous ID/path-alias exclusion, own-key relationship counts and literal quoted folder names.

### Known limitations

- Test-backed alpha, not a public release or production acceptance. No remote adapter or authorization layer.
- Main-thread load long tasks miss the responsiveness target. Native FPS unavailable; literal native large-vault, mobile and integrated-GPU lanes remain unproven.
- Sigma is an interim renderer slated for replacement; no bundled-runtime-dependency elimination claim yet.
