---
description: Unresolved first-frame sampling choice, hosted property loads, gzip headroom, physical touch and signed-in verification gaps.
---

# Open decisions and known limits

## Which notes should appear first?

**Awaiting the project owner's choice.** When the Canvas overview cannot draw every note, should a sparse area get a representative before a crowded area gets another, or should dot density reflect how many notes are there? The current sampler favours density. Sparse-first would help discovery but could make crowded regions look less crowded. Neither prototype is enabled. If coverage is the priority, first test one fixed order against both sparse outliers and dense clusters; compare the first pickable picture, stationary redraw and a small pan. [Why the prototypes stopped](research/first-pickable-dots.md).

## Hosted properties can arrive late

The host owns the aggregate property load and its scheduling. A graph can have a usable outline before it has verified connection details. Graph NG shows incomplete or failed status and offers an explicit retry after failure; a replacement source can start a new load. Do not read an empty card as proof that no connections exist. Improving upstream load latency needs host-side evidence, not faster dot drawing. [What cached facts can and cannot prove](research/startup-cache.md).

## Bundle budget

At the `d6a220f` baseline, the plugin measured **171,987 gzip bytes** against **172,000**: just **13 bytes free**. This is a build artifact measurement, not a vault size. Plan an explicit owner-approved cap raise for the next feature unless a measured reduction makes room. Rebuild and check both caps before proposing the new number. [How to measure](testing.md#local-checks).

## Interaction and integration gaps

| Evidence we have | What still needs verification |
| --- | --- |
| Synthetic input exercises touch selection: tapping selects a note; opening it is explicit. | Check targeting, panning and pinch interaction on physical touch hardware. Do not claim mobile support from synthetic events. |
| Disposable local browser runs exercise plugin load and specific synthetic interactions. | Live signed-in verification is still pending for this baseline. Host authentication, sync, real load latency and membership changes need separate, explicitly authorized connected checks. Do not sign in or copy trust as part of a fixture. |

The [product limits](../README.md#not-implemented--not-proven) and [security policy](../SECURITY.md) cover the wider support boundary. A local pass does not grant publication or release acceptance.
