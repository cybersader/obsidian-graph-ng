import type { RenderProjection } from './render-projection';
import type { PickGrid } from './render-data';

export interface LensConnection { node: number; type: string; name: string }
export interface LensPoint { x: number; y: number }
/** Visit only incident rows and transparent relationship-note rows, never the whole graph.
 * Parallel relationships use their alphabetically first visible type. Sorting is cached by
 * the renderer per target/view; subsequent geometry and picking are O(direct connections). */
export function lensConnections(focus: number, p: RenderProjection, inc: { offsets: Uint32Array; edges: Uint32Array }, on: ArrayLike<number>, visible: ArrayLike<number>, rendered: ArrayLike<number>, name: (node: number) => string): LensConnection[] {
  if (!Number.isInteger(focus) || focus < 0 || !rendered[focus]) return [];
  const types = new Map<number, string>(), carriers: number[] = [], seen = new Set([focus]);
  const scan = (node: number, own = false) => {
    for (let j = inc.offsets[node]!; j < inc.offsets[node + 1]!; j++) {
      const e = inc.edges[j]!, other = p.source[e] === node ? p.target[e]! : p.source[e]!;
      if (!on[e] || !visible[other] || own && p.carrier[e]! + 1 !== p.carrierNodes[node]) continue;
      const type = p.types[p.type[e]!]!, previous = types.get(other);
      if (other !== focus && rendered[other] && (previous === undefined || type < previous)) types.set(other, type);
      if (!seen.has(other)) { seen.add(other); if (p.carrierNodes[other]) carriers.push(other); }
    }
  };
  scan(focus); for (let i = 0; i < carriers.length; i++) scan(carriers[i]!, true);
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return [...types].map(([node, type]) => ({ node, type, name: name(node) })).sort((a, b) => compare(a.type, b.type) || compare(a.name, b.name) || a.node - b.node);
}
/** Ordered concentric rings, in CSS pixels around the fixed focus. `spacing` bounds the
 * diagonal of a node + its label footprint, so chords and radial gaps both clear it.
 * Linear geometry pass over the already sorted connections; no degree cap/truncation. */
export function lensLayout(connections: readonly LensConnection[], spacing = 100, minimumRadius = 80): Map<number, LensPoint> {
  if (!(spacing > 0 && Number.isFinite(spacing) && minimumRadius >= 0 && Number.isFinite(minimumRadius))) throw new Error('LENS_NONFINITE_SIZE');
  const points = new Map<number, LensPoint>(); let at = 0, radius = Math.max(minimumRadius, spacing);
  while (at < connections.length) {
    const capacity = Math.max(1, Math.floor(Math.PI / Math.asin(Math.min(1, spacing / (2 * radius)))));
    const count = Math.min(connections.length - at, capacity);
    for (let i = 0; i < count; i++) { const angle = -Math.PI / 2 + i * 2 * Math.PI / count; points.set(connections[at++]!.node, { x: Math.fround(Math.cos(angle) * radius), y: Math.fround(Math.sin(angle) * radius) }); }
    radius += spacing;
  }
  return points;
}
/** Eased amount, including reversible transitions and the reduced-motion instant path. */
export function lensAmount(from: number, to: number, elapsed: number, duration = 220, reduced = false): number {
  const t = reduced || duration <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / duration));
  return from + (to - from) * t * t * (3 - 2 * t);
}
/** Same coordinate equation as the WebGL position override. Offsets are screen-space,
 * so zoom never packs the ring back into tiny dots. Source coordinates are read-only. */
export function lensCoordinate(base: number, center: number, offset: number, scale: number, amount: number): number {
  return base + (center + offset / scale - base) * amount;
}
/** The original spatial grid remains authoritative for untouched nodes. Displaced entries
 * are excluded at their old positions and tested separately, including outside grid bounds. */
export function pickLens(grid: PickGrid, points: ReadonlyMap<number, LensPoint>, x: number, y: number, radius: number, position: (node: number) => LensPoint, hitRadius: (node: number) => number, eligible: (node: number) => boolean): number {
  let best = -1, distance = Infinity;
  const test = (node: number) => {
    if (!eligible(node)) return;
    const p = position(node), d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= hitRadius(node) ** 2 && (d < distance || d === distance && (best < 0 || node < best))) { best = node; distance = d; }
  };
  grid.visit(x, y, radius, node => { if (!points.has(node)) test(node); });
  for (const node of points.keys()) test(node);
  return best;
}
