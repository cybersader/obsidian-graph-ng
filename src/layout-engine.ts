import { LayoutSolver, runLayoutStream, type LayoutInput, type LayoutOptions } from './core/layout';
import { graphicsQuality, chooseLayoutEngine, engineBucket, engineTimings, type EngineStatus, type EngineTiming, type LayoutEnginePreference } from './layout-engine-policy';
import { adapterSupports, computeRequirements, requestComputeAdapter, WebGpuLayout, type ComputeAdapter, type GraphicsSolver } from './webgpu-layout';
interface EngineDependencies {
  adapter(): Promise<ComputeAdapter | undefined>;
  graphics(adapter: ComputeAdapter, input: LayoutInput, options: LayoutOptions, signal: AbortSignal): Promise<GraphicsSolver>;
  quality(bucket: number): boolean;
  now(): number;
  watchdogMs: number;
}
export interface EngineRun {
  preference?: LayoutEnginePreference;
  remembered?: EngineTiming[];
  every: number;
  stopped(): boolean;
  yieldNow(): Promise<void>;
  buffer?(length: number): Float32Array;
  emit(positions: Float32Array, iteration: number, total: number, status: EngineStatus): void;
  status?(status: EngineStatus): void;
}
/** One instance per layout worker. A graphics failure disables it until worker disposal. */
export class LayoutEngineSession {
  private disabled = false;
  private abort?: AbortController;
  private deps: EngineDependencies;
  constructor(dependencies: Partial<EngineDependencies> = {}) {
    this.deps = { quality: graphicsQuality, adapter: requestComputeAdapter, graphics: WebGpuLayout.create, now: () => performance.now(), watchdogMs: 5000, ...dependencies };
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
    const report = (engine: EngineStatus['engine'], reason: EngineStatus['reason'], evictBucket?: number) => {
      status = { engine, automatic, reason, evictBucket }; run.status?.(status);
    };
    const release = () => { gpu?.destroy(); gpu = undefined; };
    const bucket = engineBucket(input.count), mode = +!!input.movable + 2 * +(options.convergenceThreshold > 0);
    const { every } = run, batch = options.batchIterations;
    const nextBatch = (i: number, end: number) => Math.min(options.convergenceThreshold > 0 ? 1 : 4, end - i, every - i % every, batch - i % batch);
    const buffer = run.buffer ?? ((length: number) => new Float32Array(length));
    let timing: EngineTiming | undefined;
    const result = () => ({ positions: positions!, settled: !run.stopped() && settled,
      engineStatus: timing && !run.stopped() ? { ...status, timing } : status });
    try {
      if (!Number.isSafeInteger(every) || every < 1) throw Error('Invalid layout stream cadence');
      const record = automatic && engineTimings(run.remembered).find(r => r.bucket === bucket && r.every === every && r.batch === batch && r.mode === mode);
      if (automatic && bucket && !this.deps.quality(bucket)) report('processor', 'quality');
      else if (record && chooseLayoutEngine(record, total) === 'processor') report('processor', 'remembered');
      else if (!run.stopped() && preference !== 'processor' && (!automatic || bucket)) {
        const requirements = computeRequirements(input, options);
        if (this.disabled || !requirements) report('processor', this.disabled ? 'failed' : 'unsupported');
        else try {
          const start = this.deps.now(), adapter = await this.bounded(this.deps.adapter(), controller);
          if (!adapter || !adapterSupports(adapter, requirements)) report('processor', adapter ? 'unsupported' : 'unavailable', record ? bucket : undefined);
          else {
            const creating = this.deps.graphics(adapter, input, options, controller.signal);
            creating.then(x => { if (controller.signal.aborted) x.destroy(); }, () => {});
            gpu = await this.bounded(creating, controller);
            if (!automatic || record) report('graphics', automatic ? 'remembered' : 'manual');
            else {
              const cpuStart = this.deps.now(), gpuSetup = cpuStart - start;
              const trial = new LayoutSolver(input, options), cpuReady = this.deps.now();
              await runLayoutStream(input, options, every, () => {}, run.yieldNow, undefined, undefined, run.stopped, trial, Math.min(8, total));
              const gpuStart = this.deps.now(), iterations = trial.iteration;
              for (let i = 0; i < iterations && !run.stopped();) {
                const n = nextBatch(i, iterations); await this.bounded(gpu.batch(n), controller); i += n; await run.yieldNow();
              }
              if (!run.stopped()) {
                [timing] = engineTimings([{ bucket, mode, batch, every, iterations, cpuSetup: cpuReady - cpuStart, gpuSetup,
                  cpuStep: (gpuStart - cpuReady) / iterations, gpuStep: (this.deps.now() - gpuStart) / iterations, measuredAt: Date.now() }]);
                const engine = timing ? chooseLayoutEngine(timing, total) : 'processor';
                if (engine === 'graphics') gpu.reset();
                report(engine, 'timing');
              }
            }
          }
          if (gpu && status.engine === 'graphics') {
            while (iteration < total && !run.stopped()) {
              const n = nextBatch(iteration, total), step = await this.bounded(gpu.batch(n), controller);
              if (step.positions.length !== input.count * 2 || !step.positions.every(Number.isFinite) || !Number.isFinite(step.quiet) || !Number.isFinite(step.movement)) throw Error('Invalid graphics result');
              positions = step.positions; iteration += n;
              settled = step.quiet >= Math.min(total, options.convergenceIterations);
              if (options.convergenceThreshold > 0 && settled) break;
              if (iteration % every === 0 && iteration < total) {
                const frame = buffer(positions.length); frame.set(positions); run.emit(frame, iteration, total, status);
              }
              await run.yieldNow();
            }
            if (iteration) return result();
          }
        } catch {
          timing = undefined;
          if (!run.stopped()) { this.disabled = true; report('processor', 'failed', bucket); }
          else if (iteration) return result();
        }
      }
      release(); controller.abort();
      if (run.stopped()) {
        if (input.initial instanceof Float32Array && input.initial.length === input.count * 2 && input.initial.every(Number.isFinite)) return { positions: input.initial, settled: false, engineStatus: { ...status, reason: 'unchanged' as const } };
        report('processor', 'stopped');
      } else if (status.reason === 'manual' || status.reason === 'small') run.status?.(status);
      // Remaining work limits execution, not the original required quiet streak. Restart history conservatively.
      positions = await runLayoutStream(iteration ? { ...input, initial: positions } : input, options, every,
        (frame, step) => run.emit(frame, iteration + step, total, status), run.yieldNow, buffer, s => { settled = s; }, run.stopped, undefined, total - iteration, iteration);
      return result();
    } finally { release(); controller.abort(); if (this.abort === controller) this.abort = undefined; }
  }
}
