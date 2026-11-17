import type { Projection } from '../../src/core/projection';
import { defaults } from '../../src/settings';
import { baseRadius } from '../../src/node-sizing';
import { degreeSizes } from '../../src/render-effects';
/** Whole-layout disc collisions at a fixed home-relative zoom, not viewport cropping.
 * Same 1200x850 CSS viewport, 1x DPR, default sizing, no selection, all carriers shown.
 * Tests use the renderer's radius math; glow and text are not dot geometry. */
export function overlapPairs(p: Pick<Projection, 'offsets' | 'carrierNodes'>, positions: Float32Array, zoom = 1, prominence = 5): number {
  const n = positions.length / 2, s = defaults('synthetic@1');
  // Match DetailRenderer.fitAll: connected notes, up to 8192 evenly sampled,
  // 1st..99th percentile bounds and 25% framing margin. No panels or selection.
  let linked = 0; for (let i = 0; i < n; i++) if (p.offsets[i + 1]! > p.offsets[i]!) linked++;
  const only = linked >= 8, step = Math.max(1, Math.ceil((only ? linked : n) / 8192)), xs: number[] = [], ys: number[] = [];
  let seen = 0;
  for (let i = 0; i < n; i++) if ((!only || p.offsets[i + 1]! > p.offsets[i]!) && seen++ % step === 0) { xs.push(positions[i * 2]!); ys.push(positions[i * 2 + 1]!); }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(a.length * f))]!, t = xs.length < 8 ? 0 : .01;
  const fit = Math.min(1200 / (1.25 * (q(xs, 1 - t) - q(xs, t))), 850 / (1.25 * (q(ys, 1 - t) - q(ys, t))));
  const base = Math.max(Math.min(s.nodeSize, 1.2), baseRadius(s, 1200, 850, n, zoom));
  const radii = degreeSizes(p.offsets, prominence - 1, s.visuals.degreeCurve).map((r, i) => Math.max(1, base * r * (p.carrierNodes[i] ? s.visuals.carrierSize : 1)) * zoom / fit);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => positions[a * 2]! - positions[b * 2]!);
  let maxRadius = 0, pairs = 0; for (const r of radii) maxRadius = Math.max(maxRadius, r);
  for (let a = 0; a < n; a++) {
    const i = order[a]!;
    for (let b = a + 1; b < n; b++) {
      const j = order[b]!, dx = positions[j * 2]! - positions[i * 2]!;
      if (dx > radii[i]! + maxRadius) break;
      const dy = positions[j * 2 + 1]! - positions[i * 2 + 1]!;
      if (dx * dx + dy * dy < (radii[i]! + radii[j]!) ** 2) pairs++;
    }
  }
  return pairs;
}
