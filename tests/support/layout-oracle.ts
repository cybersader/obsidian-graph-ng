/** Development-only differential oracle. Never imported by src or the bundle. */
import { MultiDirectedGraph } from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { initialPositions, type LayoutInput, type LayoutOptions } from '../../src/core/layout';
export function oracleLayout(input: LayoutInput, options: LayoutOptions): Float32Array {
  const initial = input.initial ?? initialPositions(input.count, input.seed ^ options.seed, options.initialRadius);
  const graph = new MultiDirectedGraph();
  for (let i = 0; i < input.count; i++) graph.addNode(String(i), { x: initial[2 * i], y: initial[2 * i + 1], size: options.nodeRadius, fixed: input.movable ? !input.movable[i] : false });
  for (let e = 0; e < input.source.length; e++) graph.addDirectedEdge(String(input.source[e]), String(input.target[e]), { weight: 1 });
  forceAtlas2.assign(graph, { iterations: input.movable ? options.relaxIterations : options.iterations, settings: options.force });
  const p = new Float32Array(input.count * 2);
  for (let i = 0; i < input.count; i++) { p[2 * i] = graph.getNodeAttribute(String(i), 'x'); p[2 * i + 1] = graph.getNodeAttribute(String(i), 'y'); }
  return p;
}
/** Unit-edge stress after optimal uniform rescaling, plus RMS-normalized edge
 * quantiles. Translation/rotation/scale invariant; does not require matching
 * visually interchangeable node coordinates in a chaotic iterative solver.
 */
export function layoutQuality(input: LayoutInput, positions: Float32Array) {
  const lengths: number[] = [];
  let sum = 0, squares = 0;
  for (let e = 0; e < input.source.length; e++) {
    const a = input.source[e]!, b = input.target[e]!;
    if (a === b) continue;
    const l = Math.hypot(positions[2 * a]! - positions[2 * b]!, positions[2 * a + 1]! - positions[2 * b + 1]!);
    lengths.push(l); sum += l; squares += l * l;
  }
  lengths.sort((a, b) => a - b);
  const rms = Math.sqrt(squares / Math.max(1, lengths.length));
  const quantiles = [.1, .5, .9].map(q => lengths[Math.min(lengths.length - 1, Math.floor(q * lengths.length))] ?? 0);
  return { stress: squares ? 1 - sum * sum / (lengths.length * squares) : 0, rms, quantiles, normalizedQuantiles: quantiles.map(l => rms ? l / rms : 0) };
}
export function qualityDifference(actual: ReturnType<typeof layoutQuality>, oracle: ReturnType<typeof layoutQuality>) {
  return { stressAbsolute: Math.abs(actual.stress - oracle.stress), maxQuantileRelative: Math.max(...actual.normalizedQuantiles.map((q, i) => Math.abs(q / oracle.normalizedQuantiles[i]! - 1))), medianScaleRatio: actual.quantiles[1]! / oracle.quantiles[1]! };
}
