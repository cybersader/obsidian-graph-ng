# ADR-0001 — Ontology-neutral core

- Status: accepted for slice 1
- Date: 2026-11-10
- Baseline: `041e1382`

## Context

Notes can represent concepts, assets, ordinary links, or relationship records. Baking a particular framework's property names, ID syntax or hierarchy into the engine would make every new use case a core fork.

## Decision

Meaning is explicit data: identities, edge sources, selected producers, groups, columns, colors and carrier resolvers live in a validated declaration. The pure core consumes neutral fact rows and produces engine-neutral graph columns. No ontology, regex naming convention, specific framework vocabulary, or implicit parser is authoritative. Default identities are exact paths; default groups are folders; host links require a producer version pin.

## Consequences

Adapters can supply different domains without changing core semantics. Ambiguous identity ownership must be visible/quarantined, not resolved by arbitrary precedence. Examples remain generic synthetic concept/reference mappings, not privileged implementations. A future server adapter must use the same neutral seam and receive its own grant/boundary review.

## Evidence

`src/core/declaration.ts`, `src/core/projection.ts`, `tests/core.test.ts`; slice-1 28-test core/adapter subset and ambiguity regressions recorded in [benchmarks](../benchmarks.md). The current [declaration format](../declaration-format.md) is the lookup contract; [projection v0](../projection-format.md) is a separate aggregate draft. Acceptance is limited to the recorded invocations, not remote operation.
