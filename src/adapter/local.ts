import { TFile, type App, type Plugin } from 'obsidian';
import type { FactRow } from '../core/projection';
import { IncrementalIndex } from './index';
export class LocalAdapter {
  readonly index: IncrementalIndex;
  private seedComplete = false;
  constructor(readonly app: App, plugin: Plugin, readonly producer: string, debounceMs: number, onChange: (changed: Set<string>) => void) {
    this.index = new IncrementalIndex(path => this.read(path), onChange, debounceMs);
    const files = app.vault.getMarkdownFiles();
    this.index.seed(files.map(f => f.path));
    this.seedComplete = files.length > 0 && files.every(f => app.metadataCache.getFileCache(f) !== null);
    plugin.registerEvent(app.metadataCache.on('changed', file => this.index.change(file.path)));
    plugin.registerEvent(app.metadataCache.on('resolve', file => this.index.change(file.path)));
    plugin.registerEvent(app.metadataCache.on('resolved', () => { for (const f of app.vault.getMarkdownFiles()) this.index.change(f.path); }));
    plugin.registerEvent(app.vault.on('create', file => { if (file instanceof TFile && file.extension === 'md') this.index.change(file.path); }));
    plugin.registerEvent(app.vault.on('delete', file => {
      this.index.remove(file.path);
      if (!(file instanceof TFile)) for (const row of this.index.snapshot()) if (row.path.startsWith(`${file.path}/`)) this.index.remove(row.path);
    }));
    plugin.registerEvent(app.vault.on('rename', (file, old) => {
      if (file instanceof TFile) this.index.rename(old, file.path);
      else for (const row of this.index.snapshot()) if (row.path.startsWith(`${old}/`)) this.index.remove(row.path);
      // Public resolver targets may change on rename; refresh link columns without body reads.
      for (const f of app.vault.getMarkdownFiles()) this.index.change(f.path);
    }));
    plugin.register(() => this.index.dispose());
  }
  snapshot(): FactRow[] {
    // Restored views may open after the host cache fills but before its debounced
    // resolved-event batch replaces rows seeded during plugin startup.
    if (!this.seedComplete) {
      const files = this.app.vault.getMarkdownFiles();
      if (files.length > 0 && files.every(f => this.app.metadataCache.getFileCache(f) !== null)) {
        this.index.seed(files.map(f => f.path));
        this.seedComplete = true;
      }
    }
    return this.index.snapshot();
  }
  coverage() {
    const files = this.app.vault.getMarkdownFiles();
    return { indexed: files.filter(f => this.app.metadataCache.getFileCache(f) !== null).length, listed: files.length };
  }
  private read(path: string): FactRow | undefined {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') return undefined;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const properties = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(fm)) if (key !== 'position') properties[key] = value;
    return { path, properties, links: { [this.producer]: Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {}).filter(p => p.endsWith('.md')) } };
  }
}
