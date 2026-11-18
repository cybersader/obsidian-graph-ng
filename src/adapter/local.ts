import { TFile, type TAbstractFile, type TFolder, type App, type Plugin } from 'obsidian';
import type { FactRow } from '../core/projection';
import { FactCache, factKey } from './fact-cache';
import { waitForView } from './latest-work';
import { IncrementalIndex } from './index';
import { hashEdge } from '../core/edge-hash';
import { digest, folderPath, type GraphDeclaration } from '../core/declaration';
import { declaredKeys, packRows, type RowColumns } from '../core/columns';
import { yieldTask, sliced, type IngestOptions } from '../core/scheduler';
export interface PropertySource {
  get(path: string): { source?: string; state?: string; verified?: boolean; frontmatter?: Record<string, unknown>; parseError?: unknown; truncated?: unknown } | undefined;
  load?(options?: { signal: AbortSignal }): Promise<unknown>;
  rooms?(): readonly RoomHandle[];
  roomFor?(path: string): RoomHandle | undefined;
}
interface RoomHandle { cacheIdentity?: string; generation?: number; verifiedComplete?: boolean }
interface RoomPartition { id: string; generation: number; ready: boolean; permit?: object; loaded?: boolean; lane?: SettlementLane }
interface SettlementLane { controller: AbortController; next?: () => Promise<void> }
function retireLane(room: RoomPartition) {
  room.permit = undefined;
  if (room.lane) { room.lane.next = undefined; room.lane.controller.abort(); room.lane = undefined; }
}
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
  private forget(path: string) {
    const id = this.savedOwners.get(path), charge = id && this.charges.get(id);
    if (charge && --charge.rows === 0) {
      this.roomBudget.bytes -= charge.bytes; this.roomBudget.parts -= charge.parts; this.charges.delete(id!);
    }
    this.savedFacts.delete(path); this.savedOwners.delete(path);
  }
  private storageError(error: unknown) { this.cacheStatus = 'unavailable'; this.factError = String(error); }
  private charges = new Map<string, { bytes: number; parts: number; rows: number }>();
  private roomBudget = { bytes: 0, parts: 0 };
  private pruned = false;
  private unknownRooms = false;
  inventoryError = '';
  private inventory() {
    try { const handles = this.propertySource?.rooms?.(); this.inventoryError = ''; return this.partitioned && Array.isArray(handles) ? handles as RoomHandle[] : undefined; }
    catch (error) { this.inventoryError = String(error); return undefined; }
  }
  private prune(background = false) {
    const source = this.propertySource, turn = this.cacheTurn, cache = this.cache!;
    const current = () => source === this.propertySource && turn === this.cacheTurn && !cache.paused;
    const inventory = () => this.inventory()?.filter(validRoom).map(h => h.cacheIdentity!);
    const failed = (error: unknown) => { if (current()) this.storageError(error); };
    return cache.prunePartitions(inventory, current, background ? failed : undefined)?.catch(failed);
  }
  // Unknown inventory disables replay and settlement; it never proves absence on disk.
  syncRooms() {
    const handles = this.inventory(), active = new Set<string>(), replaced = new Set<string>(); let moved = false, retired = false;
    for (const h of handles ?? []) if (validRoom(h)) {
      const id = h.cacheIdentity!; active.add(id);
      let room = this.partitions.get(id);
      if (!room || room.generation !== h.generation) {
        if (room) { retireLane(room); replaced.add(id); } else moved = true;
        this.partitions.set(id, room = { id, generation: h.generation!, ready: false });
      }
      room.ready = h.verifiedComplete === true;
      if (!room.ready) retireLane(room);
    }
    for (const [id, room] of this.partitions) if (!active.has(id)) {
      retireLane(room); this.partitions.delete(id); moved = retired = true;
    }
    if ((retired || this.unknownRooms) && handles?.length && this.cache && !this.cache.paused) this.prune(true);
    this.unknownRooms = !handles?.length;
    if (moved || replaced.size) for (const [path, id] of this.savedOwners) if (!active.has(id) || replaced.has(id)) { this.forget(path); this.index.change(path); }
    if (moved) this.roomRevision++;
  }
  // The first event owns the drain. Later callers return immediately, replacing
  // one pending action, never attaching another handler to a held acknowledgement.
  async onRoomSettled(detail: { cacheIdentity?: unknown; generation?: unknown } | undefined, options: IngestOptions, refresh: (signal: AbortSignal) => Promise<unknown>, promote: () => void) {
    const room = typeof detail?.cacheIdentity === 'string' ? this.partitions.get(detail.cacheIdentity) : undefined;
    if (!room?.ready || room.generation !== detail?.generation) return;
    const permit = room.permit = {};
    const current = () => this.partitions.get(room.id) === room && room.permit === permit;
    const existing = room.lane, lane: SettlementLane = room.lane ??= { controller: new AbortController() };
    lane.next = async () => {
      let needsAck = this.reloadRequired || this.ingesting, flush = false;
      try {
        if (!current()) return;
        await sliced([...this.paths], options, path => {
          if (!current() || this.route(path, true) !== room) return;
          if (this.index.hasPending(path)) flush = true;
          else if (!this.dirty.has(path)) this.auditPath(path, false);
          if (this.dirty.has(path) || this.index.hasPending(path)) needsAck = true;
        });
        if (current() && needsAck) {
          if (flush) this.index.flush();
          const signal = lane.controller.signal, work = current() && refresh(signal);
          if (work) await waitForView(work, signal);
        }
        // A reset during the wait changes worker evidence, not room authority.
        // saveRoom checks the current acknowledged stamps in the new worker epoch.
        if (current()) await this.saveRoom(room, current);
        if (current()) promote();
      } catch (error) { if (current()) this.storageError(error); }
      finally { if (current()) room.permit = undefined; }
    };
    if (existing) return;
    try { while (lane.next) { const next: () => Promise<void> = lane.next; lane.next = undefined; await next(); } }
    finally { if (room.lane === lane) room.lane = undefined; }
  }
  private route(path: string, strict = false) {
    let h: RoomHandle | undefined;
    try { h = this.propertySource?.roomFor?.(path); } catch (e) { if (strict) throw e; }
    const room = h && this.partitions.get(h.cacheIdentity!);
    return room && h?.generation === room.generation ? room : undefined;
  }
  get savedCopy() { return this.savedFacts.size > 0; }
  private retireSaved() {
    this.cacheTurn++; this.factVersion++;
    for (const path of this.savedFacts.keys()) this.index.change(path);
    this.savedFacts.clear(); this.savedOwners.clear(); this.charges.clear(); this.roomBudget = { bytes: 0, parts: 0 };
    for (const room of this.partitions.values()) retireLane(room);
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
    if (this.partitioned && this.pruned && ![...this.partitions.values()].some(r => !r.loaded)) return Promise.resolve();
    if (this.restore) return this.restore;
    const partitioned = this.partitioned, work = (async () => {
      if (!this.cache || this.cache.paused) return;
      if (this.propertySource && !this.partitioned) { await this.purgeFacts(); return; }
      const turn = this.cacheTurn, source = this.propertySource, current = () => turn === this.cacheTurn && source === this.propertySource && !this.cache?.paused;
      try {
        if (source) {
          if (!this.pruned) { await this.prune(); if (!current()) return; this.pruned = true; this.syncRooms(); }
          const paths = new Map([...this.partitions.values()].filter(r => !r.loaded).map(room => [room, new Set<string>()]));
          // Fingerprint the whole resolution namespace once per restore pass,
          // and only if a manifest exists. Keep the room binding in the final digest.
          let namespace: string | undefined;
          const key = async (check: () => void, id: string) => digest([2, namespace ??= await this.cacheKey(check), id]);
          await sliced([...this.paths], { chunkRows: 256, budgetMs: 8 }, path => {
            if (!current()) return;
            const room = this.route(path); if (!room) return;
            paths.get(room)?.add(path);
          });
          for (const [room, group] of paths) {
            if (!current()) break;
            await this.loadRoom(room, group, current, key);
          }
          return;
        }
        const rows = await this.cache.load(check => this.cacheKey(check), current);
        if (!current() || !rows) { this.cacheStatus = 'miss'; return; }
        if ([...rows.keys()].some(p => !this.paths.has(p)) || rows.size !== this.paths.size) throw Error('Saved facts mismatch');
        this.savedFacts = rows; this.cacheStatus = 'restored';
      } catch (error) { if (current()) { if (source) this.storageError(error); else this.rejectSaved(error); } }
    })().finally(() => { if (partitioned && this.restore === work) this.restore = undefined; });
    return this.restore = work;
  }
  private async loadRoom(room: RoomPartition, paths: Set<string>, owned: () => boolean, key: (check: () => void, id: string) => Promise<string>) {
    const current = () => !!(owned() && this.partitions.get(room.id) === room && this.inventory()?.some(h => h.cacheIdentity === room.id && h.generation === room.generation));
    const before = { ...this.roomBudget }, admitted = { ...before };
    try {
      const rows = await this.cache!.load(check => key(check, room.id), current, room.id, admitted);
      if (!owned()) return;
      this.syncRooms(); if (!current()) return; room.loaded = true; if (!rows) return;
      if (rows.size !== paths.size || [...rows.keys()].some(p => !paths.has(p) || this.route(p) !== room)) throw Error('Saved facts mismatch');
      for (const path of rows.keys()) this.forget(path);
      if (rows.size) {
        const bytes = admitted.bytes - before.bytes, parts = admitted.parts - before.parts;
        this.charges.set(room.id, { bytes, parts, rows: rows.size }); this.roomBudget.bytes += bytes; this.roomBudget.parts += parts;
      }
      for (const [path, row] of rows) { this.savedFacts.set(path, row); this.savedOwners.set(path, room.id); }
      this.cacheStatus = 'restored';
    } catch (error) { if (current()) { room.loaded = true; this.storageError(error); await this.cache!.dropPartition(room.id, current).catch(error => this.storageError(error)); } }
  }
  private async saveRoom(room: RoomPartition, permitted: () => boolean) {
    if (!this.cache || this.cache.paused || this.reloadRequired || this.ingesting) return;
    const version = this.factVersion, epoch = this.epoch;
    const current = () => epoch === this.epoch && version === this.factVersion && !this.cache?.paused && permitted();
    const paths = new Map<string, string>(), links = this.declaration?.edges.filter(e => e.kind === 'producer') ?? [];
    if (links.some(e => e.producer !== this.producer)) return;
    const confirmed = (path: string) => {
      if (this.dirty.has(path) || this.index.hasPending(path) || links.length && !Object.hasOwn(this.app.metadataCache.resolvedLinks, path)) return;
      const row = this.read(path, true);
      if (row && this.stamp(row) === this.sent.get(path)) return row;
      this.auditPath(path);
    };
    // No host routing revision exists. Recheck the exact set and the values
    // immediately on each side of the uncancellable publication operation.
    const commit = () => {
      this.syncRooms(); if (!current() || this.ingesting || this.reloadRequired) return false;
      for (const path of this.paths) if ((this.route(path, true) === room) !== paths.has(path) || paths.has(path) && (paths.get(path) !== this.sent.get(path) || !confirmed(path))) return false;
      return true;
    };
    try {
      let ready = true;
      await sliced([...this.paths], { chunkRows: 256, budgetMs: 8 }, path => {
        if (ready && current() && this.route(path, true) === room) { ready = !!confirmed(path); if (ready) paths.set(path, this.sent.get(path)!); }
      });
      if (!ready || !paths.size || !current()) return;
      function* rows() { for (const path of paths.keys()) { const row = confirmed(path); if (!row) throw Error('Room facts changed'); yield row; } }
      await this.cache.save(async check => digest([2, await this.cacheKey(check), room.id]), rows(), current, commit, room.id);
      if (current()) { this.cacheStatus = 'saved'; this.factError = ''; }
    } catch (error) { if (current()) this.storageError(error); }
  }
  async saveFacts() {
    if (this.propertySource) return;
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
    const text = JSON.stringify([row, this.indexed.has(row.path), this.propertySource ? true : !this.pendingPropertyPaths.has(row.path)]);
    // Two hash lanes plus length make accidental equality unlikely without retaining JSON rows.
    // Not an authenticity check: collisions can delay a notification, never change source facts.
    return `${text.length}:${hashEdge(text).join(':')}`;
  }
  invalidate(keepSaved = false, siblingsCurrent = false) { if (!keepSaved) this.retireSaved(); else if (!siblingsCurrent) { this.cacheTurn++; this.factVersion++; } this.epoch++; this.propertyAuditWake?.(); this.reloadRequired = true; this.seedComplete = false; this.indexed.clear(); this.pendingPropertyPaths = new Set(this.paths); this.sent.clear(); this.sentComplete = false; this.linksResolved = false; }
  setPropertySource(source?: PropertySource, startup = false, siblingsCurrent = false) {
    const same = source === this.propertySource, wasPartitioned = this.partitioned;
    if (!same) {
      for (const room of this.partitions.values()) retireLane(room);
      this.propertySource = source; this.restore = undefined; this.pruned = false;
      if (wasPartitioned && this.partitioned) {
        // Preserve partitions with equal bindings, but do not inherit a settled
        // event or asynchronous work from the previous provider object.
        for (const [id, room] of this.partitions) this.partitions.set(id, { ...room, permit: undefined });
      } else {
        this.partitions.clear();
        if (!startup || !this.partitioned) void this.purgeFacts();
      }
    }
    if (same && !siblingsCurrent) for (const room of this.partitions.values()) room.permit = undefined;
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
      this.ingesting = false; this.sentComplete = this.factsComplete(); finished = true;
    } catch (error) {
      current(); if (!this.savedFacts.size) throw error;
      this.rejectSaved(error);
      yield* this.columns(true, options); finished = true;
    } finally {
      this.ingesting = false;
      if (!finished) this.invalidate(this.partitioned);
      else if (this.dirty.size) this.onChange(new Set(this.dirty.keys()));
    }
  }
  private auditPath(path: string, notify = true) {
    if (this.ingesting || this.stamp(this.read(path)) !== this.sent.get(path)) {
      this.dirty.set(path, ++this.changeVersion); this.pendingPropertyPaths.add(path); this.indexed.delete(path); if (notify) this.index.change(path);
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
          if (refresh || this.propertySource || !this.indexed.has(path)) this.auditPath(path);
          else this.read(path);
        });
      } while (this.propertyAuditAgain && turn === this.epoch);
      return turn === this.epoch;
    }).finally(() => { this.propertyAudit = undefined; });
  }
  coverage() { return { indexed: this.indexed.size, listed: this.paths.size }; }
  linksPending() { return this.declaration?.edges.some(e => e.kind === 'producer' && (e.producer !== this.producer || !this.linksResolved)) ?? false; }
  pendingProperties() { return this.pendingPropertyPaths.size; }
  factsComplete() { return this.pendingPropertyPaths.size === 0 && !this.linksPending() && (!this.propertySource || !this.ingesting && !this.dirty.size); }
  private read(path: string, verifiedDerived = false): FactRow | undefined {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md' || !this.kept(path)) { this.indexed.delete(path); if (this.paths.has(path)) this.pendingPropertyPaths.add(path); else this.pendingPropertyPaths.delete(path); return undefined; }
    const fact = this.propertySource?.get(path);
    const usable = fact?.source === 'derived' && fact.state === 'current' && !fact.parseError && !fact.truncated;
    if (verifiedDerived && (!usable || fact.verified !== true)) return;
    const cache = usable ? null : this.app.metadataCache.getFileCache(file);
    if (!verifiedDerived) {
      if (usable || cache != null) this.indexed.add(path); else this.indexed.delete(path);
      if (usable ? fact.verified === true : cache != null) this.pendingPropertyPaths.delete(path); else this.pendingPropertyPaths.add(path);
    }
    if (!usable && cache == null && !fact && this.savedFacts.has(path) && (!this.propertySource || this.savedOwners.has(path) && this.route(path)?.id === this.savedOwners.get(path))) return this.savedFacts.get(path);
    if (!verifiedDerived) this.forget(path);
    const fm = (usable ? fact.frontmatter : cache?.frontmatter) ?? {}, properties = Object.create(null) as Record<string, unknown>;
    for (const key of this.keys ?? Object.keys(fm)) if (key !== 'position' && Object.hasOwn(fm, key)) properties[key] = fm[key];
    // Derived properties never invent the declared native producer's targets.
    const links = !this.declaration || this.declaration.edges.some(e => e.kind === 'producer' && e.producer === this.producer)
      ? { [this.producer]: Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {}).filter(p => p.endsWith('.md')).sort() } : undefined;
    return { path, properties, links };
  }
}
