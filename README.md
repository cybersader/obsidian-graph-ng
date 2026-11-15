# Graph NG

A standalone, local-first Obsidian graph plugin. Start with a readable graph of declared groups, inspect counted relationships and their carrier notes, then drill into individual notes when hardware WebGL is available. No ontology, category vocabulary, relation vocabulary, or ID format is built into the core.

**Built for big, connected collections of notes.** Graph NG grew out of work on OpenClast and Crosswalker, where thousands of notes need to be explored together—not just listed. It brings that same approach to your Obsidian vault; neither project is required.

**Version 0.5.2 candidate / test-backed alpha.** This update exposes three existing layout settings with numeric drafts and explicit apply/reset. It does not add a layout engine, fix globally dense graphs, or change host loading/indexing or node-label policy. Independent review and runtime visual acceptance are still required; runtime visuals and performance remain **UNOBSERVED**. This is not production, mobile, integrated-GPU or remote-authorization acceptance. No server, hosted service or telemetry is configured. All fixtures and captured evidence are synthetic.

## Nodes sizing successor (unreleased)

In **Appearance → Nodes**, numerical radius (CSS pixels), maximum degree prominence (radius multiplier), density compensation (%) and minimum retained size (%) are drafts. **Preview sizing** changes only the current renderer; **Apply and save sizing** validates and persists after acknowledgement. **Restore saved sizing** discards the preview. Existing and new installations keep legacy appearance until explicit adoption. Sizing is saved in this plugin’s settings; saved views do not snapshot appearance.

**Degree curve** (`visuals.degreeCurve`) sets how degree becomes size; it is a draft like the numbers above. Square root, Logarithmic and Linear scale disc **area**, not radius: a degree-0 note keeps the base radius, the highest-degree note visible in the projection reaches maximum prominence P (radius × P, area × P²), and the extra area in between is proportional to √degree, log₂(1 + degree) or degree relative to that maximum. Square root (the default for new installations, with P = 5) separates hubs from leaves on large graphs while single-link notes stay readable; Logarithmic is gentler; Linear grows only the largest hubs. **Previous** is the earlier curve (radius grows with log₂(1 + degree)); saved settings without a curve load as Previous with their saved prominence, so existing appearance changes only when you pick a curve and apply. Every curve stays within [1, P] × radius, so picking, density compensation, the floor and Canvas/WebGL parity are unchanged, and changing the curve never reruns layout or re-ingests.
**Suggested for this graph** (top of **Appearance**, node graph open) lists opinionated starting points derived only from projection counts: notes, edges, average and maximum degree (hub ratio = max ÷ average), edge notes and groups. Each row reads *setting: current → suggested · reason*; thresholds are documented rules of thumb in `src/recommend.ts`, not vault measurements. Rules: edge opacity 0.15 / 0.25 / 0.6 for ≥20k edges or ≥12 links per note / ≥5k or ≥6 / <500 and <3; degree sizing 1 / 2.2 / 0.6 for hub ratio ≥25 / ≥4 / below (20+ notes); label density 0.5 / 0.75 / 1.5 for ≥20k / ≥5k / <300 notes; glow off at ≥5k notes; curved edges off at ≥20k edges; group halos off above 32 groups; edge-note opacity 0.45 when edge notes are at least half the notes. Values within 0.02 of the current one are not suggested. Only existing presentation keys change, always within validation. **Preview suggestions** swaps an unsaved candidate into the current renderer (**End preview**, switching tool or closing restores it); **Apply** (per row) and **Apply all and save** use the same acknowledged write as sizing, so live settings change only after the save succeeds and a failed write restores stored settings. Nothing is applied automatically; layout physics is not suggested because it needs a recompute.

Predictable sizing uses a fixed 3 CSS-pixel density reference, so increasing requested radius cannot cancel itself through density compensation. Ordinary unhighlighted radii are reported at current zoom; carrier multipliers, highlight (+2 px) and glow remain distinct. Degree means incident projected edges, not unique neighbours. Scalar sizing does not rerun layout, fit the camera or recreate the renderer. Native/browser visual acceptance and independent review remain unperformed; runtime budgets are unchanged.

The supported predictable base radius is at most `floor(((2^24 - 1) / 2.3 - 2) / (9 × 4))` CSS pixels. This derives from binary32 integer-pixel precision, reserving the existing maximum degree/carrier multipliers, highlight and glow extents; it is not a slider cap. Unsupported drafts fail before preview/save, without clamping. Label placement independently rejects nonfinite or inexact cell coordinates and handles wide boxes by bounded comparisons against accepted labels instead of traversing huge cell spans. Edge-note size changes coalesce label regeneration; stale GPU offsets are hidden until replacement rather than overlapping enlarged carriers.

### Progressive sliders and fine scrubbing

Appearance, Nodes and Layout sliders share one progressive mapping: slider travel follows a power or logarithmic curve, so the commonly tuned low range (faint edge opacity, small radii, light glow, forces near their defaults) gets most of the track. Stored settings keep their existing units and ranges; only the slider position mapping changed, so no settings migration occurs. The numeric field beside each slider is the exact, editable value; slider steps round to four significant digits and endpoints are exact.

While pressing a slider (mouse, pen or touch), move the pointer up or down away from the track to scrub more slowly: full speed near the track, then ½, ¼ and 1/10 speed further away, with a small "Fine: ¼ speed" hint. Keyboard: arrows move 0.4% of the track, Shift+arrows 4%, PageUp/PageDown 10%, Home/End to the ends. Screen readers get the real value through `aria-valuenow`/`aria-valuetext`. Draft, preview and apply behavior is unchanged. Native pointer/touch acceptance is pending.

## Layout controls

Open **Layout** in graph controls. Numeric changes, checkboxes and presets are drafts until **Apply and recompute**; editing alone neither saves nor runs layout. A "What changes on apply" line lists every pending difference from the applied settings.

| Control | Existing setting | Visible effect and valid values |
| --- | --- | --- |
| Spread nodes | `layout.force.scalingRatio` | Pushes every node away from the others; higher = more space between nodes and clusters. More repulsion, not target link distance; positive finite. |
| Pull to center | `layout.force.gravity` | Draws everything toward the middle; higher = rounder, tighter graph; 0 lets unlinked parts drift. Nonnegative finite. |
| Tighter clusters (LinLog), advanced | `layout.force.linLogMode` | Weaker long-distance link pull separates well-linked groups into distinct clumps. |
| Dissuade hubs, advanced | `layout.force.outboundAttractionDistribution` | Heavily linked notes pull less, so hubs move to the edge of their cluster. |
| Prevent overlap, advanced | `layout.force.adjustSizes` | Nodes keep a minimum separation (`layout.nodeRadius`); settles more slowly. |
| Strong gravity, advanced | `layout.force.strongGravityMode` | Pull to center no longer weakens with distance; use with a small Pull to center. |
| Quality (iterations), advanced | `layout.iterations` | More steps = more settled shapes, slower apply. Integer 1 or more; the worker timeout still applies. |
| Step slowdown, advanced | `layout.force.slowDown` | Higher = smaller moves per iteration; positive finite. Not damping or animation speed. |
| Approximation, advanced | `layout.force.barnesHutTheta` | Lower = more accurate, slower repulsion; higher = faster, rougher. Positive finite. |

Each field also has a slider (spread and slowdown 0.1–100 logarithmic, gravity 0–20); sliders only edit the draft. The slider span is not a validation maximum: typed values outside it are kept unclamped and the slider rests at its end. **Reset to defaults** changes only three drafts to 2, 1, 1; applying remains explicit. Full settings validation preserves unexposed layout and appearance settings. Invalid, failed or stale worker results do not replace the last good settings or graph.
Advanced controls are collapsed by default. Presets fill drafts from defaults: **Clustered** (LinLog + Dissuade hubs, Spread 4, 200 iterations), **Spacious** (Spread 10, Pull 0.5), **Compact** (Spread 1, Pull 3). **Reset to defaults** restores every exposed control's default draft (Spread 2, Pull 1, Step slowdown 1, 100 iterations, Approximation 1.2, toggles off). There is no slider maximum or clamping of valid custom values. Edge weight influence stays hidden because projection edges are unit-weight. Full settings validation preserves unexposed layout and appearance settings (seed, maximum force, Barnes-Hut on/off). Invalid, failed or stale worker results do not replace the last good settings or graph.

Apply runs one finite layout-only worker recomputation on the current projection without body reads, source re-ingestion or cache mutation. Only a still-current open view commits settings and displayed positions. Positions can change; detail coordinates update on the same renderer/context with retained camera-frame bounds, camera and scope. **Fit graph** stays separate. Preview coordinates do not replace persisted worker generations: repeated applies start from the worker's previous completed baseline; ordinary refresh uses saved layout settings through existing cache validation. Saved-view schema is unchanged. External aggregate projections cannot apply note-layout settings.

## Use

1. Build locally using `./scripts/run.sh build`. Copy `main.js`, `manifest.json`, `styles.css`, `NOTICE`, and `THIRD_PARTY_NOTICES.txt` into a synthetic vault’s `.obsidian/plugins/graph-ng/` directory. Enable the plugin yourself.
2. Run **Graph NG: Open graph** or use the fork ribbon icon.
3. The initial **Groups** screen shows a page of nonempty declared groups with readable labels/member counts and counted edges between groups on that Canvas page (six groups by default). Independent previous/next controls page the Canvas, group list, and complete relationship list. Cross-page relationships remain accessible in the relationship list. Pairs use ↔ because they aggregate both directions; hover/click for type/directional counts and contributing edges/carrier notes. Self-pairs are retained.
4. Click a group to see its members. Hardware WebGL also opens that group’s node graph. Clicking a graph node or member opens its existing note. **View → Notes** opens the full detailed graph. Zooming out returns to groups.
5. Settings → Graph NG contains separate declaration and tuning JSON editors. **Validate and save** rejects invalid input and rebuilds. Changing `debounceMs` requires a plugin reload.

## Explore: filters, groups and visuals

The persistent toolbar keeps **Notes** / **Group overview** separate from **Saved views**, **Search**, **Filters**, **Appearance**, **Layout**, and **Graph information**. One flat overlay inspector covers part of the canvas without shrinking it. Close/Escape returns focus to the opener. Opening or switching tools does not fit, relayout or recreate the renderer. **Saved views** separates actual stored records from the **Focus on a folder** starting point; preparing a definition does not install or open it. Existing group-first opening remains unchanged.

Group clicks open compact, searchable member rows in the same inspector: note name, secondary path, bounded pages, arrow/Home/End navigation, and **Back to groups**. Pending member requests show a polite loading status; a current request failure offers **Back to groups**, without automatic retries or moving focus. Obsolete failures do not replace newer contents. Search covers the fetched group dictionary, not note bodies or a new semantic hierarchy. Collapse/Expand preserves keyboard focus on the same group action when its label changes. Full diagnostics stay in **Graph information**; partial/pending/error conditions retain a visible opener while ordinary healthy completion is quiet.

- **Search and filters.** Search matches note names and identities. Aggregate graphs disable note search and retain any stored query for later note views. Property filters (`is`, `is any of`, `exists`) are built only from declared `columns`, with live per-value counts of visible/total notes; filters combine with AND. The inspector opens with the scope name, an active-filter count and two tiles (nodes and edges shown of total, each with a small proportion bar). Each active filter is a compact pill with a plain-English summary when the form is recognizable (for example `!file.hasProperty("kind")` reads “kind is missing”), otherwise the expression in monospace; the full expression stays in the tooltip. Small icon actions with filter-specific accessible names edit it as an expression, edit a builder entry as JSON, or remove it; the summary text is never a click target. The property/operator/value builder sits in one aligned **Add filter** row, and **Filter expression** stays available. Derived groupings read in plain English (“Part 1 of curie (split at “:”)”), with labelled **Derive from / Take / Split at / Part** fields. Code-only updates must omit `data.json` and preserve existing settings and enabled state.
- **Group by.** Switch between declared group sources, any declared property, folder depth 1–4, or a **derived** source: a bounded, safe transform (segment N or first N segments; linear-time, no regular expressions) of an existing property, identity or path. No note needs a new property. See [derived group sources](docs/declaration-format.md#derived-group-sources).
- **Legend.** Per-group visibility, member counts, click to frame a group and, in the detail graph, collapse/expand a group into a single hub. Color rules are editable in place (color, order, add, delete, hide); notes matching no rule take a calm categorical group color. Color edits re-evaluate in the worker on existing columns.
- **Relationships.** Per-type visibility with visible/total counts and an optional source→target direction fade.
- **Display.** Degree sizing, node size, label density, edge opacity, edge color blend, glow, curvature, curved edges, mid-zoom group tint, graduated connection highlighting on hover or selection (see [below](#graduated-connection-highlighting-unreleased)) and zoom-faded labels.
- **Edge notes.** With `display.reifiedAsNodes`, relationship notes are drawn as nodes. They usually match no group, so they used to render as one neutral mass over the group colors. They now draw small, beneath the other notes, in the displayed color of their endpoints: one shared color gives that color at reduced alpha; endpoints of different colors (a bridge) blend both (`carrierBridge: "blend"`) or keep the source color (`"source"`), moved `carrierBridgeAccent` toward the theme accent. Opacity thins with edge-note density and rises when zoomed in. Zoomed out (camera ratio over home ratio above `carrierLodNear`, gone at `carrierLodFar`), they fold into their edges and are not pickable. All `carrier*` knobs live in `visuals`; the legend explains the treatment and Display offers opacity, size, tint and fold controls.
- **Relationship notes: Lines | Nodes.** Shown in **Appearance** only when the declaration has a `reified` edge rule. **Lines** (`display.reifiedAsNodes: false`) collapses each relationship note into one line between its endpoints; **Nodes** (`true`) draws each as a clickable dot between them, styled by the edge-note settings above, that opens like any note. The note states how many dots Nodes adds. Switching is one ordinary settings apply: it re-projects and re-runs layout with progress in Graph information; query, filters and grouping stay in settings; the camera is not carried across because the layout itself changes. A failed apply is reported beside the control and the displayed graph is left as it was. It is a global display setting, not stored in saved views. Layout reuse on switching back depends on `cachedDeclarations`: with the default `1` only the current display keeps a cached layout, so switching back recomputes it; set `cachedDeclarations` to `2` or more to keep both.
- **Saved views.** Named filter + query + group source + hidden/collapsed state + normalized camera bookmarks, kept in settings (`explore.savedViews`). **Starting points → Focus on a folder → Prepare** accepts a vault-relative folder, shows the definition and lets you name it. **Save view** waits for persistence acknowledgement; same-name replacement needs explicit confirmation. Saving does not change the graph. **Open** is a separate action. **Save current view…** uses the same editor and acknowledgement. Cancel, Escape or switching tools discards an unsubmitted draft; closing during a submitted write does not cancel it, and its result is available on reopening. Failed saves retain the draft and report storage uncertainty when recovery cannot be confirmed.

The folder definition uses a boundary-matched folder predicate plus folder-depth-1 grouping anchored at that prefix, with cleared search/hidden choices and no saved camera. Matches are checked when opened, not previewed or counted during authoring. Open refuses loading, external aggregates, selected-group scope, missing materialized properties and unavailable hidden definitions; use the existing **Workspace scope** action explicitly, subject to detail caps. It never silently materializes properties or reapplies complete settings. Opening reports requested versus displayed state: a failure can leave requested settings ahead of the displayed graph. View failures appear beside the graph controls with an explicit **Retry view**; only the current request can publish or clear that error, a later rebuild of the still-requested view retires it, validation messages are kept separately, and base partial-data/renderer warnings stay visible. A failed saved-view Open offers no Retry view: use **Open** again, which re-runs every check. Saved records show their full name above the definition and actions. Only a still-current successful result restores a saved camera, in Notes; Group overview stays Group overview. Bookmarks survive settings reload but do not snapshot appearance, layout, representation, selected-group scope or relationship declarations. No portable profile import/export, other starting-point recipes or native visual acceptance is implied. `data.json` remains settings-only.

Node glow and edges use coverage-preserving premultiplied source-over in both themes: each emitted color contribution carries alpha, so repeated overlap does not add light toward white. Dark-theme per-edge attenuation and its 0.5 ceiling are unchanged; these artistic controls are separate from the compositing correction. Canvas detail also respects ordinary/focused node color alpha. Camera moves ease over `visuals.cameraAnimationMs` and respect reduced motion. Cost guards are configurable in `visuals` (`glowMaxNodes`, `curvesMaxEdges`, `halosMaxGroups`, `hubsMaxGroups`); the software renderer turns glow, curves and halos off unless `softwareEffects` is set. **Group halos** (the faint per-group tint that fades in at mid zoom) are off by default for new installations and at a lower default opacity (`haloOpacity` 0.05, previously 0.08) because they mostly added noise; a saved `groupHalos: true` or saved opacity is kept. Turn them on with **Appearance → Group halos (faint tint behind groups at mid zoom)**. UI text never joins fragments with a middle dot; separate lines, labelled rows or plain sentences are used instead, and a unit test enforces this for `src/`. Active overrides appear beside their controls; expand them for the exact configured threshold/reason. Numeric appearance controls accept fine custom precision; live controls save automatically in existing plugin settings. Nodes require explicit Apply; closing an active preview restores saved rendering and retains drafts. Already submitted sizing/physics transactions are unaffected. Edge opacity zero draws no edges, including emphasis, on WebGL, Canvas detail and group Canvas. Positive alpha approaches zero without a hidden floor; graph relationships and computations are unchanged. The earlier zero-opacity repair preserved blending; the subsequent dense-overdraw correction replaces dark additive fragment output with coverage-preserving output, using the existing source-over blend function. Radius, degree, glow, halos, line width and additive overlap remain distinct contributors; this repair does not claim the bright-core problem solved.

Software renderers such as SwiftShader/llvmpipe, major performance caveats and missing WebGL2 retain the Canvas2D group screen and can open bounded Canvas detail through **View → Notes** within both `canvasMaxDetailNodes` and `canvasMaxDetailEdges` (2,000 visible nodes / 10,000 visible edges by default). These are refusal budgets, not truncation: the software renderer refuses an over-budget mask before changing any drawn state. When an ordinary search, filter or view change in Notes leaves more notes or relationships than either budget, the view is still applied (settings, counts and groups reflect it) but the display switches to **Group overview** with a notice that the notes are too many to draw individually on this renderer; narrow filters to see notes. A saved-view Open over budget is refused instead and the displayed graph stays unchanged. Renderer initialization failures return to groups with a notice; an unrestored context falls back to bounded Canvas detail or groups after `contextRestoreTimeoutMs`. Member/carrier lists remain usable; this is deliberately not a 60,000-node software-rendered graph. Lists are paginated. If Canvas2D itself is absent, the group buttons remain accessible.

**Graph information** shows tiles for nodes, edges, properties loaded and layout time, then an **Issues** list (partial graph, links pending, duplicate-ID notes excluded, unresolved links) with a one-line explanation each. When the projector supplies per-rule counts, a **Relationships by rule** table lists drawn, missing-target, duplicate-ID and excluded relationship notes per edge rule. The canvas summary shows separate short chips instead of dot-joined text.

## Expression filters, groups and colors

Open **Filter expression**, **Group expression**, or **Rule expression** in Explore. Type a bounded Bases-aligned expression, inspect its positional error or debounced worker count, then apply it. Autocomplete offers materialized property keys and receiver methods. For a property not yet materialized, preview reports the missing column; applying the expression materializes its references and rebuilds. The no-relayout native check covers filters on already materialized columns; newly added columns still participate in the existing declaration/cache identity.

```text
note.category == "Example"
file.inFolder("Notes/Example") && !file.hasProperty("archived")
note.status.lower().startsWith("open")
if(note.priority > 2, "high", "low")
note.entity_id.segment(":", 0)
```

`note.x`, bare `x`, and `note["my-key"]` read frontmatter. File facts are `path`, `name`, `basename`, `folder`, and `ext`; node facts are `identity` and `degree`. Equality preserves exact scalar types. Missing properties differ from explicit null; only segment/prefix normalize null to missing, preserving existing group labels. Results never write back to notes.

The optional `.segment()`, `.prefix()`, `coalesce()`, and `node.*` names are graph-specific extensions, not portable Bases syntax. No regex, evaluation of JavaScript, lambdas, dates, formulas, edge contexts, clocks, random values, body search, or network access is exposed. See the [expression reference](docs/declaration-format.md#expressions-node-context).

Structured builders remain available and retain structured storage. **Edit as expression** is explicit and disabled if the printed entry exceeds text limits; large entries stay editable in the builder. Folder-depth grouping remains a built-in source. Old disabled regex groups remain visible and inactive. Expressions are settings text only, not new note properties or a second projection authority.

## Meaning is declared

The default declaration has no identity property, no ontology rules, no predefined colors, and no reified-note keys. It uses literal note paths as identities, top-level folders as groups, and the public Obsidian resolved-link producer. Its producer name is pinned to `obsidian-links@<apiVersion>`; this identifies the host link resolver, not a new Markdown parser. A declaration copied from another version must explicitly update that pin.

See [`examples/default-declaration.json`](examples/default-declaration.json), [`examples/default-settings.json`](examples/default-settings.json), and [`examples/concept-mapping-declaration.json`](examples/concept-mapping-declaration.json). The concept/mapping declaration is **only an example**, not a special adapter or a core assumption. One possible use is a generic concept/reference mapping vault. Its synthetic concepts have `id` and `category`; mapping notes have `subject_id`, `object_id`, and `predicate`.

Declaration v2 supports (v1 input migrates automatically):

- `identity`: ordered frontmatter keys. The first present scalar value becomes the ID; otherwise the exact path is used. Conflicting identity owners, including identity/path-alias collisions, are all quarantined from projection. The status and a paginated conflict list show affected note paths/IDs; unrelated nodes/edges remain usable. Duplicate exact input paths still fail rather than silently selecting a row.
- `edges`: explicitly named `reified`, `inline`, or `producer` sources. Reified edges resolve two declared properties to identities and retain their carrier note; optional `typeProperty`/`type` supply the relation type. Inline values are literal IDs, not guessed wiki-link/ontology syntax. Producer maps must match the exact declared producer name and contain existing note paths.
- `display.reifiedAsNodes`: false means concept → concept with the relationship note as carrier. True means concept → relationship-note → concept. The **Relationship notes: Lines | Nodes** control in Appearance flips this field through the normal apply path. Multiple edges and self-links survive. Unresolved endpoints are dropped and counted.
- `groups`: property-key or folder-depth sources. `groupLevel` selects one source; these are selectable groupings, not an inferred ontology hierarchy. Missing values form an explicit group. No group declarations means “All notes.”
- `columns`: dictionary-coded property columns available to filters. Group/color keys are also materialized.
- `colors`: ordered named color predicates; the first match wins. Group colors use an explicitly matching color name when present.
- `carrierResolvers`: explicit kind → property-key bindings for producer carrier IDs. `$path` means an exact existing local note path; no naming heuristic is used. Ambiguous or absent matches stay disabled.

The toolbar accepts one exact predicate, or empty input to clear it:

```json
{"kind":"eq","key":"category","value":"Category 1"}
```

```json
{"kind":"folder","prefix":"Concepts/Category-1"}
```

Equality preserves scalar types: `1`, `"1"`, `true`, null and missing differ. Folder matching includes descendants at path boundaries, not lookalike prefixes. No regex or body search is implemented; the expression subset above is not an Obsidian search translator.

## graph-projection v0 (draft)

Set tuning `projectionFile` to a vault-relative JSON path, for example `graph-projection.json`. This is a neutral **aggregate-only producer seam** using the same group renderer, not a server connection. See [`examples/graph-projection-v0.json`](examples/graph-projection-v0.json).

```json
{
  "schema": "graph-projection-v0",
  "producer": {"name":"synthetic","projection":"example","asOf":"2026-11-10"},
  "groups": [
    {"id":"a","label":"Category 1","count":1,"identityPrefix":"concept:alpha:"},
    {"id":"b","label":"Category 2","count":1,"identityPrefix":"concept:beta:"}
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

Optional tuning `maxProjectionGroups`, `maxProjectionPairs`, and `maxProjectionCarriers` defines an explicit aggregate envelope. Defaults are 20,000 groups / 200,000 pairs / 1,000,000 carrier IDs. Upgrades without `settingsVersion: 2` replace legacy unlimited zero with these finite defaults once and record version 2; later explicit zero opts into unlimited counts. Violations reject visibly rather than dropping data. Carrier limits count IDs across all pairs. `maxProjectionBytes` defaults to 64 MiB and bounds the file before worker parsing; count limits are not streaming memory quotas.

## Architecture and incremental behavior

`src/core/` is pure TypeScript with no Obsidian imports or DOM access. It interns IDs into dense indices, stores source/target/type/carrier edges in u32 columns, and builds bidirectional CSR adjacency. Properties/groups are dictionary-coded; folder ranges support exact prefix filtering. Adjacency contains both directions, while edge columns retain direction and multiedges. Group contraction retains counts, directional type totals, members and contribution records.

`src/adapter/` uses public `vault` and `metadataCache` APIs, plus an optional public read-only property source. It consumes frontmatter and the host’s resolved-link map; it does not parse note bodies. Create/change/modify/resolve/delete/rename events coalesce for configurable `debounceMs` (five seconds by default). Each pending path is read at most once per emitted batch. Folder events traverse only that folder’s descendants; changed link sources outside it arrive through public per-file resolve events. Repeated global resolver completion alone does not establish metadata readiness; all Markdown files need non-null public cache entries. Cached indexed/listed counters avoid coverage rescans. One metadata-complete startup reconciliation remains necessary; CSR and group projection still rebuild per batch.

When the host exposes `openclast.propertyFacts`, initial grouping also consumes current standard-YAML frontmatter through `get(vaultRelativePath)`, enumerating only public vault paths. No note bodies are read, no private metadata is seeded, and no second property cache is created. Current but byte-unverified facts can paint provisional groups; parse errors/truncated facts use already-available native metadata, otherwise remain incomplete. Empty/missing frontmatter on an otherwise current row is valid. The saved declaration and all configured native producers remain unchanged: facts do not provide native resolved links. Status distinguishes properties available from links pending; verified/exact-cache eligibility needs complete verified properties **and** actual declared-producer readiness. Feature absence retains standalone native behavior.

Opening a view requests the optional aggregate `load()` without waiting for body hydration; `oc:property-facts-changed` refreshes successful loads, verification, expiry/drop and replacement/disposal. Pure verification keeps the current ingestion, groups and interactions: one fixed-window audit uses `debounceMs`, never extends its deadline on another event, cooperatively checks property coverage, and promotes verified status without reprojecting. At most one audit runs; events during it request one later window. Actual invalidation still cancels immediately. Async encoding and queued layout persistence both recheck source/view ownership. The host owns expiry and provider lifetime. Graph NG removes only its listener, captures source identity/refresh revision and rejects late work. Existing filters/group controls continue to use the same worker projection, not a new engine. This integration is locally deterministic-test-backed only, not connected-workspace/native/mobile acceptance.

Seeded ForceAtlas2 runs directly on typed-array edge/CSR columns in the plugin-lifetime Blob Web Worker, with an original flat Barnes–Hut tree and no runtime dependencies. The worker also owns projection, CSR, group contraction, digests and binary layout encoding. The integrator preserves history across bounded iteration tasks and streamed snapshots. Its `graph-ng-fa2@1` producer invalidates old solver keys without changing binary cache format 3. See [ADR-0006](docs/decisions/ADR-0006-csr-layout.md). A shared SHA-256 key authority includes the declaration, layout settings, layout producer, exact paths, declared property inputs, and sorted links from explicitly selected producers. Undeclared metadata/producer changes and resolved-link enumeration order do not reseed layout. Initial positions use an LCG derived from that key. The same runtime/input/settings are deterministic; bitwise identity across JavaScript engines is not promised. Persisted positions are validated and indexed by declaration/exact generation key. Only one declaration generation is retained by default. Positions are separate local binary cache data, not settings JSON or frontmatter. Input properties are never persisted by the plugin.

Exact-key hits restore positions without layout. Key misses can warm-start from a persisted generation after a complete process restart when declaration/layout/producer/source-view/format match and saved identities are all in the live view; stored topology keys identify changed endpoints. Existing positions survive by declared identity, new nodes start at existing-neighbor barycenters when possible, and new/changed edge endpoints plus one-hop neighbors relax. Untouched nodes stay fixed. Attribute-only edits and deletions do not globally relayout. Partial metadata and unresolved producer-link startup states cannot overwrite the last complete cache. The detail renderer uses a packed CPU uniform grid over the transferred coordinates for picking, with incident-edge CSR for nearby edge hover; it performs no GPU readback.

Group view builds its label map once, then renders bounded replacement pages instead of accumulating every button. Canvas pages default to six groups and only their mutual pairs; complete group/pair/member/carrier lists have independent `listPageSize` pages. A short container uses a grid, otherwise a ring. Long labels truncate with full hover/list text; count labels use collision checks and a final paint pass. This is a readable paged overview, not simultaneous rendering of every group.

`src/renderer.ts` retains the small renderer interface and Canvas group view; `src/webgl-renderer.ts` draws typed columns directly with instanced WebGL2 nodes/edges and an RG32F position texture. There is no main-thread Graphology object graph or Sigma dependency. The complete plugin has zero runtime dependencies; Graphology 0.26.0 and graphology-layout-forceatlas2 0.10.1 are development-only differential oracles and never bundled. The independent headless JSON builder uses the same core: `./scripts/run.sh project examples/facts.json examples/concept-mapping-declaration.json .workspace/example-projection.json`. Its `graph-ng.local-projection.v1` envelope includes columns/CSR/positions and aggregate groups; it is **not** the aggregate-only draft input and must not be set directly as `projectionFile`.

## Defaults and tuning

The generated [`examples/default-settings.json`](examples/default-settings.json) is the full editable settings shape. No hidden graph-size cutoff silently discards nodes.

| Setting | Default |
| --- | --- |
| Event debounce / worker processing deadline / lifetime restarts | 5,000 / 120,000 ms / 2 |
| Full / incremental FA2 iterations | 100 / 30 |
| Layout seed / initial radius | 1 / 100; host derives effective seed from generation hash |
| Barnes–Hut / theta / maximum tree depth | true / 1.2 / 32 |
| Layout worker-task iteration budget / stream cadence | 5 / 5 iterations |
| Convergence RMS threshold / consecutive quiet iterations | 0 (disabled) / 3 |
| Layout node radius / size-adjusted force limit | 1 / 10 |
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
| Canvas detail visible-node / visible-edge limits | 2,000 / 10,000 |
| Maximum labels / candidate-budget multiplier | 400 / 32 |
| On-demand paint backstop / shader completion polling | 32 / 8 ms |
| Context restoration deadline | 5,000 ms |
| Camera minimum / maximum ratio | 0.02 / 8 |
| Aggregate groups / pairs / carrier IDs limit | 20,000 / 200,000 / 1,000,000; explicit 0 means unlimited |
| Ingest chunk / main-task budget / stream iterations | 2,000 rows / 8 ms / 5 |
| Cache chunk / generation budget | 1 MiB / 256 MiB |
| Failed/quarantined cache artifacts / retained bytes | 8 / 256 MiB |
| External JSON / settings byte budget | 64 MiB / 16 MiB |
| Background / node / edge / group / text | `#141b26` / `#7fc8e7` / `#43566e` / `#7fc8e7` / `#edf4ff` |
| Persist layout / cached declarations / producer file | true / 1 / empty |

`cache.directory` is empty for the default plugin-owned `cache/` directory, or a `cache/<subdirectory>` path relative to this plugin's directory; arbitrary vault paths are refused. Failed partial writes and derived `.corrupt-*` artifacts are pruned within configurable count/byte caps; these are disposable cache-only bytes, not source/settings backups. Invalid `data.json` is copied to a timestamped quarantine before defaults can be saved, with a notice. Worker processing deadlines start on processing acknowledgement, not while requests queue; a separate equal-duration dispatch watchdog detects a worker that never starts. Timeout/error recovery restarts at most `workerRestarts` times per plugin lifetime, rejects old RPCs and rebuilds from public metadata instead of replaying detached buffers. Cancelled ingestion invalidates coverage and forces a full reload; dirty paths remain pending until acknowledged.

Detail labels use a bounded glyph atlas and degree-prioritized, grid-collided placement precomputed at seven zoom levels. Candidate labels are capped at `labelCandidateMultiplier` times the viewport-derived budget (32 by default) and strings at 128 UTF-16 units; a font/resize rebuild may allocate, ordinary camera draws do not. Canvas fallback refuses views exceeding either visible-node or visible-edge budget, with larger graphs retaining group/member navigation. The planned 20,000-node fallback is not a tested software-GPU capacity: current native evidence reaches 600 nodes / 1,400 edges. The conservative 2,000/10,000 refusal envelope is configurable, but its boundary performance is unmeasured; neither that cap nor this evidence promises software animation FPS.

Theme variables are `--graph-ng-bg`, `--graph-ng-node`, `--graph-ng-edge`, `--graph-ng-group`, `--graph-ng-text`, `--graph-ng-accent` and `--graph-ng-font`, falling back to host graph/background/font variables and validated settings defaults. Declaration colors accept `#rrggbb`, `#rrggbbaa` or `var(--name)`. Palette-only CSS changes upload the indexed RGBA8 palette and redraw without worker calls, relayout or graph-buffer reconstruction. A font change rebuilds the label atlas. WebGL context restoration reuploads retained CPU buffers; permanently lost contexts disable hit interaction and switch to bounded Canvas detail or groups at the configurable deadline. Disposal explicitly releases the WebGL context. On-demand painting and asynchronous shader completion use `frameBackstopMs`/`shaderPollMs`; camera ratios clamp to `cameraMinRatio`/`cameraMaxRatio`.

All listed values are validated settings. The slice uses 100 full iterations, not the design sketch’s proposed 300. The worker deadline is an explicit configurable limit; it is not a file-count limit. No fixed file/node cap is enforced. Large graphs still consume memory and can exceed the deadline.

## Development and exact commands

Bun, Node.js, `flock`, and the host’s `build-contained` wrapper are prerequisites for these commands. `scripts/run.sh` changes to this repository and serializes each Bun command inside that containment wrapper. In an environment without the wrapper, provide an equivalent build-contained setup rather than silently bypassing it. The test launcher uses synthetic copies only; it downloads Obsidian binaries into ignored cache storage.

| Task | Command |
| --- | --- |
| Dependencies | `./scripts/run.sh install --frozen-lockfile` |
| Full deterministic gates | `./scripts/run.sh gates` |
| Install opt-in pre-commit hook | `./scripts/install-hooks.sh` |
| Local checksummed release | `./scripts/run.sh release:local` |
| Repeat-build comparison | `./scripts/verify-release.sh` |
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

Installations explicitly disable lifecycle scripts. Configure local private terms before full gates; the fast hook is opt-in. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [AGENTS.md](AGENTS.md), [changelog](CHANGELOG.md), [declaration v2](docs/declaration-format.md), [projection v0 draft](docs/projection-format.md), [benchmark methodology](docs/benchmarks.md), [decisions](docs/decisions/README.md), [local releasing](docs/releasing.md), and the [pre-publish checklist](docs/publish-checklist.md). This remains a local repository; no release URL or public install path is configured.

## Current renderer evidence

Version 0.3.1 colors literal-display edge notes by their endpoints, draws them beneath the other notes and folds them into their edges when zoomed out, so the clustered 60,600-node literal web shows its group colors instead of a grey mass. Native small and large lanes and the browser bench (3/3, both modes, 60.0 fps) pass; after review fixes the large hardware lane passed 7/7 twice with no ≥50 ms open or detail tasks. See [slice-7 evidence](docs/benchmarks.md#slice-7-literal-edge-note-visuals).

Version 0.3.0 adds the Explore panel and visual effects. Native lanes pass: small graph 11/11 and explore 6/6 on hardware and software; the large literal web of 60,600 nodes passes graph 7/7 and explore 6/6 on hardware. Large first groups take **307.9/354.2 ms** (hardware/software). No ≥50 ms task was recorded around detail open, hover, filter, collapse or regroup in the final runs, and the browser main heap is **11.06/11.03 MiB**. The browser benchmark completes in both modes (3/3 sequential runs, 60.0 fps). An earlier hang was caused by the Bun runtime's Playwright pipe connection failing on a second browser launch in one process, not by graph-ng. The bench now runs each mode in its own process. See [slice-6 evidence and misses](docs/benchmarks.md#slice-6-explore-controls-and-visual-effects).

Version 0.2.1 profiles real native startup, accelerates row dictionaries, probes GPU capabilities in a public worker OffscreenCanvas, uses 1×1 CPU-backed palette conversion, waits for shader/GPU completion with nonblocking WebGL2 fences before GPU buffer resizing, cooperatively indexes external carrier notes, and transfers packed render-only columns instead of a second full projection. Native large first groups measure **320.0/350.1 ms** hardware/software, versus the same-profile baseline **535.3/589.5 ms**. Browser retained main JS heap measures **10.97/10.94 MiB** semantic/literal. End-to-end task targets **currently fail** in recorded repetitions: 62–70 ms detail tasks remain, some unattributed; isolated task-free runs are not blanket closure. Cold first paint and later metadata-refresh paint now have separate timings. Browser heap includes the same retained host metadata; ArrayBuffer backing storage is reported separately. See [ADR-0007](docs/decisions/ADR-0007-native-startup-render-columns.md) and [slice-5 evidence and remaining gaps](docs/benchmarks.md#slice-5-native-startup-and-retained-render-columns).

Slice 3 removes Sigma, preserves the existing worker layout, and restores contribution selections after a metadata-generation change instead of silently losing the panel. Loading/refreshing/errors and explicit Retry are visible. Stable raw group keys, not display labels or reused numeric IDs, reconnect a selected pair to a new dictionary. Source/group-definition changes clear that intent. See [ADR-0005](docs/decisions/ADR-0005-direct-renderer.md) and the [slice-3 evidence](docs/benchmarks.md#slice-3-direct-renderer).

## Historical slice-2 measured startup — 2026-11-10

At 60,600 synthetic notes (semantic/literal), final browser cold groups took **415/458 ms** and full verified binary warm + first Sigma frame **799/970 ms**: the ≤500 ms / ≤1 s targets were met in one repetition per mode. No ≥50 ms task was observed in the default group-open window. **Explicit detail and warm Sigma initialization still produced 244–360 ms long tasks: this remains a miss pending the slice-3 renderer**, not all-interaction acceptance. Retained main heaps were 33.16/72.41 MiB; the retained host fixture and changed timing origin prevent a like-for-like baseline memory/load comparison. Warm uses a new worker and memory-backed binary disk, not physical storage or an app restart. A post-review rerun confirmed **391/460 ms** cold groups / **807/961 ms** full warm, with 247–318 ms detail/warm tasks and 33.17/75.37 MiB retained main heaps. The final narrow member/detail-generation guard then passed build and **65 tests / 401 assertions**; native 9/9 hardware + 9/9 software and browser metrics were captured immediately before that guard, not rerun after it. Exact methods, native results and remaining lanes are in [the benchmark record](docs/benchmarks.md#slice-2-worker-pipeline--2026-11-10).

## Historical slice-1 evidence — 2026-11-10

These unchanged historical tables do not describe current renderer acceptance. Current worker-pipeline results and uncovered targets are in [the benchmark record](docs/benchmarks.md#slice-2-worker-pipeline--2026-11-10).

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

The restart tests also retain the startup-race regression: initial metadata-incomplete rows cannot replace a complete saved generation. The streaming adapter reads declared keys in bounded batches and stays dirty-path/event-driven afterward. Completeness counts public non-null cache entries; repeated resolved events alone do not establish readiness. The headless example command above passed with two nodes/one edge. Final `node scripts/check-licenses.mjs` (six MIT runtime packages) and `bun run build` passed. Private final combined log: `.workspace/final-review-gates.log`; native receipts: `.workspace/evidence/e2e-small-{hardware,software}.json`.

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

Native WebDriver requestAnimationFrame sampling produced **zero callbacks**, so native FPS is **unavailable**, not zero FPS and not accepted. The full literal native lane remains uncovered. In the historical slice-1 implementation, main-thread projection/JSON/render-buffer load tasks exceeded the design’s ≤50 ms target and only layout was off-thread. Slice 2 moves projection/hash/serialization off-thread; Sigma detail setup remains synchronous. Desktop midrange-GPU browser smoothness does not establish startup responsiveness, mobile support, integrated-GPU acceptance, 1M-node rendering, or server grant-safety.

## Licensing and boundaries

MIT, copyright 2026 **cybersader**. No third-party plugin implementation was copied. The shipped plugin has **zero runtime packages**. Graphology and graphology-layout-forceatlas2 are pinned development-only oracles, not bundled. `scripts/check-licenses.mjs` refuses runtime dependencies and generates an empty `THIRD_PARTY_NOTICES.txt`; the build rejects bundled `node_modules` inputs. Both main and embedded worker are minified. The enforced bundle ceilings are **310,000 minified / 100,000 gzip bytes**, authorized on 2026-11-13 and raised on 2026-11-14 and 2026-11-15 for this bounded UI pass (previously 265,000 / 85,000, then 245,000 / 78,000, then 240,000 / 76,000; before that 227,000 / 72,000 for the controls preview). This bounded download allowance does not waive correctness, independent review, deployment or runtime-performance gates. Version 0.4.0 is **202,475 minified / 64,312 gzip bytes** and passes (0.3.1 was 173,448 / 54,838) (0.2.1 was 115,970 / 35,830). See [slice-7 measurements](docs/benchmarks.md). Cosmos remains deliberately excluded; its CC-BY-NC-4.0 license is not permissive.

**Separate development/test-toolchain exception:** `wdio-obsidian-service` uses `7z-wasm` (LGPL with the unRAR restriction) to extract downloaded test applications. It is not imported by the plugin, bundled, or shipped in the runtime artifact. This is an explicitly scoped e2e toolchain exception, **not** a claim that every development transitive dependency is permissively licensed. Obsidian itself is downloaded at test runtime into ignored storage and is never committed.

## Slice 2 pipeline and cache contract

The group view streams before detail/layout. Declared columns and producer-link CSR are transferred as ArrayBuffers; contributions are requested a page at a time. The main realm yields at configurable 2,000-row / 8 ms budgets. Detail consumes transferred typed columns directly. Shader completion uses `KHR_parallel_shader_compile` when available, polling with bounded timer yields; drivers without that extension may still block on link status. On-demand painting uses rAF with a single 32 ms timer backstop for embedded windows that withhold rAF, not a perpetual animation loop.

`data.json` contains settings only. Default derived storage is `cache/local/` under the plugin folder; `cache.directory`, `cache.chunkBytes` (at most 1 MiB), `cache.maxGenerationBytes` and `cachedDeclarations` control it. Position Float32, identity dictionaries/offsets, hash-pair topology and group summaries are checksummed/chunked; manifests commit completed generations, matching chunks can resume, bad data quarantines automatically, and the LRU records kept/removed actions. Plain Obsidian uses source identity `local`; a future host can supply an opaque member/view identity through `setSourceIdentity()`. Changing it clears the old display and discards the old namespace. No remote adapter or grant enforcement is claimed.

A compatible cached group summary paints first with **cached · verifying N of M**. Filters/member lists remain provisional until every Markdown note has a non-null public `metadataCache` entry, then the worker confirms or rebuilds the generation. Partial indexing cannot overwrite a complete saved generation. Old v1 positions migrate once as hints, never as verified input. No frontmatter scanner, private host cache access or plugin-owned property database is added.

Finite defaults are 64 MiB external aggregate JSON, 20,000 groups, 200,000 pairs and 1,000,000 carrier references. Explicit count zero still opts into unlimited counts; byte budgets remain finite. External files always say **unverified external aggregate** and never merge with live rows. In-app export is not implemented. Headless projection output is labelled **your view**, accepts only a caller-scoped fact export and requires an explicit destination.

Declaration v2 renames reified property fields and accepts path-segment folder prefixes. Saves emit v2/segments, with bounded input migration from v1. See [declaration format](docs/declaration-format.md), [ADR-0004](docs/decisions/ADR-0004-worker-generations.md) and [benchmark methodology](docs/benchmarks.md). The [current measurements](docs/benchmarks.md#slice-5-native-startup-and-retained-render-columns) distinguish group-open, explicit detail-open and binary warm-open costs; historical slice-1 tables are not current acceptance. GPU probing waits for explicit detail interaction and runs in a public worker OffscreenCanvas when available; opening the group view does not initialize WebGL. Platforms without that API retain the existing main-canvas fallback.

## Not implemented / not proven

- No server adapter, remote grant enforcement, tiles, streaming/resumable graph transport, REST/MCP routes, hosted deployment, or server privacy review.
- No Leiden/community inference, tag-prefix grouping, automatic hierarchy discovery, general regular expressions, or ontology parser. Expressions provide boolean OR/NOT; formulas, dates and edge contexts remain deferred.
- No mobile real-device evidence, integrated-GPU proof, native FPS result, isolated plugin memory, or GPU-memory measurement. Canvas detail is bounded; software support is not unlimited-scale acceptance. The over-budget fallback to Group overview is deterministically tested, not natively accepted.
- Projection, contraction, canonical hashing, topology hints and binary serialization run in a long-lived worker. The CSR-native layout and flat Barnes–Hut tree have no runtime dependency; the final bundle-size targets are enforced. Multilevel coarsening above 250,000 nodes is deferred and that scale is unmeasured. Driver variance, shader compilers without the parallel extension, first-open tasks and dense-label contrast remain measured limitations, not hidden by steady-state FPS.
- Group Canvas2D uses paged ring/grid layouts, not tens of thousands of simultaneous labels. Collision suppression can omit a count label; the complete values remain in hover/relationship lists. It is not a general all-scale label-layout solution.
- Incremental rows do not imply incremental CSR mutation. A declaration/layout change rebuilds; cache persistence uses separate, disposable binary generations in chunks of at most 1 MiB; settings JSON contains no derived graph arrays. Exact-key generations reuse positions directly; compatible key misses warm-start by identity. Old cache entries without topology retain existing positions conservatively.
- The local producer file is reloaded when its existing file is modified. Missing files produce a visible error; there is no background network fetch/retry service.

Expression count/filter evaluation cancels superseded work cooperatively, with a budget derived from the configurable worker timeout. Aborted applied views retain prior worker state. See [format](docs/declaration-format.md) and [benchmarks](docs/benchmarks.md) for exact batching and uncovered synchronous paths.

### Explicit Apply completion and failure recovery

The existing renderer remains active during CPU-only preparation. No temporary host, suspended renderer, hidden mode change or second canvas/context is used.

Apply awaits its candidate settings write through the existing persistence queue before synchronous coordinate upload and settings adoption. Ordinary/coalesced saves snapshot settings at execution. Ownership includes projection, layout, renderer, positions, scope, masks, viewport, labels and theme. Failed writes compensate from latest live settings; GPU/context or disk recovery failures report uncertainty rather than promising usable graphics or restored disk state.

### Same-context coordinate transaction

Apply prepares CPU coordinate-derived spatial grids, collapsed geometry, discs and label collision placement without constructing another renderer or context. Camera-frame bounds remain independent of the replaced spatial grids; camera, scope, masks, topology and explicit Fit remain separate. Awaited persistence precedes synchronous upload and adoption. Position and atlas textures reuse storage; existing label buffers/VAOs are reused, although buffer resizing can have driver-dependent transient costs. The software path retains its original full geometry limits, not artificial two-renderer half-caps.

Preparation retains old and next coordinate-derived arrays and temporarily old/new label atlases. Nominal atlas backing is approximately 16 MiB each; this is an allocation component, not total browser/GPU peak proof. Context loss or failed GPU rollback retains last-good CPU data for existing recovery and reports uncertainty; failed disk compensation also reports uncertainty. No native latency, memory/driver, mobile, visual or density-cure acceptance is claimed. This unshipped candidate still requires independent review and all unchanged download gates.

### Dense-overdraw correction (unreleased)

The prior dark-theme edge and outer-glow fragments emitted positive RGB with zero alpha. Under `ONE / ONE_MINUS_SRC_ALPHA`, arbitrarily many local overlaps could add to white even with small global opacity. The correction keeps the same requested opacity, density/zoom attenuation, glow profile, geometry and draw passes, but writes the corresponding coverage alpha. Ordinary opaque node cores are unchanged; no nodes, edges, carriers, provenance or type/direction records are dropped. Canvas uses explicit source-over and the same declared ordinary/focus color alpha instead of forcing ordinary nodes opaque.

Deterministic tests evaluate actual pre/post shader scalar expressions and production Canvas draw calls. They are not GPU rasterization, native screenshots, FPS or all-scale readability evidence. Overlap can still obscure structure; this change does not infer hierarchy, qualify mapping endpoints or guarantee an organic layout. Topological graduated highlighting is described below; any later semantic tier must retain coverage-preserving output and the existing zero-edge rule unless a separate explicit mode is introduced. Independent review and permitted visual acceptance remain required.

**Adapt to zoom** (`visuals.zoomAdapt`, Appearance, on by default) targets the dense-haze case. Edge pixel coverage grows with visible edges, with zoom-out (camera ratio over home ratio: the drawn footprint shrinks faster than edge length) and with a smaller pane (reference 1280×800). Once that exceeds `edgeDensityReference`, edge opacity and width are multiplied by 1/√crowding, never below 0.35, so clusters and hubs show through instead of a uniform wash. Zooming in restores them. The factor is one per-frame scalar passed as a uniform, with no per-edge CPU work. Blending stays coverage-preserving, so edges cannot add up to white. When the view is zoomed out past home and node marks would touch, degree prominence is scaled by zoom^-½ in half-steps of log₂ zoom (at least ¼), so hubs stop covering their neighbours. Cached sizes are recomputed (O(n)) only when that step changes; there is no solver restart. Drawing, picking and label offsets read the same sizes on WebGL and Canvas, and legacy sizing now picks at the drawn radius. Every note and edge stays drawn and pickable; turn the option off for the previous appearance. Native visual acceptance is pending.

### Connection lens (unreleased)

Select or hover a note and press **L**, or select a note and use **Appearance → Connection lens**. Its **direct connections** move into rings around the fixed focus, ordered by relationship type and then name. **L** or **Escape** closes the lens and returns them; **neighbours of neighbours** and **context** stay in place. The lens pins its focus, so hovering a pulled note does not scatter the ring.

The rings keep screen-space spacing as you zoom and use more rings for large degrees. Edges and picking follow the moving notes on WebGL and Canvas2D; reduced motion swaps positions immediately. This is temporary view state: it never changes physics, saved layout positions or named views. The existing graduated-highlight switch still controls dimming. Labels retain their existing viewport budget, and very large rings may need panning; this is not a guarantee that hundreds of names fit on one screen. Native visual/performance acceptance remains pending.

The connection card has a **Lens** button that shows whether the lens is on. **Focus** frames the currently drawn coordinates, including lens displacement; very large screen-space rings still need panning. History drops notes removed by the host filter and survives re-centring **Only connections**. **Open** reuses only an unpinned note leaf (or creates a tab), then reveals it. With the lens open, moving to another note from the card moves the lens too. Rings, minimum sizes, edge-of-view arrows, row leader lines and focus labels all follow the moved notes. **Escape** closes the card first, then the lens.

### Graduated connection highlighting (unreleased)

Also called *graduated relationship highlighting*. Terms used in this section and the code:

| Term | Meaning here |
| --- | --- |
| Focus (the *ego*) | The hovered or selected note. |
| Direct neighbours (1-hop) | Notes one relationship away from the focus. |
| Neighbours of neighbours (2-hop) | Notes exactly two relationships away. Minimum hop count wins. |
| Ancestors | Optional. When the declaration binds `hierarchy.parentProperty`, the focus's parent, grandparent and so on (up to 8 levels, 256 notes, cycle-safe) form a softer tier between direct and 2-hop, even when farther than two hops. |
| Same group | Optional. With `groupContext: true` and a current grouping, other members of the focus's group form a faint tier just above context (at most 4,096 marked). |
| Tinted relationship layer | Optional. Edges of a reified rule with `highlight: "tint"` keep their tier's weight but mix in the accent color, so cross-framework mappings read as a separate layer without being hidden or demoted. |
| Context | Everything else. It fades but stays visible (*focus + context*). |
| Ego network / k-hop neighbourhood | Standard graph-visualization names for the focus plus everything within k hops; here k = 2. |
| Tier | One of the emphasis levels above, in precedence order: focus, direct, ancestor, 2-hop, same group, context. A note takes its highest tier. |
| Graduated labels | The same tiers applied to note names: largest bold label for the focus, full labels for direct neighbours, muted ones for ancestors, smaller muted ones for 2-hop, smallest faint ones for same group, context labels nearly hidden. |

Background on the standard terms: [Neighbourhood (graph theory)](https://en.wikipedia.org/wiki/Neighbourhood_(graph_theory)), and focus + context as in [Fisheye view](https://en.wikipedia.org/wiki/Fisheye_view). *Ego network* is the social-network-analysis name for a focus node plus its neighbourhood.

Hovering a note with a mouse or pen, or selecting one, shows a graded cloud instead of a flat one-hop flag. The tiers are progressive: the **focus** grows 60% and gains an outer ring, **direct** connections grow 25% at full opacity, **neighbours of neighbours** (2 hops) sit halfway between full and the dim opacity, and everything else fades to the existing dim opacity. Edges touching the focus are three times as opaque (capped) and 60% wider, 2-hop edges keep their ordinary appearance, and the rest fade to 60% of the dim opacity. Hover outranks the selection; leaving the graph falls back to the selected note. Without a selection, the last hover focus stays across empty canvas and entry into its overlay controls so **+N more**, the legend and off-screen arrows remain reachable; another node, an empty click, Escape or leaving the graph ends that focus. A mouse click selects the note as the persistent focus and shows its connection card (below); Ctrl/Cmd-click opens it directly; a click on empty canvas clears the selection. The existing **Graduated connections on hover or selection** switch (`visuals.hoverHighlight`) turns both off. Reach (2) and the fade ratios are fixed. The finding aids below are on by default and can each be turned off.

On **touch**, a tap selects instead of opening, because precise taps on dense graphs often hit the wrong note: it shows the same graded cloud and the connection card, whose explicit **Open** button is labelled "Open <name>" for assistive technology. A tap on empty canvas clears the selection and card; pan and pinch are unchanged. **Keyboard:** the note canvas is focusable. Arrow keys select the nearest note in that screen direction and show its card and connections, Enter opens the selected note, Tab reaches the card's Open button, and Escape (from the canvas or the card) clears the selection and returns focus to the canvas. A selection hidden by a filter loses its card and emphasis.

Tiers are topological, by minimum hop count. Only type-visible relationships between filter-visible notes are followed, so toggles, filters and scope gate the cloud. Collapsed members are filter-visible and are followed. An edge note (`reifiedAsNodes`) is transparent: reaching it continues through its own relationship rows at the same hop, so both ends of a direct mapping read as direct. Cycles, multiple parents, self-links and parallel edges resolve to the minimum hop and are touched once. Direction is kept but not interpreted. **Semantic tiers are declared, never inferred:** ancestor, same-group and tinted-layer emphasis appear only when the declaration binds them (`hierarchy`, `groupContext`, `highlight` in [declaration-format.md](docs/declaration-format.md#focus-emphasis-optional)); nothing is inferred from folders, IDs, names or layout, and absent fields keep the topological cloud exactly. Ancestors follow the declared parent property from the focus only (descendants are not a tier), pass through filter-hidden parents without lighting them, and light the child-parent relationship when one is drawn. A direct mapping stays direct: precedence is fixed as focus > direct > ancestor > 2-hop > same group > context. These fields are presentation: they never change layout identity or the layout cache.
**Relationships (lines).** In Notes, clicking or tapping a line selects that relationship; it never opens anything directly. Notes win over lines when both are under the pointer. The two endpoints and the line are lit as direct tiers (no focus ring), and the card shows **source → target**, then one row per drawn relationship between that pair (parallel lines draw on top of each other, so all of them are listed, up to 32; a row drawn the other way is marked "(reverse)"). Each row shows the relationship type, its edge rule as "Rule: <name>", and an **Open relationship note** button when that row has a relationship note (a reified edge's carrier note, for example a crosswalk-edge note). **Open source** and **Open target** open the endpoints. Rule names and note paths are read from the worker for the selected rows only, so a stale layout shows "Details unavailable" instead of guessing. With a note selected, **R** steps through its relationships one neighbour at a time (Shift+R backwards); Escape clears. Picking runs on click only and scans the incident lines of notes near the pointer under a fixed budget, never all edges; a long line whose endpoints are both far from the pointer may need a click nearer one end, and curved lines are hit-tested as straight segments. Hit targets for the focus note follow its 60% enlarged size.

Tiers are topological, by minimum hop count. Only type-visible relationships between filter-visible notes are followed, so toggles, filters and scope gate the cloud. Collapsed members are filter-visible and are followed. An edge note (`reifiedAsNodes`) is transparent: reaching it continues through its own relationship rows at the same hop, so both ends of a direct mapping read as direct. Cycles, multiple parents, self-links and parallel edges resolve to the minimum hop and are touched once. Direction is kept but not interpreted. **No ancestor, parent or framework tier is shown:** those need a declared structural relationship and direction, which declarations cannot express yet; nothing is inferred from folders, IDs, names or layout.

One pure helper beside the incident-edge index computes the tiers once per focus change, never per frame, and clears its previous bytes by touched lists. The same bytes drive WebGL (node state texture and a per-edge tier attribute) and Canvas (three batched edge strokes, graded node and label alpha), which also closes the earlier Canvas gap where emphasis dimmed all edges uniformly. Hop 1 is complete; hop 2 stops deterministically after 65,536 scanned incident entries and the hover label then says "2-hop context truncated"; ancestor relationship scans share that bound. The same-group scan reads at most 262,144 entries and marks at most 4,096 notes, then says "group context truncated". Emphasis multiplies alpha inside the existing coverage-preserving source-over blending, so overlap cannot add toward white. At edge opacity 0 edges stay hidden while nodes and labels still grade; there is no alpha floor. View, filter, type or scope changes recompute against the new masks; pointer leave, empty clicks and turning the switch off clear stale bytes; a GPU context restore re-uploads them.

**Graduated labels.** While a focus is active, its name is shown largest and bold beside it (with the truncation note when applicable); direct neighbours get full labels, declared ancestors muted labels, 2-hop neighbours smaller, muted labels and same-group members the smallest, faintest ones. Candidates are ranked focus > direct > ancestor > 2-hop > same group, then by degree of interest (below), capped like the ordinary labels, and placed under the same `labelsMaxPerViewport` budget (at most 64) with radial collision avoidance (below), so a 2-hop label never displaces a nearer one. Ordinary labels for tiered notes hand over to these, and context labels fade to half the dim opacity; when the focus clears, the ordinary labels return. Placement runs once per focus change or label level-of-detail change, never per frame; panning only translates the bounded text-only overlay, identical on WebGL and Canvas.

**Label sizing.** Labels follow one type scale around the label size setting:

| Tier | Size | Weight |
| --- | --- | --- |
| Focus | label size × scale² | bold |
| Direct connections | label size | semibold |
| Ancestors | label size | medium |
| Neighbours of neighbours | label size ÷ scale | regular |
| Same group, context | label size ÷ scale^1.5 | regular |

- **Label scale by tier** (Appearance, `visuals.labelTierScale`, 1 to 1.6, default 1.2) sets the ratio. 1 keeps one size.
- **Label plates** (Appearance, `visuals.labelPlates`, on by default) puts a pill tinted with the theme background behind focus labels so they read over dense edges. Neighbours of neighbours and same-group plates are lighter. Ordinary labels keep a thin background outline.
- **Radial layout.** A direct-connection label sits right of its dot when there is room. When it would overlap, it moves outward along the line from the focus, with a short leader line back to the dot. At most 24 direct connections are labelled. Transparent relationship-note dots do not consume those slots or inflate their count. The rest fold into one **+N more** button beside the focus. The button calls the renderer's `onMoreConnections(focus)` hook (a no-op until a host wires it).
- **Long names** are shortened in the middle ("Access Con…Procedures"). The full name is on the label's tooltip and accessible name, and on the hover label.
- **No focus.** Ordinary labels grow with connection count, so hubs are named first and largest (the top hub matches the focus size). More appear as you zoom in. The label level changes only once the zoom is clearly past a boundary, so labels do not flicker when you stop near one. Canvas now applies the same zoom fade, importance cut and hub sizes as WebGL.

Placement is cached per focus and label level, so hover frames only move the bounded overlay.

**Which connections win (interest ranking).** When a hub has hundreds of connections, label slots, the **+N more** order, the card's rows within each relationship group and the lens rings within each type are ranked by *degree of interest*, not alphabetically or by size:

- Rarer notes beat hubs.
- Notes you visited recently in the card rank higher.
- **Bridges first** (Appearance → Finding connections, `visuals.bridgesFirst`, on): connections in a different group from the focus rank higher. In a crosswalk, cross-framework mappings rise without naming any framework.
- An optional declared number (`interest.property`, see [declaration-format.md](docs/declaration-format.md#interest-ranking-optional)) adds a bonus.

Tiers keep their order; ties fall to the name, then a fixed id, so the order is stable. Scores are computed once per focus change, over direct connections only.

**Finding connections.** Tinting alone leaves direct connections as tiny dots at overview zoom, so a focus also makes them findable. Each aid has a switch under **Appearance → Finding connections**:

| Aid | What you see | Setting |
| --- | --- | --- |
| Minimum highlighted size | Direct connections never draw smaller than 7 px radius at any zoom; ancestors about 5 px, neighbours of neighbours about 4 px. It eases in with the focus and blends smoothly into the normal size, and the click target grows with it. Edge notes are exempt. | `tierMinSize` (0–16 px, 0 turns it off) |
| Rings | A crisp ring in the theme's text colour around each direct connection and a double ring around the focus, so they read on light and dark themes. | `tierRings` |
| Strong focus lines | Lines touching the focus become near-opaque and wider, and fade from 35% at the source end to full at the target end, so you can see which way each relationship points. Lines between neighbours of neighbours halve; the rest are nearly hidden. Edge opacity 0 still hides all lines. | `focusEdges` |
| Off-screen arrows | Direct connections outside the view collect into at most eight round arrows on the view's edge, one per direction, each with a count. Click or press Enter on one to centre its nearest connection without changing zoom. | `offscreenPips` |
| Legend | While a focus is active, a small legend at the top left lists **Direct connections**, **Ancestors**, **Neighbours of neighbours** and **Same group** with live counts (only tiers present are shown). Each row is a toggle button: switching a tier off draws its notes and lines as context. The switches last for the open graph. | `tierLegend` |
| Ripple | Selecting a note sends one ring outward from it to its farthest direct connection in 250 ms. It never plays with reduced motion. | `focusRipple` |

All of these are computed once per focus change (counts, the direct-connection list) or are O(direct connections) per frame (arrow placement); nothing scans every note per frame. WebGL and Canvas draw the same sizes, rings and line weights from shared helpers that tests compare against the shader expressions. The legend and arrows are text-only buttons at least 32 px tall. Known gaps: switching a tier off in the legend does not change graduated labels; Canvas does not draw the existing direction fade on ordinary lines; native visual acceptance on a large vault is pending.

The tier styling lives in shared helpers that drive Canvas; the shaders write the same expressions, and tests compare them term for term. The ring is extra coverage outside the node disc in the same blending, so it cannot add toward white either.

Evidence is deterministic: helper tiers, label ranking/budget/collision, shader scalar expressions and compiled-renderer Canvas/GL-call fixtures (`tests/graduated-focus.test.ts`, `tests/physics-transaction.test.ts`). It is not GPU raster, native visual distinguishability, dense-graph frame time or screen-reader evidence; those remain for native acceptance.

### Connection card (unreleased)

Highlighting shows where the connections are; the connection card makes them findable and actionable. Click (or tap, or arrow-key select) a note in Notes and a card opens beside it. It stays on screen, and on narrow views it becomes a bottom sheet.

- **Header:** the note name, a chip with its **direct connections** count and one with its **neighbours of neighbours** count ("+" when the 2-hop scan was cut short).
- **Actions:** **Open** (reuses an open note tab), **New tab**, **Right** (split), **Focus** (fly to fit the focus and its direct connections), **Only connections** and **Copy link** (a `[[wikilink]]`).
- **Connections list:** direct connections grouped by relationship type and direction (→ outgoing, ← incoming) with counts, ranked by interest (above). Each row shows the note's colour swatch and name. Hover or focus a row and a ring and a leader line point at that note; click it to travel there (it becomes the focus and selection, and the camera flies to it). The first 50 rows show, then **Show all**.
- **History:** ‹ and › go back and forward through visited notes, with the last few as a breadcrumb.
- **Only connections:** a temporary view of the focus and its direct connections. A bar at the top adds **Neighbours of neighbours** or goes **Back to full graph**. Travel re-centres it; filters still apply underneath.
- **Keys:** Esc closes the card (a second Esc leaves Only connections), arrows or Tab move through rows, Enter travels, Alt+Left goes back and Alt+Right forward.
- **Lines:** a selected relationship adds **Go to source** and **Go to target**, and **Right** for its relationship note.

**Click opens notes directly (skip the connection card)** (`visuals.clickOpens`, Appearance, off by default) restores click-to-open. Lookups use the incident-edge index and cost O(degree); nothing is recomputed per frame. The card, ring and leader line are DOM overlays, the same on WebGL and Canvas. Evidence: `tests/connection-card.test.ts` and the compiled-renderer card tests in `tests/physics-transaction.test.ts`; native layout and screen-reader acceptance are pending.

### Find a note (unreleased)

Press **/** or **Ctrl/Cmd+K** over the note graph to open a search box. It finds a note and takes you to it without filtering the rest of the graph away.

- **Results:** up to 20 notes the current view can show. Names that start with the text come first, then names that contain it, then notes whose identity contains it. Each row shows the name, its connection count and its path.
- **Up/Down:** rings the highlighted note where it is. The camera does not move.
- **Enter:** flies to the note (instantly under reduced motion), selects it and opens its connection card. Clicking a row does the same.
- **Shift+Enter:** applies the text as the ordinary search filter, as the toolbar search does.
- **Alt+Enter** (or Alt-click), with a note selected: finds the path from the selected note to the result instead (see *How are these connected?*). The box names the selected note when this is available.
- **Esc:** closes the box. It closes before the connection card does.

Matching runs in the worker over the same cached name-and-identity text as the search filter, once per pause in typing (120 ms), in chunks of 4,096 notes that a newer query cancels. Only note indices come back; identities stay in the worker. Nothing runs per frame. Aggregate graphs have no note search. Evidence: `tests/search.test.ts` and the worker test in `tests/pipeline.test.ts`; native keyboard and screen-reader acceptance are pending.

### Context menu and focus lock (unreleased)

Right-click a note, long-press it for half a second on touch, or press Shift+F10 or the menu key, and Obsidian's menu opens where you are pointing.

- **Notes:** Open, Open in new tab, Open to the right, Focus here, Lens, Lock focus, Show only connections and Copy link. Other plugins' file actions follow, as in the core graph.
- **Lines:** Open relationship note (when the line has one), Go to source and Go to target.
- **Empty canvas:** Fit all, and Clear selection when something is selected.
- A long-press never fires after a drag or a pinch.

**Focus lock.** With a note selected, hovering another note only previews it: a ring and its name, while the highlight stays on the selection. Rest on it for 350 ms, or hold Alt, and the highlight moves. **Lock focus** (the menu, the card's chip, or **K**) keeps the highlight on the selection however you hover; the chip reads **Focus locked** while on. Clearing the selection releases the lock. With nothing selected, hover works as before. **Hover delay (ms)** (`visuals.hoverDwellMs`, Appearance, Finding connections, 0 to 5000, default 350; 0 moves the highlight at once). Reveal in file explorer is not in the menu because Obsidian has no public API for it. Evidence: `tests/context-menu.test.ts` and the compiled-renderer menu and hover-intent tests in `tests/physics-transaction.test.ts`; native menu, touch and screen-reader acceptance are pending.

### How are these connected? (unreleased)

Select a note, then **Shift-click** a second note (or right-click it and choose **Find path to…**). Graph NG finds the shortest path between them through the notes and relationships currently drawn.

- **On the canvas:** the path becomes the top highlight: thick accent lines, a ring around both ends and a numbered badge on each later note. Everything else dims. The camera frames the whole path.
- **In the card:** a **Path** list, one row per step: note, relationship type ("(reverse)" when walked against its direction), next note. Each note name opens it; a relationship drawn as a dot opens its relationship note.
- **Another path:** up to three more paths that share no notes or relationships with the earlier ones.
- **Limits:** at most 6 steps and 200,000 scanned connections. The card says **No path within 6 steps** or **Search limit reached** instead of guessing.
- Relationship notes drawn as dots are part of a step, never a step of their own. Hidden notes and relationship types are never crossed. Esc, an empty click or selecting another note clears the path.

The search is a pure bidirectional BFS on the incident-edge index (`src/path-finder.ts`); it runs once per request, never per frame. WebGL and Canvas draw the same path strokes; the rings and badges are DOM overlays. Evidence: `tests/path-finder.test.ts` and the compiled-renderer path test in `tests/physics-transaction.test.ts`; native visual and screen-reader acceptance are pending. With a note selected, **Alt+Enter** on a Find a note result chooses the second note without a pointer. Paths clear when a filter or collapsed group hides any step. Known gap: the path follows the hover-highlight switch.

### Orientation: zoom limit, minimap and visited-notes trail (unreleased)

- **Zoom out without the cliff:** with a note selected or the lens on, zooming out with the wheel or a pinch stops at the Group overview threshold (`lodZoomRatio`) instead of switching. A chip says **Zoomed all the way out** with a **Group overview** button. With nothing selected the wheel switches as before.
- **Back from Group overview:** opening Group overview from Notes with a selected (or lensed) note rings that note's group and shows **Back to** followed by the note name, which reopens Notes with the same note, card and camera.
- **Minimap** (`visuals.minimap`, on): a 160×120 corner overview of where the notes are, with the current view as a rectangle and the focus and its direct connections as dots. Click or drag it to move the view. It is focusable: arrow keys pan and Home fits all. Hidden when the canvas is under 500 px wide. The density image is rebuilt only after positions or filters change and settle (O(notes)), never per frame.
- **Visited-notes trail** (`visuals.breadcrumb`, on): chips for the last 8 visited notes along the top edge, joined by chevrons. It reads the connection card's own history, which now outlives the card: closing the card keeps the trail, a filter drops hidden visits, and opening a saved view (or leaving the note graph) starts it over. A chip travels there, also with the card closed, and Alt+Left/Right still step.

Both toggles are under Appearance → Finding connections. Evidence: `tests/orientation.test.ts` (clamp, minimap mapping and density, trail model) and the compiled-renderer orientation test in `tests/physics-transaction.test.ts`; native visual and screen-reader acceptance are pending.

### Resolution-change candidate (unverified)

The next detail paint reconciles a changed device-pixel ratio even when the CSS box did not resize. This preserves CSS geometry, semantic colors and layout; it does not establish the cause of scale-dependent color shifts or guarantee all-scale crispness. The optional `probe:zoom` local synthetic harness compares fixed coordinates at far/small-step/mid/near zoom on actual WebGL and bounded Canvas with DPR 1→2, records backend/backing resolution and screenshots, and requires separate runtime authorization. Source authoring is not execution or native/live-tab evidence.
