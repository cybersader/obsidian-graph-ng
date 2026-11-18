import { degreeSizes } from './render-effects';
import { renderPath, type RenderProjection } from './render-projection';
import type { Settings } from './settings';
import { LABEL_RATIOS, placeLabels, type LabelBox, type PickGrid } from './render-data';
import { yieldTask } from './core/scheduler';
import { overviewScale } from './label-layout';
interface Glyph { x: number; y: number; w: number; advance: number }
/** Per level: glyph quads, placed nodes in degree-rank order and each node's degree-weighted size factor. */
export interface LabelAtlas { canvas: HTMLCanvasElement; levels: Float32Array[]; nodes: Uint32Array[]; scales: Float32Array[]; widths: Map<number, number> }
/** Graduated labels, ranked focus (0) > direct (1) > ancestor (2) > 2-hop (3) > same group (4), then degree and id; `near` is the
 * touched list from `focusTiers`, `state` its tier bytes. Candidates are capped like the atlas and
 * placed with the same budget and collision grid. Runs once per focus or level-of-detail change. */
export function focusLabels(focus: number, near: readonly number[], state: Uint8Array, visible: ArrayLike<number>, offsets: Uint32Array, box: (node: number, rank: number) => LabelBox, cell: number, budget: number, cap: number) {
  const { list } = rankFocus(focus, near, state, visible, offsets, cap), ranks = new Map(list);
  return list.length ? placeLabels(list.map(([n, r]) => box(n, r)), cell, budget).map(b => [b.node, ranks.get(b.node)!] as const) : [];
}
/** Visible touched notes as [node, rank] in priority order (capped), plus the visible direct-connection count.
 * Within a tier, `score` (degree of interest, see interest.ts) orders when given; otherwise degree. */
export function rankFocus(focus: number, near: readonly number[], state: Uint8Array, visible: ArrayLike<number>, offsets: Uint32Array, cap: number, notes?: ArrayLike<number>, score?: (n: number) => number, directOnlyAbove = Infinity) {
  const rank = (n: number) => n === focus ? 0 : state[n * 4 + 1]! > 200 ? 1 : 5 - (state[n * 4 + 1]! >> 6), degree = (n: number) => offsets[n + 1]! - offsets[n]!;
  // Transparent carrier dots are not direct neighbours in the card/legend. They must not
  // consume its label slots or inflate the count offered by the card's '+N more' link.
  const tiers: number[][] = [[], [], [], [], [], []], list: (readonly [number, number])[] = [];
  for (const n of near) if (visible[n] && (n === focus || !notes?.[n])) tiers[rank(n)]!.push(n);
  // A full higher tier leaves no slots for lower tiers: never score/sort those discarded notes.
  const direct = tiers[1]!.length;
  // Dense-hub radial placement only shows focus/direct labels; discard other tiers before scoring or measuring.
  if (direct > directOnlyAbove) tiers.length = 2;
  for (let r = 0; r < tiers.length && list.length < cap; r++) {
    const nodes = tiers[r]!; nodes.sort((a, b) => (score ? score(b) - score(a) : degree(b) - degree(a)) || a - b);
    for (let i = 0; i < nodes.length && list.length < cap; i++) list.push([nodes[i]!, r]);
  }
  return { list, direct };
}
/** Exact prefix of the degree-descending, node-index-ascending order. */
export function labelCandidates(count: number, visible: ArrayLike<number>, offsets: Uint32Array, cap: number): number[] {
  const nodes: number[] = [], degree = (i: number) => offsets[i + 1]! - offsets[i]!;
  let max = 0;
  for (let i = 0; i < count; i++) if (visible[i]) {
    nodes.push(i);
    const d = degree(i); max = d >= 0 ? Math.max(max, d) : NaN;
  }
  const k = Math.min(cap, nodes.length);
  if (k === 0) return [];
  if (max >= 0 && k * 4 < nodes.length) {
    // Find the cutoff degree in at most four byte passes over the u32 degrees.
    const bins = new Uint32Array(256);
    let cutoff = 0, tied = k, shift = 24;
    while (shift && !(max >>> shift)) shift -= 8;
    for (; shift >= 0; shift -= 8) {
      bins.fill(0);
      for (const node of nodes) {
        const prefix = degree(node) >>> shift;
        if ((prefix >>> 8) === cutoff) bins[prefix & 255]!++;
      }
      let b = 255;
      while (tied > bins[b]!) tied -= bins[b--]!;
      cutoff = cutoff * 256 + b;
    }
    // Ascending node indices retain precisely the first `tied` notes at cutoff.
    let write = 0;
    for (const node of nodes) {
      const d = degree(node);
      if (d > cutoff || (d === cutoff && tied-- > 0)) nodes[write++] = node;
    }
    nodes.length = k;
  }
  nodes.sort((a, b) => degree(b) - degree(a) || a - b);
  nodes.length = k;
  return nodes;
}

/** Rasterize codepoints once, then place bounded lists at each LOD. No per-frame text work. */
export async function buildLabels(p: RenderProjection, grid: Pick<PickGrid, 'positions' | 'visible' | 'minX' | 'minY' | 'width' | 'height'>, s: Settings, width: number, height: number, font: string, current: () => boolean, visible = grid.visible): Promise<LabelAtlas> {
  // Anchored names use DOM text. Keep the identical ranking/metrics, not an unused raster or GPU quads.
  const raster = s.visuals.labelStyle === 'ranked';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = raster ? 2048 : 1;
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
    const g = { x, y, w, advance }; glyphs.set(c, g); if (raster) ctx.fillText(c, x + 2, y + 2); x += w; return g;
  };
  glyph('?');
  const budget = Math.max(1, Math.min(s.labelsMaxPerViewport, Math.floor(width * height / (s.labelGridCellSize ** 2) * s.labelDensity)));
  // The atlas only receives the best candidates within the existing viewport budget.
  const candidates = labelCandidates(p.nodeCount, visible, p.offsets, budget * s.labelCandidateMultiplier);
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
    if (raster) placed.forEach((box, rank) => {
      const z = grow.get(box.node)!, k = scale * z, left = (predictable ? 0 : s.nodeSize) + 2, width = widths.get(box.node)! * z + 5 * k; let offset = left; const importance = 1 - rank / Math.max(1, placed.length);
      // One plate per label (atlas v = 2, the shader's plate flag) under its glyphs: overlapping padded glyph quads never cover a neighbour or double its alpha.
      data.push(box.node, offset, (-s.labelSize / 2 - 2) * z, width, line * k, 0, 2, 0, 0, importance, multiplier(box.node), left, width);
      for (const c of strings.get(box.node)!) { const g = glyph(c); data.push(box.node, offset, (-s.labelSize / 2 - 2) * z, g.w * k, line * k, g.x / 2048, g.y / 2048, g.w / 2048, line / 2048, importance, multiplier(box.node), left, width); offset += g.advance * k; }
    });
    levels.push(new Float32Array(data)); nodes.push(Uint32Array.from(placed, b => b.node)); scales.push(Float32Array.from(placed, b => grow.get(b.node)!));
    await yieldTask(); if (!current()) throw new Error('Renderer superseded');
  }
  return { canvas, levels, nodes, scales, widths };
}
