import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { DEFAULT_LAYOUT, LayoutSolver, type LayoutInput } from '../src/core/layout';
import { BarnesHut } from '../src/core/barnes-hut';
import { scalarKernelBytes } from '../src/core/wasm-kernel-bytes';
import { scalarLayoutKernel } from '../src/core/wasm-kernel';
import { kernelFixture, exactPositions } from './support/kernel-fixture';

const options = (adjustSizes = false, steps = 18) => ({ ...DEFAULT_LAYOUT, iterations: steps, relaxIterations: steps, force: { ...DEFAULT_LAYOUT.force, adjustSizes } });
function pair(input: LayoutInput, o = options()) {
  const js = new LayoutSolver(input, o, 'js'), wasm = new LayoutSolver(input, o);
  while (!js.done) { js.step(); wasm.step(); expect(exactPositions(wasm.positions, js.positions)).toBe(true); expect(wasm.movement).toBe(js.movement); expect(wasm.settled).toBe(js.settled); }
  return wasm;
}
test('embedded scalar bytes regenerate exactly, have no imports and bounded memory', () => {
  execFileSync(process.execPath.includes('bun') ? 'node' : process.execPath, ['scripts/wasm-kernel.mjs', '--check']);
  const module = new WebAssembly.Module(scalarKernelBytes), instance = new WebAssembly.Instance(module);
  expect(WebAssembly.Module.imports(module)).toEqual([]);
  expect(WebAssembly.Module.exports(module).map(e => e.name)).toEqual(['memory', 'repulse', 'attract']);
  const memory = instance.exports.memory as WebAssembly.Memory;
  expect(memory.buffer.byteLength).toBe(65536);
  expect(() => memory.grow(4096)).toThrow();
});
for (const n of [5000, 20000, 49000]) for (const overlap of [false, true]) test(`scalar exact Float32 steps across Morton refreshes: ${n}, overlap=${overlap}`, () => {
  expect(pair(kernelFixture(n), options(overlap)).kernelBackend).toBe('wasm-scalar');
}, 30000);
for (const overlap of [false, true]) for (const linLogMode of [false, true]) for (const outboundAttractionDistribution of [false, true]) test(`scalar pinned/family/self-edge modes: ${overlap}/${linLogMode}/${outboundAttractionDistribution}`, () => {
  const input = kernelFixture(512);
  input.movable = Uint8Array.from({ length: input.count }, (_, i) => Number(i % 3 !== 0));
  input.source = Uint32Array.from([...input.source, 0, 4, 4]); input.target = Uint32Array.from([...input.target, 0, 4, 4]);
  input.up = { offsets: Uint32Array.from({ length: 513 }, (_, i) => i), targets: Uint32Array.from({ length: 512 }, (_, i) => (i + 1) % 512) };
  const o = options(overlap); Object.assign(o.force, { linLogMode, outboundAttractionDistribution, familyPull: 1.7, strongGravityMode: true });
  expect(pair(input, o).kernelBackend).toBe('wasm-scalar');
});
test('coincidence, signed zero, tiny extents and all-pairs retain exact coordinates', () => {
  for (const scale of [0, 1e-5, 1]) for (const overlap of [false, true]) {
    const input = kernelFixture(64); input.initial = Float32Array.from({ length: 128 }, (_, i) => i % 5 ? scale * (i % 7) : -0);
    pair(input, options(overlap));
    const o = options(overlap); o.force.barnesHutOptimize = false;
    expect(pair(input, o).kernelBackend).toBe('js');
  }
  expect(pair({ count: 0, source: new Uint32Array(), target: new Uint32Array(), seed: 1 }).kernelBackend).toBe('js');
});
test('both backends reject a synthetic force overflow instead of returning nonfinite positions', () => {
  const input = { count: 2, source: new Uint32Array([0]), target: new Uint32Array([1]), initial: new Float32Array([0, 0, 1e-40, 0]), seed: 7 };
  for (const backend of ['auto', 'js'] as const) {
    const solver = new LayoutSolver(input, options(), backend);
    expect(solver.kernelBackend).toBe(backend === 'auto' ? 'wasm-scalar' : 'js');
    expect(() => solver.step()).toThrow('Layout produced nonfinite positions');
  }
});
test('missing API, instance rejection and memory growth failure fall back exactly', () => {
  const api = globalThis.WebAssembly, Instance = api.Instance, grow = api.Memory.prototype.grow;
  try {
    Object.assign(globalThis, { WebAssembly: undefined }); expect(pair(kernelFixture(512)).kernelBackend).toBe('js');
    Object.assign(globalThis, { WebAssembly: api });
    Object.assign(api, { Instance: class { constructor() { throw new Error('synthetic instance denial'); } } });
    expect(pair(kernelFixture(512), options(true)).kernelBackend).toBe('js');
    Object.assign(api, { Instance });
    api.Memory.prototype.grow = () => { throw new RangeError('synthetic allocation denial'); };
    expect(pair(kernelFixture(512), options(true)).kernelBackend).toBe('js');
  } finally { Object.assign(globalThis, { WebAssembly: api }); Object.assign(api, { Instance }); api.Memory.prototype.grow = grow; }
});
for (const name of ['repulse', 'attract'] as const) test(`${name} partial-write trap recovers exactly and disables the whole layout kernel`, () => {
  const Instance = WebAssembly.Instance; let calls = 0;
  try {
    Object.assign(WebAssembly, { Instance: class {
      exports: WebAssembly.Exports;
      constructor(module: WebAssembly.Module) {
        const instance = new Instance(module), original = instance.exports[name] as (...args: number[]) => void;
        this.exports = { ...instance.exports, [name]: (...args: number[]) => {
          calls++; original(...args);
          if (calls === 3) { new Float32Array((instance.exports.memory as WebAssembly.Memory).buffer).fill(123); throw new WebAssembly.RuntimeError('synthetic trap after writes'); }
        } };
      }
    } });
    expect(pair(kernelFixture(512), options(true)).kernelBackend).toBe('js');
    expect(calls).toBe(3);
  } finally { Object.assign(WebAssembly, { Instance }); }
});
test('tree growth disables the kernel without partial publication or step allocations', () => {
  const n = 32, tree = new BarnesHut(n), weights = new Float32Array(n).fill(1), edges = new Uint32Array();
  const kernel = scalarLayoutKernel(tree, n, edges, edges, weights)!;
  expect(kernel).toBeDefined();
  // A coincident cluster and a distant node exhaust initial cell capacity.
  const p = new Float32Array(n * 2); p[p.length - 1] = 1e10;
  tree.build(p, weights, 52);
  const forces = new Float32Array(n * 2).fill(17);
  expect(kernel.repulse(tree, p, forces, 2, 1.2, 0)).toBe(false);
  expect(kernel.active).toBe(false); expect(forces.every(v => v === 17)).toBe(true);
  expect(pair({ count: n, source: edges, target: edges, initial: p, seed: 7 }, { ...options(true), maxTreeDepth: 52 }).kernelBackend).toBe('js');
});
test('linear memory and typed views remain stable across steps', () => {
  const solver = new LayoutSolver(kernelFixture(512), options(true));
  const kernel = (solver as unknown as { kernel: { ex: { memory: WebAssembly.Memory }; views: Record<string, ArrayBufferView> } }).kernel;
  const buffer = kernel.ex.memory.buffer, views = { ...kernel.views };
  while (!solver.done) { solver.step(); expect(kernel.ex.memory.buffer).toBe(buffer); for (const [key, view] of Object.entries(views)) expect(kernel.views[key]).toBe(view); }
});
