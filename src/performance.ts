/** Local, coarse performance signals. No identities, paths, text or renderer names are retained. */
export type PerformanceMode = 'auto' | 'fast' | 'quality';
export type DeviceTier = 'low' | 'standard';
export const PERFORMANCE_MODES: PerformanceMode[] = ['auto', 'fast', 'quality'];
export function deviceTier(cores?: number, memory?: number, texture?: number, software = false): DeviceTier {
  return software || [cores, memory].some(n => Number.isFinite(n) && n! > 0 && n! <= 4) || !!texture && texture <= 4096 ? 'low' : 'standard';
}
export class PerformanceState {
  tier: DeviceTier;
  frameMs = 0;
  longTasks = 0;
  longTaskMs = 0;
  private samples = 0;
  private quick = 0;
  constructor(cores?: number, memory?: number) { this.tier = deviceTier(cores, memory); }
  fast(mode: PerformanceMode) { return mode === 'fast' || mode === 'auto' && this.tier === 'low'; }
  frame(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.frameMs += (ms - this.frameMs) / Math.min(++this.samples, 16);
    // Hysteresis: sustained measured cost can contradict either initial guess.
    if (this.samples >= 8 && this.frameMs > 24) { this.tier = 'low'; this.quick = 0; }
    else if (this.frameMs < 8 && ++this.quick >= 120) { this.tier = 'standard'; this.quick = 0; }
    else if (this.frameMs >= 8) this.quick = 0;
  }
  task(ms: number) { this.longTasks++; this.longTaskMs += ms; if (this.longTasks >= 3 && this.longTaskMs > 200) this.tier = 'low'; }
  observe() {
    let observer: PerformanceObserver | undefined;
    try { observer = new PerformanceObserver(list => { for (const e of list.getEntries()) this.task(e.duration); }); observer.observe({ type: 'longtask' }); } catch { /* Optional public API. */ }
    const timer = setTimeout(() => observer?.disconnect(), 10000);
    return () => { clearTimeout(timer); observer?.disconnect(); };
  }
}
const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number };
export const devicePerformance = new PerformanceState(nav?.hardwareConcurrency, nav?.deviceMemory);
const METRICS = ['notes', 'edges', 'ingestMs', 'projectMs', 'labelsMs', 'labelUploadMs', 'groupsMs', 'layoutMs', 'totalMs', 'frameMs', 'longTasks', 'longTaskMs', 'heapBytes'] as const;
export type PerformanceRecord = { tier: DeviceTier; mode: PerformanceMode } & Partial<Record<typeof METRICS[number], number>>;
/** Both disk input and live samples cross the same allowlist, never a spread of host data. */
export function performanceRecords(input: unknown): PerformanceRecord[] {
  if (!Array.isArray(input)) return [];
  return input.slice(-16).flatMap(value => {
    if (!value || typeof value !== 'object' || !['low', 'standard'].includes(value.tier) || !PERFORMANCE_MODES.includes(value.mode)) return [];
    const row: PerformanceRecord = { tier: value.tier, mode: value.mode };
    for (const key of METRICS) if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1e12) row[key] = Math.round(value[key]);
    return [row];
  });
}
