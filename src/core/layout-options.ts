/** Engine-owned knobs; no runtime or type dependency on the differential oracle. */
export interface ForceSettings {
  linLogMode: boolean;
  outboundAttractionDistribution: boolean;
  adjustSizes: boolean;
  /** All projection edges have unit weight, so this is reserved for weighted input. */
  edgeWeightInfluence: number;
  scalingRatio: number;
  strongGravityMode: boolean;
  gravity: number;
  slowDown: number;
  barnesHutOptimize: boolean;
  barnesHutTheta: number;
}
export interface LayoutOptions {
  iterations: number;
  relaxIterations: number;
  initialRadius: number;
  seed: number;
  /** Maximum iterations in a worker task; does not affect the numerical result. */
  batchIterations: number;
  /** RMS movement in layout units; zero disables early convergence. */
  convergenceThreshold: number;
  convergenceIterations: number;
  /** Bound subdivision for coincident or nearly coincident coordinates. */
  maxTreeDepth: number;
  nodeRadius: number;
  maxForce: number;
  force: ForceSettings;
}
export const DEFAULT_LAYOUT: LayoutOptions = {
  iterations: 100, relaxIterations: 30, initialRadius: 100, seed: 1,
  batchIterations: 5, convergenceThreshold: 0, convergenceIterations: 3,
  maxTreeDepth: 32, nodeRadius: 1, maxForce: 10,
  force: { linLogMode: false, outboundAttractionDistribution: false, adjustSizes: false,
    edgeWeightInfluence: 1, scalingRatio: 2, strongGravityMode: false, gravity: 1,
    slowDown: 1, barnesHutOptimize: true, barnesHutTheta: 1.2 },
};
export function validateLayout(options: LayoutOptions): void {
  for (const key of Object.keys(options)) if (!Object.hasOwn(DEFAULT_LAYOUT, key)) throw new Error(`Unknown layout setting: ${key}`);
  for (const key of ['iterations', 'relaxIterations', 'batchIterations', 'convergenceIterations', 'maxTreeDepth'] as const)
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new Error(`Invalid layout.${key}`);
  if (options.maxTreeDepth > 52) throw new Error('layout.maxTreeDepth exceeds floating point precision');
  for (const key of ['initialRadius', 'maxForce'] as const) if (!Number.isFinite(options[key]) || options[key] <= 0) throw new Error(`Invalid layout.${key}`);
  for (const key of ['convergenceThreshold', 'nodeRadius'] as const) if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`Invalid layout.${key}`);
  if (!Number.isSafeInteger(options.seed)) throw new Error('Invalid layout.seed');
  if (!options.force || typeof options.force !== 'object') throw new Error('force is required');
  for (const key of Object.keys(options.force)) if (!Object.hasOwn(DEFAULT_LAYOUT.force, key)) throw new Error(`Unknown force setting: ${key}`);
  for (const [key, value] of Object.entries(DEFAULT_LAYOUT.force)) {
    const actual = options.force[key as keyof ForceSettings];
    if (typeof value === 'boolean' ? typeof actual !== 'boolean' : typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0 || (['scalingRatio', 'slowDown', 'barnesHutTheta'].includes(key) && actual === 0)) throw new Error(`Invalid force.${key}`);
  }
}
