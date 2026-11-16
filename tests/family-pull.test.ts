import { test, expect } from 'bun:test';
import { DEFAULT_LAYOUT, runLayout, runLayoutStream } from '../src/core/layout';
import { familyFixture, familyMetrics } from '../scripts/family-pull-benchmark';
import { buildProjection } from '../src/core/projection';
import { generationKey, declaredFacts } from '../src/core/generation';
import { digest, layoutDeclaration, identityDeclaration } from '../src/core/declaration';
import { WorkerPipeline, type Transport, type LayoutResult } from '../src/pipeline';
import type { BinaryGeneration } from '../src/core/binary-layout';
import { packRows } from '../src/core/columns';
const options = { ...DEFAULT_LAYOUT, iterations: 50 };

test('family pull is off by default; resolved parent attraction works independently of links', async () => {
  const { rows, declaration } = familyFixture(200), p = buildProjection(rows, declaration);
  const base = { count: 200, source: p.source, target: p.target, seed: 17 }, family = { ...base, up: p.up };
  expect(DEFAULT_LAYOUT.force.familyPull).toBe(0);
  expect(runLayout(family, options)).toEqual(runLayout(base, options));
  for (const barnesHutOptimize of [false, true]) {
    const o = { ...options, iterations: 100, force: { ...options.force, barnesHutOptimize, familyPull: 2 } };
    const result = runLayout(family, o);
    expect(result).toEqual(runLayout(family, o));
    expect(result).toEqual(await runLayoutStream(family, { ...o, batchIterations: 3 }, 7, () => {}, async () => {}));
    expect(familyMetrics(p, result).parentDistance).toBeLessThan(familyMetrics(p, runLayout(family, { ...o, force: { ...o.force, familyPull: 0 } })).parentDistance);
    const initial = result.slice(), movable = new Uint8Array(200); movable[1] = 1;
    const warm = runLayout({ ...family, initial, movable }, o);
    expect(warm.slice(4)).toEqual(initial.slice(4)); expect(warm.slice(0, 2)).toEqual(initial.slice(0, 2));
    expect(result).toEqual(initial);
  }
});
test('family pull accepts cycles and multiple parents, rejects malformed CSR and out-of-range settings', () => {
  const i = { count: 3, source: new Uint32Array(), target: new Uint32Array(), seed: 17, up: { offsets: Uint32Array.of(0, 2, 3, 4), targets: Uint32Array.of(1, 2, 0, 0) } };
  for (const force of [{}, { linLogMode: true }, { adjustSizes: true }, { outboundAttractionDistribution: true }, { strongGravityMode: true }]) {
    const p = runLayout(i, { ...options, force: { ...options.force, familyPull: 10, ...force } }); expect(p.every(Number.isFinite)).toBe(true);
  }
  for (const familyPull of [-1, 10.01, NaN, Infinity]) expect(() => runLayout(i, { ...options, force: { ...options.force, familyPull } })).toThrow('force.familyPull');
  for (const up of [{ offsets: Uint32Array.of(0), targets: new Uint32Array() }, { offsets: Uint32Array.of(0, 2, 1, 2), targets: Uint32Array.of(0, 0) }, { offsets: Uint32Array.of(0, 0, 0, 1), targets: Uint32Array.of(3) }]) expect(() => runLayout({ ...i, up }, options)).toThrow('hierarchy');
});
test('family off keeps historical bytes and saved positions; active family invalidates parent-only changes', async () => {
  const fixture = familyFixture(100), d = fixture.declaration, rows = fixture.rows;
  const legacy: any = structuredClone(options); delete legacy.force.familyPull;
  const legacyDeclaration = layoutDeclaration(d);
  const historical = await digest({ declaration: identityDeclaration(legacyDeclaration), layout: legacy, producer: 'fixture', rows: declaredFacts(rows, legacyDeclaration) });
  expect(await generationKey(rows, d, options, 'fixture')).toBe(historical);
  const changed = structuredClone(rows); changed[1]!.properties.branchRef = 'n50';
  expect(await generationKey(changed, d, options, 'fixture')).toBe(historical);
  const active = { ...options, iterations: 30, force: { ...options.force, familyPull: 2 } };
  expect(await generationKey(changed, d, active, 'fixture')).not.toBe(await generationKey(rows, d, active, 'fixture'));
  const pipeline = () => new WorkerPipeline(new Worker(new URL('../src/layout-worker.ts', import.meta.url).href) as unknown as Transport, () => 10000);
  for (const familyPull of [0, 2]) {
    let p = pipeline(); const c = { declaration: d, source: 'synthetic@1/local', groupLevel: 0, streamEveryIterations: 1, layout: { ...active, force: { ...active.force, familyPull } } };
    try {
      await p.request(1, { kind: 'configure', config: c });
      await p.request(1, { kind: 'rows', reset: true, columns: packRows(rows, d) });
      await p.request(1, { kind: 'project' });
      const before = await p.request<LayoutResult>(1, { kind: 'layout' });
      const saved = await p.request<BinaryGeneration>(1, { kind: 'encode' });
      // Simulate the previous writer, which did not know familyPull; off keys still load.
      if (!familyPull) delete (saved.meta.layout.force as any).familyPull;
      p.dispose(); p = pipeline();
      await p.request(2, { kind: 'configure', config: c });
      expect(await p.request(2, { kind: 'load', generation: saved })).toBeDefined();
      await p.request(2, { kind: 'rows', reset: true, columns: packRows(rows, d) });
      await p.request(2, { kind: 'project' });
      const exact = await p.request<LayoutResult>(2, { kind: 'layout' });
      expect(exact.reused).toBe('all'); expect(exact.positions).toEqual(before.positions);
      await p.request(3, { kind: 'rows', reset: true, columns: packRows(changed, d) });
      await p.request(3, { kind: 'project' });
      const after = await p.request<LayoutResult>(3, { kind: 'layout' });
      if (familyPull) { expect(after.reused).not.toBe('all'); expect(after.positions).not.toEqual(before.positions); }
      else { expect(after.reused).toBe('all'); expect(after.positions).toEqual(before.positions); }
      const preview = await p.request<LayoutResult>(3, { kind: 'recompute', options: { ...active, force: { ...active.force, familyPull: 5 } } });
      expect(preview.positions).not.toEqual(after.positions);
      const reset = await p.request<any>(4, { kind: 'configure', config: { ...c, layout: { ...active, force: { ...active.force, familyPull: 5 } } } });
      expect(reset.held).toBe(false);
    } finally { p.dispose(); }
  }
});
