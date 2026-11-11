# Benchmark methodology and evidence

Results belong to an exact invocation, fixture, source revision and hardware class. They do not establish all-scale acceptance. Original slice-1 source is `041e1382` (2026-11-10); release-readiness baseline is `9b8cc07`. Historical tables below remain dated evidence. The slice-2 section records the new worker/browser/native invocations and unmet targets separately. Raw receipts remain ignored and local; publish only scrubbed summaries without hostnames, usernames, real-vault paths or private projections.

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
