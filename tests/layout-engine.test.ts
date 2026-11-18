import { test, expect } from 'bun:test';
import { LayoutEngineSession } from '../src/layout-engine';
import { chooseLayoutEngine, engineBucket, engineTimings, layoutEngineText } from '../src/layout-engine-policy';
import { adapterSupports, computeRequirements, type ComputeAdapter, type GraphicsSolver } from '../src/webgpu-layout';
import { DEFAULT_LAYOUT, LayoutSolver, type LayoutInput } from '../src/core/layout';
import { DevicePerformanceStore, sharedPerformanceData } from '../src/device-performance';

const input = (count = 32): LayoutInput => ({ count, source: new Uint32Array(), target: new Uint32Array(), seed: 17 });
const options = () => ({ ...structuredClone(DEFAULT_LAYOUT), iterations: 8 });
const adapter = { limits: new Proxy({}, { get: () => 1e12 }) } as ComputeAdapter;
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const run = (preference: 'auto' | 'processor' | 'graphics' = 'auto') => ({ preference, every: 4, stopped: () => false, yieldNow: () => Promise.resolve(), emit() {} });
function fakeGraphics(i: LayoutInput, o = options()): GraphicsSolver & { destroyed: boolean } {
  let solver = new LayoutSolver(i, o);
  return { destroyed: false, reset() { solver = new LayoutSolver(i, o); }, async batch(n) { for (let j = 0; j < n; j++) solver.step(); return { positions: solver.positions.slice(), movement: solver.movement, quiet: solver.settled ? 3 : 0 }; }, destroy() { this.destroyed = true; } };
}
test('Auto includes setup, requires 1.5x, rejects small/slow/invalid samples and gates quality', () => {
  expect(chooseLayoutEngine(20000, 100, 4, 40, 4, 10, true).engine).toBe('graphics');
  expect(chooseLayoutEngine(4999, 100, 4, 40, 4, 100, true).engine).toBe('processor');
  expect(chooseLayoutEngine(20000, 100, 4, 40, 40, 100, true).engine).toBe('processor');
  expect(chooseLayoutEngine(20000, 4, 4, 40, 4, 100, true).engine).toBe('processor');
  expect(chooseLayoutEngine(20000, 100, 4, 40, 4, 100, false).engine).toBe('processor');
  expect(chooseLayoutEngine(20000, 1000, 4, 40, 4, 100, true).engine).toBe('processor'); // Never amortize away an expensive setup.
  for (const bad of [NaN, Infinity, -1]) expect(chooseLayoutEngine(20000, 100, 4, bad, 4, 0, true).engine).toBe('processor');
  expect(engineBucket(5000)).toBe(engineBucket(9999)); expect(engineBucket(10000)).not.toBe(engineBucket(9999));
});
test('capability admission checks every required limit without adapter identity strings', () => {
  const r = computeRequirements(input(20000), options())!;
  expect(adapterSupports(adapter, r)).toBe(true);
  for (const k of Object.keys(r)) expect(adapterSupports({ limits: { ...r, [k]: r[k]! - 1 } } as ComputeAdapter, r)).toBe(false);
  expect(computeRequirements(input(1), options())).toBeUndefined();
  const o = options(); o.force.barnesHutOptimize = false; expect(computeRequirements(input(20000), o)).toBeUndefined();
});
test('small Auto and forced Processor never probe WebGPU', async () => {
  let probes = 0;
  const session = new LayoutEngineSession({ adapter: async () => { probes++; return adapter; } });
  expect((await session.run(input(), options(), run())).engineStatus.engine).toBe('processor');
  await session.run(input(5000), options(), run('processor')); expect(probes).toBe(0);
});
test('absent WebGPU falls back without changing Processor coordinates', async () => {
  const i = input(5000), o = options(), session = new LayoutEngineSession({ adapter: async () => undefined });
  const a = await session.run(i, o, run()), b = await session.run(i, o, run('processor'));
  expect(a.engineStatus.reason).toBe('unavailable'); expect(a.positions).toEqual(b.positions);
});
test('manual Graphics uses capability, and reports absent graphics in status', async () => {
  let graphics: ReturnType<typeof fakeGraphics>;
  const session = new LayoutEngineSession({ adapter: async () => adapter, graphics: async (_, i, o) => graphics = fakeGraphics(i, o) });
  const a = await session.run(input(), options(), run('graphics'));
  expect(a.engineStatus.engine).toBe('graphics'); expect(graphics!.destroyed).toBe(true);
  const absent = await new LayoutEngineSession({ adapter: async () => undefined }).run(input(), options(), run('graphics'));
  expect(layoutEngineText(absent.engineStatus)).toBe('Processor (graphics unavailable)');
});
test('Auto races real input and remembers fast/slow outcomes with fake timing', async () => {
  for (const slow of [false, true]) {
    const times = [0, 10, 10, 110, 110, slow ? 310 : 111]; let calls = 0;
    const i = input(5000), o = options();
    const session = new LayoutEngineSession({ adapter: async () => adapter, now: () => times.shift() ?? 400, graphics: async (_, received, actual) => { calls++; expect(received).toBe(i); expect(actual).toBe(o); return fakeGraphics(i, o); } });
    const result = await session.run(i, o, run());
    expect(result.engineStatus.engine).toBe(slow ? 'processor' : 'graphics'); expect(calls).toBe(1);
    const again = await session.run(i, o, { ...run(), remembered: [result.engineStatus.timing!] });
    expect(again.engineStatus.engine).toBe(result.engineStatus.engine); expect(calls).toBe(slow ? 1 : 2);
    expect(again.positions).toEqual(result.positions);
  }
});
test('graphics output is repeatable for seed and engine, including warm pinned positions', async () => {
  const i = input(), o = options(); i.initial = new LayoutSolver(i, o).positions; i.movable = new Uint8Array(i.count).fill(1); i.movable[0] = 0;
  const session = new LayoutEngineSession({ adapter: async () => adapter, graphics: async (_, x, y) => fakeGraphics(x, y) });
  const a = await session.run(i, o, run('graphics')), b = await session.run(i, o, run('graphics'));
  expect(a.positions).toEqual(b.positions); expect(a.positions[0]).toBe(i.initial[0]); expect(a.positions[1]).toBe(i.initial[1]);
});
test('device/pipeline/validation failures, nonfinite output and watchdog disable graphics for the session', async () => {
  for (const fault of ['device', 'pipeline', 'validation', 'nan', 'inf', 'watchdog']) {
    let attempts = 0, destroyed = false;
    const session = new LayoutEngineSession({ watchdogMs: 5, adapter: async () => adapter, graphics: async () => {
      attempts++;
      if (fault === 'pipeline') throw Error('pipeline');
      return { reset() {}, destroy() { destroyed = true; }, async batch() {
        if (fault === 'watchdog') return new Promise(() => {});
        if (fault === 'nan' || fault === 'inf') return { positions: new Float32Array(64).fill(fault === 'nan' ? NaN : Infinity), movement: 0, quiet: 0 };
        throw Error(fault);
      } };
    } });
    const a = await session.run(input(), options(), run('graphics'));
    expect(a.engineStatus.reason).toBe('failed'); expect(a.positions.every(Number.isFinite)).toBe(true);
    await session.run(input(), options(), run('graphics')); expect(attempts).toBe(1);
    if (fault !== 'pipeline') expect(destroyed).toBe(true);
  }
});
test('fallback continues from the last validated graphics positions, never a failed readback', async () => {
  const i = input(), o = options(), checkpoint = new Float32Array(i.count * 2).fill(2); let batches = 0;
  const session = new LayoutEngineSession({ adapter: async () => adapter, graphics: async () => ({ reset() {}, destroy() {}, async batch() {
    if (batches++) throw Error('device lost'); return { positions: checkpoint.slice(), movement: 1, quiet: 0 };
  } }) });
  const result = await session.run(i, o, run('graphics'));
  const expected = new LayoutSolver({ ...i, initial: checkpoint }, { ...o, iterations: 4 }); while (!expected.done) expected.step();
  expect(result.positions).toEqual(expected.positions);
});
test('Stop aborts a blocked GPU operation promptly and destroys buffers', async () => {
  let stopped = false, destroyed = false, started!: () => void;
  const ready = new Promise<void>(r => started = r);
  const session = new LayoutEngineSession({ adapter: async () => adapter, graphics: async () => ({ reset() {}, destroy() { destroyed = true; }, batch() { started(); return new Promise(() => {}); } }) });
  const task = session.run(input(), options(), { ...run('graphics'), stopped: () => stopped, yieldNow: tick });
  await ready; const start = performance.now(); stopped = true; session.stop(); const result = await task;
  expect(performance.now() - start).toBeLessThan(50); expect(destroyed).toBe(true); expect(result.settled).toBe(false);
});
test('device cache is numeric-only, bucket/version keyed and never enters shared data', () => {
  const data = new Map<string, string>(), access = () => ({ getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } });
  const s = new DevicePerformanceStore('a'.repeat(32), 'graph-ng', access);
  const timing = { ...chooseLayoutEngine(20000, 100, 4, 40, 4, 10, true), path: 'Synthetic/Note.md', adapter: 'synthetic identifier' };
  s.rememberLayout('0.5.2', timing);
  expect(JSON.parse([...data.values()][0]!).flat().every(Number.isFinite)).toBe(true);
  const next = new DevicePerformanceStore('a'.repeat(32), 'graph-ng', access);
  expect(next.layoutChoices('0.5.2')).toEqual(engineTimings([timing])); expect(next.layoutChoices('0.5.3')).toEqual([]);
  expect([...data.values()].join()).not.toContain('Synthetic'); expect([...data.values()].join()).not.toContain('adapter');
  expect(Object.keys(sharedPerformanceData({ settings: { layoutEngine: 'graphics' } }).settings)).toEqual([]);
  const denied = new DevicePerformanceStore('b'.repeat(32), 'graph-ng', () => { throw Error('denied'); }); denied.rememberLayout('0.5.2', timing);
  expect(denied.layoutChoices('0.5.2')).toHaveLength(1);
  expect(engineTimings([{ ...timing, setupMs: Infinity }, { ...timing, bucket: 99 }])).toEqual([]);
});

test('interruptible tree and force chunks keep exact Processor positions and discard interrupted scratch', async () => {
  const graph = input(5200), o = options();
  const clock = performance.now; let elapsed = 0;
  performance.now = () => (elapsed += 10);
  try {
    for (const engine of ['js', 'auto'] as const) {
      const atomic = new LayoutSolver(graph, o, engine), chunks = new LayoutSolver(graph, o, engine);
      let yields = 0; const giveTime = async () => { yields++; };
      for (let i = 0; i < 3; i++) {
        atomic.step(); expect(await chunks.stepResponsive(giveTime, () => false)).toBe(true);
        expect(chunks.positions).toEqual(atomic.positions); expect(chunks.movement).toBe(atomic.movement);
      }
      expect(yields).toBeGreaterThan(3);
      const last = chunks.positions.slice(); yields = 0;
      expect(await chunks.stepResponsive(giveTime, () => yields >= 5)).toBe(false);
      expect(chunks.iteration).toBe(3); expect(chunks.positions).toEqual(last);
    }
  } finally { performance.now = clock; }
});
