import type { Incidence } from './connection-card';
import type { RenderProjection } from './render-projection';

/** Restrict an already computed graduated cloud to the hub's open navigator sections (`direct`).
 * Only state bytes are rewritten, never geometry or host filters, so Canvas and WebGL stay in
 * parity. A carrier dot survives only along an explicitly resolved route to a kept note. Neighbours
 * of neighbours are explicit: they are kept only for the sections in `second`, never for the whole
 * hub, and only where focusTiers already reached them (its 65,536-row budget still applies). */
export function discloseTiers(focus: number, direct: ReadonlySet<number>, second: ReadonlySet<number>, p: Pick<RenderProjection, 'source' | 'target' | 'carrier' | 'carrierNodes'>, inc: Incidence, state: Uint8Array, edgeTier: Uint8Array, near: readonly number[], edges: readonly number[]) {
  const keep = new Set<number>([focus, ...direct]), original = new Map(near.map(n => [n, state[n * 4 + 1]!])), origins = new Set<number>();
  for (const n of second) if (direct.has(n)) origins.add(n);
  // Transparent carriers may join the hub to an open section's note.
  for (const n of near) if (p.carrierNodes[n] && original.get(n) === 255) {
    for (let j = inc.offsets[n]!; j < inc.offsets[n + 1]!; j++) {
      const e = inc.edges[j]!, other = p.source[e] === n ? p.target[e]! : p.source[e]!;
      if (edgeTier[e] && p.carrier[e]! + 1 === p.carrierNodes[n] && direct.has(other)) { keep.add(n); if (origins.has(other)) origins.add(n); break; }
    }
  }
  // Two bounded passes over touched edges reach through carriers, never past a second ordinary note.
  if (origins.size) for (let pass = 0; pass < 2; pass++) for (const e of edges) {
    const a = p.source[e]!, b = p.target[e]!;
    for (const [u, v] of [[a, b], [b, a]] as const) if (origins.has(u) && (!p.carrierNodes[u] || p.carrier[e]! + 1 === p.carrierNodes[u]) && (original.get(v) ?? 0) >= 128) {
      keep.add(v);
      if (p.carrierNodes[v] && p.carrier[e]! + 1 === p.carrierNodes[v]) origins.add(v);
    }
  }
  for (const n of near) state[n * 4 + 1] = !keep.has(n) ? 0 : n === focus || direct.has(n) || p.carrierNodes[n] && original.get(n) === 255 ? 255 : 128;
  for (const e of edges) {
    const a = p.source[e]!, b = p.target[e]!, sa = state[a * 4 + 1]!, sb = state[b * 4 + 1]!;
    if (!sa || !sb) edgeTier[e] = 0;
    else if (a !== focus && b !== focus && sa !== 255 && sb !== 255 && !p.carrierNodes[a] && !p.carrierNodes[b]) edgeTier[e] = 0;
    else if (edgeTier[e]! > 200 && (sa !== 255 || sb !== 255)) edgeTier[e] = 128 - +(edgeTier[e] === 254);
  }
}
/** Whether a whole rectangle (not just its anchor) meets `box` [x, y, w, h]; an empty box never does. */
export function overlapsBox(x: number, y: number, w: number, h: number, box: ArrayLike<number>) {
  return box[2]! > 0 && box[3]! > 0 && x < box[0]! + box[2]! && x + w > box[0]! && y < box[1]! + box[3]! && y + h > box[1]!;
}
