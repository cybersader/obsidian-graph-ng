import { DEFAULT_LAYOUT, type LayoutOptions } from './core/layout';
import { defaultDeclaration, validateDeclaration, type GraphDeclaration } from './core/declaration';
export interface Settings {
  declaration: GraphDeclaration;
  layout: LayoutOptions;
  debounceMs: number;
  workerTimeoutMs: number;
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
  backgroundColor: string;
  nodeColor: string;
  edgeColor: string;
  groupColor: string;
  textColor: string;
  persistLayout: boolean;
  cachedDeclarations: number;
  projectionFile: string;
}
export function defaults(producer: string): Settings {
  return {
    declaration: defaultDeclaration(producer), layout: structuredClone(DEFAULT_LAYOUT), debounceMs: 5000,
    workerTimeoutMs: 120000, lodZoomRatio: 1.8, groupLevel: 0, nodeSize: 3, edgeSize: 0.5, labelSize: 13,
    groupRadius: 26, groupCurveDivisor: 5, groupEdgeHitRadius: 6, groupCurveSamples: 32, groupLoopScale: 1.5, groupRingPadding: 56, labelDensity: 1, labelGridCellSize: 100, labelRenderedSizeThreshold: 6, edgeWidthScale: 0.8, listPageSize: 100,
    backgroundColor: '#141b26', nodeColor: '#7fc8e7', edgeColor: '#43566e', groupColor: '#7fc8e7', textColor: '#edf4ff',
    persistLayout: true, cachedDeclarations: 1, projectionFile: '',
  };
}
export function validateSettings(v: unknown): asserts v is Settings {
  if (!v || typeof v !== 'object') throw new Error('Settings must be an object');
  const s = v as Settings, keys = Object.keys(defaults('producer@1'));
  for (const k of Object.keys(s)) if (!keys.includes(k)) throw new Error(`Unknown setting: ${k}`);
  validateDeclaration(s.declaration);
  for (const key of ['debounceMs', 'workerTimeoutMs', 'lodZoomRatio', 'nodeSize', 'edgeSize', 'labelSize', 'groupRadius', 'groupCurveDivisor', 'groupEdgeHitRadius', 'groupCurveSamples', 'groupLoopScale', 'groupRingPadding', 'labelDensity', 'labelGridCellSize', 'labelRenderedSizeThreshold', 'edgeWidthScale'] as const) if (!Number.isFinite(s[key]) || s[key] <= 0) throw new Error(`${key} must be positive`);
  for (const key of ['groupLevel', 'groupCurveSamples', 'listPageSize', 'cachedDeclarations'] as const) if (!Number.isSafeInteger(s[key]) || s[key] < (key === 'groupLevel' ? 0 : 1)) throw new Error(`Invalid ${key}`);
  for (const key of ['backgroundColor', 'nodeColor', 'edgeColor', 'groupColor', 'textColor'] as const) if (!/^#[0-9a-f]{6}$/i.test(s[key])) throw new Error(`${key} must be #rrggbb`);
  if (typeof s.persistLayout !== 'boolean' || typeof s.projectionFile !== 'string') throw new Error('Invalid persistence or projectionFile');
  if (s.projectionFile && (s.projectionFile.startsWith('/') || s.projectionFile.split('/').includes('..') || !s.projectionFile.endsWith('.json'))) throw new Error('projectionFile must be a vault-relative .json path');
  if (!s.layout || typeof s.layout !== 'object') throw new Error('layout is required');
  for (const k of Object.keys(s.layout)) if (!['iterations', 'relaxIterations', 'initialRadius', 'seed', 'force'].includes(k)) throw new Error(`Unknown layout setting: ${k}`);
  for (const key of ['iterations', 'relaxIterations'] as const) if (!Number.isSafeInteger(s.layout[key]) || s.layout[key] <= 0) throw new Error(`${key} must be a positive integer`);
  if (!Number.isFinite(s.layout.initialRadius) || s.layout.initialRadius <= 0 || !Number.isSafeInteger(s.layout.seed)) throw new Error('Invalid layout radius/seed');
  if (!s.layout.force || typeof s.layout.force !== 'object') throw new Error('force is required');
  for (const [key, val] of Object.entries(DEFAULT_LAYOUT.force)) {
    const actual = s.layout.force[key as keyof typeof s.layout.force];
    if (typeof val === 'boolean' ? typeof actual !== 'boolean' : typeof actual !== 'number' || !Number.isFinite(actual) || actual <= 0) throw new Error(`Invalid force.${key}`);
  }
  for (const key of Object.keys(s.layout.force)) if (!Object.hasOwn(DEFAULT_LAYOUT.force, key)) throw new Error(`Unknown force setting: ${key}`);
}
