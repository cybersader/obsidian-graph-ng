import { PERFORMANCE_MODES, performanceRecords, type PerformanceMode, type PerformanceRecord } from './performance';

export interface DevicePreferences {
  performance: PerformanceMode;
  performanceDiagnostics: boolean;
  performanceSuggestions: boolean;
  performancePrompted: boolean;
}
export const deviceDefaults = (): DevicePreferences => ({ performance: 'auto', performanceDiagnostics: false, performanceSuggestions: true, performancePrompted: false });
export function devicePreferences(input: unknown): DevicePreferences {
  const result = deviceDefaults();
  if (!input || typeof input !== 'object') return result;
  const value = input as Record<string, unknown>;
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
interface DeviceState { settings: DevicePreferences; performanceLog: PerformanceRecord[] }
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'> | undefined;
/** Optional device/browser-profile storage, never a host telemetry or authorization boundary. */
export class DevicePerformanceStore {
  private storage?: ReturnType<StorageAccess>;
  private key?: string;
  constructor(namespace?: string, pluginId = 'graph-ng', access: StorageAccess = () => globalThis.localStorage) {
    if (!namespace || !/^[0-9a-f]{32}$/.test(namespace)) return;
    this.key = `graph-ng:${encodeURIComponent(pluginId)}:${namespace}:performance:v1`;
    try { this.storage = access(); } catch { /* Disabled browser storage stays session-only. */ }
  }
  load(legacy: unknown): DeviceState {
    let raw: string | null | undefined;
    try { raw = this.key && this.storage?.getItem(this.key); } catch { this.storage = undefined; }
    // Shared samples may belong to somebody else. Never migrate them, even when opted in.
    let settings = legacy, log: unknown = [];
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
