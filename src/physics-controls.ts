import { validateSettings, type Settings } from './settings';
import { DEFAULT_LAYOUT, type ForceSettings } from './core/layout-options';
type Force = Settings['layout']['force'];
/** Basic numbers are required; advanced engine knobs are optional so older callers keep untouched values. */
export type PhysicsValues = Pick<Force, 'scalingRatio' | 'gravity' | 'slowDown'>
  & Partial<Pick<Force, 'linLogMode' | 'outboundAttractionDistribution' | 'adjustSizes' | 'strongGravityMode' | 'barnesHutTheta'>> & { iterations?: number };
export type PhysicsKey = keyof Required<PhysicsValues>;
/** [key, label, visible effect, advanced]. Every key is an existing engine setting; no new layout behavior. */
export const PHYSICS_FIELDS: readonly [PhysicsKey, string, string, boolean][] = [
  ['scalingRatio', 'Spread notes', 'Pushes every note away from the others. Higher = more space between notes and clusters; lower = a denser picture.', false],
  ['gravity', 'Pull to center', 'Draws everything toward the middle. Higher = rounder, tighter graph with disconnected parts pulled in; 0 = no pull, so disconnected parts can drift far away.', false],
  ['linLogMode', 'Tighter clusters (LinLog)', 'Weakens long-distance edge pull so densely connected regions separate into distinct clusters. Often pairs well with more Spread.', true],
  ['outboundAttractionDistribution', 'Dissuade hubs', 'High-degree notes pull less, so hubs drift to the outside of their cluster and their neighbours spread out.', true],
  ['adjustSizes', 'Prevent overlap', 'Treats each dot as having size so dots stop stacking on top of each other. Settles more slowly.', true],
  ['strongGravityMode', 'Strong gravity', 'Pull to center no longer weakens with distance, so far-off disconnected parts are pulled in hard. Use with a small Pull to center.', true],
  ['iterations', 'Quality (iterations)', 'How many layout steps run. More = more settled shapes but a slower apply. Whole number, 1 or more.', true],
  ['slowDown', 'Step slowdown', 'Higher = smaller, steadier moves each step (less jitter, may stop before fully settled). Not animation speed. Above 0.', true],
  ['barnesHutTheta', 'Approximation', 'Lower = more accurate repulsion but slower on large graphs; higher = faster and rougher. Above 0.', true],
];
const FORCE_KEYS = PHYSICS_FIELDS.map(([key]) => key).filter(key => key !== 'iterations') as (keyof ForceSettings)[];
/** Defaults for every exposed control; unexposed layout settings are never part of a preset. */
export function physicsDefaults(): Required<PhysicsValues> {
  return { ...Object.fromEntries(FORCE_KEYS.map(key => [key, DEFAULT_LAYOUT.force[key]])), iterations: DEFAULT_LAYOUT.iterations } as Required<PhysicsValues>;
}
type Scaled = 'scalingRatio' | 'gravity' | 'slowDown' | 'iterations' | 'barnesHutTheta';
/** Every preset result stays inside the slider ranges, so no preset can produce an extreme value. */
export const PRESET_BOUNDS: Record<Scaled, [number, number]> = { scalingRatio: [.1, 100], gravity: [.001, 20], slowDown: [.1, 100], iterations: [20, 1000], barnesHutTheta: [.1, 3] };
/** One-click starting points as multipliers of a base (the recommended values for this graph's
 * size), so the same click reads the same on 500 or 16k notes and never compounds. They only
 * fill drafts; Apply and recompute remains the single commit. Measured on synthetic graphs:
 * see README "Layout presets". LinLog and hub dissuasion stay manual: in 100 to 500 steps they
 * left the groups mixed on every tested size. */
export const PHYSICS_PRESETS: readonly [string, string, Partial<Record<Scaled, number>>][] = [
  ['Groups apart', 'Weaker pull to the middle, so groups sit further apart and unconnected notes ring the outside.', { gravity: .5 }],
  ['Fill the screen', 'Stronger pull, so the graph fills the view as one round shape with groups touching.', { gravity: 3 }],
  ['Faster', 'Half the steps and a rougher approximation, for very large vaults.', { iterations: .5, barnesHutTheta: 1.3 }],
];
export function presetValues(name: string, base: Required<PhysicsValues> = physicsDefaults()): Required<PhysicsValues> {
  const preset = PHYSICS_PRESETS.find(([label]) => label === name);
  if (!preset) throw new Error(`Unknown layout preset: ${name}`);
  const out = { ...base };
  for (const [key, factor] of Object.entries(preset[2]) as [Scaled, number][]) {
    const [min, max] = PRESET_BOUNDS[key], value = Math.min(max, Math.max(min, base[key] * factor));
    out[key] = key === 'iterations' ? Math.round(value) : +value.toPrecision(3);
  }
  return out;
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
