# Benchmark methodology and evidence

Results belong to an exact invocation, fixture, source revision and hardware class. They do not establish all-scale acceptance. Original slice-1 source is `041e1382` (2026-11-10); release-readiness baseline is `9b8cc07`. Historical tables below remain dated evidence. The slice-2 section records the new worker/browser/native invocations and unmet targets separately. Raw receipts remain ignored and local; publish only scrubbed summaries without hostnames, usernames, real-vault paths or private projections.

## Hardware classes and scope

| Class | Evidence |
| --- | --- |
| Desktop discrete GPU | Measured: Intel i9-12900K, approximately 31 GiB RAM, NVIDIA RTX 4060 Ti (ANGLE), Linux. Bun 1.3.14; native app/installer 1.13.7; browser Chrome 151.0.7922.34. |
| Desktop software GL | Measured: SwiftShader on the same desktop. Group/member/carrier fallback only; no individual-node GPU graph acceptance. |
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

Browser sampling uses actual core/worker/Sigma at 1280×800, DPR 1, configured label density/size threshold, three seconds of scripted pan/zoom, five discarded warmup frames, **one repetition per mode**, and a final GL finish. Heap is retained main-realm JavaScript after forced GC, not GPU/native/worker memory. Static buffers use public Sigma partial refresh; the earlier every-frame-rebuild baseline was invalidated. Dense literal overview readability is not captured by FPS.

Native cold-open begins after metadata readiness; full invocation includes metadata indexing/startup. Cached view reopen differs from full app restart + cache restore. Incremental settle includes the configured 5,000 ms debounce. Native rAF sampling returned no callbacks: native FPS is unavailable, not zero and not accepted. Report p95 frame/load long task separately from steady-state FPS; load tasks target at most 50 ms and currently fail.

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

## Retention and honest reporting

Keep raw benchmark receipts by source commit and hardware class in `.workspace/evidence/` until their summary is accepted; do not silently overwrite acceptance evidence with another fixture. Screenshots stay in ignored `test-screenshots/`, synthetic only, with visual review before sharing. Downloads/caches and reproducible synthetic outputs may be age-pruned only within their owned paths after evidence capture; there is no automatic broad cleanup. Keep per-version release checksums indefinitely with the release record. Define any future retention knob explicitly rather than deleting evidence opportunistically.
