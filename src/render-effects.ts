import type { Visuals } from './settings';
/** Pure presentation math: no DOM, GL or graph authority. */
export type RGB = [number, number, number];
export const parseHex = (hex: string): RGB => { const v = Number.parseInt(hex.slice(1, 7), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
const channel = (c: number) => { const s = c / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; };
export const luminance = (c: RGB) => .2126 * channel(c[0]) + .7152 * channel(c[1]) + .0722 * channel(c[2]);
export const contrast = (a: RGB, b: RGB) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
export const isDark = (background: RGB) => luminance(background) < .3;
/** Move toward black/white only as far as needed for the requested contrast. */
export function ensureContrast(color: RGB, background: RGB, ratio: number): RGB {
  if (contrast(color, background) >= ratio) return color;
  const target = isDark(background) ? 255 : 0;
  for (let t = .05; t <= 1.0001; t += .05) {
    const c = color.map(v => Math.round(v + (target - v) * t)) as RGB;
    if (contrast(c, background) >= ratio) return c;
  }
  return [target, target, target];
}
/** Calm, distinguishable categorical hues (ontology-neutral: assigned by group order). */
const CATEGORICAL = ['#6ea8fe', '#f2b46d', '#7fd1a8', '#c9a0f5', '#f08f8f', '#5cc8d6', '#d8c66b', '#f5a3cf', '#9fb8d8', '#a4d65e', '#e5a07a', '#8e9cf8'];
export function categorical(count: number, background: RGB): Uint8Array {
  const dark = isDark(background), out = new Uint8Array(Math.max(1, count) * 4);
  for (let i = 0; i < count; i++) {
    let c = parseHex(CATEGORICAL[i % CATEGORICAL.length]!);
    // Later cycles shift lightness so repeated hues stay separable.
    const cycle = Math.floor(i / CATEGORICAL.length) % 3, shift = cycle === 1 ? -.22 : cycle === 2 ? .18 : 0;
    if (shift) c = c.map(v => Math.round(shift < 0 ? v * (1 + shift) : v + (255 - v) * shift)) as RGB;
    if (!dark) c = c.map(v => Math.round(v * .78)) as RGB;
    out.set([...ensureContrast(c, background, 3), 255], i * 4);
  }
  return out;
}
/** Explicit placeholder groups (no value / no match / outside a prefix) are not a
 * category: they take the muted base node color so real groups keep the hues. */
export const NEUTRAL_GROUPS: ReadonlySet<string> = new Set(['(missing)', '(no match)', '(outside prefix)']);
export function neutralizeGroups(groups: Uint8Array, labels: readonly string[] | undefined, base: ArrayLike<number>): Uint8Array {
  if (!labels) return groups;
  for (let i = 0; i < Math.min(labels.length, groups.length / 4); i++) if (NEUTRAL_GROUPS.has(labels[i]!)) { groups[i * 4] = base[0]!; groups[i * 4 + 1] = base[1]!; groups[i * 4 + 2] = base[2]!; groups[i * 4 + 3] = 255; }
  return groups;
}
/** Screen-density node scale: shrink discs when the visible web would otherwise
 * tile the viewport solid, regrow toward full size as the camera zooms in.
 * `zoom` is camera ratio / home ratio; the web fills roughly a third of the view at home. */
export function densityScale(width: number, height: number, visibleNodes: number, zoom: number, nodeSize: number, min = .3): number {
  const spacing = Math.sqrt(width * height * .35 / Math.max(1, visibleNodes)) / Math.max(zoom, 1e-6);
  return Math.min(1, Math.max(min, spacing / (Math.max(.5, nodeSize) * 2.2)));
}
/** Per-node RGBA: first matching declared rule, else group palette, else base node color. */
export function nodeColors(colors: Uint32Array, ruleCount: number, palette: Uint8Array, groupCodes: Uint32Array | undefined, groups: Uint8Array | undefined, out = new Uint8Array(colors.length * 4)): Uint8Array {
  const groupCount = groups ? groups.length / 4 : 0;
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i]!, o = i * 4;
    if (c < ruleCount) { const k = (c + 5) * 4; out[o] = palette[k]!; out[o + 1] = palette[k + 1]!; out[o + 2] = palette[k + 2]!; out[o + 3] = palette[k + 3]!; }
    else if (groups && groupCodes && groupCount) { const k = (groupCodes[i]! % groupCount) * 4; out[o] = groups[k]!; out[o + 1] = groups[k + 1]!; out[o + 2] = groups[k + 2]!; out[o + 3] = 255; }
    else { out[o] = palette[0]!; out[o + 1] = palette[1]!; out[o + 2] = palette[2]!; out[o + 3] = palette[3]!; }
  }
  return out;
}
/** Log-degree radius multiplier in [1, 1 + scale]; CSR offsets count both directions. */
export function degreeSizes(offsets: Uint32Array, scale: number, out: Float32Array<ArrayBuffer> = new Float32Array(Math.max(0, offsets.length - 1))): Float32Array<ArrayBuffer> {
  let max = 0; for (let i = 0; i < out.length; i++) max = Math.max(max, offsets[i + 1]! - offsets[i]!);
  const norm = Math.log2(1 + max) || 1;
  for (let i = 0; i < out.length; i++) out[i] = 1 + scale * Math.log2(1 + offsets[i + 1]! - offsets[i]!) / norm;
  return out;
}
export interface EffectPolicy { glow: number; curves: boolean; segments: number; halos: boolean; additive: boolean; reasons: string[] }
/** Cost-aware fallback: every effect has a configurable ceiling and a software rule. */
export function effectPolicy(v: Visuals, nodes: number, edges: number, groups: number, software: boolean, dark: boolean): EffectPolicy {
  const reasons: string[] = [], soft = software && !v.softwareEffects;
  if (soft) reasons.push('software renderer: glow, curves and halos off');
  let glow = soft ? 0 : v.glow, curves = !soft && v.curvedEdges && v.curvature > 0, halos = !soft && v.groupHalos;
  if (glow > 0 && nodes > v.glowMaxNodes) { glow = 0; reasons.push(`glow off above ${v.glowMaxNodes.toLocaleString()} nodes`); }
  if (curves && edges > v.curvesMaxEdges) { curves = false; reasons.push(`curves off above ${v.curvesMaxEdges.toLocaleString()} edges`); }
  if (halos && groups > v.halosMaxGroups) reasons.push(`halos limited to the ${v.halosMaxGroups.toLocaleString()} largest groups`);
  return { glow, curves, segments: curves ? v.curveSegments : 1, halos: halos && v.halosMaxGroups > 0, additive: dark, reasons };
}
/** Edge alpha falls with visible density and rises when zoomed in past the home
 * (fit) framing; additive blending gets a lower per-edge ceiling so dense cores
 * glow without saturating to white. `zoom` is camera ratio / home ratio. */
export function edgeAlpha(v: Visuals, visibleEdges: number, zoom: number, additive: boolean): number {
  const density = Math.min(1, Math.sqrt(v.edgeDensityReference / Math.max(1, visibleEdges))), boost = Math.min(3, Math.max(1, 1 / Math.sqrt(Math.max(zoom, 1e-6))));
  return additive ? Math.min(.5, Math.max(.02, v.edgeOpacity * .45 * density * boost)) : Math.min(1, Math.max(.05, v.edgeOpacity * 1.25 * density * boost));
}
/** Zoom-dependent label opacity and importance cut within the current label LOD band. */
export function labelFade(nodeSize: number, threshold: number, ratio: number, ratios: readonly number[], fade: boolean): { alpha: number; cut: number } {
  const visibleAt = nodeSize / (threshold * Math.sqrt(ratio));
  if (!fade) return { alpha: visibleAt >= 1 ? 1 : 0, cut: 0 };
  const alpha = Math.min(1, Math.max(0, (visibleAt - .8) / .35));
  const i = ratios.findIndex(r => r >= ratio), hi = ratios[Math.max(0, i < 0 ? ratios.length - 1 : i)]!, lo = i > 0 ? ratios[i - 1]! : hi / 2;
  const progress = Math.min(1, Math.max(0, Math.log2(ratio / lo) / Math.log2(hi / lo || 2)));
  return { alpha, cut: progress * .55 };
}
export const easeInOut = (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export interface Halo { group: number; x: number; y: number; radius: number; count: number }
/** Centroid and RMS spread for the largest visible groups, one O(n) pass. */
export function groupHalos(positions: Float32Array, visible: Uint8Array, codes: Uint32Array, groups: number, limit: number): Halo[] {
  const n = new Float64Array(groups), x = new Float64Array(groups), y = new Float64Array(groups), xx = new Float64Array(groups);
  for (let i = 0; i < visible.length; i++) if (visible[i]) { const g = codes[i]!, a = positions[i * 2]!, b = positions[i * 2 + 1]!; n[g]!++; x[g]! += a; y[g]! += b; xx[g]! += a * a + b * b; }
  const out: Halo[] = [];
  for (let g = 0; g < groups; g++) if (n[g]! > 1) { const cx = x[g]! / n[g]!, cy = y[g]! / n[g]!; out.push({ group: g, x: cx, y: cy, radius: Math.sqrt(Math.max(0, xx[g]! / n[g]! - cx * cx - cy * cy)), count: n[g]! }); }
  return out.sort((a, b) => b.count - a.count || a.group - b.group).slice(0, limit);
}
