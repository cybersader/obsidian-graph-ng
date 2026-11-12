# graph-projection v0 draft

Authority: `src/core/group-projection.ts` (`GroupProjection`, `validateGroupProjection`). This is an aggregate-only **local JSON file input**, not a network protocol, grant model, or individual-node dataset. The schema is draft; consumers must not infer authorization or completeness from it.

Set tuning `projectionFile` to an existing vault-relative JSON file. Generic synthetic example:

```json
{
  "schema": "graph-projection-v0",
  "producer": {"name": "synthetic", "projection": "sample", "asOf": "2026-11-10"},
  "groups": [
    {"id": "a", "label": "Group A", "count": 2, "identityPrefix": "sample:a:"},
    {"id": "b", "label": "Group B", "count": 1, "openPath": "Notes/Group-B.md"}
  ],
  "groupEdges": [{
    "a": "a", "b": "b", "total": 1,
    "typeCounts": {"related": 1},
    "directional": {"aToB": {"related": 1}, "bToA": {}},
    "carriers": {"kind": "reference-id", "ids": ["sample:reference:1"]}
  }],
  "coverage": {"source": "synthetic", "complete": false}
}
```

## Required shape and validation

- `groups` and `groupEdges` must be arrays. Each group has a unique nonempty string `id`, a string `label`, and a nonnegative safe integer `count`. Optional `key`, `openPath` and `identityPrefix` must be strings. Local worker summaries include `key` as the raw group dictionary value, distinct from its human-readable label; only this key can retain a selected relationship across dictionary reordering. External aggregate keys are not used to request local contributions.
- Each edge's endpoints must exist. Only one unordered pair per group pair is allowed, including self-pairs. Pair orientation supplies `aToB`/`bToA` meaning; the overview shows a counted bidirectional aggregate, not a single directed edge.
- `typeCounts` is an object of nonnegative safe integers. `total` must be a safe integer equal to the sum of its values. If `directional` is supplied, both direction objects must be valid counts and each type's two directions must sum to its `typeCounts` entry. A type named `constructor` is ordinary data, not an inherited-property lookup.
- `carriers` requires a string `kind` and an array of string `ids`. IDs are opaque; they are not necessarily paths or unique per edge. Totals do not assert that every contributing edge has an individually navigable carrier.
- Optional `schema` is currently validated as a string, **not** as a mandatory exact schema discriminator. Optional `producer` requires string `name`, `projection`, and `asOf`; the date is not authenticated or parsed as a timestamp. Do not rely on stricter checks than exist.
- `coverage` is optional producer-supplied metadata. This slice does not validate its semantic shape or verify completeness. Unknown extension fields are not rejected by the aggregate validator; they are not thereby trusted or consumed.

The settings `maxProjectionGroups`, `maxProjectionPairs`, and `maxProjectionCarriers` define explicit entry limits: 20,000 / 200,000 / 1,000,000 by default; explicit zero opts into unlimited counts. Carrier count is the sum of all carrier ID array lengths. Violations throw `Projection group limit exceeded (<limit>)`, `Projection pair limit exceeded (<limit>)`, or `Projection carrier limit exceeded (<limit>)`, not silent truncation. A separate `maxProjectionBytes` budget (64 MiB by default) precedes JSON parsing in the worker. Counts do not themselves bound nesting or parsing allocation; text reading and UTF-8 encoding still allocate before worker validation.

Other current diagnostics include `Projection requires groups and groupEdges arrays`, `Invalid or duplicate group`, `Invalid or duplicate group edge`, `Edge total must equal type counts`, and `Directional counts must sum to type counts`. They are ordinary draft error strings, not stable codes.

## Local navigation and display

`carrierResolvers` in the [declaration](declaration-format.md) explicitly maps `kind` to a property key; `$path` resolves an existing local path. Missing or ambiguous values remain disabled. `openPath` only navigates to an existing local note. `identityPrefix` can discover local members through declared identity keys. None of these grant access to a remote or arbitrary filesystem path.

Producer input contains no node positions or complete member bodies; individual-node detail is unavailable. Local column filters do not filter producer totals. The same paged group renderer handles local and producer aggregates. Labels remain text; deceptive strings and huge inputs remain possible, as described in [SECURITY.md](../SECURITY.md).

Do not confuse this input with `graph-ng.local-projection.v1`, the headless builder's output envelope containing columns, CSR and positions. That envelope is **not** a valid direct `projectionFile` input. Streaming chunks, tiles, remote adapters and authenticated transport are future design work, not v0 guarantees.
