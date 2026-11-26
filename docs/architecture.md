---
description: Graph NG source map for metadata ingestion, the typed-array projection, worker lifetime, graph renderers and view controls.
---

# From notes to dots

A dot is a view of one worker-owned projection. Groups, filters, search and connection cards ask different questions of that same graph. They must not build competing interpretations of the notes.

## Follow one note

1. **Read facts.** [`LocalAdapter`](../src/adapter/local.ts) observes public file and metadata events. [`IncrementalIndex`](../src/adapter/index.ts) tracks pending and acknowledged paths. The adapter reads the declared properties and selected link source, not a second parser over note bodies. [`columns.ts`](../src/core/columns.ts) packs batches for transfer.
2. **Resolve meaning.** [`layout-worker.ts`](../src/layout-worker.ts) unpacks rows and calls [`buildProjection`](../src/core/projection.ts) with the [validated declaration](declaration-format.md). The result includes dictionary-coded values, edge endpoints and an adjacency index stored as offsets into flat neighbour arrays. Duplicate identities are quarantined rather than silently merged. Relationship notes are resolved by declared rules, not by guessing from a title.
3. **Choose a view.** [`core/explore.ts`](../src/core/explore.ts) calculates which notes are visible. [`group-projection.ts`](../src/core/group-projection.ts) contracts the selected graph into groups and counted connections. [`pipeline.ts`](../src/pipeline.ts) ties requests and replies to revisions, handles deadlines and disposes workers. An old reply cannot supply the detail panel for a newer graph.
4. **Get coordinates when Notes needs them.** On a cold open, Groups need not wait for the Notes solver. The worker can reuse an exact saved layout, start from compatible old positions, or arrange notes using [`core/layout.ts`](../src/core/layout.ts) and [`layout-engine.ts`](../src/layout-engine.ts). A streamed picture is not necessarily pickable. [`main.ts`](../src/main.ts) coordinates preview, final renderer and cleanup.
5. **Paint and pick.** [`GroupRenderer`](../src/renderer.ts) draws the group overview on Canvas. The Notes [`DetailRenderer`](../src/webgl-renderer.ts) draws [packed render columns](../src/render-projection.ts) with WebGL2 or Canvas 2D. [`render-data.ts`](../src/render-data.ts) holds picking and spatial sampling; [`canvas-edge-index.ts`](../src/canvas-edge-index.ts) supports close-up line queries. On sampled Canvas, a dot must be painted to be picked. Drawing fewer dots does not remove notes from the projection.

## Where to make a change

| If the change concerns... | Start here |
| --- | --- |
| Filters, groups or Appearance controls | [`explore-panel.ts`](../src/explore-panel.ts) builds the panel; its host in `main.ts` applies actions. Change filter meaning in the core, not in the control. |
| Toolbar jump or find-a-note | [`search.ts`](../src/search.ts) handles the box, selection and jump. The worker ranks candidates with `searchSteps` in `core/explore.ts`. Applying a text filter is a separate action. |
| A selected note's neighbours or folded card | [`connection-card.ts`](../src/connection-card.ts) groups visible connections, navigates and places the card. [`interaction.ts`](../src/interaction.ts) handles graph input. |
| Names on the graph | [`render-labels.ts`](../src/render-labels.ts) chooses candidates; [`label-layout.ts`](../src/label-layout.ts) places or suppresses colliding labels. |
| Earlier startup | [`adapter/fact-cache.ts`](../src/adapter/fact-cache.ts) stores bounded, provisional facts; `adapter/local.ts` reconciles them. [`core/binary-layout.ts`](../src/core/binary-layout.ts) is the separate saved-layout format. |
| Saved settings or local performance choices | [`settings.ts`](../src/settings.ts) validates settings. The save path in `main.ts` strips device-only keys from shared data; [`device-performance.ts`](../src/device-performance.ts) handles local preferences and optional numeric observations. |

## Which decision record?

Use the [numbered decision index](decisions/README.md) to open the full record. Read later amendments before relying on an older interim choice.

| Record | Boundary it explains |
| --- | --- |
| 0001 | Meaning comes from declarations, not a built-in vocabulary. |
| 0002 | Typed arrays are the graph authority; the initial renderer was interim. |
| 0003 | Only public host and renderer APIs are supported. |
| 0004 | Worker generations, cancellation, cache eligibility and disposal. |
| 0005 | Direct rendering from typed arrays and generation-bound relationship panels. |
| 0006 | ForceAtlas2 works directly on compressed sparse row adjacency; the reference implementation is development-only. |
| 0007 | Profiled native startup and a packed render-only transfer format. |
| 0008 | Adaptive presentation and observations scoped to the device. |
| 0009 | Provisional saved facts, source verification and room partitions. |
| 0010 | Optional worker WebGPU layout, quality checks and Processor fallback. |
