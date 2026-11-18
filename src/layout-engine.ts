import { LayoutSolver, runLayoutStream, type LayoutInput, type LayoutOptions } from './core/layout';
import { AUTO_LAYOUT_MIN_NODES, chooseLayoutEngine, engineBucket, engineTimings, type EngineStatus, type EngineTiming, type LayoutEnginePreference } from './layout-engine-policy';
import { adapterSupports, computeRequirements, requestComputeAdapter, WebGpuLayout, type ComputeAdapter, type GraphicsSolver } from './webgpu-layout';
interface EngineDependencies {
  adapter(): Promise<ComputeAdapter | undefined>;
  graphics(adapter: ComputeAdapter, input: LayoutInput, options: LayoutOptions, signal: AbortSignal): Promise<GraphicsSolver>;
  now(): number;
  watchdogMs: number;
}
export interface EngineRun {
  preference?: LayoutEnginePreference;
  remembered?: EngineTiming[];
  every: number;
  stopped(): boolean;
  yieldNow(): Promise<void>;
  emit(positions: Float32Array, iteration: number, total: number, status: EngineStatus): void;
  status?(status: EngineStatus): void;
}
/** One instance per layout worker. A graphics failure disables it until worker disposal. */
export class LayoutEngineSession {
  private disabled = false;
  private abort?: AbortController;
  private deps: EngineDependencies;
  constructor(dependencies: Partial<EngineDependencies> = {}) {
    this.deps = { adapter: requestComputeAdapter, graphics: WebGpuLayout.create, now: () => performance.now(), watchdogMs: 5000, ...dependencies };
  }
  stop() { this.abort?.abort(); }
  private async bounded<T>(work: Promise<T>, controller: AbortController): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined, cancel = () => {};
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        cancel = () => reject(new Error('Graphics cancelled'));
        controller.signal.addEventListener('abort', cancel, { once: true });
        if (controller.signal.aborted) cancel();
        timer = setTimeout(() => controller.abort(), this.deps.watchdogMs);
      })]);
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); }
  }
  async run(input: LayoutInput, options: LayoutOptions, run: EngineRun) {
    const preference = run.preference ?? 'auto', automatic = preference === 'auto';
    let status: EngineStatus = { engine: 'processor', automatic, reason: automatic ? 'small' : 'manual' };
    const total = input.movable ? options.relaxIterations : options.iterations;
    const controller = this.abort = new AbortController();
    let gpu: GraphicsSolver | undefined, positions = input.initial, iteration = 0, settled = false;
    const report = (next: EngineStatus) => { status = next; run.status?.(status); };
    const release = () => { gpu?.destroy(); gpu = undefined; };
    try {
      if (!Number.isSafeInteger(run.every) || run.every < 1) throw Error('Invalid layout stream cadence');
      if (!run.stopped() && preference !== 'processor' && (!automatic || input.count >= AUTO_LAYOUT_MIN_NODES)) {
        const requirements = computeRequirements(input, options);
        if (this.disabled || !requirements) report({ engine: 'processor', automatic, reason: this.disabled ? 'failed' : 'unsupported' });
        else try {
          const start = this.deps.now(), adapter = await this.bounded(this.deps.adapter(), controller);
          if (!adapter || !adapterSupports(adapter, requirements)) report({ engine: 'processor', automatic, reason: adapter ? 'unsupported' : 'unavailable' });
          else {
            const remembered = automatic && engineTimings(run.remembered).find(r => r.bucket === engineBucket(input.count));
            if (!remembered || remembered.engine === 'graphics') {
              const creating = this.deps.graphics(adapter, input, options, controller.signal);
              creating.then(x => { if (controller.signal.aborted) x.destroy(); }, () => {});
              gpu = await this.bounded(creating, controller);
            }
            if (!automatic) report({ engine: 'graphics', automatic, reason: 'manual' });
            else if (remembered) report({ engine: remembered.engine, automatic, reason: 'remembered' });
            else {
              const setupMs = this.deps.now() - start, cpuStart = this.deps.now();
              const trial = new LayoutSolver(input, options);
              while (trial.iteration < 8 && !trial.done && !run.stopped()) { if (!await trial.stepResponsive(run.yieldNow, run.stopped)) break; await run.yieldNow(); }
              if (!run.stopped()) {
                const cpuMs = this.deps.now() - cpuStart, gpuStart = this.deps.now();
                for (let step = 0; step < trial.iteration; step += 4)
                  await this.bounded(gpu!.batch(Math.min(4, trial.iteration - step)), controller);
                const timing = chooseLayoutEngine(input.count, total, trial.iteration, cpuMs, this.deps.now() - gpuStart, setupMs);
                if (timing.engine === 'graphics') gpu!.reset();
                report({ engine: timing.engine, automatic, reason: 'timing', timing });
              }
            }
          }
          if (gpu && status.engine === 'graphics') {
            while (iteration < total && !run.stopped()) {
              const batch = Math.min(options.convergenceThreshold > 0 ? 1 : 4, total - iteration, run.every - iteration % run.every);
              const step = await this.bounded(gpu.batch(batch), controller);
              if (step.positions.length !== input.count * 2 || !step.positions.every(Number.isFinite) || !Number.isFinite(step.quiet) || !Number.isFinite(step.movement)) throw Error('Invalid graphics result');
              positions = step.positions; iteration += batch;
              settled = step.quiet >= Math.min(total, options.convergenceIterations);
              if (options.convergenceThreshold > 0 && settled) break;
              if (iteration % run.every === 0 && iteration < total) run.emit(positions, iteration, total, status);
              await run.yieldNow();
            }
            if (iteration) return { positions: positions!, settled: !run.stopped() && settled, engineStatus: status };
          }
        } catch {
          if (!run.stopped()) { this.disabled = true; report({ engine: 'processor', automatic, reason: 'failed' }); }
          else if (iteration) return { positions: positions!, settled: false, engineStatus: status };
        }
      }
      release(); controller.abort();
      if (status.reason === 'manual' || status.reason === 'small') run.status?.(status);
      // One Processor scheduler, including cold Stop and positive-threshold streaming.
      const remaining = total - iteration;
      positions = await runLayoutStream(iteration ? { ...input, initial: positions } : input,
        iteration ? { ...options, iterations: remaining, relaxIterations: remaining } : options, run.every,
        (snapshot, step) => run.emit(snapshot, iteration + step, total, status), run.yieldNow, undefined, s => { settled = s; }, run.stopped);
      return { positions, settled, engineStatus: status };
    } finally { release(); controller.abort(); if (this.abort === controller) this.abort = undefined; }
  }
}
