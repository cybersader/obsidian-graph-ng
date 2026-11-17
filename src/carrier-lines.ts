import type { RenderProjection } from './render-projection';
/** Render-only endpoints for the adjacent leg pairs emitted by the projection. Zero is an
 * ordinary edge; the high bit marks the outgoing leg. Never infer a pair from note names. */
export function carrierPairs(p: RenderProjection, on: Uint8Array, visible: Uint8Array, ranks: Uint32Array) {
  const enabled = on.slice(), ends = new Uint32Array(p.source.length), nodes = new Uint32Array(p.nodeCount).fill(0xffffffff);
  for (let e = 0; e + 1 < ends.length; e++) {
    const n = p.target[e]!, owner = p.carrierNodes[n];
    if (!owner || p.carrier[e]! + 1 !== owner || p.source[e + 1] !== n || p.carrier[e + 1] !== p.carrier[e]) continue;
    ends[e] = p.target[e + 1]! + 1; ends[e + 1] = (p.source[e]! + 1) | 0x80000000;
    const complete = !!(on[e] && on[e + 1] && visible[p.source[e]!] && visible[n] && visible[p.target[e + 1]!]);
    enabled[e] = enabled[e + 1] = +complete;
    if (complete) nodes[n] = ranks[e]!;
    e++;
  }
  return { ends, nodes, enabled };
}
/** One exclusive topology, based on the nominal relationship-dot radius in CSS pixels.
 * Legacy thresholds stay readable on disk; they no longer depend on home framing. */
export const carrierThrough = (mode: 'auto' | 'through' | 'direct', radius: number) => mode === 'through' || mode === 'auto' && radius >= 1.5;
