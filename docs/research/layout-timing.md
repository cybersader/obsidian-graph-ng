---
description: Time to a pickable Notes canvas versus first paint, visual completion and physical settlement on Processor or Graphics.
---

# Time the first useful click

Seeing the first layout preview is not the same as selecting a note. Conversely, a person who can already inspect connections may not need to wait for the last force iteration.

**Finding.** Groups can be useful before Notes has coordinates. On cold synthetic runs, a bounded Quick start draft let a person select a note while a full pass would still have been arranging it. The best engine was not determined by graph size alone: the shape, setup cost and the quality of the result mattered. A layout that rotates as a whole can look stable internally; another can still distort locally. One motion score is not a guarantee of neighbourhood quality.

**Evidence.** Worker benchmarks isolate solve time. Synthetic browser tests of the whole path used a successful pick, not a visible loading canvas, as the interaction milestone. See [visual completion](../benchmarks.md#visual-layout-completion) and the [worker engine decision](../decisions/ADR-0010-layout-engine.md).

**Decision.** Defer a cold Notes solve on a Groups-only visit. Distinguish **Explore now** or a Quick start draft from **Layout ready**, physical settlement and **Finish fully**. Refinement is a separate action. Automatic layout currently chooses Processor because no size range qualified for Graphics across the tested shapes; manual Graphics remains a device preference with Processor fallback. State engine, graph shape, cache state and milestone when comparing runs.
