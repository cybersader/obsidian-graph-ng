/** World box the camera is normalised against (the renderer's fixed camera frame). */
export interface MiniFrame { minX: number; minY: number; width: number; height: number }
/** World-to-minimap scale and centring offset. */
export interface MiniFit { s: number; ox: number; oy: number }
export const MINIMAP_W = 160, MINIMAP_H = 120, MINIMAP_MIN_CANVAS = 500;
const DOTS = 400;

/** Fit `f` into a w×h minimap, centred, aspect kept. */
export function miniFit(f: MiniFrame, w: number, h: number): MiniFit {
  const s = Math.min(w / f.width, h / f.height);
  return { s, ox: (w - f.width * s) / 2, oy: (h - f.height * s) / 2 };
}
/** World point to minimap px. */
export const toMini = (f: MiniFrame, m: MiniFit, x: number, y: number): [number, number] => [m.ox + (x - f.minX) * m.s, m.oy + (y - f.minY) * m.s];
/** Minimap px to the normalised camera centre that puts that point mid-view. */
export const toCamera = (f: MiniFrame, m: MiniFit, x: number, y: number): [number, number] => [(x - m.ox) / m.s / f.width, (y - m.oy) / m.s / f.height];
/** The view as a minimap rectangle: normalised camera centre plus the view's world size. */
export function viewRect(f: MiniFrame, m: MiniFit, cx: number, cy: number, worldW: number, worldH: number) {
  const [x, y] = toMini(f, m, f.minX + cx * f.width, f.minY + cy * f.height), w = worldW * m.s, h = worldH * m.s;
  return { x: x - w / 2, y: y - h / 2, w, h };
}
/** Visible notes binned into a w×h count grid. O(n); run when positions or the view change, never per frame. */
export function densityGrid(positions: ArrayLike<number>, visible: ArrayLike<number>, f: MiniFrame, m: MiniFit, w: number, h: number) {
  const grid = new Uint32Array(w * h);
  for (let i = 0; i < visible.length; i++) if (visible[i]) {
    const [x, y] = toMini(f, m, positions[i * 2]!, positions[i * 2 + 1]!), cx = Math.floor(x), cy = Math.floor(y);
    if (cx >= 0 && cy >= 0 && cx < w && cy < h) grid[cy * w + cx]!++;
  }
  return grid;
}

export interface MiniState {
  on: boolean; positions: Float32Array; visible: Uint8Array;
  /** Normalised camera centre and the view's world size. */
  cx: number; cy: number; worldW: number; worldH: number;
  focus: number; directs: readonly number[]; ink: string; accent: string;
}
/** Corner overview: a cached density image, the viewport rectangle and focus dots. Click or drag pans;
 * when focused, arrow keys pan and Home fits everything. */
export class Minimap {
  readonly root: HTMLElement;
  private miniCanvas: HTMLCanvasElement;
  private densityCanvas: HTMLCanvasElement;
  private fitting: MiniFit;
  private miniLast?: MiniState;
  private miniDrawn: unknown[] = [];
  private miniBuilt: unknown[] = [];
  /** Source the pending rebuild waits on; the timer restarts only when it changes again. */
  private miniWanted: unknown[] = [];
  private densityVersion = 0;
  private miniTimer?: ReturnType<typeof setTimeout>;
  constructor(parent: HTMLElement, private miniFrame: MiniFrame, private panCamera: (x: number, y: number) => void, private fitCamera: () => void) {
    const make = (tag: string, cls = '') => Object.assign(document.createElement(tag), { className: cls });
    this.root = parent.appendChild(make('div', 'graph-ng-minimap')); this.root.hidden = true; this.root.tabIndex = 0;
    this.root.setAttribute('role', 'group'); this.root.setAttribute('aria-label', 'Minimap. Arrow keys pan, Home fits all.');
    this.miniCanvas = this.root.appendChild(make('canvas') as HTMLCanvasElement); this.miniCanvas.setAttribute('aria-hidden', 'true');
    this.densityCanvas = make('canvas') as HTMLCanvasElement;
    this.miniCanvas.width = this.densityCanvas.width = MINIMAP_W; this.miniCanvas.height = this.densityCanvas.height = MINIMAP_H;
    this.fitting = miniFit(miniFrame, MINIMAP_W, MINIMAP_H);
    const at = (e: PointerEvent) => { const r = this.miniCanvas.getBoundingClientRect(), k = MINIMAP_W / (r.width || MINIMAP_W); this.panCamera(...toCamera(this.miniFrame, this.fitting, (e.clientX - r.left) * k, (e.clientY - r.top) * k)); };
    this.miniCanvas.addEventListener('pointerdown', e => { if (e.button > 0) return; this.miniCanvas.setPointerCapture(e.pointerId); at(e); });
    this.miniCanvas.addEventListener('pointermove', e => { if (this.miniCanvas.hasPointerCapture(e.pointerId)) at(e); });
    this.miniCanvas.addEventListener('pointerup', e => { if (this.miniCanvas.hasPointerCapture(e.pointerId)) this.miniCanvas.releasePointerCapture(e.pointerId); });
    this.root.addEventListener('keydown', this.miniKey);
  }
  private miniKey = (e: KeyboardEvent) => {
    const s = this.miniLast, d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (e.key === 'Home') this.fitCamera();
    else if (d && s) this.panCamera(s.cx + d[0]! * s.worldW / 4 / this.miniFrame.width, s.cy + d[1]! * s.worldH / 4 / this.miniFrame.height);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  /** Per frame: cheap key checks; the density image is rebuilt only after positions or the view settle. */
  update(s: MiniState) {
    this.miniLast = s; this.root.hidden = !s.on; if (!s.on) return;
    const source = [s.positions, s.visible, s.ink];
    // First build is immediate; later changes wait for positions to stop moving (a pan alone does not restart the wait).
    if (!this.miniBuilt.length) this.rebuildDensity(source);
    else if (source.some((x, i) => x !== this.miniBuilt[i]) && source.some((x, i) => x !== this.miniWanted[i])) {
      clearTimeout(this.miniTimer); this.miniWanted = source;
      this.miniTimer = setTimeout(() => { this.rebuildDensity([this.miniLast!.positions, this.miniLast!.visible, this.miniLast!.ink]); this.update(this.miniLast!); }, 250);
    }
    const key = [this.densityVersion, s.cx, s.cy, s.worldW, s.worldH, s.focus, s.directs, s.accent];
    if (key.every((x, i) => x === this.miniDrawn[i])) return;
    this.miniDrawn = key;
    const ctx = this.miniCanvas.getContext('2d'); if (!ctx) return;
    const f = this.miniFrame, m = this.fitting, r = viewRect(f, m, s.cx, s.cy, s.worldW, s.worldH);
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H); ctx.drawImage(this.densityCanvas, 0, 0);
    ctx.strokeStyle = ctx.fillStyle = s.accent; ctx.lineWidth = 1.5; ctx.strokeRect(r.x, r.y, r.w, r.h);
    const dot = (n: number, size: number) => { const [x, y] = toMini(f, m, s.positions[n * 2]!, s.positions[n * 2 + 1]!); ctx.fillRect(x - size / 2, y - size / 2, size, size); };
    ctx.globalAlpha = .8; for (let i = 0; i < Math.min(DOTS, s.directs.length); i++) dot(s.directs[i]!, 3);
    ctx.globalAlpha = 1; if (s.focus >= 0) { dot(s.focus, 6); }
  }
  private rebuildDensity(source: unknown[]) {
    this.miniTimer = undefined; this.miniBuilt = this.miniWanted = source; this.densityVersion++;
    const s = this.miniLast!, ctx = this.densityCanvas.getContext('2d'), image = ctx?.createImageData?.(MINIMAP_W, MINIMAP_H);
    if (!ctx || !image?.data) return;
    const grid = densityGrid(s.positions, s.visible, this.miniFrame, this.fitting, MINIMAP_W, MINIMAP_H);
    let max = 1; for (const c of grid) if (c > max) max = c;
    // Alpha-only density (square-root scaled so sparse areas stay visible), then tinted with the theme ink.
    for (let i = 0; i < grid.length; i++) image.data[i * 4 + 3] = grid[i] ? 60 + 195 * Math.sqrt(grid[i]! / max) : 0;
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H); ctx.putImageData(image, 0, 0);
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = s.ink; ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H); ctx.globalCompositeOperation = 'source-over';
  }
  dispose() { clearTimeout(this.miniTimer); this.root.removeEventListener('keydown', this.miniKey); this.root.remove(); }
}
