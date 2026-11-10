# ADR-0003 — Public APIs only

- Status: accepted for slice 1
- Date: 2026-11-10
- Baseline: `041e1382`

## Context

Depending on incidental private host/renderer internals creates version traps and prevents equivalent adapters. The project favors stable structural seams over clever shortcuts into unrelated components.

## Decision

The Obsidian adapter reads files/frontmatter and resolved links using public `vault` and `metadataCache` APIs, reacts to public events, and pins the host link producer. It does not parse note bodies or patch private metadata-index fields. Renderer integration uses public APIs behind `src/renderer.ts`; tests may inspect their own plugin state to assert behavior, not create production authority over private host state.

No plugin-ID-specific compatibility shim or undocumented access path is an acceptable replacement. If a public capability is absent, report the feature as blocked or define a generic public interface; do not silently reach through internals. A future API expansion is a separate decision.

## Consequences

One startup reconciliation waits for metadata completeness, followed by coalesced event-driven reads. Exact host behavior still needs real Obsidian and version-matrix testing. Public APIs do not guarantee responsiveness: main-thread work and renderer allocation remain measured limitations. Preserve the current-plus-two-minor-series target and distinguish it from completed evidence.

## Evidence

`src/adapter/local.ts`, `tests/adapter.test.ts`, `src/renderer.ts`; measured rename/resolve bursts read affected descendants once and perform no whole-vault listing after startup. Native tests exercise real note/member/carrier navigation and persisted restarts. See [benchmarks](../benchmarks.md) and [SECURITY.md](../../SECURITY.md) for version/testing gaps.
