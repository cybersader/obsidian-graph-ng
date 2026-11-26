---
description: Why sparse-first and first-painted landmark prototypes did not replace the current density-proportional Canvas sampler.
---

# Which dots should appear first?

A sparse corner can contain a real note and still look empty when the overview runs out of dots. Giving that corner a dot would help someone find it. Giving the same dot to a crowded region instead preserves a clue about how many notes are there.

**Finding.** A prototype that spread dots across occupied areas kept more landmarks through a pan and revealed sparse notes. But its new order arrived *after* the first pickable paint. Even if the person did nothing, the map visibly changed. A second prototype kept the original dots first. It stopped the idle swap, but also kept the original blind spots. Neither trial fit its build budget.

**Evidence.** Paired, deterministic Canvas command-sink runs exercised the compiled renderer on synthetic hub, sparse and force-laid-out shapes. They compared painted note identities at rest, after small pans and through zoom. Occupied screen regions and retained identities are useful measures; they do not tell us whether a person reads density correctly. The proposal for a single fixed order is a design review, not a measured third implementation.

**Decision.** Keep the shipped density-proportional sampler. If sparse discovery matters more, test one order available *before* the first pickable paint, not a late handoff between two orders. Include a crowded region and an isolated outlier; check what the first frame misses and what disappears without movement. The [product choice](../open-decisions.md#which-notes-should-appear-first) is still open. See the shipped [Canvas sampler](../../src/render-data.ts) and [renderer tests](../../tests/renderer.test.ts).
