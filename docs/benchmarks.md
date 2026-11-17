# Benchmark methodology and evidence

Results belong to an exact invocation, fixture, source revision and hardware class. They do not establish all-scale acceptance. Original slice-1 source is `041e1382` (2026-11-10); release-readiness baseline is `9b8cc07`. Historical tables below remain dated evidence. The slice-2 section records the new worker/browser/native invocations and unmet targets separately. Raw receipts remain ignored and local; publish only scrubbed summaries without hostnames, usernames, real-vault paths or private projections.

## Indexed instanced geometry (2026-11-17)

Source: the commit carrying this section, compared with `3d7096b`. Only the node/edge vertex mapping, two static element buffers and their draw calls change. Eight-segment edges reference 18 vertices instead of 48; nodes reference four instead of six. The 32-segment ceiling needs 396 bytes of static GPU index data in total. Positions, triangle order, shader arithmetic after endpoint mapping, fragments, policies and Canvas remain unchanged.

**Desktop RTX evidence only:** Linux x86-64 desktop, 32 GiB RAM, NVIDIA RTX 4060 Ti, Chromium 151.0.7922.34 through ANGLE Vulkan. A standalone renderer with a minimal public-host DOM shim, not Obsidian, draws seeded synthetic 5,000/20,000/49,000-note graphs with 14,000/56,000/114,000 edges and 1,000/4,000/33,000 relationship notes. Canvas size is 1000×650 at DPR 1. Default policy uses eight segments at 5k/20k and straight lines at 49k; the extended parity cases explicitly raise the existing curve-count threshold to exercise 32 segments at every size without changing production defaults.

The same WebGL context alternates frozen-baseline shaders/array draws and actual production indexed shaders/element draws. Each case has 20 alternating warmups and 96 measured pairs, reversing order every pair; 12 cases give **1,152 pairs**. Query availability, non-disjoint status and zero GL errors are required. These are queued-draw GPU throughput timings, not interactive frame latency or FPS. Percentage change is the median of within-pair ratios, not a ratio of independent-run medians.

| Notes | Camera, no selection | Baseline median GPU ms | Indexed median GPU ms | Median paired change |
| ---: | --- | ---: | ---: | ---: |
| 5,000 | overview | 0.247808 | 0.221184 | -10.70% |
| 20,000 | overview | 0.967680 | 0.769024 | -20.59% |
| 49,000 | overview | 0.267264 | 0.224256 | -15.77% |
| 5,000 | close-up, 0.15× home ratio | 0.079872 | 0.055296 | -31.65% |
| 20,000 | close-up, 0.15× home ratio | 0.296960 | 0.192512 | -35.27% |
| 49,000 | close-up, 0.15× home ratio | 0.171008 | 0.129024 | -24.55% |

The corresponding selected-note changes are **-9.88% / -19.26% / -13.28%** at overview and **-30.86% / -33.56% / -22.49%** close-up. Absolute timings vary with GPU clocks and workload; the 49k straight-line policy is not directly comparable with the curved 20k workload.

All **12 original fixed-camera/selection FNV32 checksums** reproduce the research receipts exactly and match the indexed version. Those 12 plus 48 extended comparisons check every synchronous RGBA byte: **60 comparisons, zero differing bytes**. Extended cases cover light/dark themes, Blend/Density, straight/32-segment curves, hover, and centered selected relationship notes. Every requested density target is complete. Actual `WEBGL_lose_context` loss/restoration at each size recreates both element bindings, restores identical pixels in light-theme 32-segment density mode, and explicitly deletes all ten owned instance/index buffers on disposal. Separate baseline/candidate Canvas fallback checks match all eight theme/camera/selection checksums on a 600-note fixture. The deterministic initialization regression expands every triangle index through segments 1–32 and verifies fresh resource ownership and the unchanged unindexed disc VAOs.

Invocation: `flock -w 1800 /tmp/graph-ng-harness.lock timeout --kill-after=10s 600s node .workspace/indexed-geometry/runner.mjs`. The runner checks `free -g` available memory >=8 before launch, uses one browser and closes the browser/server in `finally`. Vulkan flags match the research probe: `--enable-unsafe-webgpu --use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist`. Raw results and synthetic screenshots are in `.workspace/evidence/indexed-geometry/browser-warmed/`; the fixture, runner and frozen baseline source are in `.workspace/indexed-geometry/`. Original research and complete local receipts are also retained in the requested external receipt directory. No real vault, remote or publication was used.

The first attempt refused before browser creation at 7 GiB available. A cold Vulkan attempt lost its context while installing comparison shaders and was excluded; restoring the research runner's 100-note/1.5-second startup warmup yielded the complete passing run. Both failures remain in the receipts. Synthetic screenshots were visually inspected for privacy and selected relationship rendering; a dark screenshot retained the previously observed Vulkan capture black corner despite exact synchronous readback parity. This is not native-host/compositor acceptance. Integrated/mobile GPUs, other drivers, native Obsidian and independent merge review remain separate gates.

Verification: `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`, then the same wrapper with `test --timeout 10000` and `gates`; bundle report via `node scripts/bundle-size.mjs`. Build passes; **836 tests pass, one existing optional skip, zero failures**, across 39 files. Initial unit failures were four draw spies that recorded only array draws; they now observe indexed draws without removing ordering/selection assertions. The standalone bundle is **414,351 raw / 141,118 gzip bytes**, versus **413,948 / 140,976** at `3d7096b`: **+403 raw / +142 gzip**, below unchanged **420,000 / 145,000** ceilings. This excludes concurrent startup/layout/performance changes and grants no deployment or release approval.
## Provisional native-fact startup cache (2026-11-17)

Cold-measurement candidate: `4d05f97`, compared with `3d7096b`. The subsequent review fixes are not included in these cold timings. Hardware class: Linux x86-64 desktop, 32 GiB RAM, shared local load. This implementation covers the native public metadata source only. Selecting the optional derived source disables persistent replay and saving until that provider exposes a durable public provider/parser identity.

The prepared cold harness uses 20,000 synthetic Markdown files (7,000 ordinary and 13,000 relationship notes) and 49,000 files (16,000 ordinary and 33,000 relationship notes), each with 80 groups. It first saves an actually verified generation, closes its owned Chromium process, then launches separate baseline and candidate processes. Only synthetic filesystem stamps and, for the candidate, saved plugin-cache bytes survive. Private metadata, renderer state and worker state are never restored. Timing fields start at plugin onload, not browser launch or app download. The native producer is `obsidian-links@1.12.7`; one layout iteration, one refinement iteration and disabled layout persistence isolate ingestion/projection without claiming convergence.

The synthetic filesystem harness lacks the binary compatibility primitive used by the public Obsidian adapter. A harness-only Uint8Array-backed `Buffer.from/alloc`, capped at 1 MiB per operation, supports the same `readBinary/writeBinary` calls already used by BinaryLayoutStore. Production code is unchanged by this shim. Results must distinguish the first provisional saved-fact graph from verified readiness, preserve separate browser PIDs/cleanup receipts, compare final graph identity/counts and visually inspect screenshots.

Both full-browser sequences completed after the setup faults were corrected and the 8 GiB available-memory floor was met. All six browser processes were distinct and fully closed. Each run began with only 8 to 10 native file caches populated, not a warm metadata cache. One before/after pair per size, under shared load, gives the following observations in milliseconds from plugin onload.

| Synthetic files | Baseline first incomplete paint | Baseline host-complete group paint | Saved-fact provisional group paint | Baseline verified ready | Candidate verified ready |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20,000 | 191.8 | 17,436.0 | 288.9 | 17,560.8 | 11,561.5 |
| 49,000 | 404.1 | 23,344.8 | 545.9 | 23,550.9 | 17,577.9 |

The baseline already paints incomplete placeholder topology sooner; this feature supplies useful provisional topology sooner, not the first pixel. At 20k the saved-fact graph has the final 7,000 notes and 21,096 edges. At 49k it has 16,000 notes and 51,862 edges, one fewer edge than the final 51,863: an available native row supersedes its saved row before its native link resolves. This is provisional reconciliation, not exact early parity. Final projection keys and counts agree across warm, baseline and candidate at both sizes. Both provisional captures retain `verified=false` and visibly say “Saved copy while host confirms”; all eight synthetic final/provisional screenshots were visually inspected. No page errors were recorded. Saved generations occupy 3,104,931 and 7,627,279 bytes.

These single pairs do not establish a host-verification speedup, statistical performance acceptance, weak-device behavior or the speed of later review fixes. Shared-load variation affects verified-ready timings. Earlier same-session replay research remains excluded.

The measured `4d05f97` standalone build is **419,957 raw / 143,044 gzip bytes**, exactly **+6,009 / +2,068** versus the rebuilt `3d7096b` baseline (**413,948 / 140,976**). Unchanged ceilings are **420,000 / 145,000**; only 43 raw bytes remain. This excludes concurrent feature branches.

Verification commands use `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`, then the same wrapper with `test --timeout 10000` and `gates`; the separate size command is `node scripts/bundle-size.mjs`. The ordered preflight checks secrets, attribution, privacy, frozen-lock/install policy and runtime licenses before build/tests. Build passes; **848 tests pass, one existing skip, zero failures** across 40 files (80.17 seconds), and all six final gate lanes pass. An initial final-suite run caught a private error-field name colliding with an existing layout dataset key; the new field was renamed and the unchanged layout regression now passes. That evidence belongs to `4d05f97`. Independent review subsequently found six fixable issues, with no P1 authority bypass; the follow-up addresses failed-namespace purge, byte-sized chunks, namespace pacing/deadlines, entropy failure, nested-value replay fallback and reload-safe serialization.

The `9c1d322` follow-up build carrying the review and observed-mismatch purge fixes is **421,249 raw / 143,530 gzip bytes**: **+1,292 / +486** versus `4d05f97`, or **+7,301 / +2,554** versus `3d7096b`. The unchanged 420,000-byte raw ceiling fails by **1,249 bytes**; gzip remains below 145,000. No cap was edited in this branch. Full gates pass secrets, attribution, privacy, frozen-lock/install policy and runtime licenses, then fail solely on that raw bundle-size ceiling; the full gate command is not green. The follow-up build and full unit suite pass: **858 tests pass, one existing skip, zero failures** across 40 files (81.56 seconds). The 100k namespace regression reads only the first 256 entries before yielding, measured at **0.2612 ms** in Bun on this desktop; that is not native/browser timing. It also checks the merged fingerprint against the prior canonical ordering, cancellation, oversized namespace refusal and end-to-end key deadlines. Ten added regressions cover the six review findings plus live mismatch purge and purge failure/deadlines. Independent recheck confirmed the original six fixes, but found two new regressions: one global epoch coupled unrelated stores, and save batching omitted the replay child-value budget. Native remeasurement remains outstanding.

The next recheck-fix build scopes reload-stable queues by public adapter identity plus exact cache directory, and uses the same iterative validator on save/load with exact serialized child-count batching. Six new regressions cover independent concurrent purges, blocked unrelated I/O, moderate array roundtrip, exact value/depth boundaries, nonfinite/cyclic refusal and sparse arrays. Existing same-storage module-reload serialization regressions still pass. Build and the full suite pass: **864 tests pass, one existing skip, zero failures** across 40 files (82.21 seconds). Standalone size is **421,457 raw / 143,623 gzip bytes**, **+208 / +93** versus `9c1d322`, or **+7,509 / +2,647** versus `3d7096b`. This fits the integration ceilings **430,000 / 148,000** recorded in `aca875d`, but this isolated branch retains its inherited **420,000 / 145,000** gates and therefore still fails its local raw ceiling by **1,457 bytes**. No cap policy was edited or imported here. Independent review of this final fix and native retiming remain separate.

Ignored receipts use the `graph-ng-startup-cache-receipts/` evidence directory: `run-cold.mjs`, `prepare-native.mjs`, `native-20000.*`, `native-49000.*`, `cold-metrics.json`, six run/cleanup receipts, provisional-state receipts, eight inspected PNGs, failed-setup logs, synthetic fixtures, exact baseline/candidate bundles and memory snapshots. Native invocation is `flock -w 1800 /tmp/graph-ng-harness.lock node run-cold.mjs 20000`, then the corresponding `49000` invocation from that evidence directory; the runner checks memory before every launch and owns cleanup before the next browser. No real vault or remote is used. No storage, mobile, hardware-GPU or independent security acceptance follows from this setup.

## Morton Barnes-Hut query locality (2026-11-17)

Source: the commit carrying this section, compared with `d5bed0a`. Linux x86-64 desktop class, 32 GiB RAM, shared local load. Only query visitation order changes for at least 20,000 nodes; tree insertion, per-node force accumulation, integration and the 50 ms message-friendly yield are unchanged. The 5k control keeps ordering disabled, so its small timing differences do not establish a lower crossover. The gate remains 20k.

The synthetic `largeFixture` topology is converted to ordinary producer-link rows, projected by the actual `src/layout-worker.ts` in headless Chromium, and timed through its normal `recompute` protocol. Each sample starts from the same explicit Float32 seed and runs 100 iterations with default forces, with overlap off and on separately. Initial layout establishes the worker generation; two further warmups per variant/mode precede six alternating before/after pairs. Timings cover request-to-result layout elapsed time, including normal streamed-position recycling, not ingestion, projection, renderer FPS or whole-app startup. Every pair compares all final Float32 bit patterns, not tolerance-based distance or only rounded coordinates. Baseline and candidate workers are archived minified browser bundles.

| Nodes | Overlap | Baseline median ms | Morton median ms | Elapsed change | Final bits |
| ---: | --- | ---: | ---: | ---: | --- |
| 5,000 | off | 536.70 | 541.95 | +0.98% | identical |
| 5,000 | on | 1,080.35 | 1,067.05 | -1.23% | identical |
| 20,000 | off | 2,537.10 | 2,196.35 | -13.43% | identical |
| 20,000 | on | 5,695.85 | 4,733.00 | -16.90% | identical |
| 49,000 | off | 6,984.20 | 6,045.35 | -13.44% | identical |
| 49,000 | on | 15,996.80 | 13,641.45 | -14.72% | identical |

All **36 measured pairs** have bit-identical final coordinates. Headless Chromium reports major version **151**. Separate initial-layout/refinement Stop requests at the first streamed frame returned unsettled results in **4.6 / 4.4 ms at 5k**, **18.1 / 19.2 ms at 20k**, and **52.1 / 77.7 ms at 49k**. These used a 10,000-step budget, batch size 1,000 and stream cadence 1; all stopped by streamed iteration 2. The actual-worker unit regression separately checks a gated 20k layout and refinement with batch/stream cadence 5 against the 500 ms ceiling. A 50 ms work check is not a bound on an atomic step or OS scheduling delay.

The reusable Morton code, permutation and scratch columns plus histogram cost **241,024 bytes at 20k** and **589,024 bytes at 49k**. All are allocated once per tree. Refresh before steps 1/9/17 uses existing bounds and a four-pass unsigned byte-radix sort, with no new arrays, comparator or iterator scratch. Existing quadtree capacity growth is unchanged. Tests exercise stable ties, all 32 code bits, degenerate extents, exact gated ordinary/overlap coordinates across three refreshes, pinned nodes, unchanged initial buffers and reusable scratch identities. Existing small deterministic/oracle and 50 ms scheduling tests remain in place.

Probe invocation: `flock -w 1800 /tmp/graph-ng-harness.lock timeout --kill-after=10s 1800s node .workspace/morton/browser.mjs`. The runner requires `free -g` available memory >=8 before launch, uses one installed headless Chromium browser, and closes its workers/browser/server in `finally`. Bun verification waits until this probe releases the harness lock. Ignored sources, checksums, raw alternating samples, Stop receipts and failed setup attempts are under `.workspace/morton/`; deterministic build/test/gate receipts are under `.workspace/evidence/`. The original research prototype had been cleaned up, so this implementation reproduces the finding rather than claiming inherited receipts. The first local probe attempts found a missing default browser revision and a missing initial worker layout; both were harness setup failures, not numerical failures. No private vault or native UI was opened. Cross-engine identity, mobile, hardware-GPU, million-node and whole-app acceptance remain unproven.

Verification: `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`, then the identical wrapper with `test --timeout 10000` and `gates`; bundle receipt via `node scripts/bundle-size.mjs`. Build passes; **834 tests pass, one existing optional skip, zero failures**, across 39 files; all six gate lanes pass. The first full test attempt found a conservative property-name scanner collision in a new comment and a combined four-scenario parity test exceeding 10 seconds; the comment was renamed and the same exact comparisons split into four bounded tests. Final standalone bundle: **412,357 raw / 140,500 gzip bytes**, versus **411,467 / 140,101** at `d5bed0a`, exactly **+890 raw / +399 gzip**. Unchanged ceilings are **415,000 / 142,000**; this excludes the concurrent performance-modal change and is not an integrated bundle result. Independent review before merge remains separate; these checks grant no deployment, release or publication approval.

## Relationship Notes switching and finite progress (2026-11-16)

Source: the commit carrying this section, compared with `1e4889b`. Hardware class: Linux x86-64 desktop, 32 GB RAM, shared local load. The synthetic fixture contains 16,000 ordinary notes, 45,000 relationship notes with source/target/type properties, 80 ordinary-note groups and 8,028 wikilinks. Lines projects 16,000 nodes; Notes projects 61,000 nodes and 127,634 edges. Both versions finish the configured 100-iteration budget with finite positions; completion is **not** convergence and these samples report `settled:false`.

Three Notes switches per version, alternating Lines/Notes, use the same generated fixture and worker/adapter protocol. Matching isolated test subsets, milliseconds:

| Stage | Baseline median | After median |
| --- | ---: | ---: |
| Declared row ingestion | 286.56 | 2.94 |
| Projection | 430.63 | 480.83 |
| Layout | 7,897.01 | 8,434.81 |
| Entire switch | 8,617.57 | 8,908.89 |

Total ranges are 8,599.22–8,759.61 ms before and 8,881.04–9,129.00 ms after. This does not establish a meaningful end-to-end speedup under shared load. It does establish removal of all **61,000 repeated row reads/transfers** per display-only switch (baseline 31–33 batches, after zero), and completion of every 61k computation. All clean-fixture samples had zero adapter change notifications, so they do not reproduce or prove the exact cause of the owner's repeated refreshes. Deterministic regressions separately reproduce identical events during unacknowledged ingestion and preserve genuine changes/mid-batch reverts.

Opt-in preparation uses the ignored synthetic QA generator: `node .workspace/visual-qa/gen-vault.mjs .workspace/visual-qa/vault-61k 16000 45000 80`, baseline plugin settings at `.workspace/visual-qa/plugin-before/data.json`, and the `src/` tree from `git archive 1e4889b src` extracted under `.workspace/baseline-source/`. The benchmark reads only this fixed generated fixture; it never accepts an arbitrary vault. The private generator/settings are local evidence inputs, not a clean-clone fixture distribution.

Exact baseline/after subset is `./scripts/run.sh test --timeout 10000 --test-name-pattern 'synthetic 61000 note switch timing' ./tests/notes-switch-benchmark.test.ts`, with `PERF_BENCH=1` for both and `BENCH_BASELINE=1` only for baseline. Every Bun invocation uses `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s`. Receipts: `.workspace/before-paired-only.log`, `.workspace/after-reviewed-benchmark.log`, and `.workspace/{before,after}-paired-timing.json`. An earlier benchmark concurrent with the full suite caused one 10-second centering-test timeout; its single isolated rerun passed in 5.32 seconds. These measurements use the worker and public-metadata adapter, not native host indexing, app startup or GPU rendering.

Build and the full regular suite pass **765 tests, one existing skip**, with **983,681 assertions across 37 files**. Independent review identified and the candidate corrects queued Stop intent, immediate Stop returning a seed, and overlapping whole-vault verification scans; each has a regression. Added regressions cover ingest identity, acknowledged hydration, stop/resume and encode refusal, monotonic measured phases, one retained shimmer span, loading-preview input/camera, stop-button accessibility/stable slot, and permanently unverified/missing metadata with later recovery. Exact commands are `./scripts/run.sh build`, `./scripts/run.sh test --timeout 10000`, and `./scripts/run.sh gates`, each with the lock/timeout prefix above. The full ordered gates pass. Bundle: **393,214 raw / 132,856 gzip bytes**, a **+1,852 / +624-byte** delta from `1e4889b`; 395,000 / 134,000 ceilings are unchanged. The queued-path hydration correction below adds **61 raw / 21 gzip bytes** over the inherited paced-audit candidate. These are standalone worktree measurements, not a merged-main size result.

The host's `derived/current` property facts remain unverified until their explicit `verified` flag is true; a non-null native cache does not override that selected source. Missing native cache rows are the other reproduced incomplete state. Both remain usable and honestly labelled, without a ready-state waiting animation. Resolver completion now queues unverified paths for rereading; verification-only events include never-indexed paths and route newly available rows through ingestion. No real vault was inspected, so the precise cause of any particular owner's remaining count is not established. The native-only cheap cache-availability guard does not apply to a selected derived property source. While native resolved events continue, every unqueued, unverified derived-source path can still be read and stamped once per paced pass. That remains a known large-vault cost, not covered by the native-only hydration acceptance below; selected-source verification rules were not weakened to avoid it.

### Synthetic native interaction evidence

The native harness refuses more than 50,000 input files. That cap was not bypassed: 61k completion above is deterministic worker/adapter evidence, not native rendering acceptance. The native software renderer also retains its unchanged 2,000-note/10,000-edge detail cap. Large native fixtures therefore use Groups, not a claimed 49k detail render.

The reviewed 1,800-note fixture (1,000 ordinary notes plus 800 relationship notes) passes all **24 native steps**, with zero page/console errors. A 1,000-iteration synthetic request stays active long enough to exercise real canvas wheel/pointer handlers, Stop, and Keep refining. Pan and zoom both change the loading camera; Stop preserves world center/scale across the preview/final normalized-frame replacement, returns unsettled coordinates, and removes busy status. Keep refining resumes; a second Stop again remains unsettled. The two early-stop computations took 2,173.3 and 2,175.3 ms. These are stop observations, not full-budget completion timings. A first native assertion compared raw normalized camera fields incorrectly; its corrected world-coordinate comparison passes.

Invocation: `bash .workspace/visual-qa/run.sh notes-small-reviewed plugin-reviewed vault-small steps-small-after.json 12`. The runner serializes on the shared native harness lock and checks at least 8 GB available immediately before launch; it never kills unrelated processes. Synthetic light/dark captures were visually inspected. Key relative evidence: `.workspace/visual-qa/runs/notes-small-reviewed.step-13-notes-progress.dark.png`, `notes-small-reviewed.step-15-notes-camera.dark.png`, and `notes-small-reviewed.step-24-refined-stopped.dark.png` in the same directory. Raw report: `notes-small-reviewed.json`. No real vault, GPU/mobile proof, publication or remote deployment is implied.

### Matched 49k hydration audit (2026-11-17)

The fixed synthetic fixture contains 16,000 ordinary notes and 33,000 relationship notes, with 80 groups and 8,026 wikilinks. Its verified Lines projection has 16,000 nodes and 51,863 edges. Settings, fixture, `run.sh`, and the 31 ten-second samples in `steps-hydration-fast.json` are unchanged from the earlier `hydration49-cheap-baseline.json` / `hydration49-paced-cheap.json` pair. That earlier pair reported 18,272.7 / 23,372.7 ms to verified-ready and 141,628 / 187,175 adapter reads. Timing starts at the existing observer before Open, not process launch; host indexing has already begun. All tests remain Groups-only under the unchanged 50,000-file native cap and software detail limits.

Each ablation removes just the named component from the inherited candidate and follows a fresh `1e4889b` baseline. Equal QA-only wrappers count configure/layout generations and row batches in the sampled dataset; they do not change the runner or sampling steps. Exact sequence: `bash .workspace/hydration-bisect/run-pairs.sh`. Its individual invocation is `bash .workspace/visual-qa/run.sh bisect-<component>-<variant> plugin-bisect-<variant> vault-49k steps-hydration-fast.json 12`, with baseline followed by the named component. These ignored scripts/plugin copies are local evidence inputs, not clean-clone benchmark tooling.

| Disabled component | Baseline ready ms | Ablation ready ms | Baseline reads | Ablation reads |
| --- | ---: | ---: | ---: | ---: |
| Resolved-handler property audit | 18,281.9 | 17,162.3 | 142,528 | 141,275 |
| Post-ingest dirty-stamp audit | 18,120.1 | 17,937.2 | 141,253 | 184,938 |
| Index callback stamp filter | 15,920.7 | 18,951.2 | 140,800 | 141,803 |
| Loading input/camera attachment | 16,696.6 | 19,262.5 | 140,583 | 186,572 |
| Worker Stop plumbing | 18,574.6 | 19,096.8 | 141,856 | 185,700 |

Every run completed 34 steps without page/console errors, with **two rebuild/layout generations and one index flush**. These are single-run paired ablations, not additive per-component CPU costs: baseline timing itself ranges from 15.92 to 18.57 seconds, and the loading-camera path is not entered in Groups. Disabling the resolved audit eliminates its extra row reads; disabling the callback filter instead removes a different read pass. The five-second historical slowdown cannot honestly be assigned solely to one component from these timings.

The correction retains both audits, callback deduplication, camera input and Stop. A resolver audit now skips paths already queued in `IncrementalIndex`, before allocating/stamping rows or resetting their debounce slot. Previously the adapter's dirty map did not see those native events until the index flushed, so the audit repeated their pending work. A new regression fails before correction with **260 duplicate reads for 260 queued paths**; after correction the audit performs **zero reads and zero extra change enqueues**, and ordinary ingestion verifies every row in the existing cycle. Late-cache-only resolution, explicit verification, single-flight/epoch checks and selected-source trust rules remain tested and unchanged.

The final sequence, `bash .workspace/hydration-bisect/final-pair.sh`, repeats the unchanged candidate, then runs baseline/fixed back to back using the same individual invocation with names `bisect-final-{original,baseline,fixed}` and plugins `plugin-bisect-{original,baseline,fixed}`:

| Final control or pair | Verified-ready ms | Total adapter reads | Native caches at 10 s | Rebuilds | Index flushes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Unchanged candidate control | 17,985.4 | 185,406 | 49,000 | 2 | 1 |
| Baseline `1e4889b` | 18,963.8 | 142,072 | 44,969 | 2 | 1 |
| Fixed candidate | **16,934.0** | **141,362** | **49,000** | **2** | **1** |

The fixed candidate is 2,029.8 ms earlier than its adjacent baseline with 0.995 times its reads, meeting the requested no-more-than-about-two-seconds-behind bar. It removes 44,044 reads versus the fresh unchanged-candidate control. The control itself no longer reproduces the historical 23.37-second delay, so this establishes removal of redundant work and this pair's acceptance, not a general two-second speedup or proof that the entire earlier delay belonged to the audit. All three runs finish 34 steps with no page/console errors and the expected final 16,000-node/51,863-edge projection. Both fixed final themes were visually inspected and contain only the synthetic fixture.

Evidence: `.workspace/visual-qa/runs/bisect-*.json`, particularly `bisect-final-baseline.json` and `bisect-final-fixed.json`; final captures are `bisect-final-fixed.step-34-hydration-final.{light,dark}.png` in that directory. Regression/build/full-test/gate receipts are `.workspace/hydration-bisect/{regression-before,build-fixed,fixed-targeted,fixed-full-tests,fixed-gates,final-gates}.log`. The wrappers retain `flock -w 1800 /tmp/graph-ng-harness.lock` and the immediate 8-GB availability check. Bun build/tests/gates use the exact lock/timeout prefix above; tests and gates were also kept outside native measurements with the harness lock. No real-vault, hardware-GPU, mobile, publication or deployment acceptance is added.

## Click intent, continuous hubs and traversed isolation, wave 12 track H (2026-11-16)

Source: the commit carrying this section, based on `2bfcf8e`. Hardware class: Linux x86-64 desktop, 32 GB RAM. Core projection, layout physics and camera implementation are unchanged. Build and **721 tests pass, one existing skip**, with **961,262 expectations across 37 files**. Added regressions cover traversed-edge isolation, explicit carrier legs, filters, expansion, continuous sizing through 25x, precision validation, migration of every click-boolean combination, Appearance choices, bounded label priorities, and the final selected-node size attribute/restoration.

Exact commands, each prefixed by `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s`: `./scripts/run.sh build`, `./scripts/run.sh test --timeout 10000`, and `./scripts/run.sh gates`. All six ordered content/dependency/bundle gates pass. Ignored deterministic logs are `.workspace/track-h/{build-final,tests-final,gates-final}.log`. Bundle: **384,203 raw / 129,955 gzip bytes**, baseline **382,849 / 129,530**, delta **+1,354 / +425**. Unchanged 385,000 / 130,000 caps leave only **797 raw / 45 gzip bytes** before merging other tracks.

Synthetic browser-native invocations use `bash .workspace/visual-qa/run.sh` with run/plugin/vault/steps/window arguments: `wave12-h-before plugin-wave12-h-before vault-wave12-h steps-wave12-h-before.json 10`, `wave12-h-after plugin-wave12-h-after vault-wave12-h steps-wave12-h-after.json 10`, and `wave12-h-final plugin-wave12-h-after vault-wave12-h steps-wave12-h-controls.json 10`. The wrapper owns the harness lock; available memory was at least 8 GB at each launch. Baseline captured both themes successfully before an unnecessary repeated theme assertion timed out; the entire baseline run is not claimed passing. The first after run passes 13/13 steps; the final controls run passes 18/18, with no console/page errors or unhandled rejections.

The 831-node/970-edge fixture has 190 direct endpoints, 190 first-hop carriers, 190 second-hop endpoints and 190 further carriers, plus context. Baseline isolation incorrectly admits 520 edges; after isolation retains the same 381 nodes and exactly **380 selected relationship legs**, with at most six badges instead of 24. Click tiers remain 190 direct and 190 second-hop endpoints. Paired-theme captures show a solid selected centre above the fan and larger direct dots; slider preview at 19x shows a 19 px largest hub and a 1.70 px leaf. Appearance controls retain help on demand. Evidence is synthetic software WebGL and deterministic Canvas seams, not hardware-GPU, Electron, screen-reader or full-scale acceptance. Independent merged-wave review remains parent-owned.

Visually inspected evidence lives under `.workspace/visual-qa/runs/`: `wave12-h-before.step-09-dark-click`, `wave12-h-before.step-11-dark-isolation`, `wave12-h-after.step-09-click`, `wave12-h-after.step-11-isolation`, `wave12-h-after.step-13-appearance`, and `wave12-h-controls.step-{14-hub-slider,16-click-control,18-label-control}`, each with `.dark.png` and `.light.png` suffixes. Final inspected `wave12-h-final.step-{14-hub-slider,16-click-control,18-label-control}` captures in both themes supersede truncated intermediate selector labels.

## Dense hubs and inset overview, wave 10 track H (2026-11-16)

Source: the commit carrying this section, based on `2063a4e`. Hardware class: Linux x86-64 desktop, 32 GB RAM. Changes are bounded to label admission, focus-ring density and Group overview framing. Anchored remains the default; Ranked remains selectable. The core, topology, worker layout, node picking and connection-card contents are unchanged.

Build and **638 tests across 36 files pass**, with **163,185 expectations**. Three added tests exercise dense direct-name caps with blocked candidates and hover priority, inset opening/closing/reduced motion, and actual group draw/hit geometry within the available canvas. One older group mock now supplies the canvas width used by production. Exact commands, each under `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s`:

- `./scripts/run.sh gates:fast`
- `./scripts/run.sh build`
- `./scripts/run.sh test --timeout 10000`
- `./scripts/run.sh gates`

Bundle: **372,840 raw / 125,002 gzip bytes**, versus **372,405 / 124,844** at baseline: **+435 raw / +158 gzip** (level 9). Caps remain **375,000 / 126,000**. Ignored receipts: `.workspace/{preflight,build-before,build-after,tests-final,gates-final}.log` and `.workspace/evidence/bundle-size.json`.

Native commands: `bash .workspace/visual-qa/capture.sh before`, `after`, and `final`. The wrapper serializes the synthetic-only browser-native harness with `/tmp/graph-ng-harness.lock`; memory checks exceeded 8 GB available. Paired before/after captures show the same 120-note, 199-edge fixture with 45 direct hub neighbours, and six overview groups beside Members in both themes. Final pass: **23/23 steps**, no console/page errors or unhandled rejections. Explicit WebGL and Canvas lanes each retain all 45 card connections and admit seven anchored names (focus plus six neighbours); Ranked admits three names at this camera after collisions and panel exclusion. This is software WebGL, not hardware-GPU or desktop Electron acceptance. The live style-switch run's dark Ranked WebGL screenshot lost selection after its passing assertion; its light counterpart retained selection. A separate `bash .workspace/visual-qa/capture.sh ranked` cold-configured Ranked pass (**6/6 steps**) retains the selected hub in both themes (`runs/ranked.step-06-ranked-webgl-hub.{light,dark}.png`). The transient style-switch observation is not claimed fixed by this patch.

At view widths 1100 / 850 / 420 px, the group canvas stays one pixel before the panel, measuring 706 / 456 / 6 px. The narrow panel deliberately consumes almost all graph space; Members remains usable instead of obscuring an unseen graph. Closing samples monotonically expand 812 / 903 / 979 / 1037 / 1070 / 1074 px from 706; 11 redraws occur during the transition and zero in the following 250 ms idle window. No permanent animation loop was added. Visually inspected paired captures include `runs/before.step-08-hub-card`, `runs/before.step-11-group-panel`, `runs/final.step-06-webgl-hub`, `runs/final.step-11-canvas-hub`, `runs/final.step-17-group-panel`, and `runs/final.step-19-group-midwidth` under `.workspace/visual-qa/`, with `.light.png` and `.dark.png` suffixes. The full reports retain the harness's unknown trust verdict. Independent merged-wave review remains parent-owned.

## Answer-first Graph information — 2026-11-16

Source: the commit carrying this section, based on `aa781eb`. Hardware class: Linux x86-64 desktop, 32 GB RAM. Graph information now leads with state and named counts, keeps reconciled note/edge accounting in disclosures, and separates navigation from explicit filter removal and relationship-display changes. Shared help replaces persistent Saved views explanations. Existing graph authorities and security boundaries are unchanged.

Build and all six ordered gates pass; **619 tests pass, zero failures**, with 162,555 expectations across 36 files. Regressions cover active-predicate action names versus complementary hidden reasons, no reveal-count promises, truthful provisional/current-generation loading counts, existing quarantine navigation, disclosure/focus/help/scroll restoration, help/action ordering and collapsed Saved view definitions. Exact commands, run separately:

- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`
- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh test --timeout 10000`
- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh gates`

Final bundle: **372,730 raw / 125,034 gzip bytes** (gzip level 9), versus **369,576 / 123,859** at baseline: **+3,154 raw / +1,175 gzip**. Unchanged owner-approved caps are **375,000 / 126,000**, leaving **2,270 / 966 bytes**. SHA-256: `4b86cd6b93333bef8b3b5ca783712af5d6a3f969657ac383402c41ff8843b6c4`. Ignored deterministic receipts: `.workspace/gi-tournament/{baseline-gates,final-build,final-tests,final-gates}.log` and `.workspace/evidence/bundle-size.json`.

Actual-app command: `bash .workspace/visual-qa/run.sh gi-answer-final plugin-gi-answer-first vault-gi-answer-first steps-gi-answer-first.json 8`. The wrapper owns the harness lock; available memory was 10 GB at launch. The disposable synthetic vault contains 159 notes initially (120 ordinary, 36 relationship, 3 excluded), then 162 after duplicate-ID and missing-target fixtures are added. Ready shows 120 notes and 156 edges; the problem state shows 37 filtered relationship notes, 2 duplicate-ID notes and 1 missing target. Loading captures hold and release an actual worker result rather than fabricating counts.

All **42 steps pass**, with no page/console errors or unhandled rejections, and teardown completes. The problem panel measures **320 × 480 px**, with exactly one scrolling surface; an explicit open-popover assertion verifies that help does not obscure the filter-removal action. All **28 captures** were visually inspected in both themes, including ready, accounting, relationship display, loading, problems and Saved views. Receipt: `.workspace/visual-qa/runs/gi-answer-final.json`. Selected images in that directory: `gi-answer-final.step-09-gi-ready.dark.png`, `gi-answer-final.step-26-gi-problem.dark.png`, `gi-answer-final.step-33-gi-problem-narrow-help.dark.png`, and `gi-answer-final.step-11-gi-ready-accounting.light.png`.

Scope is synthetic browser-native Obsidian with Canvas fallback, not desktop Electron, hardware WebGL, mobile/touch or release acceptance. The harness verdict remains `unknown` (`harness-empty-list`); these are scoped interaction observations, not a trust verdict. Independent merged-wave review remains parent-owned.

## Compact chrome, wave 9 track C — 2026-11-16

Source: the commit carrying this section, based on `aa781eb`. Hardware class: Linux x86-64 desktop, 32 GB RAM. Toolbar construction, overlay styling and minimap keyboard state only; no core, renderer algorithm, connection-card, dependency, setting or budget change.

Build and **613 tests across 36 files pass**, with **162,538 expectations**. Two new tests cover unified accessible panel destinations, Members toggling, opener focus, conditional Workspace scope, focus recovery after leaving scope and the live filter badge. The compiled-renderer orientation regression additionally checks expanded/collapsed minimap tab order. Existing trail lifetime, keyboard travel, camera and filter contracts continue to pass. Full gates pass all six lanes, including secrets, attribution, privacy, frozen-lock/supply-chain, runtime licenses and size.

`main.js`: **369,299 raw / 123,799 gzip bytes**, versus **369,576 / 123,859** at the base: **−277 raw / −60 gzip** (gzip level 9). Limits remain **375,000 / 126,000**. Shared type/spacing variables are consumed with host-compatible fallbacks; this track does not redefine them.

Exact commands, each under `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s`:

- `./scripts/run.sh build`
- `./scripts/run.sh test --timeout 10000`
- `./scripts/run.sh gates`

Ignored receipts and paired plugin assets: `.workspace/wave9-c/`. Native capture **not run**: the pre-capture `free -g` check reported **7 GB available**, below the required 8 GB. The schema-validated `.workspace/wave9-c/steps-chrome.json` contains 26 bounded harness steps covering 1100 px overview, focus, expanded/folded minimap and active panel, plus 360 px and 320 px panes; the harness captures both themes per screenshot. Use the same recipe and synthetic vault with `plugin-before` and `plugin-after`. Narrow browser panes are not native mobile acceptance; coarse-pointer, visual and screen-reader acceptance remain pending. Independent review and the combined visual pass belong to the merged wave before shipping.

## Merged wave 8 review fixes — 2026-11-16

Source: the commit carrying this section, based on `99ec508`. Hardware class: Linux x86-64 desktop, 32 GB RAM. This is local deterministic evidence, not a release or native-rendering acceptance claim.

Eleven new regression tests failed against unchanged source (**600 pass / 11 fail**) and pass with the fixes (**611 pass / 0 fail**, 162,489 expectations across 36 files). Coverage includes project/layout rejection and timeout recovery without losing Notes intent; explicit Group overview selection during fallback; disjoint help IDs; one loading percentage; singular pending-change copy; native toggle labels and help-name activation; the JSON builder icon/name; pooled anchored-label descriptions for equal captions; one loading host declaration; accessible reset names without titles; and compact fallback help markup/panel-exclusion CSS. Existing information-button focus identity is retained across status updates.

Build passes. Secrets, attribution (current/index files and all reachable commit metadata), privacy, frozen-lock/supply-chain and runtime-license lanes pass. Full gates fail **only on bundle size**, as expected before the owner's cap decision. No cap was raised. `main.js` is **369,576 raw / 123,859 gzip bytes**, compared with **369,252 / 123,633** at the base: **+324 raw / +226 gzip**. Overage is **4,576 raw / 1,859 gzip** against **365,000 / 122,000**. SHA-256: `8b2273249d79994e6b88759ca15ffe96968108ffd4a5c01a255afe11dcb3562f`.

Exact commands, run separately:

- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`
- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh test --timeout 10000`
- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh gates`

Ignored receipts: `.workspace/evidence/wave8-fixes/{baseline-gates,regressions-before,build,tests-after,gates}.log`, plus `.workspace/evidence/bundle-size.json`. Native harness **not run**: `free -g` reported only 6–7 GB available at verification, below the owner's 8 GB launch floor. Panel bounds have deterministic CSS coverage only; no screenshot or rendered light/dark acceptance is claimed.

**Deferred finding 3:** preview handoff remains unchanged. Preview/final construction shares one stage, failed constructor cleanup can remove stage canvases, and `DetailRenderer.create()` resolves after scheduling rather than completing a frame. Retaining a live preview until the final first frame while cancelling an in-flight preview safely would require coordinated stage ownership, cancellation and readiness changes. The brief explicitly permits deferral rather than a risky lifecycle expansion. The blank flash and initialization wait remain known gaps. Independent post-fix review belongs to the owning session.

## Compact graph tools, wave 8 track P — 2026-11-16

Source: the commit carrying this section, based on `5bec048`. Hardware class: Linux x86-64 desktop, disposable browser-native Obsidian harness, Canvas fallback (WebGL unavailable). The synthetic fixture has 1,200 ordinary notes, 300 relationship notes and 48 groups; the captured projection shows 1,200 notes and 1,593 edges. This verifies panel presentation, not canvas label changes, Electron fidelity, physical GPU behavior or mobile/touch acceptance.

Final build: **361,772 raw / 121,376 gzip bytes**, versus **360,925 / 120,920** at the baseline: **+847 raw / +456 gzip**. Unchanged caps: **365,000 / 122,000**. Bundle SHA-256: `133ad469cebaac2e3c1f0e3678e83978d79c76f403b07a560066c7f2ce4ada58`. Build, all six ordered gates and **585 tests** pass (155,992 expectations); tests include help dismissal/text-only content, conditional Ranked controls and 100 summary updates preserving focused body drafts and scroll.

Exact commands, run separately from the track worktree:

- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`
- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh test --timeout 10000`
- `GATE_COMMIT_RANGE=5bec048..HEAD flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh gates`

Native harness commands below are relative to the owning evidence checkout; its `run.sh` owns the harness lock. Plugin snapshots contain each build's JS, manifest, styles and synthetic settings. Final capture's installed JS hash matches the hash above.

- `.workspace/visual-qa/run.sh wave8-p-before-small plugin-wave8-p-before vault-wave8-p steps-wave8-p-before.json 10`
- `.workspace/visual-qa/run.sh wave8-p-final plugin-wave8-p-after vault-wave8-p steps-wave8-p-after.json 10`

Receipts are `.workspace/visual-qa/runs/wave8-p-{before-small,final}.json`; both complete with teardown. Before screenshots `wave8-p-before-small.step-10-before-both-appearance.{light,dark}.png` and `wave8-p-before-small.step-13-before-both-layout.{light,dark}.png`, and final screenshots `wave8-p-final.step-10-after-both-appearance.{light,dark}.png`, `wave8-p-final.step-13-after-both-layout.{light,dark}.png`, `wave8-p-final.step-16-after-both-filters.{light,dark}.png`, and `wave8-p-final.step-22-after-both-help.{light,dark}.png` are in that directory and were visually inspected. Final panels have aligned horizontal units, centered slider thumbs, unwrapped preset buttons, compact suggestions, shared chevrons and readable top-layer help in both themes. Each captured Appearance/Layout/Filters body has 314 px client width and scroll width; no horizontal overflow at this desktop size. The focus probe observes the help popover open. No console/page errors were recorded. Graph information was captured but is not claimed as reviewed here; its redesign belongs to another track.

Known scope: Anchored/Ranked settings and UI are integrated here, but canvas implementation belongs to the label track. Independent senior review is scheduled over the merged wave before shipping. These receipts do not establish release readiness or broad performance acceptance.

## Anchored canvas names — 2026-11-16

Source: the commit carrying this section, based on `5bec048`. Linux x86-64 desktop-class host, 32 GB RAM, 11 GB available at launch. The browser-native Obsidian harness used a disposable synthetic vault with 16,000 notes and 52,511 edges, explicitly admitted SwiftShader WebGL2, and a 1210 × 700 renderer. This is not desktop Electron or hardware-GPU acceptance.

Default `visuals.labelStyle` is `anchored`; `ranked` retains the existing atlas, graduated sizing and fades. The shared WebGL/Canvas anchored overlay uses uniform opaque text, dot rings and eight-pixel leaders. Actual-screen collision checks include each plate, ring and leader; placements retain their side with a four-pixel entry-clearance margin. The existing ranked LOD/grid placements provide the overview candidates, bounded by the existing label settings. Offscreen placements are culled before the collision pass's 256-candidate cap; at most 64 DOM labels are pooled. No new spatial index, per-frame graph scan, sort or text measurement is added.

Verification: `./scripts/run.sh build`; `./scripts/run.sh test --timeout 10000` (588 pass, zero failures, 162,213 assertions across 35 files); `./scripts/run.sh gates`; `git diff --check`. Each Bun command was wrapped separately with `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s`; `scripts/run.sh` owns the separate local-verification lock. Secrets, attribution, privacy, frozen-lock/supply-chain and runtime-license checks passed. Full gates stopped at the unchanged gzip cap: **364,509 raw / 122,249 gzip bytes**, compared with base **360,925 / 120,920**, a delta of **+3,584 / +1,329**. Raw is within 365,000; gzip exceeds 122,000 by **249 bytes**. The cap was not raised. Built bundle SHA-256: `01c9302347318cb450bdd898503bf77fb820cb3cc9e42e32e160f989313519d0`. Independent merged-wave review remains pending.

Native command, from the integration workspace: `bash .workspace/visual-qa/run.sh wave8-l-viewport plugin-wave8-l vault-16k steps-wave8-l-viewport.json 10`. The harness owns `flock -w 1800 /tmp/graph-ng-harness.lock`; it was not acquired recursively. Receipt: `.workspace/visual-qa/runs/wave8-l-viewport.json` (exit 0, 182.360 s, no page/console errors). Earlier `wave8-l` failed during renderer setup/admission; `wave8-l2` reached verified WebGL but its 120-frame sample exceeded the 20-second assertion deadline. Neither failed run is acceptance evidence. `wave8-l-final` completed but exposed close-viewport starvation from a global top-256 cutoff; the corrected shared-LOD selection and this replacement run supersede that implementation.

All seven screenshot pairs were visually inspected in both themes. Under `.workspace/visual-qa/runs/`, use prefix `wave8-l-viewport.` and suffix `.dark.png` or `.light.png` with these stems:

| View | Ranked | Anchored |
| --- | --- | --- |
| Overview | `step-19-ranked-overview` | `step-26-anchored-overview` |
| Mid | `step-21-ranked-mid` | `step-28-anchored-mid` |
| Close | `step-23-ranked-close` | `step-30-anchored-close` |
| Focused | — | `step-33-anchored-focus` |

Node size was 0.16, label size 13, label density 3; camera ratios were 0.4434134 / 0.1773654 / 0.0665120. The Saved views panel remained open and was excluded from label placement. Visible names at overview / mid / close were **Ranked 8 / 18 / 7**, **Anchored 25 / 45 / 27**, with eight names in the anchored focused capture. Ranked counts apply the glyph shader's opacity cutoff and whole-annotation viewport bounds, excluding panel-covered rectangles; they are not total atlas placements (37 / 89 / 249). Anchored uses the same LOD candidates without the rank-opacity cutoff, so more names remain crisp. All observed anchored text opacity was 1, no anchored plate intersections were detected, and the pool reached 45 elements. Canvas `aria-label` was absent, hidden keyboard help remained linked by `aria-describedby`, and the container title was empty. Production-bundle synthetic tests cover the pooled overlay, tier toggles, style-switch cleanup and accessible help; shared dispatch covers Canvas parity, not a separate native Canvas capture.

Twenty-four ordered samples per style forced synchronous layout after draw; times below are CPU elapsed time, not GPU time:

| Style | Draw + layout median / p95 / max | Overlay + layout median / p95 |
| --- | --- | --- |
| Ranked | 0.7 / 17.1 / 41.1 ms | 0.3 / 8.5 ms |
| Anchored | 1.3 / 2.5 / 3.0 ms | 0.9 / 1.7 ms |

Anchored added about 0.6 ms median draw CPU cost (0.6 ms overlay). Small, ordered samples do not establish better tail latency. Software-rendered rAF intervals were 594.7 / 771.4 ms ranked and 517.2 / 670.3 ms anchored (median / p95); do not infer hardware FPS from these captures.

Known limits: the inherited ranked LOD/grid placements and settings budgets are not viewport-complete naming. The rejected top-256-global implementation is gone; a production regression places a visible candidate after 300 offscreen candidates and verifies LOD cache invalidation. Hover/focus can name another note. Collision checks protect named annotations and UI, not every unlabelled dot or edge; dense layouts remain dense. These screenshots do not establish perfect continuity while panning, ranked pixel equivalence across all states, screen-reader behavior in every host, native Canvas performance or physical-GPU acceptance.

## Loading and requested presentation — 2026-11-16

Source: the Track R commit carrying this section, based on `5bec048`. Linux x86-64 desktop class; synthetic fixtures only. No real-vault or physical-GPU acceptance claim.

Commands, each under `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s`: `./scripts/run.sh gates:fast`, `./scripts/run.sh build`, `./scripts/run.sh test --timeout 10000`, and `./scripts/run.sh gates`. The safety lanes and build pass; **591 tests pass**. The unchanged bundle ceilings are **365,000 raw / 122,000 gzip bytes**; this branch measures **365,019 / 122,006**, respectively **19 / 6 bytes over**. Against the base bundle (**360,925 / 120,920**) the delta is **+4,094 / +1,086**. Full-gate acceptance is therefore blocked on bundle size; no cap was raised.

Regressions cover actual cold/warm worker progress and iteration limits, omission of seed coordinates, latest-frame coalescing and recycling, obsolete/failed renderer cleanup, returning to Notes after a disposed preview, external-aggregate readiness, count-row navigation without a mode save, filter-warning direction, and a synthetic 16,001-note software-limit refusal retaining Notes intent. Raw receipts stay local under `.workspace/visual-qa/{safety,build,tests,gates}.log`; the bundle receipt is `.workspace/evidence/bundle-size.json`. Merged independent review and full-gate acceptance remain required before shipping.

Native command: `bash .workspace/visual-qa/run.sh`, which checks at least 8 GiB available and uses `flock -w 1800 /tmp/graph-ng-harness.lock` around the bounded browser-native harness. All 18 steps and teardown passed; no console/page errors. The synthetic fixture directory's historical name does not describe its current size: the observed projection held **49,500 notes / 3,308 edges**, with **43,594 notes still awaiting properties**. With 300 layout steps and test-only WebGL admission, a live label-free preview appeared after **2.793 s** at step 15; layout completed in **24.674 s**. These are one-run observations while host metadata was incomplete, not a large-vault performance acceptance result.

Visually inspected `.workspace/visual-qa/loading.step-05-loading.{light,dark}.png` (25% / 41% progress, Lines configured, no note labels) and `loading.step-17-fallback.{light,dark}.png` (explicit software-budget reason and Filters action). The forced 2,000-note software limit retained the requested Notes state; the Filters action opened Filters. The final renderer had already fallen back before that forced software check, so this run does **not** prove final GPU Notes admission. Track P's pending header integration is absent here: provisional header counts remain visible, and the long bottom fallback chip clips under the panel. The first element-screenshot attempt timed out waiting for stability; the successful rerun used the harness's full-page capture. No settings defaults, solver equations or renderer budgets changed.

## Centering — 2026-11-16

Question: with the room force values (Spread 23.64, Pull to center 0.5, Strong gravity off, Step slowdown 3.607, Approximation 0.369, 100 steps), why do disconnected parts not gather around the middle? Answer: the settings, not the solver.

Command: `N=16000 ./scripts/run.sh bench:centering` (add `ORACLE=owner` for the graphology reference), source 73c03e2 plus this change, Bun 1.3.14, desktop x86-64 class. Synthetic graph: 16,000 notes, 16,380 links; half in one part (random tree plus 0.6 extra links per note), 30% in parts of 2 to 6 notes, 20% isolated. The real `LayoutSolver`, fresh start. Metrics around the node centroid: **isolated / main radius** is the median isolated-note radius over the main part's median radius; **parts spread** is the RMS radius of the other parts' centroids over the same median; **main part share** is the main part's median radius over the layout radius (how much of a fitted view the main part fills); **last step** is the final RMS step over the layout radius.

| Values | Isolated / main radius | Parts spread | Main part share | Last step | Layout radius |
| --- | --- | --- | --- | --- | --- |
| Room values, 100 steps | 4.82 | 4.56 | 0.195 | 0.44% | 11,100 |
| graphology-layout-forceatlas2 0.10.1 reference, room values | 4.84 | 4.58 | 0.194 | n/a | n/a |
| Engine defaults (2 / 1 / normal, 100 steps) | 8.58 | 8.06 | 0.111 | 0.35% | 6,090 |
| Room values, 500 steps | 12.0 | 11.3 | 0.080 | 0.07% | 29,900 |
| Room values, Pull to center 5 | 4.80 | 4.54 | 0.197 | 0.44% | 10,800 |
| Room values, Approximation 1.2 | 4.82 | 4.56 | 0.195 | 0.45% | 11,100 |
| Room values, Step slowdown 1 | 8.78 | 8.11 | 0.105 | 0.36% | 22,100 |
| Room values, Strong gravity, Pull to center 0.15 | 1.95 | 1.93 | 0.480 | 0.27% | 2,780 |
| Room values, Strong gravity, Pull to center 0.5 | 1.70 | 1.66 | 0.565 | 0.32% | 1,520 |
| Recommended (10 / 0.124 strong / 1, 150 steps) | 1.95 | 1.94 | 0.480 | 0.11% | 1,990 |

Reading: normal gravity has the same strength at any distance while the whole graph's repulsion pushes out, so every note outside the main part sits on a far ring. More steps widen the ring (the layout radius keeps growing, 11,100 to 29,900) instead of settling; a 10× stronger normal pull, a finer approximation or a faster step do not change it. Strong gravity grows with distance and brings the other parts to about twice the main part's radius. The node centroid stays within 0.3% of the layout radius of the origin, gravity points at the origin, and the engine matches the graphology reference within 0.5% on every metric (also at 4,000 notes, and in the `centering` regression test at 2,000 notes within 10%). There is no centering, gravity or Barnes-Hut defect.

Change: Layout shows **Pull in disconnected notes** when Strong gravity is off, Pull to center is above 0, and at least 20 notes (and 2%) sit outside the largest connected part. It fills the draft with Strong gravity on and the recommended Pull to center for the graph size and keeps every other value; nothing is saved until Apply and recompute. Suggested for this graph names the same fix.

## Cache, haze and performance review corrections — 2026-11-15

Source: the review-fix commit carrying this section, against `001e8ff..201266f`. Hardware class: Linux x86-64, CPU-only deterministic fixtures; no native application, physical GPU, visual or latency claim.

Four regressions fail on `201266f` and pass with the fixes: changed identity rules reassigning the same ID strings to different notes, a worker-rejected loaded generation suppressing its replacement write, Fit all counting an absolute-ID sample instead of currently connected notes, and WebGL hit-testing omitted context lines. The layout-cache tests exercise the real worker/view/store over synthetic memory storage; renderer tests execute the built production bundle with synthetic DOM/driver seams. Filter/type visibility, small-set fitting, hovered/focus/path edge exemptions and unchanged Canvas picking are included.

Verification commands, each run separately:

- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`
- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh test --timeout 10000`
- `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh gates`

Result: **548 tests pass**, full six-lane gates pass; **351,761 raw / 117,985 gzip bytes**, under the unchanged **355,000 / 118,000** caps. Raw local receipts: `.workspace/visual-qa/runs/review-{build,tests,gates}.log`, original-source failures in `review-original-regressions.log`; bundle receipt in `.workspace/evidence/bundle-size.json`. Native/performance acceptance remains pending. Deleted/renamed identities still cold-start by policy; a hub edit can still exceed the documented 50% movable threshold, and the non-Barnes-Hut pairwise path still calculates unused fixed-node forces. These limitations are not changed by the review.

## Layout cache reuse pass — 2026-11-15

Reopening, reloading and small edits now reuse the saved layout in the cases that previously recomputed it. Against `ff6d44f`, an Obsidian reload while links are still resolving drops from a full cold layout (**1.74 s / 5.99 s** to the stable layout at 16,309 / 61,000 notes) to **0.43 s / 0.58 s**; a grouping change from **1.68 s / 6.57 s** to **0.32 s / 0.50 s**; a one-link edit from **0.75 s / 2.20 s** to **0.46 s / 0.85 s**. Cold layout itself is unchanged.

### Why hits were missed

1. **Unverified builds ignored the saved layout.** Until every note has public metadata and the link resolver has finished (normal right after an app reload), the build is provisional. The worker only used saved positions for verified builds, so it ran a full cold layout, blocking the worker queue, and the verified build that followed found the exact generation. Unverified builds now start from saved positions; they still never persist, quarantine or overwrite the complete generation.
2. **Grouping changes discarded positions.** Declared groups, display columns and the group level are part of the declaration digest and generation key, so the held layout was dropped and the next build was cold although the drawn topology was unchanged. The worker now keeps a held layout as a warm-start hint whenever source, producer, layout settings, stream cadence and format still match. Exact hits still require the same declaration digest, group level and key, and a verified build drops a hint that names a note no longer in the view.
3. **Warm starts paid nearly a third of a cold layout.** Relaxation walked the Barnes-Hut tree for every note on each of the 30 relax iterations, although fixed notes never read their force. It now walks it only for movable notes; forces for those notes are bit-identical (unit test).
4. **Exact hits were never re-persisted.** A write is skipped when the view is superseded during the 1.5–6 s layout or fails. The next build was then an in-memory exact hit, which never wrote, so the next reload was cold. Writes now happen whenever the store has not committed or loaded the current key. A failed write no longer turns a drawn graph into a "Projection refresh failed" error; it is recorded in `data-cache-error`.
5. **Smaller costs.** Each refresh re-read and re-hashed the whole generation even when the worker held it; each exact hit re-contracted the group summary; each write hashed every chunk twice; and a layout-settings change renamed the old generation to a retained `.corrupt-` artifact in the plugin folder. All four are removed.

Not misses: appearance settings, colours, `hierarchy`, `interest`, `groupContext` and edge `highlight` were already excluded from layout identity and stay exact hits. Volatile data does not enter the key: paths and producer links are sorted, object keys are canonicalized, and no timestamps are hashed. At these sizes a generation is about 1–4 MB, far below the 256 MiB `maxGenerationBytes`, so byte limits do not evict it. `cachedDeclarations` (default 1) keeps one generation for the current declaration; switching back to an older declaration recomputes.

**Known miss, unchanged:** deleting or renaming a note recomputes from scratch, because ADR-0004 refuses a generation that names an identity absent from the live view. Relaxing that rule is a boundary change that needs independent review; a test pins the current behaviour. After a physics **Apply**, the next open recomputes with the new settings; the applied preview is not persisted (ADR-0004 0.5.2).

### Method

`tests/cache-benchmark.test.ts` (`flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh bench:cache`) drives the real layout worker and `BinaryLayoutStore` over an in-memory adapter in the same request order as the view refresh: configure, read the saved generation unless the worker holds it, ingest 2,000-row batches, project, detail, layout, then encode and write after a computed verified layout. **Stable** is the time from configure to the final layout result, the positions the first settled frame draws. It excludes Obsidian metadata IO, physical disk, renderer upload (about 60 ms, startup table below) and paint. One run per scenario on the startup fixture (16,309 / 46,400 and 61,000 / 100,000), default layout (100 iterations, 30 relax), same i9-12900K / Bun 1.3.14 host. Baseline numbers use the same harness on `ff6d44f` runtime source. The receipt is `.workspace/evidence/performance-cache.json`. Behaviour is covered by `tests/layout-cache.test.ts`, which runs the real view refresh, worker and store across a simulated reload.

| Scenario | 16k before | 16k after | 61k before | 61k after | After: layout result |
| --- | ---: | ---: | ---: | ---: | --- |
| Cold start, empty cache | 1,787 ms | 1,688 ms | 6,114 ms | 5,593 ms | Computed, 100 iterations |
| Reopen in the same session (exact) | 394 ms | 318 ms | 579 ms | 400 ms | Reused, no disk read |
| Reload, metadata complete (exact) | 479 ms | 406 ms | 710 ms | 586 ms | Reused from disk |
| Reload, links still resolving | 1,739 ms | 431 ms | 5,985 ms | 575 ms | Reused, not persisted |
| …then the verified build (exact) | 510 ms | 358 ms | 713 ms | 530 ms | Reused, no disk read |
| One note gains one link (warm) | 750 ms | 455 ms | 2,203 ms | 850 ms | Adjusted, 30 relax iterations |
| Group-level change | 1,678 ms | 324 ms | 6,566 ms | 495 ms | Reused, persisted |

Worker layout time inside those totals: warm edit **399 → 119 ms** (16k) and **1,678 → 387 ms** (61k); exact hits ≤1 ms. The rest of an exact hit is projection, the generation key (about 115 ms SHA-256 over the canonical declared facts at either size), detail transfer and, after a reload, the 24–41 ms chunk read and checksum. Generation writes take 10–28 ms here. Single runs vary with JIT and GC; cold-start differences are noise, not a claimed gain.

**Visible result.** Graph information's **Layout** row reads **Reused saved layout**, **Reused saved layout, adjusted in N s** (warm start) or **Computed layout in N s**. A duration under 0.1 s is shown as 0.1 s, never 0.0 s.

Bundle: **350,786 raw / 117,596 gzip bytes** versus **350,170 / 117,369** at `ff6d44f` (+616 / +227), leaving **4,214 / 404** bytes under the 355,000 / 118,000 caps.

## Bounded CPU performance pass — 2026-11-15

The main win is less work on hub selection, not a faster layout algorithm. Against `001e8ff00f50480194166e680c60cd1fa7c053f4`, full-scene compiled-renderer hub selection drops **14.13 → 5.34 ms** at 16k nodes and **12.16 → 7.17 ms** at 61k. These are synthetic JavaScript CPU measurements, not native interaction latency or GPU frame rates. No layout default, traversal budget, visibility rule or Canvas limit changes.

### Method and reproduction

Measured on a Linux x86-64 desktop CPU (Intel Core i9-12900K, 24 logical CPUs), Bun 1.3.14. No browser, real vault, shader compilation, GPU rasterization or host metadata IO was used. `tests/performance-benchmark.test.ts` runs the production solver in a real worker and the compiled production renderer against synthetic DOM/Canvas/WebGL command drivers. Canvas retains its 2,000-visible-node / 10,000-visible-edge limits and shows the hub neighbourhood; full-prefixed metrics show the entire projection through the fake WebGL driver. Text metrics are deterministic approximations. First-frame values include renderer setup and submission, not pixels becoming visible. Minimap measures density-bin construction, not raster upload.

The seeded fixtures contain 16,000 nodes / 55,000 edges, or 61,000 nodes / 100,000 edges including 44,552 relationship-note nodes. They approximate a heavy-tailed graph: degree-591 hub, 84 ordinary nodes above degree 100, ordinary-node degree p50/p90/p99 = 1/13/69, 13% ordinary isolates, 93 groups (largest 1,468, median 97), cross-group relationship endpoints and hierarchy depth at most three. The requested p90 was 11; the fixture achieves 13, not an exact reconstruction. All paths, names and declarations are synthetic. A separate startup fixture uses 16,309 / 46,400.

Run from the checkout root after a frozen, script-disabled install. `./scripts/run.sh` retains the shared containment lock; the outer lock is distinct. Each command is one invocation:

| Purpose | Command |
| --- | --- |
| Build | `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build` |
| CPU receipt | `PERF_LABEL=current flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh bench:performance` |
| Startup receipt | `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh bench:startup` |
| Full unit suite | `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh test --timeout 10000` |
| Gates | `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh gates` |

Receipts remain ignored at `.workspace/evidence/performance-before.json`, `performance-after.json` and `performance-startup.json`. Before/after receipts record their compiled bundle hash; the measured candidate was uncommitted on the baseline, so its recorded HEAD alone does not identify the runtime. Baseline bundle SHA-256: `2e475cc00e430482e3db5839ec83d43e07813877d6bb4833271294e04bf46e15`. Candidate bundle SHA-256: `33b15de9d34a8fd8360c4d431c9b6468b8e268cf42af888890370f482542885e`. To reproduce the baseline, use these benchmark/test-support files with baseline runtime source and rebuild; benchmark files were not present in that baseline commit.

Packing, decoding, projection and coverage construction use five samples after one warmup; other repeated computations use nine, frame submission uses 60. Tables use medians except rows marked single. Raw samples and empirical p95 remain in receipts; these small samples are not confidence intervals. Independent runs vary with JIT, GC and host load. Untouched operations are controls, not claimed optimization gains.

### Before / after CPU time

All values are milliseconds. Hub measurements explicitly select the degree-591 note.

| Operation | 16k before | 16k after | 61k before | 61k after |
| --- | ---: | ---: | ---: | ---: |
| Pack ingest | 28.924 | 24.561 | 27.176 | 24.930 |
| Decode ingest | 26.184 | 25.245 | 22.536 | 23.095 |
| Projection | 110.580 | 88.808 | 181.386 | 155.525 |
| Worker solver, single | 1208.943 | 1179.153 | 5354.270 | 5068.765 |
| Hub focus tiers | 2.386 | 2.120 | 3.658 | 2.978 |
| Hub groups + interest scoring | 0.376 | 0.281 | 0.263 | 0.372 |
| Hub label ranking, 240-candidate microbenchmark | 5.917 | 0.367 | 2.791 | 0.389 |
| Full-scene hub selection + draw submission | 14.131 | 5.339 | 12.155 | 7.174 |
| Bounded Canvas navigator selection/card | 2.559 | 2.474 | 2.147 | 2.322 |
| Only connections, reach 3 | 4.910 | 5.261 | 10.681 | 8.729 |
| Relationship coverage cold projection | 60.744 | 61.568 | 59.187 | 51.549 |
| Relationship coverage filter evaluation | 0.665 | 0.710 | 0.658 | 0.641 |
| Minimap density rebuild | 0.458 | 0.115 | 0.932 | 0.226 |
| Search cold, single | 5.001 | 4.135 | 20.314 | 13.735 |
| Search warm | 0.267 | 0.264 | 1.335 | 1.263 |
| Bounded Canvas first frame, single | 35.791 | 29.465 | 44.859 | 46.409 |
| Bounded Canvas hover frame | 1.558 | 1.156 | 1.256 | 0.855 |
| Bounded Canvas pan frame | 1.648 | 1.092 | 1.280 | 0.901 |
| Full-scene first-frame submission, single | 51.628 | 44.818 | 77.567 | 69.143 |
| Full-scene hover submission | 0.080 | 0.079 | 0.117 | 0.073 |
| Full-scene pan submission | 0.099 | 0.114 | 0.109 | 0.092 |
| Full-scene label-atlas build, single | 20.262 | 13.487 | 18.370 | 14.845 |

The solver is unchanged: both before/after position hashes match exactly, both stop at 100 iterations, and terminal RMS movement remains 22.54 / 17.59 layout units. Convergence checking is disabled by default, so these timings do **not** demonstrate convergence. Both reach-3 runs exhaust the unchanged 200,000-entry budget and report partial results (13,920 / 56,623 visible nodes); no incomplete frontier count is presented. Steady full-scene hover/pan performs zero buffer/texture uploads in both runs. Canvas command counts also match before/after.

### Changes and memory

1. Bucket focus labels by their existing tier, sorting/scoring only tiers with available slots. For hubs above 50 direct connections, omit secondary tiers before scoring and text measurement instead of filtering them immediately before radial placement. Preserve the existing tier, interest/degree and node-ID tie order, direct count, cap and six-label dense-hub policy. The 240-candidate microbenchmark is distinct from the renderer's default 2,048-candidate cap; full-scene selection exercises the latter.
2. Hoist Canvas base radius and camera-derived frame invariants outside per-node/per-edge loops. Saved and unsaved sizing previews, focus growth and final radii remain covered by a compiled-bundle regression.
3. Bin minimap coordinates with scalars rather than allocating a two-element tuple for every visible node. A tuple-based oracle verifies exact bins and boundaries.
4. Reuse already-canonicalized declared-key dictionaries when constructing groups, with independent copies of values and codes. Mutation/ownership tests prevent column or sibling-group aliasing. This avoids a redundant canonicalization/intern pass without changing projection validation.

Candidate bundle: **350,170 raw / 117,369 gzip bytes**, versus **349,917 / 117,207** at baseline: **+253 / +162 bytes**. This is small growth, not size-neutral. The unchanged **355,000 / 118,000** caps leave **4,830 raw / 631 gzip bytes** of headroom.

| Typed buffers, bytes (unchanged) | 16k | 61k |
| --- | ---: | ---: |
| Actual distinct projection buffers | 2,035,996 | 4,557,340 |
| Legacy `storageBytes` accounting | 1,576,004 | 3,376,004 |
| Packed ingest buffers | 6,152,908 | 6,190,904 |
| Renderer column buffers | 1,552,000 | 4,384,760 |
| Positions | 128,000 | 488,000 |

Renderer/core buffers overlap: do not sum these rows as independent allocations. Legacy accounting misses newer columns. Interaction heap observations after 200 Canvas frames were noisy: baseline post-GC deltas were −157,403 / +60,936 bytes; candidate −26,110 / −70,332,189 bytes. The large negative value reflects collection of earlier workload state, not a 70 MB optimization. Pre-GC candidate deltas were +665,612 / −70,132,186 bytes. This harness neither isolates all allocation traffic nor proves leak freedom; no retained-heap improvement is claimed. The minimap tuple removal and once-per-frame radius work are deterministic work-count changes rather than inferred GC wins.

### Cold startup and safest next option

Three repetitions of `bench:startup` use the actual `runLayoutStream` scheduler and worker messages, plus compiled-renderer setup. The following medians are **CPU-path lower bounds, not measured user-visible stable-layout latency**; host metadata/cache IO, cache hashing/decoding/validation, CSS layout, shader compilation and rasterization are excluded. “Stable” means positions freeze at the 100-iteration budget, not numerical convergence.

| Startup component | 16,309 / 46,400 | 61,000 / 100,000 |
| --- | ---: | ---: |
| Pack/decode ingest | 77.17 ms | 71.66 ms |
| Projection | 148.30 ms | 194.85 ms |
| Worker computation with streaming/yields | 1242.27 ms | 5483.57 ms |
| Worker round trip | 1251.12 ms | 5488.56 ms |
| Initial random-position snapshot received | 9.61 ms | 22.38 ms |
| Iteration-5 snapshot received | 105.26 ms | 366.19 ms |
| Iteration-95 snapshot received | 1191.11 ms | 5221.31 ms |
| Renderer setup/submission | 57.42 ms | 61.97 ms |
| Combined measured cold CPU path | **1513.02 ms** | **5816.13 ms** |
| Valid exact-cache identity comparison + coordinate copy only | 0.27 ms | 0.27 ms |
| Unchanged warm-layout preparation only | 3.12 ms | 8.97 ms |

Startup receipt predates the final dense-hub cutoff; it uses the same solver and does not select a hub. Component medians need not sum to the median total. Cache rows isolate operations after existing validity checks, not end-to-end warm-open timing.

**Safest proposal (followed up in the layout cache reuse pass above): verify and improve use of the existing validated cached-layout path first**, including evidence about cache-miss reasons. Exact compatible caches already return saved positions without solving; compatible non-exact caches use the existing identity-based warm start and changed-neighbour relaxation. Do not weaken source/declaration/layout/generation or ordered-identity checks. This is a proposal, not an implemented startup-default change.

Worker streaming already emits the initial positions and every five iterations (20 intermediate snapshots). The main view stores these snapshots but awaits completion before its normal ready/detail path; enabling worker streaming again would not fix perceived delay. Progressive detail display needs a separately reviewed renderer lifecycle/upload design. Turning convergence on by default requires threshold and layout-quality evidence first, since it changes numerical behaviour and these runs still move substantially at termination.

Remaining expensive work: cold layout; full-atlas candidate sorting/text work; cold relationship-coverage projection; the same-group O(n) focus scan; budget-limited reach-3 traversal; and Canvas scans over full indices despite a bounded visible mask. Actual native DOM/GPU latency, integrated/mobile hardware and visual acceptance remain unmeasured. Deterministic equivalence tests and local gates do not replace independent merge review or release acceptance.

## Hardware classes and scope

| Class | Evidence |
| --- | --- |
| Desktop discrete GPU | Measured: Intel i9-12900K, approximately 31 GiB RAM, NVIDIA RTX 4060 Ti (ANGLE), Linux. Bun 1.3.14; native app/installer 1.13.7; browser Chrome 151.0.7922.34. |
| Desktop software GL | Measured: SwiftShader on the same desktop. Slice 3 adds bounded small Canvas detail; large views retain group/member/carrier fallback. No individual-node GPU graph acceptance. |
| Laptop/integrated GPU | Not measured. Desktop results cannot substitute for this class. |
| Mobile | Not measured. No real-device performance/support claim. |

## Reproduction commands

All local Bun commands must run under `flock /tmp/openclast-local-verification.lock build-contained --`. `./scripts/run.sh` applies this exact prefix. The original baseline runs used the project-specific lock `/tmp/obsidian-graph-ng-build.lock` with the same containment wrapper; new release verification standardizes on the shared lock. Commands below are exact new invocations; historical measurements retain their original flags/subsets.

| Purpose | Exact invocation |
| --- | --- |
| Install with no lifecycle execution | `./scripts/run.sh install --frozen-lockfile` |
| Build | `./scripts/run.sh build` |
| Synthetic small fixture | `./scripts/run.sh fixture --small` |
| Small hardware / software native | `./scripts/run.sh e2e` / `GRAPH_SOFTWARE=1 ./scripts/run.sh e2e` |
| Large semantic fixture and native | `./scripts/run.sh fixture` then `GRAPH_LARGE=1 ./scripts/run.sh e2e` |
| Large literal fixture and native | `./scripts/run.sh fixture --literal` then `GRAPH_LARGE=1 GRAPH_LITERAL=1 ./scripts/run.sh e2e` |
| Pure-core benchmark | `./scripts/run.sh bench` (`bun scripts/benchmark.ts`) |
| Actual-renderer browser benchmark | `./scripts/run.sh bench:browser` (`bun scripts/browser-benchmark.ts`); optional `CHROME_BIN` selects the local browser executable. |
| Bundle compression report | `./scripts/run.sh build` then `./scripts/run.sh gates` |

Generate fixtures only at the scripts' owned synthetic destinations. Regenerate the matching mode before each native lane. The original browser command selected a cached Chromium binary using `CHROME_BIN` and the browser script; never publish its expanded personal path.

## Metrics and sampling

The pure-core fixture uses seed 17, one full ForceAtlas2 layout per mode, 100 iterations, Barnes–Hut theta 1.2; filters/colors use 20 repetitions. Column bytes exclude string dictionaries, object rows, contribution lists and renderer allocations. Position bytes are only coordinate storage. RSS/heap of sequential fixture construction is not isolated plugin/GPU memory. Bun layout time is not Electron-worker time.

Current browser sampling uses the actual core/worker/direct WebGL2 renderer at 1280×800, DPR 1, configured label density/size threshold, three seconds of scripted pan/zoom and five discarded warmup frames, **one repetition per mode**. Camera draws retain typed arrays and GPU buffers; palette changes have separate assertions. Heap is retained main-realm JavaScript after forced GC, not GPU/native/worker memory. Historical slice-1/2 measurements below used Sigma's public partial refresh, not the invalidated every-frame-rebuild baseline. Dense literal overview readability is not captured by FPS.

Native cold-open begins after metadata readiness; full invocation includes metadata indexing/startup. Cached view reopen differs from full app restart + cache restore. Incremental settle includes the configured 5,000 ms debounce. Native rAF sampling returned no callbacks: native FPS is unavailable, not zero and not accepted. Report p95 frame/load long task separately from steady-state FPS; load tasks target at most 50 ms; see the latest slice-specific evidence rather than inferring acceptance from historical misses.

## Recorded slice-1 numbers

| Invocation / subset | Observed result and limitation |
| --- | --- |
| `bun test tests/core.test.ts tests/adapter.test.ts` | Historical final subset: 28 pass, 0 fail, 115 assertions; 560 ms. New gate tests are additional, not retroactively counted. |
| `bun run e2e` (small hardware, final nine-test suite) | 9/9; 2,000 notes → 600 nodes / 1,400 edges. Cold 356 ms, worker 81 ms, cached view reopen 33 ms, full restart/cache restore 3,148 ms. Spec 24.4 s; invocation 26 s. |
| `GRAPH_SOFTWARE=1 bun run e2e` (small, final nine-test suite) | 9/9; SwiftShader fallback. Cold 358 ms, worker 82 ms, cached reopen 139 ms, restart 3,074 ms. Spec 24.8 s; invocation 26 s. |
| `GRAPH_LARGE=1 bun run e2e` (earlier four-test suite) | 4/4; 60,600 notes → 16,000 nodes / 44,600 edges. Cold 3,247 ms, worker 2,708 ms, cached reopen 238 ms; full invocation approximately 3 m 02 s. Predates final fixes/nine-test suite; not current large acceptance. |
| `GRAPH_LARGE=1 GRAPH_LITERAL=1 bun run e2e` | Blocked before tests: metadata indexing exceeded explicit 180-second before-hook budget. No literal native test acceptance. |
| Final small incremental edit | 5,215 ms hardware / 5,114 ms software including 5,000 ms debounce; 591/601 positions bit-identical. Persisted key-miss restart retains all 600 old positions and adds one finite node. |
| Synthetic aggregate file in final native suite | 16,000 groups / 44,600 pairs, **not** a 60,600-note vault: first synchronous group page 2.5 ms; file load/validation/first page 104 ms hardware / 97 ms software. Canvas six groups, lists 25 rows; not all-group rendering. |

Pre-review pure-core baseline (not rerun after fixes):

| Mode | Nodes / edges | Build | Contract groups | Filter+color p95 | Columns / positions | FA2 in Bun |
| --- | --- | --- | --- | --- | --- | --- |
| Semantic | 16,000 / 44,600 | 90.56 ms | 21.93 ms | 0.496 ms | 1,326,404 / 128,000 bytes | 20,436.93 ms |
| Literal | 60,600 / 89,200 | 140.06 ms | 45.85 ms | 1.518 ms | 3,110,404 / 484,800 bytes | 89,689.95 ms |

Post-review browser renderer run (one repetition, zero page errors; predates final group-label-only paint and extension-rename regression changes):

| Mode | FPS / p95 frame | Worker | First view | Retained main JS | p95 load long task |
| --- | --- | --- | --- | --- | --- |
| Semantic, 16,000 / 44,600 | 60.00 / 16.8 ms | 2,662.7 ms | 3,243.1 ms | 25.01 MiB | 267 ms |
| Literal, 60,600 / 89,200 | 60.00 / 16.7 ms | 12,616.8 ms | 13,498.9 ms | 66.42 MiB | 501 ms |

Baseline/current bundle: **628,393 bytes raw**, **102,744 bytes gzip (level 9)**, **73,820 bytes Brotli** for `main.js`; SHA-256 `77ad060cfbca36b62c7b03f09d2dc8a21154abc59c2a15ace8459ffcd05ba725`. Rebuilt during local release-readiness verification without runtime source changes from `041e1382`; compression/hash came from `bun run gates` after `bun run build`. These are reports, not hard thresholds. A steady 60 FPS does not fix main-thread parse/projection/buffer tasks, prove a usable hairball, or establish native/mobile/integrated-GPU/one-million-node acceptance.

## Local release-readiness recheck — 2026-11-10

No runtime source changes from `041e1382`. The existing dependency directory was preserved in ignored storage and a **fresh** install used `flock /tmp/openclast-local-verification.lock build-contained -- bun install --frozen-lockfile --ignore-scripts`: 501 packages installed, no lifecycle execution. On that install, the same prefix plus `bun run build`, `bun run test`, and `bun run gates` passed: **35 tests / 3 explicit files / 151 assertions**, six full gate lanes, six MIT runtime packages and four exact inert dev install-hook exceptions. The subset is core, adapter and gate regressions; no new large-scale/matrix acceptance is implied.

`./scripts/run-native-smoke.sh` then regenerated the synthetic small fixture, checked the frozen scripts-disabled install, built, and ran the existing nine native tests: **9/9 passed**, Obsidian/installer 1.13.7, 24.3-second spec / 26-second invocation. Cold open 352 ms, worker 83 ms, offline cached reopen 28 ms; hardware detail mode was reached. All six newly captured hardware screenshots were opened and visually inspected, including groups, nodes, carrier navigation, duplicate quarantine and paged aggregates. This proves esbuild's optional platform binary and the native test toolchain work without invoking installers on this desktop; it does not establish another OS/GPU/version class.

## Slice 2 worker pipeline — 2026-11-10

Source: `feat/slice2-worker-pipeline` from `9b8cc07`; the receipts below distinguish initial measured source from final verification. All commands use `flock --exclusive --wait 2400 /tmp/openclast-local-verification.lock build-contained --`. No remote/native-large acceptance is implied.

### Initial before/after browser comparison

Exact invocation (home directory left symbolic): `CHROME_BIN="$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome" flock --exclusive --wait 2400 /tmp/openclast-local-verification.lock build-contained -- bun run bench:browser`. One repetition each, 60,600 synthetic notes, same discrete GPU/Chrome/viewport class above. Before receipt is `slice2-before.json`; initial after receipt is `slice2-after.json`, both under ignored `.workspace/evidence/`. This initial after-run predates the final UTF-8 allocation optimization and explicit-detail GPU deferral.

| Metric | Semantic: 16,000 nodes / 44,600 edges | Literal: 60,600 nodes / 89,200 edges |
| --- | --- | --- |
| Before p95 load long task | 374 ms | 502 ms |
| After group-open long tasks ≥50 ms | None observed | None observed |
| After first group | 602.5 ms | 820.4 ms |
| After cold layout ready | 3,492.3 ms | 15,310.2 ms |
| After explicit Sigma first-node view | 3,852.1 ms | 15,756.4 ms |
| After full binary warm + first Sigma node frame | 1,016.4 ms | 1,234.6 ms |
| Explicit detail / warm long-task maximum | 292 / 296 ms | 275 / 351 ms |
| Before retained main JS | 24.99 MiB | 66.12 MiB |
| After retained main JS | 32.44 MiB | 78.24 MiB |
| After pan/zoom FPS / p95 frame | 59.32 / 16.7 ms | 57.57 / 16.8 ms |

**Comparability limits:** after-run open timing starts after synthetic host-metadata JSON decode; the original before observer included fixture fetch/decode. After-run retains the fixture as host metadata, unlike before; the heap columns are not an isolated like-for-like plugin regression measurement. Heap excludes worker/GPU/native memory. Zero long-task entries means no observed tasks at the browser's ≥50 ms reporting threshold, not zero main-thread execution or a meaningful zero-sample p95. Detail-open is deliberately separate from default group-open. Warm means a new worker, binary memory-disk decoding, full live verification and the first Sigma node frame, not an app restart or physical-disk benchmark. Both modes reported exact warm hits, 20 transferred position snapshots, and zero page errors.

**Targets are not all met:** this initial run meets the group-open long-task threshold, but misses ≤500 ms cold first-group and ≤1 s full warm-node targets in both modes. Sigma's synchronous indexing/upload still causes >50 ms detail/warm tasks. Streaming FA2 batches reset integrator history; this is a different producer, not identical slice-1 layout quality. Opened screenshots show readable counted groups and a dense node hairball; frame rate does not establish overview usability.

Initial native verification used `DISPLAY=:0` plus the exact prefix above and `bash -c 'bun run fixture --small && bun run build && bun run e2e'`; software used `DISPLAY=:0 GRAPH_SOFTWARE=1` and `bash -c 'bun run fixture --small && bun run e2e'`. Both passed the nine-test suite on Obsidian/installer 1.13.7. Hardware: cold 413 ms, first group 33.4 ms, cached view reopen 120 ms, full restart/cache restore 3,035 ms. Its 161 ms initial-open task was traced to eager GPU context probing, which was then deferred until explicit detail interaction; those numbers do not prove the final deferral fix. Native tests also verify settings-only v2 JSON, binary restart reuse, persisted key-miss hints, pinned untouched positions, carrier/member navigation, duplicate exclusion and paged external aggregates. Native FPS remains unavailable. Final-source verification follows.

### Final source: startup targets reached, detail limitation retained

The final UTF-8 encoder avoids per-cell backing-buffer allocations; GPU probing is deferred until explicit detail interaction. Exact combined invocation, with the same Chrome path variable and `DISPLAY=:0`: the required lock/containment prefix plus `bash -c 'bun run build && bun run test && bun run bench:browser && bun run fixture --small && bun run e2e && bun run fixture --small && GRAPH_SOFTWARE=1 bun run e2e'`. Private immutable browser receipt: `.workspace/evidence/slice2-final-browser.json`; combined log: `slice2-final-verification.log`.

| Final browser metric | Semantic | Literal |
| --- | --- | --- |
| Cold first group | 415.5 ms | 457.6 ms |
| Group-open / cache-write tasks ≥50 ms | None observed / none observed | None observed / none observed |
| Provisional cached group frame | 25.4 ms | 55.4 ms |
| Full verified binary warm + first Sigma node frame | 799.0 ms | 970.4 ms |
| Cold layout / first Sigma node view | 2,665.0 / 3,658.4 ms | 13,276.5 / 14,445.9 ms |
| Explicit detail / warm long-task maximum | 353 / 257 ms | 360 / 244 ms |
| Retained main JS after GC | 33.16 MiB | 72.41 MiB |
| Pan/zoom FPS / p95 frame | 59.66 / 16.7 ms | 56.51 / 33.3 ms |

At one repetition per mode, cold groups meet ≤500 ms, full verified warm-node views meet ≤1 s, and default group-open has no observed ≥50 ms task. **This is not all-main-thread-work acceptance:** explicit Sigma detail/warm initialization still exceeds 50 ms, literal frame-tail regresses to 33.3 ms, and cold literal layout is slower than the before-run. Both modes return exact warm hits and 20 position snapshots, with no page errors. The timing-origin/heap/warm-memory-disk caveats above still apply. The final four browser screenshots were opened and read; dense node views remain hairballs rather than readable overviews.

`bun run test` passed **55 tests / 318 assertions / five explicit files**: core, adapter, gates, pipeline and declaration-v2. The original 35-test subset remains included. New coverage includes real worker RPC, actual buffer detachment, Unicode dictionaries, chunk resume, corruption quarantine, source/layout/producer/format refusal, migration hints, partial metadata preservation and the reported declaration-sharing compatibility classes; that helper is not full host scanner equivalence.

Final native `bun run e2e` and `GRAPH_SOFTWARE=1 bun run e2e`, each after `bun run fixture --small`, passed **9/9 each** on app/installer 1.13.7: 2,000 notes → 600 nodes / 1,400 edges. Hardware/software cold opens were **127/217 ms**, first groups **26.7/34.1 ms**, cached view reopen **140/120 ms**, full app restart/cache restore **3,429/2,816 ms**. Neither native first-open observer recorded a ≥50 ms task after GPU deferral. Hardware reached actual node rendering/clicks; software retained the group/member fallback. All final native screenshots were opened/read. Incremental edits retained 591/601 node positions and included the configured five-second debounce. Paged 16k-group/44.6k-pair external aggregates loaded in 254/154 ms, first synchronous pages 12.5/11.9 ms; this is not a large native vault test.

`flock --exclusive --wait 2400 /tmp/openclast-local-verification.lock build-contained -- bun run gates` passed all six lanes: content/privacy/attribution, frozen scripts-disabled lock/install policy and six permissive runtime packages. Bundle report: **672,011 raw / 112,326 gzip / 81,997 Brotli bytes**, SHA-256 `b9e661c162b9d57b822edad29cb30d1c29111e2cd4d3818a5f73d07605e3922e`. No dependency or lockfile change. This invocation does not imply hosted CI or release approval.

Uncovered: current large-vault native lanes, native FPS, physical-disk large warm timing, integrated GPU, mobile/N-2 app matrix, remote view authorization/nonreplicated host cache integration and million-note scale. Independent review remains a separate gate.

### Review-fix verification: current source

After independent SHIP-WITH-FIXES review, the same combined invocation was rerun with bounded worker recovery/processing-ack deadlines, cancellation-safe ingestion, copy-before-default settings quarantine, safe legacy prefixes, a recorded finite-limit upgrade, plugin-cache containment, generation-bound queued reads and capped derived-cache artifacts. It passed **64 tests / 397 assertions / the same five explicit files**, build and **9/9 native hardware + 9/9 native software**. Receipts: `.workspace/evidence/slice2-reviewed-browser.json`, `slice2-reviewed-native-hardware.json`, `slice2-reviewed-native-software.json`; exact combined output: `slice2-review-fixes-verification.log`. The earlier 415/458 ms cold / 799/970 ms warm run above is preserved, not silently replaced.

| Current browser result, one repetition per mode | Semantic | Literal |
| --- | --- | --- |
| Cold first groups | 391.3 ms | 459.9 ms |
| Cached provisional groups | 38.8 ms | 43.6 ms |
| Full verified warm Sigma frame | 807.3 ms | 961.3 ms |
| Default open / cache-write tasks ≥50 ms | None / none observed | None / none observed |
| Explicit detail / warm task maximum | 318 / 247 ms | 277 / 274 ms |
| Worker layout / first Sigma node view | 2,630.3 / 3,531.7 ms | 13,578.1 / 14,608.5 ms |
| Retained main heap after GC | 33.17 MiB | 75.37 MiB |
| Pan/zoom FPS / p95 frame | 58.97 / 16.8 ms | 56.88 / 33.3 ms |

Both startup/warm time targets remain met. The **247–318 ms current detail/warm tasks remain a miss** pending the slice-3 renderer (244–360 ms in the preceding run). All comparison, memory-backed warm, one-host and no-zero-sample-p95 caveats still apply; both current browser modes reported no page errors, exact hits and 20 streamed snapshots. The current four browser and twelve native screenshots were opened/read.

Current native hardware/software cold opens: **133/118 ms**; first groups **28.8/26.5 ms**; cached reopen **145/118 ms**; app restart/cache restore **2,904/2,872 ms**. Neither open observer recorded a ≥50 ms task. Incremental totals **5,879/5,339 ms** include five-second debounce and retain 591 node positions. External aggregate first pages **11.6/12.3 ms**, total **169/157 ms**. The hardware WebDriver polling log contains two transient `carrierPaths`-undefined warnings during refresh before its condition settled; the suite still passed, so this is not a warning-free native invocation.

The same exact `bun run gates` containment invocation passed all six lanes again after staging: **282 secrets / 245 attribution / 282 privacy checks**, six permissive runtime packages, scripts-disabled frozen lock unchanged. That reviewed bundle: **680,336 raw / 114,346 gzip / 83,707 Brotli bytes**, SHA-256 `9ed75c713e6f1b1bad66f768fc5472bc47bc45e9c5ee61cf70dfbc97cf322ff7`; receipt `slice2-review-fixes-gates.log` still names the baseline source commit because the patch was staged but uncommitted.

The final review follow-up closes the group-before-detail member race by checking the requested generation against both active groups and the detail dictionary, not object-reference equality. Exact containment prefix plus `bash -c 'bun run build && bun run test'` passed **65 tests / 401 assertions / the same five files** (`slice2-final-race-units.log`). Browser/native screenshots and metrics above precede only this narrow guard; they were not rerun afterward. Final `main.js`: **680,834 raw / 114,476 gzip / 83,872 Brotli bytes**, SHA-256 `1ae42bc81cfda7880db41cdc8984279d7772f4d33ffa2d8ea131a6a5f05f9145`. Final full gates use the identical containment invocation and are recorded in `slice2-final-gates.log`.

## Slice 3 direct renderer

Source: `feat/slice3-renderer` from untouched slice-2 `f24c75de`; measured locally on 2026-11-10, no push/publication. Sigma and main-thread Graphology construction are removed; the existing worker layout remains. Cache format 3 rebuilds incompatible slice-2 cached summaries, so cold layout seeds/coordinates are not a bitwise comparison across cache formats. Current evidence follows the independent review corrections, including the keyless-cache selection probe and permanent context-loss fallback.

### Exact final invocation and coverage

Every command below ran in the repository with `flock --exclusive --wait 2400 /tmp/openclast-local-verification.lock build-contained --`; a private sequential script held that lock for the complete matrix. `CHROME_BIN` selected an existing local Chrome, `OBSIDIAN_CACHE` an existing app cache; neither binary was committed or uploaded.

| Command / flags / subset | Result |
| --- | --- |
| `bun run build` | Typecheck and minified worker/plugin build pass |
| `bun run test` | 83 pass, 0 fail / 896 assertions / seven explicit files listed below |
| `bun run fixture --small`, then `GRAPH_MEASURE_NATIVE=1 bun run e2e` | Small hardware: 11 pass, 0 fail |
| Same small fixture, `GRAPH_SOFTWARE=1 bun run e2e` | Small software: 11 pass, 0 fail |
| `bun run fixture --literal`, then `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_MEASURE_NATIVE=1 bun run e2e` | Large literal hardware: 7 pass, 4 intentional skips |
| Same literal fixture, `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_SOFTWARE=1 bun run e2e` | Large literal software: 7 pass, 4 intentional skips |
| `bun run bench:browser` | One semantic and one literal repetition; zero page errors |
| `bun run gates` | All six lanes: secrets, attribution, privacy, scripts-disabled/frozen lock, permissive runtime licenses and bundle ceilings |

The seven explicit unit files are `tests/core.test.ts`, `tests/adapter.test.ts`, `tests/gates.test.ts`, `tests/pipeline.test.ts`, `tests/declaration-v2.test.ts`, `tests/renderer.test.ts` and `tests/contribution-page.test.ts`. The four large-only skips are full app-restart restore, persisted-key-miss incremental restart, carrier incremental update and duplicate quarantine; all four run in each small native lane. A passing fallback test does not mean the large graph was drawn in software.

Private logs: `.workspace/{build-final,unit-final,native-hardware,native-software,native-large-literal,native-large-software,browser-final,gates-final}.log`. Receipts: `.workspace/evidence/browser-benchmark.json`, `e2e-{small-hardware,small-software,large-literal-hardware,large-literal-software}.json`, `bundle-size.json` and `runtime-licenses.json`. Earlier complete pre-review-fix receipts are retained separately in `.workspace/evidence/pre-review-fixes/`, not silently relabelled as reviewed source.

The earlier pre-review-fix run missed first-group targets too: literal browser **508.1 ms**, native large hardware/software **572.9/760.5 ms**, with native open/detail/fallback long tasks of **65–81 ms**. These are prior-source observations, not the reviewed-source table below. The reviewed run's browser groups were **463.8/495.2 ms**, but semantic open still recorded a **54 ms** task; native large groups were **776/625 ms**, with **70/73 ms** open and **72/66 ms** detail/fallback tasks in the affected lanes. One improved browser repetition does not erase the earlier miss or establish repeatable target acceptance.

### Browser before/after

Same single desktop discrete-GPU class, Chrome 151.0.7922.34, 1280×800 DPR1, 60,600 synthetic host notes. Semantic projection has 16,000 nodes / 44,600 edges; literal has 60,600 / 89,200. The before column uses the slice-2 reviewed receipt, not a re-run on an artificially slow rebuild path. Both timing origins start after host-metadata JSON decode. Warm means a new worker + binary **memory-backed disk** decode + complete live verification + first node frame; it is not a full app restart or physical-storage test. Heap retains the host fixture and excludes worker/GPU/native memory. One repetition per mode is observation, not a distribution or hardware-matrix claim.

| Metric | Semantic slice 2 → slice 3 | Literal slice 2 → slice 3 |
| --- | --- | --- |
| Cold first groups | 391.3 ms → 463.8 ms | 459.9 ms → 495.2 ms |
| Full verified warm node frame | 807.3 ms → 625.3 ms | 961.3 ms → 806.9 ms |
| Retained main JS after GC | 33.17 MiB → 13.6 MiB | 75.37 MiB → 16.8 MiB |
| Pan/zoom FPS | 58.97 → 60.0 | 56.88 → 60.0 |
| p95 frame | 16.8 ms → 16.8 ms | 33.3 ms → 16.8 ms |
| Explicit detail / warm ≥50 ms task maximum | 318 / 247 ms → None observed / None observed | 277 / 274 ms → None observed / None observed |

| Current browser phase | Semantic | Literal |
| --- | --- | --- |
| Cold worker layout | 2,752.5 ms | 12,721.9 ms |
| Cold layout ready | 3,309.4 ms | 13,361.4 ms |
| First instanced detail view | 3,531.6 ms | 13,565.7 ms |
| Provisional cached group frame | 23.4 ms | 56.9 ms |
| Default group-open tasks ≥50 ms | 1 / 54.0 ms max | None observed |
| Cache-write tasks ≥50 ms | None observed | None observed |

Each browser mode asserts zero worker messages for a palette-only theme change, one palette upload, identical graph-buffer references, GL error 0 and restoration from retained CPU buffers. Both return exact warm hits and 20 streamed position snapshots. Parallel shader-completion waits are elapsed asynchronous waits, not synonymous with blocking tasks; drivers lacking `KHR_parallel_shader_compile` remain unmeasured. Empty long-task windows mean **no observed ≥50 ms tasks**, never a meaningful “0 ms p95” acceptance value.

### Native app lanes and remaining responsiveness misses

Obsidian app/installer 1.13.7, native Chromium 150.0.7871.212, same desktop. Small fixture: 2,000 notes → 600 nodes / 1,400 edges; large literal: 60,600 notes/nodes / 89,200 edges. Cold-open timing begins after public metadata readiness; full invocation also pays startup/indexing. Warm below is offline view reopen in the same app, not the separate complete-restart test or the browser memory-disk method.

| Native lane | Cold open | First groups | Offline reopen | Open ≥50 ms tasks | Detail/fallback-request ≥50 ms tasks |
| --- | --- | --- | --- | --- | --- |
| small-hardware | 219.0 ms | 34.7 ms | 34.0 ms | None observed | None observed |
| small-software | 223.0 ms | 110.2 ms | 207.0 ms | 1 / 70.0 ms max | None observed |
| large-literal-hardware | 15,131.0 ms | 776.0 ms | 464.0 ms | None observed | 1 / 72.0 ms max |
| large-literal-software | 14,120.0 ms | 625.0 ms | 426.0 ms | 1 / 73.0 ms max | 1 / 66.0 ms max |

Small hardware draws actual node detail and opens an existing note from pointer picking; small software draws bounded Canvas detail. Large hardware reaches the full literal node graph; large software explicitly retains Canvas groups/member lists because it exceeds the detail budget. Hardware tests restore a lost context, assert disposal releases that context, and deliberately leave another context unrestored with a shortened test-only deadline: small falls back to Canvas detail, large to group/member Canvas. Production restoration deadline is a configurable 5 seconds, not the injected test value. Light/dark host frames, groups, detail, hovered/selected notes and restored/fallback screenshots are captured under `test-screenshots/`; final representative PNGs were opened and read. The large node view remains a dense hairball: frame rate is not overview readability.

Native rAF sampling received zero callbacks even though the document reported visible; FPS is **unavailable**, not zero, not inferred from the browser and not accepted. The renderer uses one configurable on-demand paint backstop, not a perpetual timer loop. Native long-task maxima above are explicit misses wherever they exceed 50 ms; the large software detail-request observer measures refusal/fallback work, not a hidden full software rendering pass.

### Proven contribution-panel repair

A separate private native reproduction ran untouched slice-2 `f24c75de` on the 60,600-note literal fixture. The click naturally raced refresh: `contributions` revision 2 ran while retained detail was revision 1, the worker rejected “Projection generation changed”, the view swallowed it and the fresh group paint erased selection. Baseline `.workspace/evidence/carrier-repro.json`/PNG are retained in the separate untouched reproduction worktree; the fixed equivalent shows 100 navigable mapping rows on the first click and after revision 3 refresh without another relationship click. This was an existing slice-2 failure, not projection-semantic ambiguity.

The tracked native suite now checks retained selection after real refresh plus a synthetic rejected read with visible error and explicit Retry in all four lanes. Controller units additionally reproduce the reviewer's keyless cached-paint / same-revision shifted-ID case: capture clicked raw keys or legacy display labels immediately, wait for a fresh keyed summary, and resolve legacy labels only when unambiguous. Cached paint has a distinct negative generation, format-2 caches are rejected/quarantined, and stale replies cannot overwrite the refreshed page. Equal-looking typed groups stay distinct; missing/duplicate legacy labels remain refreshing rather than select a wrong relationship.

### Bundle, dependencies and acceptance boundary

Reconstructed `f24c75de` baseline: **681,062 raw / 114,503 gzip bytes**. Equal-minification comparison (main and embedded worker both minified): **324,036 min / 81,810 gzip → 184,338 min / 49,240 gzip bytes**, a **43.11% / 39.81%** reduction. Current Brotli: **42,726 bytes**; SHA-256 `ee348e886de667ded0de98893952fb804e69fe4e7aa421888eda6333312e300a`. Receipts: `.workspace/evidence/baseline-size.json` / `bundle-size.json`. Gates regenerate the bundle receipt after the authorized local commit to bind its commit field; pre-commit receipts correctly identify the base plus staged patch, not a nonexistent final commit.

The slice-3 250,000 minified / 70,000 gzip ceilings pass. Eventual 150,000 / 45,000 ceilings do not. The renderer has zero runtime packages, but the complete worker layout still audits **five MIT packages** (Graphology, FA2 and their transitive packages), down from six; the plan's one-package intermediate target is **not met**. Replacing the layout stack belongs to slice 4. Regenerated `THIRD_PARTY_NOTICES.txt` contains all five license texts; installations remain frozen/scripts-disabled with an empty trusted-dependency list.

The ≤12 MiB retained-main-heap goal remains unmet in both browser modes; the substantial reduction is not full memory acceptance. First-group and ≥50 ms task observations above must be compared to their 500/50 ms targets without rounding away misses. Full verified warm-node views meet the 1-second target in this single browser run. Native large first-group and main-thread task failures remain explicit, not hidden behind 60 FPS.

Canvas refusal defaults remain **2,000 visible nodes / 10,000 visible edges**, configurable and validated, rather than the plan's proposed 20,000-node default. Deterministic tests cover both over-budget refusal paths and preserve all eligible edges; only the 600/1,400 native software use path is performance-observed. Even the conservative refusal boundary is not benchmarked animation capacity. No claim covers integrated GPUs, mobile/N-2 app versions, physical-storage large warm starts, all-scale readability, native FPS, remote authorization or million-note rendering.

## Slice 4: CSR-native layout

Source: `feat/slice4-layout`, based on slice-3 `8df94ada`; measured locally on 2026-11-10. Plugin version **0.2.0**, producer `graph-ng-fa2@1`, unchanged binary cache format **3**. The layout now uses original typed-array ForceAtlas2/Barnes–Hut in the existing worker, with persistent integrator history across streamed snapshots. Graphology/FA2 are development-only differential oracles. See [ADR-0006](decisions/ADR-0006-csr-layout.md) for equations, approximation and scheduling contracts.

### Exact verification scope

All Bun invocations ran under `flock --exclusive --wait 2400 /tmp/openclast-local-verification.lock build-contained --`, with scripts-disabled dependency installation and synthetic fixtures only. The full matrix was sequential; each mode is one repetition on a desktop i9-12900K / approximately 32 GiB RAM / RTX 4060 Ti class machine, not a hardware population claim.

| Command inside verification boundary | Exact observed result |
| --- | --- |
| `bun run build` | Strict TypeScript and both minified bundles pass; complete build-input receipts assert no node_modules inputs. |
| `bun run test` | **94 pass, 0 fail, 1,150 assertions**, eight explicitly listed files: the existing 83 tests plus 11 layout tests. Repeated after independent-review test hardening. |
| `bun run bench:layout` | 50 continuous iterations, same seed/initial positions/inputs, both full fixtures; speed and quality gates pass. |
| `bun run fixture --small`; `GRAPH_MEASURE_NATIVE=1 bun run e2e` | Native small hardware **11 pass / 0 skipped**. |
| `GRAPH_SOFTWARE=1 bun run e2e` | Native small software **11 pass / 0 skipped**; bounded Canvas detail, not software WebGL acceptance. |
| `bun run fixture --literal`; `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_MEASURE_NATIVE=1 bun run e2e` | Native large literal hardware **7 pass / 4 intentional skips**. |
| `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_SOFTWARE=1 bun run e2e` | Native large literal software **7 pass / 4 intentional skips**; group/member fallback, not full software node detail. |
| `bun run bench:browser` | Semantic and literal modes pass renderer/theme/context checks, no page errors, approximately 60 FPS each. |
| `bun run gates` | All six lanes pass, including **0 runtime packages**, empty runtime notice file, frozen lock and the tighter bundle ceilings. Repeated after evidence/documentation updates. |

The eight unit files are `tests/{core,adapter,gates,pipeline,declaration-v2,renderer,contribution-page,layout}.test.ts`. New layout coverage includes repeated position hashes, stream/task-budget independence, bitwise fixed-node stability without mutating input, convergence bounds, tiny-theta tree forces versus all-pairs including duplicate points/unequal masses, degenerate/self/multiedge graphs, edge-only/CSR parity, 20-step all-pairs oracle comparisons at <1e-6 maximum coordinate error across default/LinLog/strong-gravity/outbound/size-adjustment modes, theta-0.7 relative L2 force error <5% across three seeds, six fixed-seed/mode distribution and median-scale comparisons, malformed inputs and 0.1 settings upgrades. The four large skips remain full app-restart restore, persisted-key-miss incremental restart, carrier incremental update and duplicate quarantine; those run in both small native lanes.

Private evidence: `.workspace/{build-final,unit-final,layout-final,native-hardware,native-software,native-large-literal,native-large-software,browser-final,gates-final}.log`, final review-follow-up logs `.workspace/{build-review-fixes,unit-review-fixes,layout-review-fixes,gates-review-fixes,gates-staged,gates-postcommit}.log`, and `.workspace/evidence/{layout-benchmark,browser-benchmark,bundle-size,bundle-inputs,runtime-licenses,e2e-*}.json`. Contact sheets covering all **64** captured screenshots and representative original PNGs were opened and read. Files remain in ignored `test-screenshots/`; visual-review sheets remain in `.workspace/visual-review/`. Native group counts, light/dark detail/hover/selection, restored contexts, retained contribution lists and explicit software fallback are visible. The literal node view is still a dense hairball, not a readable overview; software notification stacking and dense label contrast remain existing UI limitations.

### Independent review and mutation follow-up

Independent review returned **SHIP-WITH-FIXES**, with test weaknesses but no observed runtime defect. The review follow-up changes tests, benchmark/gate receipts and documentation only; native/browser measurements above and below use the unchanged runtime. Isolated private copies ran `bun test tests/layout.test.ts` under the same lock/containment prefix. The unmutated control passed 11 tests; **M1** reversed tree-force sign, **M3** theta ×10, **M4** tree repulsion ×0.1 and **M5** disabled force-history swap all failed. M3 failed the new mid-theta bound; M5 failed the new 20-step oracle comparison; M4 failed tiny-/mid-theta force and quality checks. **M6** removal of leaf self-exclusion still survived the exercised coincident fixtures; the reviewer described it as equivalent for its probe, not evidence that every possible self-exclusion error is covered. Receipts/logs: `.workspace/evidence/mutation-hardening.json` and `.workspace/mutation-hardening/*.log`.

The bundle receipt now records `dirty`, porcelain `sourceStatus` and `stagedTree` alongside HEAD, avoiding an uncommitted patch being mislabeled as its base commit alone. Full staged and postcommit gates bind the final source and bundle. The inert old graphology cache-migration branch and per-iteration cancellation limitation are explicitly documented in ADR-0006.

### Offline layout speed and quality

`bun run bench:layout`, Bun 1.3.14, synthetic fixture seed 17, options seed 1, 50 iterations, theta 1.2, early convergence disabled. Fixture/projection construction is excluded; solver initialization is included. The current oracle includes its required object-graph construction. Standard own-tree opening uses cell width/distance; the oracle uses twice cell width at the same nominal theta, so these are **not equal approximation-effort timings**. The benchmark records distribution quality rather than claiming identical coordinates.

| Nodes / edges | Own layout | Supplied historical graphology baseline | Historical speedup | Current dev oracle |
| --- | --- | --- | --- | --- |
| 16,000 / 44,600 semantic | **576.1 ms** | 3,700 ms | **6.42×** | 8,599.3 ms |
| 60,600 / 89,200 literal | **2,499.6 ms** | 18,400 ms | **7.36×** | 41,220.5 ms |

Both meet the ≤half historical-time acceptance target. This table uses the post-review rerun with the median-scale gate enabled; the earlier 573.7/2,401.7 ms run is preserved in `.workspace/evidence/layout-benchmark-before-hardening.json`. Numerical hashes and quality values were unchanged. Historical 3.7/18.4-second values are supplied baseline evidence, **not a rerun under the present benchmark**; current oracle numbers must not be silently substituted into that claim. Browser/default-100-iteration streamed timings below are a different runtime/method and must not be conflated with these offline 50-iteration numbers.

Quality uses optimal-uniform-scale unit-edge stress `1 - sum(length)^2 / (edgeCount * sum(length^2))`, plus edge q10/q50/q90 divided by RMS edge length. These are translation/rotation/scale-invariant distribution measures, not global geodesic stress or neighborhood-preservation proof. Declared tolerance is stress absolute delta <0.08, maximum relative normalized quantile deviation <25% and unnormalized median-edge scale ratio within 15%. The last check prevents normalized distributions from hiding absolute force-scale defects.

| Quality at the same 50 iterations | Semantic own / oracle | Literal own / oracle |
| --- | --- | --- |
| Unit-edge stress | 0.214506 / 0.214475 | 0.202909 / 0.202978 |
| Absolute stress delta | **0.00003135** | **0.00006946** |
| RMS-normalized q10 | 0.324477 / 0.323963 | 0.333741 / 0.333086 |
| RMS-normalized median | 0.829305 / 0.829214 | 0.849312 / 0.849055 |
| RMS-normalized q90 | 1.523617 / 1.524779 | 1.509991 / 1.512422 |
| Maximum quantile relative deviation | **0.1586%** | **0.1967%** |
| Unnormalized median length ratio | 1.000511 | 1.000428 |

The benchmark's repeated initial/final runs produced identical hashes: semantic `b60362fb60b04c3885bbf128c238be9c69aa9884880e81f2231501a74c859fc5`, literal `0bf7f77abc58a2c46a4af80bf559a425e50e07579abdd8d1d772554c8d73d143`. Unit tests repeat hashes and assert streaming/batch cadence leaves the final result unchanged. Native persisted-key-miss tests keep **600 of 600** old positions unchanged when adding an isolated node; a carrier edit keeps **591** untouched nodes unchanged in each small lane.

### Browser and native use-path measurements

Browser: Chrome 151.0.7922.34, ANGLE NVIDIA discrete GPU, 1280×800 DPR1, labels enabled, 100 iterations, 20 streamed snapshots. Origin is after synthetic host-metadata JSON decode. Warm means new worker + binary **memory-backed disk** decode + complete live verification + first detail frame; it is neither physical disk nor a full app restart.

| Browser measurement | Semantic | Literal |
| --- | --- | --- |
| Worker layout (100 streamed iterations) | 1,861.9 ms | 7,540.2 ms |
| First groups | **403.2 ms** | **458.4 ms** |
| First full detail | 2,507.1 ms | 8,345.7 ms |
| Provisional warm groups | 20.7 ms | 48.4 ms |
| Full verified warm detail | **629.6 ms** | **813.1 ms** |
| Pan/zoom FPS / p95 frame | 60.00 / 16.7 ms | 60.00 / 16.7 ms |
| Retained main JS after GC | 13.59 MiB | 16.76 MiB |
| Observed ≥50 ms tasks in open/cache-write/detail/warm windows | None observed | None observed |

Both browser modes assert zero worker messages on palette-only changes, unchanged graph buffers, one palette upload, GL error 0 and successful context restoration. No observed long tasks is not a meaningful “0 ms p95” acceptance distribution. Main heap still exceeds the ≤12 MiB goal and excludes worker/GPU/native memory. Asynchronous shader polling elapsed time is not a blocking-task measurement.

Native: Obsidian app/installer 1.13.7. Small is 2,000 notes → 600 nodes/1,400 edges; large literal is 60,600 notes/nodes and 89,200 edges. Cold begins after public metadata readiness; native warm is view reopen, not the browser memory-disk method.

| Native lane | Cold open | First groups | Offline reopen | Open ≥50 ms tasks | Detail/refusal ≥50 ms tasks |
| --- | --- | --- | --- | --- | --- |
| small hardware | 118 ms | 29.9 ms | 47 ms | None observed | None observed |
| small software | 319 ms | 159.1 ms | 231 ms | 1 / **140 ms** max | None observed |
| large literal hardware | 8,414 ms | **512.8 ms** | 454 ms | None observed | 1 / **66 ms** max |
| large literal software | 9,416 ms | **710.9 ms** | 424 ms | 1 / **145 ms** max | 1 / **75 ms** max |

Large native first groups still miss 500 ms and the marked tasks still miss 50 ms. Software large detail measures explicit refusal/group fallback, not rendering 60,600 nodes. Native rAF sampling remains **unavailable** (zero callbacks at a 10-second harness limit despite visible document); never infer native FPS from browser FPS. Small full restart/restore took 2,902 ms hardware / 3,055 ms software, including app lifecycle; these are not subsecond app-restart claims.

### Bundle and remaining limits

The complete plugin is **112,624 minified / 34,809 gzip / 30,237 Brotli bytes**, SHA-256 `9a3cb6267086ce3a6100777b96d9baf44fa94f5176f2164721549045a074f2d9`. Slice 3 was 184,338 / 49,240 gzip bytes: reductions **38.90% / 29.31%**. Both **150,000 / 45,000** limits are enforced and pass. Runtime package count is **zero**, runtime notices are empty, and the build-input receipt excludes all node_modules inputs. Exact oracle pins remain development-only; this does not certify the licenses of every development transitive tool.

Multilevel coarsening above **250,000 nodes is deferred**. No >60,600-node layout timing, 1M-node acceptance, all-scale readability, mobile/iGPU/N-2 app matrix, native FPS or physical-disk large warm-start claim is added. Own-tree/FA2 floating-point operations can differ between JavaScript engines. Bounded iteration tasks are not a measured per-task millisecond cap. The existing worker deadline remains a backstop; layout similarity does not prove remote authorization or release safety. Independent review and its test-hardening follow-up are recorded above; publication remains separate from these deterministic and synthetic observations.

## Slice 5: native startup and retained render columns

### Method, attribution and timing correction

Version 0.2.1 uses the same single-host class and synthetic fixtures as slice 4: Obsidian app/installer 1.13.7, native Chrome 150.0.7871.212, browser Chrome 151.0.7922.34, discrete NVIDIA ANGLE and forced SwiftShader lanes. Native large literal has 60,600 notes/nodes and 89,200 edges; native small has 2,000 notes, 600 nodes and 1,400 edges. Browser semantic/literal retain the same 60,600-row host metadata throughout both before/after runs. Timings below are single repetitions, not capacity guarantees.

All local Bun invocations use `flock --exclusive --wait 2400 /tmp/openclast-local-verification.lock build-contained --`. `OBSIDIAN_CACHE` selects the existing local app cache and `CHROME_BIN` the cached browser executable; expanded personal paths remain private. Exact commands/subsets:

- `bun run gates:fast`, `bun run build`, `bun run test` (the nine explicit files in the package script), then `bun run fixture --small`.
- `GRAPH_MEASURE_NATIVE=1 bun run e2e` and `GRAPH_SOFTWARE=1 bun run e2e`, small hardware/software.
- `bun run fixture --literal`, then `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_MEASURE_NATIVE=1 bun run e2e` and `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_SOFTWARE=1 bun run e2e`.
- `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_PROFILE=1 bun run e2e`, repeated with `GRAPH_SOFTWARE=1`: a separate one-test profile using public long-task entries, own-plugin phase wrappers and CDP CPU sampling. `startupTrace` separates worker group delivery, synchronous group drawing and queued refreshes.
- `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_TRACE=1 bun run e2e`, repeated with `GRAPH_SOFTWARE=1`: full native interaction tracing. Earlier diagnostic runs precede the final palette/carrier/resize corrections and are distinct from final acceptance receipts.
- `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_PROFILE=1 GRAPH_PROFILE_DRILL=1 bun run e2e`: additional member → note → full-detail profile. After cold paint is recorded, drain only the plugin-owned queued metadata notification and wait for its refresh to settle so it cannot intentionally replace the member panel mid-click.
- Final large hardware and software also set `GRAPH_CPU=1`, collecting full-path CPU samples and CDP NavigationStart metrics without timeline tracing, so recorded long-task windows can be correlated exactly.
- `bun run bench:browser`, `bun run gates`; no pure-layout rerun is implied because the solver is unchanged.

An untouched slice-4 bundle (`a1693724`) reprofiled through the same probe showed **535.3 ms hardware / 589.5 ms software** actual cold groups. The original DOM measurement was overwritten by a queued metadata refresh: the same hardware run reported 539.8 ms later. Slice 5 preserves the first actual live paint and separately records subsequent verification paints; this is a measurement correction, not a claim that all older reported timings were cold paints.

The baseline first pass spent 203.7/221.7 ms in main-realm column generation and 160.2/186.7 ms awaiting serial worker row processing; worker projection until group delivery contributed 157.3/147.6 ms. Group drawing itself was 9.5/29.5 ms (hardware/software). Main-realm CPU samples are dominated by per-cell `TextEncoder.encodeInto`; the seven visible group controls are not a large DOM construction bottleneck. Column generation includes calls to public Obsidian metadata APIs, but it is Graph NG's requested ingestion work, not autonomous host UI work.

A hardware explicit-detail run caught a **214 ms** main task with samples in Graph NG's `gpuStatus` first `getContext`; another baseline profile caught 159 ms there. Full-path tracing then caught **81.4 ms** on a Groups click, 79.6 ms sampled inside palette `getImageData` GPU readback, and **51.8–52.6 ms** external-carrier lookup scans. An additional member → note → full-detail profile caught **94 ms**, with **91.1 ms** sampled in our GPU drawing-buffer resize while parallel shader compilation was pending. Skipping unchanged axes alone did not resolve that wait; applying the latest GPU buffer size after shader completion did. These are Graph NG-owned/requested costs. The same trace caught **143.5 ms** of **Obsidian file-explorer sorting/update** after note navigation; no plugin samples dominate that span, and no host internals were changed. A separate roughly 160 ms `CpuProfiler::StartProfiling` span is diagnostic overhead, not product startup cost.

Fixes: contiguous ASCII column encoding/decoding with Unicode cell-preserving fallback; no unused producer-link extraction; worker OffscreenCanvas GPU probe; one-pixel CPU-backed palette conversion; cooperatively sliced external-carrier indexing; shader-completion-gated drawing-buffer resize without redundant axis resets; minimal main-realm render columns and packed UTF-8 paths. Existing budgets, deterministic semantics, sole worker projection authority, cache format and runtime dependency count remain unchanged. See [ADR-0007](decisions/ADR-0007-native-startup-render-columns.md).

### Final-source results and remaining misses

The independent review returned **SHIP-WITH-FIXES**, not unconditional acceptance. Follow-up tests reproduce a resize in the post-compile upload-yield window and refresh beginning before a sliced carrier index can be cached. The final initialization/restore path reconciles the latest dimensions immediately before readiness; refresh invalidates unfinished lookups before replacing the graph. The warm-start wait requires the exact added path and public identity, not only a node count. This does not add incremental group-row mutation or a second identity authority. The correctness reconciliation exposed a further **230 ms Graph NG-owned detail task**, with **205.5 ms** sampled in drawing-buffer resize (kept in `.workspace/evidence/runs/native-large-literal-hardware-1794365095142-3825367/`). `waitForResize()` now flushes a public WebGL2 fence and polls `clientWaitSync(fence, 0, 0)` before both buffer reconciliations. Polling is asynchronous under the existing shader-poll/deadline knobs; lost/disposed/failed/timeout paths release the fence and retain the existing group fallback. The targeted actual-native rerun removed that 230 ms task: no ≥50 ms open/detail tasks, first groups **309.1 ms**. Buffer allocation or another driver can still block; this is measured improvement, not a universal driver guarantee.

| Native lane | Cold ready/open | First actual groups | Offline reopen | Open ≥50 ms tasks | Detail/refusal ≥50 ms tasks |
| --- | --- | --- | --- | --- | --- |
| small hardware | 120 ms | **24.0 ms** | 24 ms | None observed | None observed |
| small software | 114 ms | **19.1 ms** | 43 ms | None observed | None observed |
| large literal hardware | 8,819 ms | **320.0 ms** | 325 ms | None observed | None observed |
| large literal software | 9,418 ms | **350.1 ms** | 423 ms | None observed | None observed |

The ≤500 ms first-group target is met in every final native lane. Cold ready/open still includes full verified layout and is not the first-group measure. Small hardware/software are **11 passing each**; large literal hardware/software are **7 passing, 4 skipped each**. The large skips are complete-app restart, persisted key miss, incremental edit and duplicate quarantine; their small-fixture equivalents run. Software large detail is explicit refusal/group fallback, not 60,600-node Canvas rendering.

| Browser mode | First groups | Full verified memory-disk warm detail | First full detail | Retained main JS after GC | Backing storage | FPS | p95 frame |
| --- | --- | --- | --- | --- | --- | --- | --- |
| semantic | 196.4 ms | 437.2 ms | 2,132.3 ms | 10.972 MiB | 2.031 MiB | 60.0 | 16.7 ms |
| literal | 250.4 ms | 644.7 ms | 7,969.8 ms | 10.940 MiB | 5.291 MiB | 60.0 | 16.7 ms |

The browser before/after heap is **13.586 → 10.972 MiB semantic / 16.753 → 10.940 MiB literal**, with the same host metadata retained. Both meet the ≤12 MiB **main JavaScript heap** target. Backing storage is separate: this does **not** meet or establish a 12 MiB total-process, combined-buffer, worker or GPU-memory target. No ≥50 ms task was observed in the browser open/cache-write/detail/warm windows. A task-free repetition is not a zero-millisecond p95 distribution or universal nonblocking guarantee.

**The end-to-end ≤50 ms task target still has recorded misses. Software open tasks of 51–63 ms exceed 50 ms and are UNATTRIBUTED; program-only CPU samples do not establish Obsidian ownership.** Earlier repetitions observed **62–70 ms detail tasks**, including the software lane; those individual unprofiled entries remain **unattributed**. Kept pre-review-fix hardware drill evidence (`.workspace/evidence/pre-review-fixes/profile-large-hardware.json` and matching `.cpuprofile`) correlates a **73 ms** task to Obsidian `alphabetical`/backlink updates after note navigation, not Graph NG. The same archive's software native receipt records **63 ms during open** with only CPU `(program)` samples, so that event is **unattributed**, not claimed host-owned. Final-run exact CPU attribution is recorded below. Do not transfer ownership from one repetition to another or infer closure from a separate task-free profile. No Obsidian internals were changed.

The final separate hardware drill profile (`.workspace/evidence/runs/profile-large-hardware-1794365801923-3857405/profile.json` and `profile.cpuprofile`) records a **63 ms** task after note navigation. Exact-window CPU samples include Obsidian `alphabetical` (22.04 ms), other `app.js` work (19.27 ms) and `updateBacklinks` (7.53 ms), without a Graph NG-dominant span: this particular task is host-owned. The final separate software direct profile (`.workspace/evidence/runs/profile-large-software-1794365764873-3856179/profile.json` and `profile.cpuprofile`) records a **60 ms** task with 60.02 ms of `(program)` samples and no attributable JavaScript stack. That task is **UNATTRIBUTED** and remains a >50 ms miss, distinct from the task-free functional repetition above.

Native FPS remains unavailable; large complete-app restart, mobile/iGPU/N-2, >60,600-node timing, dense-overview readability and worker/GPU/native memory remain unaccepted. Platforms lacking worker OffscreenCanvas or parallel shader completion may still block on public driver calls. One unusually large property or host call is not preemptible by cooperative budgets.

Final commands are the matrix above, with `GRAPH_CPU=1` on **both** large native lanes. `bun run test` passes **103 tests across nine explicit files**, including the original 94. Build/typecheck, both browser modes, and full **six-lane gates** pass. Screenshot contact sheets and representative full-resolution images are visually read locally; raw synthetic images remain ignored. Independent review and follow-up evidence are local, not publication or production acceptance.

The complete 0.2.1 plugin is **115,970 minified / 35,830 gzip / 31,057 Brotli bytes**, SHA-256 `28d42609a61a7f8d3d5fb11b8a3ceaae83db76e861886def43b6fec77f366ad3`. Both **150,000 / 45,000** ceilings pass; runtime package count remains **zero**.

Native/profile runs preserve immutable, exclusively created records under `.workspace/evidence/runs/`; top-level files are latest-run aliases, not the archival authority. Earlier before/after files are retained in named evidence directories. Final native runs:

- `.workspace/evidence/runs/native-small-hardware-1794365547267-3847027`: small-hardware functional receipt.
- `.workspace/evidence/runs/native-small-software-1794365593041-3848932`: small-software functional receipt.
- `.workspace/evidence/runs/native-large-literal-hardware-1794365640737-3850633`: large-literal-hardware functional receipt and exact clock-correlated CPU samples.
- `.workspace/evidence/runs/native-large-literal-software-1794365687163-3853135`: large-literal-software functional receipt and exact clock-correlated CPU samples.

## Slice 6: explore controls and visual effects

Version 0.3.0 adds the Explore panel (filters, group-by including derived sources, legend, relationship toggles, display controls, saved views) and the presentation effects. Same host class and fixtures as slice 5: Obsidian 1.13.7 / native Chrome 150.0.7871.212, browser Chrome 151.0.7922.34, discrete NVIDIA ANGLE and forced SwiftShader. Single repetitions unless stated; not capacity guarantees.

### Exact commands

All Bun runs use `flock --exclusive --wait 2400 /tmp/openclast-local-verification.lock build-contained --`, each e2e lane under `timeout 900`.

- `bun run build`; `bun run test` (ten explicit files, **125 pass** after the review fixes; after them the small native lanes re-ran green (graph 11/11, explore 6/6, hardware and software), the large literal lanes re-ran green (graph 7/7 hardware and software, explore 6/6 hardware, 3 pass + 3 skipped by design on software), and the browser bench completed 3/3 sequential runs in both modes).
- `bun run fixture --small`, then `GRAPH_MEASURE_NATIVE=1 bun run e2e`, `GRAPH_SOFTWARE=1 bun run e2e`, `GRAPH_EXPLORE=1 bun run e2e`, `GRAPH_EXPLORE=1 GRAPH_SOFTWARE=1 bun run e2e`.
- `bun run fixture --literal`, then `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_MEASURE_NATIVE=1 GRAPH_CPU=1 bun run e2e`, the same with `GRAPH_SOFTWARE=1` instead of `GRAPH_MEASURE_NATIVE=1`, and `GRAPH_EXPLORE=1 GRAPH_LARGE=1 GRAPH_LITERAL=1 bun run e2e` with and without `GRAPH_SOFTWARE=1`.
- `CHROME_BIN=<cached Chrome 151> bun run bench:browser`, three sequential runs (`browser-benchmark-run{1,2,3}.json`); `bun run gates`.
- Clustered judgement fixture: `bun scripts/generate.ts --clustered` (semantic) or `--literal --clustered`, written to its own `test-vault/large-clustered`, then `GRAPH_FIXTURE=clustered GRAPH_LARGE=1 GRAPH_EXPLORE=1 bun run e2e` (add `GRAPH_LITERAL=1` for literal). `clusteredFixture` (seed 17) splits the same 16,000 concepts / 44,600 mappings into 48 Zipf-sized sections over six families; 94 % of mappings stay inside a section and favour a few hub concepts, 6 % bridge sections (70 % of bridges within the same family).

The explore lane (`tests/e2e/explore.spec.ts`) drives the real panel: live counts, both themes, detail open, `flyTo` landing, hover one-hop highlight, a declared-property filter through the panel (asserting no relayout and identical positions), collapse/expand of two groups into hubs, a saved view with camera restored after clearing, the persisted `data.json` (settings key only, no positions), a folder-depth regroup and a derived `$identity` segment group. It records long tasks around each interaction.

### Results

| Native lane | Result | First actual groups | ≥50 ms open/detail tasks | Explore interaction long tasks |
| --- | --- | --- | --- | --- |
| small hardware | graph 11/11, explore 6/6 | 23.4 ms | none | none |
| small software | graph 11/11, explore 6/6 | 19.9 ms | none | none in the final run (see misses) |
| large literal hardware (60,600 / 89,200) | graph 7/7, explore 6/6 | **307.9 ms** | none | none (detail, hover, filter, collapse, regroup) |
| large literal software | graph 7/7 on rerun, explore 3 pass + 3 skipped (Canvas refusal, by design) | **354.2 ms** | none | none (open, regroup) |

Large first groups stay inside the ~320/350 ms slice-5 budget class (307.9 vs 320.0 hardware; 354.2 vs 350.1 software, a 4 ms software overrun within single-run noise, not a proven regression or improvement). Native large hardware detail sampled **58.2 fps, p95 17.9 ms** in `GRAPH_MEASURE_NATIVE` frames. A filter/regroup round trip through the worker takes about **55 ms wall time** (asynchronous; no main-thread long task was observed for it). Effect policy on the 60.6k literal web: glow and halos on, curves automatically off above `curvesMaxEdges` (60,000).

| Browser mode | First groups | Warm open | Retained main JS | Backing storage | FPS / p95 frame | ≥50 ms tasks |
| --- | --- | --- | --- | --- | --- | --- |
| semantic (official sequence, 3 runs) | 197.0–210.7 ms | 435.9–636.5 ms | 11.06 MiB | 2.37 MiB | 60.0 / 16.7 ms | none |
| literal (official sequence, 3 runs) | 249.4–261.9 ms | 586.9–648.2 ms | 11.03 MiB | 6.36 MiB | 60.0 / 16.7–16.8 ms | none |

Each run also opens a second detail view in the same page after hover, select and context loss/restore, repeats hover, select and context loss/restore on it, and asserts the disposed view is detached and schedules no frame or backstop timer (`rendererChecks.secondView`); all six mode runs passed it.

Main JS heap stays under 12 MiB in both modes (slice 5: 10.97/10.94 MiB, so +0.08 MiB in each mode).

### Honest misses

- **Browser bench hang: root-caused to the harness runtime, not graph-ng.** The second headless launch in one Bun process never received its multi-MB CDP screenshot reply: Chrome logged `devtools_pipe_handler: Could not write into pipe`, exited with code 0, and the bench then waited forever in `server.close`, which looked like a natively blocked page. A minimal script with no graph-ng code (two launches, six noisy 3 MB screenshots each) reproduces it under Bun 1.3.14 (second launch times out, `browser.close` hangs) and passes 3/3 launches under Node 22.23.1. Slice 6's glow and halos make the literal PNGs larger (up to 1.75 MB), which is why slice 5 passed. The bench now runs each mode in its own Bun process, exits on a browser disconnect, and closes keep-alive sockets. A product regression check (second view after hover/select/context loss) was added and passes. The Bun transport fault itself is upstream and unfixed.
- One intermittent large-software failure: the first run timed out waiting 180 s for the contribution list after clicking a group pair; the immediate rerun passed 7/7. Unattributed.
- Earlier small-software explore runs recorded single **76 ms** (regroup) and **59 ms** (collapse) long tasks; the final runs recorded none. Unattributed, kept as misses.
- Visual judgement (screenshots read). Uniform fixture: random topology, no community structure, so it renders as a textured disc. **Clustered fixture, semantic display (16,000 / 44,600):** six family-coloured community lobes with faint bridge threads, readable in both themes. It reads as a web, not a blob. **Clustered fixture, literal display (60,600 / 89,200):** the section lobes are visible as shape, but the 44,600 reified mapping notes fall in the neutral `(missing)` group and hide the family hues: light grey on dark, a heavy dark-grey mass on light. One tuning round was tried and reverted because it made no visible difference: placeholder-group alpha 90/255 plus 0.55× placeholder radius. Dense overlap saturates translucency, and edges between mapping notes and concepts also contribute. Open: the literal mapping layer needs a different treatment, for example colouring mapping notes by an endpoint's group or drawing them under the concepts. Hub labels for coincident centroids are stacked, not laid out.
- **Bundle ceiling exceeded.** `bun run gates`: secrets, attribution, privacy, supply-chain and licenses pass. bundle-size **fails** at **169,376 minified / 53,368 gzip** bytes against the enforced 150,000 / 45,000 (first slice-6 build: 170,539 / 52,954; after the trim: 166,118 / 52,418; review fixes for view generations, save validation and the disabled-derive notice add about 3 KB; 0.2.1: 115,970 / 35,830). The trim shortens 89 main-bundle-only private member names (`scripts/mangle-props.mjs`; a gate test proves none appears in DOM/ES/Obsidian typings, worker sources, e2e/scripts or string literals) and emits UTF-8 instead of `\u` escapes. The main bundle without the embedded worker is already 136,585 / 41,613, and the worker adds about 34 KB minified / 11.3 KB gzip. So 45,000 gzip cannot be reached without removing slice-6 features. Embedding the worker deflate-compressed would bring the minified size to about 147 KB, but gzip size would not change and the shipped code would be harder to review. Both options need an owner decision. The gate limits are unchanged.
- Native FPS is from one sampling window; software FPS is not measured. Mobile, iGPU and N-2 hosts are not tested.

## Slice 7: literal edge-note visuals

Version 0.3.1 addresses the slice-6 visual miss for literal display: edge notes (reified relationship notes drawn as nodes) take the displayed colour of their endpoints, draw small in their own pass beneath the other notes without glow, thin with edge-note density, and fold into their edges at mid and far zoom (default: fully shown at camera/home ratio ≤ 0.3, gone at ≥ 0.6, not pickable below 25 % visibility). Same host class and fixtures as slice 6. Single repetitions unless stated.

### Exact commands

All Bun runs use `flock --exclusive --wait 2400 /tmp/openclast-local-verification.lock build-contained --`, each e2e lane under `timeout 900`.

- `bun run build`; `bun run test` (ten explicit files, **131 pass** after the review fixes).
- `bun run fixture --small`, then `GRAPH_MEASURE_NATIVE=1 bun run e2e`, `GRAPH_SOFTWARE=1 bun run e2e`, `GRAPH_EXPLORE=1 bun run e2e`, `GRAPH_EXPLORE=1 GRAPH_SOFTWARE=1 bun run e2e`.
- `bun run fixture --literal`, then `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_MEASURE_NATIVE=1 GRAPH_CPU=1 bun run e2e` (4 runs), the same with `GRAPH_SOFTWARE=1` instead of `GRAPH_MEASURE_NATIVE=1`, and `GRAPH_EXPLORE=1 GRAPH_LARGE=1 GRAPH_LITERAL=1 bun run e2e`.
- `bun scripts/generate.ts --literal --clustered`, then `GRAPH_FIXTURE=clustered GRAPH_LARGE=1 GRAPH_EXPLORE=1 GRAPH_LITERAL=1 bun run e2e` (2 runs; the second on the final source). The explore lane now also captures `*-detail-notes` screenshots with the fold turned off, so the derived colours are judged directly.
- `CHROME_BIN=<cached Chrome 151> bun run bench:browser`, three sequential runs; `bun run gates`.

### Results

| Lane | Result | First groups | ≥50 ms graph tasks |
| --- | --- | --- | --- |
| small hardware / software | graph 11/11, explore 6/6 each | 17.7 ms (hw rerun) | none in explore interactions; one 51 ms open task in the first small-hardware run, none on rerun (unattributed) |
| large literal hardware (4 runs) | 7/7 in 3 runs; 1 run failed on the Groups screen (`graph-ng-edge` button not interactable), passed on rerun | 297.4 / 313.4 / 303.1 / 345.7 ms | one 64 ms detail-open task in run 1 (CPU profile: 39.5 ms inside `getContext('webgl2')`, about 24 ms graph JS in renderer construction); none in runs 2–4 |
| large literal software | 7/7 | — | none |
| large literal explore hardware | 6/6 | — | none (detail, hover, fold toggle, filter, collapse, regroup) |
| clustered literal explore hardware | 6/6 (×2) | — | none |

Native large hardware detail sampled **58.2–58.3 fps, p95 17.6–17.9 ms**. Browser bench, three runs: semantic first groups 205.1–233.2 ms, warm open 425.4–623.8 ms, heap 11.07 MiB, backing 2.39 MiB; literal first groups 253.4–257.2 ms, warm open 598.8–612.2 ms, heap 11.09 MiB, backing 6.42 MiB; 60.0 fps / p95 16.7–16.8 ms; no ≥50 ms tasks; second-view checks pass in all six.

Visual judgement (screenshots read): **clustered literal (60,600 / 89,200), dark and light, at home zoom**: the six family hues and the section lobes are clearly visible; the neutral grey mass is gone. With the fold turned off, the edge notes tint their lobes in the same hues instead of covering them. Zoomed in (`*-hover`), edge notes appear as small tinted dots around the concepts. Bridge threads between lobes remain faint at home zoom.

### Review fixes (final source)

An independent review returned SHIP-WITH-FIXES: colour only from the note's own relationship (the render projection now carries the per-edge `carrier` column), fold a highlighted edge note too, make a density reference of 0 disable thinning, reflect a zero accent in the legend, preserve opened group-screen sections across re-renders, and make the native lane wait for a verified, idle view before opening relationships. Re-run on the final source: `bun run test` 131 pass; build; `GRAPH_MEASURE_NATIVE=1 bun run e2e` and `GRAPH_SOFTWARE=1 bun run e2e` (small) 11/11 each; `GRAPH_LARGE=1 GRAPH_LITERAL=1 GRAPH_MEASURE_NATIVE=1 GRAPH_CPU=1 bun run e2e` ×2: 7/7 both, first groups 310.5 / 318.0 ms, no ≥50 ms open or detail tasks, 58.1–58.2 fps, p95 17.7–17.8 ms; clustered literal explore 6/6 with no interaction long tasks; browser bench ×3: semantic first groups 202.2–210.8 ms, warm open 425.1–437.7 ms, literal 249.6–263.5 / 604.5–641.9 ms, 60.0 fps, p95 16.7–16.8 ms, no ≥50 ms tasks, heap 11.07 / 11.09 MiB. Backing storage rises to 2.60 / 6.94 MiB (from 2.39 / 6.42) because the per-edge `carrier` column and the 32-bit `carrierNodes` column now cross to the main thread. The small-hardware first-groups value of the final run was 59.3 ms (earlier runs 17.7–18.1 ms); single sample, unattributed.

### Bundle and misses

- Bundle: **173,448 minified / 54,838 gzip** on the final source (slice 6: 169,376 / 53,368; delta **+4,072 / +1,470**). `visibleCarriers` and `openSections` join the mangled private names. The bundle gate still fails against 150,000 / 45,000, pending the owner's ceiling decision; secrets, attribution, privacy, supply-chain and licenses pass.
- The 64 ms detail task (one of four pre-review runs) was not reproduced in later runs. The Groups-screen interactability failure was a harness race and is addressed by the settle wait.
- "Same" means the same displayed colour, so a rule colour and a group colour that happen to match count as one. Endpoints that are themselves edge notes are skipped, so an edge note related only to other edge notes keeps its own colour. Software FPS, iGPU, mobile and N-2 hosts are not measured.

## Retention and honest reporting

Keep raw benchmark receipts by source commit and hardware class in `.workspace/evidence/` until their summary is accepted; do not silently overwrite acceptance evidence with another fixture. Screenshots stay in ignored `test-screenshots/`, synthetic only, with visual review before sharing. Downloads/caches and reproducible synthetic outputs may be age-pruned only within their owned paths after evidence capture; there is no automatic broad cleanup. Keep per-version release checksums indefinitely with the release record. Define any future retention knob explicitly rather than deleting evidence opportunistically.

## Slice 8 expression candidate — 2026-11-11

These receipts describe the uncommitted `feat/slice8-expressions` candidate based on `87ae0b2`, not a released or independently reviewed build. Hardware scope is a Linux desktop workstation, Bun 1.3.14, Node 22.23.1; native scope is Obsidian/installer 1.13.7 and its Chromium 150. This is not mobile/integrated-GPU acceptance.

| Exact command / subset | Observed result |
| --- | --- |
| `./scripts/run.sh build` | Strict TypeScript check and plugin/Blob-worker build pass; no bundled runtime package inputs. |
| `./scripts/run.sh test` | 156 tests across 11 explicitly named files, 6,867 assertions; 25 expression tests cover syntax/canonical corpus, positioned refusals and limits, exact-type/null/missing semantics, legacy filter/group equivalence (including 10,000-member structured lists and 257-character values), dictionary materialization, scanner/save-load symmetry, historical identities, autocomplete, mixed-column kernels, and isolated-worker determinism. |
| `GRAPH_EXPRESSIONS=1 ./scripts/run.sh e2e` | Real Obsidian synthetic small vault: 3/3 tests. Positioned errors/disabled apply, debounced worker counts, completion, expression filtering without relayout on existing columns, and oversized structured-builder retention. An existing local app cache was selected with `OBSIDIAN_CACHE`; no app download or real vault was used. |
| `./scripts/run.sh bench:expressions` | Actual minified production layout-worker IIFE in a Bun Blob worker. Literal-display seed-17 fixture: 60,600 notes; three clauses combine folder membership, exact property equality, and degree comparison: 2,594 matches. Two warmups then seven samples, p95/max **9.171 ms**, below 20 ms. Timing includes parse/check, compile, filter and matched-count reduction, excludes ingest/project and transport. Exact program is in the ignored receipt; its historical fixture names are compatibility data, not a built-in category. |
| Same benchmark, six isolated worst-case samples | A 1,969-character, exactly-256-node program contains 16 property chains and 239 bounded string calls under `coalesce`. Every input is a distinct 4,096-unit string, so dictionary caching cannot collapse the work. Three samples each at 50,000 and 100,000 rows; medians **8,726.014 / 17,393.433 ms**, ratio **1.993**, inside the specified 1.5–2.5 interval. Maximum 100,000-row sample **17,534.674 ms**, below the stated **20,000 ms desktop ceiling**. The harness terminates workers and separately bounds each request at 180 seconds; it does not accept that watchdog as the performance ceiling. |
| `./scripts/run.sh gates` | Secrets, attribution, privacy, exact inert install policy/frozen-lock, and runtime-license lanes pass. The sixth lane, bundle size, **fails** at **201,786 minified / 64,139 gzip bytes**, above the then-current 180,000-byte minified / 58,000-byte gzip ceilings. Candidate is not committable/release-accepted on these receipts. |

Ignored local receipts: `.workspace/evidence/expressions-benchmark.json`, `e2e-expressions.json`, `bundle-size.json`; expression screenshots are in `test-screenshots/expressions-positioned-error.png` and `expressions-live-count.png` and were read visually. Screenshots show only synthetic historical fixture data. The production-worker count request rejected an intentionally stale revision; the unit determinism check compares two workers' counts and detailed results.

Uncovered or limited lanes: Electron-worker 60,600-note timing (the performance runtime above is Bun), native expression group/color creation and full-restart expression persistence, light-theme expression screenshots, new-property preview before materialization, and independent review. A preview on an unmaterialized key reports the missing column until Apply triggers ingestion. Adding a new view-filter column retains existing declaration/cache identity behavior; only already materialized-column filters have native no-relayout proof. No server, MCP expression tool, real vault, room install, or production/deployment acceptance is implied. Baseline evidence and other renderer/layout gaps elsewhere in this document remain in force.

### Bounded size-reduction and cancellation pass

At this historical checkpoint the frozen ceilings remained **180,000 minified / 58,000 gzip bytes**. An esbuild-metafile comparison measured baseline `87ae0b2` at **173,448 / 54,838**, the pre-pass candidate at **211,943 / 66,985**, and this tested candidate at **201,786 / 64,139**. The pass removes **10,157 minified / 2,846 gzip bytes**, while adding cancellation. This is the lowest measured complete build retained after the final presence-consistency regression fix in this pass, not a proof that further reduction is impossible. This build would require ceilings of at least **201,786 / 64,139**, increases of **21,786 / 6,139**; no increase had yet been approved and no commit had been made at that checkpoint. The later approved 205,000 / 66,000 ceilings and review-fix verification below supersede that blocked handback.

Packaging builds the common pure core as one self-contained factory and reuses its source for the Blob worker through the standard function `toString()`. It uses no `eval`, `Function`, runtime fetch, external module or new runtime dependency. A discovery build trims unused exports before the final build. Worker-only layout code remains in its IIFE; editor/autocomplete stays outside it. The parser/checker/autocomplete/reference use one callable descriptor inventory. Legacy predicates now lower to the shared dictionary kernel; an independent historical filter oracle remains in tests. Diagnostics share a compact message table.

`esbuild.config.mjs` writes `bundle-metafiles.json` alongside `bundle-inputs.json`. Byte attribution is nested: the main bundle contains the factory and escaped worker source. The shared-core and worker tables below explain those payloads and must **not** be added again to the final bundle total. Individual esbuild input contributions exclude bundle scaffolding.

| Shared-core input | Minified contribution (bytes) |
| --- | ---: |
| Expression engine | 11,945 |
| Expression syntax/check/print/descriptors | 11,013 |
| Binary-layout/cache | 7,750 |
| Explore core | 6,729 |
| Declaration | 5,949 |
| Projection | 4,173 |
| Group projection | 3,787 |
| Columns | 2,866 |
| Layout options | 1,498 |
| Legacy transform validation/descriptions | 1,021 |
| Render projection | 485 |
| GPU probe | 463 |

The complete shared-core output is **58,747 bytes**. Remaining worker inputs are layout-worker **6,895**, layout **4,195**, Barnes–Hut **2,487**, incremental layout **1,330**, generation **768**, and edge hashes **491**; its complete IIFE is **17,124 bytes**. The host-only autocomplete input is **480 bytes**, and the worker/core metafiles contain no autocomplete or editor input. The complete per-input host/core/worker breakdown, including scaffolding, is retained in the ignored `bundle-module-breakdown.json` receipt.

Three actual minified/factory Blob-worker tests use **5,000 distinct 4,096-unit values and exactly-256-node programs**. A newer count or applied filter interrupts the old evaluation; a **1 ms** explicit budget returns `Expression time budget exceeded`, without committing stale view/config state or restarting/re-ingesting the worker. The superseding cheap request completes within the asserted **2,000 ms** bound; observed latencies are in `expression-cancellation.json`. These are cancellation tests on a smaller fixture with the same maximum program/input shape, not a rerun of all 100,000 rows. The six worst-case throughput samples above use the same synchronous core kernels; normal counts use the cooperative production-worker path.

The existing `workerTimeoutMs` tuning controls the default cooperative evaluation budget at 90% of the watchdog, allowing an explicit error before whole-worker recovery. Individual `expression-count`/`explore` callers may supply positive finite `budgetMs`. Kernels check between batches (64 distinct values or 1,024 simple mask rows) and yield a task after an 8 ms slice. Cancellation does not preempt a single built-in operation, synchronous project/declared-group construction, or the final non-expression summary pass. These limits are not expanded into whole-worker/preemptive cancellation claims. No independent review or release acceptance is implied.


### Review-fix verification — 2026-11-11

This follow-up supersedes the earlier size-blocked handback. The owner-approved committed ceilings are **205,000 minified / 66,000 gzip bytes**. The independent review returned SHIP-WITH-FIXES; the fixes below were verified on its follow-up tree. No second independent review, release, room install or deployment is claimed.

| Exact command / subset | Observed result |
| --- | --- |
| `./scripts/run.sh build` | Strict TypeScript and minified shared-factory/Blob-worker build pass. |
| `./scripts/run.sh test` | **163 pass / 0 fail**, **19,246 assertions**, the same 11 explicitly named package-script files. Seven new review regressions cover linear folder nesting, identifier boundaries/canonical bracket printing, escaped persistence, legacy label collisions, pipeline cross-kind queuing, packaged applied-view preservation and raw-worker per-kind supersession. |
| `./scripts/run.sh gates` | All **6 lanes pass**: content/identity/privacy, inert install policy plus frozen lock, runtime licensing, bundle size. **202,475 minified / 64,312 gzip bytes**, SHA-256 `d7d0a5efdb701da91f5a5327ea0ff683fd5b4ad55cdb01006eee35af5b48c7fc`; zero runtime packages and no changed ceilings. |
| `./scripts/run.sh fixture --small --expressions` | Dedicated `test-vault/small-expressions`, 600 concept and 1,400 mapping notes, neutral Category names; historical fixtures stay unchanged. |
| `GRAPH_EXPRESSIONS=1 ./scripts/run.sh e2e` | **4/4**, Obsidian/installer 1.13.7, Chromium 150.0.7871.212; existing local cache selected via `OBSIDIAN_CACHE`. Fourth test reapplies a saved view while preview/member calls overlap, checking 100 matched, 100 members, 100 rendered visible notes and the persisted filter. Both final PNGs were read: positioned regex refusal/disabled Apply and readable Category labels with 100 / 600 live feedback. |
| `./scripts/run.sh bench:expressions` | Neutral seed-17 literal fixture, **60,600 notes**, **2 warmups + 7 timed samples**, **2,594 matches**; normal p95 **8.293 ms**. Six worst-case samples, 3 each at 50k/100k; medians **8,841.545 / 17,408.653 ms**, ratio **1.969**, maximum **17,435.593 ms**. All three acceptance checks pass. |

**B1:** the mixed `file.inFolder` kernel reads its child once. The other kernels/evaluator were checked for repeated child evaluation; lazy `if` and Boolean branches remain lazy. At nesting depths 4, 8, 10, 12, 14 and 15 over 2,000 rows, the deterministic regression counts exactly **2,000 × depth** path reads. The independent probe's depth-15 case fell from 3,579.1 ms to 2.3 ms; wall-clock variation is not used as the linearity assertion.

**B2:** applied explore and preview-count requests supersede only the same kind in both the pipeline and raw worker; member reads never cancel either. The main view's latest-wins cancellation explicitly names explore. Existing same-kind cancellation and 1 ms transactional budget regressions still pass. The raw-worker regression additionally covers queued evaluations, not only the serialized pipeline.

**B3:** chunk boundaries use at most 24 JSON-escaped units, including correct handling of quote/backslash/control and supplementary characters. The guard includes a possible trailing JSON comma, scans expression/view-state payload string values, and deliberately excludes schema keys and untouched legacy declaration fields. A short escaped source string may need encoding too. Quote/backslash-heavy expressions round-trip exactly with zero long serialized payload runs. The accepted legacy 100,000-character declaration literal still saves unchanged; it retains the documented pre-existing scanner limitation, not a migration or rejection.

Identifier tokens are capped at **128 units** with positioned errors; longer in-cap bracket keys print back to brackets and remain valid, including autocomplete. Structured legacy keys are not newly capped. Operation-produced groups deliberately preserve historical string keys (`1` and `"1"` collide); raw property groups retain distinct typed dictionaries. These are compatibility choices, not claims of typed operation-result grouping.

Receipts remain in ignored `expression-nesting.json`, `expression-cancellation.json`, `e2e-expressions.json`, `expressions-benchmark.json` and `bundle-size.json`. The initial native attempt exposed duplicate synthetic fixture IDs when renamed paths shared the historical fixture; the corrected dedicated fixture passed. Historical synthetic files were restored after a verified backup. No real vault was used. All uncovered runtime/device/group-color/restart/materialization lanes listed above remain uncovered by this follow-up.

## 0.5.2 physics-controls candidate — 2026-11-12

The initial physics-controls implementation measured **208,358 minified / 66,039 gzip bytes** (gzip level 9), versus its 0.5.1 base **204,990 / 65,145**: **+3,368 / +894 bytes**. The bounded download ceilings for this slice are now **212,000 / 67,200**; correctness, independent review, deployment and runtime-performance gates remain. Final preparation commands/tree checksums belong to private receipts, not a released-build claim.

The focused command `flock /tmp/openclast-local-verification.lock build-contained -- bun test tests/physics-controls.test.ts tests/view-lifecycle.test.ts tests/layout.test.ts tests/pipeline.test.ts` passed **57 tests, 726 assertions, four files** in the repaired local invocation. Failed fixture logs remain preserved. The test repair collects actual worker rejection before synchronous assertions instead of the asynchronous rejection matcher; older/future stale revisions, invalid options, exact RPC ownership, late responses, queued disposal and unchanged prior generation remain checked. Full default package tests and gates remain required. Native visuals and interaction performance are **UNOBSERVED**; no dense-graph cure or indexing acceleration is claimed.

The same-renderer/context candidate subsequently measures **211,202 minified / 67,033 gzip bytes** (gzip level 9), under the bounded **212,000 / 67,200** download allowance. This budget-only release preparation freezes the runtime implementation; source, bundle and complete staged-candidate hashes are retained privately. Corrected deterministic fixtures own frame/backstop lifecycle work; their success does not establish native GPU, nontrivial scope, target-scale latency, memory or mobile acceptance. Independent review and the remaining native lanes are still required.

The owner-approved bounded download ceilings for the controls preview are **227,000 raw / 72,000 gzip bytes** (previously 224,000 / 71,000). Correctness, independent review, deployment and native/runtime acceptance gates are unchanged.

## Bounded bundle cleanup - 2026-11-17

Against `904072f`, `main.js` shrinks from **395,779 raw / 134,070 gzip-9 bytes** to **393,479 / 133,636**, saving **2,300 / 434 bytes**. The unchanged **395,000 / 134,000** caps leave **1,521 / 364 bytes** of headroom. This meets the bounded 2,000 raw / 400 gzip target.

The change shares repeated GL texture/buffer/attribute setup and contribution headings, adds the unchanged scheduler and edge-hash modules to the existing shared-core factory, extends the existing main-only/shader-private name allowlists, and removes unreachable prominence-only branches from the advanced sizing fields. GL operation order, uniforms, attributes, visible copy, settings, worker messages and validation are unchanged. Compiled-test access to the newly mangled names uses the existing emitted cache; no tests or assertions were removed.

On a Linux x86-64 development workstation, `build` and `test --timeout 10000` pass through `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh <arguments>`, retaining the inner containment lock. The full suite reports **787 pass / 1 existing skip / 0 fail**, **996,880 assertions**, across 38 files. Private build/test receipts are `.workspace/build-size-cleanup.log` and `.workspace/test-size-cleanup.log`; `scripts/bundle-size.mjs` records the gzip-9 measurement in `.workspace/evidence/bundle-size.json`. Independent source review found no blocking issue. No native screenshots or hardware performance measurements were added; existing runtime acceptance limits remain.

## Bounded bundle size reclamation — 2026-11-15

Against baseline `f603cbb`, the retained build-only change reduces `main.js` from **354,038 raw / 117,705 gzip** to **349,822 raw / 117,167 gzip** (gzip level 9): **4,216 / 538 bytes saved**. The unchanged **355,000 / 118,000** caps leave **5,178 raw / 833 gzip bytes** of headroom. The requested 10,000 / 3,000 reduction target is **not met**. This is the measured safe candidate retained, not a claim that further optimization is impossible.

The existing esbuild minification, GLSL comment/whitespace stripping, shared-core factory, used-export discovery and runtime-dependency exclusion were already active. Metafiles and source-map spans identify these largest baseline main-bundle inputs:

| Input | Raw contribution | Standalone gzip |
| --- | ---: | ---: |
| Detail renderer | 70,426 | 23,979 |
| Shared-core factory/prelude | 63,342 | 20,907 |
| Main plugin/view, including embedded worker | 63,170 | 20,016 |
| Explore panel | 46,831 | 15,026 |

The source-map span attribution includes one extra boundary byte for main compared with esbuild's input contribution. Standalone gzip compresses each module separately; the private profile also records the whole-bundle gzip delta when each module's spans are omitted. Neither compressed measure is additive. Nested core/worker input sizes must not be added again to the complete main bundle.

| Retained step, in measurement order | Raw saved | Gzip saved |
| --- | ---: | ---: |
| 67 additional private class member names | 3,247 | 377 |
| 16 main-realm panel/renderer callback names | 969 | 161 |
| Total | **4,216** | **538** |

Only the existing explicit `mangleProps` allowlist changes generated runtime code. No `src/` file, UI text, validation, persisted schema, worker protocol, dependency, shader transform or bundle cap changes. The new gate reads settings/node-sizing property signatures through the already-installed TypeScript compiler, including optional and unquoted keys, and excludes them from mangling. Existing DOM/ES/Obsidian, worker/harness and string-literal exclusions remain intact. Compiled-renderer tests resolve affected private names through the existing emitted cache rather than assuming the original spelling.

Rejected private prototypes remain in ignored evidence, not the build: receiver aliases saved raw bytes but increased gzip; property-key interning traded substantially fewer raw bytes for only small gzip savings and introduced dynamic lookups with unmeasured runtime cost; shader-private-name shortening saved only another 471 raw / 51 gzip bytes on the first mangling candidate, insufficient to justify a new shader transform. User-visible strings and errors were not shortened. No validation, feature branch or security boundary was removed to chase the target.

Verification ran on a Linux x86-64 development workstation. Every command below used `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh <arguments>`; `run.sh` retained its separate containment lock.

| Arguments | Observed result |
| --- | --- |
| `gates:fast` before build/testing | All five prerequisite lanes pass, including the isolated frozen-lock install with scripts disabled. |
| `build` | Strict TypeScript and production main/shared-core/worker build pass. |
| `test --timeout 10000` | **527 pass / 0 fail**, **145,019 assertions**, 34 package-script files, including production-bundle renderer seams and packaged-worker tests. |
| `gates` | All **six lanes pass**; zero runtime packages, unchanged lockfile/trust policy, unchanged size caps. |

Independent review found no blocking issue in the allowlist, schema guard or compiled-test seam changes. This pass did not rerun native-host, browser, shader-driver or hardware-performance lanes; their existing acceptance gaps remain. No publication, real-vault access or deployment occurred. Private evidence is retained under `.workspace/evidence/size-reclaim/` (baseline/final profiles, prototype outputs, build/test/gate logs); `.workspace/evidence/bundle-size.json` records the current source commit, tree state and artifact hash.

## Edge haze line share — 2026-11-15

Real Obsidian 1.12.7 in the OpenClast browser-native harness (headless Playwright Chromium). The Notes view was forced onto WebGL2 by overriding the view's GPU probe, because the renderer is SwiftShader. Pixels and blending come from the real shader path; frame times are CPU rasterization, not GPU numbers. The vault is synthetic: 16,000 notes in 93 folder groups, 33,500 cross-group relationship notes (a third with two targets), in-group wikilinks and a parent hierarchy, for 52,511 drawn edges. Settings are the owner's edge settings (opacity 0.155, color mix 0.8, curved, Edges All, Adapt to zoom) with the shipped defaults otherwise. All three cameras are fixed world framings of the connected web, the same before and after.

| Camera (world ratio) | Metric | Before (001e8ff) | Line share |
|---|---|---:|---:|
| 0.0237 (near) | field median luminance (background 0.0130) | 0.0267 | 0.0145 |
| 0.0237 | pixels changed by the edge pass, ≥1 / ≥8 levels | 91.6% / 76.8% | 29.0% / 15.5% |
| 0.0237 | edge-added mean luminance | 0.01162 | 0.00169 |
| 0.0237 | SwiftShader frame (draw + 1 px readback) | 2,352 ms | 914 ms |
| 0.0710 (mid) | pixels changed, ≥1 / ≥3 levels | 27.3% / 9.4% | 2.6% / 1.5% |
| 0.213 (web fit) | pixels changed, ≥1 level | 0.7% | 0.04% |

The before frame is a uniform veil: about 8 lines overlap each core pixel, each at roughly 1.5 eight-bit steps, and the dither turns them into grain. Node glow at the mid camera touches 71% of pixels but adds 0.0043 mean luminance, so it is not the field haze and was left unchanged.

Verification is `build` and `test --timeout 10000` (532 pass / 0 fail), plus `gates`, where all six lanes pass. The bundle is 350,298 raw / 117,382 gzip against the 355,000 / 118,000 caps (+381 / +175 bytes). This is single-run, synthetic evidence on a software rasterizer, not native GPU, FPS or real-vault acceptance.

## Importance-ranked overview — 2026-11-15

The next renderer candidate (`2979e8a`, based on `d29955f`) redistributes the existing context-line share toward endpoint degree, declared interest and cross-group edges. Importance alone does not enlarge the requested share. The final refinement adds an overview allowance to the same geometry-derived budget, capped at eight shares and fading to one by home/8, while keeping adaptive retained-line opacity constant rather than boosting it close up. Retained detail lines avoid the second density-opacity penalty. Strong focus has a continuous direct-neighbour-count target rather than the former 50-neighbour cutoff; all focus-tier lines retain their admission exemption. Canvas and WebGL share the rank column, admission threshold, picking and emphasis policy, but not identical rasterization.

The before/after recipe reuses the preceding synthetic 16,000-note / 52,511-edge fixture, fixed 1,210 × 700 canvas and world cameras, owner edge settings and default node sizing. It runs actual Obsidian through the existing OpenClast harness, with only the synthetic GPU probe overridden for SwiftShader WebGL2. Each invocation is bounded to 25 minutes and serialized with `flock -w 1800 /tmp/graph-ng-harness.lock`. Private owner screenshots were inspected locally as visual references, never used as fixtures or copied into the repository. All runtime receipts and screenshots remain ignored under `.workspace/overview-qa/runs/`.

The baseline receipt is `before2.json`; the earlier `before.json` hub camera was invalid and is excluded. The selected synthetic hub has 491 incident rows and 351 distinct visible neighbours, not exactly 483 neighbours. A separate compiled Canvas regression uses exactly 483 neighbours and verifies that all 483 edge segments are stroked even with zero context admission, with the degree-scaled target and explicit zero-opacity opt-out intact. The extra `old-veil-near` baseline probe disables both line admission and length control; it is a diagnostic, **not** an exact reconstruction of historical `001e8ff`. Historical veil comparisons use the preceding benchmark table instead. The haze recipe freezes the graph theme; files ending `.light.png` therefore do not establish light graph-theme acceptance.


### Measured result and remaining visual gap

`refine.json` is the final measured candidate (bundle SHA-256 `f835ef4971c9f886763f41b67f68b4e5b5b192b9a3bcf531b4c6d42f00b67032`). `after.json` records the rejected first candidate: its near-view edge-added luminance was 0.01273, above the historical veil's 0.01162. The refinement removes the close-zoom opacity boost, rather than hiding focus edges to lower the measurement. Both baseline and final harness runs completed with no console/page errors and completed teardown.

| Camera | Metric | Baseline `before2` | Final `refine` |
|---|---|---:|---:|
| Fit all (home) | pixels changed by edges, ≥1 / ≥8 levels | 0.01% / 0% | 0.01% / 0.01% |
| Connected web, ratio 0.2130 | pixels changed, ≥1 level | 0.04% | 0.04% |
| Mid, ratio 0.0710 | pixels changed, ≥1 / ≥8 levels | 2.63% / 0.02% | 3.28% / 2.08% |
| Mid | edge-added mean luminance | 0.00007 | 0.00031 |
| Near, ratio 0.0237 | pixels changed, ≥1 / ≥8 levels | 29.04% / 14.96% | 35.27% / 33.47% |
| Near | edge-added mean luminance | 0.00167 | 0.00332 |
| Near | field median luminance (background 0.01298) | 0.01450 | 0.01670 |
| Selected hub, ratio 0.0237 | edge-added mean luminance | 0.05193 | 0.05104 |
| Selected hub | field median luminance | 0.06783 | 0.06344 |

The final unselected near frame has more legible retained strokes than the line-share baseline, but remains below the **historical veil** in coverage (35.27% / 33.47% versus 91.6% / 76.8%), median luminance (0.01670 versus 0.0267), and edge-added mean luminance (0.00332 versus 0.01162, 71.4% lower). The selected hub is a separate intentional emphasis state, not an unselected haze comparison: its bright direct fan is clearer while total edge-added light is slightly below its own baseline. Label plates change full-scene luminance; haze measurements therefore compare edge-on/off within each candidate, not full-scene means across different label treatments.

Visually inspected dark screenshots show readable mid-zoom labels and a distinctly stronger direct hub fan against weaker two-hop lines. **The fit-all synthetic overview still reads as a dense dot ball.** Its edge coverage remains only 0.01%; these receipts do not establish that global cluster structure is now readable. Default synthetic node coverage and the fixed layout remain limiting, and the task does not change layout. Glyph-quad plate overlap remains a point for independent visual review; no blanket typography or light-theme acceptance is claimed.

Evidence pairs are `before2` / `refine` with suffixes `.step-21-overview.dark.png`, `.step-27-web-mid.dark.png`, `.step-30-web-near.dark.png`, and `.step-36-hub-selected.dark.png`, all beneath `.workspace/overview-qa/runs/`. These are synthetic images; private reference images remain outside the repository.

Exact capture invocations from the isolated worktree were `bash .workspace/overview-qa/serial-run.sh before2 plugin-before vault-16k before2.json 25` and `bash .workspace/overview-qa/serial-run.sh refine plugin-refine vault-16k refine.json 25`. The wrapper owns the shared browser lock. Verification uses the required outer `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh` prefix with `build`, `test --timeout 10000`, and `gates`; the inner local-verification lock remains owned by `scripts/run.sh`, never recursively acquired. Results: **554 tests pass, zero fail, 146,515 expectations; all six gates pass.** Bundle: **351,887 raw / 117,977 gzip / 101,879 Brotli**, leaving 3,113 raw and 23 gzip bytes under the unchanged caps. No overage. Software-rasterizer frame measurements are retained in the JSON but do not establish hardware GPU performance, FPS, mobile acceptance or real-vault acceptance. Independent senior review remains parent-owned and pending.

## Small-dot labels and isolated fan repair — 2026-11-15

Based on `125be11`, this follow-up retains per-label plates, turns tiny-dot label suppression into a rank cutoff, applies whole-annotation viewport insets, and moves the existing isolated-focus edge pass above opaque nodes in both renderer paths. It also clears stale hover replay on Escape and serializes Notes/Group overview through public per-view workspace state. Top-decile cross-group bridges receive a 10% rank discount at view time: this strengthens admission rather than increasing each stroke's opacity. The GPU rejects unadmitted context rows before texture/curve work where possible; compiled command-driver tests guard against per-frame endpoint/degree scans and an extra edge pass.

The paired synthetic runs use 16,000 notes, 93 groups, 52,511 drawn edges and a 1,210 × 700 graph canvas on a Linux desktop-class host with SwiftShader WebGL2. The selected synthetic hub has 698 incident rows and 492 distinct direct connections; reach 2 displays 7,601 notes and 43,183 edges. The fixture contains no real-vault content. Both `before2.json` and `after.json` completed every step with no console/page errors and completed teardown. Receipts and images remain ignored under `.workspace/visual-qa/runs/`.

| State | Metric | Baseline `before2` | Candidate `after` |
|---|---|---:|---:|
| Fit all | pixels changed by edges, ≥1 level | 0.01% | 0.01% |
| Mid, home ratio 0.1602 | pixels changed, ≥1 level | 3.42% | 3.72% |
| Mid | edge-added mean luminance | 0.00031 | 0.00035 |
| Near, home ratio 0.0534 | pixels changed, ≥1 level | 35.46% | 38.05% |
| Near | edge-added mean luminance | 0.00332 | **0.00368** |
| Only connections, reach 2 | pixels changed, ≥1 level | 1.07% | 12.99% |
| Only connections | edge-added mean luminance | 0.00006 | -0.00465 |
| Fit all | synchronized software-raster frame, ms | 617.80 | 567.97 |
| Mid | synchronized software-raster frame, ms | 723.27 | 627.77 |
| Near | synchronized software-raster frame, ms | 744.73 | 868.43 |
| Only connections | synchronized software-raster frame, ms | 1,645.60 | 1,182.63 |

Near-view added luminance remains below the requested 0.005 ceiling. Negative added luminance in the isolated fan is not missing ink: the now-visible lines overlay brighter opaque dots. Pixel change coverage and visual inspection show the fan where the baseline was an opaque dot cloud. At node size 0.7 and camera/home ratio 0.27, the baseline has no visible hub names; the candidate has legible ranked names on separate plates. Whole-label rejection prevents partial edge glyphs rather than cropping their text.

**The software-GL performance finding is not closed.** Five-frame sequential overview-ablation medians (full / plates off / edges off / straight / overview allowance off) were 546.7 / 577.1 / 279.2 / 626.5 / 496.2 ms before, and 790.3 / 628.8 / 273.5 / 564.3 / 690.6 ms after. Their order-sensitive variation contradicts a simple speedup claim; near-view timing also regressed in the paired sample. Edge-off measurements identify substantial edge-pass cost, but these runs do not isolate a reliable plate or rank-admission cost. CPU submission `maxDraw` was 4.5 versus 6.6 ms before hub selection, far below synchronized software raster time. No hardware-GPU FPS claim follows. Fit-all edge coverage remains unchanged: the global dot-ball/readability gap is also still open.

Visually inspected synthetic pairs include `.step-33-small-dot-mid.dark.png` and `.step-38-hub-only.dark.png`. Exact paired invocations were `bash .workspace/visual-qa/run.sh before2 plugin-before vault-16k before2.json 25` and `bash .workspace/visual-qa/run.sh after plugin-after vault-16k after.json 25`. The wrapper serializes each bounded run with `flock -w 1800 /tmp/graph-ng-harness.lock`. The paired haze recipe freezes graph theme, so its `.light.png` suffixes alone do not establish light graph-theme acceptance. The measured bundle predates the final tiny-viewport pip guard and redundant hover-clamp deletion; neither changes the table's edge-admission/layering equations. Private reference screenshots were inspected locally without copying them.

A follow-up `bash .workspace/visual-qa/run.sh reload-theme plugin-after vault-16k reload-theme.json 25` attempted actual graph-theme refreshes and an explicit public leaf-state roundtrip across plugin disable/enable. It **aborted during session startup**, before any of its 45 steps, with `page.waitForFunction` timing out after 526,000 ms; teardown completed. Empty console/page-error arrays and the shell wrapper's exit status are not acceptance evidence. The host was under severe memory/I/O pressure with swap exhausted. No further browser runs were attempted. Thus actual light graph-theme acceptance and native disable/enable restoration remain unverified; deterministic view-state tests establish serialization/validation and ready-versus-cold handling only. Automatic native workspace reopening is not established by the explicit-roundtrip recipe either. The earlier candidate receipt serializes `{presentation: 'nodes'}`, where the baseline returned `{}`, but is not a reload test. Real-data visual acceptance is deferred to a later idle-machine session, and independent senior review remains parent-owned.

The last completed candidate build and `test --timeout 10000` passed **564 tests, zero failures, 146,869 expectations across 35 files** (`.workspace/visual-qa/test-third.log`). They precede the final small-viewport pip guard, redundant hover-clamp deletion and nonvacuous pip assertion. That built bundle measures **353,405 raw / 118,465 gzip / 102,343 Brotli bytes**, SHA-256 `f93e76d367ed08664df66a9f7256ab5b84f3ccb0c59bbb4e6f11a9718dd622f9`: 1,595 bytes below the raw ceiling and **465 gzip bytes over** the unchanged 118,000-byte ceiling. This is the last measured bundle, not a claimed final-source size. Initial five-lane fast gates passed; renewed secrets, attribution and privacy scans also passed after the documentation changes. A final build followed by tests, using the required outer lock/timeout prefix, remained queued behind another verification process until the background task reached its lifetime limit and was stopped without build/test output. It was not restarted. Full final gates and final-source bundle size remain pending. No cap was edited and no memory-pressure failure was retried. These receipts do not constitute release acceptance.


## Density edge compositing — 2026-11-16

**Decision: keep Blend as the default; expose Density for comparison.** Density lowers edge-added light substantially at mid and close zoom, but makes individual context strokes fainter. The overview is still dominated by overlapping nodes; this is not a global readability fix. The measured software-rendering cost also increases. There is no hardware-GPU, mobile or real-vault acceptance claim.

The candidate adds `visuals.edgeCompositing: 'blend' | 'density'` to Appearance. Density keeps the same ranked/long-line admission and picking, quarter-scales premultiplied context ink into one additive RGBA8 target, and tone-maps accumulated alpha `d` with `min(.9, .2*d + .8*d*d/(1+d*d))`. One fullscreen quad then composites it before the unchanged focus/hover/path strokes. Unsaturated endpoint-color interpolation remains, but looks subdued with the lower coverage; mixed crossing colors are not promised to become distinct bundles. Saturation uses the configured edge color, avoiding clipped-color whitening. The target is CSS-resolution, capped at 2048 pixels per side (16 MiB maximum); Canvas and target-allocation failures use the existing Blend path. No float extension is needed.

### Paired synthetic host pixels

The OpenClast browser-native Obsidian harness used headless Chromium/SwiftShader WebGL2 on a general-purpose x86-64 Linux machine with 32 GiB RAM. The original synthetic 16,000-note, 52,511-edge fixture, opacity .155, color mix .8, curved edges and Adapt to zoom were retained. Each camera compared both modes in the **same live renderer**, with matching graph positions, labels, theme and admission. The target and drawing buffer were 1210×700 pixels at DPR 1. The metric is the existing linear-sRGB luminance calculation, subtracting an Edges Off frame within each mode. Figures rounded to five decimals cannot distinguish zero from a very small contribution.

| Camera (world ratio) | Metric | Blend | Density |
| --- | --- | ---: | ---: |
| Overview (0.21305) | field median luminance | 0.01298 | 0.01298 |
| Overview | edge-added mean luminance | 0.00000 | 0.00000 |
| Overview | pixels changed by edges, ≥1 / ≥8 levels | 0.04% / 0.02% | 0.03% / 0.00% |
| Mid (0.07102) | field median luminance | 0.04075 | 0.03851 |
| Mid | edge-added mean luminance | 0.00035 | 0.00011 |
| Mid | pixels changed by edges, ≥1 / ≥8 levels | 3.72% / 2.27% | 3.33% / 0.20% |
| Close (0.02367) | field median luminance | 0.01808 | 0.01461 |
| Close | edge-added mean luminance | 0.00368 | 0.00106 |
| Close | pixels changed by edges, ≥1 / ≥8 levels | 38.05% / 35.96% | 37.47% / 3.27% |

Edge-added light is approximately **69% lower at mid and 71% lower close up**. Similar ≥1-level coverage confirms that this comparison mostly changes edge intensity rather than dropping more admitted lines. It does not establish that every faint edge is individually legible. The overview and mid screenshots still have a node carpet; close-up backgrounds are darker, with less distinct single context lines. All six dark paired frames were visually inspected: `.workspace/visual-qa/runs/density.step-{22,24,27,29,32,34}-*.dark.png`. The recipe freezes graph theme, so generated `.light.png` siblings do not establish light graph-theme acceptance.

Three sequential draw-plus-one-pixel-readback samples per case average **560.17 / 787.27 ms overview**, **633.70 / 863.70 ms mid**, and **663.77 / 914.30 ms close**, Blend / Density. This single order-sensitive software-GL run suggests extra raster cost (36–41%), **not a GPU FPS estimate**. The 35-step run passed with zero console errors, page errors or unhandled rejections and completed teardown. A forced incomplete target produced pixels identical to Blend; restoring target availability recovered density drawing.

A separate synthetic 3,000-note / 12,688-edge smoke run passed all 24 steps, including the actual Appearance dropdown, a DPR change from 1 to 2 (target remained 1210×700; drawing buffer and viewport became 2420×1400), and WebGL context loss/restoration with a fresh density framebuffer and no GL error. Its receipt is `.workspace/visual-qa/runs/density-smoke.json`. This exercises software-driver restoration, not mobile/hardware-driver support.

Exact invocations were `bash .workspace/wave7-density/run-visual.sh` and `bash .workspace/wave7-density/run-smoke.sh`; each acquires `flock -w 1800 /tmp/graph-ng-harness.lock` plus the outer Bun serialization lock, rechecks `free -g` inside both locks, and invokes the existing bounded browser-native harness on synthetic fixtures only. Available memory at launch was 10 and 11 GiB respectively. The paired receipt is `.workspace/visual-qa/runs/density.json`; generators, copied plugin and raw logs stay ignored.

### Deterministic evidence and size

The baseline at `73c03e2` builds to 355,389 raw / 119,285 gzip bytes. This track builds to **357,999 raw / 119,994 gzip bytes**, a **+2,610 raw / +709 gzip** delta, within both the approximately 900-gzip-byte track allowance and unchanged 365,000 / 122,000 caps. Build SHA-256: `2f4f03e96a67cde7ec50e260fbdfe7de2f00b5604c39f41c5e1e68a6317a60b7`. Runtime dependencies and trusted install hooks remain absent.

Tests cover enum validation/migration, monotone bounded tone mapping, zero opacity, protected-tier splitting, exact Blend pass selection, one-target reuse, bounded allocation, cached framebuffer/allocation failure, restoration/disposal and identical Canvas fallback. The base revision has one independently reproduced pre-existing failure: `review: a failed Back-to detail attempt consumes pending focus before any early return` lacks the new `app.workspace.requestSaveLayout` fixture seam. The coordinator owns that separate fix in `7529998`; this track does not duplicate it. Final verification used `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh` with `gates:fast`, `build`, `test --timeout 10000`, the same test command plus `--test-name-pattern '^(?!review: a failed Back-to detail attempt)'`, and `gates`, in that order. Build and all six final gates passed. The full suite reports **570 pass / 1 known baseline failure**; excluding exactly that coordinator-owned case reports **570 pass / 0 fail / 1 filtered**, 155,176 expectations across 35 files. Logs are `.workspace/wave7-density/final-{build,tests,tests-subset,gates}.log`. Independent merge review remains parent-owned.

## Adaptive highlight emphasis — 2026-11-16

Based on `73c03e2`, `visuals.emphasis` adds **Adaptive** (default, including saved settings missing the key) alongside **Scale**, which retains the prior magnification. Adaptive uses screen-pixel targets and cached focus-set counts to reduce neighbour growth and context opacity when many notes are highlighted. It does not shrink normally large dots, change tier membership, move the camera/layout, or add a projection traversal or coordinate upload per frame. The selected note keeps its contrast rings; hover keeps its existing timing with target-based growth. The policy and equations are recorded in ADR-0005.

The actual-app comparison uses the browser-native Obsidian harness on a Linux desktop-class host with SwiftShader WebGL2 (synthetic GPU-probe override), **3,000 synthetic notes and 12,688 edges**. Dense focus has 698 incident rows, 285 unique direct notes and 1,639 two-hop notes; sparse focus has one incident row, one direct note and 115 two-hop notes. Each pair uses the same layout and camera. Dense/sparse camera ratio is 0.05656886; overview is 0.20286354. Radii below are CSS pixels reported by the shared CPU radius helper, not image-derived measurements.

| State | Metric | Scale | Adaptive |
| --- | --- | ---: | ---: |
| Dense focus | Mean direct-note radius | 9.7343 | 6.7043 |
| Dense focus | Selected radius | 27.2 | 17 |
| Dense focus | Context opacity | 0.12 | 0.036 |
| Sparse focus | Direct-note radius | 12.4160 | 9.8517 |
| Sparse focus | Selected radius | 10.4517 | 7 |
| Sparse focus | Context opacity | 0.12 | 0.06472 |
| Overview, same dense focus | Mean direct-note radius | 9.7343 | 6.7043 |
| Overview, same dense focus | Selected radius | 27.2 | 17 |

All twelve paired images were visually inspected in actual light and dark graph themes. Adaptive reduces the enlarged-dot carpet while preserving the selected double ring and sparse-note legibility. The overview remains densely overlapping: this is an emphasis policy, not collision avoidance. The dense direct-edge fan remains bright. One sparse dark Adaptive capture has a minimap frame/crosshair without the expected density image; minimap/theme-refresh acceptance is not established by this comparison.

Exact final capture command: `bash .workspace/visual-qa/run.sh emphasis-final plugin-emphasis-final vault-3k emphasis-final-steps.json 12`. The wrapper owns `/tmp/graph-ng-harness.lock`; admission had 10 GiB available and no concurrent local build/test job. The receipt `.workspace/visual-qa/runs/emphasis-final.json` records all **33 steps passed**, no page/console errors, all six sampled `glError` values zero, and completed teardown. Its overall verdict remains **unknown (`harness-empty-list`)**, not blanket acceptance. The earlier `emphasis` run inherited a frozen graph theme and is not used for light-theme evidence. Paired final images under `.workspace/visual-qa/runs/` are `emphasis-final.step-21-dense-scale`, `emphasis-final.step-23-dense-adaptive`, `emphasis-final.step-26-sparse-scale`, `emphasis-final.step-28-sparse-adaptive`, `emphasis-final.step-31-overview-scale`, and `emphasis-final.step-33-overview-adaptive`, each with `.dark.png` and `.light.png` suffixes.

Verification uses `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh <arguments>`; `run.sh` retains its own containment lock. Ordered `gates:fast`, `build`, and `test --timeout 10000` passed: **571 tests, zero failures, 147,594 expectations across 35 files**. Tests execute the compiled renderer and compare Canvas arcs, bundled GLSL scalar equations and hit radii across tier, zoom, fan-out, easing, size policy and target settings; compiled-driver assertions verify uniforms and zero coordinate uploads. This establishes radius-policy parity, not identical rasterization. The inherited Back-to-detail fixture needed a missing `requestSaveLayout` stub; its baseline failure reproduced alone and in the full suite, not just by test order. Final `gates` passed all six lanes after a fresh build and the same 571-test suite; the rebuilt artifact hash matches the captured bundle.

Bundle baseline: **355,389 raw / 119,285 gzip bytes**. Candidate: **357,010 raw / 119,780 gzip bytes**, a delta of **+1,621 raw / +495 gzip** under the unchanged 365,000 / 122,000 caps. Captured `main.js` SHA-256: `fbb95ca265bb6e83fa55125deb9e0fb025ba4fa8fd353ad5721a545d48f8adc3`. Final receipts remain in `.workspace/preflight-closeout.log`, `.workspace/build-closeout.log`, `.workspace/test-closeout.log` and `.workspace/gates-closeout.log`; the source/tree-bound size receipt is `.workspace/evidence/bundle-size.json`. Independent senior review is parent-owned for the merged tracks and remains pending. Software-renderer captures do not establish physical-GPU performance, 60k-note FPS, mobile, real-vault, or release acceptance. No publication occurred.

## Wave 10 canvas chrome and status text, 2026-11-16

Track S is based on `2063a4e`. The main bundle changes from **372,405 raw / 124,844 gzip bytes** to **373,015 raw / 125,084 gzip bytes** (**+610 raw / +240 gzip**, level 9). The unchanged caps remain 375,000 raw / 126,000 gzip. The reusable text-only status helper preserves the current span on numeric progress updates, cross-fades stage changes for 140 ms, and applies the 1.6 s CSS sweep only while busy. It adds no JavaScript animation loop or timer. Reduced-motion CSS makes both transitions static; forced-colors CSS preserves readable text. Panel-owned saving/applying integration and independent merged-wave review remain coordinator-owned. The path finder is synchronous in this base and has no pending state; this chrome change does not add artificial scheduling or alter its traversal.

Ordered verification used `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh` with `gates:fast`, `build`, `test --timeout 10000`, and `gates`. All **638 tests** and all six full gates passed. Three new tests cover progress-span continuity, text-only bounded transition nodes, completion, supersession, stale views and close cleanup. Deterministic receipts are `.workspace/evidence/{preflight,build-after,test-final,gates-final}.log` in the track worktree.

The synthetic browser-native Obsidian harness ran on a Linux desktop-class host with software WebGL and 120 notes / 199 edges, under `/tmp/graph-ng-harness.lock`, with at least 8 GiB available before launch. The final command was `.workspace/visual-qa/run.sh wave10-s-final plugin-wave10-s-after vault-wave9-critic steps-wave10-s-after-proof.json 8`; its **26 steps passed**, with no page or console errors and completed teardown. The capture pass covers wide/narrow search, keyboard X dismissal and returned canvas focus, a held search reply, reading/layout stages, progress-span identity and static completion. Loading counters are explicit synthetic status fixtures, not a timed ingestion benchmark. All before/after images in both themes were visually inspected. Before evidence is `.workspace/visual-qa/runs/wave10-s-before*`; final evidence is `.workspace/visual-qa/runs/wave10-s-final*`. Early attempts retained stale renderer handles across harness theme refreshes and are not clean-pass receipts. This is visual and deterministic evidence, not physical-GPU, reduced-motion device, mobile or release acceptance. No upload or publication occurred.
## Bounded motion and first-painted handoff — 2026-11-16

Based on `2063a4e`, this slice replaces perpetual hovered-note breathing with a 150 ms settle and two gentle one-second breaths, then no animation frames while the pointer remains still. Focus uses interruptible 220 ms cubic easing. `visuals.motion` defaults to `full`; `reduced`, `off`, and a live OS reduced-motion preference settle camera, focus, lens and hover immediately and suppress selection ripples. Reduced and Off intentionally have identical renderer behavior here. The Appearance dropdown belongs to the parallel integration track. Motion updates scalar state, not per-node animation buffers or textures; existing capped label/pip work still runs on painted frames.

### Idle and animation cost

The browser-native Obsidian harness ran a synthetic **120-note / 199-edge** fixture using Canvas on a general-purpose x86-64 Linux desktop with 32 GiB RAM. Stable-renderer assertions exclude startup metadata replacement. In the baseline, a 2,700 ms hover window painted 163 frames and the next 600 ms painted **36 unwanted frames**. The stable candidate painted 131 frames and then **zero frames in 600 ms**, including Reduced mode; median/p95 draw submission was 0.5/0.9 ms. The final cold-handoff run repeated 131 frames and zero idle frames, with 0.6/1.1 ms median/p95. Baseline median/p95 was 0.5/0.7 ms. Timing is a small local sample, not a latency or speedup guarantee.

A separate production-bundle command-stub probe uses **61,000 nodes / 100,000 edges** with deterministic grid coordinates. WebGL sees the full fixture; Canvas uses the existing limit-safe 128-note visible mask, not 61,000 visible Canvas dots. Each hover paints 136 fake-clock frames and then queues none. Both paths perform **zero coordinate uploads during animation**.

| Command-stub path | Hover median / p95, ms | Camera median / p95, ms | Idle frames |
| --- | ---: | ---: | ---: |
| WebGL, full projection | 0.692153 / 0.970240 | 0.713723 / 0.887371 | 0 |
| Canvas, 128 visible notes | 0.351153 / 1.008880 | 0.356300 / 0.426026 | 0 |

These costs measure JavaScript command submission with synthetic DOM/drawing APIs, **not GPU rasterization, browser layout, display latency, or hardware-GPU FPS**. The camera sample contains 29 frames. Raw receipts remain ignored in `.workspace/motion/frame-cost.json` and `wave10-m-{before-stable,after-stable,handoff}.json`.

### Preview handoff and visual scope

The cold-seed handoff probe passed all 13 steps. It forces a fresh layout seed and 200 iterations, delays delivery of the actual layout result by 400 ms to allow preview initialization, and restores settings afterward. The old preview remains connected while the final renderer initializes; static creation completes its first draw before revealing/returning the final canvas. The probe observed `priorInitially`, `priorHeld`, `newVisible`, and `usable` all true, followed by exactly one canvas. This closes the observed empty-stage lifecycle gap, **not a frame-by-frame pixel/video or hardware-GPU proof**. Final coordinates/camera may still jump, and a preview already initializing can delay handoff. Position morphs, staggered entry and filter crossfades remain deferred.

Before/after overview, focus and settled-hover images were visually inspected in both themes, including the final cold-run contact sheet. Synthetic note labels remain legible within existing dense-focus overlap limits; no blank final capture was observed. Selected images are `.workspace/motion/after-focus-dark.png`, `after-focus-light.png` and `after-hover-dark.png`. Initial startup-racing idle probes and the warm refresh that created no preview are not acceptance evidence; their raw receipts remain available rather than being rewritten.

Exact native invocations use `bash .workspace/visual-qa/run.sh <name> <plugin-directory> vault-wave9-critic <steps-file> 8`: names `wave10-m-before-stable`, `wave10-m-after-stable`, and `wave10-m-handoff`; plugin directories `plugin-wave10-m-before` or `plugin-wave10-m-after`; step files `steps-wave10-m-before.json` or `steps-wave10-m-after.json`. These paths resolve in the shared synthetic harness workspace, with copied receipts in this track's `.workspace/motion/`. Its wrapper owns `/tmp/graph-ng-harness.lock`; launch checks required at least 8 GiB available. Native preparation/probe scripts remain ignored.

### Deterministic evidence and size

Verification uses `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh <arguments>`, preserving the script's containment lock. Ordered `gates:fast`, `build`, and `test --timeout 10000` passed: **639 tests, zero failures, 163,107 expectations across 36 files**. The CPU probe uses `.workspace/motion/cost.ts` as the argument. Tests cover settings upgrade/validation, compiled Canvas/WebGL finite scheduling and zero uploads, cubic focus/reversal, manual flight interruption, live reduction, media-listener disposal, first paint before reveal, retained-preview late-stream cleanup and host replacement ordering. Final `gates` passed all six lanes; receipt `.workspace/motion/final-gates.log`, with unit output in `.workspace/motion/tests.log`. Independent merged review remains parent-owned.

Baseline bundle: **372,405 raw / 124,844 gzip bytes**. Candidate: **373,169 raw / 125,038 gzip / 107,674 Brotli bytes**, a **+764 raw / +194 gzip** delta under unchanged 375,000 / 126,000 caps. SHA-256: `5fa38dfaac7cf9e738c750a09852a4f3a7a5c08cf8987226db83110d39cb7237`. No runtime dependency, texture, property-mangle entry or publication was added. Hardware-GPU, mobile, real-vault and release acceptance remain separate.

## Wave 10 merged integration, 2026-11-16

The merged panel, chrome, dense-hub and motion tracks preserve their individual evidence above. Appearance now writes the validated `visuals.motion` field directly and calls the existing live refresh/save path. Panel-owned loading, applying, saving and opening labels share `workingText`; the stylesheet retains one shimmer definition. Graph information uses the same four-column grid for ordinary rows and native disclosures, reserving the same trailing width for X actions and chevrons. The Group overview closing inset transition also observes Full/Reduced/Off, in addition to the operating-system preference. Source punctuation restrictions and the 375,000 raw / 126,000 gzip ceilings remain unchanged. Independent merged review remains parent-owned; this integration does not establish physical-GPU, mobile, real-vault or release acceptance.

The single merged synthetic browser-native Obsidian capture pass used `bash .workspace/visual-qa/run.sh wave10-integrated plugin-wave10-integrated vault-wave9-critic steps-wave10-integrated.json 12`; the wrapper acquired `/tmp/graph-ng-harness.lock`, with 10 GiB available before launch on a 32 GiB general-purpose Linux desktop. All **21 steps passed**, with zero page/console errors and completed teardown. The five requested surfaces were captured in both themes: a 46-degree hub with its card, a held search reply, actual duplicate/missing-target/filter problems, Appearance with Motion, and Group overview beside open tools. All ten step images plus the two final viewport images were visually inspected. Count geometry matched across all nine checked rows; the canvas ended one pixel before the tools panel; all three Motion choices updated the real setting. These assertions do not measure hardware-GPU performance. The Filters capture retains a scrolled body, not an omitted control. Receipt and images are under `.workspace/visual-qa/runs/wave10-integrated*`.

The final build is **374,828 raw / 125,649 gzip bytes**, a **+2,423 raw / +805 gzip** delta against `2063a4e`, leaving 172 raw / 351 gzip bytes below the unchanged caps. The captured and final build hashes match: `07cc19aaef06ee6cb32ba7f731df7949a2af25cfa6e241f349959ffecf6e1598`.

Ordered final verification used `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh` with `build`, `test --timeout 10000`, then `gates`. All **649 tests passed**, zero failures, 163,308 expectations across 36 files; all six full gates passed. Receipts are `.workspace/wave10-{build,test,gates}-verified.log`. Earlier contention-related worker timeouts, esbuild-service failures and the old exact-grid assertion remain recorded in `.workspace/wave10-test*.log`; the stale assertion was updated to the shared grid contract without changing deadlines or limits. Parent independent integration review found no corrections before the final local commit. No remote or publication action occurred.

## Continuous relationships and pan-stable marks, 2026-11-16

The renderer-only change based on `cf8bd21` addresses three distinct mechanisms: independently sampled/faded legs of one reified relationship, screen-coordinate-dependent fragment rounding, and subpixel dots missing every pixel center on a non-antialiased WebGL context. Explicit carrier-owned legs now share a row-weighted admission rank and bypass independent length fade, with full-length ink budgeting. Faint fragments use an edge-stable seed (shared by grouped legs), and node radii have a one-device-pixel floor. Canvas and WebGL share admission and minimum-size policy, not rasterization. Filters, carrier visibility and focus exemptions remain authoritative. The separate refresh-loop work is outside this change.

Paired synthetic browser-native Obsidian runs used 32,000 notes and 79,658 edges, above the 60,000-edge curve ceiling, with the same selected degree-14 note centered at 0.22 times home ratio. Both correctly reported straight edges and explicitly admitted **software WebGL through SwiftShader**, not hardware-GPU acceptance. The context-admission audit evaluated current ranks, lengths and uniforms: before, **1,616 admitted legs, 1,580 partially admitted relationships and 7 complete relationships**; after, **1,630 admitted legs, zero partially admitted relationships and 605 complete relationships**. These are context-policy counts, not pixel counts or counts including focus exemptions. Both runs passed all 18 steps, returned WebGL error zero, recorded zero page/console errors and completed teardown. The paired selected-note captures were visually inspected in both themes, along with the after-pan dark capture; the foreground selection remains recognizable and small context dots are clearer. Still images do not establish temporal flicker acceptance.

Exact harness invocations were `bash .workspace/visual-qa/run.sh broken-lines-before-final-aff1 plugin-broken-lines-aff1-before vault-broken-lines-aff1 steps-broken-lines-aff1-before.json 12` and the same invocation with `before` replaced by `after`. The existing wrapper serialized them under `/tmp/graph-ng-harness.lock`; 14 GiB was available before the pair on a general-purpose Linux desktop. Receipts and synthetic captures remain ignored under `.workspace/visual-qa/runs/broken-lines-{before,after}-final-aff1*` in the designated native-harness workspace. The principal paired images end in `.step-11-near-selected.dark.png`; pan images end in `.step-14-near-panned.dark.png`. No real vault was read.

Ordered deterministic verification used `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh` with `gates:fast`, `build`, `test --timeout 10000`, then `gates`. All **660 tests passed**, zero failures, **960,439 expectations** across 36 files. Regressions cover 90,000 unequal carrier legs, explicit ownership and filtering, actual shader admission/rounding expressions, DPR 1/2 subpixel coverage, and compiled WebGL/Canvas command-driver pan stability with selection. Build size is **367,292 raw / 124,545 gzip / 107,389 Brotli bytes**, below the unchanged 375,000 raw / 126,000 gzip ceilings. Build hash: `3bef7662832471209666876ca7c4a4d932eccc8ade6dfb7138a809cb4b595ba3`. Local logs are `.workspace/broken-lines/final-{preflight,build,tests,gates}.log`. Independent merged review, physical-GPU behavior, sustained interactive panning and real-vault acceptance remain separate; no remote or publication action occurred.


## Family pull (wave 11)

Base `8a624f4`, general-purpose Linux desktop, Bun 1.3.14. The deterministic synthetic fixture has families of 50 notes, one local link and two random cross-family links per note. Parent references are a separate declared property, not additional drawn edges. Each pull uses identical seed 17, graph and initial coordinates. Solver-only times are medians of three repetitions on a shared host, not native frame time. All three repetitions have identical coordinate hashes per setting. Sibling spread is child-weighted RMS distance from each family's child centroid, computed in O(notes + parent entries), not pairwise sibling distance.

| Notes / edges | Pull | Mean child-parent distance | Sibling RMS spread | Solver ms |
| --- | --- | --- | --- | --- |
| 5,000 / 14,998 | 0 | 852.13 | 660.00 | 781.17 |
| 5,000 / 14,998 | 2 | 551.41 | 592.22 | 790.47 |
| 5,000 / 14,998 | 5 | 431.25 | 473.15 | 784.70 |
| 16,000 / 47,997 | 0 | 1,568.53 | 1,223.09 | 1,539.23 |
| 16,000 / 47,997 | 2 | 1,014.85 | 1,092.67 | 1,548.37 |
| 16,000 / 47,997 | 5 | 790.65 | 867.89 | 1,549.37 |

Recommended starting value: **5**, while the default and existing presets remain **0**. At 5, parent distance falls 49.4%/49.6% and sibling spread falls 28.3%/29.0%. This is not merely uniform shrinking: distance divided by graph RMS radius falls from 1.228/1.222 to 0.690/0.687; normalized sibling spread falls from 0.951/0.953 to 0.757/0.754. Pull 2 is gentler (about 35% closer parents, 10% tighter siblings). Solver-time changes at 5 are +0.5%/+0.7%, smaller than a meaningful dedicated performance claim on this shared host. The 5k fixture uses 300 iterations, the 16k fixture 160, with the existing recommended settings, Barnes-Hut enabled and theta 1.2. A separate sibling force was not warranted by these measurements.

An initial unnormalized spring tightened siblings but oscillated high-fanout parents, including a failing small-graph regression. The shipped candidate normalizes each symmetric spring by the geometric mean of family degrees and passes that regression. This does not prove global convergence for every hierarchy or every combination of force settings. It remains a bounded finite solver, not a tree-layout engine, and may leave families interleaved when cross-links dominate.

Reproduce with `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh ./scripts/family-pull-benchmark.ts`. Raw measurements and per-setting hashes are ignored at `.workspace/evidence/family-pull.json`. The new suite `tests/family-pull.test.ts` covers off-path equality, deterministic streaming, both repulsion modes, fixed nodes, cycles/multiple parents, invalid CSR and force values, historical cache key bytes, binary reload with the absent legacy field, exact reuse, parent-only edits, preview and changed-force refusal. Full deterministic run: **672 tests passed**, zero failures, **960,583 expectations** across 37 files, using the brief's wrapper with `build` and `test --timeout 10000`. Native visual evidence and final gates are recorded below; neither establishes hardware-GPU, mobile or real-vault acceptance.


Native visual check: `bash .workspace/visual-qa/run.sh wave11-d-readable plugin-wave11-d-family vault-wave11-d-family steps-wave11-d-family.json 12` in the designated synthetic-harness workspace. Its wrapper held `/tmp/graph-ng-harness.lock`; 10 GiB was available before launch. All **22 steps passed**, zero page/console errors, teardown completed. Explicit prior SwiftShader admission was reused, so this is software WebGL, not hardware-GPU acceptance. The host resolved 14,995 drawn edges from the fixture's 14,998 producer entries (duplicate link targets collapse). Pull 0 to 5 was applied through the real numeric control and Apply transaction, followed by explicit Fit. Both themes captured the graph and complete Layout panel, draft status, preset and Undo. Small fixed-size dots and one declared family accent made the comparison inspectable; the earlier oversized-dot run was retained as nonpreferred evidence. All captures in both runs were visually inspected. The full graph remains a dense network: family attraction is a preference, not a promise of separated trees.

Ignored preferred receipts are `.workspace/visual-qa/runs/wave11-d-readable.json` and the paired `step-09-pull-0-graph.{light,dark}.png` / `step-18-pull-5-graph.{light,dark}.png` files under that run prefix. Panel afters are `step-15-pull-5-panel.{light,dark}.png`; draft/Undo captures are steps 13 and 21. The supplied original panel baseline `wave10-p2-final.step-13-layout.{light,dark}.png` was also inspected: the old equal-button grid, disabled Undo and loose empty-status sentence are replaced by a compact select/action, conditional Undo and an attached changes disclosure. This panel baseline has 120 synthetic notes, not the 5k force fixture.

Ordered final `gates:fast`, `build`, `test --timeout 10000`, and `gates` all passed through the brief's lock/timeout wrapper. Bundle: **370,078 raw / 125,552 gzip / 108,341 Brotli bytes**, a **+1,413 raw / +548 gzip** delta from the same-toolchain `8a624f4` build. No cap was changed in this track. SHA-256: `c39c56f71c355118db443518d6f000c7ba94621896aabeadffc6698c5fac17d8`. Private receipts are `.workspace/evidence/final-{preflight,build,tests,gates}.log`. The coordinator independently read the cache diff before local commit; the dedicated merged-wave senior review still gates shipping. No remote action or real-vault read occurred.


## Large relationship-note layouts (wave 12, 2026-11-16)

### Merged-wave review corrections

The follow-up preserves world-space camera center and scale when a streaming preview is replaced, including gestures during final renderer preparation; untouched previews still fit the completed layout. Property promotion retains unsettled status. Hub size leaves advanced curve/shrink/floor drafts intact, with number chips, thumbs and accessible values synchronized. Full presets retain their explicit reset behavior. Selection-only captions use the selected note's filtered connections independently of highlight focus in both label styles. Group canvas pages honor saved values through 100; larger values visibly report the effective limit. Empty Next actions and unnecessary pagers are hidden without losing backward keyboard navigation.

Eight new deterministic regressions failed against merged baseline `1a5e407` before production edits (739 passed, eight failed, one optional test skipped). Verification uses `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh <target>`, in order `build`, `test --timeout 10000`, `gates`, on a Linux x86-64 workstation. Build passed; **747 tests passed, zero failed, one optional test skipped**, with 983,325 expectations across 37 files. Secrets, attribution (current/index and all reachable commits), privacy, frozen-lock/install-policy and runtime-license gates passed. Full gates failed only on bundle size: **391,362 raw / 132,232 gzip bytes**, against unchanged 385,000 / 130,000 ceilings (6,362 / 2,232 bytes over). This is 821 raw / 263 gzip bytes above the merged baseline. Ignored receipts are in `.workspace/evidence/wave12-review/`; the bundle receipt is `.workspace/evidence/bundle-size.json`. These synthetic DOM/Canvas/production-bundle tests do not extend native visual, hardware-WebGL, mobile or private-vault acceptance.

### Original layout measurements

Synthetic-only CPU measurements on a Linux x86-64 workstation class with 32 GiB RAM. The deterministic fixture in `scripts/large-layout-benchmark.ts` has 26.2% endpoint notes, 73.8% two-legged relationship notes, sixteen planted groups, about three edges per note, local hubs, 1% cross-group relationships and 5% disconnected endpoint notes. No private vault was read. The seed and topology are fixed; groups score the output but never drive the solver.

The archived baseline is commit `2bfcf8e`, with 100 iterations, LinLog on, spread 26.23, normal gravity 0.1, slowdown 1, theta 1.2 and no optional family/hub force. Measuring displacement disproves the hypothesis that seeds barely move: repulsion expands this graph dramatically while groups remain mixed. This does not establish why every note in an owner's screenshot lies outside its dense area.

| Notes | Edges | Baseline RMS displacement | Baseline RMS radius | Last step / radius | Group separation |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 16,000 | 47,419 | 27,569.53 | 27,605.95 | 0.00767 | 0.0366 |
| 32,000 | 94,936 | 37,666.16 | 37,702.94 | 0.00779 | 0.0251 |
| 61,000 | 181,067 | 50,114.46 | 50,151.43 | 0.00784 | 0.0214 |

Group separation is RMS group-centroid radius divided by within-group RMS radius, weighted by membership. Larger means better separation of these planted groups, not inferred semantic correctness. Hub radius is RMS distance to the highest-degree adjacent note. Solver metrics exclude the presentation-only disconnected-note ring.

| Notes | Recommended steps | Hub gravity | Group separation | Hub radius | Last step / radius | Settled | CPU seconds |
| ---: | ---: | ---: | ---: | ---: | ---: | :---: | ---: |
| 16,000 | 300 | 0 | 3.7026 | 237.89 | 0.00275 | no | 4.26 |
| 16,000 | 300 | 2 | 3.9812 | 203.84 | 0.00313 | no | 5.20 |
| 16,000 | 300 | 5 | 4.2161 | 187.74 | 0.00702 | no | 4.74 |
| 32,000 | 430 | 0 | 3.8285 | 346.37 | 0.00103 | yes | 14.35 |
| 32,000 | 430 | 2 | 4.1303 | 296.85 | 0.00204 | no | 15.04 |
| 61,000 | 590 | 0 | 3.8756 | 496.88 | 0.00110 | yes | 40.15 |
| 61,000 | 590 | 2 | 4.0969 | 429.62 | 0.00164 | yes | 47.41 |
| 61,000 | 590 | 5 | 4.2274 | 392.53 | 0.00336 | no | 46.93 |

Recommended changes attraction/gravity and iteration budget as well as initialization: this is not a seed-only A/B claim. Strength 2 balances stronger separation with lower residual movement than 5. The experimental strongest-neighbour-only model at 61k/590 yielded separation 3.9038 / 3.9306 and hub radius 439.87 / 386.59 at strengths 2 / 5. Both settled, but the mass-weighted model separated groups better. Only the mass model ships. Timing is a single-run CPU observation, not a latency SLA or renderer FPS measurement.

Reproduce the current implementation with `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh scripts/large-layout-benchmark.ts 61000 recommended 2`; substitute 16000/32000 and strengths 0/5 for the other cases. Original measured runners were locally bundled Node executables: `node .workspace/track-l/reified-before.cjs 61000 owner 0`, `node .workspace/track-l/reified-after.cjs 61000 rec 0`, and `node .workspace/track-l/mass.cjs 61000 rec 2`. Raw receipts are `.workspace/track-l/reified-before.jsonl`, `reified-after.jsonl` and `mass.jsonl`. The first runner freezes the archived baseline; the second freezes the intermediate strongest-neighbour experiment, not the shipped model.

Native paired runs use a separate synthetic 32,000-note / 93,466-edge vault with eight groups, software rendering and explicit 60,000-note / 300,000-edge admission limits. `wave12-l-before-2` uses the archived baseline and the stated LinLog settings. `wave12-l-after` adds the new default hub force and then explicitly applies Recommended. Initial, in-progress and final screenshots in both themes show mixed expanding baseline rings versus eight separated groups after Recommended; the final frame is retained. Both runs returned native harness exit 0 with no reported console/page errors. The post-Recommended native result honestly remains Layout not settled. These captures do not establish hardware-WebGL, mobile, private-vault or screen-reader acceptance. Narrow Layout presets and confirmation in both Filters and Appearance have separate captures. Raw native evidence remains ignored under `.workspace/track-l/native/`.

Final local verification used `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`, then the same wrapper with `test --timeout 10000` and `gates`. Build passed; 727 tests passed, one optional browser test skipped. Four independent-review regressions were recorded failing before correction: refined-generation adoption, short-budget settlement, pinned-isolate collision and Graph information confirmation. Additional transaction tests cover persistence after commit and non-adoption after failed settings save. The final 61k command reproduced separation 4.09695 and settlement true in 48.42 seconds. Bundle is 387,362 raw / 130,936 gzip (level 9), exceeding unchanged 385,000 / 130,000 ceilings by 2,362 / 936 bytes. Safety, frozen-lock/install-policy and runtime-license lanes pass; full gates remain red solely on bundle size, left for integration rather than changing caps here.

The repeated native run `wave12-l-after-2` exposes and visually verifies both inline confirmations at 340px; all scripted steps completed without console/page errors. The harness global verdict remains `unknown` (`harness-empty-list`), so the claimed evidence is these exact scripted observations, not an overall native acceptance verdict. Initial/mid/final captures and the narrow preset row were inspected in both themes. Native captures precede the final Graph information auto-scroll-only adjustment; deterministic tests cover that confirmation route. Hardware-WebGL and private-vault acceptance remain unproven.

## Layout progress and responsive Stop (2026-11-17)

Baseline `a2b2877`; progress-control commit `832e3ae` followed by the separately committed worker scheduling correction. Linux x86-64 workstation class, 32 GiB RAM. All inputs and screenshots are synthetic. The paired throughput probe runs the archived baseline and changed solver in actual Chromium workers with the same `largeFixture`, seed, 100-iteration budget and options. After per-mode warmup, six alternating before/after pairs compare every Float32 coordinate exactly. These are solver elapsed times, not renderer FPS or full-vault startup measurements.

| Notes | Baseline median ms | Corrected median ms | Elapsed change | Coordinates |
| ---: | ---: | ---: | ---: | --- |
| 5,000 | 608.55 | 600.65 | -1.30% | exactly equal |
| 20,000 | 2,862.35 | 2,874.90 | +0.44% | exactly equal |

A separate 1,800-note / 10,000-iteration cancellation probe requested Stop after the first streamed coordinates. The old worker acknowledged completion **17,812.2 ms** later, with last streamed iteration 9,995 and settled true: its scheduler continuations had starved the message. The corrected worker returned in **8.9 ms**, last streamed iteration 10, unsettled. Deterministic regressions verify scheduler bypass and cancellation after two mocked 30 ms steps; actual-worker tests require both initial and refinement Stop under 500 ms. The 50 ms check bounds work between cooperative opportunities, not an individual atomic step or OS scheduling delay.

Probe command: `flock -w 1800 /tmp/graph-ng-harness.lock .workspace/run-stop-benchmark.sh`. Ignored runner `.workspace/layout-stop-benchmark.mjs` and receipts `.workspace/evidence/layout-stop-throughput.{json,log}` preserve the comparison. Native command: `flock -w 1800 /tmp/graph-ng-harness.lock .workspace/visual-qa/run.sh`. Both runners require at least 8 GiB available RAM and use bounded timeouts with owned cleanup. The final native fixture has 1,800 notes / 3,266 edges after switching relationship representation. **35/35 scripted steps passed**, no page/console errors, teardown complete. Initial/refinement Stop returned in **11.9 / 13.4 ms**, both unsettled. Ring offsets match weighted text percentages; the same text span advances shimmer; native Tab reaches a visible focus outline; in-app Motion Off removes shimmer and arc transition; stopped feedback clears on Keep refining. OS reduced motion is covered by deterministic CSS checks, not a native media-emulation test.

All 20 final PNGs were visually inspected, including dark/light progress, hover, keyboard focus, Motion Off and stopped/refinement states. The stopped view retains the Keep refining action. Final receipts and screenshots are `.workspace/visual-qa/runs/progress*`; prior failed native Stop diagnostics remain under `.workspace/visual-qa/first-attempt/` and `.workspace/visual-qa/before-stop-fix/`. The harness global verdict remains `unknown` (`harness-empty-list`): these results establish the named interactions only, not desktop Electron fidelity, screen-reader speech, mobile or hardware-GPU acceptance.

Verification used `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`, then the same wrapper with `test --timeout 10000` and `gates`; bundle receipt used `node scripts/bundle-size.mjs`. Build passed; **820 tests passed, one existing skip, zero failures**, across 38 files; all six gate lanes passed. Independent review covered the UI settlement race and worker scheduling. Ignored receipts are `.workspace/evidence/{build,test,gates}.log` and `bundle-size.json`. Combined bundle is **403,435 raw / 137,113 gzip bytes**, **+874 / +248** versus baseline and **+101 / +38** over the UI-only bundle, within unchanged 405,000 / 138,000 ceilings and the requested +600 gzip-byte growth budget. Passing these commands does not grant release or publication approval.

## Selection-following lens corrections (2026-11-16)

On baseline `1e4889b`, two new compiled-production renderer regressions reproduced clicks leaving the lens and highlight on the previous note. A third source-panel regression reproduced the button-style lens control instead of a native checkbox. Corrections retarget the existing reversible transition and take emphasis from its requested target immediately. The existing lens coordinate equation, shared edge/node shader override, layout positions and worker are unchanged. Direct-open clicks now advance the existing card history; Appearance drops its duplicate Fit graph action and uses shared toggle/help styling.

Verification on a Linux x86-64 workstation class with 32 GiB RAM used `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`, then the same wrapper with `test --timeout 10000` and `gates`. Targeted lens tests passed (23). The full suite had 750 passing tests, one optional skip and one load-sensitive layout timeout; the single permitted rerun with `test --timeout 10000 -t 'centering: normal gravity'` passed in 5.64 seconds. An additional 15,000-note isolate regression passed with `test --timeout 10000 -t '15k-note isolate'`: connected coordinates remain byte-identical, and every isolate ring has uniform radius/chord spacing and a centered full circumference. Full gates passed. Bundle is **391,212 raw / 132,190 gzip bytes**, **150 raw / 42 gzip bytes smaller** than `1e4889b`, within unchanged 395,000 / 134,000 ceilings.

The reported flattened edge patches have not yet been reproduced on this revision. The supplied capture has controls predating the current click-intent and relationship-help changes; it does not establish which layout produced the patches. Current code has no position clamp, and isolated notes already receive the ordered-ring placement from wave 12. No speculative solver change is made. After available memory rose above 8 GiB, disposable browser-native runs used a synthetic 15,004-note / 20,886-edge fixture with disconnected components. Baseline `wave18-before-2` reproduced 450 stale hub lens members while the current Focus note had exactly three direct connections. `wave18-after` showed precisely Near A/B/C at a 135.36 CSS-pixel radius, matching selected focus and Recent history, and cleared sparse offsets on lens-off. Both themes were visually inspected. Its scripted PointerEvent caused a `setPointerCapture` page error, so that run alone is not clean native-pointer acceptance. The subsequent `wave18-disclosure-after` run used the harness's real canvas click, passed every scripted step without console/page errors, and kept selection, focus, lens target and history on the clicked neighbour. It again verified three lens members and lens-off cleanup. Ignored receipts, paired plugin snapshots and screenshots are under `.workspace/visual-qa/`; hardware-GPU, private-vault, desktop Electron, mobile and screen-reader acceptance remain unproven.


## Shared disclosure content guides (2026-11-16)

Every side-panel and card disclosure now places its expanded content in the shared `graph-ng-disclosure-body` boundary. One token-spaced, theme-inherited 1px inline-start guide ends below that content; subsequent settings return to the parent alignment. Explicit wrappers avoid depending on the newer `::details-content` browser selector. Native summary activation, existing open-state memory, keyboard handling and ARIA references remain unchanged; no nested scroll container or new state is introduced.

The same locked `build`, `test --timeout 10000` and `gates` commands verified the change. The final-source full suite had **753 pass, one optional skip and one load-sensitive centering timeout (10.99 seconds)**. Its single isolated rerun with `test --timeout 10000 -t 'centering: normal gravity'` passed in 4.86 seconds. The earlier disclosure-only suite likewise had 752 pass, one skip and the same timeout, passing its isolated rerun in 4.97 seconds. New regressions cover shared guide structure across panel tools, Finding connections boundaries and More actions containment. Review also corrected the truncated Adaptive option and singular overflow badge; the compiled badge regression failed before correction. A fresh build, four focused tests (`test --timeout 10000 -t 'anchored overflow badge|side-panel disclosures|adaptive emphasis control|card exposes two primary'`) and full gates passed after those corrections. Download size is **391,380 raw / 132,285 gzip**, a **168 / 95 byte increase** over `752fe6d`, within the unchanged ceilings. Ignored deterministic receipts use `.workspace/visual-qa/wave18-disclosure-*` and `wave18-reviewed-*`.

Native before/after Finding connections captures use the same synthetic 15,004-note / 20,886-edge fixture in both themes. The final command was `.workspace/visual-qa/run.sh wave18-reviewed-complete plugin-wave18-reviewed-final vault-wave18 steps-wave18-reviewed-complete.json 12`. All 29 scripted steps passed, with no console/page errors: native Enter closed and reopened Finding connections, More actions retained its actions, four Graph information bodies had 12px indentation and 1px borders, and the bottom-left summary had no disclosure guide. All six final screenshots were visually inspected; Adaptive fits, guides end before sibling settings and Graph information has no double padding. Earlier capture attempts stopped on fixture-only errors (a nonexistent panel method, then a non-unique Graph information selector); the final run uses the existing X button and toolbar-qualified selector. The harness global verdict remains `unknown` (`harness-empty-list`), so this is evidence for these interactions and screenshots only. Software rendering, synthetic data and the other native-acceptance limitations above still apply; flattened edge patches remain unverified. Final native receipts remain ignored under `.workspace/visual-qa/runs/wave18-reviewed-complete*`.
The reported flattened edge patches have not yet been reproduced on this revision. The supplied capture has controls predating the current click-intent and relationship-help changes; it does not establish which layout produced the patches. Current code has no position clamp, and isolated notes already receive the ordered-ring placement from wave 12. No speculative solver change is made. Native before/after capture is pending the required 8 GiB available-memory threshold; deterministic tests do not establish native visual or hardware-GPU acceptance. Ignored evidence is under `.workspace/visual-qa/wave18-*.log`, with a separate synthetic 15,004-note fixture prepared for the native run.


## Prevent overlap correction (2026-11-16)

Baseline `752fe6d`, Linux x86-64 workstation class with 32 GiB RAM. Deterministic clustered fixtures use `clusteredFixture(2000, 3000, 17, 24)` and `clusteredFixture(8000, 12000, 17, 24)`, literal relationship notes, solver seed 17, and Recommended (300 iterations). Count intersecting rendered-radius pairs across the whole layout at the stated home-relative scale, not just the cropped zoomed viewport. Use 1200x850 CSS pixels, DPR 1, default sqrt-degree sizing (5x largest hub), all relationship notes shown, no selection, and standard unlinked-note rings. `tests/support/overlap.ts` shares the renderer's `baseRadius` and `degreeSizes` formulas, including the physical-pixel floor. Home framing uses the renderer's connected-note sample, 1st-to-99th percentile bounds and 25% margin, not whole-layout extrema. Glow and labels do not count as dots.

| Notes | Scale | Off pairs | Old on pairs | Fixed on pairs |
| ---: | --- | ---: | ---: | ---: |
| 5,000 | Home | 13,049 | 13,494 | 12,222 |
| 5,000 | 5x close | 132 | 553 | 9 |
| 20,000 | Home | 69,066 | 67,235 | 62,984 |
| 20,000 | 5x close | 4,507 | 6,574 | 2,163 |

Old on reported settled after 300 iterations despite preserving a very large initial extent. Fixed on correctly reports not settled, with last-step RMS movement 2.51 / 5.44 layout units for 5k / 20k. Off also remains unsettled. Observed solver times were approximately 2.14 / 13.42 seconds fixed on versus 1.38 / 5.32 seconds old on; these non-isolated single-run timings are not performance acceptance.

An adverse 25x hub-size check exposes a retained limit: at home, fixed on has 295,750 / 1,450,082 overlapping pairs versus 282,603 / 1,479,155 with it off, so the 5k case worsens. At 5x close zoom it improves to 10,902 / 138,473 versus 11,743 / 147,169 off. Physics cannot guarantee screen-space packing independently of appearance and automatic fit; this correction does not claim otherwise.

Private measurement receipts are `.workspace/overlap/{before-home,after-reviewed-final}.json`; the bounded runner was `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh .workspace/overlap/measure-home.ts .workspace/overlap/after-reviewed-final.json` (use `measure-home-before.ts` and `before-home.json` for the baseline solver archived from `752fe6d`, sharing the corrected measurement helper). The tracked 5k regression reproduces default home/close and 25x close comparisons through the normal test suite. Native captures use a separate synthetic 5,000-note / 9,672-edge vault at matched home-relative zooms, not the numerical fixture, under the serialized harness and memory threshold. No real vault content is used.

Final deterministic verification used `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`, then the same wrapper with `test --timeout 10000` and `gates`. Build passed; **759 tests passed, one optional browser test skipped, zero failed** across 37 files. Full gates passed all six lanes. Coverage includes softened pair-force parity, conservative aggregate radius despite retained tree member indices, fixed/streamed determinism, actual worker refusal of old overlap hashes and unchanged ordinary-cache acceptance. Bundle is **391,529 raw / 132,336 gzip bytes**, **+317 raw / +146 gzip** against `752fe6d`, within unchanged 395,000 / 134,000 limits. Private logs are `.workspace/overlap/review-{build,full-tests,gates}.log`.

Browser-native captures are `.workspace/overlap/runs/overlap-before-retry*` and `overlap-after-reviewed*`. Both runs completed all 21 reported scripted steps with no console/page errors; all before/final light and dark captures were visually inspected. The overview remains dense but now forms local clusters, while close zoom preserves separated small relationship-note dots. The harness global verdict remains `unknown` (`harness-empty-list`), so these are scripted visual observations, not full native acceptance. The test uses the browser-native Obsidian UI and a synthetic WebGL availability seam; desktop Electron fidelity and hardware-GPU acceptance remain unproven.

Independent review identified two integration defects, both reproduced as failing regressions before correction: a temporarily balanced note could acquire permanent zero convergence, and damping fed back into convergence, compounding the coefficient and causing false settlement. Overlap mode now restarts zero convergence and applies the 0.3 coefficient only to displacement, after updating convergence. Both regressions pass; ordinary-mode parity, topology-only radii, conditional identity migration, conservative aggregate bounds and fixed-node behavior are preserved. The table above uses these reviewed corrections; earlier private measurements and captures remain historical, not final-source evidence.

## Adaptive performance and anchored-label memory

2026-11-17 local candidate against baseline `a2b2877`, Linux x86-64 workstation class, 32 GiB RAM, headless Chromium with SwiftShader and CDP 4x/6x CPU throttling. These are synthetic browser-native observations, not private-vault, hardware-GPU, mobile or tab-RSS acceptance. Each lane runs once. Single-run differences are not a statistical speedup. The matrix freezes the performance candidate before modal review-only fixes and integration with the later Stop scheduler correction; it does not measure that merged scheduler. Frozen bundle SHA-256 values are `54636c3c8be2b9fc6f64593245157b7d6563ff16456d80c11ac0eb70e9bde1fc` (before) and `3889fbee587714b2371645371a57799591233d0e5edcebcb475b37ce0013148e` (after).

The 5k fixture has 4,000 ordinary and 1,000 relationship notes; 20k has 16,000 and 4,000; the relationship-heavy 49k fixture has 16,000 and 33,000. Lines removes relationship-note dots, not source files. Notes renders the incidence graph. Default solver accuracy, seed, convergence and cache identity are unchanged. The graph waits for verified native metadata before timing the plugin. The harness-only existing SwiftShader admission seam does not change shipped GPU policy. Automatic suggestions are suppressed in timing lanes; the native UI lane opens them explicitly.

### Matched load observations

Cells are before / after, in milliseconds. Ingestion includes bounded column streaming and worker transfer. Project is the worker request duration. First Groups is the existing first-page readiness measure, not a promise of complete Notes layout. Settled here means the layout request completed, not necessarily solver convergence. The first Notes-ready diagnostic contains a fixed 1.5-second wait and GC overhead and is deliberately excluded from latency claims.

| Source notes | Mode | Throttle | Ingest | Project | First Groups | Layout request complete | Label build | Label upload |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5k | Lines | 4x | 126 / 123 | 83 / 95 | 197 / 200 | 765 / 776 | 64 / 44 | 68 / 0 |
| 5k | Lines | 6x | 203 / 198 | 131 / 119 | 312 / 298 | 969 / 926 | 124 / 58 | 94 / 1 |
| 5k | Notes | 4x | 117 / 137 | 86 / 97 | 198 / 226 | 869 / 947 | 78 / 44 | 67 / 1 |
| 20k | Lines | 4x | 482 / 484 | 134 / 152 | 605 / 622 | 2747 / 2847 | 77 / 54 | 82 / 0 |
| 20k | Lines | 6x | 700 / 690 | 178 / 186 | 855 / 849 | 3070 / 3092 | 157 / 119 | 106 / 1 |
| 20k | Notes | 4x | 458 / 412 | 142 / 136 | 592 / 538 | 3260 / 3177 | 101 / 48 | 66 / 1 |
| 49k | Lines | 4x | 1043 / 1047 | 264 / 226 | 1254 / 1216 | 3752 / 3744 | 107 / 51 | 71 / 0 |
| 49k | Lines | 6x | 1780 / 1685 | 241 / 256 | 1995 / 1918 | 5099 / 5091 | 146 / 119 | 99 / 1 |
| 49k | Notes | 4x | 964 / 910 | 268 / 273 | 1186 / 1126 | 9892 / 9871 | 110 / 94 | 66 / 2 |

| Source notes | Mode | Throttle | Remaining host hydration | Main long-task total, load window | Mean camera-frame interval |
| ---: | --- | ---: | ---: | ---: | ---: |
| 5k | Lines | 4x | 5023 / 6030 | 582 / 509 | 120 / 123 |
| 5k | Lines | 6x | 8071 / 7044 | 702 / 634 | 122 / 121 |
| 5k | Notes | 4x | 5026 / 6032 | 734 / 712 | 132 / 136 |
| 20k | Lines | 4x | 21301 / 21171 | 1792 / 1814 | 405 / 411 |
| 20k | Lines | 6x | 32350 / 30289 | 2108 / 1942 | 407 / 409 |
| 20k | Notes | 4x | 20237 / 18131 | 2124 / 1967 | 495 / 480 |
| 49k | Lines | 4x | 38501 / 44536 | 2746 / 2613 | 552 / 551 |
| 49k | Lines | 6x | 84290 / 76504 | 3205 / 3135 | 551 / 549 |
| 49k | Notes | 4x | 42443 / 40507 | 5071 / 4697 | 1103 / 1097 |

Remaining host hydration starts only after the harness's native UI-ready callback, so it excludes browser startup, fixture import and earlier indexing. Initial property auditing overlaps that hydration and was not separately captured: no zero-cost audit claim is made. The later adapter audit hook saw no independently timed initial audit. Long tasks include shared host work and use the full detail-observation window, including the settling wait; they are not Graph NG-only CPU. Camera intervals describe 30 moved frames on software rendering, not hardware FPS. Dedicated workers may not inherit page CPU throttling identically.

### Retained allocations

4x lanes, decimal MB, before / after. Main JS is post-GC; phase peak is the maximum of two phase-boundary snapshots, not a continuous true peak. Typed arrays deduplicate backing buffers reachable through the measured graph view. Explicit GPU allocation counts bufferData/texImage2D sizes, not browser surfaces or GPU-driver residency. These columns overlap and must not be added into a tab-memory total.

| Source notes | Mode | Main JS steady | Main JS sampled phase peak | Graph render typed arrays | Explicit GPU buffers + textures |
| ---: | --- | ---: | ---: | ---: | ---: |
| 5k | Lines | 26.24 / 26.26 | 51.58 / 52.32 | 0.70 / 0.52 | 17.18 / 0.23 |
| 5k | Notes | 26.19 / 26.24 | 47.14 / 51.93 | 0.84 / 0.69 | 17.26 / 0.33 |
| 20k | Lines | 68.75 / 69.03 | 97.96 / 117.75 | 2.15 / 2.01 | 17.81 / 0.89 |
| 20k | Notes | 69.84 / 69.39 | 98.64 / 108.78 | 2.67 / 2.58 | 18.03 / 1.15 |
| 49k | Lines | 161.16 / 161.56 | 207.67 / 210.44 | 3.38 / 3.35 | 18.39 / 1.59 |
| 49k | Notes | 158.63 / 161.94 | 198.50 / 209.21 | 8.07 / 8.04 | 20.50 / 3.69 |

Anchored labels previously allocated an unused 2048-square RGBA canvas, its texture and ranked glyph arrays. They now keep identical candidate ranking, text metrics, placement widths and LOD nodes but a 1-square placeholder and no raster/glyph geometry. This removes 16 MiB of explicit texture allocation, approximately 16 MiB of canvas backing and a small geometry tail; only the explicit allocation reduction is directly counted above. Ranked labels retain their full raster and texture-reuse behavior. Main JS heap has not shown a comparable broad reduction. No source facts, validation, identity maps, duplicate quarantine or rollback coordinates were removed speculatively.

### Policy, controls and evidence

Auto uses cheap CPU/memory/context hints and bounded measured-cost correction. Fast/low Auto cap DPR at one and suppress camera/focus motion; Quality retains original resolution and motion behavior. Fast admits the first progressed worker batch, never a seed-only frame; normal mode still waits for two. Existing background refinement, Stop, deferred labels/picking and zero idle drawing are retained. The performance suggestions modal lists only enabled costly options, freezes checked choices during its acknowledged save, and leaves live settings unchanged on rejected writes. The offered flag persists across reloads, manual reopening remains available, and an open/applying guard prevents duplicate offers. Performance-only redraw preserves unsaved declaration/tuning drafts. Diagnostics default off; the allowlist retains at most 16 numeric samples and coarse enums, never names, paths or content. Disabling or Clear removes saved samples on the next successful save.

Ignored raw receipts and synthetic captures are under `.workspace/visual-qa/`: `before-*.json`, `after-*.json`, `performance-settings.png`, `performance-suggestions.png` and `performance-fast-preview.png`. Bounded runner: `bash .workspace/visual-qa/matrix.sh before` and the matching `after` invocation; each fixed nine-lane matrix takes `/tmp/graph-ng-harness.lock` and checks at least 8 GiB available before each browser. Exact single lane: `bash .workspace/visual-qa/launch-profile.sh after 49k 4 nodes`. The native harness global verdict is not an overall acceptance verdict; these receipts cover the stated scripts and measurements only.

Build/tests use `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build`, followed by the same wrapper with `test --timeout 10000` and `gates`; the production-host regression is `node tests/performance-ui-regressions.cjs`. Five independent-review defects were reproduced before correction: stale controls after settings replacement, repeated offers, rejected Apply mutating live state, mutable selections during a pending save, and full-tab redraw discarding drafts. The standalone production regression covers their fixes, plus suppression-only no-rebuild behavior. Size limits remain unchanged; exact final verification and heap ownership evidence follow below.

### Heap ownership: captured small probe, explicit large-probe gap

The 49k Notes timing and allocation receipt was saved before requesting a full main-realm snapshot. That snapshot did not produce usable data within the native harness's 12-minute session deadline. The harness aborted the session and killed its owned Chromium child after graceful close exceeded 10 seconds; cleanup was confirmed. The after-matrix process therefore exits 1 for the snapshot stage, despite all nine after timing receipts being present, verified and page-error-free. Its paired before matrix exits 0. No successful 49k main/worker retained-owner split is claimed, and the failed capture was not retried. The snapshot process temporarily reached approximately 2.4 GB renderer RSS while profiling; this is profiling overhead, not a measured unprofiled-tab baseline or reproduction of the reported 2.5 GB.

A separate 5k synthetic capture successfully collected the main realm and three dedicated workers. The Graph NG worker was identified by its worker-source protocol, not inferred from a blob URL. Post-GC main JS was 26.91 MB; the Graph NG worker JS was 2.75 MB with 0.43 MB separately reported backing storage. Its strong-edge snapshot total was 3.28 MB; the two host workers had 1.85 MB and 0.28 MB JS heaps. The main snapshot's strong-edge total, including native snapshot nodes, was 45.12 MB. An offline dominator traversal excluded weak edges and was checked against known 1 MB/2 MB synthetic buffer owners. This is local strong-edge attribution, not browser RSS or a complete DevTools ephemeron model.

| 5k snapshot owner | Retained MB | Ownership |
| --- | ---: | --- |
| Host app script and source | 7.54 | Host |
| Metadata cache dictionary | 4.83 | Host, shared root rather than exclusive wrapper retention |
| File-storage closure map | 1.95 | Host |
| Worker fact-row map | 1.36 | Graph NG worker |
| Adapter sent-input digest map | 0.41 | Graph NG main |
| Render projection | 0.22 | Graph NG main |
| Anchored label atlas metadata | 0.10 | Graph NG main |
| One retained renderer float buffer | 0.07 | Graph NG main |

These nested/shared rows must not be summed. Removing the four marked Graph NG main-owner anchors made 1.13 MB unreachable in that strong-edge graph; this is an exclusive lower bound, not the complete plugin cost. Worker fact rows remain authoritative and the main adapter keeps digest strings, not duplicate source rows. The small fixture supports a host-heavy allocation picture but cannot establish ownership at 49k or explain the reported tab. At 49k, the directly measured render backing buffers are 3.35 MB in Lines / 8.04 MB in Notes; worker, host-retainer and browser-driver attribution remains open. No hundreds-of-MB Graph NG holder was established, and no speculative authority/cache deletion was made.

Ignored snapshots and analyzer output are `heap-5k-probe-*.heapsnapshot` and their `.summary.json` files under `.workspace/visual-qa/`. The empty `heap-49k-notes-main.heapsnapshot` and `after-49k-4-nodes.log` preserve the failed large-capture boundary. The successful small-probe command was `bash .workspace/visual-qa/launch-profile.sh final 5k 4 lines`; its capture hook has since been disabled for the final UI-only run. Offline analysis: `node .workspace/visual-qa/heap-analyze.mjs .workspace/visual-qa/heap-5k-probe-main.heapsnapshot`.

### Final merged verification

The performance implementation was committed as `b4f2224`, then integrated with `e49107d` as `9c2a382`, retaining the progress capsule and responsive worker Stop. The follow-up filters out a motion suggestion already neutralized by Fast/low Auto and prevents a suppression-only save from rebuilding the graph. Build passes; **827 tests pass, one optional skip, zero failures**, plus seven production-host regression groups. The five non-size gate lanes pass. Final bundle is **411,467 raw / 140,101 gzip bytes**, **+8,906 / +3,236** versus baseline. This worktree retains 405,000 / 138,000 caps, so its full gates fail solely on size by **6,467 / 2,101**; cap integration is parent-owned, not changed here.

The final native UI command is `bash .workspace/visual-qa/launch-profile.sh final 5k 4 lines`. It exits 0 with no page errors, exercises actual Speed up graph action, persisted numeric diagnostics with an injected synthetic path excluded, live Fast preview and Stop, and all three final PNGs were visually inspected. The preview includes the merged progress capsule. The final narrow suppression-only no-rebuild guard was verified deterministically after that UI artifact was prepared; it does not alter the captured appearance. Main/worker heap inspection, like these screenshots, is synthetic-only. Initial audit attribution, true peak/process memory, hardware-GPU, mobile, Electron fidelity and screen-reader acceptance remain unproven.

<!-- adaptive-performance-end -->


### Performance offer wording and one-click controls

The follow-up retains admission thresholds and the save-before-adopt transaction. Graph-size-only evidence says This graph is large, adding for this device only on the lower tier. A single policy result now supplies both automatic admission and the visible reason: sustained frame cost, large named note/edge counts, app heap, app long tasks or provisional device hints. Manual reopening without a qualifying signal says Speed up graph instead of inventing a slowdown. No layout-duration trigger was added. Long-task and heap wording describe the app, not graph ownership.

Speed up selects every suggested change by default, including Fast mode when not already effective; Choose changes is a collapsed native caret disclosure for opting out. Not now, the native X, small Don't ask again control, frozen pending choices, draft preservation and suppression-only no-rebuild behavior remain. Auto/Fast/Quality semantics are unchanged; Fast mode is adopted only after the candidate save. No empty disclosure or no-op primary is shown when no changes remain. The modal owns its single scroll boundary.

Verification on a Linux desktop-class host: the existing locked build and `test --timeout 10000` commands above pass with **828 tests passed, one existing skip, zero failures**. `node tests/performance-ui-regressions.cjs` additionally checks collapsed choices, actual trigger title/reason and one-click application of all five suggestions, alongside the prior transaction regressions. `node scripts/bundle-size.mjs` reports **413,058 raw / 140,598 gzip bytes**, **+1,591 / +497** against `d5bed0a`, inside **415,000 / 142,000**. These deterministic checks do not establish hardware speedup or production acceptance.

The synthetic native command `bash .workspace/visual-qa/launch-offer.sh` exits 0, taking `/tmp/graph-ng-harness.lock`, checking at least 8 GiB available and using headless Chromium at 4x CPU throttling. `.workspace/visual-qa/offer-receipt.json` records all five selected changes persisted, no page errors and zero nested scroll regions. Visually inspected captures: `.workspace/visual-qa/performance-collapsed-dark.png`, `.workspace/visual-qa/performance-expanded-light.png` and `.workspace/visual-qa/performance-settings.png`. The captured trigger is app contention: five long tasks totaling about 566 ms. An initial capture caught native focus opening the reason-help popover over the disclosure; explicit primary-action focus corrected it, and the final native run verifies the popover starts closed. These captures are synthetic presentation evidence, not actual low-power hardware acceptance. All six full gates pass; the coordinator's independent review corrections are included.


## Exact embedded scalar layout kernel (2026-11-17)

The numerical baseline is frozen commit `3d7096b`, including Morton query ordering and the 50 ms message-friendly yield. The candidate retains JS tree construction and integration, accelerating only repulsion and linear link attraction. Its checked-in module is produced by the dependency-free authored emitter, not a fetched binary or runtime package. `node scripts/wasm-kernel.mjs --check` reproduces the exact checked-in source. No SIMD, extra worker, approximation, setting or producer change is included.

### Actual-worker paired throughput

Command: `flock -w 1800 /tmp/graph-ng-harness.lock timeout --kill-after=5s 1200s node scripts/wasm-kernel-browser.mjs`. `GRAPH_CHROMIUM` may name an already installed browser; this script never downloads one. It checks `free -g` for at least 8 GiB available before launching one headless browser. This run used Chromium 151.0.7922.34 on a hybrid x86 desktop-class Linux host, with other host workloads and no CPU throttling. It is not a mobile, low-power hardware, full-app startup or renderer measurement.

The harness bundles the actual baseline worker from the frozen Git sources and the actual candidate worker, using the same current bridge. Synthetic 16-group fixtures have about 3.1 edges per node. Initial projection/layout and two warmups per size/mode/backend precede six pairs, alternating which backend runs first. Each measured RPC runs 100 iterations from the same Float32 seed, includes solver initialization, linear-memory allocation, the normal streamed buffers every five steps and the worker round trip, but excludes row ingestion/projection and main-realm seed preparation. Workers compute sequentially. Reported medians average the middle two of six times; all raw samples are retained. Compilation is hot during measured pairs. A separate cold allowing-policy worker measured approximately 0.1 ms compilation and 0.1 ms instantiation of the small module, not whole-layout initialization.

| Nodes | Mode | JS median ms | Scalar median ms | Speedup |
| ---: | --- | ---: | ---: | ---: |
| 5,000 | Ordinary | 597.15 | 430.00 | 1.389x |
| 5,000 | Overlap | 1229.00 | 838.90 | 1.465x |
| 20,000 | Ordinary | 2577.15 | 1850.00 | 1.393x |
| 20,000 | Overlap | 5403.05 | 3741.00 | 1.444x |
| 49,000 | Ordinary | 7139.10 | 5127.75 | 1.392x |
| 49,000 | Overlap | 15755.70 | 10622.00 | 1.483x |

All **36 paired final Float32 buffers are bit-identical**; a mismatch aborts the harness. Gated unit tests additionally compare every step at 5k/20k/49k (three Morton refreshes in the 20k/49k lanes), pinned masks, family pull, LinLog, outbound distribution, strong gravity, self/parallel edges, coincidence, signed zero, small extents and the all-pairs path. Both backends retain nonfinite-force rejection rather than accepting an overflowed result. The reference constructor override changes no saved physics option.

All **24** actual-worker Stop checks pass: 5k/20k/49k, ordinary/overlap, `layout`/`recompute`, and stream cadence 1/1000 with a batch budget of 1000. Sparse-stream Stop is sent after 150 ms rather than waiting for a snapshot. The worst measured response is **63.4 ms**, below the 500 ms gate. Every stopped result remains unsettled. One solver step remains atomic; this is measured evidence, not a universal latency bound.

### Added memory and collection

The following is **extra linear memory**, not total solver heap, virtual address reservation or browser RSS. It duplicates the numeric data needed by the kernel while keeping JS authoritative for fallback. Figures include a pinned mask; overlap additionally includes radii. Memory is rounded to 64 KiB pages and capped at 256 MiB. Layouts that exceed the cap or whose JS tree grows beyond the copied capacity select JS rather than resize in a step.

| Nodes | Mode | Extra linear bytes | Extra MiB |
| ---: | --- | ---: | ---: |
| 20,000 | Ordinary | 5,898,240 | 5.62 |
| 20,000 | Overlap | 5,963,776 | 5.69 |
| 49,000 | Ordinary | 14,352,384 | 13.69 |
| 49,000 | Overlap | 14,548,992 | 13.88 |

A dedicated worker probe performs **ten consecutive three-step layouts in each size/mode**. It retains all ten final JS position arrays, but only weak references to the native instances and linear memories. After each layout, task boundaries and explicit full GC leave **zero live previous instances and memories** in every sample. Every layout uses the same byte size, with no mid-step growth. This proves the accelerator state is collectible and is not retained by the compiled-module cache; it does not prove when automatic GC runs or when the browser returns allocator pages to the OS. Keeping the JS copies is intentional: discarding them would weaken exact trap recovery or move authority into WASM to save at most about 14 MiB on this fixture.

### Fallback and evidence boundary

Real cold-worker CSP denial chooses JS and produces exact coordinates. The allowing `wasm-unsafe-eval` policy chooses the scalar kernel with the same coordinates. Unit failure injection covers an absent API, rejected instance construction, denied memory growth, repulsion and attraction traps after partial writes, tree growth and unchanged force buffers on rejection. A trap disables acceleration for the remainder of that layout; no partial forces are published. Linear-memory/view identities remain stable across steps. No plugin policy is weakened and no network module request exists.

Ignored receipts are `.workspace/evidence/wasm-kernel/browser-results.json` and the corresponding frozen/candidate worker artifacts. Browser output and the copied research prototypes are retained separately for integration review. The exact bundle delta and deterministic final-gate receipt are recorded below. The wrapper received independent structural review; full integration, native host fidelity, low-power hardware and publication acceptance remain separate.

### Deterministic final verification

The required wrapper `flock -w 3000 -E 75 /tmp/openclast-bun.lock timeout --kill-after=5s 1800s ./scripts/run.sh build` passes. The same wrapper with `test --timeout 10000` passes **857 tests, one existing skip, zero failures** across 40 files, including the new scalar tests and existing actual-worker Stop regressions. The same wrapper with `gates` passes all six lanes: secrets, attribution including reachable commit identities/messages, private terms, frozen supply chain, runtime licenses and bundle size. Installs used `--frozen-lockfile --ignore-scripts`; runtime dependencies and trusted dependencies remain empty. The reproducibility check is also part of the deterministic suite.

`node scripts/bundle-size.mjs` reports **418,073 raw / 142,971 gzip / 122,488 Brotli bytes**, exactly **+4,125 raw / +1,995 gzip** against the standalone `3d7096b` build (413,948 / 140,976). Raw and gzip are within the unchanged **420,000 / 145,000** ceilings; Brotli remains reporting only. The minified bundle SHA-256 is `053a730ced8c824bf8ddc729dd013d36960806a9b70ddc5b4636479a817869a0`. Exact build/test/gate and size receipts are retained in `.workspace/evidence/wasm-kernel/verification/`; commit association is retained with the integration handoff. No push, hosted CI, room deployment, Obsidian binary, screenshot or real vault is involved in this slice.
