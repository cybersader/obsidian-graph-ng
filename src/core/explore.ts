import { checked, expressionGroup, lowerGroup, print } from './expr/engine';
import { canonical, canonicalPredicate, folderPath, validateDerivedGroup, validatePredicate, type FolderPath, type GraphDeclaration, type GroupSource, type Predicate } from './declaration';
import { describeTransform } from './derive';
import { filterNodes, type DictionaryColumn, type Projection } from './projection';
/** Runtime view state. Persisted in settings, never in frontmatter; every field is
 * a declared column, path segment, group key, rule name or relation type. */
export interface ExploreView {
  query: string;
  filters: Predicate[];
  /** null uses the tuning-selected declared group source. */
  group: GroupSource | null;
  hiddenGroups: string[];
  collapsedGroups: string[];
  hiddenColors: string[];
  hiddenTypes: string[];
}
export interface ViewCamera { x: number; y: number; ratio: number }
/** Reproducible bookmark: group sources are stored by definition, not list index,
 * and the camera is normalized to the deterministic layout bounds. */
export interface SavedView { name: string; view: ExploreView; camera: ViewCamera | null }
export const emptyView = (): ExploreView => ({ query: '', filters: [], group: null, hiddenGroups: [], collapsedGroups: [], hiddenColors: [], hiddenTypes: [] });
export const NO_COLOR = '(no rule)';
/** Persisted view limits, shared by validation and the panel's own input caps. */
export const VIEW_LIMITS = { query: 512, filters: 64, keys: 20000, keyLength: 4096, savedViews: 200, viewName: 120 } as const;
const strings = (v: unknown, name: string, max: number) => {
  if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || x.length > VIEW_LIMITS.keyLength)) throw new Error(`${name} must be at most ${max} strings of at most ${VIEW_LIMITS.keyLength} characters`);
};
function validateGroup(g: unknown): asserts g is GroupSource {
  if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error('Invalid group source');
  const o = g as Record<string, unknown>, keys = Object.keys(o);
  if (o.from === 'expr') { if (keys.some(k => !['from', 'expr'].includes(k)) || typeof o.expr !== 'string') throw new Error('Invalid expression group'); checked(o.expr); } else if (o.from === 'key') { if (keys.some(k => !['from', 'key'].includes(k)) || typeof o.key !== 'string' || !o.key.trim()) throw new Error('Invalid key group'); }
  else if (o.from === 'folder') {
    if (keys.some(k => !['from', 'depth', 'prefix'].includes(k)) || !Number.isSafeInteger(o.depth) || (o.depth as number) < 1 || (o.depth as number) > 64) throw new Error('Invalid folder group');
    if (o.prefix !== undefined) validatePredicate({ kind: 'folder', prefix: o.prefix });
  } else if (o.from === 'derived') validateDerivedGroup(o);
  else throw new Error('Invalid group source');
}
export function validateView(v: unknown): asserts v is ExploreView {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('View must be an object');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['query', 'filters', 'group', 'hiddenGroups', 'collapsedGroups', 'hiddenColors', 'hiddenTypes'].includes(k)) throw new Error(`Unknown view field: ${k}`);
  if (typeof o.query !== 'string' || o.query.length > VIEW_LIMITS.query) throw new Error(`query must be a string of at most ${VIEW_LIMITS.query} characters`);
  if (!Array.isArray(o.filters) || o.filters.length > VIEW_LIMITS.filters) throw new Error(`filters must be at most ${VIEW_LIMITS.filters} predicates`);
  for (const f of o.filters) validatePredicate(f);
  if (o.group !== null) validateGroup(o.group);
  for (const k of ['hiddenGroups', 'collapsedGroups', 'hiddenColors', 'hiddenTypes'] as const) strings(o[k], k, VIEW_LIMITS.keys);
}
export function validateSaved(v: unknown): asserts v is SavedView[] {
  if (!Array.isArray(v) || v.length > VIEW_LIMITS.savedViews) throw new Error(`savedViews must be at most ${VIEW_LIMITS.savedViews} entries`);
  const names = new Set<string>();
  for (const s of v) {
    if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).some(k => !['name', 'view', 'camera'].includes(k))) throw new Error('Invalid saved view');
    if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > VIEW_LIMITS.viewName || names.has(s.name)) throw new Error(`Saved view names must be unique, nonempty and at most ${VIEW_LIMITS.viewName} characters`);
    names.add(s.name); validateView(s.view);
    if (s.camera !== null && (!s.camera || typeof s.camera !== 'object' || Object.keys(s.camera).some((k: string) => !['x', 'y', 'ratio'].includes(k)) || ![s.camera.x, s.camera.y, s.camera.ratio].every(Number.isFinite) || s.camera.ratio <= 0)) throw new Error('Invalid saved camera');
  }
}
/** Settings form: folder strings become segments; arrays are copied, never aliased. */
export function canonicalView(v: ExploreView): ExploreView {
  const copy = structuredClone(v);
  copy.filters.forEach(canonicalPredicate);
  if (copy.group?.from === 'expr') copy.group.expr = print(checked(copy.group.expr));
  if (copy.group?.from === 'folder' && typeof copy.group.prefix === 'string') copy.group.prefix = folderPath(copy.group.prefix).split('/').filter(Boolean);
  return copy;
}
export const groupLabel = (g: GroupSource) => g.from === 'expr' ? `Expression: ${g.expr}` : g.from === 'key' ? `Property: ${g.key}` : g.from === 'derived' ? `Derived: ${g.key === '$identity' ? 'identity' : g.key === '$path' ? 'path' : g.key}, ${describeTransform(g.transform)}` : `Folder depth ${g.depth}${g.prefix !== undefined && folderPath(g.prefix) ? ` under ${folderPath(g.prefix)}` : ''}`;
/** Display text for a dictionary value: decoded JSON scalars, explicit missing. */
export function valueLabel(raw: string): string {
  if (raw === 'undefined') return '(missing)';
  try { const v: unknown = JSON.parse(raw); return typeof v === 'string' ? v : raw; } catch { return raw; }
}
export function folderColumn(paths: readonly string[], depth: number, prefix?: FolderPath): DictionaryColumn {
  const base = prefix === undefined ? '' : folderPath(prefix), items = paths.map(path => {
    const parent = path.slice(0, Math.max(0, path.lastIndexOf('/')));
    if (base && parent !== base && !parent.startsWith(base + '/')) return '(outside prefix)';
    return (base ? parent.slice(base.length).replace(/^\//, '') : parent).split('/').filter(Boolean).slice(0, depth).join('/') || '(root)';
  });
  return dictionary(items);
}
function dictionary(items: readonly string[]): DictionaryColumn {
  const dict = [...new Set(items)].sort(), index = new Map(dict.map((x, i) => [x, i]));
  return { values: dict, codes: Uint32Array.from(items, x => index.get(x)!) };
}
/** Resolve a runtime group source to a dictionary column. Key groups must be materialized. */
export function groupColumn(p: Projection, d: GraphDeclaration, group: GroupSource | null, level: number): DictionaryColumn & { encoded: boolean } {
  if (group === null) {
    const g = p.groups[level] ?? { values: ['All notes'], codes: new Uint32Array(p.paths.length) };
    return { values: g.values, codes: g.codes, encoded: Boolean(g.encoded) };
  }
  const declared = d.groups.findIndex(g => canonical(g) === canonical(group));
  if (declared >= 0 && p.groups[declared]) return { ...p.groups[declared]!, encoded: Boolean(p.groups[declared]!.encoded) };
  if (group.from === 'key') {
    const c = p.columns[group.key]; if (!c) throw new Error(`Undeclared column: ${group.key}; add it to columns`);
    return { values: c.values, codes: c.codes, encoded: true };
  }
  if (group.from === 'expr' || group.from === 'derived') return { ...expressionGroup(p, lowerGroup(group)), encoded: group.from === 'expr' && lowerGroup(group).kind === 'ref' && (lowerGroup(group) as { space?: string }).space === 'note' };
  return { ...folderColumn(p.paths, group.depth, group.prefix), encoded: false };
}
export interface Facet { key: string; values: { raw: string; label: string; count: number; visible: number }[]; distinct: number }
export interface ExploreResult {
  visible: Uint8Array;
  /** Node → dense code in groupKeys. */
  groupCodes: Uint32Array;
  groupKeys: string[];
  groupLabels: string[];
  groupTotals: Uint32Array;
  groupVisible: Uint32Array;
  types: string[];
  typeTotals: Uint32Array;
  typeVisible: Uint32Array;
  colorCounts: Uint32Array;
  matched: number;
  nodes: number;
  edges: number;
  visibleEdges: number;
  facets: Facet[];
}
export interface ExploreLimits { facetValues: number }
const lowered = new WeakMap<Projection, string[]>();
function searchText(p: Projection) {
  let text = lowered.get(p);
  if (!text) { text = p.paths.map((path, i) => `${path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')}\u0000${p.identities[i]}`.toLowerCase()); lowered.set(p, text); }
  return text;
}
/** Pure, worker-side compilation of a view to typed masks and bounded summaries.
 * Filters are ANDed columnar predicates; hidden groups/colors/types only hide. */
export function explore(p: Projection, d: GraphDeclaration, view: ExploreView, colors: Uint32Array, level: number, limits: ExploreLimits, prepared?: { base: Uint8Array; group: DictionaryColumn }): ExploreResult {
  const n = p.paths.length, base = prepared?.base ?? new Uint8Array(n).fill(1);
  if (!prepared) for (const f of view.filters) { const bits = filterNodes(p, f); for (let i = 0; i < n; i++) base[i]! &= bits[i]!; }
  const query = view.query.trim().toLowerCase();
  if (query) { const text = searchText(p); for (let i = 0; i < n; i++) if (base[i] && !text[i]!.includes(query)) base[i] = 0; }
  const g = prepared?.group ?? groupColumn(p, d, view.group, level), hiddenGroup = new Uint8Array(g.values.length);
  const hidden = new Set(view.hiddenGroups); g.values.forEach((v, i) => { if (hidden.has(v)) hiddenGroup[i] = 1; });
  const hiddenColor = new Uint8Array(d.colors.length + 1), colorNames = new Set(view.hiddenColors);
  d.colors.forEach((c, i) => { if (colorNames.has(c.name)) hiddenColor[i] = 1; }); if (colorNames.has(NO_COLOR)) hiddenColor[d.colors.length] = 1;
  const visible = new Uint8Array(n), groupTotals = new Uint32Array(g.values.length), groupVisible = new Uint32Array(g.values.length), colorCounts = new Uint32Array(d.colors.length + 1);
  let matched = 0;
  for (let i = 0; i < n; i++) {
    if (!base[i]) continue;
    matched++; const code = g.codes[i]!, color = Math.min(colors[i]!, d.colors.length); groupTotals[code]!++; colorCounts[color]!++;
    if (!hiddenGroup[code] && !hiddenColor[color]) { visible[i] = 1; groupVisible[code]!++; }
  }
  const hiddenTypes = new Set(view.hiddenTypes), typeTotals = new Uint32Array(p.types.length), typeVisible = new Uint32Array(p.types.length);
  let visibleEdges = 0;
  for (let e = 0; e < p.source.length; e++) {
    const t = p.type[e]!; typeTotals[t]!++;
    if (visible[p.source[e]!] && visible[p.target[e]!] && !hiddenTypes.has(p.types[t]!)) { typeVisible[t]!++; visibleEdges++; }
  }
  const facets: Facet[] = [];
  for (const key of Object.keys(p.columns).sort()) {
    const c = p.columns[key]!, total = new Uint32Array(c.values.length), shown = new Uint32Array(c.values.length);
    for (let i = 0; i < n; i++) { total[c.codes[i]!]!++; if (visible[i]) shown[c.codes[i]!]!++; }
    const order = Array.from(c.values.keys()).sort((a, b) => total[b]! - total[a]! || (c.values[a]! < c.values[b]! ? -1 : 1)).slice(0, limits.facetValues);
    facets.push({ key, distinct: c.values.length, values: order.map(i => ({ raw: c.values[i]!, label: valueLabel(c.values[i]!), count: total[i]!, visible: shown[i]! })) });
  }
  return { visible, groupCodes: g.codes, groupKeys: g.values, groupLabels: g.encoded ? g.values.map(valueLabel) : g.values, groupTotals, groupVisible,
    types: p.types, typeTotals, typeVisible, colorCounts, matched, nodes: n, edges: p.source.length, visibleEdges, facets };
}
/** Projection view with hidden relation types removed, for group contraction. */
export function withoutTypes<T extends Pick<Projection, 'source' | 'target' | 'type' | 'carrier' | 'types'>>(p: T, hiddenTypes: readonly string[]): T {
  if (!hiddenTypes.length) return p;
  const hidden = new Set(hiddenTypes), keep: number[] = [];
  for (let e = 0; e < p.source.length; e++) if (!hidden.has(p.types[p.type[e]!]!)) keep.push(e);
  const pick = (a: Uint32Array) => Uint32Array.from(keep, e => a[e]!);
  return { ...p, source: pick(p.source), target: pick(p.target), type: pick(p.type), carrier: pick(p.carrier) };
}
/** Predicate summary for a legend row; values stay literal text. */
export function describePredicate(p: Predicate): string {
  if (p.kind === 'expr') return p.expr;
  if (p.kind === 'folder') return `folder ${folderPath(p.prefix) || '(root)'}`;
  if (p.kind === 'exists') return `${p.key} exists`;
  if (p.kind === 'eq') return `${p.key} = ${String(p.value)}`;
  return `${p.key} ∈ ${p.values.slice(0, 3).map(String).join(', ')}${p.values.length > 3 ? ` … ${p.values.length - 3} more` : ''}`;
}
