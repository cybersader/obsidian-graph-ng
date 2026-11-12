/** Flat, reusable, threaded quadtree. No JS node/edge/cell objects.
 * Leaves at the precision/depth limit are mass buckets: coincident nodes cannot
 * cause unbounded subdivision (or an all-pairs walk through a giant bucket).
 */
export class BarnesHut {
  private capacity: number;
  private used = 0;
  private owner: Int32Array;
  private child: Int32Array;
  private head: Int32Array;
  private next: Int32Array;
  private cx: Float64Array;
  private cy: Float64Array;
  private half: Float64Array;
  private mass: Float64Array;
  private mx: Float64Array;
  private my: Float64Array;
  constructor(count: number) {
    this.owner = new Int32Array(count);
    this.capacity = Math.max(16, count * 4 + 4);
    this.child = new Int32Array(this.capacity); this.head = new Int32Array(this.capacity); this.next = new Int32Array(this.capacity);
    this.cx = new Float64Array(this.capacity); this.cy = new Float64Array(this.capacity); this.half = new Float64Array(this.capacity);
    this.mass = new Float64Array(this.capacity); this.mx = new Float64Array(this.capacity); this.my = new Float64Array(this.capacity);
  }
  private allocate(cx: number, cy: number, half: number, next: number): number {
    const c = this.used++;
    if (c === this.capacity) {
      this.capacity *= 2;
      const grow = <T extends Int32Array | Float64Array>(a: T): T => { const b = new (a.constructor as { new(length: number): T })(this.capacity); b.set(a); return b; };
      this.child = grow(this.child); this.head = grow(this.head); this.next = grow(this.next);
      this.cx = grow(this.cx); this.cy = grow(this.cy); this.half = grow(this.half);
      this.mass = grow(this.mass); this.mx = grow(this.mx); this.my = grow(this.my);
    }
    this.child[c] = -1; this.head[c] = -1; this.next[c] = next;
    this.cx[c] = cx; this.cy[c] = cy; this.half[c] = half;
    this.mass[c] = 0; this.mx[c] = 0; this.my[c] = 0;
    return c;
  }
  build(p: Float32Array, weights: Float32Array, depthLimit: number): void {
    this.used = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < p.length; i += 2) { minX = Math.min(minX, p[i]!); maxX = Math.max(maxX, p[i]!); minY = Math.min(minY, p[i + 1]!); maxY = Math.max(maxY, p[i + 1]!); }
    this.allocate((minX + maxX) / 2, (minY + maxY) / 2, Math.max(maxX - minX, maxY - minY, 1e-6) / 2, -1);
    for (let i = 0; i < weights.length; i++) {
      const x = p[2 * i]!, y = p[2 * i + 1]!, m = weights[i]!;
      let c = 0, depth = 0;
      while (true) {
        this.mass[c]! += m; this.mx[c]! += x * m; this.my[c]! += y * m;
        let first = this.child[c]!;
        if (first < 0) {
          const old = this.head[c]!;
          if (old === -1) { this.head[c] = i; this.owner[i] = c; break; }
          if (old === -2) { this.owner[i] = c; break; }
          if (depth >= depthLimit) {
            // Only aggregate at the depth limit: an early coincident pair must
            // not turn an entire coarse region into an unsplittable bucket.
            this.head[c] = -2; this.owner[i] = c; break;
          }
          first = this.used; this.child[c] = first;
          const h = this.half[c]! / 2;
          for (let q = 0; q < 4; q++) this.allocate(this.cx[c]! + (q & 1 ? h : -h), this.cy[c]! + (q & 2 ? h : -h), h, q < 3 ? first + q + 1 : this.next[c]!);
          const q = first + (p[2 * old]! >= this.cx[c]! ? 1 : 0) + (p[2 * old + 1]! >= this.cy[c]! ? 2 : 0);
          this.owner[old] = q; this.head[q] = old; this.mass[q] = weights[old]!; this.mx[q] = p[2 * old]! * weights[old]!; this.my[q] = p[2 * old + 1]! * weights[old]!;
        }
        c = first + (x >= this.cx[c]! ? 1 : 0) + (y >= this.cy[c]! ? 2 : 0); depth++;
      }
    }
    for (let c = 0; c < this.used; c++) if (this.mass[c]) { this.mx[c]! /= this.mass[c]!; this.my[c]! /= this.mass[c]!; }
  }
  repulse(p: Float32Array, weights: Float32Array, forces: Float32Array, scaling: number, theta: number): void {
    const theta2 = theta * theta;
    for (let i = 0; i < weights.length; i++) {
      const x = p[2 * i]!, y = p[2 * i + 1]!, m = weights[i]!;
      let c = 0, fx = 0, fy = 0;
      while (c >= 0) {
        let mass = this.mass[c]!;
        if (!mass) { c = this.next[c]!; continue; }
        let dx = x - this.mx[c]!, dy = y - this.my[c]!, d2 = dx * dx + dy * dy;
        const h = this.half[c]!, contains = Math.abs(x - this.cx[c]!) <= h && Math.abs(y - this.cy[c]!) <= h;
        if (this.child[c]! >= 0 && (contains || 4 * h * h >= theta2 * d2)) { c = this.child[c]!; continue; }
        if (this.child[c]! < 0 && this.owner[i] === c) {
          // Do not let a leaf exert a force on its own member.
          const other = mass - m;
          if (other <= 0) { c = this.next[c]!; continue; }
          dx = (dx * mass) / other; dy = (dy * mass) / other; mass = other; d2 = dx * dx + dy * dy;
        }
        if (d2 > 0) { const factor = scaling * m * mass / d2; fx += dx * factor; fy += dy * factor; }
        c = this.next[c]!;
      }
      forces[2 * i] = fx; forces[2 * i + 1] = fy;
    }
  }
}
