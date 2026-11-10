export class SpatialGrid {
  private cells = new Map<string, number[]>();
  readonly cellSize: number;
  constructor(readonly positions: Float32Array, nodesPerCell: number) {
    if (!Number.isFinite(nodesPerCell) || nodesPerCell <= 0) throw new Error('nodesPerCell must be positive');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 2) { minX = Math.min(minX, positions[i]!); maxX = Math.max(maxX, positions[i]!); minY = Math.min(minY, positions[i + 1]!); maxY = Math.max(maxY, positions[i + 1]!); }
    this.cellSize = Math.max(Number.EPSILON, Math.sqrt(Math.max(1, (maxX - minX) * (maxY - minY)) * nodesPerCell / Math.max(1, positions.length / 2)));
    for (let i = 0; i < positions.length / 2; i++) { const key = this.key(positions[i * 2]!, positions[i * 2 + 1]!); const cell = this.cells.get(key); if (cell) cell.push(i); else this.cells.set(key, [i]); }
  }
  private key(x: number, y: number) { return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}`; }
  query(x: number, y: number, radius: number): number[] {
    const found: number[] = [];
    for (let a = Math.floor((x - radius) / this.cellSize); a <= Math.floor((x + radius) / this.cellSize); a++) for (let b = Math.floor((y - radius) / this.cellSize); b <= Math.floor((y + radius) / this.cellSize); b++) {
      for (const i of this.cells.get(`${a}:${b}`) ?? []) if (Math.hypot(this.positions[i * 2]! - x, this.positions[i * 2 + 1]! - y) <= radius) found.push(i);
    }
    return found;
  }
}
