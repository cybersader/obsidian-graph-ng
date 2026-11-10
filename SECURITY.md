# Security policy

Graph NG is a local-first, test-backed alpha, not an authorization boundary. It runs with the permissions of an enabled Obsidian plugin. Enable it only in a workspace you control; keep backups. There is no network adapter, hosted service, credential store, or telemetry in this slice.

## Reporting

After a public repository is approved, use its **Security → Report a vulnerability** private advisory channel. Do not open a public issue containing exploit details, vault content, personal paths, tokens, or screenshots of real workspaces. Include the plugin/Obsidian versions, a minimal synthetic fixture, expected/observed behavior, and reproduction steps. No response-time SLA is promised.

This repository is currently local only. No public advisory endpoint or private contact address has been configured. The owner must enable and verify the private reporting channel before publication; do not invent an address or upload private evidence elsewhere.

## Supported versions

Security fixes target the latest Graph NG release only. The compatibility policy is **current stable Obsidian minor series plus the two preceding minor series**, across desktop and mobile where the public APIs exist. Patch updates within those series should be kept current. This is a target release policy, not a claim that the compatibility matrix has passed.

The existing native evidence covers Obsidian 1.13.7 desktop only; the API development package is 1.12.3. The other two series and mobile remain unverified. `manifest.json` currently declares `minAppVersion: 1.8.0`; that historical API floor does not establish tested support. Reconcile the minimum and execute the version matrix before calling a public release supported. See [the checklist](docs/publish-checklist.md).

## Input and trust model

The slice-1 reviewed implementation treats frontmatter, note paths, declaration JSON, aggregate projection JSON, group labels, and opaque carrier IDs as untrusted input. A future server producer would be another untrusted producer, not an authorization authority. That future transport and its grant boundaries are not implemented or reviewed here.

Existing boundaries:

- Declaration validation accepts the documented keys and types, rejects unknown fields, and requires explicit producer pins and carrier resolvers. No ontology or identity syntax is inferred.
- Aggregate validation checks unique groups/pairs, endpoint existence, safe integer counts, and directional/type totals. Configurable aggregate envelopes reject excess entries; zero means unlimited, not silently truncated.
- Labels are rendered as text through public text/Canvas APIs, not interpreted as HTML, JavaScript, or Markdown. The implementation does not evaluate declarations or labels. Text safety does not make a deceptive label trustworthy.
- Navigation resolves existing local notes. Ambiguous identities/carriers are quarantined or disabled rather than guessed. No arbitrary filesystem or network navigation is promised by the format.
- ForceAtlas2 runs in a terminable worker with a configurable deadline. Paged group/member/carrier UI bounds each displayed page. These are not whole-input memory or CPU quotas.

Known limits: JSON parsing and validation happen on the main thread before entry-count checks; large strings, huge input files, allocation pressure, and renderer setup can still block or exhaust memory. Labels may contain homoglyphs, misleading wording, or confusing Unicode. Worker deadlines do not bound parsing, projection, hashing, or all main-thread work. Native FPS, mobile, integrated GPUs, remote authorization, and million-node rendering are not accepted by the current evidence.

## Supply-chain boundary

No dependency lifecycle code may execute during installation. All install commands use `--ignore-scripts`, and `trustedDependencies` is empty. Runtime dependencies may not declare install lifecycle hooks. Exact, inert development-tool exceptions are listed and hashed separately; see [CONTRIBUTING.md](CONTRIBUTING.md). Runtime license review does not certify the entire development toolchain. Deterministic scans reduce accidental disclosure; they do not replace an independent boundary review or the owner's publication decision.
