import type { FactRow } from '../core/projection';
/** Events queue path deltas. Each dirty path is read at most once per debounced batch. */
export class IncrementalIndex {
  private rows = new Map<string, FactRow>();
  private dirty = new Set<string>();
  private pending = new Set<string>();
  private notification = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private read: (path: string) => FactRow | undefined, private emit: (changed: Set<string>) => void, readonly debounceMs: number) {}
  seed(paths: string[]) { for (const path of paths) { const row = this.read(path); if (row) this.rows.set(path, row); } }
  change(path: string) { this.pending.add(path); this.dirty.add(path); this.schedule(); }
  remove(path: string) { this.rows.delete(path); this.pending.delete(path); this.dirty.add(path); this.schedule(); }
  rename(oldPath: string, newPath: string) { this.remove(oldPath); this.change(newPath); }
  snapshot(): FactRow[] { return [...this.rows.values()]; }
  values(): IterableIterator<FactRow> { return this.rows.values(); }
  notify() { this.notification = true; this.schedule(); }
  flush() {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    for (const path of this.pending) { const row = this.read(path); if (row) this.rows.set(path, row); else this.rows.delete(path); }
    this.pending.clear();
    if (this.dirty.size || this.notification) { const changed = this.dirty; this.dirty = new Set(); this.notification = false; this.emit(changed); }
  }
  dispose() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.dirty.clear(); this.pending.clear(); this.notification = false; }
  private schedule() { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), this.debounceMs); }
}
