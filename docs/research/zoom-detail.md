---
description: Viewport sampling, level-of-detail stability and why zoom must not change graph identity or the layout solve.
---

# Zoom should reveal, not rearrange

When a person zooms into a sparse corner, the drawing budget should buy detail *there*, not spend itself on lines elsewhere. When they move a little, the dots that remain in view should still be useful landmarks.

**Finding.** Spending a fixed line budget across the whole graph can leave a close-up nearly empty. A viewport-first edge lookup improved sparse close-ups in paired synthetic browser runs. When many lines cross the view, walking the index can be more expensive than the bounded ordinary path. The index is not a universal win.

**Evidence.** The [viewport-first trial](../benchmarks.md#viewport-first-software-edge-trial-2026-11-20) compared the same camera poses, settled coordinates and draw budgets on both builds, including a dense fallback case. Camera-request-to-draw latency and time inside the draw function were measured separately. Neither measures user-perceived smoothness across all devices.

**Decision.** In the software renderer, build the optional close-up edge index after the first pickable paint and fall back when its work budget is exhausted. Keep identities and layout coordinates independent of camera position. Changing *which dots* get priority is a [separate unresolved choice](first-pickable-dots.md), not a consequence of adopting the edge index.
