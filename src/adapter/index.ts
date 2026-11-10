import type { FactRow } from '../core/projection';
/** File events patch this table; a debounced listener observes each coherent batch. */
export class IncrementalIndex {
  private rows = new Map<string, FactRow>();
  private dirty = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private read: (path: string) => FactRow | undefined, private emit: (changed: Set<string>) => void, readonly debounceMs: number) {}
  seed(paths: string[]) { for (const path of paths) { const row = this.read(path); if (row) this.rows.set(path, row); } }
  change(path: string) {
    const row = this.read(path); if (row) this.rows.set(path, row); else this.rows.delete(path);
    this.dirty.add(path); this.schedule();
  }
  remove(path: string) { this.rows.delete(path); this.dirty.add(path); this.schedule(); }
  rename(oldPath: string, newPath: string) { this.remove(oldPath); this.change(newPath); }
  snapshot(): FactRow[] { return [...this.rows.values()]; }
  flush() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; if (this.dirty.size) { const changed = this.dirty; this.dirty = new Set(); this.emit(changed); } }
  dispose() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.dirty.clear(); }
  private schedule() { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), this.debounceMs); }
}
