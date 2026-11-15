import { setIcon } from 'obsidian';

/** World box the camera is normalised against (the renderer's fixed camera frame). */
export interface MiniFrame { minX: number; minY: number; width: number; height: number }
/** World-to-minimap scale and centring offset. */
export interface MiniFit { s: number; ox: number; oy: number }
export interface MiniRect { x: number; y: number; w: number; h: number }
export const MINIMAP_W = 160, MINIMAP_H = 120, MINIMAP_MIN_CANVAS = 500;
/** Smallest drawn viewport marker, in minimap px; below it a crosshair marks the spot. */
export const MINI_MARKER = 8;
const DOTS = 400, STORE = 'graph-ng-minimap-collapsed';

/** Fit `f` into a w×h minimap, centred, aspect kept. */
export function miniFit(f: MiniFrame, w: number, h: number): MiniFit {
  const s = Math.min(w / f.width, h / f.height);
  return { s, ox: (w - f.width * s) / 2, oy: (h - f.height * s) / 2 };
}
/** World point to minimap px. */
export const toMini = (f: MiniFrame, m: MiniFit, x: number, y: number): [number, number] => [m.ox + (x - f.minX) * m.s, m.oy + (y - f.minY) * m.s];
/** Minimap px (drawn with bounds `f`) to the normalised camera centre (against `cam`) that puts that point mid-view. */
export const toCamera = (f: MiniFrame, m: MiniFit, x: number, y: number, cam: MiniFrame = f): [number, number] =>
  [(f.minX + (x - m.ox) / m.s - cam.minX) / cam.width, (f.minY + (y - m.oy) / m.s - cam.minY) / cam.height];
/** The view as a minimap rectangle: normalised camera centre (against `cam`) plus the view's world size. */
export function viewRect(f: MiniFrame, m: MiniFit, cx: number, cy: number, worldW: number, worldH: number, cam: MiniFrame = f): MiniRect {
  const [x, y] = toMini(f, m, cam.minX + cx * cam.width, cam.minY + cy * cam.height), w = worldW * m.s, h = worldH * m.s;
  return { x: x - w / 2, y: y - h / 2, w, h };
}
/** Drawn world bounds: the layout and the current view together, padded, so the view rectangle is
 * always fully inside the minimap, whether zoomed out past the layout or panned away from it. */
export function miniBounds(layout: MiniFrame, cx: number, cy: number, worldW: number, worldH: number, pad = .06): MiniFrame {
  const vx = layout.minX + cx * layout.width, vy = layout.minY + cy * layout.height;
  const minX = Math.min(layout.minX, vx - worldW / 2), minY = Math.min(layout.minY, vy - worldH / 2);
  const w = Math.max(layout.minX + layout.width, vx + worldW / 2) - minX, h = Math.max(layout.minY + layout.height, vy + worldH / 2) - minY, p = Math.max(w, h) * pad || 1;
  return { minX: minX - p, minY: minY - p, width: w + 2 * p, height: h + 2 * p };
}
/** The rectangle as drawn: never smaller than `min` px (centred on the view), clamped inside the
 * w×h canvas. `tiny` asks for a crosshair so a deep zoom stays findable. */
export function viewMarker(r: MiniRect, w: number, h: number, min = MINI_MARKER) {
  const tiny = r.w < min || r.h < min, cx = r.x + r.w / 2, cy = r.y + r.h / 2, mw = Math.min(w - 2, Math.max(min, r.w)), mh = Math.min(h - 2, Math.max(min, r.h));
  const x = Math.max(1, Math.min(w - 1 - mw, cx - mw / 2)), y = Math.max(1, Math.min(h - 1 - mh, cy - mh / 2));
  return { x, y, w: mw, h: mh, cx: x + mw / 2, cy: y + mh / 2, tiny };
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

const stored = () => { try { return globalThis.localStorage?.getItem(STORE) === '1'; } catch { return false; } };

export interface MiniState {
  on: boolean; positions: Float32Array; visible: Uint8Array;
  /** Normalised camera centre and the view's world size. */
  cx: number; cy: number; worldW: number; worldH: number;
  focus: number; directs: readonly number[]; ink: string; accent: string;
}
/** Corner overview: a cached density image (layout frame) scaled into bounds that also hold the view,
 * the "you are here" rectangle and focus dots. Click or drag pans; when focused, arrow keys pan and
 * Home fits everything. A corner button collapses it; the choice is remembered. */
export class Minimap {
  readonly root: HTMLElement;
  private miniCanvas: HTMLCanvasElement;
  private densityCanvas: HTMLCanvasElement;
  private miniToggle: HTMLElement;
  private miniFolded = stored();
  /** Layout-frame fit the density image is built with. */
  private fitting: MiniFit;
  /** Bounds and fit of the last drawn frame; held still while dragging so the map never slides under the pointer. */
  private miniShown: [MiniFrame, MiniFit];
  private miniHeld = false;
  private miniLast?: MiniState;
  private miniDrawn: unknown[] = [];
  private miniBuilt: unknown[] = [];
  /** Source the pending rebuild waits on; the timer restarts only when it changes again. */
  private miniWanted: unknown[] = [];
  private densityVersion = 0;
  private miniTimer?: ReturnType<typeof setTimeout>;
  constructor(parent: HTMLElement, private miniFrame: MiniFrame, private panCamera: (x: number, y: number) => void, private fitCamera: () => void, private miniChanged = () => {}) {
    const make = (tag: string, cls = '') => Object.assign(document.createElement(tag), { className: cls });
    this.root = parent.appendChild(make('div', 'graph-ng-minimap')); this.root.hidden = true; this.root.tabIndex = 0;
    this.root.setAttribute('role', 'group'); this.root.setAttribute('aria-label', 'Minimap. Arrow keys pan, Home fits all.');
    this.miniCanvas = this.root.appendChild(make('canvas') as HTMLCanvasElement); this.miniCanvas.setAttribute('aria-hidden', 'true');
    this.miniToggle = this.root.appendChild(make('button', 'clickable-icon graph-ng-minimap-toggle'));
    this.miniToggle.onclick = () => { this.miniFolded = !this.miniFolded; try { globalThis.localStorage?.setItem(STORE, this.miniFolded ? '1' : '0'); } catch { /* not persisted */ } this.paintToggle(); this.miniDrawn = []; this.miniChanged(); if (this.miniLast) this.update(this.miniLast); };
    this.densityCanvas = make('canvas') as HTMLCanvasElement;
    this.miniCanvas.width = this.densityCanvas.width = MINIMAP_W; this.miniCanvas.height = this.densityCanvas.height = MINIMAP_H;
    this.fitting = miniFit(miniFrame, MINIMAP_W, MINIMAP_H); this.miniShown = [miniFrame, this.fitting];
    const at = (e: PointerEvent) => { const r = this.miniCanvas.getBoundingClientRect(), k = MINIMAP_W / (r.width || MINIMAP_W), [b, m] = this.miniShown; this.panCamera(...toCamera(b, m, (e.clientX - r.left) * k, (e.clientY - r.top) * k, this.miniFrame)); };
    const release = (e: PointerEvent) => { if (this.miniCanvas.hasPointerCapture(e.pointerId)) this.miniCanvas.releasePointerCapture(e.pointerId); this.miniHeld = false; if (this.miniLast) this.update(this.miniLast); };
    this.miniCanvas.addEventListener('pointerdown', e => { if (e.button > 0) return; this.miniCanvas.setPointerCapture(e.pointerId); this.miniHeld = true; at(e); });
    this.miniCanvas.addEventListener('pointermove', e => { if (this.miniCanvas.hasPointerCapture(e.pointerId)) at(e); });
    this.miniCanvas.addEventListener('pointerup', release); this.miniCanvas.addEventListener('pointercancel', release);
    this.root.addEventListener('keydown', this.miniKey);
    this.paintToggle();
  }
  /** Collapsed to its corner button (the card then only keeps clear of the button). */
  get folded() { return this.miniFolded; }
  private paintToggle() {
    const label = this.miniFolded ? 'Show minimap' : 'Hide minimap';
    setIcon(this.miniToggle, this.miniFolded ? 'map' : 'minimize-2'); this.miniToggle.setAttribute('aria-label', label); this.miniToggle.title = label;
    this.miniToggle.setAttribute('aria-expanded', String(!this.miniFolded));
    this.root.className = 'graph-ng-minimap' + (this.miniFolded ? ' graph-ng-minimap-folded' : ''); this.miniCanvas.hidden = this.miniFolded;
  }
  private miniKey = (e: KeyboardEvent) => {
    const s = this.miniLast, d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (this.miniFolded) return;
    if (e.key === 'Home') this.fitCamera();
    else if (d && s) this.panCamera(s.cx + d[0]! * s.worldW / 4 / this.miniFrame.width, s.cy + d[1]! * s.worldH / 4 / this.miniFrame.height);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  /** Per frame: cheap key checks; the density image is rebuilt only after positions or the view settle,
   * and is only rescaled (one drawImage) when the drawn bounds follow the view. */
  update(s: MiniState) {
    this.miniLast = s; this.root.hidden = !s.on; if (!s.on) return;
    if (this.miniFolded) return;
    const source = [s.positions, s.visible, s.ink];
    // First build is immediate; later changes wait for positions to stop moving (a pan alone does not restart the wait).
    if (!this.miniBuilt.length) this.rebuildDensity(source);
    else if (source.some((x, i) => x !== this.miniBuilt[i]) && source.some((x, i) => x !== this.miniWanted[i])) {
      clearTimeout(this.miniTimer); this.miniWanted = source;
      this.miniTimer = setTimeout(() => { this.rebuildDensity([this.miniLast!.positions, this.miniLast!.visible, this.miniLast!.ink]); this.update(this.miniLast!); }, 250);
    }
    const key = [this.densityVersion, s.cx, s.cy, s.worldW, s.worldH, s.focus, s.directs, s.accent, s.ink, this.miniHeld];
    if (key.every((x, i) => x === this.miniDrawn[i])) return;
    this.miniDrawn = key;
    const ctx = this.miniCanvas.getContext('2d'); if (!ctx) return;
    const L = this.miniFrame, lf = this.fitting;
    if (!this.miniHeld) { const b = miniBounds(L, s.cx, s.cy, s.worldW, s.worldH); this.miniShown = [b, miniFit(b, MINIMAP_W, MINIMAP_H)]; }
    const [f, m] = this.miniShown, k = m.s / lf.s, [dx, dy] = toMini(f, m, L.minX - lf.ox / lf.s, L.minY - lf.oy / lf.s);
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H); ctx.drawImage(this.densityCanvas, dx, dy, MINIMAP_W * k, MINIMAP_H * k);
    // You are here: translucent accent fill, solid border; a deep zoom adds a crosshair to a minimum-size marker.
    const r = viewMarker(viewRect(f, m, s.cx, s.cy, s.worldW, s.worldH, L), MINIMAP_W, MINIMAP_H);
    ctx.strokeStyle = ctx.fillStyle = s.accent; ctx.lineWidth = 1.5;
    if (r.tiny) { ctx.globalAlpha = .45; ctx.beginPath(); ctx.moveTo(0, r.cy); ctx.lineTo(MINIMAP_W, r.cy); ctx.moveTo(r.cx, 0); ctx.lineTo(r.cx, MINIMAP_H); ctx.lineWidth = 1; ctx.stroke(); ctx.lineWidth = 1.5; }
    ctx.globalAlpha = .18; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.globalAlpha = 1; ctx.strokeRect(r.x, r.y, r.w, r.h);
    const dot = (n: number, size: number) => { const [x, y] = toMini(f, m, s.positions[n * 2]!, s.positions[n * 2 + 1]!); ctx.fillRect(x - size / 2, y - size / 2, size, size); return [x, y] as const; };
    ctx.globalAlpha = .8; for (let i = 0; i < Math.min(DOTS, s.directs.length); i++) dot(s.directs[i]!, 2.5);
    ctx.globalAlpha = 1;
    // The focus: an accent dot inside a ring in the theme's text colour, readable on light and dark.
    if (s.focus >= 0) { const [x, y] = dot(s.focus, 5); ctx.strokeStyle = s.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.stroke(); }
  }
  private rebuildDensity(source: unknown[]) {
    this.miniTimer = undefined; this.miniBuilt = this.miniWanted = source; this.densityVersion++;
    const s = this.miniLast!, ctx = this.densityCanvas.getContext('2d'), image = ctx?.createImageData?.(MINIMAP_W, MINIMAP_H);
    if (!ctx || !image?.data) return;
    const grid = densityGrid(s.positions, s.visible, this.miniFrame, this.fitting, MINIMAP_W, MINIMAP_H);
    let max = 1; for (const c of grid) if (c > max) max = c;
    // Alpha-only density (square-root scaled so sparse areas stay visible), then tinted with the theme ink.
    for (let i = 0; i < grid.length; i++) image.data[i * 4 + 3] = grid[i] ? 50 + 160 * Math.sqrt(grid[i]! / max) : 0;
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H); ctx.putImageData(image, 0, 0);
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = s.ink; ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H); ctx.globalCompositeOperation = 'source-over';
  }
  dispose() { clearTimeout(this.miniTimer); this.root.removeEventListener('keydown', this.miniKey); this.root.remove(); }
}
