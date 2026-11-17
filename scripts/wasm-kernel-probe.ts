/** Synthetic cold-realm CSP and retained-memory probe, never part of the plugin. */
import { LayoutSolver, DEFAULT_LAYOUT } from '../src/core/layout';
import { scalarKernelBytes } from '../src/core/wasm-kernel-bytes';
import { kernelFixture, exactPositions } from '../tests/support/kernel-fixture';
const task = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function cold() {
  let compileMs = 0, instantiateMs = 0, compileRejected = false;
  try {
    let t = performance.now(); const module = new WebAssembly.Module(scalarKernelBytes); compileMs = performance.now() - t;
    t = performance.now(); new WebAssembly.Instance(module); instantiateMs = performance.now() - t;
  } catch { compileRejected = true; }
  const input = kernelFixture(512), o = { ...DEFAULT_LAYOUT, iterations: 30, force: { ...DEFAULT_LAYOUT.force, adjustSizes: true } };
  const a = new LayoutSolver(input, o, 'js'), b = new LayoutSolver(input, o);
  while (!a.done) { a.step(); b.step(); }
  return { backend: b.kernelBackend, exact: exactPositions(a.positions, b.positions), compileMs, instantiateMs, compileRejected };
}
async function memory(count: number, adjustSizes: boolean) {
  const gc = (globalThis as unknown as { gc?: () => void }).gc;
  if (!gc) throw new Error('Memory probe requires exposed GC');
  const input = kernelFixture(count), instances: WeakRef<WebAssembly.Instance>[] = [], Instance = WebAssembly.Instance;
  // Include the optional pinned mask in the peak size. Every second node is fixed.
  input.movable = Uint8Array.from({ length: count }, (_, i) => i % 2);
  const options = { ...DEFAULT_LAYOUT, iterations: 3, relaxIterations: 3, force: { ...DEFAULT_LAYOUT.force, adjustSizes } };
  const run = () => {
    const solver = new LayoutSolver(input, options);
    if (solver.kernelBackend !== 'wasm-scalar') throw new Error('Memory probe did not activate scalar kernel');
    const kernel = (solver as unknown as { kernel: { ex: { memory: WebAssembly.Memory } } }).kernel;
    const before = kernel.ex.memory.buffer.byteLength;
    while (!solver.done) solver.step();
    if (before !== kernel.ex.memory.buffer.byteLength || solver.kernelBackend !== 'wasm-scalar') throw new Error('Memory changed during layout');
    return { bytes: before, memory: new WeakRef(kernel.ex.memory), positions: solver.positions };
  };
  const samples: { bytes: number; liveMemories: number; liveInstances: number }[] = [];
  const results: ReturnType<typeof run>[] = [];
  try {
    Object.assign(WebAssembly, { Instance: class extends Instance {
      constructor(module: WebAssembly.Module) { super(module); instances.push(new WeakRef(this)); }
    } });
    for (let i = 0; i < 10; i++) {
      results.push(run());
      // New tasks end WeakRef keep-alive jobs. Keep final positions, not solver state.
      await task(); gc(); await task(); gc(); await task();
      const liveMemories = results.filter(r => r.memory.deref() !== undefined).length;
      const liveInstances = instances.filter(r => r.deref() !== undefined).length;
      samples.push({ bytes: results[i]!.bytes, liveMemories, liveInstances });
      if (liveMemories || liveInstances) throw new Error(`Retained scalar state after relayout ${i + 1}: ${liveMemories}/${liveInstances}`);
      await task();
    }
  } finally { Object.assign(WebAssembly, { Instance }); }
  return { count, adjustSizes, pinnedMask: true, peakExtraLinearBytes: Math.max(...samples.map(s => s.bytes)), samples, retainedFinalPositionArrays: results.length, collection: 'WeakRef after explicit full GC; not browser RSS or automatic-GC timing' };
}
self.onmessage = async event => {
  try { self.postMessage(event.data?.kind === 'memory' ? await memory(event.data.count, event.data.adjustSizes) : cold()); }
  catch (error) { self.postMessage({ error: String(error) }); }
};
