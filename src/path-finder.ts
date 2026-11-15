import type { Incidence } from './connection-card';
import type { RenderProjection } from './render-projection';
import { registerAction } from './interaction';

type Columns = Pick<RenderProjection, 'source' | 'target' | 'type' | 'types' | 'carrier' | 'carrierNodes'>;
/** One step between notes: one relationship row, or two rows through a relationship-note dot
 * (`carrier`, else -1). The dot is transparent: it is never a step of its own. */
export interface Hop { from: number; to: number; edges: number[]; carrier: number }
export type PathResult = { hops: Hop[] } | { reason: 'none' | 'limit' };
export const MAX_HOPS = 6, MAX_SCAN = 200000, MAX_ALTERNATES = 3;
export const OUTCOME = { none: `No path within ${MAX_HOPS} steps`, limit: 'Search limit reached' };
export interface PathLimits { hops?: number; scan?: number; nodes?: ReadonlySet<number>; edges?: ReadonlySet<number> }

/** Shortest path between two drawn notes: a level-synchronous bidirectional BFS over the incident
 * index, expanding the smaller frontier. Only type-visible rows (`on`) between visible notes
 * (`vis`) count; blocked `nodes`/`edges` are skipped. At most `hops` steps and `scan` incident
 * entries; past the scan budget the outcome is 'limit', never a silent partial answer. */
export function findPath(from: number, to: number, inc: Incidence, p: Columns, on: ArrayLike<number>, vis: ArrayLike<number>, limits: PathLimits = {}): PathResult {
  const max = limits.hops ?? MAX_HOPS, bn = limits.nodes, be = limits.edges; let budget = limits.scan ?? MAX_SCAN;
  if (from === to || !vis[from] || !vis[to]) return { reason: 'none' };
  const own = (e: number, c: number) => !!p.carrierNodes[c] && p.carrier[e]! + 1 === p.carrierNodes[c], other = (e: number, a: number) => p.source[e] === a ? p.target[e]! : p.source[e]!;
  const ok = (e: number, v: number) => !!on[e] && !!vis[v] && !be?.has(e) && !bn?.has(v);
  // Per side: note -> the hop that reached it from that side's root.
  const sides = [new Map<number, Hop | null>([[from, null]]), new Map<number, Hop | null>([[to, null]])], fronts = [[from], [to]], depth = [0, 0];
  /** Each step out of `u`; false once the scan budget is spent, true when `visit` stops. */
  const expand = (u: number, visit: (h: Hop) => boolean) => {
    for (let j = inc.offsets[u]!; j < inc.offsets[u + 1]!; j++) {
      if (--budget < 0) return false;
      const e = inc.edges[j]!, v = other(e, u);
      if (v === u || !ok(e, v)) continue;
      if (!p.carrierNodes[v] || v === from || v === to) { if (visit({ from: u, to: v, edges: [e], carrier: -1 })) return true; continue; }
      if (own(e, v)) for (let k = inc.offsets[v]!; k < inc.offsets[v + 1]!; k++) {
        if (--budget < 0) return false;
        const f = inc.edges[k]!, w = other(f, v);
        if (f !== e && w !== u && w !== v && own(f, v) && ok(f, w) && visit({ from: u, to: w, edges: [e, f], carrier: v })) return true;
      }
    }
    return undefined;
  };
  while (depth[0]! + depth[1]! < max) {
    const s = fronts[0]!.length <= fronts[1]!.length ? 0 : 1, mine = sides[s]!, theirs = sides[1 - s]!, next: number[] = []; let meet = -1;
    if (!fronts[s]!.length) break;
    for (const u of fronts[s]!) {
      const r = expand(u, h => { if (mine.has(h.to)) return false; mine.set(h.to, h); if (theirs.has(h.to)) { meet = h.to; return true; } next.push(h.to); return false; });
      if (r === false) return { reason: 'limit' };
      if (r) break;
    }
    // Level-synchronous: no path is shorter than the current depths, so the first meeting is shortest.
    if (meet >= 0) {
      const hops: Hop[] = [];
      for (let v = meet, h = sides[0]!.get(v); h; v = h.from, h = sides[0]!.get(v)) hops.unshift(h);
      for (let v = meet, h = sides[1]!.get(v); h; v = h.from, h = sides[1]!.get(v)) hops.push({ from: h.to, to: h.from, edges: h.edges.slice().reverse(), carrier: h.carrier });
      return { hops };
    }
    depth[s]!++; fronts[s] = next;
  }
  return { reason: 'none' };
}
/** The next path sharing no inner note, relationship-note dot or relationship row with `previous`. */
export function alternatePath(from: number, to: number, inc: Incidence, p: Columns, on: ArrayLike<number>, vis: ArrayLike<number>, previous: readonly Hop[][], limits: PathLimits = {}) {
  const nodes = new Set<number>(), edges = new Set<number>();
  for (const hops of previous) for (const h of hops) { if (h.to !== to) nodes.add(h.to); if (h.carrier >= 0) nodes.add(h.carrier); for (const e of h.edges) edges.add(e); }
  return findPath(from, to, inc, p, on, vis, { ...limits, nodes, edges });
}
/** Notes along the path, start first (relationship-note dots excluded). */
export const pathNotes = (hops: readonly Hop[]) => hops.length ? [hops[0]!.from, ...hops.map(h => h.to)] : [];
export interface HopRow { step: number; from: number; to: number; type: string; reverse: boolean; carrier: number }
/** The card's hop list: note, relationship type (reverse when walked against its direction), next note. */
export const hopRows = (hops: readonly Hop[], p: Pick<Columns, 'source' | 'type' | 'types'>): HopRow[] => hops.map((h, i) => ({ step: i + 1, from: h.from, to: h.to, type: p.types[p.type[h.edges[0]!]!] || 'relationship', reverse: p.source[h.edges[0]!] !== h.from, carrier: h.carrier }));

registerAction({ id: 'find-path', label: 'Find path to…', menu: true, when: ({ host, node }) => host.selected >= 0 && node >= 0 && node !== host.selected, run: ({ host, node }) => host.findPath(host.selected, node) });
