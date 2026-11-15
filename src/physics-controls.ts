import { validateSettings, type Settings } from './settings';
import { DEFAULT_LAYOUT, type ForceSettings } from './core/layout-options';
type Force = Settings['layout']['force'];
/** Basic numbers are required; advanced engine knobs are optional so older callers keep untouched values. */
export type PhysicsValues = Pick<Force, 'scalingRatio' | 'gravity' | 'slowDown'>
  & Partial<Pick<Force, 'linLogMode' | 'outboundAttractionDistribution' | 'adjustSizes' | 'strongGravityMode' | 'barnesHutTheta'>> & { iterations?: number };
export type PhysicsKey = keyof Required<PhysicsValues>;
/** [key, label, visible effect, advanced]. Every key is an existing engine setting; no new layout behavior. */
export const PHYSICS_FIELDS: readonly [PhysicsKey, string, string, boolean][] = [
  ['scalingRatio', 'Spread nodes', 'Pushes every node away from the others. Higher = more space between nodes and clusters; lower = a denser picture.', false],
  ['gravity', 'Pull to center', 'Draws everything toward the middle. Higher = rounder, tighter graph with stray islands pulled in; 0 = no pull, so unlinked parts can drift far away.', false],
  ['linLogMode', 'Tighter clusters (LinLog)', 'Weakens long-distance link pull so well-linked groups separate into distinct clumps. Often pairs well with more Spread.', true],
  ['outboundAttractionDistribution', 'Dissuade hubs', 'Heavily linked notes pull less, so hubs drift to the edge of their cluster and their neighbors spread out.', true],
  ['adjustSizes', 'Prevent overlap', 'Treats nodes as having size so they stop stacking on top of each other. Settles more slowly.', true],
  ['strongGravityMode', 'Strong gravity', 'Pull to center no longer weakens with distance, so far-off islands are pulled in hard. Use with a small Pull to center.', true],
  ['iterations', 'Quality (iterations)', 'How many layout steps run. More = more settled shapes but a slower apply. Whole number, 1 or more.', true],
  ['slowDown', 'Step slowdown', 'Higher = smaller, steadier moves each step (less jitter, may stop before fully settled). Not animation speed. Above 0.', true],
  ['barnesHutTheta', 'Approximation', 'Lower = more accurate repulsion but slower on large graphs; higher = faster and rougher. Above 0.', true],
];
const FORCE_KEYS = PHYSICS_FIELDS.map(([key]) => key).filter(key => key !== 'iterations') as (keyof ForceSettings)[];
/** Defaults for every exposed control; unexposed layout settings are never part of a preset. */
export function physicsDefaults(): Required<PhysicsValues> {
  return { ...Object.fromEntries(FORCE_KEYS.map(key => [key, DEFAULT_LAYOUT.force[key]])), iterations: DEFAULT_LAYOUT.iterations } as Required<PhysicsValues>;
}
/** One-click starting points; they only fill drafts. Apply and recompute remains the single commit. */
export const PHYSICS_PRESETS: readonly [string, string, Partial<PhysicsValues>][] = [
  ['Clustered', 'Separates linked groups into distinct clumps.', { linLogMode: true, outboundAttractionDistribution: true, scalingRatio: 4, iterations: 200 }],
  ['Spacious', 'More room between everything; easier to read labels.', { scalingRatio: 10, gravity: .5 }],
  ['Compact', 'Pulls the graph into a tight ball that fits the screen.', { scalingRatio: 1, gravity: 3 }],
];
export function presetValues(name: string): Required<PhysicsValues> {
  const preset = PHYSICS_PRESETS.find(([label]) => label === name);
  if (!preset) throw new Error(`Unknown layout preset: ${name}`);
  return { ...physicsDefaults(), ...preset[2] } as Required<PhysicsValues>;
}
/** Validate the full merge, never mutate the last good settings. Absent optional keys keep current values. */
export function physicsSettings(settings: Settings, values: PhysicsValues): Settings {
  const force: Force = { ...settings.layout.force };
  for (const key of FORCE_KEYS) if (values[key as PhysicsKey] !== undefined) (force as unknown as Record<string, unknown>)[key] = values[key as PhysicsKey];
  for (const key of Object.keys(values)) if (!FORCE_KEYS.includes(key as keyof ForceSettings) && key !== 'iterations') throw new Error(`Unknown layout control: ${key}`);
  const next = { ...settings, layout: { ...settings.layout, ...(values.iterations === undefined ? {} : { iterations: values.iterations }), force } };
  validateSettings(next); return next;
}

/** Capture a generation's references/scalars; compare a fresh snapshot at each boundary. */
export function generationCurrent(read: () => readonly unknown[]) {
  const saved = read();
  return () => { const now = read(); return saved.every((value, i) => value === now[i]); };
}
