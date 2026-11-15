import { validateSettings, type Settings } from './settings';
import type { PhysicsValues } from './physics-controls';
/** Shape statistics of the loaded projection. Ontology-neutral: counts only. */
export interface GraphStats { nodes: number; edges: number; carriers: number; groups: number; averageDegree: number; maxDegree: number; hubRatio: number }
export function graphStats(offsets: ArrayLike<number>, edges: number, carriers = 0, groups = 0): GraphStats {
  const nodes = Math.max(0, offsets.length - 1); let max = 0;
  for (let i = 0; i < nodes; i++) max = Math.max(max, offsets[i + 1]! - offsets[i]!);
  const total = nodes ? offsets[nodes]! - offsets[0]! : 0, averageDegree = nodes ? total / nodes : 0;
  return { nodes, edges, carriers, groups, averageDegree, maxDegree: max, hubRatio: averageDegree ? max / averageDegree : 0 };
}
/** Only presentation keys the renderer reads live; layout keys need a recompute and stay manual. */
/** Presentation keys the renderer reads live (labels shown in the card). Layout keys need a
 * recompute and stay manual. */
const LABELS = { edgeOpacity: 'Edge opacity', degreeSizing: 'Degree sizing', labelDensity: 'Label density', glow: 'Glow', curvedEdges: 'Curved edges', groupHalos: 'Group halos', carrierOpacity: 'Edge-note opacity' };
export type SuggestionKey = keyof typeof LABELS;
export interface Suggestion { key: SuggestionKey; label: string; current: number | boolean; value: number | boolean; reason: string }
/** "Probably the settings you want for data shaped like this." Deterministic, never applied
 * automatically. Thresholds are deliberate rules of thumb, not measurements of a vault. */
export function recommend(t: GraphStats, s: Settings): Suggestion[] {
  const out: Suggestion[] = [], { nodes: n, edges: e, averageDegree: d, hubRatio: h } = t;
  const add = (key: SuggestionKey, value: number | boolean, reason: string) => {
    const current = key === 'labelDensity' ? s.labelDensity : s.visuals[key];
    // Ignore near-equal numbers so a hand-tuned value is not nagged about.
    if (typeof value === 'number' ? Math.abs(+current - value) >= .02 : current !== value) out.push({ key, label: LABELS[key], current, value, reason });
  };
  if (!n) return out;
  // Edge opacity: overlapping translucent edges add up. Past ~5k edges or ~6 links per note the
  // default 0.4 turns into a solid haze; past ~20k or ~12 it hides nodes. Tiny sparse graphs can
  // afford stronger edges because nothing overlaps.
  const heavy = e >= 20000 || d >= 12;
  if (heavy || e >= 5000 || d >= 6) add('edgeOpacity', heavy ? .15 : .25, `${e} edges ${heavy ? 'overlap heavily' : 'start to haze'}`);
  else if (e < 500 && d < 3) add('edgeOpacity', .6, 'sparse; easy to follow');
  // Degree prominence (log curve normalized to the biggest hub). Hub ratio = max degree / mean.
  // ≥ 25: a few hubs would dwarf everything, so soften. 4–25: a real but readable skew, so make
  // the connected notes stand out. < 4: degrees are nearly equal and size carries little meaning.
  if (n >= 20) add('degreeSizing', h >= 25 ? 1 : h >= 4 ? 2.2 : .6, h >= 25 ? `hubs of ${t.maxDegree} links dwarf the rest` : h >= 4 ? 'skewed; let hubs stand out' : 'even degrees; size says little');
  // Labels: candidates scale with notes; thin them for big graphs, allow more for small ones.
  if (n >= 5000) add('labelDensity', n >= 20000 ? .5 : .75, `${n} notes; declutter`);
  else if (n < 300) add('labelDensity', 1.5, 'few notes; room to label');
  // Glow is per-node overdraw; above ~5k notes it washes dense cores into a blob.
  if (n >= 5000) add('glow', 0, 'blurs dense cores');
  // Curved edges cost segments per edge and add little legibility past ~20k edges.
  if (e >= 20000) add('curvedEdges', false, 'faster, cleaner');
  // Halos for many groups overlap into one wash; 32 is well under the 48-halo cap.
  if (t.groups > 32) add('groupHalos', false, `${t.groups} groups overlap`);
  // Edge notes: when they are at least half of the notes, dim them so concepts stay primary.
  if (t.carriers && t.carriers >= n / 2) add('carrierOpacity', .45, 'many edge notes');
  return out;
}
/** Layout values that read well for a graph of this size; the base every preset scales.
 * Measured on synthetic framework graphs (500 to 16k notes, about 3 links per note, 5% orphans):
 * - Display fits the graph to the view, so Spread is only a zoom; it stays at 10.
 * - Normal gravity lets unlinked notes fly out in rings and squeezes the real graph into the
 *   middle. Strong gravity grows with distance and keeps them close; 0.12 to 0.22 balanced
 *   group separation against filling the view, a little less pull suiting bigger graphs.
 * - Step slowdown above 1 leaves a fresh layout unsettled in the step budget, so it stays 1.
 * - Steps follow a cost budget of about 10M node-or-link steps: 300 for small graphs, 150 at 16k
 *   notes and 50k links; more steps did not change the measured picture. */
export function recommendedPhysics(nodes: number, edges: number): Required<PhysicsValues> {
  const n = Math.max(1, nodes), size = n + Math.max(0, edges);
  return {
    scalingRatio: 10, slowDown: 1, strongGravityMode: true, linLogMode: false, outboundAttractionDistribution: false, adjustSizes: false,
    gravity: +Math.min(.25, Math.max(.1, .2 * (1000 / n) ** .17)).toFixed(3),
    iterations: Math.min(300, Math.max(100, Math.round(1e7 / size / 10) * 10)),
    barnesHutTheta: n < 2000 ? .8 : 1.2,
  };
}
/** Validated candidate with the suggestions applied; never mutates `s`. */
export function suggestionSettings(s: Settings, list: readonly Suggestion[]): Settings {
  const next = { ...s, visuals: { ...s.visuals } } as Settings & Record<string, unknown>;
  for (const { key, value } of list) {
    if (key === 'labelDensity') next.labelDensity = value as number;
    else (next.visuals as unknown as Record<string, unknown>)[key] = value;
  }
  validateSettings(next); return next;
}
