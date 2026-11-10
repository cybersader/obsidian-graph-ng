import { MultiDirectedGraph } from 'graphology';
import forceAtlas2, { type ForceAtlas2Settings } from 'graphology-layout-forceatlas2';
export interface LayoutOptions {
  iterations: number;
  relaxIterations: number;
  initialRadius: number;
  seed: number;
  force: Required<ForceAtlas2Settings>;
}
export const DEFAULT_LAYOUT: LayoutOptions = {
  iterations: 100, relaxIterations: 30, initialRadius: 100, seed: 1,
  force: { linLogMode: false, outboundAttractionDistribution: false, adjustSizes: false,
    edgeWeightInfluence: 1, scalingRatio: 2, strongGravityMode: false, gravity: 1,
    slowDown: 1, barnesHutOptimize: true, barnesHutTheta: 1.2 },
};
export interface LayoutInput {
  count: number;
  source: Uint32Array;
  target: Uint32Array;
  seed: number;
  initial?: Float32Array;
  movable?: Uint8Array;
}
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
export function initialPositions(count: number, seed: number, radius: number): Float32Array {
  const rng = random(seed), p = new Float32Array(count * 2);
  for (let i = 0; i < p.length; i++) p[i] = (rng() - 0.5) * radius;
  return p;
}
export function runLayout(input: LayoutInput, options: LayoutOptions): Float32Array {
  if (!Number.isSafeInteger(input.count) || input.count < 0 || input.source.length !== input.target.length) throw new Error('Invalid layout input');
  const p = input.initial ?? initialPositions(input.count, input.seed ^ options.seed, options.initialRadius);
  if (p.length !== input.count * 2) throw new Error('Invalid initial position count');
  if (!input.count) return p;
  const graph = new MultiDirectedGraph();
  for (let i = 0; i < input.count; i++) graph.addNode(String(i), { x: p[i * 2], y: p[i * 2 + 1], size: 1, fixed: input.movable ? !input.movable[i] : false });
  for (let i = 0; i < input.source.length; i++) graph.addDirectedEdge(String(input.source[i]), String(input.target[i]), { weight: 1 });
  forceAtlas2.assign(graph, { iterations: input.movable ? options.relaxIterations : options.iterations, settings: options.force });
  const out = new Float32Array(input.count * 2);
  for (let i = 0; i < input.count; i++) { out[i * 2] = graph.getNodeAttribute(String(i), 'x'); out[i * 2 + 1] = graph.getNodeAttribute(String(i), 'y'); }
  if (!out.every(Number.isFinite)) throw new Error('Layout produced nonfinite positions; change force settings');
  return out;
}
