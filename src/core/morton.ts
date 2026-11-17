/** Query locality only: never reorder tree insertion or a node's force sum.
 * Stable byte-radix passes reuse all scratch space, including on refresh. */
export class MortonOrder {
  readonly indices: Uint32Array;
  private codes: Uint32Array;
  private scratch: Uint32Array;
  private bins = new Uint32Array(256);
  constructor(count: number) {
    this.indices = new Uint32Array(count); this.codes = new Uint32Array(count); this.scratch = new Uint32Array(count);
  }
  update(p: Float32Array, minX: number, minY: number, maxX: number, maxY: number): void {
    const { codes, bins } = this, sx = 65535 / (maxX - minX || 1), sy = 65535 / (maxY - minY || 1);
    let order = this.indices, scratch = this.scratch;
    for (let i = 0; i < order.length; i++) {
      codes[i] = spread((p[2 * i]! - minX) * sx) | spread((p[2 * i + 1]! - minY) * sy) << 1;
      order[i] = i;
    }
    for (let shift = 0; shift < 32; shift += 8) {
      bins.fill(0);
      for (let q = 0; q < order.length; q++) bins[codes[order[q]!]! >>> shift & 255]!++;
      let sum = 0;
      for (let b = 0; b < 256; b++) { const count = bins[b]!; bins[b] = sum; sum += count; }
      for (let q = 0; q < order.length; q++) { const i = order[q]!; scratch[bins[codes[i]! >>> shift & 255]!++] = i; }
      const previous = order; order = scratch; scratch = previous;
    }
    // Four passes leave the sorted permutation in the original indices buffer.
  }
}
function spread(value: number): number {
  let x = Math.min(65535, Math.max(0, value)) & 65535;
  x = (x | x << 8) & 0x00ff00ff;
  x = (x | x << 4) & 0x0f0f0f0f;
  x = (x | x << 2) & 0x33333333;
  return (x | x << 1) & 0x55555555;
}
