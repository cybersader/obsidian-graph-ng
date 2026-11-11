# Changelog

All notable changes are recorded here. The format follows Keep a Changelog; versions follow Semantic Versioning. Entries describe accepted behavior and evidence, not an automatic summary of commits.

## [Unreleased]

## [0.3.0] - 2026-11-11

### Added

- In-view **Explore** panel styled only with host CSS variables: note search, declared-property filters (`is`, `is any of`, `exists`) with live visible/total counts and removable chips, and live visible node/edge counts.
- Runtime group-by switching across declared sources, declared properties, folder depth 1–4 and **derived** sources: bounded segment / prefix / restricted-pattern transforms of an existing property, identity or path, computed once per distinct value in the worker. No note needs a new property.
- Editable color legend (color, order, add, delete, hide) re-evaluated in the worker on existing columns, per-group visibility, frame-group, and collapse/expand of groups into hubs in the detail graph.
- Relation-type toggles with counts and an optional direction fade; display controls for degree sizing, node size, label density, edge opacity and color blend, glow, curvature, mid-zoom group tint, hover highlight and zoom-faded labels.
- Saved views (filters, query, group source, hidden/collapsed state, normalized camera) in settings; `data.json` stays settings-only and settings-sharing safe.
- Predicate grammar gains `in` and `exists`, shared by color rules, filters and saved views.
- Visual effects: additive density-scaled edges on dark themes with a 0.5 per-edge ceiling, soft node glow, hover one-hop highlight, eased camera, categorical group palette with contrast adjustment, group tint at mid zoom and zoom-faded labels. Configurable cost guards (`glowMaxNodes`, `curvesMaxEdges`, `halosMaxGroups`, `hubsMaxGroups`) and a software-renderer rule disable expensive effects.

### Changed

- Color rules are excluded from layout/cache identity: a legend edit never relayouts or reseeds.
- Fit-all frames the 1st–99th percentile of visible nodes; edge intensity scales relative to that home framing. Node discs shrink with on-screen density and regrow as the camera zooms in. The placeholder groups `(missing)`, `(no match)` and `(outside prefix)` take the neutral node color.
- Long whitespace-free text in persisted view state is written as short chunks, `{"$text": [...]}`, and joined again on load. This keeps `data.json` settings-sharing safe.

### Fixed

- External aggregate projections (`projectionFile`) no longer fail with an invalid group color.

### Measured

- Native lanes: small graph 11/11 and explore 6/6 on hardware and software; large literal graph 7/7 and explore 6/6 on hardware; large literal graph 7/7 on the software rerun. Large first groups take 307.9/354.2 ms. The browser main heap is 11.05/11.02 MiB. There are 119 unit tests.
- Bundle: 170,539 minified / 52,954 gzip bytes, over the enforced 150,000 / 45,000 ceilings, so the full-gates bundle lane fails. The other five gate lanes pass.
- Known misses: the browser benchmark's second headless launch blocks natively (unattributed regression; slice 5 passes the same command). One intermittent large-software contribution timeout and intermittent 59–76 ms small-software explore tasks are also unattributed.

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
