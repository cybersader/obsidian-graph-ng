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
  /** Borrowed declared child-to-parent CSR; independent of the link edges and their mass. */
  up?: { offsets: Uint32Array; targets: Uint32Array };
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
  // Constant spacing, not a fixed-size square crushed by O(n) repulsion.
  radius *= Math.sqrt(Math.max(1, count));
  for (let i = 0; i < count; i++) { const angle = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius; p[2 * i] = Math.cos(angle) * r; p[2 * i + 1] = Math.sin(angle) * r; }
  return p;
}
/** Presentation placement for genuinely unlinked notes; no invented topology. Hierarchy
 * participants stay in the solver. Stable note order gives evenly spaced outer rings. */
export function isolateRing(input: LayoutInput) {
  const linked = new Uint8Array(input.count);
  for (const n of input.source) linked[n] = 1;
  for (const n of input.target) linked[n] = 1;
  if (input.up) for (let i = 0; i < input.count; i++) for (let j = input.up.offsets[i]!; j < input.up.offsets[i + 1]!; j++) linked[i] = linked[input.up.targets[j]!] = 1;
  const ids: number[] = [];
  for (let i = 0; i < input.count; i++) if (!linked[i] && (!input.movable || input.movable[i])) ids.push(i);
  return (p: Float32Array) => {
    if (!ids.length) return;
    let radius = 1;
    for (let i = 0; i < input.count; i++) if (linked[i] || input.movable && !input.movable[i]) radius = Math.max(radius, Math.hypot(p[2 * i]!, p[2 * i + 1]!));
    const perRing = Math.max(12, Math.ceil(Math.sqrt(input.count) * 6));
    ids.forEach((n, i) => {
      const ring = Math.floor(i / perRing), count = Math.min(perRing, ids.length - ring * perRing);
      const angle = (i % perRing) * Math.PI * 2 / count, r = radius * (1.08 + ring * .04);
      p[2 * n] = Math.cos(angle) * r; p[2 * n + 1] = Math.sin(angle) * r;
    });
  };
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
  private radii?: Float32Array;
  private forces: Float32Array;
  private oldForces: Float32Array;
  private convergence: Float32Array;
  private tree?: BarnesHut;
  private familyDegree?: Uint32Array;
  private hubMass?: Float32Array;
  private compensation = 1;
  constructor(private input: LayoutInput, private options: LayoutOptions) {
    validateLayout(options);
    const n = input.count;
    if (!Number.isSafeInteger(n) || n < 0 || input.source.length !== input.target.length || (input.initial && input.initial.length !== n * 2) || (input.movable && input.movable.length !== n)) throw new Error('Invalid layout input');
    for (let e = 0; e < input.source.length; e++) if (input.source[e]! >= n || input.target[e]! >= n) throw new Error('Invalid layout endpoint');
    if (input.up) {
      const { offsets, targets } = input.up;
      if (offsets.length !== n + 1 || offsets[0] !== 0 || offsets[n] !== targets.length) throw new Error('Invalid hierarchy CSR');
      for (let i = 0; i < n; i++) if (offsets[i]! > offsets[i + 1]!) throw new Error('Invalid hierarchy CSR');
      for (const parent of targets) if (parent >= n) throw new Error('Invalid hierarchy endpoint');
      if (options.force.familyPull) {
        const degree = this.familyDegree = new Uint32Array(n);
        for (let i = 0; i < n; i++) degree[i] = offsets[i + 1]! - offsets[i]!;
        for (const parent of targets) degree[parent]!++;
      }
    }
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
    // Default sqrt-degree AREA curve (1x..5x radius), with sqrt-count spacing
    // in layout units. This is a camera-independent proxy, not a pixel guarantee.
    if (options.force.adjustSizes) {
      let max = 1; for (const m of this.mass) max = Math.max(max, m - 1);
      this.radii = this.mass.map(m => options.nodeRadius * Math.max(1, Math.sqrt(n) / 16) * Math.sqrt(1 + 24 * Math.sqrt((m - 1) / max)));
    }
    if (options.force.hubGravity) {
      const totals = this.hubMass = new Float32Array(n), mass = this.mass;
      for (let e = 0; e < input.source.length; e++) {
        const a = input.source[e]!, b = input.target[e]!;
        if (mass[a]! < mass[b]!) totals[a]! += Math.sqrt(mass[b]!);
        else if (mass[b]! < mass[a]!) totals[b]! += Math.sqrt(mass[a]!);
      }
    }
    if (options.force.outboundAttractionDistribution && n) this.compensation = this.mass.reduce((sum, m) => sum + m, 0) / n;
    this.forces = new Float32Array(n * 2); this.oldForces = new Float32Array(n * 2); this.convergence = new Float32Array(n).fill(1);
    if (options.force.barnesHutOptimize && n) this.tree = new BarnesHut(n);
  }
  get settled(): boolean { return !this.input.count || this.quiet >= Math.min(this.limit, this.options.convergenceIterations); }
  get done(): boolean { return !this.input.count || this.iteration >= this.limit || (this.options.convergenceThreshold > 0 && this.settled); }
  step(): void {
    if (this.done) return;
    const { count: n, source, target, movable } = this.input, o = this.options, f = o.force, p = this.positions, mass = this.mass;
    const old = this.oldForces; this.oldForces = this.forces; this.forces = old;
    const forces = this.forces, history = this.oldForces;
    forces.fill(0);
    if (this.tree) { this.tree.build(p, mass, o.maxTreeDepth); this.tree.repulse(p, mass, forces, f.scalingRatio, f.barnesHutTheta, movable, this.radii); }
    else {
      for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
        const dx = p[2 * i]! - p[2 * j]!, dy = p[2 * i + 1]! - p[2 * j + 1]!;
        let d = Math.sqrt(dx * dx + dy * dy), factor = 0;
        if (this.radii) d = Math.max(d * .5, d - this.radii[i]! - this.radii[j]!);
        if (d > 0) factor = f.scalingRatio * mass[i]! * mass[j]! / (d * d);
        const x = dx * factor, y = dy * factor;
        forces[2 * i]! += x; forces[2 * i + 1]! += y; forces[2 * j]! -= x; forces[2 * j + 1]! -= y;
      }
    }
    for (let i = 0; i < n; i++) {
      const x = p[2 * i]!, y = p[2 * i + 1]!, distance = Math.sqrt(x * x + y * y);
      const gravity = distance > 0 ? f.gravity * mass[i]! / (f.strongGravityMode ? 1 : distance) : 0;
      forces[2 * i]! -= x * gravity; forces[2 * i + 1]! -= y * gravity;
    }
    const up = f.familyPull ? this.input.up : undefined;
    let child = 0;
    // Link attraction and optional linear parent pull share the integrator, not degree mass.
    // CSR advances once per child: O(edges + notes + parents), never pairwise siblings.
    for (let e = 0; e < source.length + (up?.targets.length ?? 0); e++) {
      const family = e >= source.length, h = e - source.length;
      if (family) while (up!.offsets[child + 1]! <= h) child++;
      const a = family ? child : source[e]!, b = family ? up!.targets[h]! : target[e]!, x = p[2 * a]! - p[2 * b]!, y = p[2 * a + 1]! - p[2 * b + 1]!;
      const distance = Math.sqrt(x * x + y * y) - (this.radii ? this.radii[a]! + this.radii[b]! : 0);
      if ((f.adjustSizes || f.linLogMode) && distance <= 0) continue;
      const factor = family ? -f.familyPull / Math.sqrt(this.familyDegree![a]! * this.familyDegree![b]!) : -this.compensation * (f.linLogMode ? Math.log1p(distance) / distance : 1) / (f.outboundAttractionDistribution ? mass[a]! : 1);
      forces[2 * a]! += x * factor; forces[2 * a + 1]! += y * factor;
      forces[2 * b]! -= x * factor; forces[2 * b + 1]! -= y * factor;
    }
    // Larger neighbours pull only the smaller side. Sqrt-degree weights sum to
    // hubGravity per follower, so parallel edges and many hubs cannot amplify it.
    if (this.hubMass) for (let e = 0; e < source.length; e++) {
      let a = source[e]!, b = target[e]!;
      if (mass[a] === mass[b]) continue;
      if (mass[a]! > mass[b]!) [a, b] = [b, a];
      const k = f.hubGravity * Math.sqrt(mass[b]!) / this.hubMass[a]!;
      forces[2 * a]! += (p[2 * b]! - p[2 * a]!) * k;
      forces[2 * a + 1]! += (p[2 * b + 1]! - p[2 * a + 1]!) * k;
    }
    let movement = 0, moved = 0;
    for (let i = 0; i < n; i++) {
      if (movable && !movable[i]) continue;
      const dx = forces[2 * i]!, dy = forces[2 * i + 1]!;
      const ox = history[2 * i]!, oy = history[2 * i + 1]!;
      const swing = mass[i]! * Math.sqrt((ox - dx) ** 2 + (oy - dy) ** 2), traction = Math.sqrt((ox + dx) ** 2 + (oy + dy) ** 2) / 2;
      // A balanced overlap node must be able to respond when its neighbours move.
      let speed = (f.adjustSizes && this.convergence[i] === 0 ? 1 : this.convergence[i]!) * Math.log1p(traction) / (1 + Math.sqrt(swing));
      this.convergence[i] = Math.min(1, Math.sqrt(speed * (dx * dx + dy * dy) / (1 + Math.sqrt(swing))));
      // Damping affects displacement only, not the convergence recurrence.
      if (f.adjustSizes) speed *= .3;
      const beforeX = p[2 * i]!, beforeY = p[2 * i + 1]!;
      p[2 * i] = beforeX + dx * speed / f.slowDown; p[2 * i + 1] = beforeY + dy * speed / f.slowDown;
      if (!Number.isFinite(p[2 * i]) || !Number.isFinite(p[2 * i + 1])) throw new Error('Layout produced nonfinite positions; change force settings');
      movement += (p[2 * i]! - beforeX) ** 2 + (p[2 * i + 1]! - beforeY) ** 2; moved++;
    }
    this.iteration++; this.movement = Math.sqrt(movement / Math.max(1, moved));
    let extent = 0;
    for (const value of p) extent += value * value;
    // A budget ending is not convergence. Compensate step damping as well as
    // slowdown so tiny integration steps cannot manufacture a settled report.
    const threshold = o.convergenceThreshold || .002 * Math.sqrt(extent / Math.max(1, n));
    this.quiet = this.movement * (o.convergenceThreshold ? 1 : f.slowDown / (f.adjustSizes ? .3 : 1)) <= threshold ? this.quiet + 1 : 0;
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
export async function runLayoutStream(input: LayoutInput, options: LayoutOptions, every: number, emit: (p: Float32Array, iteration: number, total: number) => void, yieldNow: () => Promise<void>, buffer = (length: number) => new Float32Array(length), finished = (_settled: boolean) => {}): Promise<Float32Array> {
  if (!Number.isSafeInteger(every) || every < 1) throw new Error('Invalid layout stream cadence');
  const solver = new LayoutSolver(input, options);
  const send = () => { const p = buffer(solver.positions.length); p.set(solver.positions); emit(p, solver.iteration, solver.limit); };
  if (!input.count) { finished(true); return solver.positions; }
  // A seed is not a layout. Every published frame has completed at least one batch.
  await yieldNow();
  while (!solver.done) {
    solver.step();
    if (!solver.done && solver.iteration % every === 0) send();
    if (!solver.done && (solver.iteration % options.batchIterations === 0 || solver.iteration % every === 0)) await yieldNow();
  }
  finished(solver.settled);
  return solver.positions;
}
