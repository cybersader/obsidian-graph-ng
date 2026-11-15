import type { DegreeCurve, Settings } from './settings';
import { validateSettings } from './settings';
import { densityScale } from './render-effects';
export interface NodeSizingPolicy { policy: 'legacy' | 'predictable'; compensation: number; floor: number }
export interface NodeSizingValues { radius: number; prominence: number; compensation: number; floor: number; curve: DegreeCurve }
/** Binary32 preserves integer CSS-pixel increments only through 2^24 - 1.
 * Reserve the maximum validated 9x prominence, 4x carrier size, +2px highlight
 * and 2.3x glow extent. This arithmetic limit is not a slider convenience cap. */
export const MAX_NODE_RADIUS = Math.floor(((2 ** 24 - 1) / 2.3 - 2) / (9 * 4));
export function validateNodeRadius(radius: number) {
  if (!Number.isFinite(radius) || radius <= 0 || radius > MAX_NODE_RADIUS) throw new Error(`Node radius must be greater than 0 and at most ${MAX_NODE_RADIUS} CSS px (binary32 geometry precision limit)`);
}
export const legacySizing = (): NodeSizingPolicy => ({ policy: 'legacy', compensation: 1, floor: .3 });
export function validateNodeSizing(s: NodeSizingPolicy) {
  if (!s || Object.keys(s).some(k => !['policy', 'compensation', 'floor'].includes(k)) || !['legacy', 'predictable'].includes(s.policy) || !Number.isFinite(s.compensation) || s.compensation < 0 || s.compensation > 1 || !Number.isFinite(s.floor) || s.floor <= 0 || s.floor > 1) throw new Error('Sizing: compensation 0–100%; retained size greater than 0 and at most 100%');
}
export const sizingValues = (s: Settings): NodeSizingValues => ({ radius: s.nodeSize, prominence: 1 + s.visuals.degreeSizing, compensation: (s.nodeSizing ?? legacySizing()).compensation, floor: (s.nodeSizing ?? legacySizing()).floor, curve: s.visuals.degreeCurve });
export function sizingSettings(s: Settings, v: NodeSizingValues): Settings {
  const next = { ...s, nodeSize: v.radius, visuals: { ...s.visuals, degreeSizing: v.prominence - 1, degreeCurve: v.curve }, nodeSizing: { policy: 'predictable' as const, compensation: v.compensation, floor: v.floor } };
  validateSettings(next); return next;
}
/** CSS-pixel base radius. Legacy Canvas intentionally retains its old unscaled appearance. */
export function baseRadius(s: Pick<Settings, 'nodeSize' | 'nodeSizing'>, width: number, height: number, count: number, zoom: number, canvas = false): number {
  if (s.nodeSizing?.policy !== 'predictable') return s.nodeSize * (canvas ? 1 : densityScale(width, height, count, zoom, s.nodeSize));
  const reference = Math.min(1, Math.max(0, Math.sqrt(width * height * .35 / Math.max(1, count)) / (Math.max(zoom, 1e-6) * 2.2 * 3)));
  return s.nodeSize * Math.max(s.nodeSizing.floor, 1 - s.nodeSizing.compensation * (1 - reference));
}
export const sizedRadius = (base: number, multiplier: number, carrier = 1, hot = false) => base * multiplier * carrier + (hot ? 2 : 0);
