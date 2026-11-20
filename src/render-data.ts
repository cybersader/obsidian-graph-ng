import type { Projection } from './core/projection';

/** Adaptive CSS-pixel radius: never magnify an already legible dot. Fan-out spends emphasis
 * on contrast instead of disc area. Hover keeps its easing, with at most one pixel beyond its target.
 * Mirrors the node shader; budget is computed once per draw from cached direct connections. */
export function adaptiveRadius(radius: number, g: number, ego: boolean, focus: number, minSize: number, budget: number, pulse: number): number {
  const target = ego ? Math.max(7, minSize) : minSize * (.55 + .45 * budget) * (g > .9 ? 1 : g > .7 ? .75 : g > .4 ? .57 : 0);
  radius += Math.max(0, target - radius) * focus;
  return Math.max(radius, Math.max(5, minSize) * pulse) + pulse;
}

/** A loading picture needs validated world bounds but no hit-test bins. */
export class PositionBounds {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  constructor(readonly positions: Float32Array, readonly visible: Uint8Array, validateHidden = true) {
    if (positions.length !== visible.length * 2) throw new Error('RENDER_POSITION_COUNT');
    let x = Infinity, y = Infinity, xx = -Infinity, yy = -Infinity;
    for (let i = 0; i < visible.length; i++) if (validateHidden || visible[i]) {
      const a = positions[i * 2]!, b = positions[i * 2 + 1]!;
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('RENDER_NONFINITE_POSITION');
      if (!visible[i]) continue;
      x = Math.min(x, a); y = Math.min(y, b); xx = Math.max(xx, a); yy = Math.max(yy, b);
    }
    this.minX = x === Infinity ? 0 : x; this.minY = y === Infinity ? 0 : y;
    this.width = Math.max(1, xx - this.minX); this.height = Math.max(1, yy - this.minY);
  }
}
/** Packed grid: one link per node, no objects/strings per node or pointer query. */
export class PickGrid extends PositionBounds {
  readonly heads: Int32Array;
  readonly next: Int32Array;
  readonly columns: number;
  readonly rows: number;
  readonly cell: number;
  constructor(positions: Float32Array, visible: Uint8Array) {
    super(positions, visible, false);
    this.cell = Math.max(this.width, this.height) / Math.max(1, Math.ceil(Math.sqrt(visible.length / 8)));
    this.columns = Math.ceil(this.width / this.cell) + 1; this.rows = Math.ceil(this.height / this.cell) + 1;
    this.heads = new Int32Array(this.columns * this.rows).fill(-1); this.next = new Int32Array(visible.length).fill(-1);
    for (let i = 0; i < visible.length; i++) if (visible[i]) {
      const k = Math.floor((positions[i * 2]! - this.minX) / this.cell) + Math.floor((positions[i * 2 + 1]! - this.minY) / this.cell) * this.columns;
      this.next[i] = this.heads[k]!; this.heads[k] = i;
    }
  }
  visit(x: number, y: number, radius: number, visit: (id: number) => void) {
    const a = Math.max(0, Math.floor((x - radius - this.minX) / this.cell)), b = Math.min(this.columns - 1, Math.floor((x + radius - this.minX) / this.cell));
    const c = Math.max(0, Math.floor((y - radius - this.minY) / this.cell)), d = Math.min(this.rows - 1, Math.floor((y + radius - this.minY) / this.cell));
    for (let row = c; row <= d; row++) for (let col = a; col <= b; col++) for (let i = this.heads[row * this.columns + col]!; i !== -1; i = this.next[i]!) visit(i);
  }
  pick(x: number, y: number, radius: number, skip?: ArrayLike<number>): number {
    let best = -1, distance = radius * radius;
    this.visit(x, y, radius, i => { if (skip?.[i]) return; const dx = this.positions[i * 2]! - x, dy = this.positions[i * 2 + 1]! - y, dd = dx * dx + dy * dy; if (dd <= distance && (dd < distance || best < 0 || i < best)) { best = i; distance = dd; } });
    return best;
  }
}
export function positionTexture(positions: Float32Array, maxWidth = 2048) {
  const width = Math.max(1, Math.min(maxWidth, positions.length / 2)), height = Math.max(1, Math.ceil(positions.length / 2 / width));
  const data = positions.length === width * height * 2 ? positions : new Float32Array(width * height * 2);
  if (data !== positions) data.set(positions);
  return { width, height, data };
}
export function incidentEdges(p: Pick<Projection, 'paths' | 'source' | 'target'> | { nodeCount: number; source: Uint32Array; target: Uint32Array }) {
  const offsets = new Uint32Array(('nodeCount' in p ? p.nodeCount : p.paths.length) + 1);
  for (let e = 0; e < p.source.length; e++) { offsets[p.source[e]! + 1]!++; offsets[p.target[e]! + 1]!++; }
  for (let i = 1; i < offsets.length; i++) offsets[i]! += offsets[i - 1]!;
  const edges = new Uint32Array(p.source.length * 2), cursor = offsets.slice();
  for (let e = 0; e < p.source.length; e++) { edges[cursor[p.source[e]!]!++] = e; edges[cursor[p.target[e]!]!++] = e; }
  return { offsets, edges };
}
/** Graduated focus, presentation only. Node tiers go in the G byte of the RGBA `state` with explicit
 * precedence focus = direct (255) > ancestor (192) > 2-hop (128) > same group (64) > context (0):
 * direct is the minimum hop over type-visible (`on`) edges between filter-visible (`vis`) nodes;
 * ancestors follow the declared hierarchy `p.up` from the focus (at most 8 levels and 256 notes,
 * cycle-safe; hidden ancestors are passed through, not lit), lighting the child-parent edge;
 * 2-hop extends direct; same group marks other members of the focus's `codes` group, at most
 * 4096 marked and `max * 4` scanned. An edge note's own relationship rows are transparent, so a
 * reified mapping keeps its far endpoint direct (and stays lit at hop 2). Edge bytes are 255
 * (focus-incident) or 128, minus 1 when `p.tint` marks the edge's rule (254/127: tinted layer,
 * same weight). Hop 1 is complete; ancestor and hop-2 scans share `max` incident entries.
 * Returns truncation bits: 1 hop/ancestor scan, 2 same group. Only the appended `nodes`/`edges`
 * are written, so callers clear by those lists, never by a rescan. */
export function focusTiers(f: number, inc: { offsets: Uint32Array; edges: Uint32Array }, p: Pick<Projection, 'source' | 'target' | 'carrier' | 'carrierNodes' | 'up' | 'tint'>, on: ArrayLike<number>, vis: ArrayLike<number>, state: Uint8Array, edge: Uint8Array, nodes: number[], edges: number[], max = 65536, codes?: ArrayLike<number>) {
  let budget = Infinity, cut = 0;
  const tier = (i: number) => state[i * 4 + 1]! > 200, own = (e: number, c: number) => !!p.carrierNodes[c] && p.carrier[e]! + 1 === p.carrierNodes[c];
  const mark = (v: number, m: number) => { if (!state[v * 4 + 1]) { state[v * 4 + 1] = m; nodes.push(v); return 1; } };
  const lit = (e: number, m: number) => { if (!edge[e]) { edge[e] = m - (p.tint?.[e] ?? 0); edges.push(e); } };
  const grow = (from: number[], m: number) => {
    const out: number[] = [], scan = (u: number, carrier?: boolean) => {
      for (let j = inc.offsets[u]!; j < inc.offsets[u + 1]! && budget-- > 0; j++) {
        const e = inc.edges[j]!, v = p.source[e] === u ? p.target[e]! : p.source[e]!;
        if (!on[e] || !vis[v] || carrier && !own(e, u)) continue;
        if (mark(v, m)) out.push(v);
        const a = tier(u), b = tier(v);
        if (a || b || carrier) lit(e, a && b && (u === f || v === f || own(e, u) || own(e, v)) ? 255 : 128);
      }
    };
    for (const u of from) scan(u);
    for (let i = 0; i < out.length; i++) if (p.carrierNodes[out[i]!]) scan(out[i]!, true);
    return out;
  };
  if (f < 0 || !vis[f]) return 0;
  state[f * 4 + 1] = 255; nodes.push(f);
  const direct = grow([f], 255), up = p.up; budget = max;
  if (up) for (let from = [f], seen = new Set(from), d = 0; d < 8 && from.length; d++) {
    const next: number[] = [];
    for (const u of from) for (let j = up.offsets[u]!; j < up.offsets[u + 1]! && seen.size < 256; j++) {
      const v = up.targets[j]!; if (seen.has(v)) continue; seen.add(v); next.push(v);
      if (!vis[v]) continue; mark(v, 192);
      if (vis[u]) for (let k = inc.offsets[u]!; k < inc.offsets[u + 1]! && budget-- > 0; k++) { const e = inc.edges[k]!; if (on[e] && (p.source[e] === v || p.target[e] === v)) lit(e, 128); }
    }
    from = next;
  }
  grow(direct, 128); if (budget < 0) cut = 1;
  if (codes) for (let i = 0, c = codes[f], n = 0; i < codes.length; i++) {
    if (i >= max * 4) { cut |= 2; break; }
    if (codes[i] === c && vis[i] && !state[i * 4 + 1]) { if (n++ >= 4096) { cut |= 2; break; } mark(i, 64); }
  }
  return cut;
}
/** Tinted edge layer (254 or 127): drawn at its tier's weight with the accent mixed in by `f / 2`. */
export const tintedEdge = (t: number) => t === 254 || t === 127;
/** Path tier edge byte: a found path's rows, drawn above every focus tier and never legend-masked. */
export const PATH_EDGE = 253;
/** Path stroke from the direct-tier [alpha]: near-opaque accent and 2.5x width at full focus `f` (the shader's 253 branch). */
export const pathStroke = (alpha: number, f: number) => [alpha + (1 - alpha) * f, 1 + 1.5 * f] as const;
/** Edge tier bucket for the Canvas passes: 255 focus-incident, 128 lit, 0 context. */
export const edgeBucket = (t: number) => t > 200 ? 255 : t ? 128 : 0;
/** Graduated tier styling for Canvas; the shaders write the same expressions (tests compare both).
 * `g` is the node tier byte / 255 and `f` the eased focus level. Node: [alpha factor, radius
 * factor, ring coverage]: the focus grows 60% and gains a ring, direct notes grow 25% at full
 * alpha, 2-hop notes sit halfway to the dim opacity, context reaches it. */
export const tierNode = (g: number, hot: boolean, isFocus: boolean, f: number, dim: number) => [hot ? 1 : 1 - (1 - dim) * f * (1 - g), 1 + f * (isFocus ? .6 : g > .9 ? .25 : 0), isFocus ? f : 0] as const;
/** Edge: [alpha, width factor]. Focus-incident strokes triple (capped at 1) and widen 60%, 2-hop
 * strokes keep the base alpha, context strokes fade to 60% of the dim opacity. */
export const tierEdge = (tier: number, a: number, f: number, dim: number) => [a + ((tier > 200 ? Math.min(1, a * 3) : tier ? a : a * dim * .6) - a) * f, 1 + f * (tier > 200 ? .6 : 0)] as const;
/** Atlas label alpha: tiered notes hand over to the graduated focus labels; context labels fade to
 * half the dim opacity. */
export const tierLabel = (g: number, a: number, f: number, dim: number) => a + ((g > .1 ? 0 : a * dim * .5) - a) * f;
/** Legend tiers in precedence order with their state bytes; the mask bit is 1 << index. */
export const TIERS = [['Direct connections', 255], ['Ancestors', 192], ['Neighbours of neighbours', 128], ['Same group', 64]] as const;
export const ALL_TIERS = 15;
/** The tier byte as drawn: a tier switched off in the legend draws as context. The focus is never masked. */
export const shownTier = (byte: number, mask: number, isFocus = false) => isFocus ? byte : byte === 255 ? (mask & 1 ? byte : 0) : byte === 192 ? (mask & 2 ? byte : 0) : byte === 128 ? (mask & 4 ? byte : 0) : byte === 64 ? (mask & 8 ? byte : 0) : byte;
/** Edge bytes: focus-incident (254/255) follow direct, lit (127/128) follow neighbours of neighbours. */
export const shownEdgeTier = (t: number, mask: number) => t > 200 ? (mask & 1 ? t : 0) : t ? (mask & 4 ? t : 0) : 0;
/** Per-tier counts for the legend from the touched list only (O(cloud), once per focus change).
 * The focus and edge notes are not counted. */
export function tierCounts(focus: number, nodes: readonly number[], state: Uint8Array, notes?: ArrayLike<number>) {
  const out = [0, 0, 0, 0];
  for (const n of nodes) { if (n === focus || notes?.[n]) continue; const i = TIERS.findIndex(t => t[1] === state[n * 4 + 1]); if (i >= 0) out[i]!++; }
  return out;
}
/** Screen-space floor (CSS px) for a tier at eased focus `f`: the focus and direct connections
 * reach `px`, ancestors 75%, neighbours of neighbours 57% (7 px gives 4 px), others none. */
export const tierLift = (g: number, isFocus: boolean, f: number, px: number) => px * f * (isFocus || g > .9 ? 1 : g > .7 ? .75 : g > .4 ? .57 : 0);
/** Smooth minimum radius: unchanged at or above 2 * lift, never below lift, C1-continuous between. */
export const liftRadius = (r: number, lift: number) => lift > 0 && r < 2 * lift ? lift + r * r / (4 * lift) : r;
/** Strong focus edges: a continuous degree-scaled target (at least .18), no hub cutoff.
 * A uniform fan replaces the extra direction ramp; the explicit direction setting is independent. */
export const focusAlpha = (degree: number) => Math.max(.18, .95 / Math.sqrt(Math.max(1, degree / 24)));
export const strongEdge = (tier: number, alpha: number, f: number, target = .95) => [tier > 200 ? alpha + ((alpha > 0 ? target : 0) - alpha) * f : alpha * (1 - f * (tier ? .5 : .65)), 1 + f * (tier > 200 ? .6 : 0)] as const;
export interface Pip { x: number; y: number; sector: number; count: number; node: number }
/** Off-screen indicators: points outside the w × h viewport are binned into `sectors` directions
 * around its centre; each bin yields one pip on the inset border along the ray to its nearest
 * point, with the count. `xy` holds screen coordinates for `ids`. O(ids). */
export function offscreenPips(ids: ArrayLike<number>, xy: ArrayLike<number>, w: number, h: number, inset: number, sectors = 8): Pip[] {
  const cx = w / 2, cy = h / 2, best = new Float64Array(sectors).fill(Infinity), pips: (Pip | undefined)[] = [];
  for (let i = 0; i < ids.length; i++) {
    const x = xy[i * 2]!, y = xy[i * 2 + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x >= 0 && x <= w && y >= 0 && y <= h) continue;
    const dx = x - cx, dy = y - cy, s = ((Math.round(Math.atan2(dy, dx) / (2 * Math.PI) * sectors) % sectors) + sectors) % sectors, d = dx * dx + dy * dy;
    const t = Math.min(Math.max(0, cx - inset) / (Math.abs(dx) || 1e-9), Math.max(0, cy - inset) / (Math.abs(dy) || 1e-9));
    const pip = pips[s] ??= { x: 0, y: 0, sector: s, count: 0, node: -1 }; pip.count++;
    if (d < best[s]!) { best[s] = d; pip.node = ids[i]!; pip.x = cx + dx * t; pip.y = cy + dy * t; }
  }
  return pips.filter((p): p is Pip => !!p);
}
export const PIP_DIRECTIONS = ['right', 'lower right', 'below', 'lower left', 'left', 'upper left', 'above', 'upper right'] as const;
/** Exact 2-D rank sampling: order by class and x; each aligned power-of-two x span
 * also has a y order. Two binary searches on y trim a span even at a crowded boundary.
 * Interactive preparation costs O(N log N) time/ids. Loading previews keep just the ids. */
export class CanvasViewport {
  readonly ids: Uint32Array;
  private levels: Uint32Array[] = [];
  private offsets = [0, 0, 0, 0];
  constructor(private bounds: PositionBounds, visible: Uint8Array, preview: boolean, kind = (_n: number) => 0) {
    // Ordinary, foldable relationship, retained relationship. Disabled geometry is absent.
    const p = bounds.positions, at = this.offsets;
    for (let i = 0; i < visible.length; i++) if (visible[i]) { const k = kind(i); if (k >= 0) at[k + 1]!++; }
    for (let k = 1; k < at.length; k++) at[k]! += at[k - 1]!;
    const ids = this.ids = new Uint32Array(at[3]!), cursor = at.slice();
    for (let i = 0; i < visible.length; i++) if (visible[i]) { const k = kind(i); if (k >= 0) ids[cursor[k]!++] = i; }
    if (preview) return;
    for (let k = 0; k < 3; k++) ids.subarray(at[k], at[k + 1]).sort((a, b) => p[2 * a]! - p[2 * b]! || a - b);
    this.levels.push(ids);
    for (let width = 1; width < ids.length; width *= 2) {
      const prev = this.levels[this.levels.length - 1]!, next = new Uint32Array(ids.length);
      for (let l = 0; l < ids.length; l += 2 * width) {
        const mid = Math.min(l + width, ids.length), end = Math.min(mid + width, ids.length);
        let a = l, b = mid;
        for (let j = l; j < end; j++) next[j] = b === end || a < mid && p[2 * prev[a]! + 1]! <= p[2 * prev[b]! + 1]! ? prev[a++]! : prev[b++]!;
      }
      this.levels.push(next);
    }
  }
  sample(x: number, y: number, w: number, h: number, cap: number, add: (n: number) => void, classes = 7) {
    const p = this.bounds.positions, spans: [Uint32Array, number, number][] = [];
    let count = 0;
    const bound = (ids: Uint32Array, l: number, r: number, axis: number, value: number, upper: boolean) => {
      while (l < r) {
        const m = Math.floor((l + r) / 2), v = p[2 * ids[m]! + axis]!;
        if (v < value || upper && v === value) l = m + 1; else r = m;
      }
      return l;
    };
    const slice = (l: number, r: number) => {
      const end = bound(this.ids, l, r, 0, x + w, true);
      l = bound(this.ids, l, end, 0, x - w, false);
      while (l < end) {
        // Largest aligned dyadic span starting here that ends inside the x interval.
        const aligned = l ? 31 - Math.clz32(l & -l) : 31;
        const depth = Math.min(aligned, 31 - Math.clz32(end - l)), width = 2 ** depth, ids = this.levels[depth]!;
        const a = bound(ids, l, l + width, 1, y - h, false), b = bound(ids, a, l + width, 1, y + h, true);
        if (b > a) { spans.push([ids, a, b]); count += b - a; }
        l += width;
      }
    };
    for (let k = 0; k < 3; k++) if (classes & 1 << k) {
      const a = this.offsets[k]!, b = this.offsets[k + 1]!;
      if (this.levels.length) slice(a, b); else { count += b - a; spans.push([this.ids, a, b]); }
    }
    const take = Math.min(count, cap); let before = 0, i = 0;
    for (const [ids, a, b] of spans) {
      while (i < take && Math.floor((i + .5) * count / take) < before + b - a) add(ids[a + Math.floor((i++ + .5) * count / take) - before]!);
      before += b - a;
    }
  }
}
/** Prepare whole drawable units on view/selection changes. Equal visual ranks need not
 * mean equal ownership. Negative unit keys identify shared geometry; other rows are independent.
 * Priority is the strongest interaction on ANY row in the unit. */
export function canvasDetailEdges(total: number, eligible: number, cap: number, on: (e: number) => boolean, rank: (e: number) => number, unit = (e: number) => e, priority = (_e: number) => 0) {
  const out = new Uint32Array(Math.min(eligible, cap)); let size = 0;
  if (!out.length) return out;
  if (eligible <= cap) { for (let e = 0; e < total; e++) if (on(e)) out[size++] = e; }
  else {
    const rows = new Uint32Array(total), heads = new Map<number, number>(), units: number[] = [];
    const counts = new Uint32Array(total), priorities = new Uint8Array(total);
    for (let e = 0; e < total; e++) if (on(e)) {
      const key = unit(e), id = key >= 0 ? e : heads.get(key) ?? e;
      if (!counts[id]) { units.push(id); if (key < 0) heads.set(key, id); }
      rows[e] = id + 1; counts[id]!++; priorities[id] = Math.max(priorities[id]!, priority(e));
    }
    units.sort((a, b) => priorities[b]! - priorities[a]! || rank(a) - rank(b) || a - b);
    let left = cap;
    for (const id of units) { const cost = counts[id]!; counts[id] = +(cost <= left); if (counts[id]) left -= cost; }
    for (let e = 0; e < total; e++) if (rows[e] && counts[rows[e]! - 1]) out[size++] = e;
  }
  return out.subarray(0, size);
}
export function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
export interface LabelBox { node: number; x: number; y: number; w: number; h: number }
/** Precomputed at fixed LOD scales; pan is a translation, never a new collision pass. */
export function placeLabels(candidates: readonly LabelBox[], cellSize: number, budget: number): LabelBox[] {
  if (!Number.isFinite(cellSize) || cellSize <= 0 || !Number.isSafeInteger(budget) || budget < 1) throw new Error('LABEL_GEOMETRY_RANGE: positive cell size and safe positive budget required');
  const cells = new Map<string, LabelBox[]>(), result: LabelBox[] = [], wide: LabelBox[] = [];
  // A wide box uses exact comparisons against accepted labels, not traversal of
  // an enormous spatial extent. Work is bounded by the supplied candidate/budget count.
  const cellBudget = Math.max(1, Math.min(budget, candidates.length));
  const overlaps = (a: LabelBox, b: LabelBox) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (const box of candidates) {
    if (![box.x, box.y, box.w, box.h, box.x + box.w, box.y + box.h].every(Number.isFinite) || box.w < 0 || box.h < 0) throw new Error('LABEL_GEOMETRY_RANGE: nonfinite or negative label geometry');
    const x0 = Math.floor(box.x / cellSize), x1 = Math.floor((box.x + box.w) / cellSize), y0 = Math.floor(box.y / cellSize), y1 = Math.floor((box.y + box.h) / cellSize);
    if (![x0, x1, y0, y1].every(Number.isSafeInteger)) throw new Error('LABEL_GEOMETRY_RANGE: cell coordinates exceed exact integer precision');
    const columns = x1 - x0 + 1, rows = y1 - y0 + 1;
    const broad = columns > cellBudget || rows > cellBudget || columns * rows > cellBudget;
    let collision = (broad ? result : wide).some(b => overlaps(box, b));
    if (!broad) for (let dy = 0; dy < rows && !collision; dy++) for (let dx = 0; dx < columns && !collision; dx++) for (const b of cells.get(`${x0 + dx}:${y0 + dy}`) ?? []) if (overlaps(box, b)) { collision = true; break; }
    if (collision) continue;
    result.push(box);
    if (broad) wide.push(box);
    else for (let dy = 0; dy < rows; dy++) for (let dx = 0; dx < columns; dx++) { const key = `${x0 + dx}:${y0 + dy}`, list = cells.get(key); if (list) list.push(box); else cells.set(key, [box]); }
    if (result.length >= budget) break;
  }
  return result;
}

export const LABEL_RATIOS = [.125, .25, .5, 1, 2, 4, 8] as const;
export function labelLOD(ratio: number) { const i = LABEL_RATIOS.findIndex(r => r >= ratio); return i < 0 ? LABEL_RATIOS.length - 1 : i; }

/** Same-size canvas assignments still clear/reset a GPU drawing buffer. */
export function resizeDrawingBuffer(canvas: Pick<HTMLCanvasElement, 'width' | 'height'>, width: number, height: number) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}
