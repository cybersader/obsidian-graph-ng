import { LayoutSolver, runLayoutStream, validateLayoutInput, visualStop, VISUAL_STRIDE, type LayoutInput, type LayoutOptions } from './core/layout';
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
  quickStart?: boolean;
  preference?: LayoutEnginePreference;
  remembered?: EngineTiming[];
  every: number;
  stopped(): boolean;
  yieldNow(): Promise<void>;
  buffer?(length: number): Float32Array;
  wantsFrame?(iteration: number): boolean;
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
    let gpu: GraphicsSolver | undefined, positions = input.initial, iteration = 0, settled = false, looksDone = false;
    const visual = visualStop(options, true, !!input.movable);
    const report = (engine: EngineStatus['engine'], reason: EngineStatus['reason'], evictBucket?: number) => {
      status = { engine, automatic, reason, evictBucket }; run.status?.(status);
    };
    const release = () => { gpu?.destroy(); gpu = undefined; };
    const bucket = engineBucket(input.count), mode = +!!input.movable + 2 * +(options.convergenceThreshold > 0);
    const { every } = run, batch = options.batchIterations;
    const nextBatch = (i: number, end: number) => Math.min(options.convergenceThreshold > 0 ? 1 : 4, visual ? VISUAL_STRIDE - i % VISUAL_STRIDE : Infinity, end - i, every - i % every, batch - i % batch);
    const buffer = run.buffer ?? ((length: number) => new Float32Array(length));
    let timing: EngineTiming | undefined;
    const deadline = run.quickStart ? this.deps.now() + 2000 : Infinity;
    let budgetDraft = false, active = true;
    const budget = () => budgetDraft = !!run.quickStart && !run.stopped() && this.deps.now() >= deadline;
    const result = () => ({ positions: positions!, budgetDraft, settled: !budgetDraft && !run.stopped() && settled && !looksDone, looksDone: !budgetDraft && !run.stopped() && looksDone,
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
              if (step.positions.length !== input.count * 2 || !step.positions.every(Number.isFinite) || !Number.isFinite(step.quiet) || !Number.isFinite(step.movement) || visual && !Number.isFinite(step.extent)) throw Error('Invalid graphics result');
              positions = step.positions; iteration += n;
              settled = step.quiet >= Math.min(total, options.convergenceIterations);
              looksDone = !(settled && iteration === total) && !!visual?.(iteration, step.movement, step.extent, positions);
              if (looksDone || options.convergenceThreshold > 0 && settled || iteration < total && budget()) break;
              if (iteration % every === 0 && iteration < total && (!run.wantsFrame || run.wantsFrame(iteration))) {
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
      if (!iteration && input.initial && run.stopped()) {
        validateLayoutInput(input, options);
        report(status.engine, 'unchanged'); return result();
      }
      if (!run.stopped() && (status.reason === 'manual' || status.reason === 'small')) run.status?.(status);
      let hintAt = !this.disabled && preference !== 'graphics' && run.status ? this.deps.now() + 8000 : Infinity;
      const checkpoint = () => {
        if (budget()) return true;
        if (hintAt !== Infinity && this.deps.now() >= hintAt) {
          hintAt = Infinity;
          const limits = computeRequirements(input, options);
          if (limits) void this.deps.adapter().then(adapter => {
            if (active && !run.stopped() && adapter && adapterSupports(adapter, limits)) { status = { ...status, tryGraphics: true }; run.status?.(status); }
          }).catch(() => {}); // Optional help must never delay or fail the solve.
        }
        return false;
      };
      // Remaining work limits execution, not the original required quiet streak. Restart history conservatively.
      positions = await runLayoutStream(iteration ? { ...input, initial: positions } : input, options, every,
        (frame, step) => run.emit(frame, iteration + step, total, status), run.yieldNow, buffer, (s, steps, visual) => { settled = s; looksDone = visual; if (!iteration && !steps && run.stopped()) report('processor', 'unchanged'); }, run.stopped, undefined, total - iteration, iteration, run.wantsFrame, checkpoint);
      return result();
    } finally { active = false; release(); controller.abort(); if (this.abort === controller) this.abort = undefined; }
  }
}
