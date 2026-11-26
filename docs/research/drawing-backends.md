---
description: WebGL2 versus Canvas 2D drawing, independent of WebGPU layout, and limits of fallback performance evidence.
---

# Drawing and arranging are separate jobs

“Graphics” in layout settings tells the worker how to compute positions. It does not select the API that draws Notes. A fast solve does not guarantee that a folded card, dot or label can be drawn and picked promptly.

**Finding.** A browser that exposes a graphics API can still be backed by a software driver. Large software draws need a budget. An early fallback refused detail past its limits; newer Canvas draws sample the view instead. Sampling introduces a correctness question as well as a speed question: if a relationship is represented by a dot and two legs, drawing disconnected halves or allowing a tap on an invisible dot is misleading.

**Evidence.** Compiled-renderer command-sink tests count drawing calls and exercise picking and admission under pressure. [Software Notes regressions](../benchmarks.md#software-notes-default-settings-regression-2026-11-20) distinguish these checks from native synthetic browser measurements. A headless software rendering result is not a hardware GPU frame-rate benchmark.

**Decision.** Both drawing paths consume the same projection. Keep Canvas usable with bounded detail, protect selected relationships and pick the marks actually drawn. Report the draw backend separately from the layout engine. Use [the direct renderer decision](../decisions/ADR-0005-direct-renderer.md) for the drawing contract and [the engine decision](../decisions/ADR-0010-layout-engine.md) for computation.
