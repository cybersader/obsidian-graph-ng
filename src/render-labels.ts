import { degreeSizes } from './render-effects';
import { renderPath, type RenderProjection } from './render-projection';
import type { Settings } from './settings';
import { LABEL_RATIOS, placeLabels, type LabelBox, type PickGrid } from './render-data';
import { yieldTask } from './core/scheduler';
import { overviewScale } from './label-layout';
interface Glyph { x: number; y: number; w: number; advance: number }
/** Per level: glyph quads, placed nodes in degree-rank order and each node's degree-weighted size factor. */
export interface LabelAtlas { canvas: HTMLCanvasElement; levels: Float32Array[]; nodes: Uint32Array[]; scales: Float32Array[] }
/** Graduated labels, ranked focus (0) > direct (1) > ancestor (2) > 2-hop (3) > same group (4), then degree and id; `near` is the
 * touched list from `focusTiers`, `state` its tier bytes. Candidates are capped like the atlas and
 * placed with the same budget and collision grid. Runs once per focus or level-of-detail change. */
export function focusLabels(focus: number, near: readonly number[], state: Uint8Array, visible: ArrayLike<number>, offsets: Uint32Array, box: (node: number, rank: number) => LabelBox, cell: number, budget: number, cap: number) {
  const { list } = rankFocus(focus, near, state, visible, offsets, cap), ranks = new Map(list);
  return list.length ? placeLabels(list.map(([n, r]) => box(n, r)), cell, budget).map(b => [b.node, ranks.get(b.node)!] as const) : [];
}
/** Visible touched notes as [node, rank] in priority order (capped), plus the visible direct-connection count.
 * Within a tier, `score` (degree of interest, see interest.ts) orders when given; otherwise degree. */
export function rankFocus(focus: number, near: readonly number[], state: Uint8Array, visible: ArrayLike<number>, offsets: Uint32Array, cap: number, notes?: ArrayLike<number>, score?: (n: number) => number) {
  const rank = (n: number) => n === focus ? 0 : state[n * 4 + 1]! > 200 ? 1 : 5 - (state[n * 4 + 1]! >> 6), degree = (n: number) => offsets[n + 1]! - offsets[n]!;
  // Transparent carrier dots are not direct neighbours in the card/legend. They must not
  // consume its label slots or inflate the count offered by the card's '+N more' link.
  const list = near.filter(n => visible[n] && (n === focus || !notes?.[n])).map(n => [n, rank(n)] as const).sort((a, b) => a[1] - b[1] || (score ? score(b[0]) - score(a[0]) : degree(b[0]) - degree(a[0])) || a[0] - b[0]);
  const direct = list.reduce((c, x) => c + +(x[1] === 1), 0); list.length = Math.min(list.length, cap);
  return { list, direct };
}
/** Rasterize codepoints once, then place bounded lists at each LOD. No per-frame text work. */
export async function buildLabels(p: RenderProjection, grid: Pick<PickGrid, 'positions' | 'visible' | 'minX' | 'minY' | 'width' | 'height'>, s: Settings, width: number, height: number, font: string, current: () => boolean, visible = grid.visible): Promise<LabelAtlas> {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2048;
  const ctx = canvas.getContext('2d')!;
  // Rasterize at the largest degree-weighted size so hub labels stay crisp.
  const tier = s.visuals.labelTierScale, fontSize = Math.min(48, s.labelSize * tier * tier), line = Math.ceil(fontSize * 1.5) + 4, scale = s.labelSize / fontSize;
  ctx.font = `${fontSize}px ${font}`; ctx.textBaseline = 'top'; ctx.fillStyle = '#ffffff';
  const glyphs = new Map<string, Glyph>(); let x = 0, y = 0;
  const glyph = (c: string): Glyph => {
    const old = glyphs.get(c); if (old) return old;
    const advance = Math.max(1, ctx.measureText(c).width), w = Math.min(2048, Math.ceil(advance) + 4);
    if (x + w > 2048) { x = 0; y += line; }
    if (y + line > 2048) return glyphs.get('?')!;
    const g = { x, y, w, advance }; glyphs.set(c, g); ctx.fillText(c, x + 2, y + 2); x += w; return g;
  };
  glyph('?');
  const budget = Math.max(1, Math.min(s.labelsMaxPerViewport, Math.floor(width * height / (s.labelGridCellSize ** 2) * s.labelDensity)));
  const candidates = Array.from({ length: p.nodeCount }, (_, i) => i).filter(i => visible[i]);
  candidates.sort((a, b) => (p.offsets[b + 1]! - p.offsets[b]!) - (p.offsets[a + 1]! - p.offsets[a]!) || a - b);
  // Candidate work and atlas size are bounded independently of graph cardinality.
  candidates.length = Math.min(candidates.length, budget * s.labelCandidateMultiplier);
  const strings = new Map<number, string>(), widths = new Map<number, number>();
  for (let i = 0; i < candidates.length; i++) {
    const node = candidates[i]!, path = renderPath(p, node), text = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '').slice(0, 128);
    let w = 0; for (const c of text) w += glyph(c).advance * scale;
    strings.set(node, text); widths.set(node, w);
    if (i % 128 === 0) { await yieldTask(); if (!current()) throw new Error('Renderer superseded'); }
  }
  const predictable = s.nodeSizing.policy === 'predictable', sizes = predictable ? degreeSizes(p.offsets, s.visuals.degreeSizing, s.visuals.degreeCurve) : undefined;
  const multiplier = (node: number) => sizes ? sizes[node]! * (p.carrierNodes[node] ? s.visuals.carrierSize : 1) : 0;
  const fit = Math.min(width / (grid.width * 1.1), height / (grid.height * 1.1));
  const levels: Float32Array[] = [], nodes: Uint32Array[] = [], scales: Float32Array[] = [];
  // Degree-weighted size: hubs (first candidates) are named first and largest; collision uses the grown boxes.
  const grow = new Map(candidates.map((node, i) => [node, overviewScale(i / candidates.length, tier)]));
  for (const ratio of LABEL_RATIOS) {
    const boxes: LabelBox[] = candidates.map(node => { const z = grow.get(node)!; return { node, x: (grid.positions[node * 2]! - grid.minX) * fit / ratio + (predictable ? s.nodeSize * multiplier(node) : s.nodeSize) + 4, y: (grid.positions[node * 2 + 1]! - grid.minY) * fit / ratio - s.labelSize * z / 2, w: widths.get(node)! * z + 4, h: s.labelSize * z * 1.5 + 4 }; });
    const placed = placeLabels(boxes, s.labelGridCellSize, budget), data: number[] = [];
    // Importance is degree rank among placed labels; the shader fades the least important first.
    placed.forEach((box, rank) => {
      const z = grow.get(box.node)!, k = scale * z; let offset = (predictable ? 0 : s.nodeSize) + 2; const importance = 1 - rank / Math.max(1, placed.length);
      for (const c of strings.get(box.node)!) { const g = glyph(c); data.push(box.node, offset, (-s.labelSize / 2 - 2) * z, g.w * k, line * k, g.x / 2048, g.y / 2048, g.w / 2048, line / 2048, importance, multiplier(box.node)); offset += g.advance * k; }
    });
    levels.push(new Float32Array(data)); nodes.push(Uint32Array.from(placed, b => b.node)); scales.push(Float32Array.from(placed, b => grow.get(b.node)!));
    await yieldTask(); if (!current()) throw new Error('Renderer superseded');
  }
  return { canvas, levels, nodes, scales };
}
