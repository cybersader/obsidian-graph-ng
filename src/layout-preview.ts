/** Loading uses the ordinary renderer and limits, with one held frame and at most one waiting frame. */
interface PreviewRenderer {
  positions: Float32Array;
  readonly usable?: boolean;
  streamPositions(next: Float32Array): Float32Array;
  dispose(): void;
}
export class LayoutPreview {
  private renderer?: PreviewRenderer;
  private next?: Float32Array;
  private starting?: Promise<void>;
  private closed = false;
  constructor(private create: (positions: Float32Array, current: () => boolean) => Promise<PreviewRenderer>, private recycle: (positions: Float32Array) => void, private current: () => boolean, private failed: (error: unknown) => void) {}
  push(positions: Float32Array) {
    if (this.closed || !this.current()) { this.recycle(positions); return; }
    if (this.renderer?.usable === false) { this.recycle(this.renderer.positions); this.renderer = undefined; }
    if (this.renderer) {
      try { this.recycle(this.renderer.streamPositions(positions)); }
      catch (e) { if (this.renderer.positions !== positions) this.recycle(positions); this.failed(e); void this.finish(); }
    } else {
      if (this.next) this.recycle(this.next);
      this.next = positions;
      this.starting ??= this.start();
    }
  }
  private async start() {
    const positions = this.next!; this.next = undefined;
    const current = () => !this.closed && this.current();
    try {
      this.renderer = await this.create(positions, current);
      if (!current()) { this.renderer.dispose(); this.recycle(this.renderer.positions); this.renderer = undefined; }
      else if (this.next) { const next = this.next; this.next = undefined; this.push(next); }
    } catch (e) { this.recycle(positions); if (current()) this.failed(e); this.closed = true; }
    finally { this.starting = undefined; if (this.next) this.recycle(this.next); this.next = undefined; }
  }
  async finish() {
    this.closed = true;
    if (this.next) this.recycle(this.next); this.next = undefined;
    await this.starting;
    this.renderer?.dispose(); if (this.renderer) this.recycle(this.renderer.positions);
    this.renderer = undefined;
  }
}
