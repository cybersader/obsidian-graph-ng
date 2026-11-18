export const LAYOUT_ENGINES = ['auto', 'processor', 'graphics'] as const;
export type LayoutEnginePreference = typeof LAYOUT_ENGINES[number];
export type LayoutEngine = Exclude<LayoutEnginePreference, 'auto'>;
export const AUTO_LAYOUT_MIN_NODES = 5000;
export const engineBucket = (count: number) => count < AUTO_LAYOUT_MIN_NODES ? 0 : Math.min(20, Math.floor(Math.log2(count / AUTO_LAYOUT_MIN_NODES)) + 1);
// ADR-0010: no bucket qualified across community, scale-free and grid. Keep the
// allowlist empty, including unmeasured buckets; manual Graphics does not call this gate.
export const graphicsQuality = (_bucket: number) => false;
export interface EngineTiming {
  bucket: number; mode: number; every: number; batch: number; iterations: number;
  cpuSetup: number; gpuSetup: number; cpuStep: number; gpuStep: number; measuredAt: number;
}
export interface EngineStatus {
  engine: LayoutEngine; automatic: boolean;
  reason: 'small' | 'quality' | 'manual' | 'unavailable' | 'unsupported' | 'timing' | 'remembered' | 'failed' | 'stopped' | 'unchanged';
  timing?: EngineTiming; evictBucket?: number;
}
const integer = (x: number, min: number, max: number) => Number.isSafeInteger(x) && x >= min && x <= max;
export function engineTimings(value: unknown, now = Date.now()): EngineTiming[] {
  if (!Array.isArray(value)) return [];
  const records = new Map<number, EngineTiming>();
  for (const v of value.slice(-21)) {
    if (!v) continue;
    const {bucket, mode, every, batch, iterations, cpuSetup, gpuSetup, cpuStep, gpuStep, measuredAt} = v;
    if (!integer(bucket, 1, 20) || !integer(mode, 0, 3) || !integer(every, 1, 1e6) || !integer(batch, 1, 1e6) || !integer(iterations, 1, 8) || !integer(measuredAt, now - 7 * 86400000, now)) continue;
    if (![cpuSetup, gpuSetup, cpuStep, gpuStep].every(t => Number.isFinite(t) && t >= 0 && t <= 60000) || !cpuStep || !gpuStep) continue;
    records.set(bucket, {bucket, mode, every, batch, iterations, cpuSetup, gpuSetup, cpuStep, gpuStep, measuredAt});
  }
  return [...records.values()];
}
/** Only validated rates reach this comparison. A stored winner is never an input. */
export function chooseLayoutEngine(t: EngineTiming, steps: number): LayoutEngine {
  return t.cpuSetup + steps * t.cpuStep >= 1.5 * (t.gpuSetup + steps * t.gpuStep) ? 'graphics' : 'processor';
}
export function layoutEngineText(status: EngineStatus): string {
  const name = status.engine === 'graphics' ? 'Graphics chip' : 'Processor';
  if (status.reason === 'unchanged') return 'Stopped (starting positions kept)';
  if (status.reason === 'failed') return 'Processor (graphics stopped)';
  if (status.reason === 'unavailable') return 'Processor (graphics unavailable)';
  if (status.reason === 'unsupported') return 'Processor (graphics limits)';
  return `${name}${status.automatic ? ' (auto)' : ''}`;
}
