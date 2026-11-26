---
description: Exact top-ranked overview labels, focus tiers, collision budgets and zoom stability in dense note views.
---

# Spend label space where it answers a question

At overview scale a few names orient the reader. After a selection, the useful names are usually the selected note and its connections. Labeling everything would obscure both the dots and the relationships.

**Finding.** Overview labels can retain exactly the same degree ranking and tie order without sorting every visible note when the label budget is small. Focused labels have a different priority: start with the selected note and its direct neighbours. Candidate ranking alone does not prevent overlap, flicker near a zoom threshold, or a label appearing over an unpainted sampled dot.

**Evidence.** The [exact top-K comparison](../benchmarks.md#live-tree-copies-and-exact-label-top-k-2026-11-18) checks preparation cost without changing the winning set. [Placement tests](../../tests/label-layout.test.ts) and [anchored-label observations](../benchmarks.md#anchored-canvas-names--2026-11-16) cover a separate question: where a name can actually fit. Inspect both themes and long names; passing a ranking test does not prove readability.

**Decision.** Bound candidate and placement work, break ties predictably and use collision-aware placement. Keep placement stable across small zoom changes and keep extra connections discoverable through the card. A missing label is not a missing note.
