import { renderPath, type RenderProjection } from './render-projection';
import type { Settings } from './settings';
import { LABEL_RATIOS, placeLabels, type LabelBox, type PickGrid } from './render-data';
import { yieldTask } from './core/scheduler';
interface Glyph { x: number; y: number; w: number; advance: number }
export interface LabelAtlas { canvas: HTMLCanvasElement; levels: Float32Array[]; nodes: Uint32Array[] }
/** Rasterize codepoints once, then place bounded lists at each LOD. No per-frame text work. */
export async function buildLabels(p: RenderProjection, grid: PickGrid, s: Settings, width: number, height: number, font: string, current: () => boolean, visible = grid.visible): Promise<LabelAtlas> {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2048;
  const ctx = canvas.getContext('2d')!;
  const fontSize = Math.min(48, s.labelSize), line = Math.ceil(fontSize * 1.5) + 4, scale = s.labelSize / fontSize;
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
  const fit = Math.min(width / (grid.width * 1.1), height / (grid.height * 1.1));
  const levels: Float32Array[] = [], nodes: Uint32Array[] = [];
  for (const ratio of LABEL_RATIOS) {
    const boxes: LabelBox[] = candidates.map(node => ({ node, x: (grid.positions[node * 2]! - grid.minX) * fit / ratio + s.nodeSize + 4, y: (grid.positions[node * 2 + 1]! - grid.minY) * fit / ratio - s.labelSize / 2, w: widths.get(node)! + 4, h: s.labelSize * 1.5 + 4 }));
    const placed = placeLabels(boxes, s.labelGridCellSize, budget), data: number[] = [];
    // Importance is degree rank among placed labels; the shader fades the least important first.
    placed.forEach((box, rank) => {
      let offset = s.nodeSize + 2; const importance = 1 - rank / Math.max(1, placed.length);
      for (const c of strings.get(box.node)!) { const g = glyph(c); data.push(box.node, offset, -s.labelSize / 2 - 2, g.w * scale, line * scale, g.x / 2048, g.y / 2048, g.w / 2048, line / 2048, importance); offset += g.advance * scale; }
    });
    levels.push(new Float32Array(data)); nodes.push(Uint32Array.from(placed, b => b.node));
    await yieldTask(); if (!current()) throw new Error('Renderer superseded');
  }
  return { canvas, levels, nodes };
}
