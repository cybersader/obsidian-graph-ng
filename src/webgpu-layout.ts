import { DEFAULT_LAYOUT, LayoutSolver, type LayoutInput, type LayoutOptions } from './core/layout';
import { shaderSource } from './webgpu-layout-shaders';

// The host's public WebGPU surface only. No runtime package or adapter identity query.
interface BufferHandle { destroy(): void; mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void }
interface Encoder {
  beginComputePass(): { setPipeline(p: unknown): void; setBindGroup(i: number, g: unknown): void; dispatchWorkgroups(n: number): void; end(): void };
  copyBufferToBuffer(a: BufferHandle, offset: number, b: BufferHandle, target: number, size: number): void;
  finish(): unknown;
}
interface Device {
  lost: Promise<unknown>;
  addEventListener(kind: string, callback: () => void): void;
  queue: { writeBuffer(b: BufferHandle, offset: number, data: ArrayBufferView): void; submit(commands: unknown[]): void };
  createBuffer(d: { size: number; usage: number }): BufferHandle;
  createBindGroupLayout(d: unknown): unknown;
  createBindGroup(d: unknown): unknown;
  createPipelineLayout(d: unknown): unknown;
  createShaderModule(d: { code: string }): { getCompilationInfo(): Promise<{ messages: { type: string; message: string }[] }> };
  createComputePipelineAsync(d: unknown): Promise<unknown>;
  createCommandEncoder(): Encoder;
  pushErrorScope(kind: string): void;
  popErrorScope(): Promise<unknown>;
  destroy(): void;
}
export interface ComputeAdapter {
  limits: Record<string, number>;
  requestDevice(descriptor?: unknown): Promise<Device>;
}
const STORAGE = 128, COPY_DST = 8, COPY_SRC = 4, MAP_READ = 1, UNIFORM = 64;
export interface GraphicsStep { positions: Float32Array; movement: number; quiet: number }
export interface GraphicsSolver { batch(count: number): Promise<GraphicsStep>; reset(): void; destroy(): void }
/** All shaders use core WebGPU features. In particular, no timestamp query or f16 is required. */
export function computeRequirements(input: LayoutInput, options: LayoutOptions): Record<string, number> | undefined {
  const n = input.count;
  if (n < 2 || !options.force.barnesHutOptimize || options.maxTreeDepth !== DEFAULT_LAYOUT.maxTreeDepth) return undefined;
  const links = input.source.length + (options.force.familyPull ? input.up?.targets.length ?? 0 : 0);
  const largest = Math.max((2 * n - 1) * 48, links * 32, n * 16, (n + 1) * 4);
  if (!Number.isSafeInteger(largest)) return undefined;
  return { maxBufferSize: largest, maxStorageBufferBindingSize: largest, maxStorageBuffersPerShaderStage: 7, maxComputeWorkgroupSizeX: 256, maxComputeInvocationsPerWorkgroup: 256, maxComputeWorkgroupStorageSize: 6144, maxComputeWorkgroupsPerDimension: n - 1 };
}
export function adapterSupports(adapter: ComputeAdapter, requirements: Record<string, number>): boolean {
  return Object.entries(requirements).every(([k, v]) => Number.isFinite(adapter.limits[k]) && adapter.limits[k]! >= v);
}
export async function requestComputeAdapter(): Promise<ComputeAdapter | undefined> {
  return (await (globalThis.navigator as Navigator & { gpu?: { requestAdapter(): Promise<ComputeAdapter | null> } } | undefined)?.gpu?.requestAdapter()) ?? undefined;
}
/** Transient GPU mirrors. Every readback is validated before it replaces worker-owned positions. */
export class WebGpuLayout implements GraphicsSolver {
  private buffers: Record<string, BufferHandle> = {};
  private pipelines: Record<string, unknown> = {};
  private groups: Record<string, unknown> = {};
  private current = 0;
  private seedNodes!: Float32Array;
  private seedHistory!: Float32Array;
  reset() {
    this.check(); this.current = 0;
    this.write('nodes0', this.seedNodes); this.write('nodes1', this.seedNodes);
    this.write('history', this.seedHistory); this.write('status', new Float32Array(4));
  }
  private dead = false;
  private failed = false;
  private constructor(private d: Device, private input: LayoutInput, private options: LayoutOptions, private signal: AbortSignal) {}
  static async create(adapter: ComputeAdapter, input: LayoutInput, options: LayoutOptions, signal: AbortSignal): Promise<WebGpuLayout> {
    const requirements = computeRequirements(input, options);
    if (!requirements || !adapterSupports(adapter, requirements)) throw new Error('Graphics limits');
    signal.throwIfAborted();
    const d = await adapter.requestDevice({ requiredLimits: requirements });
    const solver = new WebGpuLayout(d, input, options, signal);
    signal.addEventListener('abort', solver.abort, { once: true });
    d.lost.then(() => { solver.failed = true; });
    d.addEventListener('uncapturederror', () => { solver.failed = true; });
    try {
      solver.check();
      d.pushErrorScope('validation'); d.pushErrorScope('out-of-memory');
      await solver.initialize();
      const memory = await d.popErrorScope(), validation = await d.popErrorScope();
      if (memory || validation) throw new Error('Graphics setup failed');
      solver.check(); return solver;
    } catch (error) { solver.destroy(); throw error; }
  }
  private abort = () => this.destroy();
  private check() { this.signal.throwIfAborted(); if (this.dead || this.failed) throw new Error('Graphics device failed'); }
  private buffer(name: string, size: number, usage = STORAGE | COPY_DST | COPY_SRC) {
    this.check(); return this.buffers[name] = this.d.createBuffer({ size: Math.max(4, size), usage });
  }
  private write(name: string, data: ArrayBufferView) { this.d.queue.writeBuffer(this.buffers[name]!, 0, data); }
  private layout(kinds: string[]) {
    return this.d.createBindGroupLayout({ entries: kinds.map((type, binding) => ({ binding, visibility: 4, buffer: { type } })) });
  }
  private async compile(code: string, entries: string[], layout: unknown, key: string, constants?: Record<string, number>) {
    this.check();
    const module = this.d.createShaderModule({ code });
    const info = await module.getCompilationInfo(); this.check();
    if (info.messages.some(m => m.type === 'error')) throw new Error(`Graphics pipeline failed: ${info.messages.filter(m => m.type === 'error').map(m => m.message).join('; ')}`);
    const pl = this.d.createPipelineLayout({ bindGroupLayouts: [layout] });
    for (const entryPoint of entries) {
      this.pipelines[key + entryPoint] = await this.d.createComputePipelineAsync({ layout: pl, compute: { module, entryPoint, constants } });
      this.check();
    }
  }
  private group(layout: unknown, names: string[]) {
    return this.d.createBindGroup({ layout, entries: names.map((name, binding) => ({ binding, resource: { buffer: this.buffers[name] } })) });
  }
  private async initialize() {
    const { count: n, source, target, movable } = this.input, o = this.options, groups = Math.ceil(n / 256), cells = 2 * n - 1;
    // Validation and scalar metadata use exactly the core's implementation, not copied force policy.
    const core = new LayoutSolver(this.input, o, 'js'), s = core.adapterColumns;
    for (const [name, size] of Object.entries({ nodes0: n * 16, nodes1: n * 16, keys0: n * 8, keys1: n * 8, cells: cells * 48, parents: cells * 4, ropes: cells * 4, bounds: (groups + 1) * 16, hist: groups * 64, prefix: groups * 64, forces: n * 8, history: n * 16, reductions: groups * 8, status: 16, movable: n * 4 })) this.buffer(name, size);
    this.buffer('params', 64, UNIFORM | COPY_DST);
    this.buffer('readPositions', n * 16, MAP_READ | COPY_DST); this.buffer('readStatus', 16, MAP_READ | COPY_DST);
    const nodes = new Float32Array(n * 4), history = new Float32Array(n * 4), mask = new Uint32Array(n).fill(1);
    let maxRadius = 0, moved = 0;
    for (let i = 0; i < n; i++) {
      nodes[i * 4] = core.positions[i * 2]!; nodes[i * 4 + 1] = core.positions[i * 2 + 1]!;
      nodes[i * 4 + 2] = s.mass[i]!; nodes[i * 4 + 3] = s.radii?.[i] ?? 0;
      maxRadius = Math.max(maxRadius, nodes[i * 4 + 3]!); history[i * 4 + 2] = 1;
      mask[i] = movable ? +(movable[i]! !== 0) : 1; moved += mask[i]!;
    }
    this.seedNodes = nodes; this.seedHistory = history;
    this.write('nodes0', nodes); this.write('nodes1', nodes); this.write('history', history); this.write('movable', mask);
    const offsets = new Uint32Array(n + 1), up = o.force.familyPull ? this.input.up : undefined;
    for (let e = 0; e < source.length; e++) { offsets[source[e]! + 1]!++; offsets[target[e]! + 1]!++; }
    if (up) for (let i = 0; i < n; i++) for (let k = up.offsets[i]!; k < up.offsets[i + 1]!; k++) { offsets[i + 1]!++; offsets[up.targets[k]! + 1]!++; }
    for (let i = 1; i <= n; i++) offsets[i]! += offsets[i - 1]!;
    const raw = new ArrayBuffer(offsets[n]! * 16), f = new Float32Array(raw), u = new Uint32Array(raw), at = offsets.slice();
    const add = (a: number, b: number, coefficient: number, hub: number, linear: number) => {
      const j = at[a]!++ * 4; u[j] = b; f[j + 1] = coefficient; f[j + 2] = hub; u[j + 3] = linear;
    };
    for (let e = 0; e < source.length; e++) {
      const a = source[e]!, b = target[e]!, coefficient = -s.compensation / (o.force.outboundAttractionDistribution ? s.mass[a]! : 1);
      const hubA = s.hubMass && s.mass[a]! < s.mass[b]! ? o.force.hubGravity * Math.sqrt(s.mass[b]!) / s.hubMass[a]! : 0;
      const hubB = s.hubMass && s.mass[b]! < s.mass[a]! ? o.force.hubGravity * Math.sqrt(s.mass[a]!) / s.hubMass[b]! : 0;
      add(a, b, coefficient, hubA, 0); add(b, a, coefficient, hubB, 0);
    }
    if (up) for (let a = 0; a < n; a++) for (let k = up.offsets[a]!; k < up.offsets[a + 1]!; k++) {
      const b = up.targets[k]!, coefficient = -o.force.familyPull / Math.sqrt(s.familyDegree![a]! * s.familyDegree![b]!);
      add(a, b, coefficient, 0, 1); add(b, a, coefficient, 0, 1);
    }
    this.buffer('offsets', offsets.byteLength); this.buffer('neighbours', Math.max(16, raw.byteLength));
    this.write('offsets', offsets); this.write('neighbours', new Uint8Array(raw));
    const params = new ArrayBuffer(64), pu = new Uint32Array(params), pf = new Float32Array(params), force = o.force;
    pu[0] = n; pu[1] = cells; pf[2] = force.scalingRatio; pf[3] = force.barnesHutTheta ** 2; pf[4] = maxRadius;
    pu[5] = +force.adjustSizes; pf[6] = force.gravity; pf[7] = force.slowDown; pu[8] = +force.strongGravityMode;
    pu[9] = +force.linLogMode; pu[10] = groups; pu[11] = 1; pf[12] = o.convergenceThreshold; pf[13] = moved;
    this.write('params', new Uint8Array(params));
    const tree = this.layout(['read-only-storage', 'storage', 'storage', 'storage', 'storage', 'storage', 'uniform']);
    const sort = this.layout(['read-only-storage', 'storage', 'storage', 'storage', 'uniform']);
    const forces = this.layout(['read-only-storage', 'read-only-storage', 'read-only-storage', 'read-only-storage', 'storage', 'uniform']);
    const integrate = this.layout(['read-only-storage', 'storage', 'read-only-storage', 'storage', 'read-only-storage', 'read-only-storage', 'uniform', 'read-only-storage']);
    const settle = this.layout(['read-only-storage', 'read-only-storage', 'storage', 'storage', 'uniform']);
    const [shared, ...modules] = (await shaderSource()).split('\n// --- module ---\n');
    const [treeCode, sortCode, forceCode, integrateCode, settleCode] = modules.map(code => shared + '\n' + code) as [string, string, string, string, string];
    await this.compile(treeCode, ['boundPart', 'boundFinal', 'makeKeys', 'leaves', 'topology', 'aggregate', 'thread'], tree, 'tree');
    for (let pass = 0; pass < 8; pass++) await this.compile(sortCode, ['hist', 'scatter'], sort, `sort${pass}`, { SHIFT: pass * 4 });
    await this.compile(sortCode, ['scan'], sort, 'sortScan');
    await this.compile(forceCode, ['force'], forces, ''); await this.compile(integrateCode, ['integrate'], integrate, '');
    await this.compile(settleCode, ['part', 'reduceStatus'], settle, 'settle');
    for (let i = 0; i < 2; i++) {
      this.groups[`tree${i}`] = this.group(tree, [`nodes${i}`, 'keys0', 'cells', 'parents', 'ropes', 'bounds', 'params']);
      this.groups[`sort${i}`] = this.group(sort, [`keys${i}`, `keys${1 - i}`, 'hist', 'prefix', 'params']);
      this.groups[`force${i}`] = this.group(forces, [`nodes${i}`, 'cells', 'keys0', 'ropes', 'forces', 'params']);
      this.groups[`integrate${i}`] = this.group(integrate, [`nodes${i}`, `nodes${1 - i}`, 'forces', 'history', 'offsets', 'neighbours', 'params', 'movable']);
      this.groups[`settle${i}`] = this.group(settle, [`nodes${i}`, 'history', 'reductions', 'status', 'params']);
    }
  }
  private pass(encoder: Encoder, pipeline: string, group: string, count: number) {
    const pass = encoder.beginComputePass(); pass.setPipeline(this.pipelines[pipeline]); pass.setBindGroup(0, this.groups[group]); pass.dispatchWorkgroups(count); pass.end();
  }
  private step(encoder: Encoder) {
    const i = this.current, n = this.input.count, g = Math.ceil(n / 256), tree = `tree${i}`;
    this.pass(encoder, 'treeboundPart', tree, g); this.pass(encoder, 'treeboundFinal', tree, 1); this.pass(encoder, 'treemakeKeys', tree, g);
    for (let s = 0; s < 8; s++) {
      this.pass(encoder, `sort${s}hist`, `sort${s % 2}`, g); this.pass(encoder, 'sortScanscan', `sort${s % 2}`, 1); this.pass(encoder, `sort${s}scatter`, `sort${s % 2}`, g);
    }
    this.pass(encoder, 'treeleaves', tree, g); this.pass(encoder, 'treetopology', tree, g); this.pass(encoder, 'treeaggregate', tree, n - 1); this.pass(encoder, 'treethread', tree, Math.ceil((2 * n - 1) / 256));
    this.pass(encoder, 'force', `force${i}`, Math.ceil(n / 64)); this.pass(encoder, 'integrate', `integrate${i}`, Math.ceil(n / 128));
    this.current = 1 - i; this.pass(encoder, 'settlepart', `settle${this.current}`, g); this.pass(encoder, 'settlereduceStatus', `settle${this.current}`, 1);
  }
  async batch(count: number): Promise<GraphicsStep> {
    this.check();
    const encoder = this.d.createCommandEncoder(), n = this.input.count;
    // Caller bounds a batch to four steps; no whole-layout GPU queue can outlive Stop.
    for (let i = 0; i < count; i++) this.step(encoder);
    const read = this.buffers.readPositions!, statusRead = this.buffers.readStatus!;
    encoder.copyBufferToBuffer(this.buffers[`nodes${this.current}`]!, 0, read, 0, n * 16);
    encoder.copyBufferToBuffer(this.buffers.status!, 0, statusRead, 0, 16);
    this.d.pushErrorScope('validation');
    this.d.queue.submit([encoder.finish()]);
    try {
      await Promise.all([read.mapAsync(MAP_READ), statusRead.mapAsync(MAP_READ)]);
      const error = await this.d.popErrorScope(); this.check();
      if (error) throw new Error('Graphics validation failed');
      const data = new Float32Array(read.getMappedRange()), status = new Float32Array(statusRead.getMappedRange()), positions = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { positions[i * 2] = data[i * 4]!; positions[i * 2 + 1] = data[i * 4 + 1]!; }
      if (!positions.every(Number.isFinite) || !status.every(Number.isFinite)) throw new Error('Graphics produced nonfinite positions');
      return { positions, movement: status[2]!, quiet: status[1]! };
    } finally { if (!this.dead) { read.unmap(); statusRead.unmap(); } }
  }
  destroy() {
    if (this.dead) return; this.dead = true;
    this.signal.removeEventListener('abort', this.abort);
    for (const buffer of Object.values(this.buffers)) buffer.destroy();
    this.buffers = {}; this.groups = {}; this.pipelines = {}; this.d.destroy();
  }
}
