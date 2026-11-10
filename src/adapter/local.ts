import { TFile, type TAbstractFile, type TFolder, type App, type Plugin } from 'obsidian';
import type { FactRow } from '../core/projection';
import { IncrementalIndex } from './index';
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
  linksResolved = false;
  constructor(readonly app: App, plugin: Plugin, readonly producer: string, debounceMs: number, onChange: (changed: Set<string>) => void) {
    this.index = new IncrementalIndex(path => this.read(path), onChange, debounceMs);
    const files = app.vault.getMarkdownFiles();
    this.paths = new Set(files.map(f => f.path));
    this.index.seed([...this.paths]);
    this.seedComplete = files.length > 0 && this.indexed.size === files.length;
    this.linksResolved = files.every(f => Object.hasOwn(app.metadataCache.resolvedLinks, f.path));
    const change = (file: TFile) => { if (file.extension === 'md') { this.paths.add(file.path); this.linksResolved = false; this.index.change(file.path); } };
    plugin.registerEvent(app.metadataCache.on('changed', change));
    plugin.registerEvent(app.metadataCache.on('resolve', file => { if (file.extension === 'md') this.index.change(file.path); }));
    // The public resolver has already emitted each affected source via `resolve`.
    plugin.registerEvent(app.metadataCache.on('resolved', () => { const wasReady = this.linksResolved; this.linksResolved = true; if (!wasReady) this.index.notify(); }));
    plugin.registerEvent(app.vault.on('create', file => { for (const child of markdownFiles(file)) change(child); }));
    plugin.registerEvent(app.vault.on('modify', file => { if (file instanceof TFile) change(file); }));
    plugin.registerEvent(app.vault.on('delete', file => {
      this.linksResolved = false;
      for (const child of markdownFiles(file)) { this.paths.delete(child.path); this.indexed.delete(child.path); this.index.remove(child.path); }
    }));
    plugin.registerEvent(app.vault.on('rename', (file, old) => {
      this.linksResolved = false;
      if (file instanceof TFile) {
        this.paths.delete(old); this.indexed.delete(old); this.index.remove(old);
        if (file.extension === 'md') { this.paths.add(file.path); this.index.change(file.path); }
        return;
      }
      for (const child of markdownFiles(file)) {
        const previous = old + child.path.slice(file.path.length);
        this.paths.delete(previous); this.indexed.delete(previous); this.paths.add(child.path);
        this.index.rename(previous, child.path);
      }
    }));
    plugin.register(() => this.index.dispose());
  }
  snapshot(): FactRow[] {
    // One startup reconciliation, not a vault rescan on every edit/resolver batch.
    if (!this.seedComplete) {
      const files = this.app.vault.getMarkdownFiles();
      if (files.length > 0 && files.every(f => this.app.metadataCache.getFileCache(f) !== null)) {
        this.paths = new Set(files.map(f => f.path)); this.indexed.clear(); this.index.seed([...this.paths]); this.seedComplete = true;
      }
    }
    return this.index.snapshot();
  }
  values(): IterableIterator<FactRow> { return this.index.values(); }
  coverage() { return { indexed: this.indexed.size, listed: this.paths.size }; }
  private read(path: string): FactRow | undefined {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') { this.indexed.delete(path); return undefined; }
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache !== null) this.indexed.add(path); else this.indexed.delete(path);
    const fm = cache?.frontmatter ?? {}, properties = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(fm)) if (key !== 'position') properties[key] = value;
    return { path, properties, links: { [this.producer]: Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {}).filter(p => p.endsWith('.md')).sort() } };
  }
}
