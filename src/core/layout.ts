import { DEFAULT_LAYOUT, validateLayout, type LayoutOptions } from './layout-options';
import { BarnesHut } from './barnes-hut';
export { DEFAULT_LAYOUT, type LayoutOptions } from './layout-options';
export interface LayoutInput {
  count: number;
  source: Uint32Array;
  target: Uint32Array;
  /** Optional authoritative undirected CSR; legacy callers may supply edges only. */
  offsets?: Uint32Array;
  targets?: Uint32Array;
  seed: number;
  initial?: Float32Array;
  movable?: Uint8Array;
}
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
export function initialPositions(count: number, seed: number, radius: number): Float32Array {
  const rng = random(seed), p = new Float32Array(count * 2);
  for (let i = 0; i < p.length; i++) p[i] = (rng() - 0.5) * radius;
  return p;
}
/** Persistent ForceAtlas2 integrator over borrowed edge columns and CSR degree.
 * Equations: Jacomy et al., PLOS ONE 2014, doi:10.1371/journal.pone.0098679.
 * Scheduling never resets force/convergence history. Arrays are the only per-node
 * state, and fixed nodes still contribute mass/attraction to movable neighbors.
 */
export class LayoutSolver {
  readonly positions: Float32Array;
  readonly limit: number;
  iteration = 0;
  movement = Infinity;
  private quiet = 0;
  private mass: Float32Array;
  private forces: Float32Array;
  private oldForces: Float32Array;
  private convergence: Float32Array;
  private tree?: BarnesHut;
  private compensation = 1;
  constructor(private input: LayoutInput, private options: LayoutOptions) {
    validateLayout(options);
    const n = input.count;
    if (!Number.isSafeInteger(n) || n < 0 || input.source.length !== input.target.length || (input.initial && input.initial.length !== n * 2) || (input.movable && input.movable.length !== n)) throw new Error('Invalid layout input');
    for (let e = 0; e < input.source.length; e++) if (input.source[e]! >= n || input.target[e]! >= n) throw new Error('Invalid layout endpoint');
    this.positions = input.initial ? input.initial.slice() : initialPositions(n, input.seed ^ options.seed, options.initialRadius);
    if (!this.positions.every(Number.isFinite)) throw new Error('Invalid initial positions');
    this.limit = input.movable ? options.relaxIterations : options.iterations;
    this.mass = new Float32Array(n).fill(1);
    if (input.offsets || input.targets) {
      const { offsets, targets } = input;
      if (!offsets || !targets || offsets.length !== n + 1 || offsets[0] !== 0 || offsets[n] !== targets.length) throw new Error('Invalid layout CSR');
      for (let i = 0; i < n; i++) { if (offsets[i]! > offsets[i + 1]!) throw new Error('Invalid layout CSR'); this.mass[i]! += offsets[i + 1]! - offsets[i]!; }
      for (const target of targets) if (target >= n) throw new Error('Invalid layout CSR endpoint');
    } else for (let e = 0; e < input.source.length; e++) { this.mass[input.source[e]!]!++; this.mass[input.target[e]!]!++; }
    if (options.force.outboundAttractionDistribution && n) this.compensation = this.mass.reduce((sum, m) => sum + m, 0) / n;
    this.forces = new Float32Array(n * 2); this.oldForces = new Float32Array(n * 2); this.convergence = new Float32Array(n).fill(1);
    if (options.force.barnesHutOptimize && n) this.tree = new BarnesHut(n);
  }
  get done(): boolean { return !this.input.count || this.iteration >= this.limit || (this.options.convergenceThreshold > 0 && this.quiet >= this.options.convergenceIterations); }
  step(): void {
    if (this.done) return;
    const { count: n, source, target, movable } = this.input, o = this.options, f = o.force, p = this.positions, mass = this.mass;
    const old = this.oldForces; this.oldForces = this.forces; this.forces = old;
    const forces = this.forces, history = this.oldForces;
    forces.fill(0);
    if (this.tree) { this.tree.build(p, mass, o.maxTreeDepth); this.tree.repulse(p, mass, forces, f.scalingRatio, f.barnesHutTheta); }
    else {
      for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
        const dx = p[2 * i]! - p[2 * j]!, dy = p[2 * i + 1]! - p[2 * j + 1]!;
        let d = Math.sqrt(dx * dx + dy * dy), factor = 0;
        if (f.adjustSizes) { d -= 2 * o.nodeRadius; factor = d > 0 ? f.scalingRatio * mass[i]! * mass[j]! / (d * d) : d < 0 ? 100 * f.scalingRatio * mass[i]! * mass[j]! : 0; }
        else if (d > 0) factor = f.scalingRatio * mass[i]! * mass[j]! / (d * d);
        const x = dx * factor, y = dy * factor;
        forces[2 * i]! += x; forces[2 * i + 1]! += y; forces[2 * j]! -= x; forces[2 * j + 1]! -= y;
      }
    }
    for (let i = 0; i < n; i++) {
      const x = p[2 * i]!, y = p[2 * i + 1]!, distance = Math.sqrt(x * x + y * y);
      const gravity = distance > 0 ? f.gravity * mass[i]! / (f.strongGravityMode ? 1 : distance) : 0;
      forces[2 * i]! -= x * gravity; forces[2 * i + 1]! -= y * gravity;
    }
    for (let e = 0; e < source.length; e++) {
      const a = source[e]!, b = target[e]!, x = p[2 * a]! - p[2 * b]!, y = p[2 * a + 1]! - p[2 * b + 1]!;
      const distance = Math.sqrt(x * x + y * y) - (f.adjustSizes ? 2 * o.nodeRadius : 0);
      if ((f.adjustSizes || f.linLogMode) && distance <= 0) continue;
      const factor = -this.compensation * (f.linLogMode ? Math.log1p(distance) / distance : 1) / (f.outboundAttractionDistribution ? mass[a]! : 1);
      forces[2 * a]! += x * factor; forces[2 * a + 1]! += y * factor;
      forces[2 * b]! -= x * factor; forces[2 * b + 1]! -= y * factor;
    }
    let movement = 0, moved = 0;
    for (let i = 0; i < n; i++) {
      if (movable && !movable[i]) continue;
      let dx = forces[2 * i]!, dy = forces[2 * i + 1]!;
      if (f.adjustSizes) { const length = Math.sqrt(dx * dx + dy * dy); if (length > o.maxForce) { forces[2 * i] = dx * o.maxForce / length; forces[2 * i + 1] = dy * o.maxForce / length; dx = forces[2 * i]!; dy = forces[2 * i + 1]!; } }
      const ox = history[2 * i]!, oy = history[2 * i + 1]!;
      const swing = mass[i]! * Math.sqrt((ox - dx) ** 2 + (oy - dy) ** 2), traction = Math.sqrt((ox + dx) ** 2 + (oy + dy) ** 2) / 2;
      const speed = (f.adjustSizes ? .1 : this.convergence[i]!) * Math.log1p(traction) / (1 + Math.sqrt(swing));
      if (!f.adjustSizes) this.convergence[i] = Math.min(1, Math.sqrt(speed * (dx * dx + dy * dy) / (1 + Math.sqrt(swing))));
      const beforeX = p[2 * i]!, beforeY = p[2 * i + 1]!;
      p[2 * i] = beforeX + dx * speed / f.slowDown; p[2 * i + 1] = beforeY + dy * speed / f.slowDown;
      if (!Number.isFinite(p[2 * i]) || !Number.isFinite(p[2 * i + 1])) throw new Error('Layout produced nonfinite positions; change force settings');
      movement += (p[2 * i]! - beforeX) ** 2 + (p[2 * i + 1]! - beforeY) ** 2; moved++;
    }
    this.iteration++; this.movement = Math.sqrt(movement / Math.max(1, moved));
    this.quiet = this.movement <= o.convergenceThreshold ? this.quiet + 1 : 0;
  }
}
export function runLayout(input: LayoutInput, options: LayoutOptions): Float32Array {
  const solver = new LayoutSolver(input, options);
  while (!solver.done) solver.step();
  return solver.positions;
}
/** Bounded iteration tasks, independent streaming cadence, persistent history.
 * Iteration budgets (rather than wall-clock early exits) preserve determinism.
 * The worker remains terminable by the host deadline even within one iteration.
 */
export async function runLayoutStream(input: LayoutInput, options: LayoutOptions, every: number, emit: (p: Float32Array) => void, yieldNow: () => Promise<void>, buffer = (length: number) => new Float32Array(length)): Promise<Float32Array> {
  if (!Number.isSafeInteger(every) || every < 1) throw new Error('Invalid layout stream cadence');
  const solver = new LayoutSolver(input, options);
  const send = () => { const p = buffer(solver.positions.length); p.set(solver.positions); emit(p); };
  if (!input.count) return solver.positions;
  send(); await yieldNow();
  while (!solver.done) {
    solver.step();
    if (!solver.done && solver.iteration % every === 0) send();
    if (!solver.done && (solver.iteration % options.batchIterations === 0 || solver.iteration % every === 0)) await yieldNow();
  }
  return solver.positions;
}
