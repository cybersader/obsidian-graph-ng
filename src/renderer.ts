import type { GroupProjection } from './core/group-projection';
import type { Settings } from './settings';
import { readTheme } from './render-theme';
export { DetailRenderer } from './webgl-renderer';
export interface Renderer { dispose(): void; refreshTheme?(): void }
export function gpuStatus(): { available: boolean; reason: string } {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  if (!gl) return { available: false, reason: 'WebGL2 unavailable or major performance caveat' };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const software = /swiftshader|llvmpipe|softpipe|software|swrast/i.test(name);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { available: !software, reason: software ? `Software renderer (${name})` : name };
}
type Point = { x: number; y: number };
interface Hit { edge: GroupProjection['groupEdges'][number]; points: Point[] }
/** Small, first-class group graph. No WebGL, ontology or body parsing needed. */
export class GroupRenderer implements Renderer {
  private canvas: HTMLCanvasElement;
  private tooltip: HTMLElement;
  private observer: ResizeObserver;
  private nodes = new Map<string, Point>();
  private edges: Hit[] = [];
  private groupColors: string[] = [];
  private media = matchMedia('(prefers-color-scheme: dark)');
  private base: Settings;
  constructor(private container: HTMLElement, private p: GroupProjection, private s: Settings,
    private onGroup: (id: string) => void, private onEdge: (edge: GroupProjection['groupEdges'][number]) => void) {
    this.base = s; this.refreshTheme();
    this.media.addEventListener('change', this.refreshTheme);
    this.canvas = document.createElement('canvas'); this.canvas.className = 'graph-ng-groups'; this.canvas.setAttribute('aria-label', 'Declared groups and counted relationships'); container.append(this.canvas);
    this.tooltip = document.createElement('div'); this.tooltip.className = 'graph-ng-tooltip'; container.append(this.tooltip);
    this.canvas.addEventListener('click', this.click);
    this.canvas.addEventListener('mousemove', this.hover);
    this.canvas.addEventListener('mouseleave', this.leave);
    this.observer = new ResizeObserver(() => this.draw()); this.observer.observe(container); this.draw();
  }
  refreshTheme = () => { const t = readTheme(this.container, this.base); this.groupColors = this.base.declaration.colors.map((_, i) => { const k = (i + 5) * 4, p = t.palette; return `rgba(${p[k]},${p[k+1]},${p[k+2]},${p[k+3]! / 255})`; }); this.s = { ...this.s, backgroundColor: t.background, nodeColor: t.node, edgeColor: t.edge, groupColor: t.group, textColor: t.text }; if (this.canvas) this.draw(); };
  private point(event: MouseEvent) { const r = this.canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  private nodeAt(point: Point) { return this.p.groups.find(g => { const n = this.nodes.get(g.id)!; return Math.hypot(n.x - point.x, n.y - point.y) <= this.s.groupRadius; }); }
  private edgeAt(point: Point) {
    return this.edges.find(e => e.points.some((p, i) => { if (!i) return false; const q = e.points[i - 1]!, dx = p.x - q.x, dy = p.y - q.y; const t = Math.max(0, Math.min(1, ((point.x - q.x) * dx + (point.y - q.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(point.x - q.x - t * dx, point.y - q.y - t * dy) <= this.s.groupEdgeHitRadius; }));
  }
  private click = (e: MouseEvent) => { const p = this.point(e), g = this.nodeAt(p); if (g) this.onGroup(g.id); else { const edge = this.edgeAt(p); if (edge) this.onEdge(edge.edge); } };
  private hover = (e: MouseEvent) => {
    const p = this.point(e), g = this.nodeAt(p), edge = this.edgeAt(p);
    this.tooltip.textContent = g ? `${g.label}: ${g.count.toLocaleString()} members` : edge ? `${this.p.groups.find(g => g.id === edge.edge.a)?.label} ↔ ${this.p.groups.find(g => g.id === edge.edge.b)?.label}: ${Object.entries(edge.edge.typeCounts).map(([t, n]) => `${t}: ${n.toLocaleString()}`).join(', ')}` : '';
    this.tooltip.style.left = `${p.x + 10}px`; this.tooltip.style.top = `${p.y + 10}px`;
    this.canvas.style.cursor = g || edge ? 'pointer' : 'default';
  };
  private leave = () => { this.tooltip.textContent = ''; };
  private draw() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr; this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    const ctx = this.canvas.getContext('2d'); if (!ctx) { this.container.textContent = 'Canvas unavailable. Use the group list below.'; return; }
    ctx.scale(dpr, dpr); ctx.fillStyle = this.s.backgroundColor; ctx.fillRect(0, 0, w, h);
    this.nodes.clear(); this.edges = [];
    const radius = Math.max(0, Math.min(w, h) / 2 - this.s.groupRadius - this.s.groupRingPadding);
    this.p.groups.forEach((g, i) => {
      const angle = i / Math.max(1, this.p.groups.length) * Math.PI * 2 - Math.PI / 2;
      const columns = Math.ceil(Math.sqrt(this.p.groups.length)), rows = Math.ceil(this.p.groups.length / columns);
      this.nodes.set(g.id, h < 420 || this.p.groups.length > 8 ? { x: (i % columns + 0.5) * w / columns, y: (Math.floor(i / columns) + 0.5) * h / rows - this.s.labelSize } : { x: w / 2 + Math.cos(angle) * radius, y: h / 2 + Math.sin(angle) * radius });
    });
    const reserved = [...this.nodes.values()].map(p => ({ x: p.x - this.s.groupRadius - 4, y: p.y - this.s.groupRadius - 4, w: this.s.groupRadius * 2 + 8, h: this.s.groupRadius * 2 + this.s.labelSize * 3 + 12 }));
    const edgeLabels: { text: string; x: number; box: { x: number; y: number; w: number; h: number } }[] = [];
    for (const edge of this.p.groupEdges) {
      const a = this.nodes.get(edge.a), b = this.nodes.get(edge.b); if (!a || !b) continue;
      const weight = Object.values(edge.typeCounts).reduce((x, y) => x + y, 0), points: Point[] = [];
      const cx = (a.x + b.x) / 2 - (b.y - a.y) / this.s.groupCurveDivisor, cy = (a.y + b.y) / 2 + (b.x - a.x) / this.s.groupCurveDivisor;
      ctx.beginPath();
      for (let j = 0; j <= this.s.groupCurveSamples; j++) { const t = j / this.s.groupCurveSamples; const p = edge.a === edge.b ? { x: a.x + Math.sin(t * Math.PI * 2) * this.s.groupRadius * this.s.groupLoopScale, y: a.y - this.s.groupRadius + (Math.cos(t * Math.PI * 2) - 1) * this.s.groupRadius } : { x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y }; points.push(p); if (!j) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
      ctx.strokeStyle = this.s.edgeColor; ctx.lineWidth = this.s.edgeWidthScale * Math.max(1, Math.log2(weight + 1)); ctx.stroke();
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
    for (const label of edgeLabels) {
      ctx.fillStyle = this.s.backgroundColor; ctx.fillRect(label.box.x, label.box.y, label.box.w, label.box.h);
      ctx.fillStyle = this.s.textColor; ctx.fillText(label.text, label.x, label.box.y + this.s.labelSize);
    }
    for (const g of this.p.groups) {
      const p = this.nodes.get(g.id)!;
      ctx.beginPath(); ctx.arc(p.x, p.y, this.s.groupRadius, 0, Math.PI * 2); ctx.fillStyle = this.groupColors[this.s.declaration.colors.findIndex(c => c.name === g.label)] ?? this.s.groupColor; ctx.fill();
      ctx.font = `600 ${this.s.labelSize}px sans-serif`; ctx.textAlign = 'center';
      const countLabel = `${g.count.toLocaleString()} members`, maxWidth = Math.min(180, w / Math.max(2, Math.ceil(Math.sqrt(this.p.groups.length))) - 12);
      let title = g.label; while (title.length > 1 && ctx.measureText(title + '…').width > maxWidth) title = title.slice(0, -1);
      if (title !== g.label) title += '…';
      const labelWidth = Math.max(ctx.measureText(title).width, ctx.measureText(countLabel).width);
      ctx.fillStyle = this.s.backgroundColor; ctx.fillRect(p.x - labelWidth / 2 - 4, p.y + this.s.groupRadius + 4, labelWidth + 8, this.s.labelSize * 3);
      ctx.fillStyle = this.s.textColor; ctx.fillText(title, p.x, p.y + this.s.groupRadius + this.s.labelSize * 1.5);
      ctx.font = `${this.s.labelSize}px sans-serif`; ctx.fillText(countLabel, p.x, p.y + this.s.groupRadius + this.s.labelSize * 2.8);
    }
  }
  dispose() { this.media.removeEventListener('change', this.refreshTheme); this.observer.disconnect(); this.canvas.removeEventListener('click', this.click); this.canvas.removeEventListener('mousemove', this.hover); this.canvas.removeEventListener('mouseleave', this.leave); this.canvas.remove(); this.tooltip.remove(); }
}
