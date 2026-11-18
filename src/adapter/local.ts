import { TFile, type TAbstractFile, type TFolder, type App, type Plugin } from 'obsidian';
import type { FactRow } from '../core/projection';
import { FactCache, factKey } from './fact-cache';
import { IncrementalIndex } from './index';
import { hashEdge } from '../core/edge-hash';
import { digest, folderPath, type GraphDeclaration } from '../core/declaration';
import { declaredKeys, packRows, type RowColumns } from '../core/columns';
import { yieldTask, sliced, type IngestOptions } from '../core/scheduler';
export interface PropertySource {
  get(path: string): { source?: string; state?: string; verified?: boolean; frontmatter?: Record<string, unknown>; parseError?: unknown; truncated?: unknown } | undefined;
  load?(): Promise<unknown>;
  rooms?(): readonly RoomHandle[];
  roomFor?(path: string): RoomHandle | undefined;
}
interface RoomHandle { cacheIdentity?: string; generation?: number; verifiedComplete?: boolean }
interface RoomPartition { id: string; generation: number; ready: boolean; settled: boolean; savedVersion: number; writing?: boolean }
function validRoom(room: RoomHandle | undefined) {
  return typeof room?.cacheIdentity === 'string' && room.cacheIdentity.startsWith('ocpf1:') && Number.isSafeInteger(room.generation);
}
function markdownFiles(file: TAbstractFile): TFile[] {
  const found: TFile[] = [], pending = [file];
  while (pending.length) {
    const next = pending.pop()!;
    if (next instanceof TFile) { if (next.extension === 'md') found.push(next); }
    else pending.push(...((next as TFolder).children ?? []));
  }
  return found;
}
export class LocalAdapter {
  readonly index: IncrementalIndex;
  private cache?: FactCache;
  private cacheScope = '';
  private cacheTurn = 0;
  private factVersion = 0;
  private savedVersion = -1;
  private restore?: Promise<void>;
  private savedFacts = new Map<string, FactRow>();
  cacheStatus = '';
  factError = '';
  attachFactCache(cache: FactCache, source: string) { this.cache = cache; this.cacheScope = source; }
  private partitions = new Map<string, RoomPartition>();
  roomRevision = 0;
  private savedOwners = new Map<string, string>();
  private get partitioned() { return typeof this.propertySource?.rooms === 'function' && typeof this.propertySource.roomFor === 'function'; }
  private forget(path: string) { this.savedFacts.delete(path); this.savedOwners.delete(path); }
  private storageError(error: unknown) { this.cacheStatus = 'unavailable'; this.factError = String(error); }
  // Re-read public summaries, copying scalar tags instead of retaining mutable host handles.
  syncRooms() {
    let handles: readonly RoomHandle[] = [];
    if (this.partitioned) try { handles = this.propertySource!.rooms!(); } catch { /* fail closed */ }
    const active = new Set<string>(); let moved = false;
    if (Array.isArray(handles)) for (const h of handles) if (validRoom(h)) {
      const id = h.cacheIdentity!; active.add(id);
      let room = this.partitions.get(id);
      if (!room || room.generation !== h.generation) {
        moved ||= !room;
        this.partitions.set(id, room = { id, generation: h.generation!, ready: false, settled: false, savedVersion: -1 });
      }
      room.ready = h.verifiedComplete === true;
    }
    for (const id of this.partitions.keys()) if (!active.has(id)) {
      this.partitions.delete(id); moved = true;
      void this.cache?.dropPartition(id).catch(error => this.storageError(error));
    }
    if (moved) for (const [path, id] of this.savedOwners) if (!active.has(id)) { this.forget(path); this.index.change(path); }
    if (moved) this.roomRevision++;
  }
  async onRoomSettled(detail: { cacheIdentity?: unknown; generation?: unknown } | undefined, options: IngestOptions) {
    const room = typeof detail?.cacheIdentity === 'string' ? this.partitions.get(detail.cacheIdentity) : undefined;
    if (!room || room.generation !== detail?.generation) return;
    room.settled = true;
    if (room.ready && await this.verifyProperties(options)) {
      await this.saveRoom(room);
      return this.partitions.get(room.id) === room;
    }
  }
  private route(path: string) {
    let h: RoomHandle | undefined;
    try { h = this.propertySource?.roomFor?.(path); } catch { /* unavailable */ }
    const room = h && this.partitions.get(h.cacheIdentity!);
    return room && h?.generation === room.generation ? room : undefined;
  }
  get savedCopy() { return this.savedFacts.size > 0; }
  private retireSaved() {
    this.cacheTurn++; this.factVersion++;
    for (const path of this.savedFacts.keys()) this.index.change(path);
    this.savedFacts.clear(); this.savedOwners.clear();
  }
  private purgeFacts() {
    this.retireSaved();
    return this.cache?.clear().catch(error => { this.cacheStatus = 'unavailable'; this.factError = String(error); });
  }
  private rejectSaved(error: unknown) {
    void this.purgeFacts(); this.cacheStatus = 'unavailable'; this.factError = String(error);
  }
  private cacheKey(check: () => void) { return factKey(this.app.vault.getFiles(), [this.cacheScope, this.producer, this.declaration], check); }
  private restoreFacts(): Promise<void> {
    return this.restore ??= (async () => {
      if (!this.cache || this.cache.paused) return;
      if (this.propertySource && !this.partitioned) { await this.purgeFacts(); return; }
      const turn = this.cacheTurn, source = this.propertySource, current = () => turn === this.cacheTurn && source === this.propertySource && !this.cache?.paused;
      try {
        await this.cache.prunePartitions(source ? [...this.partitions.keys()] : undefined, current);
        if (!current()) return;
        if (source) {
          const paths = new Map([...this.partitions.values()].map(room => [room, new Set<string>()]));
          const budget = { bytes: 0, parts: 0 };
          // Fingerprint the whole resolution namespace at most once per cold open,
          // and only if a manifest exists. Keep the room binding in the final digest.
          let namespace: string | undefined;
          const key = async (check: () => void, id: string) => digest([namespace ??= await this.cacheKey(check), id]);
          await sliced([...this.paths], { chunkRows: 256, budgetMs: 8 }, path => {
            if (!current()) return;
            const room = this.route(path); if (!room) return;
            paths.get(room)?.add(path);
          });
          for (const [room, group] of paths) {
            if (!current()) break;
            await this.loadRoom(room, group, current, budget, key);
          }
          return;
        }
        const rows = await this.cache.load(check => this.cacheKey(check), current);
        if (!current() || !rows) { this.cacheStatus = 'miss'; return; }
        if ([...rows.keys()].some(p => !this.paths.has(p)) || rows.size !== this.paths.size) throw Error('Saved facts mismatch');
        this.savedFacts = rows; this.cacheStatus = 'restored';
      } catch (error) { if (current()) this.rejectSaved(error); }
    })();
  }
  private async loadRoom(room: RoomPartition, paths: Set<string>, owned: () => boolean, budget: { bytes: number; parts: number }, key: (check: () => void, id: string) => Promise<string>) {
    const current = () => owned() && this.partitions.get(room.id) === room;
    try {
      const rows = await this.cache!.load(check => key(check, room.id), current, room.id, budget);
      if (!owned()) return;
      this.syncRooms(); if (!current() || !rows) return;
      if (rows.size !== paths.size || [...rows.keys()].some(p => !paths.has(p) || this.route(p) !== room)) throw Error('Saved facts mismatch');
      for (const [path, row] of rows) { this.savedFacts.set(path, row); this.savedOwners.set(path, room.id); }
      this.cacheStatus = 'restored';
    } catch (error) { if (current()) { this.storageError(error); await this.cache!.dropPartition(room.id).catch(error => this.storageError(error)); } }
  }
  private async saveRoom(room: RoomPartition) {
    if (this.cache?.paused || !this.cache || this.reloadRequired || this.ingesting || !room.settled || !room.ready || room.writing || room.savedVersion === this.factVersion) return;
    const version = this.factVersion, turn = this.cacheTurn, current = () => turn === this.cacheTurn && version === this.factVersion && !this.cache?.paused && this.partitions.get(room.id) === room && room.ready;
    const commit = () => { if (!current()) return false; this.syncRooms(); return current(); };
    const paths: string[] = []; room.writing = true;
    try {
      // No other room's readiness authorizes or blocks this partition. Links
      // still require the actual declared native producer and resolved sources.
      const links = this.declaration?.edges.filter(e => e.kind === 'producer') ?? [];
      if (links.some(e => e.producer !== this.producer)) return;
      let ready = true;
      await sliced([...this.paths], { chunkRows: 256, budgetMs: 8 }, path => {
        if (!ready || !current() || this.route(path) !== room) return;
        paths.push(path);
        if (this.pendingPropertyPaths.has(path) || this.dirty.has(path) || this.index.hasPending(path) || links.length && !Object.hasOwn(this.app.metadataCache.resolvedLinks, path)) ready = false;
      });
      if (!ready || !paths.length || !commit()) return;
      const adapter = this;
      function* rows() { for (const path of paths) {
        const row = adapter.read(path);
        if (!row || adapter.route(path) !== room || adapter.pendingPropertyPaths.has(path)) throw Error('Room facts changed');
        yield row;
      } }
      await this.cache.save(async check => digest([await this.cacheKey(check), room.id]), rows(), current, commit, room.id);
      if (current()) { room.savedVersion = version; this.cacheStatus = 'saved'; this.factError = ''; }
    } catch (error) { if (current()) this.storageError(error); } finally { room.writing = false; }
  }
  async saveFacts() {
    if (this.propertySource) {
      this.syncRooms();
      for (const room of [...this.partitions.values()]) if (room.settled && room.ready) await this.saveRoom(room);
      return;
    }
    if (!this.cache || this.cache.paused || !this.sentComplete || !this.factsComplete() || this.dirty.size || [...this.paths].some(p => this.index.hasPending(p)) || this.savedVersion === this.factVersion) return;
    const turn = this.cacheTurn, version = this.factVersion;
    const current = () => turn === this.cacheTurn && version === this.factVersion && !this.propertySource && !this.cache?.paused && this.factsComplete();
    try {
      await this.cache.save(check => this.cacheKey(check), this.values(), current);
      if (current()) { this.savedVersion = version; this.cacheStatus = 'saved'; this.factError = ''; }
    } catch (error) { if (current()) { this.cacheStatus = 'unavailable'; this.factError = String(error); } }
  }
  async clearFacts() {
    this.retireSaved(); await this.cache?.clear(true);
    this.cacheStatus = 'cleared'; this.factError = '';
  }
  private seedComplete = false;
  private paths = new Set<string>();
  private indexed = new Set<string>();
  private pendingPropertyPaths = new Set<string>();
  private propertyAudit?: Promise<boolean>;
  private propertyAuditAgain = false;
  private propertyAuditRefresh = false;
  private propertyAuditImmediate = false;
  private propertyAuditWake?: () => void;
  private epoch = 0;
  linksResolved = false;
  private dirty = new Map<string, number>();
  private changeVersion = 0;
  private reloadRequired = true;
  /** Ephemeral 64-bit input digests plus length, never rows. Adopt only after worker acknowledgement. */
  private sent = new Map<string, string>();
  private sentComplete = false;
  private ingesting = false;
  private stamp(row: FactRow | undefined) {
    if (!row) return;
    const text = JSON.stringify([row, this.indexed.has(row.path), !this.pendingPropertyPaths.has(row.path)]);
    // Two hash lanes plus length make accidental equality unlikely without retaining JSON rows.
    // Not an authenticity check: collisions can delay a notification, never change source facts.
    return `${text.length}:${hashEdge(text).join(':')}`;
  }
  invalidate(keepSaved = false, siblingsCurrent = false) { if (!keepSaved) this.retireSaved(); else if (!siblingsCurrent) { this.cacheTurn++; this.factVersion++; } this.epoch++; this.propertyAuditWake?.(); this.reloadRequired = true; this.seedComplete = false; this.indexed.clear(); this.pendingPropertyPaths = new Set(this.paths); this.sent.clear(); this.sentComplete = false; this.linksResolved = false; }
  setPropertySource(source?: PropertySource, startup = false, siblingsCurrent = false) {
    const same = source === this.propertySource, wasPartitioned = this.partitioned;
    if (!same) {
      this.propertySource = source;
      if (wasPartitioned && this.partitioned) {
        // Preserve partitions with equal bindings, but do not inherit a settled
        // event or asynchronous work from the previous provider object.
        for (const [id, room] of this.partitions) this.partitions.set(id, { ...room, settled: false, writing: false });
      } else {
        this.partitions.clear();
        if (!startup || !this.partitioned) void this.purgeFacts();
      }
    }
    this.syncRooms();
    this.invalidate((same || wasPartitioned) && this.partitioned, same && siblingsCurrent);
  }
  private declaration?: GraphDeclaration;
  private excluded: string[] = [];
  /** Declared excluded folders never enter paths, rows, coverage or identity. */
  private kept = (path: string) => !this.excluded.some(f => path.startsWith(f + '/'));
  private markdown() { return this.app.vault.getMarkdownFiles().filter(f => this.kept(f.path)); }
  private keys?: string[];
  constructor(readonly app: App, plugin: Plugin, readonly producer: string, private debounceMs: number, private onChange: (changed: Set<string>) => void, private streaming = false, declaration?: GraphDeclaration, private propertySource?: PropertySource) {
    this.declaration = declaration; this.keys = declaration ? declaredKeys(declaration) : undefined; this.excluded = (declaration?.exclude ?? []).map(folderPath);
    this.index = new IncrementalIndex(path => this.streaming ? undefined : this.read(path), changed => {
      // Native resolution can report the same facts repeatedly while a large vault hydrates.
      // Compare the declared input, not host object identity or irrelevant metadata/body fields.
      // During ingestion the worker may already hold an unacknowledged batch, including a
      // value later reverted by an event. Keep those events rather than compare older stamps.
      if (this.streaming && !this.ingesting) changed = new Set([...changed].filter(path => {
        try { return this.stamp(this.read(path)) !== this.sent.get(path); } catch { return true; }
      }));
      for (const path of changed) { this.dirty.set(path, ++this.changeVersion); if (this.streaming) { this.indexed.delete(path); if (this.paths.has(path)) this.pendingPropertyPaths.add(path); } }
      if (!this.ingesting && (!this.streaming || changed.size || this.factsComplete() !== this.sentComplete)) onChange(changed);
    }, debounceMs);
    const files = this.markdown();
    this.paths = new Set(files.map(f => f.path)); this.pendingPropertyPaths = new Set(this.paths);
    if (!this.streaming) this.index.seed([...this.paths]);
    this.seedComplete = files.length > 0 && this.indexed.size === files.length;
    this.linksResolved = files.every(f => Object.hasOwn(app.metadataCache.resolvedLinks, f.path));
    const retire = () => this.retireSaved();
    plugin.registerEvent(app.vault.on('create', retire)); plugin.registerEvent(app.vault.on('modify', retire));
    plugin.registerEvent(app.vault.on('delete', retire)); plugin.registerEvent(app.vault.on('rename', retire));
    const change = (file: TFile) => { this.factVersion++; if (file.extension === 'md' && this.kept(file.path)) { this.paths.add(file.path); this.pendingPropertyPaths.add(file.path); this.linksResolved = false; this.index.change(file.path); } };
    plugin.registerEvent(app.metadataCache.on('changed', change));
    plugin.registerEvent(app.metadataCache.on('resolve', file => { this.factVersion++; if (file.extension === 'md' && this.kept(file.path)) this.index.change(file.path); }));
    // Property coverage cannot substitute for the native resolver's per-source readiness.
    plugin.registerEvent(app.metadataCache.on('resolved', () => { const wasReady = this.linksResolved; this.linksResolved ||= !this.streaming || (this.indexed.size === this.paths.size && (!this.propertySource || [...this.paths].every(path => Object.hasOwn(app.metadataCache.resolvedLinks, path)))); if (!wasReady && this.linksResolved) this.index.notify(); return this.verifyProperties({ chunkRows: 256, budgetMs: 8 }, true); }));
    plugin.registerEvent(app.vault.on('create', file => { for (const child of markdownFiles(file)) change(child); }));
    plugin.registerEvent(app.vault.on('modify', file => { if (file instanceof TFile) change(file); }));
    plugin.registerEvent(app.vault.on('delete', file => {
      this.linksResolved = false;
      for (const child of markdownFiles(file)) { this.paths.delete(child.path); this.indexed.delete(child.path); this.pendingPropertyPaths.delete(child.path); this.index.remove(child.path); }
    }));
    plugin.registerEvent(app.vault.on('rename', (file, old) => {
      this.linksResolved = false;
      if (file instanceof TFile) {
        this.paths.delete(old); this.indexed.delete(old); this.pendingPropertyPaths.delete(old); this.index.remove(old);
        if (file.extension === 'md' && this.kept(file.path)) { this.paths.add(file.path); this.pendingPropertyPaths.add(file.path); this.index.change(file.path); }
        return;
      }
      for (const child of markdownFiles(file)) {
        const previous = old + child.path.slice(file.path.length);
        this.paths.delete(previous); this.indexed.delete(previous); this.pendingPropertyPaths.delete(previous);
        if (this.kept(child.path)) { this.paths.add(child.path); this.pendingPropertyPaths.add(child.path); this.index.rename(previous, child.path); } else this.index.remove(previous);
      }
    }));
    plugin.register(() => { this.retireSaved(); this.epoch++; this.propertyAuditWake?.(); this.index.dispose(); });
  }
  snapshot(): FactRow[] {
    // One startup reconciliation, not a vault rescan on every edit/resolver batch.
    if (this.streaming) return [...this.values()];
    if (!this.seedComplete) {
      const files = this.markdown();
      if (files.length > 0 && files.every(f => this.app.metadataCache.getFileCache(f) !== null)) {
        this.paths = new Set(files.map(f => f.path)); this.indexed.clear(); this.pendingPropertyPaths = new Set(this.paths); this.index.seed([...this.paths]); this.seedComplete = true;
      }
    }
    return this.index.snapshot();
  }
  *values(): IterableIterator<FactRow> { if (!this.streaming) { yield* this.index.values(); return; } for (const path of this.paths) { const row = this.read(path); if (row) yield row; } }
  configure(declaration: GraphDeclaration) {
    if (JSON.stringify(declaration) !== JSON.stringify(this.declaration)) void this.purgeFacts();
    this.declaration = declaration; this.keys = declaredKeys(declaration);
    const excluded = (declaration.exclude ?? []).map(folderPath);
    if (excluded.join('\n') !== this.excluded.join('\n')) { this.excluded = excluded; this.invalidate(); }
  }
  async *columns(reset: boolean, options: IngestOptions): AsyncGenerator<{ columns: RowColumns; removed: string[]; reset: boolean }> {
    if (!this.declaration) throw new Error('Declared columns required');
    this.syncRooms(); await this.restoreFacts();
    // A cancelled generator can have partially changed the worker; its next pass resets it.
    reset ||= this.reloadRequired;
    if (reset) { this.paths = new Set(this.markdown().map(f => f.path)); this.indexed.clear(); this.pendingPropertyPaths = new Set(this.paths); for (const path of this.sent.keys()) if (!this.paths.has(path)) this.sent.delete(path); }
    const turn = this.epoch, source = this.propertySource;
    const current = () => { if (turn !== this.epoch || source !== this.propertySource) throw new Error('Property source changed'); };
    const pending = new Map(this.dirty), paths = reset ? [...this.paths] : [...pending.keys()];
    let batch: FactRow[] = [], removed: string[] = [], acknowledged: [string, string | undefined][] = [], start = performance.now(), first = reset, finished = false;
    const acknowledge = () => {
      current();
      for (const [path, stamp] of acknowledged) {
        if (stamp === undefined) this.sent.delete(path); else this.sent.set(path, stamp);
        if (this.dirty.get(path) === pending.get(path)) this.dirty.delete(path);
      }
      acknowledged = [];
    };
    this.ingesting = true;
    try {
      for (const path of paths) {
        current();
        const row = this.read(path); if (row) batch.push(row); else removed.push(path); acknowledged.push([path, this.stamp(row)]);
        if (batch.length + removed.length >= options.chunkRows || performance.now() - start >= options.budgetMs) {
          yield { columns: packRows(batch, this.declaration), removed, reset: first };
          // Resuming acknowledges only this epoch and version of each dirty path.
          acknowledge(); first = false;
          batch = []; removed = []; await yieldTask(); start = performance.now();
        }
      }
      if (batch.length || removed.length || first) { yield { columns: packRows(batch, this.declaration), removed, reset: first }; acknowledge(); await yieldTask(); }
      // Compare only acknowledged rows: a mid-batch revert must not be lost.
      // Bound this audit too, so hydration cannot block camera input.
      await sliced([...this.dirty.keys()], options, path => {
        current(); if (this.stamp(this.read(path)) === this.sent.get(path)) this.dirty.delete(path);
      });
      current(); this.reloadRequired = false;
      this.seedComplete = this.indexed.size === this.paths.size;
      if (this.seedComplete && [...this.paths].every(path => Object.hasOwn(this.app.metadataCache.resolvedLinks, path))) this.linksResolved = true;
      this.sentComplete = this.factsComplete(); finished = true;
    } catch (error) {
      current(); if (!this.savedFacts.size) throw error;
      this.rejectSaved(error);
      yield* this.columns(true, options); finished = true;
    } finally {
      this.ingesting = false;
      if (!finished) this.invalidate();
      else if (this.dirty.size) this.onChange(new Set(this.dirty.keys()));
    }
  }
  /** Native resolver bursts share a paced, epoch-bound pending-path audit.
   * A task yield alone can starve host indexing; explicit verification bypasses
   * the debounce wait. New facts still take ordinary acknowledged ingestion. */
  verifyProperties(options: IngestOptions, refresh = false): Promise<boolean> {
    this.propertyAuditAgain = true; this.propertyAuditRefresh ||= refresh;
    if (!refresh) { this.propertyAuditImmediate = true; this.propertyAuditWake?.(); }
    if (this.propertyAudit) return this.propertyAudit;
    const turn = this.epoch;
    return this.propertyAudit = Promise.resolve().then(async () => {
      do {
        if (turn !== this.epoch) break;
        if (this.propertyAuditRefresh && !this.propertyAuditImmediate) await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); this.propertyAuditWake = undefined; resolve(); };
          const timer = setTimeout(done, Math.min(this.debounceMs, 1000)); this.propertyAuditWake = done;
        });
        if (turn !== this.epoch) break;
        const refresh = this.propertyAuditRefresh; this.propertyAuditRefresh = this.propertyAuditAgain = this.propertyAuditImmediate = false;
        await sliced([...this.pendingPropertyPaths], options, path => {
          // Native events own their pending debounce slot before the adapter sees
          // a dirty version. Do not reread or reschedule those same worker updates.
          if (turn !== this.epoch || !this.pendingPropertyPaths.has(path) || this.dirty.has(path) || this.index.hasPending(path)) return;
          // Native-only misses need no row allocation, serialization or hashing.
          // A selected property source keeps its existing read/verification rules.
          if (refresh && !this.propertySource) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile && this.app.metadataCache.getFileCache(file) == null) return;
          }
          if (refresh || !this.indexed.has(path)) {
            if (this.ingesting || this.stamp(this.read(path)) !== this.sent.get(path)) {
              this.dirty.set(path, ++this.changeVersion);
              this.pendingPropertyPaths.add(path); this.indexed.delete(path); this.index.change(path);
            }
          } else this.read(path);
        });
      } while (this.propertyAuditAgain && turn === this.epoch);
      return turn === this.epoch;
    }).finally(() => { this.propertyAudit = undefined; });
  }
  coverage() { return { indexed: this.indexed.size, listed: this.paths.size }; }
  linksPending() { return this.declaration?.edges.some(e => e.kind === 'producer' && (e.producer !== this.producer || !this.linksResolved)) ?? false; }
  pendingProperties() { return this.pendingPropertyPaths.size; }
  factsComplete() { return this.pendingPropertyPaths.size === 0 && !this.linksPending(); }
  private read(path: string): FactRow | undefined {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md' || !this.kept(path)) { this.indexed.delete(path); if (this.paths.has(path)) this.pendingPropertyPaths.add(path); else this.pendingPropertyPaths.delete(path); return undefined; }
    const fact = this.propertySource?.get(path);
    const usable = fact?.source === 'derived' && fact.state === 'current' && !fact.parseError && !fact.truncated;
    const cache = usable ? null : this.app.metadataCache.getFileCache(file);
    if (usable || cache != null) this.indexed.add(path); else this.indexed.delete(path);
    if (usable ? fact.verified === true : cache != null) this.pendingPropertyPaths.delete(path); else this.pendingPropertyPaths.add(path);
    if (!usable && cache == null && !fact && this.savedFacts.has(path) && (!this.propertySource || this.savedOwners.has(path) && this.route(path)?.id === this.savedOwners.get(path))) return this.savedFacts.get(path);
    this.forget(path);
    const fm = (usable ? fact.frontmatter : cache?.frontmatter) ?? {}, properties = Object.create(null) as Record<string, unknown>;
    for (const key of this.keys ?? Object.keys(fm)) if (key !== 'position' && Object.hasOwn(fm, key)) properties[key] = fm[key];
    // Derived properties never invent the declared native producer's targets.
    const links = !this.declaration || this.declaration.edges.some(e => e.kind === 'producer' && e.producer === this.producer)
      ? { [this.producer]: Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {}).filter(p => p.endsWith('.md')).sort() } : undefined;
    return { path, properties, links };
  }
}
