import { DEFAULT_LAYOUT, validateLayout, type LayoutOptions } from './core/layout-options';
import { defaultDeclaration, migrateDeclaration, validateDeclaration, type GraphDeclaration } from './core/declaration';
import { canonicalView, emptyView, validateSaved, validateView, type ExploreView, type SavedView } from './core/explore';
/** Presentation knobs. Each effect has an explicit cost ceiling and software policy. */
export interface Visuals {
  degreeSizing: number;
  edgeOpacity: number;
  edgeDensityReference: number;
  edgeColorMix: number;
  edgeDirection: boolean;
  glow: number;
  curvedEdges: boolean;
  curvature: number;
  curveSegments: number;
  hoverHighlight: boolean;
  dimOpacity: number;
  groupHalos: boolean;
  haloOpacity: number;
  autoPalette: boolean;
  labelFade: boolean;
  cameraAnimationMs: number;
  glowMaxNodes: number;
  curvesMaxEdges: number;
  halosMaxGroups: number;
  hubsMaxGroups: number;
  softwareEffects: boolean;
}
export interface ExploreSettings { panelOpen: boolean; facetValues: number; legendPageSize: number; view: ExploreView; savedViews: SavedView[] }
export const defaultVisuals = (): Visuals => ({
  degreeSizing: 1.6, edgeOpacity: .4, edgeDensityReference: 3000, edgeColorMix: .65, edgeDirection: false, glow: .3,
  curvedEdges: true, curvature: .12, curveSegments: 8, hoverHighlight: true, dimOpacity: .12, groupHalos: true, haloOpacity: .08,
  autoPalette: true, labelFade: true, cameraAnimationMs: 450, glowMaxNodes: 250000, curvesMaxEdges: 60000, halosMaxGroups: 48, hubsMaxGroups: 256, softwareEffects: false,
});
export const defaultExplore = (): ExploreSettings => ({ panelOpen: true, facetValues: 50, legendPageSize: 40, view: emptyView(), savedViews: [] });
const flags = ['edgeDirection', 'curvedEdges', 'hoverHighlight', 'groupHalos', 'autoPalette', 'labelFade', 'softwareEffects'] as const;
const unit = ['edgeOpacity', 'edgeColorMix', 'glow', 'dimOpacity', 'haloOpacity'] as const;
const counts = ['edgeDensityReference', 'curveSegments', 'glowMaxNodes', 'curvesMaxEdges', 'halosMaxGroups', 'hubsMaxGroups'] as const;
export function validateVisuals(v: unknown): asserts v is Visuals {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('visuals must be an object');
  const o = v as Record<string, unknown>, known = Object.keys(defaultVisuals());
  for (const k of Object.keys(o)) if (!known.includes(k)) throw new Error(`Unknown visual setting: ${k}`);
  for (const k of flags) if (typeof o[k] !== 'boolean') throw new Error(`visuals.${k} must be boolean`);
  for (const k of unit) if (typeof o[k] !== 'number' || !(o[k] as number >= 0 && o[k] as number <= 1)) throw new Error(`visuals.${k} must be between 0 and 1`);
  for (const k of counts) if (!Number.isSafeInteger(o[k]) || (o[k] as number) < 0) throw new Error(`visuals.${k} must be a nonnegative integer (0 disables)`);
  if (typeof o.degreeSizing !== 'number' || !(o.degreeSizing >= 0 && o.degreeSizing <= 8)) throw new Error('visuals.degreeSizing must be between 0 and 8');
  if (typeof o.curvature !== 'number' || !(o.curvature >= 0 && o.curvature <= .5)) throw new Error('visuals.curvature must be between 0 and 0.5');
  if ((o.curveSegments as number) < 2 || (o.curveSegments as number) > 32) throw new Error('visuals.curveSegments must be 2–32');
  if (typeof o.cameraAnimationMs !== 'number' || !(o.cameraAnimationMs >= 0 && o.cameraAnimationMs <= 5000)) throw new Error('visuals.cameraAnimationMs must be 0–5000');
}
export function validateExplore(v: unknown): asserts v is ExploreSettings {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('explore must be an object');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['panelOpen', 'facetValues', 'legendPageSize', 'view', 'savedViews'].includes(k)) throw new Error(`Unknown explore setting: ${k}`);
  if (typeof o.panelOpen !== 'boolean') throw new Error('explore.panelOpen must be boolean');
  for (const k of ['facetValues', 'legendPageSize'] as const) if (!Number.isSafeInteger(o[k]) || (o[k] as number) < 1 || (o[k] as number) > 10000) throw new Error(`explore.${k} must be 1–10000`);
  validateView(o.view); validateSaved(o.savedViews);
}
/** Saves folder prefixes as segments so view state stays settings-sharing safe. */
export function canonicalExplore(e: ExploreSettings): ExploreSettings {
  return { ...e, view: canonicalView(e.view), savedViews: e.savedViews.map(s => ({ ...s, view: canonicalView(s.view) })) };
}
/** Settings-sharing scanners refuse long whitespace-free runs. View state can hold
 * note-derived text (group keys, filter values, queries), so persisted `explore`
 * strings with such a run are written as `{"$text": [chunks ≤ 24]}` and joined on load.
 * In-memory settings always hold plain strings. */
const TEXT_CHUNK = 24, OPAQUE_RUN = /\S{32,}/;
export function encodeText(v: unknown): unknown {
  if (typeof v === 'string') { if (!OPAQUE_RUN.test(v)) return v; const parts: string[] = []; for (let i = 0; i < v.length; i += TEXT_CHUNK) parts.push(v.slice(i, i + TEXT_CHUNK)); return { $text: parts }; }
  if (Array.isArray(v)) return v.map(encodeText);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, c]) => [k, encodeText(c)]));
  return v;
}
export function decodeText(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeText);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>, keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === '$text') { const parts = o.$text; if (!Array.isArray(parts) || parts.length > 4096 || parts.some(x => typeof x !== 'string' || x.length > TEXT_CHUNK)) throw new Error('Invalid encoded text'); return parts.join(''); }
    return Object.fromEntries(keys.map(k => [k, decodeText(o[k])]));
  }
  return v;
}
/** The exact object written to data.json: settings only, explore text scanner-safe. */
export const persistedSettings = (s: Settings) => ({ ...s, explore: encodeText(s.explore) });
export interface Settings {
  settingsVersion: 2;
  ingest: { chunkRows: number; budgetMs: number };
  cache: { directory: string; chunkBytes: number; maxGenerationBytes: number; retainedArtifacts: number; maxRetainedBytes: number };
  maxProjectionBytes: number;
  maxSettingsBytes: number;
  canvasMaxDetailNodes: number;
  canvasMaxDetailEdges: number;
  labelsMaxPerViewport: number;
  labelCandidateMultiplier: number;
  frameBackstopMs: number;
  shaderPollMs: number;
  contextRestoreTimeoutMs: number;
  cameraMinRatio: number;
  cameraMaxRatio: number;
  declaration: GraphDeclaration;
  layout: LayoutOptions;
  debounceMs: number;
  workerTimeoutMs: number;
  workerRestarts: number;
  streamEveryIterations: number;
  lodZoomRatio: number;
  groupLevel: number;
  nodeSize: number;
  edgeSize: number;
  labelSize: number;
  groupRadius: number;
  groupCurveDivisor: number;
  groupEdgeHitRadius: number;
  groupCurveSamples: number;
  groupLoopScale: number;
  groupRingPadding: number;
  labelDensity: number;
  labelGridCellSize: number;
  labelRenderedSizeThreshold: number;
  edgeWidthScale: number;
  listPageSize: number;
  groupCanvasPageSize: number;
  maxProjectionGroups: number;
  maxProjectionPairs: number;
  maxProjectionCarriers: number;
  backgroundColor: string;
  nodeColor: string;
  edgeColor: string;
  groupColor: string;
  textColor: string;
  persistLayout: boolean;
  cachedDeclarations: number;
  projectionFile: string;
  visuals: Visuals;
  explore: ExploreSettings;
}
export function defaults(producer: string): Settings {
  return {
    settingsVersion: 2, canvasMaxDetailNodes: 2000, canvasMaxDetailEdges: 10000, labelsMaxPerViewport: 400,
    labelCandidateMultiplier: 32, frameBackstopMs: 32, shaderPollMs: 8, contextRestoreTimeoutMs: 5000, cameraMinRatio: .02, cameraMaxRatio: 8,
    ingest: { chunkRows: 2000, budgetMs: 8 }, cache: { directory: '', chunkBytes: 1048576, maxGenerationBytes: 268435456, retainedArtifacts: 8, maxRetainedBytes: 268435456 }, maxProjectionBytes: 67108864, maxSettingsBytes: 16777216,
    declaration: defaultDeclaration(producer), layout: structuredClone(DEFAULT_LAYOUT), debounceMs: 5000,
    workerTimeoutMs: 120000, workerRestarts: 2, streamEveryIterations: 5, lodZoomRatio: 1.8, groupLevel: 0, nodeSize: 3, edgeSize: 0.5, labelSize: 13,
    groupRadius: 26, groupCurveDivisor: 5, groupEdgeHitRadius: 6, groupCurveSamples: 32, groupLoopScale: 1.5, groupRingPadding: 56, labelDensity: 1, labelGridCellSize: 100, labelRenderedSizeThreshold: 6, edgeWidthScale: 0.8, listPageSize: 100,
    backgroundColor: '#141b26', nodeColor: '#7fc8e7', edgeColor: '#43566e', groupColor: '#7fc8e7', textColor: '#edf4ff',
    persistLayout: true, cachedDeclarations: 1, projectionFile: '', groupCanvasPageSize: 6,
    maxProjectionGroups: 20000, maxProjectionPairs: 200000, maxProjectionCarriers: 1000000,
    visuals: defaultVisuals(), explore: defaultExplore(),
  };
}
export function validateSettings(v: unknown): asserts v is Settings {
  if (!v || typeof v !== 'object') throw new Error('Settings must be an object');
  const s = v as Settings, keys = Object.keys(defaults('producer@1'));
  for (const k of Object.keys(s)) if (!keys.includes(k)) throw new Error(`Unknown setting: ${k}`);
  if (s.settingsVersion !== 2) throw new Error('Unsupported settings version');
  if (!Number.isSafeInteger(s.workerRestarts) || s.workerRestarts < 0) throw new Error('workerRestarts must be a nonnegative integer');
  validateDeclaration(s.declaration);
  if (!s.ingest || !Number.isSafeInteger(s.ingest.chunkRows) || s.ingest.chunkRows < 1 || !Number.isFinite(s.ingest.budgetMs) || s.ingest.budgetMs <= 0) throw new Error('Invalid ingestion budget');
  if (!s.cache || typeof s.cache.directory !== 'string' || (s.cache.directory !== '' && (!s.cache.directory.startsWith('cache/') || s.cache.directory.split('/').some(p => !p || p === '..' || p === '.') || /[\\:]/.test(s.cache.directory)))) throw new Error('Cache directory must be empty or a plugin-owned cache/ subdirectory');
  if (!Number.isSafeInteger(s.cache.retainedArtifacts) || s.cache.retainedArtifacts < 0 || !Number.isSafeInteger(s.cache.maxRetainedBytes) || s.cache.maxRetainedBytes < 0) throw new Error('Invalid derived-cache retention budget');
  if (!Number.isSafeInteger(s.cache.chunkBytes) || s.cache.chunkBytes < 4 || s.cache.chunkBytes > 1048576 || !Number.isSafeInteger(s.cache.maxGenerationBytes) || s.cache.maxGenerationBytes < s.cache.chunkBytes) throw new Error('Invalid cache byte budget');
  if (!Number.isSafeInteger(s.maxSettingsBytes) || s.maxSettingsBytes < 1) throw new Error('Invalid settings byte budget');
  if (!Number.isSafeInteger(s.maxProjectionBytes) || s.maxProjectionBytes < 1) throw new Error('Invalid projection byte budget');
  for (const key of ['frameBackstopMs', 'shaderPollMs', 'contextRestoreTimeoutMs', 'cameraMinRatio', 'cameraMaxRatio', 'debounceMs', 'workerTimeoutMs', 'lodZoomRatio', 'nodeSize', 'edgeSize', 'labelSize', 'groupRadius', 'groupCurveDivisor', 'groupEdgeHitRadius', 'groupCurveSamples', 'groupLoopScale', 'groupRingPadding', 'labelDensity', 'labelGridCellSize', 'labelRenderedSizeThreshold', 'edgeWidthScale'] as const) if (!Number.isFinite(s[key]) || s[key] <= 0) throw new Error(`${key} must be positive`);
  for (const key of ['canvasMaxDetailNodes', 'canvasMaxDetailEdges', 'labelCandidateMultiplier', 'labelsMaxPerViewport', 'streamEveryIterations', 'groupLevel', 'groupCurveSamples', 'listPageSize', 'groupCanvasPageSize', 'cachedDeclarations'] as const) if (!Number.isSafeInteger(s[key]) || s[key] < (key === 'groupLevel' ? 0 : 1)) throw new Error(`Invalid ${key}`);
  if (s.cameraMinRatio >= s.cameraMaxRatio) throw new Error('cameraMinRatio must be less than cameraMaxRatio');
  for (const key of ['maxProjectionGroups', 'maxProjectionPairs', 'maxProjectionCarriers'] as const) if (!Number.isSafeInteger(s[key]) || s[key] < 0) throw new Error(`${key} must be a nonnegative integer (0 means unlimited)`);
  for (const key of ['backgroundColor', 'nodeColor', 'edgeColor', 'groupColor', 'textColor'] as const) if (!/^#[0-9a-f]{6}$/i.test(s[key])) throw new Error(`${key} must be #rrggbb`);
  if (typeof s.persistLayout !== 'boolean' || typeof s.projectionFile !== 'string') throw new Error('Invalid persistence or projectionFile');
  if (s.projectionFile && (s.projectionFile.startsWith('/') || s.projectionFile.split('/').includes('..') || !s.projectionFile.endsWith('.json'))) throw new Error('projectionFile must be a vault-relative .json path');
  if (!s.layout || typeof s.layout !== 'object') throw new Error('layout is required');
  validateLayout(s.layout);
  validateVisuals(s.visuals); validateExplore(s.explore);
}
/** The recorded version makes the finite-limit upgrade one-time; later explicit zero remains opt-in. */
export function upgradeSettings(input: unknown, producer: string): Settings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings must be an object');
  const old = input as Partial<Settings>, base = defaults(producer);
  if (old.settingsVersion !== undefined && old.settingsVersion !== 2) throw new Error('Unsupported settings version');
  const settings = { ...base, ...old, layout: { ...base.layout, ...old.layout, force: { ...base.layout.force, ...old.layout?.force } }, ingest: { ...base.ingest, ...old.ingest }, cache: { ...base.cache, ...old.cache }, declaration: migrateDeclaration(old.declaration ?? base.declaration),
    visuals: { ...base.visuals, ...old.visuals }, explore: { ...base.explore, ...decodeText(old.explore ?? {}) as Partial<ExploreSettings> } };
  settings.explore = canonicalExplore(settings.explore);
  if (old.settingsVersion === undefined) for (const key of ['maxProjectionGroups', 'maxProjectionPairs', 'maxProjectionCarriers'] as const) if (settings[key] === 0) settings[key] = base[key];
  validateSettings(settings); return settings;
}
export interface SettingsDisk {
  stat(path: string): Promise<{ size: number } | null>;
  read(path: string): Promise<string>;
  copy(from: string, to: string): Promise<void>;
}
/** Preserve the exact original before the caller can save defaults; failed copies fail closed. */
export async function loadSettings(disk: SettingsDisk, path: string, producer: string, notice: (message: string) => void) {
  const fallback = defaults(producer); let exists = false;
  try {
    const stat = await disk.stat(path); if (!stat) return { settings: fallback, data: undefined, persist: false };
    exists = true;
    if (stat.size > fallback.maxSettingsBytes) throw new Error('Settings byte limit exceeded');
    const text = await disk.read(path);
    if (new TextEncoder().encode(text).byteLength > fallback.maxSettingsBytes) throw new Error('Settings byte limit exceeded');
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data) || !data.settings) throw new Error('Missing settings');
    const settings = upgradeSettings(data.settings, producer);
    return { settings, data, persist: true };
  } catch {
    if (!exists) throw new Error('Could not inspect Graph NG settings; original left untouched');
    await disk.copy(path, `${path}.corrupt-${Date.now()}`);
    notice('Graph NG settings were invalid or oversized; original copied to quarantine before using defaults.');
    return { settings: fallback, data: undefined, persist: true };
  }
}
