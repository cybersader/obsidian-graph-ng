import { DEFAULT_LAYOUT, LayoutSolver, random, type LayoutOptions } from '../src/core/layout';
import { recommendedPhysics } from '../src/recommend';
import { oracleLayout } from '../tests/support/layout-oracle';
/** Synthetic: one giant component, many small components, isolates. Deterministic. */
function synth(n: number, seed = 7) {
  const rng = random(seed), src: number[] = [], dst: number[] = [], comp = new Int32Array(n);
  const giant = Math.round(n * .5), isolates = Math.round(n * .2);
  for (let i = 1; i < giant; i++) { src.push(i); dst.push(Math.floor(rng() * i)); }
  for (let k = 0; k < giant * .6; k++) { const a = Math.floor(rng() * giant), b = Math.floor(rng() * giant); if (a !== b) { src.push(a); dst.push(b); } }
  let i = giant, c = 1;
  while (i < n - isolates) { const size = Math.min(n - isolates - i, 2 + Math.floor(rng() * 5)); for (let j = 1; j < size; j++) { src.push(i + j); dst.push(i + Math.floor(rng() * j)); } for (let j = 0; j < size; j++) comp[i + j] = c; c++; i += size; }
  for (; i < n; i++) comp[i] = c++;
  const deg = new Uint32Array(n); for (let e = 0; e < src.length; e++) { deg[src[e]!]!++; deg[dst[e]!]!++; }
  const offsets = new Uint32Array(n + 1); for (let v = 0; v < n; v++) offsets[v + 1] = offsets[v]! + deg[v]!;
  const fill = offsets.slice(0, n), targets = new Uint32Array(offsets[n]!);
  for (let e = 0; e < src.length; e++) { targets[fill[src[e]!]!++] = dst[e]!; targets[fill[dst[e]!]!++] = src[e]!; }
  return { input: { count: n, source: Uint32Array.from(src), target: Uint32Array.from(dst), offsets, targets, seed }, comp, giant, isolates, components: c };
}
function measure(p: Float32Array, g: ReturnType<typeof synth>) {
  const n = g.input.count; let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += p[2 * i]!; cy += p[2 * i + 1]!; } cx /= n; cy /= n;
  const r = new Float64Array(n); for (let i = 0; i < n; i++) r[i] = Math.hypot(p[2 * i]! - cx, p[2 * i + 1]! - cy);
  const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]!; };
  let extent = 0; for (const x of r) extent = Math.max(extent, x);
  const giantR: number[] = [], isoR: number[] = [];
  for (let i = 0; i < n; i++) { if (i < g.giant) giantR.push(r[i]!); else if (i >= n - g.isolates) isoR.push(r[i]!); }
  const sx = new Float64Array(g.components), sy = new Float64Array(g.components), cnt = new Float64Array(g.components);
  for (let i = g.giant; i < n; i++) { const k = g.comp[i]!; sx[k]! += p[2 * i]!; sy[k]! += p[2 * i + 1]!; cnt[k]!++; }
  let spread = 0, m = 0; for (let k = 1; k < g.components; k++) if (cnt[k]) { spread += (sx[k]! / cnt[k]! - cx) ** 2 + (sy[k]! / cnt[k]! - cy) ** 2; m++; }
  const giantMed = med(giantR);
  let in25 = 0, in50 = 0; for (const x of r) { if (x <= extent * .25) in25++; if (x <= extent * .5) in50++; }
  return {
    within25: in25 / n, within50: in50 / n,
    giantShare: giantMed / extent, isolateOverGiant: med(isoR) / giantMed, componentSpread: Math.sqrt(spread / m) / giantMed,
    centroidOffset: Math.hypot(cx, cy) / extent,
  };
}
function run(g: ReturnType<typeof synth>, o: LayoutOptions) {
  const s = new LayoutSolver(g.input, o), moves: number[] = [];
  while (!s.done) { s.step(); moves.push(s.movement); }
  const m = measure(s.positions, g);
  let ext = 0; for (let i = 0; i < s.positions.length; i += 2) ext = Math.max(ext, Math.hypot(s.positions[i]!, s.positions[i + 1]!));
  return { ...m, lastMoveOverExtent: moves.at(-1)! / ext, moveRatio10: moves.at(-1)! / moves[Math.max(0, moves.length - 11)]!, extent: ext };
}
const owner = (over: Partial<LayoutOptions['force']> = {}, iterations = 100): LayoutOptions => ({ ...DEFAULT_LAYOUT, iterations, force: { ...DEFAULT_LAYOUT.force, scalingRatio: 23.64, gravity: .5, strongGravityMode: false, slowDown: 3.607, barnesHutOptimize: true, barnesHutTheta: .369, linLogMode: false, edgeWeightInfluence: 1, ...over } });
const results: unknown[] = [];
{
  const N = Number(process.env.N ?? 16000), g = synth(N);
  const rec = recommendedPhysics(N, g.input.source.length);
  const cases: [string, LayoutOptions][] = [
    ['owner', owner()],
    ['defaults', { ...DEFAULT_LAYOUT }],
    ['owner+theta1.2', owner({ barnesHutTheta: 1.2 })],
    ['owner+slowDown1', owner({ slowDown: 1 })],
    ['owner+500it', owner({}, 500)],
    ['owner+gravity5', owner({ gravity: 5 })],
    ['owner+strong g0.15', owner({ strongGravityMode: true, gravity: .15 })],
    ['owner+strong g0.5', owner({ strongGravityMode: true, gravity: .5 })],
    ['owner+strong g0.15 sd1', owner({ strongGravityMode: true, gravity: .15, slowDown: 1 })],
    ['recommended', { ...DEFAULT_LAYOUT, iterations: rec.iterations, force: { ...DEFAULT_LAYOUT.force, ...Object.fromEntries(Object.entries(rec).filter(([k]) => k !== 'iterations')) } as LayoutOptions['force'] }],
  ];
  if (process.env.ORACLE) for (const name of process.env.ORACLE.split(',')) {
    const o = cases.find(c => c[0] === name)![1], p = oracleLayout(g.input, o), r = measure(p, g);
    const row = { name: `graphology:${name}`, N, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toPrecision(3)])) }; results.push(row); console.log(JSON.stringify(row));
  }
  for (const name of (process.env.CASES ?? cases.map(c => c[0]).join(',')).split(',')) {
    const o = cases.find(c => c[0] === name)![1], t = performance.now(), r = run(g, o);
    const row = { name, N, edges: g.input.source.length, ms: Math.round(performance.now() - t), ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toPrecision(3)])) }; results.push(row); console.log(JSON.stringify(row));
  }
}
await Bun.write('.workspace/evidence/centering-benchmark.json', JSON.stringify({ command: 'N=16000 bun run bench:centering', runtime: Bun.version, method: 'Synthetic: half the notes in one part (random tree plus 0.6 extra links per note), 30% in parts of 2 to 6 notes, 20% isolated. Real LayoutSolver; metrics around the node centroid. isolateOverGiant = median isolated-note radius over median main-part radius; componentSpread = RMS centroid radius of the other parts over the main-part median radius; lastMoveOverExtent = RMS step of the final iteration over the layout radius.', results }, null, 2) + '\n');
