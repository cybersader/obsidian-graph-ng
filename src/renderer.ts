import { probeGpu } from './gpu-probe';
import { edgeAlpha } from './render-effects';
import { segmentDistance } from './render-data';
import type { GroupProjection } from './core/group-projection';
import type { Settings } from './settings';
import { readTheme } from './render-theme';
export { DetailRenderer, type RenderView } from './webgl-renderer';
export interface Renderer { dispose(): void; refreshTheme?(): void; syncTools?(): void }
export function gpuStatus(): { available: boolean; reason: string } {
  return probeGpu(document.createElement('canvas'));
}

type Point = { x: number; y: number };
interface Hit { edge: GroupProjection['groupEdges'][number]; points: Point[] }
/** Small, first-class group graph. No WebGL, ontology or body parsing needed. */
export class GroupRenderer implements Renderer {
  private canvas: HTMLCanvasElement;
  private tooltip: HTMLElement;
  private observer: ResizeObserver;
  private nodes = new Map<string, Point>();
  private radii = new Map<string, number>();
  private edges: Hit[] = [];
  private groupColors: string[] = [];
  private media = matchMedia('(prefers-color-scheme: dark)');
  private base: Settings;
  constructor(private container: HTMLElement, private p: GroupProjection, private s: Settings,
    private onGroup: (id: string) => void, private onEdge: (edge: GroupProjection['groupEdges'][number]) => void, private colorOf?: (id: string) => string, private ring?: string, private measureTools = () => 0, private largest = Math.max(1, ...p.groups.map(g => g.count)), private display = (label: string) => label) {
    this.base = s; this.refreshTheme();
    this.media.addEventListener('change', this.refreshTheme);
    this.canvas = document.createElement('canvas'); this.canvas.className = 'graph-ng-groups'; this.canvas.setAttribute('aria-label', 'Declared groups and counted relationships'); container.append(this.canvas);
    this.tooltip = document.createElement('div'); this.tooltip.className = 'graph-ng-tooltip'; container.append(this.tooltip);
    this.canvas.addEventListener('click', this.click);
    this.canvas.addEventListener('mousemove', this.hover);
    this.canvas.addEventListener('mouseleave', this.leave);
    this.observer = new ResizeObserver(() => { this.syncTools(); this.draw(); }); this.observer.observe(container); this.observer.observe(this.canvas); this.syncTools(); this.draw();
  }
  /** Opening snaps clear of the panel; closing expands briefly, with no idle draw loop. */
  syncTools() {
    const width = Math.max(0, this.container.clientWidth - this.measureTools()), old = parseFloat(this.canvas.style.width) || 0;
    if (width === old) return;
    this.canvas.style.transition = width > old && this.base.visuals.motion === 'full' && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'width 180ms ease-out' : 'none';
    this.canvas.style.width = `${width}px`; this.container.style.setProperty('--gng-group-width', `${width}px`);
  }
  refreshTheme = () => { const t = readTheme(this.container, this.base); this.groupColors = this.base.declaration.colors.map((_, i) => { const k = (i + 5) * 4, p = t.palette; return `rgba(${p[k]},${p[k+1]},${p[k+2]},${p[k+3]! / 255})`; }); this.s = { ...this.s, backgroundColor: t.background, nodeColor: t.node, edgeColor: t.edge, groupColor: t.group, textColor: t.text, labelSize: parseFloat(getComputedStyle(this.container).fontSize) || this.base.labelSize }; if (this.canvas) this.draw(); };
  private point(event: MouseEvent) { const r = this.canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  private nodeAt(point: Point) { return this.p.groups.find(g => { const n = this.nodes.get(g.id)!; return Math.hypot(n.x - point.x, n.y - point.y) <= Math.max(12, this.radii.get(g.id) ?? this.s.groupRadius) || Math.abs(n.x - point.x) < 80 && point.y > n.y && point.y < n.y + this.s.groupRadius * 1.5 + this.s.labelSize * 3; }); }
  private edgeAt(point: Point) {
    return this.edges.find(e => e.points.some((p, i) => { if (!i) return false; const q = e.points[i - 1]!; return segmentDistance(point.x, point.y, q.x, q.y, p.x, p.y) <= this.s.groupEdgeHitRadius; }));
  }
  private click = (e: MouseEvent) => { const p = this.point(e), g = this.nodeAt(p); if (g) this.onGroup(g.id); else { const edge = this.edgeAt(p); if (edge) this.onEdge(edge.edge); } };
  private hover = (e: MouseEvent) => {
    const p = this.point(e), g = this.nodeAt(p), edge = this.edgeAt(p);
    this.tooltip.textContent = g ? `${this.display(g.label)}: ${g.count.toLocaleString()} members` : edge ? `${this.display(this.p.groups.find(g => g.id === edge.edge.a)!.label)} ↔ ${this.display(this.p.groups.find(g => g.id === edge.edge.b)!.label)}: ${Object.entries(edge.edge.typeCounts).map(([t, n]) => `${t}: ${n.toLocaleString()}`).join(', ')}` : '';
    this.tooltip.style.left = `${Math.max(8, Math.min(p.x + 10, this.canvas.clientWidth - this.tooltip.offsetWidth - 8))}px`; this.tooltip.style.top = `${Math.max(8, Math.min(p.y + 10, this.container.clientHeight - this.tooltip.offsetHeight - 8))}px`;
    this.canvas.style.cursor = g || edge ? 'pointer' : 'default';
  };
  private leave = () => { this.tooltip.textContent = ''; };
  private draw() {
    const w = this.canvas.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr; this.canvas.style.height = `${h}px`;
    const ctx = this.canvas.getContext('2d'); if (!ctx) { this.container.textContent = 'Canvas unavailable. Use group member lists.'; return; }
    ctx.scale(dpr, dpr); ctx.fillStyle = this.s.backgroundColor; ctx.fillRect(0, 0, w, h);
    this.nodes.clear(); this.edges = []; this.radii.clear();
    // Bubble area follows member count, with a minimum visible/clickable mark.
    const columns = Math.min(this.p.groups.length, Math.max(1, Math.floor(w / 170))), rows = Math.ceil(this.p.groups.length / columns);
    const cellHeight = Math.max(1, (h - 180) / Math.max(1, rows)), maxRadius = Math.max(5, Math.min(this.s.groupRadius * 1.5, cellHeight / 2 - this.s.labelSize * 2));
    for (const g of this.p.groups) this.radii.set(g.id, Math.max(5, maxRadius * Math.sqrt(g.count / Math.max(1, this.largest))));
    const fills = new Map(this.p.groups.map(g => [g.id, this.groupColors[this.s.declaration.colors.findIndex(c => c.name === g.label)] ?? this.colorOf?.(g.id) ?? this.s.groupColor]));
    const bg = this.s.backgroundColor, dark = /^#/.test(bg) ? Number.parseInt(bg.slice(1, 3), 16) + Number.parseInt(bg.slice(3, 5), 16) + Number.parseInt(bg.slice(5, 7), 16) < 384 : true;
    this.p.groups.forEach((g, i) => {
      this.nodes.set(g.id, { x: (i % columns + 0.5) * w / columns, y: 72 + (Math.floor(i / columns) + 0.5) * cellHeight - this.s.labelSize });
    });
    const reserved = [...this.nodes.values()].map(p => ({ x: p.x - this.s.groupRadius - 4, y: p.y - this.s.groupRadius - 4, w: this.s.groupRadius * 2 + 8, h: this.s.groupRadius * 2 + this.s.labelSize * 3 + 12 }));
    const edgeLabels: { text: string; x: number; box: { x: number; y: number; w: number; h: number } }[] = [];
    for (const edge of this.p.groupEdges) {
      const a = this.nodes.get(edge.a), b = this.nodes.get(edge.b); if (!a || !b) continue;
      const weight = Object.values(edge.typeCounts).reduce((x, y) => x + y, 0), points: Point[] = [];
      const cx = (a.x + b.x) / 2 - (b.y - a.y) / this.s.groupCurveDivisor, cy = (a.y + b.y) / 2 + (b.x - a.x) / this.s.groupCurveDivisor;
      ctx.beginPath();
      for (let j = 0; j <= this.s.groupCurveSamples; j++) { const t = j / this.s.groupCurveSamples; const p = edge.a === edge.b ? { x: a.x + Math.sin(t * Math.PI * 2) * this.s.groupRadius * this.s.groupLoopScale, y: a.y - this.s.groupRadius + (Math.cos(t * Math.PI * 2) - 1) * this.s.groupRadius } : { x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y }; points.push(p); if (!j) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
      // Endpoint-tinted, translucent relationship ribbons; counts stay in the label pass.
      const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y); gradient.addColorStop(0, fills.get(edge.a)!); gradient.addColorStop(1, fills.get(edge.b)!);
      ctx.globalAlpha = edgeAlpha(this.s.visuals, this.p.groupEdges.length, 1, false); ctx.strokeStyle = this.s.visuals.edgeColorMix > 0 ? gradient : this.s.edgeColor; ctx.lineWidth = this.s.edgeWidthScale * Math.max(1, Math.log2(weight + 1)); ctx.lineCap = 'round'; if (this.s.visuals.edgeOpacity > 0) ctx.stroke(); ctx.globalAlpha = 1;
      ctx.font = `${this.s.labelSize}px sans-serif`; ctx.textAlign = 'center';
      const label = weight.toLocaleString(), textWidth = ctx.measureText(label).width;
      const candidates = [0.5, 0.35, 0.65, 0.2, 0.8].map(t => points[Math.floor(this.s.groupCurveSamples * t)]!);
      for (const mid of candidates) {
        const box = { x: mid.x - textWidth / 2 - 3, y: Math.max(3, mid.y - this.s.labelSize), w: textWidth + 6, h: this.s.labelSize + 5 };
        if (box.x < 0 || box.x + box.w > w || box.y + box.h > h || reserved.some(r => box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y)) continue;
        edgeLabels.push({ text: label, x: mid.x, box }); reserved.push(box); break;
      }
      this.edges.push({ edge, points });
    }
    // Labels are a separate final pass, so later paths cannot strike through earlier counts.
    ctx.font = `${this.s.labelSize}px sans-serif`; ctx.textAlign = 'center';
    for (const label of this.s.visuals.edgeOpacity > 0 ? edgeLabels : []) {
      ctx.fillStyle = this.s.backgroundColor; ctx.fillRect(label.box.x, label.box.y, label.box.w, label.box.h);
      ctx.fillStyle = this.s.textColor; ctx.fillText(label.text, label.x, label.box.y + this.s.labelSize);
    }
    for (const g of this.p.groups) {
      const p = this.nodes.get(g.id)!;
      const r = this.radii.get(g.id)!, fill = fills.get(g.id)!;
      ctx.save(); if (dark && this.s.visuals.glow > 0) { ctx.shadowColor = fill; ctx.shadowBlur = 28 * this.s.visuals.glow; }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.restore();
      // The group of the focus you came from (Back to chip).
      if (g.id === this.ring) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.strokeStyle = this.s.textColor; ctx.lineWidth = 3; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(p.x, p.y, r - 1.5, 0, Math.PI * 2); ctx.strokeStyle = bg; ctx.globalAlpha = .35; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.font = `600 ${this.s.labelSize}px sans-serif`; ctx.textAlign = 'center';
      const countLabel = `${g.count.toLocaleString()} members`, maxWidth = Math.min(220, w / Math.max(1, columns) - 16);
      const full = this.display(g.label); let title = full, length = Math.min(80, title.length);
      while (length > 2 && ctx.measureText(title).width > maxWidth) { length--; title = full.slice(0, Math.ceil(length / 2)) + '…' + full.slice(-Math.floor(length / 2)); }
      const labelWidth = Math.max(ctx.measureText(title).width, ctx.measureText(countLabel).width);
      ctx.fillStyle = this.s.backgroundColor; ctx.fillRect(p.x - labelWidth / 2 - 4, p.y + maxRadius + 4, labelWidth + 8, this.s.labelSize * 3);
      ctx.fillStyle = this.s.textColor; ctx.fillText(title, p.x, p.y + maxRadius + this.s.labelSize * 1.5);
      ctx.font = `${this.s.labelSize}px sans-serif`; ctx.fillText(countLabel, p.x, p.y + maxRadius + this.s.labelSize * 2.8);
    }
  }
  dispose() { this.media.removeEventListener('change', this.refreshTheme); this.observer.disconnect(); this.canvas.removeEventListener('click', this.click); this.canvas.removeEventListener('mousemove', this.hover); this.canvas.removeEventListener('mouseleave', this.leave); this.canvas.remove(); this.tooltip.remove(); }
}
