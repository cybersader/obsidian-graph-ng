import type { Projection } from './core/projection';

/** Packed grid: one link per node, no objects/strings per node or pointer query. */
export class PickGrid {
  readonly heads: Int32Array;
  readonly next: Int32Array;
  readonly columns: number;
  readonly rows: number;
  readonly cell: number;
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  constructor(readonly positions: Float32Array, readonly visible: Uint8Array) {
    if (positions.length !== visible.length * 2) throw new Error('RENDER_POSITION_COUNT');
    let x = Infinity, y = Infinity, xx = -Infinity, yy = -Infinity;
    for (let i = 0; i < visible.length; i++) if (visible[i]) {
      const a = positions[i * 2]!, b = positions[i * 2 + 1]!;
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('RENDER_NONFINITE_POSITION');
      x = Math.min(x, a); y = Math.min(y, b); xx = Math.max(xx, a); yy = Math.max(yy, b);
    }
    this.minX = x === Infinity ? 0 : x; this.minY = y === Infinity ? 0 : y;
    this.width = Math.max(1, xx - this.minX); this.height = Math.max(1, yy - this.minY);
    this.cell = Math.max(this.width, this.height) / Math.max(1, Math.ceil(Math.sqrt(visible.length / 8)));
    this.columns = Math.ceil(this.width / this.cell) + 1; this.rows = Math.ceil(this.height / this.cell) + 1;
    this.heads = new Int32Array(this.columns * this.rows).fill(-1); this.next = new Int32Array(visible.length).fill(-1);
    for (let i = 0; i < visible.length; i++) if (visible[i]) {
      const k = Math.floor((positions[i * 2]! - this.minX) / this.cell) + Math.floor((positions[i * 2 + 1]! - this.minY) / this.cell) * this.columns;
      this.next[i] = this.heads[k]!; this.heads[k] = i;
    }
  }
  visit(x: number, y: number, radius: number, visit: (id: number) => void) {
    const a = Math.max(0, Math.floor((x - radius - this.minX) / this.cell)), b = Math.min(this.columns - 1, Math.floor((x + radius - this.minX) / this.cell));
    const c = Math.max(0, Math.floor((y - radius - this.minY) / this.cell)), d = Math.min(this.rows - 1, Math.floor((y + radius - this.minY) / this.cell));
    for (let row = c; row <= d; row++) for (let col = a; col <= b; col++) for (let i = this.heads[row * this.columns + col]!; i !== -1; i = this.next[i]!) visit(i);
  }
  pick(x: number, y: number, radius: number, skip?: ArrayLike<number>): number {
    let best = -1, distance = radius * radius;
    this.visit(x, y, radius, i => { if (skip?.[i]) return; const dx = this.positions[i * 2]! - x, dy = this.positions[i * 2 + 1]! - y, dd = dx * dx + dy * dy; if (dd <= distance && (dd < distance || best < 0 || i < best)) { best = i; distance = dd; } });
    return best;
  }
}
export function positionTexture(positions: Float32Array, maxWidth = 2048) {
  const width = Math.max(1, Math.min(maxWidth, positions.length / 2)), height = Math.max(1, Math.ceil(positions.length / 2 / width));
  const data = positions.length === width * height * 2 ? positions : new Float32Array(width * height * 2);
  if (data !== positions) data.set(positions);
  return { width, height, data };
}
export function incidentEdges(p: Pick<Projection, 'paths' | 'source' | 'target'> | { nodeCount: number; source: Uint32Array; target: Uint32Array }) {
  const offsets = new Uint32Array(('nodeCount' in p ? p.nodeCount : p.paths.length) + 1);
  for (let e = 0; e < p.source.length; e++) { offsets[p.source[e]! + 1]!++; offsets[p.target[e]! + 1]!++; }
  for (let i = 1; i < offsets.length; i++) offsets[i]! += offsets[i - 1]!;
  const edges = new Uint32Array(p.source.length * 2), cursor = offsets.slice();
  for (let e = 0; e < p.source.length; e++) { edges[cursor[p.source[e]!]!++] = e; edges[cursor[p.target[e]!]!++] = e; }
  return { offsets, edges };
}
/** Bound software draw work by both visible nodes and visible edges; never silently truncate. */
export function canvasDetailEdges(p: Pick<Projection, 'source' | 'target'>, visible: Uint8Array, maxNodes: number, maxEdges: number) {
  if (visible.reduce((n, v) => n + (v ? 1 : 0), 0) > maxNodes) throw new Error('CANVAS_DETAIL_NODE_LIMIT: use group member lists');
  const edges: number[] = [];
  for (let e = 0; e < p.source.length; e++) if (visible[p.source[e]!] && visible[p.target[e]!]) {
    if (edges.length >= maxEdges) throw new Error('CANVAS_DETAIL_EDGE_LIMIT: use group member lists');
    edges.push(e);
  }
  return Uint32Array.from(edges);
}
export function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
export interface LabelBox { node: number; x: number; y: number; w: number; h: number }
/** Precomputed at fixed LOD scales; pan is a translation, never a new collision pass. */
export function placeLabels(candidates: readonly LabelBox[], cellSize: number, budget: number): LabelBox[] {
  const cells = new Map<string, LabelBox[]>(), result: LabelBox[] = [];
  for (const box of candidates) {
    const x0 = Math.floor(box.x / cellSize), x1 = Math.floor((box.x + box.w) / cellSize), y0 = Math.floor(box.y / cellSize), y1 = Math.floor((box.y + box.h) / cellSize);
    let collision = false;
    for (let y = y0; y <= y1 && !collision; y++) for (let x = x0; x <= x1 && !collision; x++) for (const b of cells.get(`${x}:${y}`) ?? []) if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) { collision = true; break; }
    if (collision) continue;
    result.push(box);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const key = `${x}:${y}`, list = cells.get(key); if (list) list.push(box); else cells.set(key, [box]); }
    if (result.length >= budget) break;
  }
  return result;
}
export const LABEL_RATIOS = [.125, .25, .5, 1, 2, 4, 8] as const;
export function labelLOD(ratio: number) { const i = LABEL_RATIOS.findIndex(r => r >= ratio); return i < 0 ? LABEL_RATIOS.length - 1 : i; }

/** Same-size canvas assignments still clear/reset a GPU drawing buffer. */
export function resizeDrawingBuffer(canvas: Pick<HTMLCanvasElement, 'width' | 'height'>, width: number, height: number) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}
