# Benchmark methodology and evidence

Results belong to an exact invocation, fixture, source revision and hardware class. They do not establish all-scale acceptance. Baseline slice-1 source is `041e1382` (2026-11-10); the README's recorded runs distinguish earlier/pre-review measurements from final review regressions. This release-tooling change does not rerun the expensive large/browser benchmarks. Raw receipts remain ignored and local; publish only scrubbed summaries without hostnames, usernames, real-vault paths or private projections.

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

## Retention and honest reporting

Keep raw benchmark receipts by source commit and hardware class in `.workspace/evidence/` until their summary is accepted; do not silently overwrite acceptance evidence with another fixture. Screenshots stay in ignored `test-screenshots/`, synthetic only, with visual review before sharing. Downloads/caches and reproducible synthetic outputs may be age-pruned only within their owned paths after evidence capture; there is no automatic broad cleanup. Keep per-version release checksums indefinitely with the release record. Define any future retention knob explicitly rather than deleting evidence opportunistically.
