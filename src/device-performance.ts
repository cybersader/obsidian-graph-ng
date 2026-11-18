import { LAYOUT_ENGINES, engineTimings, type LayoutEnginePreference, type EngineTiming } from './layout-engine-policy';
import { PERFORMANCE_MODES, performanceRecords, type PerformanceMode, type PerformanceRecord } from './performance';

export interface DevicePreferences {
  layoutEngine: LayoutEnginePreference;
  performance: PerformanceMode;
  performanceDiagnostics: boolean;
  performanceSuggestions: boolean;
  performancePrompted: boolean;
}
export const deviceDefaults = (): DevicePreferences => ({ layoutEngine: 'auto', performance: 'auto', performanceDiagnostics: false, performanceSuggestions: true, performancePrompted: false });
export function devicePreferences(input: unknown): DevicePreferences {
  const result = deviceDefaults();
  if (!input || typeof input !== 'object') return result;
  const value = input as Record<string, unknown>;
  if (LAYOUT_ENGINES.includes(value.layoutEngine as LayoutEnginePreference)) result.layoutEngine = value.layoutEngine as LayoutEnginePreference;
  if (PERFORMANCE_MODES.includes(value.performance as PerformanceMode)) result.performance = value.performance as PerformanceMode;
  for (const key of ['performanceDiagnostics', 'performanceSuggestions', 'performancePrompted'] as const) if (typeof value[key] === 'boolean') result[key] = value[key];
  return result;
}
/** Keep the runtime settings object intact; only the shared write drops device preferences. */
export function sharedPerformanceData<T extends { settings: object }>(data: T) {
  const shared = { ...data, settings: { ...data.settings } };
  for (const key of Object.keys(deviceDefaults())) delete (shared.settings as Record<string, unknown>)[key];
  delete (shared as Record<string, unknown>).performanceLog;
  return shared;
}
// Fixed numeric tuples, no winner bit or free-form properties on disk.
const fields = ['bucket', 'mode', 'every', 'batch', 'iterations', 'cpuSetup', 'gpuSetup', 'cpuStep', 'gpuStep', 'measuredAt'] as const;
function decodeLayoutSamples(input: unknown) {
  return engineTimings(Array.isArray(input) ? input.slice(-21).flatMap(row =>
    Array.isArray(row) && row.length === fields.length ? [Object.fromEntries(fields.map((f,i) => [f,row[i]]))] : []) : []);
}
interface DeviceState { settings: DevicePreferences; performanceLog: PerformanceRecord[] }
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'> | undefined;
/** Optional device/browser-profile storage, never a host telemetry or authorization boundary. */
export class DevicePerformanceStore {
  private storage?: ReturnType<StorageAccess>;
  private key?: string;
  private layoutRecords = new Map<string, EngineTiming[]>();
  layoutChoices(version: string): EngineTiming[] {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) return [];
    let rows = this.layoutRecords.get(version);
    if (!rows) {
      try { const raw = this.key && this.storage?.getItem(`${this.key}:layout2:${version}`); rows = decodeLayoutSamples(raw && raw.length <= 8192 ? JSON.parse(raw) : []); }
      catch { rows = []; }
      this.layoutRecords.clear(); this.layoutRecords.set(version, rows);
    }
    return engineTimings(rows);
  }
  rememberLayout(version: string, timing?: EngineTiming, evictBucket?: number) {
    const previous = this.layoutChoices(version), rows = engineTimings([...previous.filter(r => r.bucket !== evictBucket), timing]);
    if (!this.layoutRecords.has(version)) return;
    this.layoutRecords.set(version, rows);
    try { if (this.key) this.storage?.setItem(`${this.key}:layout2:${version}`, JSON.stringify(rows.map(r => fields.map(f => r[f])))); }
    catch { this.storage = undefined; }
  }
  constructor(namespace?: string, pluginId = 'graph-ng', access: StorageAccess = () => globalThis.localStorage) {
    if (!namespace || !/^[0-9a-f]{32}$/.test(namespace)) return;
    this.key = `graph-ng:${encodeURIComponent(pluginId)}:${namespace}:performance:v1`;
    try { this.storage = access(); } catch { /* Disabled browser storage stays session-only. */ }
  }
  load(legacy: unknown): DeviceState {
    let raw: string | null | undefined;
    try { raw = this.key && this.storage?.getItem(this.key); } catch { this.storage = undefined; }
    // Shared samples may belong to somebody else. Never migrate them, even when opted in.
    // Layout engine never had a shared preference. Only a local record may opt in.
    let settings: unknown = { ...devicePreferences(legacy), layoutEngine: 'auto' }, log: unknown = [];
    if (raw != null) {
      settings = undefined;
      try {
        const value = raw.length <= 16384 ? JSON.parse(raw) : undefined;
        if (value?.version === 1) { settings = value.settings; log = value.performanceLog; }
      } catch { /* Malformed local data resets locally, never quarantines shared settings. */ }
    }
    return this.save(settings, log);
  }
  save(input: unknown, log: unknown): DeviceState {
    const settings = devicePreferences(input), state = { settings, performanceLog: settings.performanceDiagnostics ? performanceRecords(log) : [] };
    try { if (this.key) this.storage?.setItem(this.key, JSON.stringify({ version: 1, ...state })); }
    catch { this.storage = undefined; /* Runtime settings/log remain the in-memory fallback. */ }
    return state;
  }
}
