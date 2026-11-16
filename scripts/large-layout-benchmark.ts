import { DEFAULT_LAYOUT, LayoutSolver, random, type LayoutOptions } from '../src/core/layout';
import { recommendedPhysics } from '../src/recommend';
/** Synthetic relationship-as-note graph: 26.2% endpoints, 73.8% two-legged
 * relationships, about 3.1 edges/note. Sixteen planted groups; 1% cross links.
 * Never reads a vault. Cohesion = RMS group-centroid radius / within-group RMS.
 * Hub radius = RMS distance to the highest-degree adjacent node, in layout units.
 */
export function largeFixture(n: number) {
  const rng = random(7), base = Math.floor(n * .262 / 16) * 16, size = base / 16;
  const group = new Uint32Array(n), source: number[] = [], target: number[] = [];
  const edge = (a: number, b: number) => { if (a !== b) { source.push(a); target.push(b); } };
  for (let i = 0; i < base; i++) {
    const g = group[i] = Math.floor(i / size);
    // A visible hub plus local links, with 5% unlinked endpoint notes.
    if (i % size >= size * .95) continue;
    edge(i, g * size);
    for (let j = 0; j < 5; j++) edge(i, g * size + Math.floor(rng() * size * .95));
  }
  for (let i = base; i < n; i++) {
    const g = group[i] = Math.floor(rng() * 16), a = g * size + Math.floor(rng() * size * .95);
    const b = (rng() < .01 ? Math.floor(rng() * 16) : g) * size + Math.floor(rng() * size * .95);
    edge(a, i); edge(i, b);
  }
  return { input: { count: n, source: Uint32Array.from(source), target: Uint32Array.from(target), seed: 7 }, group };
}
export function measureLarge(n: number, mode: string, hubGravity = 0) {
  const { input, group } = largeFixture(n), { iterations, ...recommended } = recommendedPhysics(n, input.source.length);
  const options: LayoutOptions = { ...DEFAULT_LAYOUT, iterations: mode === 'owner' ? 100 : iterations,
    force: { ...DEFAULT_LAYOUT.force, ...(mode === 'owner' ? { scalingRatio: 26.23, gravity: .1, linLogMode: true } : recommended), ...('hubGravity' in DEFAULT_LAYOUT.force ? { hubGravity } : {}) } };
  const solver = new LayoutSolver(input, options), seed = solver.positions.slice(), start = performance.now();
  while (!solver.done) solver.step();
  const p = solver.positions, cx = new Float64Array(16), cy = new Float64Array(16), counts = new Uint32Array(16);
  let displacement = 0, radius = 0, within = 0, between = 0;
  for (let i = 0; i < n; i++) { const g = group[i]!; cx[g]! += p[2 * i]!; cy[g]! += p[2 * i + 1]!; counts[g]!++; displacement += (p[2 * i]! - seed[2 * i]!) ** 2 + (p[2 * i + 1]! - seed[2 * i + 1]!) ** 2; radius += p[2 * i]! ** 2 + p[2 * i + 1]! ** 2; }
  for (let g = 0; g < 16; g++) { cx[g]! /= counts[g]!; cy[g]! /= counts[g]!; between += (cx[g]! ** 2 + cy[g]! ** 2) * counts[g]!; }
  for (let i = 0; i < n; i++) within += (p[2 * i]! - cx[group[i]!]!) ** 2 + (p[2 * i + 1]! - cy[group[i]!]!) ** 2;
  const degree = new Uint32Array(n), hub = new Int32Array(n).fill(-1);
  for (const i of input.source) degree[i]!++; for (const i of input.target) degree[i]!++;
  const choose = (a: number, b: number) => { if (degree[b]! > degree[a]! && (hub[a]! < 0 || degree[b]! > degree[hub[a]!]! || degree[b] === degree[hub[a]!] && b < hub[a]!)) hub[a] = b; };
  for (let e = 0; e < input.source.length; e++) { choose(input.source[e]!, input.target[e]!); choose(input.target[e]!, input.source[e]!); }
  let hubDistance = 0, followers = 0;
  for (let i = 0; i < n; i++) if (hub[i]! >= 0) { const h = hub[i]!; hubDistance += (p[2 * i]! - p[2 * h]!) ** 2 + (p[2 * i + 1]! - p[2 * h + 1]!) ** 2; followers++; }
  return { n, edges: input.source.length, mode, hubGravity, iterations: solver.iteration, milliseconds: Math.round(performance.now() - start), displacement: Math.sqrt(displacement / n), radius: Math.sqrt(radius / n), relativeStep: solver.movement / Math.sqrt(radius / n), settled: solver.settled, cohesion: Math.sqrt(between / within), hubRadius: Math.sqrt(hubDistance / followers) };
}
if (import.meta.main) console.log(JSON.stringify(measureLarge(Number(process.argv[2] ?? 61000), process.argv[3] ?? 'owner', Number(process.argv[4] ?? 0))));
