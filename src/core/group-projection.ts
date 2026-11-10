import type { Projection, FactRow } from './projection';
import type { GraphDeclaration } from './declaration';
/** graph-projection v0 (draft). Opaque carrier ids are resolved by a declaration, never guessed. */
export interface GroupProjection {
  schema?: string;
  producer?: { name: string; projection: string; asOf: string };
  groups: { id: string; label: string; count: number; openPath?: string; identityPrefix?: string }[];
  groupEdges: { a: string; b: string; total: number; typeCounts: Record<string, number>;
    directional?: { aToB: Record<string, number>; bToA: Record<string, number> };
    carriers: { kind: string; ids: string[] } }[];
  coverage?: Record<string, unknown>;
}
function counts(v: unknown): asserts v is Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected a type-count object');
  for (const n of Object.values(v)) if (!Number.isSafeInteger(n) || n < 0) throw new Error('Type counts must be nonnegative integers');
}
export function validateGroupProjection(v: unknown): asserts v is GroupProjection {
  if (!v || typeof v !== 'object') throw new Error('Projection must be an object');
  const p = v as GroupProjection;
  if (!Array.isArray(p.groups) || !Array.isArray(p.groupEdges)) throw new Error('Projection requires groups and groupEdges arrays');
  if (p.schema !== undefined && typeof p.schema !== 'string') throw new Error('schema must be a string');
  if (p.producer !== undefined && (!p.producer || ['name', 'projection', 'asOf'].some(k => typeof p.producer![k as keyof typeof p.producer] !== 'string'))) throw new Error('Invalid producer');
  const ids = new Set<string>();
  for (const g of p.groups) {
    if (!g || typeof g.id !== 'string' || !g.id || typeof g.label !== 'string' || !Number.isSafeInteger(g.count) || g.count < 0 || ids.has(g.id)) throw new Error('Invalid or duplicate group');
    if ((g.openPath !== undefined && typeof g.openPath !== 'string') || (g.identityPrefix !== undefined && typeof g.identityPrefix !== 'string')) throw new Error('Invalid group navigation');
    ids.add(g.id);
  }
  const pairs = new Set<string>();
  for (const e of p.groupEdges) {
    const key = JSON.stringify([e?.a, e?.b].sort());
    if (!e || !ids.has(e.a) || !ids.has(e.b) || pairs.has(key) || !e.carriers || typeof e.carriers.kind !== 'string' || !Array.isArray(e.carriers.ids) || e.carriers.ids.some(c => typeof c !== 'string')) throw new Error('Invalid or duplicate group edge');
    counts(e.typeCounts);
    if (!Number.isSafeInteger(e.total) || e.total !== Object.values(e.typeCounts).reduce((a, b) => a + b, 0)) throw new Error('Edge total must equal type counts');
    if (e.directional !== undefined) {
      counts(e.directional.aToB); counts(e.directional.bToA);
      const types = new Set([...Object.keys(e.typeCounts), ...Object.keys(e.directional.aToB), ...Object.keys(e.directional.bToA)]);
      for (const type of types) if ((e.directional.aToB[type] ?? 0) + (e.directional.bToA[type] ?? 0) !== (e.typeCounts[type] ?? 0)) throw new Error('Directional counts must sum to type counts');
    }
    pairs.add(key);
  }
}
export interface GroupContribution { source: string; target: string; type: string; carrier?: string }
export const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
export function contractGroups(p: Projection, visible: Uint8Array, level = 0): { projection: GroupProjection; contributions: Map<string, GroupContribution[]>; members: Map<string, number[]> } {
  const source = p.groups[level] ?? { values: ['All notes'], codes: new Uint32Array(p.paths.length) };
  const groups = source.values.map((label, id) => ({ id: String(id), label: label.startsWith('"') ? JSON.parse(label) as string : label, count: 0 }));
  const members = new Map<string, number[]>(), contributions = new Map<string, GroupContribution[]>();
  for (let i = 0; i < p.paths.length; i++) if (visible[i]) { const g = groups[source.codes[i]!]!; g.count++; const m = members.get(g.id); if (m) m.push(i); else members.set(g.id, [i]); }
  const pairs = new Map<string, GroupProjection['groupEdges'][number]>();
  for (let i = 0; i < p.source.length; i++) {
    const s = p.source[i]!, t = p.target[i]!;
    if (!visible[s] || !visible[t]) continue;
    const from = String(source.codes[s]), to = String(source.codes[t]), [a, b] = [from, to].sort() as [string, string], key = pairKey(a, b);
    let edge = pairs.get(key);
    if (!edge) { edge = { a, b, total: 0, typeCounts: Object.create(null), directional: { aToB: Object.create(null), bToA: Object.create(null) }, carriers: { kind: 'note-path', ids: [] } }; pairs.set(key, edge); contributions.set(key, []); }
    const type = p.types[p.type[i]!]!, carrier = p.carrierPaths[p.carrier[i]!];
    edge.total++; edge.typeCounts[type] = (edge.typeCounts[type] ?? 0) + 1;
    const dir = from === a ? edge.directional!.aToB : edge.directional!.bToA; dir[type] = (dir[type] ?? 0) + 1;
    if (carrier !== undefined) edge.carriers.ids.push(carrier);
    contributions.get(key)!.push({ source: p.paths[s]!, target: p.paths[t]!, type, carrier });
  }
  return { projection: { groups: groups.filter(g => g.count), groupEdges: [...pairs.values()] }, contributions, members };
}
/** Null means absent or ambiguous; no body reads, naming heuristics or ontology-specific keys. */
export function resolveCarrier(rows: readonly FactRow[], d: GraphDeclaration, kind: string, id: string): string | null {
  const resolver = d.carrierResolvers?.find(r => r.kind === kind); if (!resolver) return null;
  const matches = rows.filter(r => resolver.key === '$path' ? r.path === id : r.properties[resolver.key] !== undefined && String(r.properties[resolver.key]) === id);
  return matches.length === 1 ? matches[0]!.path : null;
}
