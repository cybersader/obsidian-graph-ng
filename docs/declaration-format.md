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
| `groups` | Ordered selectable groupings: `{from:"key",key}`, `{from:"folder",depth,prefix?}` with positive safe integer depth, `{from:"expr",expr}`, or `{from:"derived",key,transform}` (see [Derived group sources](#derived-group-sources)). `groupLevel` tuning selects one, not an inferred hierarchy. Missing keys form an explicit missing group; no rules means All notes. |
| `display` | Required boolean `reifiedAsNodes`. False connects endpoints with a carrier; true makes the relationship note an intermediate node. |
| `columns` | Nonempty property-key strings materialized as dictionary-coded columns for filtering. Color/group keys are also materialized. |
| `colors` | Ordered `{name,color,predicate}` rules, first match wins. Colors must be `#rrggbb`, `#rrggbbaa`, or a restricted `var(--name)` reference resolved from computed host CSS. These are explicit declarations, not a hidden palette tied to any ontology. |
| `carrierResolvers` | Optional unique `{kind,key}` bindings. `$path` means an exact local note path; other keys are declared frontmatter lookups. Absent/ambiguous matches cannot navigate. Carrier strings have no guessed meaning. |

Unresolved edge endpoints are dropped and counted. Self-links and parallel edges survive. Directed edge columns retain direction; CSR adjacency includes both traversal directions. Filters compare scalar type exactly (`1`, `"1"`, `true`, null and missing differ). Folder prefixes use path boundaries, not arbitrary string prefixes.

## Predicate grammar

`{"kind":"in","key":"category","values":["A","B"]}` matches any of at most 10,000 finite scalars with the same exact-type rule as `eq`. `{"kind":"exists","key":"category"}` matches notes where the property is present (any value, including null). Colors, view filters and saved views share this grammar. `{"kind":"eq","key":"category","value":"Example"}` accepts string, finite number, boolean or null. `{"kind":"folder","prefix":"Notes/Example"}` accepts a relative prefix without a leading slash or a `..` path segment; empty prefix is allowed. Folder prefixes also accept segments, for example `{"kind":"folder","prefix":["Notes","Example"]}`. Folder groups may set an optional `prefix` in either representation to anchor depth below it; notes outside that boundary form `(outside prefix)`. Array segments cannot contain slashes, backslashes, `.` or `..`. Settings saves canonicalize folder-prefix strings to segments. No regex, ontology parser, search translator, or body search is implied.

## Derived group sources

Users should not have to stamp new properties onto notes so the graph can group them. A derived source is a bounded, deterministic transform of one value that already exists:

```json
{"from": "derived", "key": "entity_id", "transform": {"kind": "segment", "delimiter": ":", "index": 0}}
{"from": "derived", "key": "$path", "transform": {"kind": "prefix", "delimiter": "/", "segments": 2}}
```

`key` is a declared property column, or the built-ins `$identity` (resolved node identity) and `$path` (exact note path); other `$` names are refused. Property inputs use the scalar text, or the first scalar of a list. Every input is truncated to 256 UTF-16 units before the transform.

| Transform | Fields | Result |
| --- | --- | --- |
| `segment` | `delimiter` (1–8 characters), `index` (−64…63; negative counts from the end) | That segment. A value without the delimiter, or an empty segment, is `(no match)`. |
| `prefix` | `delimiter`, `segments` (1…32) | The first N segments joined by the delimiter, when the value has more than N segments; otherwise `(no match)`. |

Missing input values form `(missing)`. Both transforms are a single split of the capped input, so their cost is linear. Regular-expression transforms are deliberately not supported: a restricted regex validator was shown to admit catastrophic backtracking. A stored `pattern` group from an earlier 0.3.0 build is moved, on load, out of the declaration, the current view and saved views into `explore.disabledDerived`. The Explore panel and a notice show it until the user dismisses it; it never affects the graph. A transform runs once per distinct dictionary value and remaps node codes, so cost is bounded by distinct values, not notes. Derived groups are presentation: they are computed in the worker from existing columns and never written to notes.

## Expressions (node context)

The storage change is additive, with no declaration-version bump:

```json
{"kind": "expr", "expr": "note.category == \"Example\""}
{"from": "expr", "expr": "note.entity_id.segment(\":\", 0)"}
```

The same predicate union is accepted by declaration color rules, view filters and saved views; group sources accept the second shape. Static note-property references (including `file.hasProperty`) join declared keys automatically. The core validator is `validate(source, context)` under `src/core/expr/syntax.ts`; it returns `ok`, positional `errors`, and sorted `references` without throwing. `context` is `filter` or `group`. Unknown property types are checked at runtime; a filter only includes a result equal to boolean `true`. A statically known list cannot be a group source.

### Syntax and whitelist

- Read properties with `note.category`, bare `category`, or `note["my-key"]`. Unicode keys use brackets. Strings use single/double quotes and only `\\`, `\"`, `\'`, `\n`, `\t`, `\uXXXX` escapes. Finite decimal numbers, booleans, null and literal-only scalar lists are supported.
- Operators: `&&`, `||`, `!`, exact-type `==`/`!=`, ordered `<`/`>`/`<=`/`>=`, and `+`/`-`/`*`/`/`/`%`. Comparisons cannot chain. Use `.isTruthy()` for known nonboolean logical operands. Dataview `and`/`or`/`not`/`=` are refused with a syntax hint.
- Globals: `if(condition, yes, no?)`, `number(value)`, `min(...)`, `max(...)`, `list(value)`; graph-specific `coalesce(...)` returns the first non-null/nonmissing result.
- Any value: `.isTruthy()`, `.isEmpty()`, `.toString()`, `.isType("string"|"number"|"boolean"|"list"|"null")`.
- Text: `.lower()`, `.upper()`, `.trim()`, `.length`, `.contains(value)`, `.containsAny(...)`, `.containsAll(...)`, `.startsWith(value)`, `.endsWith(value)`, `.slice(start, end?)`, `.split(separator, limit?)`, `.replace(find, replacement)`. Separators/finds are literal strings, never patterns; replace is literal replace-all.
- Lists: membership methods above, `.length`, `.join(separator)`, `.slice(start, end?)`, `.isEmpty()`, `[index]` (negative from end; out of range is null).
- Numbers: `.abs()`, `.floor()`, `.ceil()`, `.round(digits?)`; nonfinite arithmetic results become null.
- File facts: `file.path`, `file.name`, `file.basename`, `file.folder`, `file.ext`; `file.inFolder(path)` matches path boundaries and `file.hasProperty("key")` checks presence including null.
- Graph-specific facts: `node.identity`, `node.degree`. Graph-specific `.segment(delimiter, index)` and `.prefix(delimiter, count)` retain the exact legacy transform behavior above. They and `coalesce` are not portable Bases expressions.

No regex literal/method, JavaScript evaluation, constructors/prototypes, dynamic property lookup, lambda, formula, date, edge context, body access, I/O, clock or randomness is exposed. This pins a Bases-aligned subset, not every Bases feature.

### Limits and null semantics

| Limit | Value |
| --- | --- |
| Typed/pasted expression text | 2,048 UTF-16 units |
| Final AST nodes / depth | 256 / 32 |
| Identifier token | 128 units (longer property keys use bracket strings) |
| Decoded string literal | 256 units |
| String-operation input/output | 4,096 units (256 input for segment/prefix) |
| Literal list / distinct property references | 10,000 scalar entries / 16 keys |

Missing remains distinct from explicit null. Equality and membership preserve both distinctions; comparisons with missing are false. A raw property group reuses its typed dictionary, including null, missing and list values. Other operation outputs label missing as `(missing)` and null as `(no match)`. They preserve legacy readable string keys: numeric `1` and string `"1"` both become the key/label `1` after an operation, while raw property grouping distinguishes the types. Segment/prefix alone normalize null at the legacy string-coercion point, including null-only lists. Other string coercion takes the first non-null scalar list member, or the string form of numbers/booleans. String operations cap their input before processing and their output afterward.

Structured `eq`/`in`/`exists`/`folder` predicates and segment/prefix groups keep their original storage and validator limits. They lower directly to AST, not through capped text; a 10,000-item membership list and a legacy 257-character equality string remain valid. The builder never rewrites them automatically. **Edit as expression** validates the printed text first and otherwise explains “Too large for an expression; edit in the builder.” Long summaries show a bounded prefix plus `… N more`. Folder-depth grouping remains structural because expression labels are not equivalent.

Canonical print uses spaces around binary operators/after commas and double-quoted strings. Declaration expression fields, view state and saved views use the existing `$text` chunk encoding for long whitespace-free runs, with chunks at most 24 JSON-escaped units (not source units). A serialized-value guard rejects whitespace-free runs of 32 or more characters in those payload strings; it excludes schema keys and legacy declaration fields. Legacy declaration fields remain unchanged, so their long literals retain a known pre-existing settings-sharing scanner limitation; no migration or new rejection is imposed. `settingsForSave` checks both the ordinary and encoded reload shapes and the loader's byte ceiling before writing. Generation identity recognizes equivalent legacy expression shapes and retains their historical bytes; no upgrade relayout is implied. Color predicates remain presentation-only.

The worker folds constants, evaluates single-property subtrees once per distinct dictionary value, and maps typed lookups through row codes. Boolean/numeric kernels use `Uint8Array`/`Float64Array`; other results use remapped `Uint32Array` dictionary codes. Multi-column expressions remain bounded per row. Count requests are read-only and reject stale projection revisions. Count and applied-view expression work are cooperatively cancellable. A newer request supersedes active count/filter work; queued counts/views coalesce. Default evaluation budget is 90% of the configurable `workerTimeoutMs` watchdog, or an explicit positive finite `budgetMs` on a count/explore request. Errors distinguish `Expression superseded` from `Expression time budget exceeded`. Applied views commit only after expression preparation succeeds; an aborted view leaves the prior worker view/config usable. Batches check/yield during dictionary compilation and row masks; project construction and a single built-in operation are not preempted. Preview of an as-yet unmaterialized key reports that condition; applying the expression materializes it. See [benchmarks](benchmarks.md) for actual invocation scope and the unresolved bundle gate.

## Validation diagnostics

Current validators throw ordinary `Error` messages, not stable machine-readable error codes. Representative exact messages: `Unknown field: <key>`, `Declaration version must be 2`, `Duplicate edge declaration: <name>`, `Unknown edge kind`, `Folder depth must be a positive integer`, `reifiedAsNodes must be boolean`, `Duplicate carrier resolver`, `Color must be #rrggbb[aa] or var(--name)`, `Unknown predicate kind`, and `Equality number must be finite`. Treat diagnostics as draft UI strings until a versioned error contract exists.

Generation keys include the declaration, selected producer data, layout parameters and exact paths. Changing a declaration invalidates compatible layout/cache assumptions. This declaration configures the engine-neutral core; GPU-specific buffers do not become part of it. See [ADR-0001](decisions/ADR-0001-ontology-neutral-core.md) and [ADR-0005](decisions/ADR-0005-direct-renderer.md).

## Input migration and settings sharing

`migrateDeclaration()` accepts v1 `sourceKey` / `targetKey` / `typeKey`, rejects ambiguous old/new duplicates and emits only v2 property names. Other unknown fields remain errors. Settings, examples and headless projection declarations always emit v2. Plain `key` fields for identity, inline rules and exact-property predicates are retained; they are benign schema names, not credential holders. Long nested folder paths should use short path segments, not a single opaque slash-joined string. This compatibility representation does not bypass the host credential scanner; genuinely credential-shaped values or a single long opaque segment can still be refused.

View state (`explore.view`) and saved views (`explore.savedViews`: name, filters, query, group source by definition, hidden/collapsed groups, hidden color rules and relation types, normalized camera) live in settings JSON only and reuse the same predicate and group-source validators. Folder prefixes in them are saved as segments.

Generations are derived binary artifacts outside settings JSON. See [ADR-0004](decisions/ADR-0004-worker-generations.md) for scope labels, progressive verification and migration.

## Callable inventory

Generated by `./scripts/run.sh docs:expressions` from the shared callable descriptor table; hand-written semantics and literal restrictions above remain authoritative.

<!-- expression-functions:start -->
| Callable | Receiver / scope | Arguments | Result |
| --- | --- | --- | --- |
| `if` | global | 2–3 | unknown |
| `number` | global | 1 | number |
| `max` | global | 1–256 | number |
| `min` | global | 1–256 | number |
| `list` | global | 1 | list |
| `coalesce` | global | 1–256 | unknown |
| `file.inFolder` | global | 1 | boolean |
| `file.hasProperty` | global | 1 | boolean |
| `isTruthy` | any | 0 | boolean |
| `isEmpty` | any | 0 | boolean |
| `toString` | any | 0 | string |
| `isType` | any | 1 | boolean |
| `lower` | string | 0 | string |
| `upper` | string | 0 | string |
| `trim` | string | 0 | string |
| `length` | string list | 0 | number |
| `contains` | string list | 1 | boolean |
| `containsAny` | string list | 1–256 | boolean |
| `containsAll` | string list | 1–256 | boolean |
| `startsWith` | string | 1 | boolean |
| `endsWith` | string | 1 | boolean |
| `slice` | string list | 1–2 | unknown |
| `split` | string | 1–2 | list |
| `replace` | string | 2 | string |
| `join` | list | 1 | string |
| `index` | list | 1 | unknown |
| `abs` | number | 0 | number |
| `floor` | number | 0 | number |
| `ceil` | number | 0 | number |
| `round` | number | 0–1 | number |
| `segment` | string | 2 | string |
| `prefix` | string | 2 | string |
<!-- expression-functions:end -->
