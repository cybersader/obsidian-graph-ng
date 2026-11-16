import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { focusTiers, incidentEdges, tierLift, liftRadius, strongEdge, focusAlpha, offscreenPips, tierCounts, shownTier, shownEdgeTier, TIERS, ALL_TIERS, PIP_DIRECTIONS } from '../src/render-data';

// Graduated connection highlighting finding aids: pure helpers and the shader scalar expressions
// they mirror. Deterministic only; no GPU raster, native visibility or frame-time claim.
const source = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
const shader = (name: string) => source.match(new RegExp('const ' + name + ' = (?:common \\+ )?glsl`([\\s\\S]*?)`;'))![1]!;
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const expr = (text: string) => new Function('s', `with (s) { return (${text.replace(/(\d)u\b/g, '$1')}); }`) as (s: any) => number;

test('minimum highlighted size: smooth floor never below the lift, unchanged from twice the lift, C1 at the join', () => {
  for (const lift of [.5, 4, 7, 16]) {
    let last = -Infinity;
    for (let r = 0; r <= 4 * lift; r += lift / 64) {
      const out = liftRadius(r, lift);
      expect(out).toBeGreaterThanOrEqual(lift - 1e-12); expect(out).toBeGreaterThanOrEqual(r - 1e-12);
      expect(out).toBeGreaterThanOrEqual(last); last = out; // monotonic
      if (r >= 2 * lift) expect(out).toBe(r);
    }
    expect(liftRadius(0, lift)).toBe(lift);
    // Value and slope match at r = 2 * lift.
    const h = 1e-6, at = 2 * lift; expect(liftRadius(at - h, lift)).toBeCloseTo(at, 5);
    expect((liftRadius(at, lift) - liftRadius(at - h, lift)) / h).toBeCloseTo(1, 4);
  }
  // No lift means no change; a negative or zero floor never shrinks.
  for (const r of [0, .3, 5]) { expect(liftRadius(r, 0)).toBe(r); expect(liftRadius(r, -1)).toBe(r); }
});
test('minimum highlighted size per tier: focus and direct 7 px, ancestors 75%, neighbours of neighbours about 4 px, ramped by focus', () => {
  expect(tierLift(1, true, 1, 7)).toBe(7); expect(tierLift(1, false, 1, 7)).toBe(7);
  expect(tierLift(192 / 255, false, 1, 7)).toBeCloseTo(5.25, 12); expect(tierLift(128 / 255, false, 1, 7)).toBeCloseTo(3.99, 12);
  expect(tierLift(64 / 255, false, 1, 7)).toBe(0); expect(tierLift(0, false, 1, 7)).toBe(0);
  for (const g of [0, 64, 128, 192, 255].map(b => b / 255)) { expect(tierLift(g, false, 0, 7)).toBe(0); expect(tierLift(g, false, 1, 0)).toBe(0); expect(tierLift(g, false, .5, 7)).toBeCloseTo(tierLift(g, false, 1, 7) / 2, 12); }
  // The node shader writes the same expressions (edge notes are exempt there and in Canvas).
  const node = shader('nodeVertex'), lift = expr(node.match(/float lift = ([^;]+);/)![1]!), floor = node.match(/if \(lift > 0\. && radius < 2\. \* lift\) radius = ([^;]+);/)![1]!;
  for (const g of [0, 64, 128, 192, 255].map(b => b / 255)) for (const ego of [false, true]) for (const focus of [0, .3, 1]) for (const minSize of [0, 4, 7]) {
    expect(lift({ note: false, minSize, focus, ego, st: { g } })).toBeCloseTo(tierLift(g, ego, focus, minSize), 12);
    expect(lift({ note: true, minSize, focus, ego, st: { g } })).toBe(0);
  }
  for (const radius of [.2, 3, 9, 20]) for (const l of [1, 7]) expect(radius < 2 * l ? expr(floor)({ lift: l, radius }) : radius).toBeCloseTo(liftRadius(radius, l), 12);
});
test('strong focus lines: shader expressions equal the shared helper; zero opacity stays zero; order focus > 2-hop > context', () => {
  const edge = shader('edgeVertex'), alphaLine = expr(edge.match(/if \(strong > 0\.\) alpha = ([^;]+);/)![1]!), wide = expr(edge.match(/if \(strong > 0\.\) wide \*= ([^;]+);/)![1]!);
  for (const tier of [0, 127, 128, 254, 255]) for (const alpha of [0, .01, .3, 1]) for (const focus of [0, .4, 1]) {
    const [a, w] = strongEdge(tier, alpha, focus);
    expect(alphaLine({ tier, alpha, focus, strong: .95 })).toBeCloseTo(a, 12); expect(wide({ tier, focus })).toBeCloseTo(w, 12);
    if (!alpha) expect(a).toBe(0);
    expect(a).toBeLessThanOrEqual(1);
  }
  for (const alpha of [.05, .3]) { const [d] = strongEdge(255, alpha, 1), [c] = strongEdge(128, alpha, 1), [x] = strongEdge(0, alpha, 1); expect(d).toBe(.95); expect(c).toBe(alpha * .5); expect(x).toBeCloseTo(alpha * .35, 12); }
  // Uniform fan opacity matches Canvas union strokes; explicit direction remains independent.
  expect(edge).toContain('direction > .5 ? mix(.12, 1., u) : 1.');
});
test('legend masks: a switched-off tier draws as context, the focus never does', () => {
  for (const [, byte] of TIERS) expect(shownTier(byte, ALL_TIERS)).toBe(byte);
  TIERS.forEach(([, byte], i) => { expect(shownTier(byte, ALL_TIERS & ~(1 << i))).toBe(0); expect(shownTier(byte, ALL_TIERS & ~(1 << i), true)).toBe(byte); });
  expect(shownTier(0, 0)).toBe(0);
  expect(shownEdgeTier(255, ALL_TIERS & ~1)).toBe(0); expect(shownEdgeTier(254, ALL_TIERS)).toBe(254); expect(shownEdgeTier(128, ALL_TIERS & ~4)).toBe(0); expect(shownEdgeTier(127, ALL_TIERS & ~1)).toBe(127);
  // The shader's mask function names the same bytes and bits.
  const common = source.match(/float shownTier\(float g, bool ego\) \{([^}]*)\}/)![1]!;
  for (const [i, byte] of [[0, 255], [1, 192], [2, 128], [3, 64]]) expect(common).toContain(`b == ${byte} && (tierMask & ${1 << i!}) != 0`);
});
test('tier counts for the legend come from the touched list only, excluding the focus and edge notes', () => {
  // 0 focus; 1, 2 direct (2 an edge note); 3 neighbour of neighbour; 4 context.
  const source = Uint32Array.from([0, 0, 1, 3]), target = Uint32Array.from([1, 2, 3, 4]), n = 5, m = 4;
  const p = { source, target, carrier: new Uint32Array(m).fill(0xffffffff), carrierNodes: new Uint32Array(n) }, state = new Uint8Array(n * 4), edge = new Uint8Array(m), nodes: number[] = [], edges: number[] = [];
  focusTiers(0, incidentEdges({ nodeCount: n, source, target }), p, new Uint8Array(m).fill(1), new Uint8Array(n).fill(1), state, edge, nodes, edges);
  expect(tierCounts(0, nodes, state)).toEqual([2, 0, 1, 0]);
  expect(tierCounts(0, nodes, state, Uint8Array.from([0, 0, 1, 0, 0]))).toEqual([1, 0, 1, 0]);
  // Ancestor and same-group bytes land in their own rows.
  state[4 * 4 + 1] = 64; expect(tierCounts(0, [...nodes, 4], state)).toEqual([2, 0, 1, 1]);
  state[3 * 4 + 1] = 192; expect(tierCounts(0, [...nodes, 4], state)).toEqual([2, 1, 0, 1]);
  expect(tierCounts(-1, [], state)).toEqual([0, 0, 0, 0]);
});
test('off-screen pips: one per direction with counts, nearest point chosen, placed on the inset border', () => {
  const w = 800, h = 600, inset = 20, ids = [10, 11, 12, 13, 14, 15, 16];
  // On screen (ignored), two far right, one nearer right, one below, one upper left, one non-finite.
  const xy = [400, 300, 2000, 300, 1200, 320, 3000, 250, 400, 5000, -100, -100, NaN, 0];
  const pips = offscreenPips(ids, xy, w, h, inset);
  expect(pips.map(p => [p.sector, p.count, p.node])).toEqual([[0, 3, 12], [2, 1, 14], [5, 1, 15]]);
  expect(pips.map(p => PIP_DIRECTIONS[p.sector])).toEqual(['right', 'below', 'upper left']);
  const right = pips[0]!; expect(right.x).toBeCloseTo(w - inset, 9); expect(right.y).toBeCloseTo(300 + 20 * (380 / 800), 9);
  expect(pips[1]!.y).toBeCloseTo(h - inset, 9); expect(pips[1]!.x).toBeCloseTo(400, 9);
  // The corner ray hits whichever inset edge comes first; every pip stays inside the inset box.
  for (const p of pips) { expect(p.x).toBeGreaterThanOrEqual(inset - 1e-9); expect(p.x).toBeLessThanOrEqual(w - inset + 1e-9); expect(p.y).toBeGreaterThanOrEqual(inset - 1e-9); expect(p.y).toBeLessThanOrEqual(h - inset + 1e-9); }
  // Edges of the viewport count as on screen; nothing off screen gives no pips; deterministic.
  expect(offscreenPips([1, 2], [0, 0, w, h], w, h, inset)).toEqual([]); expect(offscreenPips([], [], w, h, inset)).toEqual([]);
  expect(offscreenPips(ids, xy, w, h, inset)).toEqual(pips);
  // All eight directions bin distinctly around the centre.
  const ring = Array.from({ length: 8 }, (_, s) => [400 + 5000 * Math.cos(s * Math.PI / 4), 300 + 5000 * Math.sin(s * Math.PI / 4)]).flat();
  expect(offscreenPips([0, 1, 2, 3, 4, 5, 6, 7], ring, w, h, inset).map(p => p.sector)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});
test('off-screen pips stay O(direct connections): a 50,000-point projection is one linear pass', () => {
  const n = 50000, ids = Array.from({ length: n }, (_, i) => i), xy = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { const a = i * 2.399963; xy[i * 2] = 400 + (300 + i) * Math.cos(a); xy[i * 2 + 1] = 300 + (300 + i) * Math.sin(a); }
  const started = performance.now(), pips = offscreenPips(ids, xy, 800, 600, 20), ms = performance.now() - started;
  expect(pips.reduce((s, p) => s + p.count, 0)).toBeLessThanOrEqual(n); expect(pips.length).toBe(8); expect(ms).toBeLessThan(250);
});


test('selected hub fan has a continuous degree-scaled target without the 50-connection cutoff', () => {
  const alphaLine = expr(shader('edgeVertex').match(/if \(strong > 0\.\) alpha = ([^;]+);/)![1]!);
  let last = 1;
  for (const degree of [0, 1, 24, 49, 50, 51, 483, 5000]) {
    const strong = focusAlpha(degree); expect(strong).toBeLessThanOrEqual(last); last = strong;
    expect(strong).toBeGreaterThanOrEqual(.18);
    for (const alpha of [0, .005, .06, .8]) for (const focus of [0, .4, 1]) {
      const [a] = strongEdge(255, alpha, focus, strong);
      expect(alphaLine({ tier: 255, alpha, focus, strong })).toBeCloseTo(a, 12);
      if (!alpha) expect(a).toBe(0);
      if (alpha && focus === 1) expect(a).toBeCloseTo(strong, 12);
    }
  }
  expect(focusAlpha(483)).toBeGreaterThan(.21); expect(focusAlpha(483)).toBeLessThan(.22);
  expect(focusAlpha(50) - focusAlpha(51)).toBeLessThan(.01);
  expect(source).not.toContain('focusEdges && this.directs.length <= 50');
});
