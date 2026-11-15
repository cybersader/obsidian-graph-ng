import { validateSettings, type Settings } from './settings';
export type PhysicsValues = Pick<Settings['layout']['force'], 'scalingRatio' | 'gravity' | 'slowDown'>;
/** Validate the full merge, never mutate the last good settings. */
export function physicsSettings(settings: Settings, values: PhysicsValues): Settings {
  const next = { ...settings, layout: { ...settings.layout, force: { ...settings.layout.force, scalingRatio: values.scalingRatio, gravity: values.gravity, slowDown: values.slowDown } } };
  validateSettings(next); return next;
}

/** Capture a generation's references/scalars; compare a fresh snapshot at each boundary. */
export function generationCurrent(read: () => readonly unknown[]) {
  const saved = read();
  return () => { const now = read(); return saved.every((value, i) => value === now[i]); };
}
