---
description: Provisional property facts versus verified host facts and saved layout coordinates during a cold start.
---

# A faster first graph is not a verified graph

A saved fact can give the graph something useful to draw while the host is still loading properties. It cannot establish what is true of the current vault.

**Finding.** There are two different cache hits. Replaying a compatible fact partition supplies provisional input to the normal projection. Reusing an eligible saved layout avoids solving coordinates again. A correctly written layout on disk is not proof that a subsequent plugin session read it: one synthetic reload reached storage readback but the host did not finish booting the plugin.

**Evidence.** [Adapter and cache tests](../../tests/fact-cache.test.ts) exercise stale, corrupt and superseded input. The [startup measurements](../benchmarks.md#provisional-native-fact-startup-cache-2026-11-17) separate first graph from verified completion. Readback and same-session replay do not stand in for a successful end-to-end cold reopen.

**Decision.** Only persist eligible verified facts. Check the partition and declaration on restore, treat replay as provisional, and let current host rows win. Do not publish a verified layout from provisional facts. Keep the bounded plaintext cache outside shared settings. It is not encryption, backup erasure or proof of continued access. [ADR 0009](../decisions/ADR-0009-provisional-fact-cache.md) owns these rules.
