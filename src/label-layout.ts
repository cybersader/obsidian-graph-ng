/** Graduated label layout: pure, DOM-free helpers shared by the WebGL atlas, the Canvas path and the
 * text-only focus overlay. Ranks: focus 0, direct 1, ancestor 2, 2-hop 3, same group 4, context 5. */

/** Modular-scale steps per rank around the label size setting; direct connections sit at the setting. */
const STEPS = [2, 0, 0, -1, -1.5, -1.5], WEIGHTS = [700, 600, 500, 400, 400, 400];
/** Character budget per rank before middle truncation. */
export const LABEL_CHARS = [48, 32, 28, 24, 20, 20];
/** Direct-connection labels shown around a focus before the rest fold into "+N more". */
export const DIRECT_LABELS = 24;
const clampRank = (rank: number) => Math.max(0, Math.min(5, rank | 0));
/** Font size (half-pixel steps, 6–64 px) and weight for a rank. `scale` 1 keeps one size for every tier. */
export function tierType(rank: number, base: number, scale: number) {
  const r = clampRank(rank);
  return { size: Math.max(6, Math.min(64, Math.round(base * scale ** STEPS[r]! * 2) / 2)), weight: WEIGHTS[r]! };
}
/** One font string for measureText during placement and the DOM label it positions. */
export const tierFont = (rank: number, base: number, scale: number, family: string) => { const t = tierType(rank, base, scale); return `${t.weight} ${t.size}px ${family}`; };
/** Overview label growth by degree rank: `fraction` 0 is the largest hub (scale², the focus size), falling quickly to 1. */
export const overviewScale = (fraction: number, scale: number) => 1 + (scale * scale - 1) * (1 - Math.max(0, Math.min(1, fraction))) ** 4;
/** Keep the start and end of a long name ("Control AC-2…enhancement 4"); counts code points, never splits a surrogate pair. */
export function middleTruncate(text: string, max: number) {
  const c = Array.from(text); if (c.length <= max) return text;
  if (max < 2) return '…';
  const keep = max - 1, head = Math.ceil(keep / 2), tail = keep - head;
  return c.slice(0, head).join('') + '…' + (tail ? c.slice(-tail).join('') : '');
}
/** Label level of detail with hysteresis: the level changes only once the camera ratio is past the
 * shared boundary by `margin` (log2 units), so labels do not flicker between atlas levels at a boundary. */
export function stickyLevel(prev: number, ratio: number, ratios: readonly number[], margin = .2) {
  const i = ratios.findIndex(r => r >= ratio), raw = i < 0 ? ratios.length - 1 : i;
  if (raw === prev || !(prev >= 0 && prev < ratios.length) || Math.abs(raw - prev) > 1) return raw;
  const boundary = ratios[Math.min(raw, prev)]!;
  return Math.abs(Math.log2(ratio / boundary)) >= margin ? raw : prev;
}

export interface LabelItem { node: number; rank: number; x: number; y: number; r: number; w: number; h: number }
/** A placed label relative to its dot: `dx` to the label's left edge, `dy` to its vertical centre.
 * `leader` (from the dot rim to the label) is set only when the label was displaced. */
export interface LabelSlot { node: number; rank: number; dx: number; dy: number; w: number; h: number; leader?: readonly [number, number, number, number] }
export interface RadialLayout { slots: LabelSlot[]; hidden: number; more?: { dx: number; dy: number } }
const TURNS = [0, 1, -1, 2, -2, 3, -3, 4];
/** Radial collision-avoiding placement around a focus. `items` arrive in priority order (focus first).
 * A label first tries the right of its dot; direct and ancestor labels that collide are pushed outward
 * along the focus-to-dot direction (then rotated in 22.5° steps, three rings) with a leader line; other
 * tiers are dropped. At most `directCap` direct labels; `hidden` direct connections (of `directTotal`) fold
 * into one "+N more" box placed next to the focus label. O(budget² × 24), run once per focus/zoom bucket. */
export function radialLabels(items: readonly LabelItem[], budget: number, directCap: number, directTotal: number, moreW: number, moreH: number): RadialLayout {
  const boxes: number[] = [], slots: LabelSlot[] = []; let direct = 0;
  const free = (x: number, y: number, w: number, h: number) => { for (let i = 0; i < boxes.length; i += 4) if (x < boxes[i]! + boxes[i + 2]! && x + w > boxes[i]! && y < boxes[i + 1]! + boxes[i + 3]! && y + h > boxes[i + 1]!) return false; return true; };
  const focus = items[0]?.rank === 0 ? items[0] : undefined;
  for (const it of items) {
    if (slots.length >= budget) break;
    if (it.rank === 1 && direct >= directCap) continue;
    let x = it.x + it.r + 4, y = it.y - it.h / 2, leader: LabelSlot['leader'];
    if (!free(x, y, it.w, it.h)) {
      if (!focus || it === focus || it.rank > 2) continue;
      const a0 = it.x === focus.x && it.y === focus.y ? 0 : Math.atan2(it.y - focus.y, it.x - focus.x);
      search: for (let ring = 1; ring <= 3; ring++) for (const turn of TURNS) {
        const a = a0 + turn * Math.PI / 8, c = Math.cos(a), s = Math.sin(a), d = it.r + 6 + ring * it.h, ax = c * d, ay = s * d;
        const bx = it.x + (c >= 0 ? ax : ax - it.w), by = it.y + ay - it.h / 2;
        if (free(bx, by, it.w, it.h)) { x = bx; y = by; leader = [c * (it.r + 1), s * (it.r + 1), ax, ay]; break search; }
      }
      if (!leader) continue;
    }
    boxes.push(x, y, it.w, it.h); slots.push({ node: it.node, rank: it.rank, dx: x - it.x, dy: y + it.h / 2 - it.y, w: it.w, h: it.h, leader }); if (it.rank === 1) direct++;
  }
  const hidden = Math.max(0, directTotal - direct);
  let more: RadialLayout['more'];
  // A "+N more" spot is reserved whenever the focus has direct connections: overlays may still hide a placed label.
  if (directTotal && focus) {
    const left = focus.x + focus.r + 4, top = focus.y - focus.h / 2;
    const spots = [[left, top + focus.h + 2], [left, top - moreH - 2], [focus.x - focus.r - 4 - moreW, focus.y - moreH / 2], [left, top + focus.h + moreH + 6], [left, top - 2 * moreH - 6]];
    const [mx, my] = spots.find(([x, y]) => free(x!, y!, moreW, moreH)) ?? spots[0]!;
    more = { dx: mx! - focus.x, dy: my! + moreH / 2 - focus.y };
  }
  return { slots, hidden, more };
}

/** Whole box plus its own height of breathing room on every side. */
export const labelInView = (x: number, y: number, w: number, h: number, width: number, height: number) => x >= h && y >= h && x + w <= width - h && y + h <= height - h;
/** Reposition a focus annotation inside that margin; a too-small viewport still fails labelInView. */
export const insetLabel = (x: number, y: number, w: number, h: number, width: number, height: number) => [Math.max(h, Math.min(width - w - h, x)), Math.max(h, Math.min(height - 2 * h, y))];
