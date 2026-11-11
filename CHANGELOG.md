# Changelog

All notable changes are recorded here. The format follows Keep a Changelog; versions follow Semantic Versioning. Entries describe accepted behavior and evidence, not an automatic summary of commits.

## [Unreleased]

## [0.2.1] - 2026-11-10

### Changed

- Profiled real native startup; accelerated ASCII column encoding/decoding while preserving Unicode cell boundaries and skipping undeclared producer-link extraction.
- Moved deferred GPU capability probing to a public worker OffscreenCanvas where supported, with revision-checked interaction and visible failure fallback.
- Kept palette `getImageData` on a one-pixel CPU-backed conversion surface instead of synchronizing GPU readback; external carrier indexing yields under existing ingestion budgets and cancels superseded panels.
- Deferred GPU drawing-buffer resizing until parallel shader completion and reconciled it again before readiness/restoration; avoided resetting unchanged axes. Added nonblocking public WebGL2 completion fences before resizing to remove a measured 230 ms driver wait, using existing poll/deadline budgets and guaranteed fence cleanup. Invalidated sliced carrier lookups as soon as refresh begins.
- Transferred render-only numeric columns and packed UTF-8 paths; full identities, property/carrier dictionaries and membership codes remain worker-owned.
- Distinguished the first actual live group paint from subsequent metadata-refresh paints; added native phase/CPU profile mode and explicit browser backing-storage measurement.
- Added regression coverage and updated native warm/incremental tests to use packed paths and existing paged contribution APIs rather than retained worker-only data.


### Measured

- Native large first groups: 320.0/350.1 ms hardware/software (same-profile baseline 535.3/589.5 ms); browser main JS heap 10.97/10.94 MiB with separate backing-storage accounting.
- Recorded 62–70 ms native detail tasks and UNATTRIBUTED 51–63 ms software-open tasks remain limitations; this is not all-interaction acceptance. Build, 103 unit tests, four native lanes, browser and six gates pass.

## [0.2.0] - 2026-11-10

### Added

- Deterministic CSR-native ForceAtlas2 with flat typed-array Barnes–Hut, persistent integration across streamed snapshots, configurable iteration budgets/convergence/depth and exact fixed-node warm starts.
- Development-only Graphology/FA2 differential oracle, equation/tree/determinism regressions and fixed-seed speed/edge-distribution benchmarks; no oracle implementation enters either bundle.

- Direct typed-array WebGL2 detail renderer: instanced nodes/edges, position/palette textures, packed grid picking, incident-edge hover, bounded glyph atlas with precomputed label LODs, pan/zoom/touch and context restoration.
- Host CSS-variable theming refreshes only the palette, without worker calls or graph-buffer reconstruction; bounded Canvas detail supports small software-only views.
- Generation-bound contribution panels retain stable raw group selection across refresh, show loading/refreshing/failed reads and provide explicit Retry instead of silently disappearing.
- Renderer and contribution-race regressions, hardware/software native theme/context screenshots and hard bundle-size gates.
- Slice 2 worker-owned projection/CSR/contraction/digests, revision-tagged columnar transfer, progressive group paint and position streaming, cooperative ingestion/detail construction and paged contribution reads.
- Separate checksummed binary layout generations with at-most-1-MiB files, resumable matching chunks, scoped source/producer/format labels, bounded retention, corruption quarantine and v1 position-hint migration.
- Cached provisional group paint followed by public-metadata verification; no persisted property/fact store. Settings JSON now contains settings only.
- Declaration v2 property field names and folder-path segments, with v1 input migration and independent tests for reported settings-sharing false positives. Finite default aggregate envelopes and pre-parse byte budgets.

- Local deterministic secrets, attribution, privacy, supply-chain and frozen-lock gates, bundle-size reporting, and opt-in pre-commit hooks.
- Local reproducible release packaging and checksum comparison, pinned deterministic CI definitions, and a disabled-by-default manual homelab GPU lane. No remote/publication or hosted CI execution.
- Contribution/security policies, declaration/projection references, benchmark methodology, architecture decisions and publication checklist.

### Changed

- Removed Sigma and main-thread Graphology construction; minified both worker and main bundle. The worker now uses the original CSR-native solver; the complete plugin has zero runtime dependencies, empty third-party runtime notices and enforced 150,000 minified / 45,000 gzip bundle ceilings.
- Cache format 3 rebuilds slice-2 keyless summaries. Cached paints have a separate generation identity; clicked relationship keys/legacy labels are captured before any fresh dictionary can reuse IDs.
- Renderer timing, camera and label-candidate knobs are configurable. Canvas detail refuses both node/edge excess, and permanent context loss falls back visibly; disposal explicitly releases its WebGL context.
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
