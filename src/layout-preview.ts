/** Loading uses the ordinary renderer and limits, with one held frame and at most one waiting frame. */
interface PreviewRenderer {
  positions: Float32Array;
  readonly recovering?: boolean;
  readonly usable?: boolean;
  readonly calmLayout?: boolean;
  onLayoutPaint(update: () => void): void | Promise<void>;
  streamPositions(next: Float32Array, paint: 'drawing'): Float32Array;
  dispose(): void;
}
/** With one worker credit, arrivals normally cannot overlap a paint. If they do,
 * keep just the newest waiting snapshot; only the original delivery owns a credit. */
export class FrameCadence {
  private waiting?: { positions: Float32Array };
  constructor(private paint: (p: Float32Array) => void, private recycle: (p: Float32Array) => void) {}
  push(positions: Float32Array, renderer: PreviewRenderer): void | false | Promise<void> {
    if (this.waiting) { this.recycle(this.waiting.positions); this.waiting.positions = positions; return false; }
    const slot = this.waiting = { positions };
    const drawn = renderer.onLayoutPaint(() => {
      if (this.waiting !== slot) return;
      this.waiting = undefined; this.paint(slot.positions);
    });
    // Context loss/disposal also releases the draw promise, without running the update.
    return drawn?.then(() => { if (this.waiting === slot) this.clear(); });
  }
  clear() { if (this.waiting) this.recycle(this.waiting.positions); this.waiting = undefined; }
}
export class LayoutPreview {
  private renderer?: PreviewRenderer;
  private next?: Float32Array;
  private starting?: Promise<void>;
  private closed = false;
  private frames = new FrameCadence(p => {
    const r = this.renderer;
    if (!this.current() || !r || r.usable === false || r.calmLayout) { this.recycle(p); return; }
    try { this.recycle(r.streamPositions(p, 'drawing')); }
    catch (e) { if (r.positions !== p) this.recycle(p); this.failed(e); void this.finish(); return false; }
  }, p => this.recycle(p));
  constructor(private create: (positions: Float32Array, current: () => boolean) => Promise<PreviewRenderer>, private recycle: (positions: Float32Array) => void, private current: () => boolean, private failed: (error: unknown) => void, private beginAttempt?: () => () => boolean) {}
  push(positions: Float32Array): void | false | Promise<void> {
    if (this.closed || !this.current()) { this.recycle(positions); return this.closed ? false : undefined; }
    if (this.renderer?.recovering) { this.recycle(positions); return; }
    if (this.renderer?.usable === false) { this.frames.clear(); this.recycle(this.renderer.positions); this.renderer = undefined; }
    if (this.renderer?.calmLayout) { this.recycle(positions); return; }
    if (this.renderer) return this.frames.push(positions, this.renderer);
    if (this.next) this.recycle(this.next);
    this.next = positions;
    if (this.starting) return false;
    return this.starting = this.start();
  }
  private async start() {
    const positions = this.next!; this.next = undefined;
    const ownsAttempt = this.beginAttempt?.();
    const current = () => !this.closed && this.current() && (!ownsAttempt || ownsAttempt());
    try {
      this.renderer = await this.create(positions, current);
      if (!current()) { this.renderer.dispose(); this.recycle(this.renderer.positions); this.renderer = undefined; }
      else if (this.next) { const next = this.next; this.next = undefined; await this.push(next); }
    } catch (e) { this.recycle(positions); if (current()) { this.closed = true; this.failed(e); } }
    finally { this.starting = undefined; if (this.next) this.recycle(this.next); this.next = undefined; }
  }
  /** Stop streams first; optionally hold the last painted preview until its replacement is ready. */
  async finish(retain = false) {
    this.closed = true; this.frames.clear();
    if (this.next) this.recycle(this.next); this.next = undefined;
    await this.starting;
    if (retain) return;
    this.renderer?.dispose(); if (this.renderer) this.recycle(this.renderer.positions);
    this.renderer = undefined;
  }
}
