import type { RenderProjection } from './render-projection';
type Component = [nodes: number[], edges: number[]];
/** Render-only endpoints for the adjacent leg pairs emitted by the projection. Zero is an
 * ordinary edge; the high bit marks the outgoing leg. Never infer a pair from note names. */
export function carrierPairs(p: RenderProjection, on: Uint8Array, visible: Uint8Array, ranks: Uint32Array) {
  const enabled = on.slice(), ends = new Uint32Array(p.source.length), nodes = new Uint32Array(p.nodeCount).fill(0xffffffff), incomplete = new Set<number>();
  for (let e = 0; e + 1 < ends.length; e++) {
    const n = p.target[e]!, owner = p.carrierNodes[n];
    if (!owner || p.carrier[e]! + 1 !== owner || p.source[e + 1] !== n || p.carrier[e + 1] !== p.carrier[e]) continue;
    ends[e] = p.target[e + 1]! + 1; ends[e + 1] = (p.source[e]! + 1) | 0x80000000;
    const complete = !!(on[e] && on[e + 1] && visible[p.source[e]!] && visible[n] && visible[p.target[e + 1]!]);
    enabled[e] = enabled[e + 1] = +complete;
    if (complete) nodes[n] = ranks[e]!; else incomplete.add(n);
    e++;
  }
  // Endpoint carriers cannot fold without losing a real attachment. Cache whole components;
  // only rendering changes, never traversal masks or the projection.
  const parent = new Int32Array(p.nodeCount).fill(-1);
  const find = (n: number): number => { while (parent[n] !== n) { parent[n] = parent[parent[n]!]!; n = parent[n]!; } return n; };
  for (let e = 0; e < ends.length; e++) if (enabled[e] && visible[p.source[e]!] && visible[p.target[e]!]) {
    const a = p.source[e]!, b = p.target[e]!, ca = !!p.carrierNodes[a], cb = !!p.carrierNodes[b];
    if (ca && cb || !ends[e] && (ca || cb)) {
      if (ca && parent[a] === -1) parent[a] = a; if (cb && parent[b] === -1) parent[b] = b;
      if (ca && cb) parent[find(a)] = find(b);
    }
  }
  const grouped: Component[] = [];
  for (let n = 0; n < parent.length; n++) if (parent[n] !== -1) (grouped[find(n)] ??= [[], []])[0].push(n);
  const groups: Component[] = [];
  for (const group of grouped) if (group) {
    const complete = group[0].every(n => nodes[n] !== 0xffffffff && !incomplete.has(n));
    for (const n of group[0]) nodes[n] = complete ? 0x3000000 : 0xffffffff;
    if (complete) groups.push(group);
  }
  for (let e = 0; e < ends.length; e++) {
    const a = p.source[e]!, b = p.target[e]!;
    if (parent[a] !== -1 || parent[b] !== -1) { const n = parent[a] !== -1 ? a : b; if (nodes[n] === 0xffffffff) enabled[e] = 0; else if (enabled[e] && visible[a] && visible[b]) (grouped[find(n)]![1].push(e), ranks[e] = 0x3000000); }
  }
  // One row-weighted rank space. Retained components precede ordinary units; ordinary
  // ordering is cached from the existing weighted ranks, including explicit multi-target owners.
  const units: Component[] = [], ordinary = new Map<number, Component>();
  if (groups.length) for (let e = 0; e < ends.length; e++) {
    const a = p.source[e]!, b = p.target[e]!;
    if (!enabled[e] || !visible[a] || !visible[b] || parent[a] !== -1 || parent[b] !== -1) continue;
    const n = ends[e] ? ends[e]! >= 0x80000000 ? a : b : -1, key = n < 0 ? p.nodeCount + e : n;
    let unit = ordinary.get(key); if (!unit) { unit = [n < 0 ? [] : [n], []]; ordinary.set(key, unit); units.push(unit); } unit[1].push(e);
  }
  units.sort((a, b) => (ranks[a[1][0]!]! & 0xffffff) - (ranks[b[1][0]!]! & 0xffffff));
  const geometry = { ends, nodes, enabled, groups, units }; carrierFocus(geometry, ranks); return geometry;
}
/** One exclusive topology, based on nominal relationship-dot radius in CSS pixels. */
export const carrierThrough = (mode: 'auto' | 'through' | 'direct', radius: number) => mode === 'through' || mode === 'auto' && radius >= 1.5;
/** Conservative end-of-component quantiles: never partially admit an oversized component. */
export const carrierAdmitted = (rank: number, share: number) => (rank & 0xffffff) + 1 <= share * 0x1000000;
/** Per view/focus only, O(C + E + G log G): share tiers, then budget focused components first,
 * smaller components next. Camera frames only compare cached ranks; no component traversal. */
export function carrierFocus(g: { groups: Component[]; units: Component[]; nodes: Uint32Array }, ranks: Uint32Array, state?: Uint8Array, touched: number[] = []) {
  if (!g.groups.length) return;
  let total = g.units.reduce((sum, unit) => sum + unit[1].length, 0), at = 0;
  for (const [nodes, edges] of g.groups) {
    total += edges.length;
    if (state) { let tier = 0; for (const n of nodes) tier = Math.max(tier, state[n * 4 + 1]!); if (tier) for (const n of nodes) { if (!state[n * 4 + 1]) touched.push(n); state[n * 4 + 1] = tier; } }
  }
  g.groups.sort((a, b) => (state ? state[b[0][0]! * 4 + 1]! - state[a[0][0]! * 4 + 1]! : 0) || a[1].length - b[1].length);
  for (const [nodes, edges] of [...g.groups, ...g.units]) {
    at += edges.length; const rank = (ranks[edges[0]!]! & 0x3000000) | Math.ceil(at * 0x1000000 / total) - 1;
    for (const n of nodes) g.nodes[n] = rank; for (const e of edges) ranks[e] = rank;
  }
}
