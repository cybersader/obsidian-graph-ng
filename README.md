# Graph NG

A standalone, local-first Obsidian graph plugin. Start with a readable graph of declared groups, inspect counted relationships and their carrier notes, then drill into individual notes when hardware WebGL is available. No ontology, framework name, relation vocabulary, or ID format is built into the core.

**Slice 1 / test-backed alpha.** This is not production, mobile, integrated-GPU, or remote-authorization acceptance. No server, remote repository, hosted service, or telemetry is configured. All fixtures and captured evidence are synthetic.

## Use

1. Build locally using `./scripts/run.sh build`. Copy `main.js`, `manifest.json`, `styles.css`, `NOTICE`, and `THIRD_PARTY_NOTICES.txt` into a synthetic vault’s `.obsidian/plugins/graph-ng/` directory. Enable the plugin yourself.
2. Run **Graph NG: Open graph** or use the fork ribbon icon.
3. The initial **Groups** screen shows a page of nonempty declared groups with readable labels/member counts and counted edges between groups on that Canvas page (six groups by default). Independent previous/next controls page the Canvas, group list, and complete relationship list. Cross-page relationships remain accessible in the relationship list. Pairs use ↔ because they aggregate both directions; hover/click for type/directional counts and contributing edges/carrier notes. Self-pairs are retained.
4. Click a group to see its members. Hardware WebGL also opens that group’s node graph. Clicking a graph node or member opens its existing note. **All notes** opens the full detailed graph. Zooming out returns to groups.
5. Settings → Graph NG contains separate declaration and tuning JSON editors. **Validate and save** rejects invalid input and rebuilds. Changing `debounceMs` requires a plugin reload.

Software renderers such as SwiftShader/llvmpipe, major performance caveats, missing WebGL2, and renderer initialization failures use the same Canvas2D group screen. Member/carrier lists remain usable; this is deliberately not a 60,000-node software-rendered graph. Lists are paginated. If Canvas2D itself is absent, the group buttons remain accessible.

## Meaning is declared

The default declaration has no identity property, no ontology rules, no predefined colors, and no reified-note keys. It uses literal note paths as identities, top-level folders as groups, and the public Obsidian resolved-link producer. Its producer name is pinned to `obsidian-links@<apiVersion>`; this identifies the host link resolver, not a new Markdown parser. A declaration copied from another version must explicitly update that pin.

See [`examples/default-declaration.json`](examples/default-declaration.json), [`examples/default-settings.json`](examples/default-settings.json), and [`examples/concept-mapping-declaration.json`](examples/concept-mapping-declaration.json). The concept/mapping declaration is **only an example**, not a special adapter or a core assumption. One possible use is a Crosswalker-like mapping vault. Its synthetic concepts have `id` and `family`; mapping notes have `subject_id`, `object_id`, and `predicate`.

Declaration v1 supports:

- `identity`: ordered frontmatter keys. The first present scalar value becomes the ID; otherwise the exact path is used. Conflicting identity owners, including identity/path-alias collisions, are all quarantined from projection. The status and a paginated conflict list show affected note paths/IDs; unrelated nodes/edges remain usable. Duplicate exact input paths still fail rather than silently selecting a row.
- `edges`: explicitly named `reified`, `inline`, or `producer` sources. Reified edges resolve two declared properties to identities and retain their carrier note; optional `typeKey`/`type` supply the relation type. Inline values are literal IDs, not guessed wiki-link/ontology syntax. Producer maps must match the exact declared producer name and contain existing note paths.
- `display.reifiedAsNodes`: false means concept → concept with the relationship note as carrier. True means concept → relationship-note → concept. Multiple edges and self-links survive. Unresolved endpoints are dropped and counted.
- `groups`: property-key or folder-depth sources. `groupLevel` selects one source; these are selectable groupings, not an inferred ontology hierarchy. Missing values form an explicit group. No group declarations means “All notes.”
- `columns`: dictionary-coded property columns available to filters. Group/color keys are also materialized.
- `colors`: ordered named color predicates; the first match wins. Group colors use an explicitly matching color name when present.
- `carrierResolvers`: explicit kind → property-key bindings for producer carrier IDs. `$path` means an exact existing local note path; no naming heuristic is used. Ambiguous or absent matches stay disabled.

The toolbar accepts one exact predicate, or empty input to clear it:

```json
{"kind":"eq","key":"family","value":"Family 1"}
```

```json
{"kind":"folder","prefix":"Concepts/Family-1"}
```

Equality preserves scalar types: `1`, `"1"`, `true`, null and missing differ. Folder matching includes descendants at path boundaries, not lookalike prefixes. No regex/query-language/body search is implemented.

## graph-projection v0 (draft)

Set tuning `projectionFile` to a vault-relative JSON path, for example `graph-projection.json`. This is a neutral **aggregate-only producer seam** using the same group renderer, not a server connection. See [`examples/graph-projection-v0.json`](examples/graph-projection-v0.json).

```json
{
  "schema": "graph-projection-v0",
  "producer": {"name":"synthetic","projection":"example","asOf":"2026-11-10"},
  "groups": [
    {"id":"a","label":"Family 1","count":1,"identityPrefix":"concept:alpha:"},
    {"id":"b","label":"Family 2","count":1,"identityPrefix":"concept:beta:"}
  ],
  "groupEdges": [{
    "a":"a","b":"b","total":1,
    "typeCounts":{"aligns":1},
    "directional":{"aToB":{"aligns":1},"bToA":{}},
    "carriers":{"kind":"mapping-id","ids":["mapping:1"]}
  }],
  "coverage":{"source":"synthetic example"}
}
```

Group IDs must be unique; endpoints must exist; only one unordered edge per group pair is allowed. Counts must be nonnegative integers; totals and directional counts must agree with per-type counts. `schema`, `producer`, `coverage`, `directional`, `openPath`, and `identityPrefix` are optional draft fields. Coverage is producer-supplied metadata, not independently measured completeness.

Carrier IDs are opaque. The example declaration explicitly binds `mapping-id` to frontmatter `id`. The adapter builds one lookup over its row iterator on first carrier use and reuses it until refresh; it does not copy/filter a full snapshot for each carrier. Ambiguous IDs stay disabled. A group can optionally supply `openPath` for an existing note and/or `identityPrefix` to find local members through declared identity keys. Producer aggregates contain no individual-node positions or complete member bodies; the detail view is therefore unavailable. The toolbar’s local column filter applies only to local projections, not producer totals. This slice has a file API and exported core validation/types, not a network/plugin messaging API.

Optional tuning `maxProjectionGroups`, `maxProjectionPairs`, and `maxProjectionCarriers` defines an explicit aggregate envelope. Each defaults to zero (unlimited); positive limits reject violations visibly rather than dropping data. Carrier limits count IDs across all pairs. JSON parsing still happens before validation, so these settings are not streaming byte/memory limits.

## Architecture and incremental behavior

`src/core/` is pure TypeScript with no Obsidian imports or DOM access. It interns IDs into dense indices, stores source/target/type/carrier edges in u32 columns, and builds bidirectional CSR adjacency. Properties/groups are dictionary-coded; folder ranges support exact prefix filtering. Adjacency contains both directions, while edge columns retain direction and multiedges. Group contraction retains counts, directional type totals, members and contribution records.

`src/adapter/` uses public `vault` and `metadataCache` APIs only. It consumes frontmatter and the host’s resolved-link map; it does not parse note bodies. Create/change/modify/resolve/delete/rename events coalesce for configurable `debounceMs` (five seconds by default). Each pending path is read at most once per emitted batch. Folder events traverse only that folder’s descendants; changed link sources outside it arrive through public per-file resolve events. Global resolver completion signals readiness without rereading the vault. Cached indexed/listed counters avoid coverage rescans. One metadata-complete startup reconciliation remains necessary; CSR and group projection still rebuild per batch.

Seeded ForceAtlas2 runs in a bundled Blob Web Worker using Graphology. A shared SHA-256 key authority includes the declaration, layout settings, layout producer, exact paths, declared property inputs, and sorted links from explicitly selected producers. Undeclared metadata/producer changes and resolved-link enumeration order do not reseed layout. Initial positions use an LCG derived from that key. The same runtime/input/settings are deterministic; bitwise identity across JavaScript engines is not promised. Persisted positions are validated and indexed by declaration/exact generation key. Only one declaration generation is retained by default. Positions are local plugin data, not frontmatter.

Exact-key hits restore positions without layout. Key misses can warm-start from a persisted generation after a complete process restart when declaration/layout/producer match; stored topology keys identify changed endpoints. Existing positions survive by declared identity, new nodes start at existing-neighbor barycenters when possible, and new/changed edge endpoints plus one-hop neighbors relax. Untouched nodes stay fixed. Attribute-only edits and deletions do not globally relayout. Partial metadata and unresolved producer-link startup states cannot overwrite the last complete cache. An included spatial-grid primitive is tested, but the Sigma host uses Sigma’s public picking rather than that grid.

Group view builds its label map once, then renders bounded replacement pages instead of accumulating every button. Canvas pages default to six groups and only their mutual pairs; complete group/pair/member/carrier lists have independent `listPageSize` pages. A short container uses a grid, otherwise a ring. Long labels truncate with full hover/list text; count labels use collision checks and a final paint pass. This is a readable paged overview, not simultaneous rendering of every group.

`src/renderer.ts` keeps Sigma behind a small renderer interface. Sigma 3.0.2 and Graphology 0.26.0 are exact runtime pins. The independent headless JSON builder uses the same core: `./scripts/run.sh project examples/facts.json examples/concept-mapping-declaration.json .workspace/example-projection.json`. Its `graph-ng.local-projection.v1` envelope includes columns/CSR/positions and aggregate groups; it is **not** the aggregate-only draft input and must not be set directly as `projectionFile`.

## Defaults and tuning

The generated [`examples/default-settings.json`](examples/default-settings.json) is the full editable settings shape. No hidden graph-size cutoff silently discards nodes.

| Setting | Default |
| --- | --- |
| Event debounce / worker deadline | 5,000 / 120,000 ms |
| Full / incremental FA2 iterations | 100 / 30 |
| Layout seed / initial radius | 1 / 100; host derives effective seed from generation hash |
| Barnes–Hut / theta | true / 1.2 |
| Scaling ratio / gravity / slowDown | 2 / 1 / 1 |
| Edge-weight influence | 1 |
| linLogMode / outboundAttractionDistribution / adjustSizes / strongGravityMode | all false |
| Detail→group camera ratio / group source index | 1.8 / 0 |
| Node / edge / label size | 3 / 0.5 / 13 |
| Group radius / ring padding / curve divisor | 26 / 56 / 5 |
| Group edge hit radius / curve samples / loop scale | 6 / 32 / 1.5 |
| Label density / grid cell / rendered-size threshold | 1 / 100 / 6 |
| Group edge width scale / list page size | 0.8 / 100 |
| Canvas group page size | 6 |
| Aggregate groups / pairs / carrier IDs limit | 0 / 0 / 0 (each unlimited) |
| Background / node / edge / group / text | `#141b26` / `#7fc8e7` / `#43566e` / `#7fc8e7` / `#edf4ff` |
| Persist layout / cached declarations / producer file | true / 1 / empty |

All listed values are validated settings. The slice uses 100 full iterations, not the design sketch’s proposed 300. The worker deadline is an explicit configurable limit; it is not a file-count limit. No fixed file/node cap is enforced. Large graphs still consume memory and can exceed the deadline.

## Development and exact commands

Bun, Node.js, `flock`, and the host’s `build-contained` wrapper are prerequisites for these commands. `scripts/run.sh` changes to this repository and serializes each Bun command inside that containment wrapper. In an environment without the wrapper, provide an equivalent build-contained setup rather than silently bypassing it. The test launcher uses synthetic copies only; it downloads Obsidian binaries into ignored cache storage.

| Task | Command |
| --- | --- |
| Dependencies | `./scripts/run.sh install --frozen-lockfile` |
| Runtime license gate | `./scripts/run.sh licenses` |
| Typecheck + bundled plugin/worker | `./scripts/run.sh build` |
| Deterministic unit subset | `./scripts/run.sh test` |
| 2,000-note fixture | `./scripts/run.sh fixture --small` |
| 60,600-note semantic fixture | `./scripts/run.sh fixture` |
| Same fixture, 60,600 literal nodes | `./scripts/run.sh fixture --literal` |
| Native small hardware | `./scripts/run.sh e2e` |
| Native software | `GRAPH_SOFTWARE=1 ./scripts/run.sh e2e` |
| Native large semantic | `GRAPH_LARGE=1 ./scripts/run.sh e2e` |
| Native large literal | `GRAPH_LARGE=1 GRAPH_LITERAL=1 ./scripts/run.sh e2e` |
| Pure-core benchmark | `./scripts/run.sh bench` |
| Actual-renderer browser benchmark | `./scripts/run.sh bench:browser` |

`CHROME_BIN` optionally selects an existing Chrome executable for the browser benchmark. Fixtures, generated bundles, screenshots, cached app binaries, raw receipts, and `.workspace/` worklogs are ignored. Fixture generation writes only the named synthetic small/large destinations; regenerate a matching mode before its native invocation. Never aim this generator at personal vaults.

## Measured evidence — 2026-11-10

One host: Intel i9-12900K, approximately 31 GiB RAM, NVIDIA RTX 4060 Ti (ANGLE), Linux, Bun 1.3.14. These are single-host observations, not an integrated-GPU/laptop reference result. Native Obsidian app and installer were both 1.13.7; the development API package is 1.12.3.

### Native Obsidian functionality

The exact executed prefix was `flock /tmp/obsidian-graph-ng-build.lock build-contained --` followed by the command below. Private raw receipts are in `.workspace/evidence/`; screenshots are in `test-screenshots/` and were opened/read, not merely generated.

| Command and subset | Observed result |
| --- | --- |
| `bun test tests/core.test.ts tests/adapter.test.ts` | 28 pass, 0 fail, 115 assertions; 560 ms on the final run. Covers core declarations/CSR/filters/layout plus review regressions below. |
| `bun run e2e` (small hardware, final 9-test suite) | 9/9 pass; 600 nodes / 1,400 edges from 2,000 notes. Cold graph open 356 ms after metadata ready; worker 81 ms; offline cached view reopen 33 ms; full app restart + persisted cache restore 3,148 ms. Spec 24.4s; invocation 26s. |
| `GRAPH_SOFTWARE=1 bun run e2e` (small software, final 9-test suite) | 9/9 pass; SwiftShader detected and detail rendering disabled. Groups/member/carrier operations pass; cold 358 ms, worker 82 ms, offline view reopen 139 ms; app restart + persisted restore 3,074 ms. Spec 24.8s; invocation 26s. |
| `GRAPH_LARGE=1 bun run e2e` (earlier 4-test semantic suite) | 4/4 pass on 60,600 notes → 16,000 nodes / 44,600 edges; cold 3,247 ms, worker 2,708 ms, cached view reopen 238 ms. Full invocation approximately 3m02s including metadata startup. This predates the review fixes and expanded suite; it is not current nine-test acceptance at that scale. |
| `GRAPH_LARGE=1 GRAPH_LITERAL=1 bun run e2e` | **Blocked:** synthetic metadata indexing exceeded the explicit 180-second before-hook budget; no graph test ran. Literal native functionality is not accepted by this invocation. |

Final small-fixture incremental mapping edits settled in 5,215 ms hardware / 5,114 ms software, **including** the configured 5,000 ms debounce; 591/601 positions stayed bit-identical. A separate persisted **key-miss** restart adds an isolated note: all 600 existing positions remain bit-identical, 601 positions are finite, and the saved key differs. Another test creates a duplicate ID: both conflicting notes are listed/excluded while the unrelated graph remains usable. The hardware lane checks actual WebDriver node-pointer clicks; both lanes check carrier navigation, offline reuse, exact-cache restart, aggregate input and fallback-safe navigation.

The final aggregate e2e loads a **synthetic 16,000-group / 44,600-pair producer file**, not a 60,600-note native vault: first synchronous group-page render 2.5 ms in each lane; total file-load/validation/first-page 104 ms hardware / 97 ms software. DOM lists have 25 rows each, Canvas has six groups, and next-page navigation replaces rows. This measures bounded initial rendering, not rendering all groups simultaneously.

Unit review probes A–F cover unrelated metadata not changing hash/cold layout, sorted producer links, own-key `constructor` relation counts, duplicate-ID/path-alias quarantine, bounded 16k-group planning, and literal quoted folder names. Persisted warm starts and configured aggregate limits have regressions too. The measured adapter regression uses 1,000 notes, seven renamed descendants, and an explicit 37 ms debounce: repeated folder/file rename and resolve bursts read exactly seven notes once, repeated modify/resolve reads one, delete reads zero, and each lane performs zero whole-vault listings after startup. Markdown→text→Markdown rename reads zero/one respectively and maintains coverage correctly.

The restart tests also retain the startup-race regression: initial metadata-incomplete rows cannot replace a complete saved generation. The adapter reconciles once at initial metadata completeness and stays event-driven afterward. The headless example command above passed with two nodes/one edge. Final `node scripts/check-licenses.mjs` (six MIT runtime packages) and `bun run build` passed. Private final combined log: `.workspace/final-review-gates.log`; native receipts: `.workspace/evidence/e2e-small-{hardware,software}.json`.

### Pure-core benchmark

Earlier, pre-review baseline (not rerun after the fixes): `bun scripts/benchmark.ts`, one full layout per mode, seed 17 fixture, 100 iterations, Barnes–Hut theta 1.2. Filters/colors use 20 repetitions.

| Mode | Nodes / edges | Build | Group contraction | Filter+color p95 | Typed columns / positions | FA2 in Bun |
| --- | --- | --- | --- | --- | --- | --- |
| Semantic | 16,000 / 44,600 | 90.56 ms | 21.93 ms | 0.496 ms | 1,326,404 / 128,000 bytes | 20,436.93 ms |
| Literal | 60,600 / 89,200 | 140.06 ms | 45.85 ms | 1.518 ms | 3,110,404 / 484,800 bytes | 89,689.95 ms |

The column measurement excludes string dictionaries, object rows, contribution lists and renderer allocations. Process RSS/heap receipts include fixture construction and sequential allocations; neither is an isolated plugin-memory/GPU-memory claim. Bun timings are not Electron-worker timings.

### Renderer benchmark scope and gaps

The separate browser benchmark bundles the actual core, layout worker, and Sigma detail renderer into Chrome. It uses a 1280×800 viewport, DPR 1, labels enabled at the configured density/size threshold (not forced onto every overview node), a three-second scripted pan/zoom, five discarded warmup frames, one repetition per mode, and a final GL finish. The literal overview is a dense hairball; a high FPS does not make it readable. Group-first navigation is the intended overview. It renders static graph buffers through public Sigma partial refresh rather than rebuilding the entire graph every frame. Heap is main-realm retained JavaScript heap after forced GC, not GPU/native/worker memory. The raw browser receipt includes browser/GPU identity and page errors.

Post-review public-API command: `CHROME_BIN="$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome" bun scripts/browser-benchmark.ts` under the exact containment/lock prefix above. Chrome 151.0.7922.34, one repetition, zero page errors. This detail-renderer run preceded the last group-label-only paint adjustment and adapter extension-rename regression; the final native lanes above cover those changes:

| Mode | FPS / p95 frame | Worker layout | First view | Retained main JS heap | p95 load long task |
| --- | --- | --- | --- | --- | --- |
| Semantic, 16,000 nodes / 44,600 edges | 60.00 / 16.8 ms | 2,662.7 ms | 3,243.1 ms | 25.01 MiB | 267 ms |
| Literal, 60,600 nodes / 89,200 edges | 60.00 / 16.7 ms | 12,616.8 ms | 13,498.9 ms | 66.42 MiB | 501 ms |

These steady-state discrete-GPU results exceed 45 FPS, but the load long-task target fails in both modes. The initial group screen does not wait for the full worker layout. The literal first-view cost is specifically a full individual-node benchmark, not the producer aggregate screen. An earlier benchmark that rebuilt all renderer data every frame is retained privately as an invalidated baseline and is not used for acceptance.

Native WebDriver requestAnimationFrame sampling produced **zero callbacks**, so native FPS is **unavailable**, not zero FPS and not accepted. The full literal native lane remains uncovered. Main-thread projection/JSON/render-buffer load tasks exceed the design’s ≤50 ms target; only layout is off-thread in this slice. Desktop midrange-GPU browser smoothness does not establish startup responsiveness, mobile support, integrated-GPU acceptance, 1M-node rendering, or server grant-safety.

## Licensing and boundaries

MIT, copyright 2026 **cybersader**. No third-party plugin implementation was copied. `scripts/check-licenses.mjs` recursively examines the **installed shipped runtime dependency and peer graph**, verifies actual LICENSE/COPYING text, rejects cosmos/cosmograph packages, and generates `THIRD_PARTY_NOTICES.txt`. The recorded runtime audit passed six packages, all MIT: Sigma, Graphology, graphology-types, graphology-utils, events, and graphology-layout-forceatlas2. Legal comments and the generated notice file accompany the build. Cosmos is deliberately excluded; its actual CC-BY-NC-4.0 license is not permissive.

**Separate development/test-toolchain exception:** `wdio-obsidian-service` uses `7z-wasm` (LGPL with the unRAR restriction) to extract downloaded test applications. It is not imported by the plugin, bundled, or shipped in the runtime artifact. This is an explicitly scoped e2e toolchain exception, **not** a claim that every development transitive dependency is permissively licensed. Obsidian itself is downloaded at test runtime into ignored storage and is never committed.

## Not implemented / not proven

- No server adapter, remote grant enforcement, tiles, streaming/resumable graph transport, REST/MCP routes, hosted deployment, or server privacy review.
- No Leiden/community inference, tag-prefix grouping, automatic hierarchy discovery, compound filter language, or ontology parser.
- No GPU-less individual-node graph, mobile real-device evidence, integrated-GPU proof, native FPS result, isolated plugin memory, or GPU-memory measurement.
- Projection, snapshot hashing/serialization, aggregate contributions and Sigma buffer construction still run on the main thread. Load long tasks fail the responsiveness target; this slice does not conceal that behind a high steady-state FPS.
- Group Canvas2D uses paged ring/grid layouts, not tens of thousands of simultaneous labels. Collision suppression can omit a count label; the complete values remain in hover/relationship lists. It is not a general all-scale label-layout solution.
- Incremental rows do not imply incremental CSR mutation. A declaration/layout change rebuilds; cache persistence includes ordinary JSON positions/topology and can be sizeable. Exact-key generations reuse positions directly; compatible key misses warm-start by identity. Old cache entries without topology retain existing positions conservatively.
- The local producer file is reloaded when its existing file is modified. Missing files produce a visible error; there is no background network fetch/retry service.
