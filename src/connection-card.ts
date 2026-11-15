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
/** Keep a w×h card on screen beside a node at (x, y): right of it, else left; below, else above. */
export function placeCard(x: number, y: number, gap: number, width: number, height: number, w: number, h: number, m = 8) {
  let left = x + gap, top = y + 14;
  if (left + w > width - m) left = x - gap - w;
  if (top + h > height - m) top = y - 14 - h;
  return { x: Math.round(Math.max(m, Math.min(left, width - m - w))), y: Math.round(Math.max(m, Math.min(top, height - m - h))) };
}
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
  hide() { this.node = -1; this.rows = []; this.size = undefined; this.lensToggle = undefined; this.history.clear(); this.root.textContent = ''; this.root.removeAttribute?.('aria-label'); }
  /** Back (-1) or forward (1) through visited notes. */
  step(step: number) {
    if (this.node < 0) return false;
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
    const head = c.appendChild(el('div', '', 'graph-ng-card-head')), { items, at } = this.history;
    const back = head.appendChild(button('‹', 'Back', () => this.step(-1), 'graph-ng-card-nav')), forward = head.appendChild(button('›', 'Forward', () => this.step(1), 'graph-ng-card-nav'));
    back.disabled = at <= 0; forward.disabled = at >= items.length - 1;
    const title = head.appendChild(el('strong', name, 'graph-ng-card-title')); title.setAttribute('aria-live', 'polite');
    head.append(button('×', 'Close', () => h.close(), 'graph-ng-card-nav'));
    if (at > 0) {
      const trail = c.appendChild(el('nav', '', 'graph-ng-card-trail')); trail.setAttribute('aria-label', 'Visited notes');
      for (let i = Math.max(0, at - 3); i < at; i++) trail.append(button(h.name(items[i]!), 'Back to ' + h.name(items[i]!), () => this.step(i - this.history.at)));
    }
    const chips = c.appendChild(el('div', '', 'graph-ng-card-chips'));
    chips.append(el('span', `${direct.toLocaleString()} direct connection${direct === 1 ? '' : 's'}`, 'graph-ng-summary-chip'), el('span', `${two.second.toLocaleString()}${two.truncated ? '+' : ''} neighbours of neighbours`, 'graph-ng-summary-chip'));
    const actions = c.appendChild(el('div', '', 'graph-ng-card-actions')), act = (a: CardAction) => () => h.act(a, n);
    actions.append(button('Open', 'Open ' + name, act('open')), button('New tab', `Open ${name} in a new tab`, act('tab')), button('Right', `Open ${name} to the right`, act('split')),
      button('Focus', `Focus here: fit ${name} and its direct connections`, act('focus')));
    const only = actions.appendChild(button('Only connections', 'Show only connections of ' + name, act('isolate'))); only.setAttribute('aria-pressed', String(h.isolated()));
    this.lensToggle = h.lensed ? actions.appendChild(button('Lens', 'Connection lens for ' + name, act('lens'))) : undefined; this.syncLens();
    actions.append(button('Copy link', 'Copy link to ' + name, act('copy')));
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
