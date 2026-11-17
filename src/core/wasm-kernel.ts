import type { BarnesHut, KernelTree } from './barnes-hut';
import { scalarKernelBytes } from './wasm-kernel-bytes';

/** Optional numeric accelerator, never a second layout authority. The JS tree and
 * integrator own all state. No fetch, imports, SIMD, threads or host policy changes. */
let compiled: WebAssembly.Module | undefined;
const PAGE = 65536, MAX_BYTES = 4096 * PAGE;
type NumericArray = Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array;
interface Exports {
  memory: WebAssembly.Memory;
  repulse: (...args: number[]) => void;
  attract: (...args: number[]) => void;
}
const treeKeys = ['owner', 'child', 'head', 'next', 'cx', 'cy', 'half', 'mass', 'mx', 'my'] as const;

/** Failure is sticky for this layout. Force writes are published only after a
 * complete call; a trap cannot leak a partly accumulated force into JS recovery. */
export class ScalarLayoutKernel {
  active = true;
  private readonly ex: Exports;
  private readonly storage: KernelTree;
  private readonly ptr: Record<string, number> = {};
  private readonly views: Record<string, NumericArray> = {};
  constructor(tree: BarnesHut, private readonly count: number, source: Uint32Array, target: Uint32Array, weights: Float32Array, radii?: Float32Array, mask?: Uint8Array) {
    if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly unavailable');
    compiled ??= new WebAssembly.Module(scalarKernelBytes);
    this.ex = new WebAssembly.Instance(compiled).exports as unknown as Exports;
    this.storage = tree.kernelStorage();
    const columns: Record<string, NumericArray> = {
      p: new Float32Array(0), f: new Float32Array(0), w: weights, source, target,
      ...this.storage,
    };
    if (radii) columns.radii = radii;
    if (mask) columns.mask = mask;
    // Offsets are computed before any view is made: growth detaches old buffers.
    let bytes = 64;
    for (const key of Object.keys(columns)) {
      bytes = Math.ceil(bytes / 8) * 8; this.ptr[key] = bytes;
      bytes += (key === 'p' || key === 'f' ? count * 2 : columns[key]!.length) * columns[key]!.BYTES_PER_ELEMENT;
      if (!Number.isSafeInteger(bytes) || bytes > MAX_BYTES) throw new Error('Scalar kernel memory limit');
    }
    const pages = Math.ceil(bytes / PAGE);
    if (pages > 1) this.ex.memory.grow(pages - 1);
    for (const [key, column] of Object.entries(columns)) {
      const Type = column.constructor as { new(buffer: ArrayBuffer, offset: number, length: number): NumericArray };
      const view = this.views[key] = new Type(this.ex.memory.buffer, this.ptr[key]!, key === 'p' || key === 'f' ? count * 2 : column.length);
      if (key !== 'p' && key !== 'f') view.set(column);
    }
  }
  repulse(tree: BarnesHut, positions: Float32Array, forces: Float32Array, scale: number, theta: number, maxRadius: number): boolean {
    if (!this.active) return false;
    try {
      // Existing JS tree growth stays authoritative. No resize or new views in a
      // step: a larger tree permanently selects JS for the remainder of the layout.
      if (!tree.matchesKernelStorage(this.storage)) throw new Error('Tree storage grew');
      const v = this.views, p = this.ptr;
      for (const key of treeKeys) v[key]!.set(this.storage[key]);
      if (this.storage.order) v.order!.set(this.storage.order);
      v.p!.set(positions);
      // Fixed nodes are skipped by the walk; their force entries must stay zero.
      v.f!.fill(0);
      this.ex.repulse(p.p!, p.w!, p.f!, p.owner!, p.child!, p.head!, p.next!, p.cx!, p.cy!, p.half!, p.mass!, p.mx!, p.my!, p.order ?? 0, p.radii ?? 0, p.mask ?? 0, this.count, 0, this.count, scale, theta, maxRadius);
      forces.set(v.f!);
      return true;
    } catch { this.active = false; return false; }
  }
  attract(forces: Float32Array, edgeCount: number, compensation: number, outbound: boolean): boolean {
    if (!this.active) return false;
    try {
      const v = this.views, p = this.ptr;
      // Repulsion already copied the same immutable-in-this-step positions.
      // Gravity has since updated forces. Keep that snapshot outside WASM until success.
      v.f!.set(forces);
      this.ex.attract(p.p!, p.f!, p.source!, p.target!, edgeCount, p.w!, p.radii ?? 0, Number(outbound), compensation);
      forces.set(v.f!);
      return true;
    } catch { this.active = false; return false; }
  }
}
export function scalarLayoutKernel(tree: BarnesHut, count: number, source: Uint32Array, target: Uint32Array, weights: Float32Array, radii?: Float32Array, mask?: Uint8Array): ScalarLayoutKernel | undefined {
  try { return new ScalarLayoutKernel(tree, count, source, target, weights, radii, mask); }
  catch { return undefined; }
}
