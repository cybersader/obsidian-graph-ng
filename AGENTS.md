# Agent contributor contract

Read README.md, CONTRIBUTING.md, SECURITY.md, and the relevant docs/decisions record before editing. A passing deterministic gate is evidence for its exact command, not a judgment that a release is safe or production-ready.

- Work locally unless the owner explicitly authorizes a remote or publication. Do not create a remote, push, publish, upload evidence, or run hosted CI as a side effect of a task.
- Use human authorship only. No AI author, contributor, co-author trailer, or package/notice attribution. No CLA/DCO/sign-off requirement. Never bypass hooks.
- Preserve the ontology-neutral typed-array authority in `src/core/`; engine-specific structures belong in renderer adapters. No ontology-specific key/ID/parser shortcuts. Use public Obsidian and renderer APIs only.
- Treat notes, paths, labels, declarations and projections as untrusted. Keep validation, duplicate-ID quarantine, explicit carrier resolution, text-only labels, worker cleanup/deadlines, and visible limit/error handling intact. Do not claim a remote authorization boundary that does not exist.
- Read source and existing reviewed boundaries before changing them. Consequential security/boundary judgments require an independent permitted senior review; do not turn a tooling task into an unreviewed security redesign.
- Keep `trustedDependencies` empty. Every install uses `--ignore-scripts`; exact hashed inert dev install declarations are exceptions to declaration absence, never permission to execute. Runtime install hooks are forbidden.
- Verification order: secrets, attribution (files + commit range), privacy (including screenshot names and README), supply-chain/frozen lock, runtime licenses; then build/unit tests and applicable synthetic native lanes, independent review, and full gates before commit/tag. Use `./scripts/run.sh` so local Bun stays under `flock /tmp/openclast-local-verification.lock build-contained --`. Never acquire that same lock recursively.
- Configure the local `.git/info/private-terms` or `PRIVATE_TERMS_FILE`; do not print or commit it. Only synthetic fixtures/screenshots. Never read real vaults to create examples, forge identity, auto-accept trust/login, click live Create/update, or commit downloaded app binaries.
- Keep raw logs, screenshots, app downloads, temporary fixtures and worklogs in ignored locations. Report receipts by relative evidence location, exact commands/subsets, commit and generic hardware class, not personal paths or hostnames in tracked docs. Visually inspect screenshots; byte scans cannot recognize sensitive rendered text.
- Update the owning format/benchmark doc, changelog and ADR as appropriate. Preserve known gaps instead of inflating acceptance. Do not write a second projection authority or resurrect a server mode.
- Delegated workers are leaves: do not spawn subagents or invoke orchestration. For longer tasks checkpoint private worklogs before edits/long commands; return concise evidence and unresolved owner decisions.

The local release script only creates checksummed assets; it never grants permission to tag, publish, enable CI, or submit a community plugin. See docs/publish-checklist.md.
