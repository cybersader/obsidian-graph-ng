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
  /** Optional presentation metadata, never an identity or topology authority. */
  title?(n: number): string;
  group?(n: number): { key: number; label: string };
  groups(n: number): { groups: ConnectionGroup[]; direct: number };
  isolated(): boolean;
  /** Whether the connection lens is open on this note; hosts without a lens omit it (no Lens action). */
  lensed?(n: number): boolean;
  act(action: CardAction, n: number): void;
  travel(n: number): void;
  cue(n: number): void;
  /** Hubs only: light just these open sections' notes (undefined restores the whole hub), plus
   * neighbours of neighbours for the notes in `second`. Presentation state, never topology. */
  disclose?(n: number, open: number[] | undefined, second: number[]): void;
  close(): void;
}
const ROWS = 50;
interface ConnectionEntry { node: number; name: string; title: string; relations: string[]; search: string }
interface NavigatorSection { key: number; label: string; entries: ConnectionEntry[] }
/** One row per connected note, under its declared group; retain all relationship directions.
 * Metadata is resolved once per card render, never during drawing or on each search keystroke. */
export function navigatorSections(groups: ConnectionGroup[], host: Pick<CardHost, 'name' | 'title' | 'group'>): NavigatorSection[] {
  const sections = new Map<number, NavigatorSection>(), notes = new Map<number, ConnectionEntry>();
  for (const g of groups) for (const node of g.nodes) {
    let row = notes.get(node);
    if (!row) {
      const group = host.group?.(node) ?? { key: -1, label: 'Ungrouped' }, name = host.name(node), title = host.title?.(node)?.trim().slice(0, 256) || name;
      let section = sections.get(group.key);
      if (!section) sections.set(group.key, section = { ...group, entries: [] });
      notes.set(node, row = { node, name, title, relations: [], search: '' }); section.entries.push(row);
    }
    const relation = `${g.out ? '→' : '←'} ${g.type || 'relationship'}`;
    if (!row.relations.includes(relation)) row.relations.push(relation);
  }
  for (const section of sections.values()) for (const row of section.entries) row.search = [section.label, row.title, row.name, ...row.relations].join(' ').toLocaleLowerCase();
  return [...sections.values()].sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label) || a.key - b.key);
}
export function filterConnections(sections: NavigatorSection[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sections.map(s => ({ ...s, entries: s.entries.filter(r => terms.every(t => r.search.includes(t))) })).filter(s => s.entries.length);
}
let navigatorId = 0;
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
  private navSections: NavigatorSection[] = [];
  private navQuery = '';
  private navOpen = new Set<number>();
  private navClosed = new Set<number>();
  private navPages = new Map<number, number>();
  /** Open sections whose neighbours of neighbours are lit on the graph. */
  private navSecond = new Set<number>();
  private navGroupLimit = 100;
  private navList?: HTMLElement;
  private navInput?: HTMLInputElement;
  private navStatus?: HTMLElement;
  private navId = `graph-ng-connections-${++navigatorId}`;
  private moving = false;
  private lensToggle?: HTMLElement;
  constructor(readonly root: HTMLElement, private host: CardHost) {}
  show(n: number) {
    if (n !== this.node) { this.navQuery = ''; this.navClosed.clear(); this.navOpen.clear(); this.navPages.clear(); this.navSecond.clear(); this.navGroupLimit = 100; this.navSections = []; }
    this.node = n; if (!this.moving) this.history.visit(n); this.render();
  }
  /** Closing keeps the visit history (the breadcrumb outlives the card); the renderer clears it on a view change. */
  hide() { if (this.node >= 0) this.host.disclose?.(this.node, undefined, []); this.node = -1; this.rows = []; this.size = undefined; this.lensToggle = undefined; this.navList = this.navInput = this.navStatus = undefined; this.navSections = []; this.root.textContent = ''; this.root.removeAttribute?.('aria-label'); }
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
  render() {
    const n = this.node, h = this.host, c = this.root, name = h.name(n), { groups, direct } = h.groups(n);
    const before = this.navSections, initial = !before.length; this.navSections = navigatorSections(groups, h);
    // Section keys are group codes: after a regroup a code may name another group, so drop open/closed/page state
    // for any key whose group label changed or vanished (the graph would otherwise light the wrong section).
    const labels = new Map(this.navSections.map(s => [s.key, s.label]));
    for (const s of before) if (labels.get(s.key) !== s.label) for (const state of [this.navOpen, this.navClosed, this.navSecond, this.navPages]) state.delete(s.key);
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
    const caption = h.title?.(n)?.trim().slice(0, 256);
    if (caption && caption !== name) c.append(el('div', caption, 'graph-ng-card-caption'));
    // One segmented "Open" control, then an icon+label grid that wraps instead of clipping.
    const act = (a: CardAction) => () => h.act(a, n), open = c.appendChild(el('div', '', 'graph-ng-card-open'));
    open.setAttribute('role', 'group'); open.setAttribute('aria-label', 'Open ' + name);
    open.append(button('Open', 'Open ' + name, act('open')), button('New tab', `Open ${name} in a new tab`, act('tab')), button('Right', `Open ${name} to the right`, act('split')));
    const actions = c.appendChild(el('div', '', 'graph-ng-card-actions')), tool = (icon: string, text: string, label: string, a: CardAction) => actions.appendChild(iconButton(icon, label, act(a), text, ''));
    tool('crosshair', 'Focus', `Focus here: fit ${name} and its direct connections`, 'focus');
    tool('network', 'Only connections', 'Show only connections of ' + name, 'isolate').setAttribute('aria-pressed', String(h.isolated()));
    this.lensToggle = h.lensed ? tool('search', 'Lens', 'Connection lens for ' + name, 'lens') : undefined; this.syncLens();
    tool('link', 'Copy link', 'Copy link to ' + name, 'copy');
    const nav = c.appendChild(el('div', '', 'graph-ng-navigator'));
    this.navStatus = nav.appendChild(el('div', '', 'graph-ng-nav-status')); this.navStatus.setAttribute('role', 'status');
    const field = nav.appendChild(el('label', '', 'graph-ng-connection-filter'));
    field.append(el('span', 'Find a connection'));
    const input = this.navInput = field.appendChild(el('input')) as HTMLInputElement;
    input.type = 'search'; input.placeholder = 'Title, ID or group'; input.maxLength = 160; input.value = this.navQuery;
    input.setAttribute('aria-label', 'Filter connections by title, ID, group or relationship'); input.setAttribute('aria-controls', this.navId);
    input.oninput = () => { this.navQuery = input.value; this.navClosed.clear(); this.navPages.clear(); this.navGroupLimit = 100; this.paintConnections(); };
    this.navList = nav.appendChild(el('div', '', 'graph-ng-connections')); this.navList.id = this.navId; this.navList.setAttribute('aria-label', 'Direct connections by declared group');
    if (initial && (direct <= ROWS || this.navSections.length === 1)) for (const section of this.navSections) this.navOpen.add(section.key);
    this.paintConnections();
  }
  /** Repaint only results: typing never replaces the input, moves the camera or changes selection. */
  private paintConnections() {
    const list = this.navList!, filtered = filterConnections(this.navSections, this.navQuery), searching = !!this.navQuery.trim();
    const total = this.navSections.reduce((sum, s) => sum + s.entries.length, 0), found = filtered.reduce((sum, s) => sum + s.entries.length, 0);
    // A hub with some (not all) sections open lights only those sections on the graph.
    const open = this.navSections.filter(s => this.navOpen.has(s.key)), scoped = total > ROWS && open.length > 0 && open.length < this.navSections.length;
    this.navStatus!.textContent = searching ? `${found.toLocaleString()} of ${total.toLocaleString()} connections` : `${total.toLocaleString()} direct connection${total === 1 ? '' : 's'} in ${filtered.length.toLocaleString()} group${filtered.length === 1 ? '' : 's'}`;
    list.textContent = ''; list.scrollTop = 0; this.rows = []; this.size = undefined;
    if (!found) list.append(el('div', searching ? 'No matching connections. Try another title, ID or group.' : 'No direct connections', 'graph-ng-explore-note'));
    for (const section of filtered.slice(0, this.navGroupLimit)) {
      const { key, label, entries } = section, expanded = searching ? !this.navClosed.has(key) : this.navOpen.has(key);
      const block = list.appendChild(el('section', '', 'graph-ng-connection-section'));
      const toggle = block.appendChild(button('', `${label}, ${entries.length} connections`, () => {
        const scroll = list.scrollTop, state = searching ? this.navClosed : this.navOpen;
        if (state.has(key)) state.delete(key); else state.add(key);
        this.paintConnections(); list.scrollTop = scroll;
        (list.querySelector(`[data-group="${key}"]`) as HTMLElement | null)?.focus();
      }, 'graph-ng-connection-group'));
      toggle.dataset.group = String(key); toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-controls', `${this.navId}-${key}`);
      toggle.append(el('span', expanded ? '⌄' : '›', 'graph-ng-section-arrow'), el('span', label), el('span', entries.length.toLocaleString(), 'graph-ng-count'));
      const body = block.appendChild(el('div')); body.id = `${this.navId}-${key}`; body.hidden = !expanded;
      if (!expanded) continue;
      if (scoped && this.navOpen.has(key)) {
        const on = this.navSecond.has(key), two = body.appendChild(button('Neighbours of neighbours', `Show neighbours of neighbours for ${label} on the graph`, () => {
          const scroll = list.scrollTop; if (on) this.navSecond.delete(key); else this.navSecond.add(key);
          this.paintConnections(); list.scrollTop = scroll; (list.querySelector(`[data-second="${key}"]`) as HTMLElement | null)?.focus();
        }, 'graph-ng-section-second'));
        two.dataset.second = String(key); two.setAttribute('aria-pressed', String(on));
      }
      const limit = this.navPages.get(key) ?? ROWS;
      for (const entry of entries.slice(0, limit)) {
        const row = body.appendChild(button('', `Go to ${entry.title}${entry.title !== entry.name ? ' (' + entry.name + ')' : ''}: ${entry.relations.join(', ')}`, () => this.go(entry.node), 'graph-ng-connection'));
        const swatch = row.appendChild(el('span', '', 'graph-ng-swatch')); swatch.style.background = this.host.color(entry.node);
        const text = row.appendChild(el('span', '', 'graph-ng-connection-text')); text.append(el('span', entry.title, 'graph-ng-connection-title'));
        const meta = text.appendChild(el('span', '', 'graph-ng-connection-meta'));
        if (entry.title !== entry.name) meta.append(el('span', entry.name, 'graph-ng-connection-id'));
        meta.append(el('span', entry.relations.join(', '), 'graph-ng-connection-relation')); row.title = [entry.title, entry.name, ...entry.relations].join('\n');
        row.onmouseenter = row.onfocus = () => this.host.cue(entry.node); row.onmouseleave = row.onblur = () => this.host.cue(-1); this.rows.push(row);
      }
      if (entries.length > limit) body.append(button(`Show ${Math.min(ROWS, entries.length - limit)} more`, `Show more connections in ${label}`, () => {
        const scroll = list.scrollTop, at = this.rows.findIndex(r => body.contains(r)); this.navPages.set(key, limit + ROWS); this.paintConnections(); list.scrollTop = scroll; this.rows[at + limit]?.focus();
      }, 'graph-ng-connection-more'));
    }
    if (filtered.length > this.navGroupLimit) list.append(button('Show more groups', `Show ${Math.min(100, filtered.length - this.navGroupLimit)} more groups`, () => {
      const scroll = list.scrollTop, next = filtered[this.navGroupLimit]!; this.navGroupLimit += 100; this.paintConnections(); list.scrollTop = scroll;
      (list.querySelector(`[data-group="${next.key}"]`) as HTMLElement | null)?.focus();
    }));
    this.host.disclose?.(this.node, scoped ? open.flatMap(s => s.entries.map(e => e.node)) : undefined, scoped ? open.filter(s => this.navSecond.has(s.key)).flatMap(s => s.entries.map(e => e.node)) : []);
    // Clear any obsolete row cue and schedule the host to remeasure the changed card rectangle.
    this.host.cue(-1);
  }
  /** Reflect the host's lens state on the Lens action (aria-pressed). */
  syncLens() { if (this.lensToggle && this.node >= 0) this.lensToggle.setAttribute('aria-pressed', String(!!this.host.lensed?.(this.node))); }
  /** "+N more" opens a predictable navigator destination, not an unbounded flat list. */
  showAll() {
    if (this.node < 0) return;
    this.navQuery = ''; this.navInput!.value = ''; this.navPages.clear(); this.navOpen.clear();
    const first = this.navSections[0]; if (first) this.navOpen.add(first.key);
    this.paintConnections(); this.navInput!.focus({ preventScroll: true }); this.navList!.scrollTop = 0;
  }
  /** Card keys: Escape closes, Alt+Left/Right go back/forward, arrows/Home/End move through rows.
   * Enter and Space on a focused row are the native button activation (travel). */
  key(e: KeyboardEvent) {
    // The card's input owns text-editing keys (especially L/R); never forward them to graph actions.
    if (e.target === this.navInput && e.key !== 'Escape' && !(e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) { e.stopPropagation?.(); return true; }
    if (e.key === 'Escape' && this.navQuery) { this.navQuery = ''; this.navInput!.value = ''; this.paintConnections(); this.navInput!.focus({ preventScroll: true }); }
    else if (e.key === 'Escape') this.host.close();
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
