import { expressionFilter, expressionGroup, lowerGroup, lowerPredicate } from './expr/engine';
import { canonical, folderPath, groupColumn as declaredGroupColumn, predicateColumn, type GraphDeclaration, type Predicate, type Scalar } from './declaration';
export interface FactRow {
  path: string;
  properties: Record<string, unknown>;
  links?: Record<string, string[]>;
}
export interface DictionaryColumn { values: string[]; codes: Uint32Array; encoded?: boolean }
export interface Projection {
  paths: string[];
  identities: string[];
  carrierPaths: string[];
  offsets: Uint32Array;
  targets: Uint32Array;
  source: Uint32Array;
  target: Uint32Array;
  type: Uint32Array;
  carrier: Uint32Array;
  /** Per node: 1 + its `carrier` row when the node is a reified edge declaration drawn as a
   * node (literal display), else 0. An edge belongs to that note when `carrier[e] + 1` matches. */
  carrierNodes: Uint32Array;
  types: string[];
  columns: Record<string, DictionaryColumn>;
  groups: DictionaryColumn[];
  folders: Map<string, [number, number]>;
  unresolved: number;
  quarantined: { path: string; id: string }[];
}
export const NONE = 0xffffffff;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const scalar = (v: unknown): v is Scalar => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const values = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter(scalar).filter(x => x !== null).map(String);
const has = (r: FactRow, k: string) => Object.hasOwn(r.properties, k);
function column(items: string[]): DictionaryColumn {
  const dict = [...new Set(items)].sort(compare), index = new Map(dict.map((x, i) => [x, i]));
  return { values: dict, codes: Uint32Array.from(items, x => index.get(x)!) };
}
export function buildProjection(input: readonly FactRow[], d: GraphDeclaration): Projection {
  const sorted = [...input].sort((a, b) => compare(a.path, b.path));
  const allPaths = new Map<string, number>(), byId = new Map<string, number[]>();
  const rowIds = sorted.map((r, i) => {
    if (allPaths.has(r.path)) throw new Error(`Duplicate path: ${r.path}`);
    allPaths.set(r.path, i);
    const value = d.identity.map(k => r.properties[k.key]).find(v => scalar(v) && v !== null && String(v).length > 0);
    const id = value === undefined ? r.path : String(value), owners = byId.get(id);
    if (owners) owners.push(i); else byId.set(id, [i]);
    return id;
  });
  const excluded = new Set<number>();
  for (const owners of byId.values()) if (owners.length > 1) for (const owner of owners) excluded.add(owner);
  rowIds.forEach((id, i) => { const pathOwner = allPaths.get(id); if (pathOwner !== undefined && pathOwner !== i) { excluded.add(i); excluded.add(pathOwner); } });
  const quarantined = sorted.flatMap((r, i) => excluded.has(i) ? [{ path: r.path, id: rowIds[i]! }] : []);
  const rows = sorted.filter((_, i) => !excluded.has(i));
  const rowIndex = new Map(rows.map((row, i) => [row.path, i]));
  const carriers = new Set<string>();
  for (const r of rows) for (const e of d.edges) if (e.kind === 'reified' && has(r, e.sourceProperty) && has(r, e.targetProperty)) carriers.add(r.path);
  const nodes = rows.filter(r => d.display.reifiedAsNodes || !carriers.has(r.path));
  const paths = nodes.map(r => r.path), nodeIndex = new Map(paths.map((x, i) => [x, i]));
  const references = new Map<string, number>(), identities: string[] = [];
  nodes.forEach((r, i) => {
    const declared = d.identity.map(k => r.properties[k.key]).find(v => scalar(v) && v !== null && String(v).length > 0);
    const id = declared === undefined ? r.path : String(declared);
    if (references.has(id)) throw new Error(`Ambiguous declared identity: ${id}`);
    references.set(id, i); identities.push(id);
  });
  // Path fallback is always available, but it must never silently shadow a declared identity.
  paths.forEach((path, i) => { if (references.has(path) && references.get(path) !== i) throw new Error(`Identity conflicts with path: ${path}`); references.set(path, i); });
  const src: number[] = [], dst: number[] = [], typ: string[] = [], carrier: number[] = [];
  let unresolved = 0;
  const edge = (a: number | undefined, b: number | undefined, t: string, c: number) => {
    if (a === undefined || b === undefined) { unresolved++; return; }
    src.push(a); dst.push(b); typ.push(t); carrier.push(c);
  };
  for (const r of rows) for (const e of d.edges) {
    if (e.kind === 'reified' && has(r, e.sourceProperty) && has(r, e.targetProperty)) {
      const types = e.typeProperty ? values(r.properties[e.typeProperty]) : [];
      const t = types[0] ?? e.type ?? e.name;
      for (const a of values(r.properties[e.sourceProperty])) for (const b of values(r.properties[e.targetProperty])) {
        const s = references.get(a), tnode = references.get(b);
        if (s === undefined || tnode === undefined) { unresolved++; continue; }
        if (d.display.reifiedAsNodes) { edge(s, nodeIndex.get(r.path), t, rowIndex.get(r.path)!); edge(nodeIndex.get(r.path), tnode, t, rowIndex.get(r.path)!); }
        else edge(s, tnode, t, rowIndex.get(r.path)!);
      }
    } else if (e.kind === 'inline' && nodeIndex.has(r.path)) {
      for (const ref of values(r.properties[e.key])) edge(nodeIndex.get(r.path), references.get(ref), e.type, NONE);
    } else if (e.kind === 'producer' && nodeIndex.has(r.path)) {
      for (const ref of [...(r.links?.[e.producer] ?? [])].sort(compare)) edge(nodeIndex.get(r.path), nodeIndex.get(ref), e.type, NONE);
    }
  }
  const offsets = new Uint32Array(nodes.length + 1);
  for (let i = 0; i < src.length; i++) { offsets[src[i]! + 1]!++; offsets[dst[i]! + 1]!++; }
  for (let i = 1; i < offsets.length; i++) offsets[i]! += offsets[i - 1]!;
  const cursor = offsets.slice(), targets = new Uint32Array(src.length * 2);
  for (let i = 0; i < src.length; i++) { targets[cursor[src[i]!]!++] = dst[i]!; targets[cursor[dst[i]!]!++] = src[i]!; }
  const keys = new Set([...d.columns, ...d.groups.flatMap(g => declaredGroupColumn(g) ?? []), ...d.colors.flatMap(c => predicateColumn(c.predicate) ?? [])]);
  const columns: Record<string, DictionaryColumn> = Object.create(null);
  for (const key of keys) columns[key] = column(nodes.map(r => canonical(r.properties[key])));
  const folders = new Map<string, [number, number]>();
  paths.forEach((path, i) => {
    const parts = path.split('/'); parts.pop();
    for (let depth = 0; depth <= parts.length; depth++) {
      const key = parts.slice(0, depth).join('/'), old = folders.get(key);
      if (old) old[1] = i + 1; else folders.set(key, [i, i + 1]);
    }
  });
  const groups = d.groups.map(g => {
    if (g.from === 'expr') return expressionGroup({ paths, identities, columns, offsets, folders } as Projection, lowerGroup(g));
    if (g.from === 'key') return { ...column(nodes.map(r => canonical(r.properties[g.key]))), encoded: true };
    if (g.from === 'folder') return { ...column(nodes.map(r => folderGroup(r.path, g.depth, g.prefix))), encoded: false };
    return expressionGroup({ paths, identities, columns, offsets, folders } as Projection, lowerGroup(g));
  });
  const tc = column(typ);
  return { paths, identities, carrierPaths: rows.map(r => r.path), offsets, targets,
    source: Uint32Array.from(src), target: Uint32Array.from(dst), type: tc.codes, carrier: Uint32Array.from(carrier), carrierNodes: Uint32Array.from(nodes, r => carriers.has(r.path) ? rowIndex.get(r.path)! + 1 : 0), types: tc.values,
    columns, groups, folders, unresolved, quarantined };
}
export function filterNodes(p: Projection, predicate?: Predicate): Uint8Array {
  return predicate ? expressionFilter(p, lowerPredicate(predicate)) : new Uint8Array(p.paths.length).fill(1);
}
export function edgeVisibility(p: Projection, nodes: Uint8Array): Uint8Array {
  return Uint8Array.from(p.source, (s, i) => nodes[s] && nodes[p.target[i]!] ? 1 : 0);
}
export function colorGroups(p: Projection, d: GraphDeclaration): Uint32Array {
  const out = new Uint32Array(p.paths.length); out.fill(d.colors.length);
  d.colors.forEach((c, group) => { const bits = filterNodes(p, c.predicate); for (let i = 0; i < bits.length; i++) if (bits[i] && out[i] === d.colors.length) out[i] = group; });
  return out;
}
export interface Aggregate { labels: string[]; counts: Uint32Array; positions: Float32Array; edges: { source: number; target: number; type: number; count: number }[] }
export function aggregate(p: Projection, positions: Float32Array, visible: Uint8Array, level = 0): Aggregate {
  const g = p.groups[level] ?? { values: ['All notes'], codes: new Uint32Array(p.paths.length) };
  const counts = new Uint32Array(g.values.length), xy = new Float32Array(g.values.length * 2), edges = new Map<string, Aggregate['edges'][number]>();
  for (let i = 0; i < p.paths.length; i++) if (visible[i]) { const k = g.codes[i]!; counts[k]!++; xy[k * 2]! += positions[i * 2]!; xy[k * 2 + 1]! += positions[i * 2 + 1]!; }
  for (let k = 0; k < counts.length; k++) if (counts[k]) { xy[k * 2]! /= counts[k]!; xy[k * 2 + 1]! /= counts[k]!; }
  for (let i = 0; i < p.source.length; i++) {
    if (!visible[p.source[i]!] || !visible[p.target[i]!]) continue;
    const a = g.codes[p.source[i]!]!, b = g.codes[p.target[i]!]!, t = p.type[i]!;
    const key = `${a}:${b}:${t}`, old = edges.get(key);
    if (old) old.count++; else edges.set(key, { source: a, target: b, type: t, count: 1 });
  }
  return { labels: g.values, counts, positions: xy, edges: [...edges.values()] };
}
export function storageBytes(p: Projection): number {
  return [p.offsets, p.targets, p.source, p.target, p.type, p.carrier, ...Object.values(p.columns).map(c => c.codes), ...p.groups.map(g => g.codes)].reduce((n, a) => n + a.byteLength, 0);
}

function folderGroup(path: string, depth: number, prefix?: import('./declaration').FolderPath): string {
  const parent = path.slice(0, Math.max(0, path.lastIndexOf('/'))), base = prefix === undefined ? '' : folderPath(prefix);
  if (base && parent !== base && !parent.startsWith(base + '/')) return '(outside prefix)';
  const relative = base ? parent.slice(base.length).replace(/^\//, '') : parent;
  return relative.split('/').filter(Boolean).slice(0, depth).join('/') || '(root)';
}
