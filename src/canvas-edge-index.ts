// Renderer-only, settled straight segments. Midpoint Morton order groups
// nearby rows; bounds enclose both endpoints, including long crossings.
export const CANVAS_INDEX_ROWS = 160_000;
const LEAF = 16, LIMIT = 768, VISITS = 4096, ROW_BASE = 262144;
function spread(n: number) {
  n = (n | n << 8) & 0x00ff00ff;
  n = (n | n << 4) & 0x0f0f0f0f;
  n = (n | n << 2) & 0x33333333;
  return (n | n << 1) & 0x55555555;
}

export class CanvasEdgeIndex {
  private rows: Uint32Array;
  private boxes: Float32Array;
  private leaves: number;
  private local = new Uint32Array(LIMIT);
  constructor(readonly positions: Float32Array, private source: Uint32Array, private target: Uint32Array, grid: { minX: number; minY: number; width: number; height: number }) {
    const count = source.length, order = new Float64Array(count), leaves = this.leaves = 2 ** Math.ceil(Math.log2(Math.ceil(count / LEAF)));
    const key = (sum: number, min: number, extent: number) => spread(Math.max(0, Math.min(65535, Math.floor((sum / 2 - min) / extent * 65536))));
    for (let e = 0; e < count; e++) {
      const a = source[e]! * 2, b = target[e]! * 2;
      const m = (key(positions[a]! + positions[b]!, grid.minX, grid.width) | key(positions[a+1]! + positions[b+1]!, grid.minY, grid.height) << 1) >>> 0;
      order[e] = m * ROW_BASE + e;
    }
    order.sort();
    const rows = this.rows = Uint32Array.from(order, x => x % ROW_BASE), box = this.boxes = new Float32Array(leaves * 8);
    for (let leaf = 0; leaf < leaves; leaf++) {
      let x = Infinity, y = Infinity, X = -Infinity, Y = -Infinity;
      for (let j = leaf * LEAF; j < Math.min((leaf + 1) * LEAF, count); j++) {
        const e = rows[j]!, a = source[e]! * 2, b = target[e]! * 2;
        x = Math.min(x, positions[a]!, positions[b]!); y = Math.min(y, positions[a+1]!, positions[b+1]!);
        X = Math.max(X, positions[a]!, positions[b]!); Y = Math.max(Y, positions[a+1]!, positions[b+1]!);
      }
      const i = (leaf + leaves) * 4; box[i] = x; box[i+1] = y; box[i+2] = X; box[i+3] = Y;
    }
    for (let i = (leaves - 1) * 4; i >= 4; i -= 4) {
      const j = i * 2;
      box[i] = Math.min(box[j]!, box[j+4]!); box[i+1] = Math.min(box[j+1]!, box[j+5]!);
      box[i+2] = Math.max(box[j+2]!, box[j+6]!); box[i+3] = Math.max(box[j+3]!, box[j+7]!);
    }
  }
  /** A complete sparse query or no replacement at all. Dense/overlapping
   * geometry returns to the existing ranked pool within a hard visit budget. */
  query(cx: number, cy: number, w: number, h: number, radius: number, cap: number, on: (e: number) => boolean) {
    const {positions:p, rows, boxes, leaves, source, target, local} = this, l = cx-w-radius, r = cx+w+radius, t = cy-h-radius, b = cy+h+radius;
    if (l <= boxes[4]! && r >= boxes[6]! && t <= boxes[5]! && b >= boxes[7]!) return;
    let n = 0, visits = VISITS; const limit = Math.min(cap, LIMIT);
    const visit = (node: number): boolean => {
      if (--visits < 0) return false;
      const i = node*4;
      if (boxes[i]! > r || boxes[i+1]! > b || boxes[i+2]! < l || boxes[i+3]! < t) return true;
      if (node < leaves) return visit(2*node) && visit(2*node+1);
      const start = (node-leaves)*LEAF;
      for (let j = start, end = Math.min(start+LEAF, rows.length); j < end; j++) {
        if (--visits < 0) return false;
        const e = rows[j]!, a = source[e]! * 2, z = target[e]! * 2;
        const ax = p[a]!, ay = p[a+1]!, bx = p[z]!, by = p[z+1]!;
        // Positive-area intersection of viewport and butt-capped stroke on all four separating axes.
        const dx = (bx-ax)/2, dy = (by-ay)/2, x = cx-(ax+dx), y = cy-(ay+dy), u = Math.abs(dx), v = Math.abs(dy), len = Math.hypot(dx,dy);
        if (!len || Math.abs(x) >= w+u+radius*v/len || Math.abs(y) >= h+v+radius*u/len ||
          Math.abs(dx*x+dy*y) >= u*w+v*h+dx*dx+dy*dy || Math.abs(dx*y-dy*x) >= u*h+v*w+radius*len || !on(e)) continue;
        if (n === limit) return false;
        local[n++] = e;
      }
      return true;
    };
    // The ordinary legacy pass visits rows in ID order; keep its hit tie-break.
    if (visit(1)) return local.subarray(0, n).sort();
  }
}
