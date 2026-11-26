---
description: Find Graph NG contributor guides, product rules, code ownership, test commands, research and open decisions.
---

# Graph NG knowledge base

Graph NG turns declared facts about notes into a local, explorable graph. Start with the question you brought. You do not need to read the project history to make your first change.

| I want to... | Start here |
| --- | --- |
| Try the plugin | [Install and use Graph NG](../README.md#install-locally). Open Groups, then jump to a note and follow a connection. |
| Change a control or its wording | [Design principles](design-principles.md). Find the rule and the problem it prevents. |
| Find the code behind a dot, a card or a setting | [Architecture map](architecture.md). Follow one note from host metadata to the screen. |
| Check a change | [Testing guide](testing.md). Build, test, then choose the synthetic browser case that exercises the change. |
| Understand a tradeoff before revisiting it | Read the [research notes below](#research-notes), then the [decision records](decisions/README.md) for accepted implementation choices. |
| Know what not to promise | [Open decisions and known limits](open-decisions.md). See who or what can close each gap. |

**First contribution?** Read the [contributor contract](../AGENTS.md), [setup and contribution policy](../CONTRIBUTING.md) and [security policy](../SECURITY.md). Find the affected boundary on the architecture map and read its decision record before editing.

## Research notes

- [Rendering with limited memory](research/low-memory.md): when a drawing cap helps and when it leaves the costly allocation untouched.
- [Zoom and level of detail](research/zoom-detail.md): how camera movement reveals more without changing the graph.
- [The first pickable dots](research/first-pickable-dots.md): why two promising samplers were rejected.
- [Layout engines and time to explore](research/layout-timing.md): which clock measures a useful result.
- [Starting from cached facts](research/startup-cache.md): why a faster first graph can still be unverified.
- [Graphics and Canvas drawing](research/drawing-backends.md): what a fallback should preserve and which measurements transfer.
- [Label density](research/label-density.md): which names earn space when many could fit individually but not together.

## Reference shelf

The [declaration format](declaration-format.md) defines inputs; the [projection format](projection-format.md) defines the resulting data. [Benchmarks](benchmarks.md) holds dated methods, observations and limits. [Releasing](releasing.md) describes local artifacts; the [publication checklist](publish-checklist.md) is separate. The [changelog](../CHANGELOG.md) records what changed.

## Keep this map useful

Keep raw captures and worklogs private and untracked. When an observation will matter to the next contributor, distill one question per research note: name the evidence, the result, the decision and what remains untested. Promote an implemented choice into its owning guide or decision record only after checking it against source and reproducible evidence. Link that record instead of copying its contract. If the choice changes, link the superseding record and update this map.
