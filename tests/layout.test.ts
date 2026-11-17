import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { DEFAULT_LAYOUT, LayoutSolver, initialPositions, random, runLayout, runLayoutStream } from '../src/core/layout';
import { BarnesHut } from '../src/core/barnes-hut';
import { buildProjection } from '../src/core/projection';
import { exampleDeclaration, fixture, clusteredFixture } from '../scripts/fixture';
import { recommendedPhysics } from '../src/recommend';
import { isolateRing } from '../src/core/layout';
import { layoutIdentity } from '../src/core/layout-options';
import { overlapPairs } from './support/overlap';
import { oracleLayout, layoutQuality, qualityDifference } from './support/layout-oracle';
import { defaults, upgradeSettings } from '../src/settings';
const projection = buildProjection(fixture(400, 1000), exampleDeclaration);
const input = { count: projection.paths.length, source: projection.source, target: projection.target, offsets: projection.offsets, targets: projection.targets, seed: 17 };
const options = { ...DEFAULT_LAYOUT, iterations: 50, force: { ...DEFAULT_LAYOUT.force, hubGravity: 0 } };
const hash = (p: Float32Array) => createHash('sha256').update(new Uint8Array(p.buffer)).digest('hex');
test('CSR solver is deterministic; stream cadence and task budget preserve integrator history', async () => {
  const first = runLayout(input, options), second = runLayout(input, options);
  expect(hash(first)).toBe(hash(second));
  let yielded = 0; const frames: Float32Array[] = [];
  const streamed = await runLayoutStream(input, { ...options, batchIterations: 2 }, 7, p => frames.push(p), async () => { yielded++; });
  expect(hash(streamed)).toBe(hash(first)); expect(frames.length).toBe(7); expect(yielded).toBeGreaterThan(20);
  expect(frames[0]).not.toEqual(initialPositions(input.count, input.seed ^ options.seed, options.initialRadius));
  expect(hash(runLayout({ ...input, seed: 18 }, options))).not.toBe(hash(first));
});
test('warm-start fixes untouched nodes exactly and never mutates saved input buffers', () => {
  const initial = runLayout(input, options), saved = initial.slice(), movable = new Uint8Array(input.count); movable[0] = 1; movable[1] = 1;
  const result = runLayout({ ...input, initial, movable }, options);
  expect(initial).toEqual(saved); expect(result.slice(4)).toEqual(saved.slice(4)); expect(result.slice(0, 4)).not.toEqual(saved.slice(0, 4));
  expect(runLayout({ ...input, initial, movable: new Uint8Array(input.count) }, options)).toEqual(saved);
});
test('bounded convergence and configurable iterations do not depend on wall clock', () => {
  const solver = new LayoutSolver(input, { ...options, convergenceThreshold: 1e20, convergenceIterations: 2 });
  while (!solver.done) solver.step();
  expect(solver.iteration).toBe(2);
  expect(solver.positions).toEqual(runLayout(input, { ...options, iterations: 2 }));
  const bounded = new LayoutSolver(input, { ...options, iterations: 3 }); while (!bounded.done) bounded.step(); expect(bounded.iteration).toBe(3);
});
test('Barnes-Hut force matches all-pairs at tiny theta and excludes self mass', () => {
  const p = initialPositions(100, 3, 100), mass = Float32Array.from({ length: 100 }, (_, i) => 2 + i % 5), out = new Float32Array(200), tree = new BarnesHut(100);
  // An early duplicate must not collapse a coarse cell containing later points.
  p[2] = p[0]!; p[3] = p[1]!;
  tree.build(p, mass, 32); tree.repulse(p, mass, out, 2, 1e-8);
  for (let i = 0; i < 100; i++) {
    let fx = 0, fy = 0;
    for (let j = 0; j < 100; j++) if (i !== j) { const dx = p[2 * i]! - p[2 * j]!, dy = p[2 * i + 1]! - p[2 * j + 1]!, d2 = dx * dx + dy * dy; if (d2) { const f = 2 * mass[i]! * mass[j]! / d2; fx += dx * f; fy += dy * f; } }
    expect(out[2 * i]!).toBeCloseTo(fx, 4); expect(out[2 * i + 1]!).toBeCloseTo(fy, 4);
  }
});
test('mid-theta Barnes-Hut relative force error stays below 5% against brute force', () => {
  for (const seed of [3, 17, 42]) {
    const count = 256, p = initialPositions(count, seed, 100);
    const mass = Float32Array.from({ length: count }, (_, i) => 2 + i % 5), out = new Float32Array(count * 2), tree = new BarnesHut(count);
    tree.build(p, mass, 32); tree.repulse(p, mass, out, 2, .7);
    let errorSquared = 0, forceSquared = 0;
    for (let i = 0; i < count; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < count; j++) if (i !== j) {
        const dx = p[2 * i]! - p[2 * j]!, dy = p[2 * i + 1]! - p[2 * j + 1]!, d2 = dx * dx + dy * dy;
        if (d2) { const factor = 2 * mass[i]! * mass[j]! / d2; fx += dx * factor; fy += dy * factor; }
      }
      errorSquared += (out[2 * i]! - fx) ** 2 + (out[2 * i + 1]! - fy) ** 2;
      forceSquared += fx * fx + fy * fy;
    }
    expect(Math.sqrt(errorSquared / forceSquared)).toBeLessThan(.05);
  }
});
test('degenerate buckets, self loops, parallel edges, disconnected/empty graphs remain finite', () => {
  for (const barnesHutOptimize of [false, true]) {
    const o = { ...options, force: { ...options.force, barnesHutOptimize } };
    expect(runLayout({ count: 0, source: new Uint32Array(), target: new Uint32Array(), seed: 1 }, o).length).toBe(0);
    for (const x of [0, 10]) {
      const result = runLayout({ count: 200, source: Uint32Array.of(0, 0, 0), target: Uint32Array.of(0, 1, 1), initial: new Float32Array(400).fill(x), seed: 1 }, o);
      expect(result.every(Number.isFinite)).toBe(true);
    }
  }
});
test('edge-only compatibility protocol and CSR produce identical layouts', () => {
  const { offsets, targets, ...legacy } = input;
  expect(runLayout(input, options)).toEqual(runLayout(legacy, options));
});
test('20-step all-pairs FA2 preserves oracle integration history with overlap mode off', () => {
  // Size-aware repulsion and its adaptive integrator intentionally diverge; see ADR-0006.
  for (const overrides of [{}, { linLogMode: true }, { strongGravityMode: true }, { outboundAttractionDistribution: true }]) {
    const o = { ...options, iterations: 20, force: { ...options.force, barnesHutOptimize: false, ...overrides } };
    const own = runLayout(input, o), oracle = oracleLayout(input, o);
    expect(Math.max(...own.map((v, i) => Math.abs(v - oracle[i]!)))).toBeLessThan(1e-6);
  }
});
test('fixed-seed FA2 differential: stress delta ≤0.08 and normalized edge quantiles within 25%', () => {
  for (const seed of [1, 17, 42]) for (const literal of [false, true]) {
    const p = buildProjection(fixture(300, 900), { ...exampleDeclaration, display: { reifiedAsNodes: literal } });
    const i = { count: p.paths.length, source: p.source, target: p.target, offsets: p.offsets, targets: p.targets, seed };
    const a = layoutQuality(i, runLayout(i, options)), b = layoutQuality(i, oracleLayout(i, options)), difference = qualityDifference(a, b);
    expect(difference.stressAbsolute).toBeLessThan(.08); expect(difference.maxQuantileRelative).toBeLessThan(.25);
    // Normalized distributions alone can hide a globally weakened repulsion.
    expect(Math.abs(difference.medianScaleRatio - 1)).toBeLessThan(.15);
  }
});
test('invalid endpoints, coordinates, masks, CSR and solver knobs refuse explicitly', () => {
  for (const bad of [{ ...input, source: Uint32Array.of(999999), target: Uint32Array.of(0) }, { ...input, initial: Float32Array.of(NaN) }, { ...input, movable: new Uint8Array(1) }, { ...input, offsets: new Uint32Array(1) }]) expect(() => runLayout(bad, options)).toThrow();
  expect(() => runLayout(input, { ...options, batchIterations: 0 })).toThrow();
  expect(() => runLayout(input, { ...options, convergenceThreshold: -1 })).toThrow();
});
test('0.1 settings gain the new numerical/scheduling knobs without losing prior choices', () => {
  const s = defaults('p@1'); const legacy = JSON.parse(JSON.stringify(s));
  for (const key of ['batchIterations', 'convergenceThreshold', 'convergenceIterations', 'maxTreeDepth', 'nodeRadius', 'maxForce']) delete legacy.layout[key];
  legacy.layout.iterations = 77;
  const upgraded = upgradeSettings(legacy, 'p@1'); expect(upgraded.layout.iterations).toBe(77); expect(upgraded.layout.batchIterations).toBe(DEFAULT_LAYOUT.batchIterations);
});
test('centering: normal gravity rings disconnected parts far out, strong gravity pulls them in; both match graphology', () => {
  // Synthetic: a 500-note part (tree plus 300 links), 250 notes in pairs, 250 isolated notes. Owner room force values.
  const n = 1000, src: number[] = [], dst: number[] = [], rng = random(5);
  for (let i = 1; i < 500; i++) { src.push(i); dst.push(Math.floor(rng() * i)); }
  for (let k = 0; k < 300; k++) { const a = Math.floor(rng() * 500), b = Math.floor(rng() * 500); if (a !== b) { src.push(a); dst.push(b); } }
  for (let i = 500; i < 750; i += 2) { src.push(i); dst.push(i + 1); }
  const seed = random(7 ^ DEFAULT_LAYOUT.seed);
  const g = { count: n, source: Uint32Array.from(src), target: Uint32Array.from(dst), seed: 7, initial: Float32Array.from({ length: n * 2 }, () => (seed() - .5) * 100) };
  const room = (strongGravityMode: boolean, gravity: number) => ({ ...DEFAULT_LAYOUT, force: { ...DEFAULT_LAYOUT.force, hubGravity: 0, scalingRatio: 23.64, gravity, strongGravityMode, slowDown: 3.607, barnesHutTheta: .369 } });
  const median = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1]!;
  const ring = (p: Float32Array) => {
    let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += p[2 * i]! / n; cy += p[2 * i + 1]! / n; }
    const r = (i: number) => Math.hypot(p[2 * i]! - cx, p[2 * i + 1]! - cy), all = Array.from({ length: n }, (_, i) => r(i));
    return { ratio: median(all.slice(750)) / median(all.slice(0, 500)), offset: Math.hypot(cx, cy) / Math.max(...all) };
  };
  const weak = ring(runLayout(g, room(false, .5))), strong = ring(runLayout(g, room(true, .15)));
  // Gravity is applied about the origin and the cloud stays centered there: no centering bug.
  expect(weak.offset).toBeLessThan(.05); expect(strong.offset).toBeLessThan(.05);
  expect(weak.ratio).toBeGreaterThan(3); expect(strong.ratio).toBeLessThan(2.2);
  // The far ring is the reference ForceAtlas2 behaviour, not a solver error.
  for (const [mine, strongMode, gravity] of [[weak, false, .5], [strong, true, .15]] as const)
    expect(Math.abs(ring(oracleLayout(g, room(strongMode, gravity))).ratio / mine.ratio - 1)).toBeLessThan(.1);
});

test('cold seeds are deterministic discs whose radius grows with square root of note count', () => {
  const small = initialPositions(100, 7, 10), large = initialPositions(400, 7, 10);
  expect(small).toEqual(initialPositions(100, 7, 10));
  for (let i = 0; i < 100; i++) {
    expect(Math.hypot(small[i * 2]!, small[i * 2 + 1]!)).toBeLessThanOrEqual(100.001);
    expect(large[i * 2]).toBeCloseTo(small[i * 2]! * 2, 4);
  }
});
test('budget exhaustion is not settlement; explicit quiet runs report settlement', async () => {
  let settled = true;
  await runLayoutStream(input, { ...options, iterations: 1 }, 1, () => {}, async () => {}, undefined, value => { settled = value; });
  expect(settled).toBe(false);
  const quiet = new LayoutSolver(input, { ...options, convergenceThreshold: 1e20 });
  while (!quiet.done) quiet.step(); expect(quiet.settled).toBe(true);
});
test('isolates use ordered outer rings without moving connected or pinned notes', async () => {
  const { isolateRing } = await import('../src/core/layout');
  const p = Float32Array.of(-10, 0, 10, 0, 400, 400, -300, -300);
  const arrange = isolateRing({ count: 4, source: Uint32Array.of(0), target: Uint32Array.of(1), seed: 1 });
  arrange(p); expect(p.slice(0, 4)).toEqual(Float32Array.of(-10, 0, 10, 0));
  expect(Math.hypot(p[4]!, p[5]!)).toBeCloseTo(10.8, 4); expect(p[4]).toBeCloseTo(-p[6]!, 4);
  const pinned = p.slice(); isolateRing({ count: 4, source: Uint32Array.of(0), target: Uint32Array.of(1), seed: 1, movable: Uint8Array.of(1, 1, 0, 0) })(p); expect(p).toEqual(pinned);
});
test('mass hub pull is default-on, finite, deterministic and inert when no larger neighbours exist', async () => {
  const { layoutIdentity, validateLayout } = await import('../src/core/layout-options');
  expect(DEFAULT_LAYOUT.force.hubGravity).toBe(2);
  const off = { ...options, force: { ...options.force, hubGravity: 0 } }, on = { ...off, force: { ...off.force, hubGravity: 2 } };
  expect(layoutIdentity(off).force).not.toHaveProperty('hubGravity'); expect(layoutIdentity(on).force).toHaveProperty('hubGravity', 2);
  for (const hubGravity of [-1, 10.01, NaN, Infinity]) expect(() => validateLayout({ ...off, force: { ...off.force, hubGravity } })).toThrow();
  const count = 60, ring = { count, source: Uint32Array.from({ length: count }, (_, i) => i), target: Uint32Array.from({ length: count }, (_, i) => (i + 1) % count), seed: 1 };
  expect(runLayout(ring, on)).toEqual(runLayout(ring, off));
  const star = { ...ring, source: new Uint32Array(count - 1), target: Uint32Array.from({ length: count - 1 }, (_, i) => i + 1) };
  const radius = (p: Float32Array) => Array.from({ length: count - 1 }, (_, i) => Math.hypot(p[(i + 1) * 2]! - p[0]!, p[(i + 1) * 2 + 1]! - p[1]!)).reduce((a, b) => a + b, 0);
  const base = runLayout(star, off), pulled = runLayout(star, on);
  expect(pulled.every(Number.isFinite)).toBe(true); expect(pulled).toEqual(runLayout(star, on)); expect(radius(pulled)).toBeLessThan(radius(base));
});
test('review: stationary layouts can settle with a one-step budget', () => {
  const solver = new LayoutSolver({ count: 1, source: new Uint32Array(), target: new Uint32Array(), seed: 1, initial: Float32Array.of(0, 0) }, { ...options, iterations: 1, convergenceIterations: 3 });
  solver.step(); expect(solver.settled).toBe(true);
});
test('review: new isolate never occupies a pinned isolate slot', async () => {
  const { isolateRing } = await import('../src/core/layout');
  const source = Uint32Array.of(0), target = Uint32Array.of(1), p = Float32Array.of(-10, 0, 10, 0, 0, 0, 0, 0);
  isolateRing({ count: 3, source, target, seed: 1 })(p);
  const pinned = p.slice(4, 6);
  isolateRing({ count: 4, source, target, seed: 1, movable: Uint8Array.of(0, 0, 0, 1) })(p);
  expect(p.slice(4, 6)).toEqual(pinned); expect(Math.hypot(p[6]! - p[4]!, p[7]! - p[5]!)).toBeGreaterThan(.1);
});

test('15k-note isolate presentation forms complete evenly spaced rings, never flattened edge patches', async () => {
  const { isolateRing } = await import('../src/core/layout');
  const count = 15000, linked = 10000;
  const source = Uint32Array.from({ length: linked - 1 }, (_, i) => i), target = Uint32Array.from(source, i => i + 1);
  const p = initialPositions(count, 18, 100), before = p.slice(0, linked * 2);
  let radius = 1; for (let i = 0; i < linked; i++) radius = Math.max(radius, Math.hypot(p[2 * i]!, p[2 * i + 1]!));
  isolateRing({ count, source, target, seed: 18 })(p);
  expect(p.slice(0, linked * 2)).toEqual(before);
  const capacity = Math.ceil(Math.sqrt(count) * 6);
  for (let first = linked; first < count; first += capacity) {
    const size = Math.min(capacity, count - first), expectedRadius = radius * (1.08 + Math.floor((first - linked) / capacity) * .04);
    let cx = 0, cy = 0;
    for (let i = 0; i < size; i++) {
      const n = first + i, next = first + (i + 1) % size, x = p[2 * n]!, y = p[2 * n + 1]!;
      expect(Math.abs(Math.hypot(x, y) - expectedRadius)).toBeLessThan(.002);
      expect(Math.abs(Math.hypot(x - p[2 * next]!, y - p[2 * next + 1]!) - 2 * expectedRadius * Math.sin(Math.PI / size))).toBeLessThan(.003);
      cx += x / size; cy += y / size;
    }
    expect(Math.hypot(cx, cy)).toBeLessThan(.001);
  }
});

test('overlap convergence restarts after a temporarily balanced node has zero force', () => {
  const initial = Float32Array.of(0, 0, -1, 0, 1, 0, 0, 1, 0, -1);
  const solver = new LayoutSolver({ count: 5, source: Uint32Array.of(0, 0, 2), target: Uint32Array.of(1, 3, 4), initial, seed: 1 }, { ...options, iterations: 40, force: { ...options.force, adjustSizes: true, barnesHutOptimize: false, gravity: 0 } });
  solver.step(); expect(solver.positions.slice(0, 2)).toEqual(Float32Array.of(0, 0));
  while (!solver.done) solver.step();
  expect(Math.hypot(solver.positions[0]!, solver.positions[1]!)).toBeGreaterThan(.01);
  expect(solver.positions.every(Number.isFinite)).toBe(true); expect(initial).toEqual(Float32Array.of(0, 0, -1, 0, 1, 0, 0, 1, 0, -1));
});

test('overlap settlement compensates damping without feeding it into convergence', () => {
  const solver = new LayoutSolver({ count: 1, source: new Uint32Array(), target: new Uint32Array(), initial: Float32Array.of(4, 0), seed: 1 }, { ...options, iterations: 300, force: { ...options.force, adjustSizes: true, gravity: .5, strongGravityMode: false } });
  for (let i = 0; i < 30; i++) {
    solver.step();
    // With constant gravity, undamped adaptive motion still exceeds the relative threshold.
    expect(solver.settled).toBe(false);
  }
});

test('Prevent overlap reduces drawn-disc collisions at home and close zoom on seeded 5k hubs', () => {
  const p = buildProjection(clusteredFixture(2000, 3000, 17, 24), { ...exampleDeclaration, display: { reifiedAsNodes: true } });
  const input = { count: p.paths.length, source: p.source, target: p.target, offsets: p.offsets, targets: p.targets, seed: 17 };
  const { iterations, ...force } = recommendedPhysics(input.count, p.source.length);
  const result = [false, true].map(adjustSizes => {
    const solver = new LayoutSolver(input, { ...DEFAULT_LAYOUT, iterations, force: { ...DEFAULT_LAYOUT.force, ...force, adjustSizes } });
    while (!solver.done) solver.step();
    // The old capped mode falsely declared these still-moving cold seeds settled.
    expect(solver.settled).toBe(false);
    isolateRing(input)(solver.positions); return solver.positions;
  });
  for (const zoom of [1, .2]) expect(overlapPairs(p, result[1]!, zoom)).toBeLessThanOrEqual(overlapPairs(p, result[0]!, zoom));
  expect(overlapPairs(p, result[1]!, .2, 25)).toBeLessThanOrEqual(overlapPairs(p, result[0]!, .2, 25));
});

test('size-aware tree matches softened all-pairs at tiny theta and excludes coincident self mass', () => {
  const p = initialPositions(40, 3, 10), mass = Float32Array.from({ length: 40 }, (_, i) => 2 + i % 5), radii = Float32Array.from({ length: 40 }, (_, i) => 1 + i % 4);
  p[2] = p[0]!; p[3] = p[1]!; radii[0] = radii[1] = 4;
  const tree = new BarnesHut(40), out = new Float32Array(80); tree.build(p, mass, 32); tree.repulse(p, mass, out, 2, 1e-8, undefined, radii);
  for (let i = 0; i < 40; i++) {
    let fx = 0, fy = 0;
    for (let j = 0; j < 40; j++) if (i !== j) {
      const dx = p[2 * i]! - p[2 * j]!, dy = p[2 * i + 1]! - p[2 * j + 1]!, d = Math.hypot(dx, dy), gap = Math.max(d * .5, d - radii[i]! - radii[j]!);
      if (gap > 0) { const f = 2 * mass[i]! * mass[j]! / (gap * gap); fx += dx * f; fy += dy * f; }
    }
    expect(out[2 * i]!).toBeCloseTo(fx, 3); expect(out[2 * i + 1]!).toBeCloseTo(fy, 3);
  }
  const pinned = new Float32Array(80); tree.repulse(p, mass, pinned, 2, .8, new Uint8Array(40), radii); expect(pinned.every(v => v === 0)).toBe(true);
});

test('size-aware aggregate cells use the maximum radius, not their retained first-member index', () => {
  const p = Float32Array.of(0, 0, 100, 100, 101, 101), mass = new Float32Array(3).fill(1), radii = Float32Array.of(1, 1, 10), out = new Float32Array(6);
  const tree = new BarnesHut(3); tree.build(p, mass, 32); tree.repulse(p, mass, out, 1, 1, undefined, radii);
  const gap = Math.hypot(100.5, 100.5) - 1 - 10, expected = -100.5 * 2 / (gap * gap);
  expect(out[0]!).toBeCloseTo(expected, 6); expect(out[1]!).toBeCloseTo(expected, 6);
});

test('overlap migration changes only active layout identity; pinned coordinates and streaming stay deterministic', async () => {
  const off = { ...options, force: { ...options.force, adjustSizes: false } }, on = { ...options, force: { ...options.force, adjustSizes: true } };
  expect(Object.hasOwn(layoutIdentity(off), 'overlap')).toBe(false); expect(layoutIdentity(on).overlap).toBe(2);
  const { overlap, ...legacy } = layoutIdentity(on); expect(overlap).toBe(2); expect(JSON.stringify(legacy)).not.toBe(JSON.stringify(layoutIdentity(on)));
  const initial = runLayout(input, off), saved = initial.slice(), movable = new Uint8Array(input.count); movable[0] = 1;
  const warm = { ...input, initial, movable }, expected = runLayout(warm, on);
  expect(expected.slice(2)).toEqual(saved.slice(2)); expect(initial).toEqual(saved);
  expect(await runLayoutStream(warm, on, 3, () => {}, async () => {})).toEqual(expected);
});
