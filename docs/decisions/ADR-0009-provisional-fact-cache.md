# ADR-0009: Provisional startup from saved host facts

- Status: implemented pending independent review
- Date: 2026-11-17

## Decision

Persist only declared rows from a stable, fully verified selected-source generation. Restore them through LocalAdapter's existing column ingestion and the existing worker projection, never through a second projection implementation. A saved row is provisional input, not evidence of verification. Current host facts always win, including an explicitly unverified derived fact. No note-body reader, scanner, parser shortcut, or private host API is introduced.

The initial persistent capability is native metadata. A selected optional property provider disables persistent replay and saving: its current public interface has no durable provider/parser version identity. Inventing an identity would be unsafe. Adding a versioned public provider capability is separate work.

## Key and invalidation

The key includes the cache/parser format, plugin version, a durable room/vault namespace, native producer/version, source/view identity, the complete declaration, and a fingerprint of the whole vault file namespace with every file's path, mtime and size, including excluded notes and non-Markdown files. The shared top-level `data.json.deviceNamespace` is a random 128-bit identifier encoded as 32 lowercase hexadecimal characters. A valid existing value is reused. A missing/invalid value is generated with `crypto.getRandomValues` and acknowledged through the ordinary serialized save path before attaching persistent storage; invalid settings refuse generation and same-instance concurrent callers await the same acknowledged write; failed saving disables the cache for that load. Only this opaque identifier, never cached facts, enters data.json. Concurrent initial writers or resets produce a miss, not verification. These stamps are not content proof. Namespace or stamp mismatches refuse the complete saved generation. Same-stamp changes remain provisional until host reconciliation.

Vault edits, creates, deletes, renames, source swaps, declaration changes, disposal and clear-cache invalidate in-flight restore/save work. Host hydration does not cancel restore; available host rows supersede saved rows as they arrive through existing IncrementalIndex epochs and acknowledgements. Saving additionally requires no pending or dirty rows and a stable fact-event generation. The manifest is committed last; incomplete writes are never loaded.

## Storage and responsiveness

Use the BinaryLayoutStore pattern at `<plugin directory>/cache/startup-facts`: bounded binary chunks, shared SHA-256 checksums, a small manifest committed last, sequential I/O, cooperative yields and a 15-second storage-operation deadline. The exact `cache` path segment is mandatory, not configurable. The host team confirms that OpenClast's plugin-cache policy excludes path segments named `cache`, `.cache` or `caches` from replication; ordinary plugin files and data.json are room-shared. This implementation uses that reviewed host exception rather than an additional IndexedDB backend, within the approved download ceiling. It does not assert that an arbitrary host or desktop sync/backup product excludes these files.

The cache has a fixed 32 MiB generation ceiling, 1 MiB chunks, at most 100,000 rows and 4,096 chunks. Invalid, oversized, corrupt or version-mismatched input is refused. Only one generation is retained; saving evicts the previous one first. Storage quota failures are caught, leave the host graph available, and show a short unavailable status. No storage persistence grant is requested. Browser quota remains origin-wide and shared with host caches. A timed-out uncancellable adapter operation retains its serialization slot until settlement, preventing overlapping cleanup or writes.

The clear-saved-facts command cancels active operations, clears in-memory fallback and disk data, and pauses saving until the next plugin load, including across adapter resets. There is no durable opt-out setting in this initial command-only implementation.

## Security and privacy boundary

The cache trusts only the selected public host facts at save time. It never authenticates files, grants access, verifies a projection, overrides host disagreement or upgrades verified:false. Checksums detect damage, not malicious replacement. Restored rows still pass the ordinary declared-column validation, identity duplicate quarantine and explicit carrier-resolution pipeline. Labels stay text-only.

Disk facts include declared property values, note paths and resolved link targets. They are plaintext device-local cache data under OpenClast's exact cache-segment policy, not encrypted or scrubbed of sensitive values. They never enter room-shared data.json or ordinary replicated plugin files. Other hosts' sync and backup policies remain outside this plugin's authority. Cached facts may survive removal of the original note until replacement or clear; clearing cannot erase backups. The shared namespace identifier contains no note content. No upload or new remote authorization boundary exists. Host facts read before progressive load completes remain provisional; once available, native metadata supersedes saved input. Nothing is written back to notes or host metadata.

## Evidence and limits

Regressions cover provisional replay, host disagreement, derived unverified facts, stale/corrupt/version-mismatched input, edits during restore and clearing. Cold-restart measurements must distinguish first saved-fact graph from verified completion and explicitly exclude the earlier same-session replay timings. Independent boundary review follows the implementation commit; deterministic gates do not substitute for that review.
