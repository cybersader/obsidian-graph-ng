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
const sample = () => ({ bucket: engineBucket(20000), mode: 0, every: 4, batch: 5, iterations: 8, cpuSetup: 4, gpuSetup: 183, cpuStep: 25, gpuStep: 1.5, measuredAt: Date.now() });
test('Auto projects startup once and per-step work across the actual cold or warm budget', () => {
  expect(chooseLayoutEngine(sample(), 100)).toBe('graphics');
  expect(chooseLayoutEngine(sample(), 8)).toBe('processor');
  expect(chooseLayoutEngine({...sample(), cpuSetup: 0, gpuSetup: 0, cpuStep: 1.49, gpuStep: 1}, 100)).toBe('processor');
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
test('shipping Auto quality exclusions reject unqualified sizes before probing; manual Graphics remains selectable', async () => {
  let probes = 0;
  const session = new LayoutEngineSession({adapter: async () => { probes++; return adapter; }, graphics: async (_, i, o) => fakeGraphics(i, o)});
  const o = {...options(), iterations: 1};
  for (const count of [5000, 10000, 20000, 49000, 80000]) {
    const result = await session.run(input(count), o, run());
    expect(result.engineStatus.reason).toBe('quality');
    expect(result.engineStatus.engine).toBe('processor');
  }
  expect(probes).toBe(0);
  expect((await session.run(input(20000), o, run('graphics'))).engineStatus.engine).toBe('graphics');
});
test('remembered Processor skips even an available adapter', async () => {
  let probes = 0;
  const record = {...sample(), bucket: 1, engine: 'processor' as const, processorMs: 100, graphicsMs: 100, setupMs: 0, cpuStep: 1, gpuStep: 100};
  const session = new LayoutEngineSession({quality: () => true, adapter: async () => { probes++; return adapter; }});
  const result = await session.run(input(5000), options(), {...run(), remembered: [record]});
  expect(result.engineStatus.reason).toBe('remembered');
  expect(probes).toBe(0);
});
test('absent WebGPU falls back without changing Processor coordinates', async () => {
  const i = input(5000), o = options(), session = new LayoutEngineSession({ quality: () => true, adapter: async () => undefined });
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
    const times = [0, 10, 12, 112, slow ? 310 : 114]; let calls = 0, probes = 0;
    const i = input(5000), o = options();
    const session = new LayoutEngineSession({ quality: () => true, adapter: async () => { probes++; return adapter; }, now: () => times.shift() ?? 400, graphics: async (_, received, actual) => { calls++; expect(received).toBe(i); expect(actual).toBe(o); return fakeGraphics(i, o); } });
    const result = await session.run(i, o, run());
    expect(result.engineStatus.engine).toBe(slow ? 'processor' : 'graphics'); expect(calls).toBe(1);
    const again = await session.run(i, o, { ...run(), remembered: [result.engineStatus.timing!] });
    expect(again.engineStatus.engine).toBe(result.engineStatus.engine); expect(calls).toBe(slow ? 1 : 2);
    expect(probes).toBe(slow ? 1 : 2);
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
  const timing = { ...sample(), path: 'Synthetic/Note.md', adapter: 'synthetic identifier' };
  s.rememberLayout('0.5.2', timing);
  expect(JSON.parse([...data.values()][0]!).flat().every(Number.isFinite)).toBe(true);
  const next = new DevicePerformanceStore('a'.repeat(32), 'graph-ng', access);
  expect(next.layoutChoices('0.5.2')).toEqual(engineTimings([timing])); expect(next.layoutChoices('0.5.3')).toEqual([]);
  expect([...data.values()].join()).not.toContain('Synthetic'); expect([...data.values()].join()).not.toContain('adapter');
  expect(Object.keys(sharedPerformanceData({ settings: { layoutEngine: 'graphics' } }).settings)).toEqual([]);
  const denied = new DevicePerformanceStore('b'.repeat(32), 'graph-ng', () => { throw Error('denied'); }); denied.rememberLayout('0.5.2', timing);
  expect(denied.layoutChoices('0.5.2')).toHaveLength(1);
  expect(engineTimings([{ ...timing, cpuSetup: Infinity }, { ...timing, bucket: 99 }])).toEqual([]);
});

test('late graphics loss cannot shrink the original quiet criterion', async () => {
  const i = input(), o = { ...options(), iterations: 5 }, checkpoint = new Float32Array(i.count * 2);
  let calls = 0;
  const session = new LayoutEngineSession({adapter: async () => adapter, graphics: async () => ({reset(){},destroy(){},async batch(n){
    if (calls++) throw Error('device loss'); expect(n).toBe(4); return { positions: checkpoint, movement: 1, quiet: 0 };
  }})});
  const result = await session.run(i, o, run('graphics')); expect(result.engineStatus.reason).toBe('failed'); expect(result.settled).toBe(false);
});
test('Stop before first readback preserves warm or cold starting coordinates', async () => {
  for (const warm of [true, false]) {
    const i = input(); if (warm) i.initial = new LayoutSolver(i, options()).positions;
    let started!: () => void, stop = false; const ready = new Promise<void>(r => started = r);
    const session = new LayoutEngineSession({adapter: async () => adapter, graphics: async () => ({reset(){},destroy(){},batch(){started(); return new Promise(()=>{});}})});
    const task = session.run(i, options(), {...run('graphics'), stopped: () => stop}); await ready; stop = true; session.stop();
    const result = await task; expect(result.settled).toBe(false);
    if (warm) expect(result.positions).toBe(i.initial!);
    else expect(result.positions).toEqual(new LayoutSolver(i, options()).positions);
    expect(result.engineStatus.reason).toBe('unchanged');
  }
});
test('Processor streams into the transfer pool; detaching frames never detaches solver state', async () => {
  const i = input(), o = options(); let pooled: Float32Array | undefined, frames = 0;
  const result = await new LayoutEngineSession().run(i, o, {...run('processor'), buffer: n => pooled = new Float32Array(n), emit(p) {
    expect(p).toBe(pooled!); frames++; structuredClone(p, {transfer: [p.buffer]});
  }});
  expect(frames).toBe(1); expect(result.positions.length).toBe(i.count * 2);
});
test('cache rejects old/forged/expired records; real failure evicts across worker and store restart', async () => {
  const data = new Map<string,string>(), access = () => ({getItem: (k: string) => data.get(k) ?? null, setItem: (k: string,v:string) => {data.set(k,v);}});
  const store = () => new DevicePerformanceStore('a'.repeat(32),'graph-ng',access), version = '0.5.2';
  const t = {...sample(), bucket: 1, gpuSetup: 1}; store().rememberLayout(version,t);
  const key = [...data.keys()][0]!; data.set(key,JSON.stringify([[1,1,0,10000,5000,0]])); expect(store().layoutChoices(version)).toEqual([]);
  for (const iterations of [0, .5, 9, Infinity]) expect(engineTimings([{...t,iterations}])).toEqual([]);
  expect(engineTimings([{...t,measuredAt: Date.now()-8*86400000}])).toEqual([]);
  expect(chooseLayoutEngine(engineTimings([{...t,engine:'graphics',gpuStep:999}])[0]!,100)).toBe('processor');
  const device = store(); device.rememberLayout(version,t); const session = new LayoutEngineSession({quality: () => true,adapter: async () => adapter,graphics: async () => {throw Error('lost');}});
  const result = await session.run(input(5000), options(), {...run(),remembered: device.layoutChoices(version),status(s){if(s.evictBucket !== undefined) device.rememberLayout(version,undefined,s.evictBucket);}});
  expect(result.engineStatus.reason).toBe('failed'); expect(result.engineStatus.timing).toBeUndefined(); expect(store().layoutChoices(version)).toEqual([]);
});
test('trial uses production cadence, timing is never published before real success', async () => {
  const i = input(5000), o = options(), sizes: number[] = [], statuses: unknown[] = []; o.batchIterations = 3;
  const times = [0,1,2,102,103]; let real = false;
  const session = new LayoutEngineSession({quality: () => true, now: () => times.shift()!, adapter: async () => adapter, graphics: async () => ({
    reset(){real=true;},destroy(){},async batch(n){if(real) throw Error('real run failed');sizes.push(n);return {positions:new Float32Array(i.count*2), movement:0,quiet:0};}
  })});
  const out = await session.run(i,o,{...run(),status(s){statuses.push(s.timing);}});
  expect(sizes).toEqual([3,1,2,2]); expect(out.engineStatus.reason).toBe('failed'); expect(out.engineStatus.timing).toBeUndefined(); expect(statuses.every(x=>!x)).toBe(true);
});
test('the same stored rates choose differently for short and full budgets', async () => {
  const i = input(5000), t = {...sample(),bucket:1}, o = options();
  let probes = 0;
  const session = new LayoutEngineSession({quality: () => true, adapter: async () => { probes++; return adapter; }, graphics: async () => ({reset(){}, destroy(){}, async batch(){ return {positions:new Float32Array(i.count*2), quiet:0, movement:1}; }})});
  const short = await session.run(i,o,{...run(),remembered:[t]});
  expect(short.engineStatus.engine).toBe('processor'); expect(probes).toBe(0);
  const full = await session.run(i,{...o,iterations:100},{...run(),remembered:[t]});
  expect(full.engineStatus.engine).toBe('graphics'); expect(probes).toBe(1);
});
test('cached rates are scoped to movable class and cadence; quality exclusion wins over timing', async () => {
  const i = input(5000), o = options(); i.movable = new Uint8Array(i.count); o.relaxIterations=1;
  const t = {...sample(),bucket:1,cpuStep:1,gpuStep:100}; let probes=0;
  for (const [quality, reason] of [[true,'unavailable'],[false,'quality']] as const) {
    const out=await new LayoutEngineSession({quality:()=>quality,adapter:async()=>{probes++;return undefined;}}).run(i,o,{...run(),remembered:[t]});
    expect(out.engineStatus.reason).toBe(reason);
  }
  expect(probes).toBe(1);
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
