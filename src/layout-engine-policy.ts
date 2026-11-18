export const LAYOUT_ENGINES = ['auto', 'processor', 'graphics'] as const;
export type LayoutEnginePreference = typeof LAYOUT_ENGINES[number];
export type LayoutEngine = Exclude<LayoutEnginePreference, 'auto'>;
/** Quality admission is versioned with the shipped solver, never inferred from timing. */
export const AUTO_GRAPHICS_QUALITY = true;
export const AUTO_LAYOUT_MIN_NODES = 5000;
export interface EngineTiming {
  bucket: number;
  engine: LayoutEngine;
  processorMs: number;
  graphicsMs: number;
  setupMs: number;
  iterations: number;
}
export interface EngineStatus {
  engine: LayoutEngine;
  automatic: boolean;
  reason: 'small' | 'manual' | 'unavailable' | 'unsupported' | 'timing' | 'remembered' | 'failed' | 'stopped';
  timing?: EngineTiming;
}
export const engineBucket = (count: number) => count < AUTO_LAYOUT_MIN_NODES ? 0 : Math.min(20, Math.floor(Math.log2(count / AUTO_LAYOUT_MIN_NODES)) + 1);
/** Compare measured equal work, charging adapter/device/pipeline setup once.
 * Neither trial's state is used to initialize the selected engine. */
export function chooseLayoutEngine(count: number, iterations: number, samples: number, processorMs: number, graphicsMs: number, setupMs: number, quality = AUTO_GRAPHICS_QUALITY): EngineTiming {
  const valid = [iterations, samples, processorMs, graphicsMs, setupMs].every(v => Number.isFinite(v) && v >= 0) && samples > 0 && iterations > 0;
  const cpu = valid ? processorMs : 0, gpu = valid ? setupMs + graphicsMs : 0;
  return { bucket: engineBucket(count), engine: count >= AUTO_LAYOUT_MIN_NODES && valid && quality && cpu >= gpu * 1.5 && cpu > 0 ? 'graphics' : 'processor', processorMs: cpu, graphicsMs: gpu, setupMs: valid ? setupMs : 0, iterations: valid ? samples : 0 };
}
/** Strictly bounded numeric-only records; unknown properties never survive storage. */
export function engineTimings(value: unknown): EngineTiming[] {
  if (!Array.isArray(value)) return [];
  const records = new Map<number, EngineTiming>();
  for (const v of value.slice(-21)) {
    if (!v || !Number.isInteger(v.bucket) || v.bucket < 0 || v.bucket > 20 || !['processor', 'graphics'].includes(v.engine)) continue;
    if (!['processorMs', 'graphicsMs', 'setupMs', 'iterations'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k]) && v[k] >= 0 && v[k] <= 1e12)) continue;
    records.set(v.bucket, { bucket: v.bucket, engine: v.engine, processorMs: v.processorMs, graphicsMs: v.graphicsMs, setupMs: v.setupMs, iterations: v.iterations });
  }
  return [...records.values()];
}
export function layoutEngineText(status: EngineStatus): string {
  const name = status.engine === 'graphics' ? 'Graphics chip' : 'Processor';
  if (status.reason === 'failed') return 'Processor (graphics stopped)';
  if (status.reason === 'unavailable') return 'Processor (graphics unavailable)';
  if (status.reason === 'unsupported') return 'Processor (graphics limits)';
  return `${name}${status.automatic ? ' (auto)' : ''}`;
}
