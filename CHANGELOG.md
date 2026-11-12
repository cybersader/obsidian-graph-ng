# Changelog

All notable changes are recorded here. The format follows Keep a Changelog; versions follow Semantic Versioning. Entries describe accepted behavior and evidence, not an automatic summary of commits.

## [Unreleased]

## [0.5.0] - Unreleased

### Added

- Optional public property-facts input for provisional first groups, preserving the existing engine, declarations, native producer edges and separate Graph NG entrypoints. Missing capability retains standalone native input; this does not force whole-vault body hydration.
- Explicit provisional properties and pending native links; verified completeness and exact-cache eligibility remain separate from transport completeness.

### Fixed

- Matching property verification uses a bounded, non-destructive coverage audit instead of repeatedly canceling ingestion and clearing an interactive view.
- Layout persistence rechecks source/view ownership after asynchronous encoding and when a queued write actually executes.

### Compatibility and verification status

- Host-first rollout is required: install the aggregate load/change-notification seam before this plugin. The older host's partial property API is not a supported lifecycle pairing; capability absence is the supported native fallback.
- Local deterministic evidence and independent R1/R2 reliability review cover the behavior changes. Version metadata and documentation still require staged cross-document review; no native/browser/mobile, connected-workspace, packaging or deployment acceptance is claimed.
- Existing ceilings remain 205,000 minified / 66,000 gzip bytes; Brotli is reported, not separately capped.

## [0.4.0] - Unreleased

### Added

- Bounded Bases-aligned node expressions: handwritten lexer/parser, positioned checker, canonical printer, pure whitelist, typed distinct-value kernels, expression filters/color predicates/group sources, and read-only worker counts.
- Explore expression inputs, property/method completion, debounced counts, positional errors, explicit cap-checked conversion, and retained structured builders. Folder-depth grouping stays built in.
- Additive expression storage with scanner-safe declaration text chunks, historical plan/cache identity, exact null/missing migration, and direct lowering of oversized legacy values without text parsing.
- Cooperative expression-count/applied-filter cancellation, configurable evaluation budgets, transactional worker view preparation, and a shared pure factory that avoids shipping duplicate core source.
- Deterministic expression acceptance tests, a synthetic real-Obsidian editor lane, and bounded production-worker/adversarial benchmarks. Generic examples use category terminology.

### Fixed

- Mixed file/property folder predicates evaluate each child once per row, avoiding exponential nested work.
- Preview/member reads no longer supersede applied views; pipeline and raw-worker cancellation are scoped by request kind.
- Expression/view persistence chunks by JSON-escaped length and checks serialized payload strings, while retaining legacy declaration storage and its pre-existing scanner limitation.
- Identifier tokens are capped at 128 units; expression fixtures use neutral category names. Operation-produced numeric/string label collisions are documented as legacy behavior; raw groups remain typed.

### Verification status

- Bundle ceilings raised to 205,000 minified / 66,000 gzip bytes by owner decision (2026-11-11); 0.4.0 is 202,475 / 64,312 and passes. Independent review returned SHIP-WITH-FIXES; its blockers now have regression fixes (no second independent review claimed). Exact scoped results and unverified lanes are in `docs/benchmarks.md`.

## [0.3.1] - 2026-11-11

### Changed

- Literal display (`reifiedAsNodes`): edge notes (relationship notes drawn as nodes) take their color from the displayed colors of their endpoints instead of the neutral `(missing)` group, draw small in their own pass beneath the other notes without glow, and fade with edge-note density. Bridges between different colors blend both endpoints or keep the source color, with a configurable accent. At mid and far zoom they fold into their edges and cannot be picked. New `visuals` keys: `carrierTint`, `carrierBridge`, `carrierBridgeAccent`, `carrierOpacity`, `carrierSize`, `carrierDensityReference`, `carrierLod`, `carrierLodNear`, `carrierLodFar`; missing keys migrate to defaults. The legend explains the treatment; Display adds edge-note opacity, size, tint and fold controls. The projection gains a per-node `carrierNodes` column (1 + the note's own carrier row; all zero outside literal display), and the render projection now carries the per-edge `carrier` column, so an edge note's colour comes only from its own relationship's endpoints, never from inline or link edges that touch the note. A highlighted (hovered or selected) edge note folds with the level of detail.

### Fixed

- A density reference of 0 (`edgeDensityReference`, `carrierDensityReference`) now disables density thinning, as the settings error text states; previously it pinned alpha to its floor.
- Re-rendering the group screen keeps the Relationships and duplicate-ID sections open if the user opened them, instead of collapsing them.
- The native graph lane waits for a verified, idle view before opening relationships, fixing a flake where a queued cached refresh repainted the panel under the click.

## [0.3.0] - 2026-11-11

### Added

- In-view **Explore** panel styled only with host CSS variables: note search, declared-property filters (`is`, `is any of`, `exists`) with live visible/total counts and removable chips, and live visible node/edge counts.
- Runtime group-by switching across declared sources, declared properties, folder depth 1–4 and **derived** sources: bounded, linear-time segment / prefix transforms of an existing property, identity or path, computed once per distinct value in the worker. No note needs a new property.
- Editable color legend (color, order, add, delete, hide) re-evaluated in the worker on existing columns, per-group visibility, frame-group, and collapse/expand of groups into hubs in the detail graph.
- Relation-type toggles with counts and an optional direction fade; display controls for degree sizing, node size, label density, edge opacity and color blend, glow, curvature, mid-zoom group tint, hover highlight and zoom-faded labels.
- Saved views (filters, query, group source, hidden/collapsed state, normalized camera) in settings; `data.json` stays settings-only and settings-sharing safe.
- Predicate grammar gains `in` and `exists`, shared by color rules, filters and saved views.
- Visual effects: additive density-scaled edges on dark themes with a 0.5 per-edge ceiling, soft node glow, hover one-hop highlight, eased camera, categorical group palette with contrast adjustment, group tint at mid zoom and zoom-faded labels. Configurable cost guards (`glowMaxNodes`, `curvesMaxEdges`, `halosMaxGroups`, `hubsMaxGroups`) and a software-renderer rule disable expensive effects.

### Changed

- Color rules are excluded from layout/cache identity: a legend edit never relayouts or reseeds. Because the layout identity hash changed, a cached 0.2.x layout is not reused: the first open after upgrading performs **one full relayout**, which is then cached.
- Fit-all frames the 1st–99th percentile of visible nodes; edge intensity scales relative to that home framing. Node discs shrink with on-screen density and regrow as the camera zooms in. The placeholder groups `(missing)`, `(no match)` and `(outside prefix)` take the neutral node color.
- Long whitespace-free text in persisted view state is written as short chunks, `{"$text": [...]}`, and joined again on load. This keeps `data.json` settings-sharing safe.

### Fixed

- External aggregate projections (`projectionFile`) no longer fail with an invalid group color.
- The Explore panel keeps keyboard focus on the same control across re-renders.
- The browser benchmark no longer hangs. Bun's Playwright pipe transport broke on a second browser launch when a reply was several MB, so each mode now runs in its own process and the run fails fast on a disconnect. A second-view regression covers hover, select and context loss. The label-glyph receipt now divides by the current 10-float stride.

### Security

- Removed the regex (`pattern`) derived transform after review showed the restricted-regex validator could be bypassed to admit catastrophic backtracking: a short pattern's matching time grew exponentially with input length. Only linear split transforms remain. A stored pattern group is migrated to `explore.disabledDerived` and shown in the panel and in a load notice until dismissed; it is never silently dropped.
- Settings are validated inside every write (`save()`, coalesced saves, unload, cache migration). An invalid in-memory state is refused with a notice, and the last valid `data.json` stays on disk instead of being quarantined and reset on the next load. The panel caps view names (120), saved views (200), collapse-all (20,000 groups) and stored group keys (4,096), and refuses any view change that would fail validation.
- Each applied view (projection, regroup, filter, derived source) has its own worker generation. Member and contribution reads must name it, and the worker refuses a read from another generation. A selected relationship is cleared with a message when the grouping changes, and re-resolved by raw keys when only filters change. The carrier panel can no longer show a relationship from a different grouping.

### Added (development)

- `clusteredFixture` / `--clustered` / `GRAPH_FIXTURE=clustered`: a seeded synthetic corpus with community structure for visual judgement, written to its own synthetic vault.

### Measured

- Native lanes: small graph 11/11 and explore 6/6 on hardware and software; large literal graph 7/7 and explore 6/6 on hardware; large literal graph 7/7 on the software rerun. Large first groups take 307.9/354.2 ms. The browser bench completes 3/3 sequential runs in both modes: 60.0 fps, main heap 11.06/11.03 MiB, no ≥50 ms tasks. There are 125 unit tests.
- Bundle: 169,376 minified / 53,368 gzip bytes after private-name mangling, UTF-8 output and the review fixes (first build: 170,539 / 52,954). This is still over the enforced 150,000 / 45,000 ceilings, so the full-gates bundle lane fails. The other five gate lanes pass.
- Known misses: one intermittent large-software contribution timeout (not seen in the final matrix) and intermittent 59–76 ms small-software explore tasks are unattributed. Literal display of a clustered corpus is dominated by neutral mapping notes.

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
