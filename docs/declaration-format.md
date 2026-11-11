# Declaration v2

Authority: `src/core/declaration.ts` (`GraphDeclaration`, `validateDeclaration`, `validatePredicate`) and `src/core/projection.ts`. Examples are generic synthetic data, not an ontology contract. See `examples/default-declaration.json` and `examples/concept-mapping-declaration.json` for complete inputs.

```json
{
  "version": 2,
  "identity": [{"key": "entity_id"}],
  "edges": [{"name": "reference", "kind": "reified", "sourceProperty": "from_id", "targetProperty": "to_id", "typeProperty": "relation"}],
  "groups": [{"from": "key", "key": "category"}, {"from": "folder", "depth": 1}],
  "display": {"reifiedAsNodes": false},
  "columns": ["category"],
  "colors": [{"name": "Example", "color": "#56b4e9", "predicate": {"kind": "eq", "key": "category", "value": "Example"}}],
  "carrierResolvers": [{"kind": "note-path", "key": "$path"}, {"kind": "reference-id", "key": "entity_id"}]
}
```

## Fields and semantics

All top-level fields except `carrierResolvers` are required. Unknown declaration/nested fields are rejected; arrays are not coerced to objects. String keys/names must be nonempty after trimming, but literal values are not normalized into ontology IDs.

| Field | Contract |
| --- | --- |
| `version` | Exactly `2`. |
| `identity` | Ordered `{key}` frontmatter sources. First present scalar wins; otherwise literal path. No sources means paths. Conflicting identity owners and identity/path aliases quarantine all affected notes; exact duplicate input paths fail. |
| `edges` | Unique named rules. `reified` requires `sourceProperty`/`targetProperty`, optional `typeProperty` and/or `type`; retains the relationship note as carrier. `inline` requires `key` and `type`, with literal IDs, not an inferred link grammar. `producer` requires exact `producer` name and `type`; the host producer is pinned as `obsidian-links@<apiVersion>`. |
| `groups` | Ordered selectable groupings: `{from:"key",key}`, `{from:"folder",depth,prefix?}` with positive safe integer depth, or `{from:"derived",key,transform}` (see [Derived group sources](#derived-group-sources)). `groupLevel` tuning selects one, not an inferred hierarchy. Missing keys form an explicit missing group; no rules means All notes. |
| `display` | Required boolean `reifiedAsNodes`. False connects endpoints with a carrier; true makes the relationship note an intermediate node. |
| `columns` | Nonempty property-key strings materialized as dictionary-coded columns for filtering. Color/group keys are also materialized. |
| `colors` | Ordered `{name,color,predicate}` rules, first match wins. Colors must be `#rrggbb`, `#rrggbbaa`, or a restricted `var(--name)` reference resolved from computed host CSS. These are explicit declarations, not a hidden palette tied to any ontology. |
| `carrierResolvers` | Optional unique `{kind,key}` bindings. `$path` means an exact local note path; other keys are declared frontmatter lookups. Absent/ambiguous matches cannot navigate. Carrier strings have no guessed meaning. |

Unresolved edge endpoints are dropped and counted. Self-links and parallel edges survive. Directed edge columns retain direction; CSR adjacency includes both traversal directions. Filters compare scalar type exactly (`1`, `"1"`, `true`, null and missing differ). Folder prefixes use path boundaries, not arbitrary string prefixes.

## Predicate grammar

`{"kind":"in","key":"category","values":["A","B"]}` matches any of at most 10,000 finite scalars with the same exact-type rule as `eq`. `{"kind":"exists","key":"category"}` matches notes where the property is present (any value, including null). Colors, view filters and saved views share this grammar. `{"kind":"eq","key":"category","value":"Example"}` accepts string, finite number, boolean or null. `{"kind":"folder","prefix":"Notes/Example"}` accepts a relative prefix without a leading slash or a `..` path segment; empty prefix is allowed. Folder prefixes also accept segments, for example `{"kind":"folder","prefix":["Notes","Example"]}`. Folder groups may set an optional `prefix` in either representation to anchor depth below it; notes outside that boundary form `(outside prefix)`. Array segments cannot contain slashes, backslashes, `.` or `..`. Settings saves canonicalize folder-prefix strings to segments. No regex, query language, ontology parser, or body search is implied.

## Derived group sources

Users should not have to stamp new properties onto notes so the graph can group them. A derived source is a bounded, deterministic transform of one value that already exists:

```json
{"from": "derived", "key": "entity_id", "transform": {"kind": "segment", "delimiter": ":", "index": 0}}
{"from": "derived", "key": "$path", "transform": {"kind": "prefix", "delimiter": "/", "segments": 2}}
{"from": "derived", "key": "$identity", "transform": {"kind": "pattern", "pattern": "^([A-Z]+)-"}}
```

`key` is a declared property column, or the built-ins `$identity` (resolved node identity) and `$path` (exact note path); other `$` names are refused. Property inputs use the scalar text, or the first scalar of a list. Every input is truncated to 256 UTF-16 units before the transform.

| Transform | Fields | Result |
| --- | --- | --- |
| `segment` | `delimiter` (1–8 characters), `index` (−64…63; negative counts from the end) | That segment. A value without the delimiter, or an empty segment, is `(no match)`. |
| `prefix` | `delimiter`, `segments` (1…32) | The first N segments joined by the delimiter, when the value has more than N segments; otherwise `(no match)`. |
| `pattern` | `pattern` (1–31 characters) | First capture group (or whole match) of a restricted regular expression; no match is `(no match)`. |

Missing input values form `(missing)`. Patterns accept a deliberately small regex subset that cannot backtrack catastrophically: at most one plain capture group that cannot itself be quantified, no alternation, nesting, lookaround, backreferences or `\b`/`\p`/`\u`/`\x`/`\c` escapes, at most three quantified atoms with at most one unbounded (`*`/`+`), and bounded counts `{m,n}` with n ≤ 16. The 31-character limit also keeps settings free of long opaque strings. A transform runs once per distinct dictionary value and remaps node codes, so cost is bounded by distinct values, not notes. Derived groups are presentation: they are computed in the worker from existing columns and never written to notes.

## Validation diagnostics

Current validators throw ordinary `Error` messages, not stable machine-readable error codes. Representative exact messages: `Unknown field: <key>`, `Declaration version must be 2`, `Duplicate edge declaration: <name>`, `Unknown edge kind`, `Folder depth must be a positive integer`, `reifiedAsNodes must be boolean`, `Duplicate carrier resolver`, `Color must be #rrggbb[aa] or var(--name)`, `Unknown predicate kind`, and `Equality number must be finite`. Treat diagnostics as draft UI strings until a versioned error contract exists.

Generation keys include the declaration, selected producer data, layout parameters and exact paths. Changing a declaration invalidates compatible layout/cache assumptions. This declaration configures the engine-neutral core; GPU-specific buffers do not become part of it. See [ADR-0001](decisions/ADR-0001-ontology-neutral-core.md) and [ADR-0005](decisions/ADR-0005-direct-renderer.md).

## Input migration and settings sharing

`migrateDeclaration()` accepts v1 `sourceKey` / `targetKey` / `typeKey`, rejects ambiguous old/new duplicates and emits only v2 property names. Other unknown fields remain errors. Settings, examples and headless projection declarations always emit v2. Plain `key` fields for identity, inline rules and exact-property predicates are retained; they are benign schema names, not credential holders. Long nested folder paths should use short path segments, not a single opaque slash-joined string. This compatibility representation does not bypass the host credential scanner; genuinely credential-shaped values or a single long opaque segment can still be refused.

View state (`explore.view`) and saved views (`explore.savedViews`: name, filters, query, group source by definition, hidden/collapsed groups, hidden color rules and relation types, normalized camera) live in settings JSON only and reuse the same predicate and group-source validators. Folder prefixes in them are saved as segments.

Generations are derived binary artifacts outside settings JSON. See [ADR-0004](decisions/ADR-0004-worker-generations.md) for scope labels, progressive verification and migration.
