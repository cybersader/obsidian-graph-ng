import { setIcon } from 'obsidian';
import type { RenderProjection } from './render-projection';
/** Incident-edge CSR (`incidentEdges`): per node, every edge row touching it. */
export interface Incidence { offsets: Uint32Array; edges: Uint32Array }
type Columns = Pick<RenderProjection, 'source' | 'target' | 'type' | 'types' | 'carrier' | 'carrierNodes'>;
type On = (edge: number) => boolean;
/** One relationship type in one direction, relative to the focus. */
export interface ConnectionGroup { type: string; out: boolean; nodes: number[] }
/** Visit each drawn neighbour of `u` in O(degree). A relationship-note dot owned by the edge is
 * transparent: it is reported once as a dot, then its far endpoints as direct neighbours. */
function neighbours(u: number, inc: Incidence, p: Columns, on: On, vis: ArrayLike<number>, visit: (edge: number, node: number, dot: boolean) => void) {
  const own = (e: number, c: number) => !!p.carrierNodes[c] && p.carrier[e]! + 1 === p.carrierNodes[c];
  const other = (e: number, a: number) => p.source[e] === a ? p.target[e]! : p.source[e]!;
  for (let j = inc.offsets[u]!; j < inc.offsets[u + 1]!; j++) {
    const e = inc.edges[j]!, v = other(e, u);
    if (!on(e) || !vis[v] || v === u) continue;
    if (!own(e, v)) { visit(e, v, false); continue; }
    visit(e, v, true);
    for (let k = inc.offsets[v]!; k < inc.offsets[v + 1]!; k++) { const f = inc.edges[k]!, w = other(f, v); if (f !== e && on(f) && own(f, v) && w !== u && vis[w]) visit(e, w, false); }
  }
}
/** Direct connections of `focus`, grouped by relationship type and direction. Groups run largest
 * first, then by type name, outgoing before incoming; rows follow `order`. O(degree log degree). */
export function connectionGroups(focus: number, inc: Incidence, p: Columns, on: On, vis: ArrayLike<number>, order: (a: number, b: number) => number) {
  const groups = new Map<string, ConnectionGroup & { seen: Set<number> }>(), all = new Set<number>();
  if (focus >= 0 && vis[focus]) neighbours(focus, inc, p, on, vis, (e, w, dot) => {
    if (dot) return;
    const out = p.source[e] === focus, type = p.types[p.type[e]!] ?? '', key = +out + type;
    let g = groups.get(key); if (!g) groups.set(key, g = { type, out, nodes: [], seen: new Set() });
    if (!g.seen.has(w)) { g.seen.add(w); g.nodes.push(w); } all.add(w);
  });
  const list = [...groups.values()].map(({ type, out, nodes }) => ({ type, out, nodes: nodes.sort(order) }));
  return { groups: list.sort((a, b) => b.nodes.length - a.nodes.length || a.type.localeCompare(b.type) || +b.out - +a.out), direct: all.size };
}
/** Focus plus direct connections (and neighbours of neighbours at `hops` 2), relationship-note dots
 * included. Hop 2 stops after `budget` incident rows and reports truncation. */
export function reach(focus: number, inc: Incidence, p: Columns, on: On, vis: ArrayLike<number>, hops: number, budget = 65536) {
  const nodes = new Set<number>(), first: number[] = []; let second = 0, scanned = 0, truncated = false;
  if (focus < 0 || !vis[focus]) return { nodes, direct: 0, second, truncated };
  nodes.add(focus);
  neighbours(focus, inc, p, on, vis, (_, w, dot) => { if (!nodes.has(w)) { nodes.add(w); if (!dot) first.push(w); } });
  if (hops > 1) for (const u of first) {
    if (scanned > budget) { truncated = true; break; }
    scanned += inc.offsets[u + 1]! - inc.offsets[u]!;
    neighbours(u, inc, p, on, vis, (_, w, dot) => { if (!nodes.has(w)) { nodes.add(w); if (!dot) second++; } });
  }
  return { nodes, direct: first.length, second, truncated };
}
/** Back/forward history of visited notes; a new visit drops the forward branch. */
export class NavHistory {
  items: number[] = [];
  at = -1;
  constructor(private max = 32) {}
  visit(n: number) {
    if (this.items[this.at] === n) return;
    this.items.splice(this.at + 1); this.items.push(n);
    if (this.items.length > this.max) this.items.shift();
    this.at = this.items.length - 1;
  }
  /** Move by `step` (-1 back, 1 forward); undefined at either end. */
  go(step: number) { const i = this.at + step; if (i < 0 || i >= this.items.length) return undefined; this.at = i; return this.items[i]; }
  /** Drop unavailable targets without moving away from the current history entry. */
  retain(available: (n: number) => boolean) {
    const before = this.items.slice(0, this.at + 1).filter(available).length;
    this.items = this.items.filter(available); this.at = before - 1;
  }
  clear() { this.items = []; this.at = -1; }
}
/** Views narrower than this show the card as a bottom sheet instead of a docked side panel. */
export const SHEET_WIDTH = 520;
/** The card's rectangle [x, y, w, h] in a width×height view whose right `right` px are covered (the
 * graph tools panel): docked to the top-right edge of the remaining room (a fixed side panel that
 * never follows the camera), or a bottom sheet across that room (`sheetCard`). */
export function dockCard(width: number, height: number, w: number, h: number, m = 8, right = 0): [number, number, number, number] {
  const room = width - right;
  return sheetCard(width, right) ? [0, height - h, room, h] : [Math.max(m, room - m - w), m, w, h];
}
/** Room beside the tools panel for the docked card: its 320 px CSS width plus both 8 px margins. */
export const DOCK_ROOM = 336;
/** Bottom sheet when the view is narrow, or when the tools panel leaves no room for the docked card. */
export const sheetCard = (width: number, right = 0) => width < SHEET_WIDTH || width - right < DOCK_ROOM;
export type CardAction = 'open' | 'tab' | 'split' | 'focus' | 'isolate' | 'lens' | 'copy';
export interface CardHost {
  name(n: number): string;
  color(n: number): string;
  groups(n: number): { groups: ConnectionGroup[]; direct: number };
  secondHop(n: number): { second: number; truncated: boolean };
  isolated(): boolean;
  /** Whether the connection lens is open on this note; hosts without a lens omit it (no Lens action). */
  lensed?(n: number): boolean;
  act(action: CardAction, n: number): void;
  travel(n: number): void;
  cue(n: number): void;
  close(): void;
}
const ROWS = 50;
export const el = (tag: string, text = '', cls = '') => Object.assign(document.createElement(tag), { textContent: text, className: cls });
export const button = (text: string, label: string, run: () => void, cls = '') => { const b = el('button', text, cls) as HTMLButtonElement; b.setAttribute('aria-label', label); b.onclick = run; return b; };
/** An icon button (Obsidian `setIcon`), with an optional visible label beside the icon. */
export const iconButton = (icon: string, label: string, run: () => void, text = '', cls = 'graph-ng-card-nav') => {
  const b = button('', label, run, cls); setIcon(b.appendChild(el('span', '', 'graph-ng-card-icon')), icon);
  if (text) b.append(el('span', text)); else b.title = label;
  return b;
};
/** The X close control: an icon with the accessible name "Close", never a visible "Close" label. */
export const closeButton = (run: () => void) => iconButton('x', 'Close', run);
/** The connection navigator: header with counts, actions, and the grouped Connections list.
 * Text-only: note names are untrusted and only ever set through textContent. */
export class ConnectionCard {
  node = -1;
  readonly history = new NavHistory();
  rows: HTMLElement[] = [];
  /** Measured [width, height], cleared on every render; the host re-measures once. */
  size?: [number, number];
  private limit = ROWS;
  private moving = false;
  private lensToggle?: HTMLElement;
  constructor(readonly root: HTMLElement, private host: CardHost) {}
  show(n: number) {
    if (n !== this.node) this.limit = ROWS;
    this.node = n; if (!this.moving) this.history.visit(n); this.render();
  }
  /** Closing keeps the visit history (the breadcrumb outlives the card); the renderer clears it on a view change. */
  hide() { this.node = -1; this.rows = []; this.size = undefined; this.lensToggle = undefined; this.root.textContent = ''; this.root.removeAttribute?.('aria-label'); }
  /** Back (-1) or forward (1) through visited notes, also from a closed card (the breadcrumb). */
  step(step: number) {
    const n = this.history.go(step); if (n === undefined) return false;
    this.moving = true; try { this.go(n); } finally { this.moving = false; }
    return true;
  }
  /** Travel, keeping keyboard focus inside the card when it was there. */
  private go(n: number) {
    const kept = this.root.contains(document.activeElement); this.host.travel(n);
    if (kept) (this.rows[0] ?? this.root.querySelector('button'))?.focus();
  }
  render(focus = -1) {
    const n = this.node, h = this.host, c = this.root, name = h.name(n), { groups, direct } = h.groups(n), two = h.secondHop(n);
    c.textContent = ''; this.rows = []; this.size = undefined; c.setAttribute('role', 'region'); c.setAttribute('aria-label', 'Connections of ' + name);
    // Header: the note name, then back, forward and close as icon buttons.
    const head = c.appendChild(el('div', '', 'graph-ng-card-head')), { items, at } = this.history;
    const title = head.appendChild(el('strong', name, 'graph-ng-card-title')); title.setAttribute('aria-live', 'polite'); title.title = name;
    const back = head.appendChild(iconButton('chevron-left', 'Back', () => this.step(-1))), forward = head.appendChild(iconButton('chevron-right', 'Forward', () => this.step(1)));
    back.disabled = at <= 0; forward.disabled = at >= items.length - 1;
    head.append(closeButton(() => h.close()));
    if (at > 0) {
      const trail = c.appendChild(el('nav', '', 'graph-ng-card-trail')); trail.setAttribute('aria-label', 'Visited notes');
      for (let i = Math.max(0, at - 3); i < at; i++) trail.append(button(h.name(items[i]!), 'Back to ' + h.name(items[i]!), () => this.step(i - this.history.at)));
    }
    const chips = c.appendChild(el('div', '', 'graph-ng-card-chips'));
    chips.append(el('span', `${direct.toLocaleString()} direct connection${direct === 1 ? '' : 's'}`, 'graph-ng-summary-chip'), el('span', `${two.second.toLocaleString()}${two.truncated ? '+' : ''} neighbours of neighbours`, 'graph-ng-summary-chip'));
    // One segmented "Open" control, then an icon+label grid that wraps instead of clipping.
    const act = (a: CardAction) => () => h.act(a, n), open = c.appendChild(el('div', '', 'graph-ng-card-open'));
    open.setAttribute('role', 'group'); open.setAttribute('aria-label', 'Open ' + name);
    open.append(button('Open', 'Open ' + name, act('open')), button('New tab', `Open ${name} in a new tab`, act('tab')), button('Right', `Open ${name} to the right`, act('split')));
    const actions = c.appendChild(el('div', '', 'graph-ng-card-actions')), tool = (icon: string, text: string, label: string, a: CardAction) => actions.appendChild(iconButton(icon, label, act(a), text, ''));
    tool('crosshair', 'Focus', `Focus here: fit ${name} and its direct connections`, 'focus');
    tool('network', 'Only connections', 'Show only connections of ' + name, 'isolate').setAttribute('aria-pressed', String(h.isolated()));
    this.lensToggle = h.lensed ? tool('search', 'Lens', 'Connection lens for ' + name, 'lens') : undefined; this.syncLens();
    tool('link', 'Copy link', 'Copy link to ' + name, 'copy');
    const list = c.appendChild(el('div', '', 'graph-ng-connections')); list.setAttribute('aria-label', 'Connections');
    if (!groups.length) list.append(el('div', 'No direct connections', 'graph-ng-explore-note'));
    let left = this.limit; const total = groups.reduce((s, g) => s + g.nodes.length, 0);
    for (const g of groups) {
      if (left <= 0) break;
      const header = list.appendChild(el('div', '', 'graph-ng-connection-group')), dir = g.out ? 'outgoing' : 'incoming';
      header.append(el('span', g.type || 'relationship'), el('span', `${g.out ? '→' : '←'} ${g.nodes.length.toLocaleString()}`));
      header.setAttribute('aria-label', `${g.type || 'relationship'}, ${dir}, ${g.nodes.length}`);
      for (const m of g.nodes.slice(0, left)) {
        const label = h.name(m), row = list.appendChild(button('', `Go to ${label} (${dir})`, () => this.go(m), 'graph-ng-connection')), swatch = row.appendChild(el('span', '', 'graph-ng-swatch'));
        swatch.style.background = h.color(m); row.append(el('span', label));
        row.onmouseenter = row.onfocus = () => h.cue(m); row.onmouseleave = row.onblur = () => h.cue(-1);
        this.rows.push(row);
      }
      left -= g.nodes.length;
    }
    if (total > this.limit) {
      const rest = total - this.limit, more = rest > 1000 ? 1000 : rest;
      list.append(button(rest > 1000 ? `Show ${more.toLocaleString()} more` : `Show all (${total.toLocaleString()})`, `Show ${more} more connections`, () => { const at = this.rows.length; this.limit += more; this.render(at); }));
    }
    this.rows[focus]?.focus();
  }
  /** Reflect the host's lens state on the Lens action (aria-pressed). */
  syncLens() { if (this.lensToggle && this.node >= 0) this.lensToggle.setAttribute('aria-pressed', String(!!this.host.lensed?.(this.node))); }
  /** Expand the Connections list as "Show all" does (in chunks of at most 1000 rows) and focus its first row. */
  showAll() {
    if (this.node < 0) return;
    const total = this.host.groups(this.node).groups.reduce((s, g) => s + g.nodes.length, 0);
    if (total > this.limit) this.limit += Math.min(total - this.limit, 1000);
    this.render(0);
  }
  /** Card keys: Escape closes, Alt+Left/Right go back/forward, arrows/Home/End move through rows.
   * Enter and Space on a focused row are the native button activation (travel). */
  key(e: KeyboardEvent) {
    if (e.key === 'Escape') this.host.close();
    else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) this.step(e.key === 'ArrowLeft' ? -1 : 1);
    else {
      const i = this.rows.indexOf(e.target as HTMLElement), last = this.rows.length - 1, move = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: last }[e.key];
      if (i < 0 || move === undefined) return false;
      this.rows[Math.max(0, Math.min(last, move))]!.focus();
    }
    e.preventDefault(); e.stopPropagation?.(); return true;
  }
}
/** "Show only connections" bar: who it is centred on, a 2-hop toggle and the way back. */
export function isolationBar(bar: HTMLElement, name: string, hops: number, setHops: (hops: number) => void, clear: () => void) {
  bar.textContent = ''; if (!name) return;
  bar.append(el('span', 'Only connections of ' + name));
  const two = bar.appendChild(button('Neighbours of neighbours', 'Include neighbours of neighbours', () => setHops(hops > 1 ? 1 : 2))); two.setAttribute('aria-pressed', String(hops > 1));
  bar.append(button('Back to full graph', 'Back to full graph', clear));
}
