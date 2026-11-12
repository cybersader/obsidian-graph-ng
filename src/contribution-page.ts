import { pairKey, type GroupProjection, type GroupContribution } from './core/group-projection';
/** `view` is the worker view generation the graph/values came from; `source` names the grouping. */
export interface ContributionContext { active: number; groups: number; detail: number; level: number; projection?: { groups: { values: string[] }[] }; graph?: GroupProjection; values?: readonly string[]; view?: number; source?: string }
export interface ContributionResult { total: number; items: GroupContribution[] }
/** A selected relationship is an intent captured from the clicked summary, never
 * a dictionary index to reinterpret against a different cached/live source. */
export class ContributionPage {
  selection?: { a: string; b: string; revision: number; keys?: [string, string]; labels?: [string, string]; source?: string; stale?: boolean };
  status: 'loading' | 'refreshing' | 'ready' | 'error' = 'loading';
  message = '';
  offset = 0;
  result?: ContributionResult;
  edge?: GroupProjection['groupEdges'][number];
  private token = 0;
  private bound = '';
  constructor(public size: number, private read: (revision: number, pair: string, offset: number, count: number, view: number) => Promise<ContributionResult>, private changed: () => void) {}
  clear() { this.token++; this.bound = ''; this.selection = undefined; this.result = undefined; this.edge = undefined; }
  select(a: string, b: string, revision: number, graph: GroupProjection | undefined, source?: string) {
    this.clear();
    const left = graph?.groups.find(g => g.id === a), right = graph?.groups.find(g => g.id === b);
    this.selection = { a, b, revision, source,
      keys: left?.key !== undefined && right?.key !== undefined ? [left.key, right.key] : undefined,
      labels: left && right ? [left.label, right.label] : undefined };
    this.offset = 0; this.status = this.selection.keys ? 'loading' : 'refreshing';
    this.message = this.selection.keys ? 'Loading contributing mappings…' : 'Refreshing contributing mappings…';
    this.changed();
  }
  suspend() {
    if (!this.selection) return;
    this.token++; this.bound = ''; this.result = undefined; this.edge = undefined;
    this.status = 'refreshing'; this.message = 'Refreshing contributing mappings…'; this.changed();
  }
  fail(message: string) { if (!this.selection) return; this.token++; this.bound = ''; this.status = 'error'; this.message = message; this.changed(); }
  move(delta: number, context: ContributionContext) { this.offset = Math.max(0, this.offset + delta * this.size); this.bound = ''; this.update(context); }
  retry(context: ContributionContext) { this.bound = ''; this.update(context); }
  update(context: ContributionContext) {
    const s = this.selection; if (!s || s.stale) return;
    // A relationship belongs to one grouping. A regroup or derived source never
    // reinterprets it; a filter change (same source) re-resolves it by raw keys.
    if (s.source !== undefined && context.source !== undefined && s.source !== context.source) {
      s.stale = true; this.token++; this.bound = ''; this.result = undefined; this.edge = undefined;
      this.status = 'error'; this.message = 'Grouping changed; select a relationship in the current graph.'; this.changed(); return;
    }
    if (!context.projection || !context.graph || context.active !== context.groups || context.active !== context.detail) { this.suspend(); return; }
    const bound = `${context.active}:${context.view ?? -1}`;
    if (this.bound === bound) return;
    // A runtime group-by supplies its own raw dictionary; otherwise the declared level.
    const values = context.values ?? context.projection.groups[context.level]?.values ?? ['All notes'];
    // Legacy keyless paint is display-only. Resolve its captured labels only in a
    // fresh keyed summary, and only when each label has one unambiguous raw key.
    // Missing/duplicate labels remain refreshing; numeric IDs never cross sources.
    if (!s.keys && s.labels) {
      const unique = (label: string) => { const matches = context.graph!.groups.filter(g => g.label === label); return matches.length === 1 ? matches[0]!.key : undefined; };
      const a = unique(s.labels[0]), b = unique(s.labels[1]);
      if (a !== undefined && b !== undefined && (s.a === s.b || a !== b)) s.keys = [a, b];
    }
    if (!s.keys) { this.suspend(); this.message = 'Refreshing contributing mappings: waiting for unambiguous group keys. Select a fresh relationship if groups changed.'; this.changed(); return; }
    const a = values.indexOf(s.keys[0]), b = values.indexOf(s.keys[1]);
    const pair = pairKey(String(a), String(b));
    this.edge = a < 0 || b < 0 ? undefined : context.graph.groupEdges.find(e => pairKey(e.a, e.b) === pair);
    if (!this.edge) { this.fail('This relationship is no longer present in the current projection.'); return; }
    const token = ++this.token, revision = context.active;
    this.bound = bound; this.result = undefined; this.status = 'loading'; this.message = 'Loading contributing mappings…'; this.changed();
    void this.read(revision, pair, this.offset, this.size, context.view ?? -1).then(result => {
      if (token !== this.token || !this.selection) return;
      this.result = result; this.status = 'ready'; this.message = result.total ? '' : 'No contributing mappings in this projection.'; this.changed();
    }, error => {
      if (token !== this.token || !this.selection) return;
      // The worker moved to a newer view than this context: wait for it, never show stale data.
      if (String(error).includes('View generation changed')) { this.bound = ''; this.status = 'refreshing'; this.message = 'Refreshing contributing mappings…'; this.changed(); return; }
      this.status = 'error'; this.message = `Could not load contributing mappings: ${String(error)}`; this.changed();
    });
  }
}
