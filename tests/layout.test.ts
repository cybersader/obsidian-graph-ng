import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { DEFAULT_LAYOUT, LayoutSolver, initialPositions, runLayout, runLayoutStream } from '../src/core/layout';
import { BarnesHut } from '../src/core/barnes-hut';
import { buildProjection } from '../src/core/projection';
import { exampleDeclaration, fixture } from '../scripts/fixture';
import { oracleLayout, layoutQuality, qualityDifference } from './support/layout-oracle';
import { defaults, upgradeSettings } from '../src/settings';
const projection = buildProjection(fixture(400, 1000), exampleDeclaration);
const input = { count: projection.paths.length, source: projection.source, target: projection.target, offsets: projection.offsets, targets: projection.targets, seed: 17 };
const options = { ...DEFAULT_LAYOUT, iterations: 50 };
const hash = (p: Float32Array) => createHash('sha256').update(new Uint8Array(p.buffer)).digest('hex');
test('CSR solver is deterministic; stream cadence and task budget preserve integrator history', async () => {
  const first = runLayout(input, options), second = runLayout(input, options);
  expect(hash(first)).toBe(hash(second));
  let yielded = 0; const frames: Float32Array[] = [];
  const streamed = await runLayoutStream(input, { ...options, batchIterations: 2 }, 7, p => frames.push(p), async () => { yielded++; });
  expect(hash(streamed)).toBe(hash(first)); expect(frames.length).toBe(8); expect(yielded).toBeGreaterThan(20);
  expect(frames[0]).toEqual(initialPositions(input.count, input.seed ^ options.seed, options.initialRadius));
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
test('20-step all-pairs FA2 preserves oracle integration history across supported force modes', () => {
  for (const overrides of [{}, { linLogMode: true }, { strongGravityMode: true }, { outboundAttractionDistribution: true }, { adjustSizes: true }]) {
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
