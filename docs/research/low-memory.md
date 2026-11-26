---
description: How to distinguish a smaller paint budget from a smaller retained graph or lower peak memory during refresh.
---

# A drawing cap is not a memory cap

Canvas can draw fewer dots and lines while the worker still holds every fact and connection. If a refresh runs out of memory, changing a slider that limits marks per frame may leave the cause untouched.

**Finding.** A relationship filter once kept the old projection reachable after it was cleared and a new graph was built. Dropping that reference at replacement fixed the lifetime problem without compressing adjacency or changing which notes exist. Separately, sampling visible candidates bounds work in a warm repaint; constructing the spatial index still costs time and memory.

**Evidence.** Source inspection identified the stale reference. A [synthetic refresh comparison](../benchmarks.md#filter-cache-lifetime-on-a-49k-note-refresh) exercised filter, clear, rebuild and reapply. [Canvas command counts](../benchmarks.md#canvas-sampler-repair-warm-work-versus-paint-output) measured drawing work, not system memory. A main-thread heap sample, a typed-array byte count and graphics allocations are different observations. Do not add them and call the sum peak process memory.

**Decision.** Keep the complete graph in the worker, retire generation-specific caches at replacement and send only the columns the renderer needs. When investigating a new peak, measure ingestion, replacement and disposal separately. Do not infer a minimum supported RAM size from a synthetic run.
