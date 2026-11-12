import { TFile, type TAbstractFile, type TFolder, type App, type Plugin } from 'obsidian';
import type { FactRow } from '../core/projection';
import { IncrementalIndex } from './index';
import type { GraphDeclaration } from '../core/declaration';
import { declaredKeys, packRows, type RowColumns } from '../core/columns';
import { yieldTask, type IngestOptions } from '../core/scheduler';
export interface PropertySource {
  get(path: string): { source?: string; state?: string; verified?: boolean; frontmatter?: Record<string, unknown>; parseError?: unknown; truncated?: unknown } | undefined;
  load?(): Promise<unknown>;
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
  private seedComplete = false;
  private paths = new Set<string>();
  private indexed = new Set<string>();
  private propertyVerified = new Set<string>();
  private epoch = 0;
  linksResolved = false;
  private dirty = new Map<string, number>();
  private changeVersion = 0;
  private reloadRequired = true;
  invalidate() { this.epoch++; this.reloadRequired = true; this.seedComplete = false; this.indexed.clear(); this.propertyVerified.clear(); this.linksResolved = false; }
  setPropertySource(source?: PropertySource) { this.propertySource = source; this.invalidate(); }
  private declaration?: GraphDeclaration;
  private keys?: string[];
  constructor(readonly app: App, plugin: Plugin, readonly producer: string, debounceMs: number, onChange: (changed: Set<string>) => void, private streaming = false, declaration?: GraphDeclaration, private propertySource?: PropertySource) {
    this.declaration = declaration; this.keys = declaration ? declaredKeys(declaration) : undefined;
    this.index = new IncrementalIndex(path => this.streaming ? undefined : this.read(path), changed => { for (const path of changed) { this.dirty.set(path, ++this.changeVersion); if (this.streaming) { this.indexed.delete(path); this.propertyVerified.delete(path); } } onChange(changed); }, debounceMs);
    const files = app.vault.getMarkdownFiles();
    this.paths = new Set(files.map(f => f.path));
    if (!this.streaming) this.index.seed([...this.paths]);
    this.seedComplete = files.length > 0 && this.indexed.size === files.length;
    this.linksResolved = files.every(f => Object.hasOwn(app.metadataCache.resolvedLinks, f.path));
    const change = (file: TFile) => { if (file.extension === 'md') { this.paths.add(file.path); this.linksResolved = false; this.index.change(file.path); } };
    plugin.registerEvent(app.metadataCache.on('changed', change));
    plugin.registerEvent(app.metadataCache.on('resolve', file => { if (file.extension === 'md') this.index.change(file.path); }));
    // Property coverage cannot substitute for the native resolver's per-source readiness.
    plugin.registerEvent(app.metadataCache.on('resolved', () => { const wasReady = this.linksResolved; this.linksResolved = !this.streaming || (this.indexed.size === this.paths.size && (!this.propertySource || [...this.paths].every(path => Object.hasOwn(app.metadataCache.resolvedLinks, path)))); if (!wasReady && this.linksResolved) this.index.notify(); }));
    plugin.registerEvent(app.vault.on('create', file => { for (const child of markdownFiles(file)) change(child); }));
    plugin.registerEvent(app.vault.on('modify', file => { if (file instanceof TFile) change(file); }));
    plugin.registerEvent(app.vault.on('delete', file => {
      this.linksResolved = false;
      for (const child of markdownFiles(file)) { this.paths.delete(child.path); this.indexed.delete(child.path); this.propertyVerified.delete(child.path); this.index.remove(child.path); }
    }));
    plugin.registerEvent(app.vault.on('rename', (file, old) => {
      this.linksResolved = false;
      if (file instanceof TFile) {
        this.paths.delete(old); this.indexed.delete(old); this.propertyVerified.delete(old); this.index.remove(old);
        if (file.extension === 'md') { this.paths.add(file.path); this.index.change(file.path); }
        return;
      }
      for (const child of markdownFiles(file)) {
        const previous = old + child.path.slice(file.path.length);
        this.paths.delete(previous); this.indexed.delete(previous); this.propertyVerified.delete(previous); this.paths.add(child.path);
        this.index.rename(previous, child.path);
      }
    }));
    plugin.register(() => this.index.dispose());
  }
  snapshot(): FactRow[] {
    // One startup reconciliation, not a vault rescan on every edit/resolver batch.
    if (this.streaming) return [...this.values()];
    if (!this.seedComplete) {
      const files = this.app.vault.getMarkdownFiles();
      if (files.length > 0 && files.every(f => this.app.metadataCache.getFileCache(f) !== null)) {
        this.paths = new Set(files.map(f => f.path)); this.indexed.clear(); this.propertyVerified.clear(); this.index.seed([...this.paths]); this.seedComplete = true;
      }
    }
    return this.index.snapshot();
  }
  *values(): IterableIterator<FactRow> { if (!this.streaming) { yield* this.index.values(); return; } for (const path of this.paths) { const row = this.read(path); if (row) yield row; } }
  configure(declaration: GraphDeclaration) { this.declaration = declaration; this.keys = declaredKeys(declaration); }
  async *columns(reset: boolean, options: IngestOptions): AsyncGenerator<{ columns: RowColumns; removed: string[]; reset: boolean }> {
    if (!this.declaration) throw new Error('Declared columns required');
    // A cancelled generator can have partially changed the worker; its next pass resets it.
    reset ||= this.reloadRequired;
    if (reset) { this.paths = new Set(this.app.vault.getMarkdownFiles().map(f => f.path)); this.indexed.clear(); this.propertyVerified.clear(); }
    const turn = this.epoch, source = this.propertySource;
    const current = () => { if (turn !== this.epoch || source !== this.propertySource) throw new Error('Property source changed'); };
    const pending = new Map(this.dirty), paths = reset ? [...this.paths] : [...pending.keys()];
    let batch: FactRow[] = [], removed: string[] = [], acknowledged: string[] = [], start = performance.now(), first = reset, finished = false;
    const acknowledge = () => {
      current();
      for (const path of acknowledged) if (this.dirty.get(path) === pending.get(path)) this.dirty.delete(path);
      acknowledged = [];
    };
    try {
      for (const path of paths) {
        current();
        const row = this.read(path); if (row) batch.push(row); else removed.push(path); acknowledged.push(path);
        if (batch.length + removed.length >= options.chunkRows || performance.now() - start >= options.budgetMs) {
          yield { columns: packRows(batch, this.declaration), removed, reset: first };
          // Resuming acknowledges only this epoch and version of each dirty path.
          acknowledge(); first = false;
          batch = []; removed = []; await yieldTask(); start = performance.now();
        }
      }
      if (batch.length || removed.length || first) { yield { columns: packRows(batch, this.declaration), removed, reset: first }; acknowledge(); await yieldTask(); }
      current();
      this.reloadRequired = false;
      this.seedComplete = this.indexed.size === this.paths.size;
      if (this.seedComplete && [...this.paths].every(path => Object.hasOwn(this.app.metadataCache.resolvedLinks, path))) this.linksResolved = true;
      finished = true;
    } finally { if (!finished) this.invalidate(); }
  }
  /** Coverage-only audit: verification cannot change worker rows or their generation. */
  async verifyProperties(options: IngestOptions) {
    const turn = this.epoch; let count = 0, start = performance.now();
    for (const path of this.indexed) {
      if (turn !== this.epoch) return false;
      if (!this.propertyVerified.has(path)) this.read(path);
      if (++count >= options.chunkRows || performance.now() - start >= options.budgetMs) { await yieldTask(); count = 0; start = performance.now(); }
    }
    return turn === this.epoch;
  }
  coverage() { return { indexed: this.indexed.size, listed: this.paths.size }; }
  linksPending() { return this.declaration?.edges.some(e => e.kind === 'producer' && (e.producer !== this.producer || !this.linksResolved)) ?? false; }
  factsComplete() { return this.propertyVerified.size === this.paths.size && !this.linksPending(); }
  private read(path: string): FactRow | undefined {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') { this.indexed.delete(path); this.propertyVerified.delete(path); return undefined; }
    const fact = this.propertySource?.get(path);
    const usable = fact?.source === 'derived' && fact.state === 'current' && !fact.parseError && !fact.truncated;
    const cache = usable ? null : this.app.metadataCache.getFileCache(file);
    if (usable || cache != null) this.indexed.add(path); else this.indexed.delete(path);
    if (usable ? fact.verified === true : cache != null) this.propertyVerified.add(path); else this.propertyVerified.delete(path);
    const fm = (usable ? fact.frontmatter : cache?.frontmatter) ?? {}, properties = Object.create(null) as Record<string, unknown>;
    for (const key of this.keys ?? Object.keys(fm)) if (key !== 'position' && Object.hasOwn(fm, key)) properties[key] = fm[key];
    // Derived properties never invent the declared native producer's targets.
    const links = !this.declaration || this.declaration.edges.some(e => e.kind === 'producer' && e.producer === this.producer)
      ? { [this.producer]: Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {}).filter(p => p.endsWith('.md')).sort() } : undefined;
    return { path, properties, links };
  }
}
