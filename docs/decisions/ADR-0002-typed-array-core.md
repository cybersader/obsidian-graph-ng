# ADR-0002 — Typed-array core; interim renderer adapter

- Status: accepted core; Sigma temporary, replacement planned
- Date: 2026-11-10
- Baseline: `041e1382`

## Context

Object-heavy render-engine graphs should not become the application's document/projection authority. Large fixtures require predictable column storage and the ability to replace a renderer without rewriting meaning, adjacency or filters.

## Decision

Use dense interned IDs, u32 source/target/type/carrier columns, bidirectional CSR adjacency, dictionary-coded property/group columns and typed coordinate arrays as the engine-neutral core. Preserve direction/multiedges in edge columns even though adjacency supports traversal in both directions.

The present detail-renderer adapter uses **Sigma 3.0.2** and **Graphology 0.26.0**, with ForceAtlas2 in a worker. These are interim dependencies, not core contracts. The approved direction is renderer replacement and eventual elimination of shipped third-party runtime dependencies; those later slices are **not implemented** here. Group-first paged Canvas remains the readable overview and software fallback. No future renderer, picking engine, WebGPU support or zero-dependency claim is smuggled into this slice.

## Consequences

Serialization/layout/filter semantics can outlive a renderer. Engine-specific Graphology objects stay in adapters/worker code, not `src/core/`'s stored projection authority. Typed columns are only part of memory cost: dictionaries, fact rows, contribution lists, hashing, JSON and GPU buffers still allocate. CSR/group projections currently rebuild per batch; typed arrays alone do not imply incremental mutation or nonblocking startup.

## Evidence

`src/core/projection.ts`, `src/core/grid.ts`, `src/renderer.ts`, `src/layout-worker.ts`; [benchmarks](../benchmarks.md) records column sizes and actual-renderer measurements, including failed load-long-task targets. Runtime dependencies remain subject to the existing permissive-license gate until their removal is actually built and reviewed.
