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
function neighbours(u: number, inc: Incidence, p: Columns, on: On, vis: ArrayLike<number>, visit: (edge: number, node: number, dot: boolean) => void, scan = () => true) {
  const own = (e: number, c: number) => !!p.carrierNodes[c] && p.carrier[e]! + 1 === p.carrierNodes[c];
  const other = (e: number, a: number) => p.source[e] === a ? p.target[e]! : p.source[e]!;
  for (let j = inc.offsets[u]!; j < inc.offsets[u + 1]!; j++) {
    if (!scan()) return;
    const e = inc.edges[j]!, v = other(e, u);
    if (!on(e) || !vis[v] || v === u) continue;
    if (!own(e, v)) { visit(e, v, false); continue; }
    visit(e, v, true);
    for (let k = inc.offsets[v]!; k < inc.offsets[v + 1]!; k++) { if (!scan()) return; const f = inc.edges[k]!, w = other(f, v); if (f !== e && on(f) && own(f, v) && w !== u && vis[w]) visit(e, w, false); }
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
/** Undirected semantic hops: owned relationship-note dots are transparent but retained.
 * Work is bounded by incident rows, including carrier fan-out. `truncated` is never silent. */
export function reach(focus: number, inc: Incidence, p: Columns, on: On, vis: ArrayLike<number>, hops: number, budget = 200000, consume = () => budget-- > 0) {
  const nodes = new Set<number>(); let direct = 0, second = 0, truncated = false;
  if (focus < 0 || !vis[focus]) return { nodes, direct, second, truncated };
  nodes.add(focus); let wave = [focus];
  const scan = () => consume() || (truncated = true, false);
  for (let h = 0; h < hops && wave.length && !truncated; h++) {
    const next: number[] = [];
    for (const u of wave) {
      neighbours(u, inc, p, on, vis, (_, w, dot) => {
        if (nodes.has(w)) return;
        nodes.add(w); if (!dot) { next.push(w); if (h === 0) direct++; else second++; }
      }, scan);
      if (truncated) break;
    }
    wave = next;
  }
  return { nodes, direct, second, truncated };
}
/** One mask authority: base ego network, then explicit one-hop expansions in visit order.
 * Filter changes cannot retain an expansion disconnected from the anchor. Frontier counts are
 * distinct hidden neighbours, not parallel edges; excluded nodes/types never count. A `shown` note
 * (a travel target) joins alone, with the relationship-note dot that links it, only while it is
 * adjacent to the region: travel reveals its target, never the traveller's other neighbours. */
export function neighbourhood(focus: number, hops: number, expanded: Set<number>, inc: Incidence, p: Columns, on: On, base: Uint8Array, shown: Iterable<number> = []) {
  let budget = 200000; const scan = () => budget-- > 0;
  const result = reach(focus, inc, p, on, base, hops, 0, scan), mask = new Uint8Array(base.length), frontier = new Map<number, number>();
  // Fixpoint: an expansion may hang off a travel target and a target off an expansion.
  const todo = new Set(expanded); let size = 0;
  while (size < result.nodes.size) {
    size = result.nodes.size;
    for (const n of todo) if (result.nodes.has(n)) {
      todo.delete(n); const more = reach(n, inc, p, on, base, 1, 0, scan); for (const v of more.nodes) result.nodes.add(v);
      result.truncated ||= more.truncated;
    }
    for (const t of shown) if (base[t] && !result.nodes.has(t)) {
      const dots = new Map<number, number>();
      neighbours(t, inc, p, on, base, (e, w, dot) => { if (dot) dots.set(e, w); else if (result.nodes.has(w)) { result.nodes.add(t); if (dots.has(e)) result.nodes.add(dots.get(e)!); } }, scan);
    }
  }
  for (const n of result.nodes) mask[n] = 1;
  for (const n of result.nodes) {
    const hidden = new Set<number>();
    neighbours(n, inc, p, on, base, (_, w, dot) => { if (!dot && !mask[w]) hidden.add(w); }, scan);
    if (budget < 0) { result.truncated = true; break; }
    if (hidden.size) frontier.set(n, hidden.size);
  }
  return { mask, frontier, partial: result.truncated };
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
export type CardAction = 'open' | 'tab' | 'split' | 'focus' | 'isolate' | 'lens' | 'copy' | 'expand';
export interface CardHost {
  name(n: number): string;
  color(n: number): string;
  /** Optional presentation metadata, never an identity or topology authority. */
  title?(n: number): string;
  group?(n: number): { key: number; label: string };
  groups(n: number): { groups: ConnectionGroup[]; direct: number };
  isolated(): boolean;
  frontier?(n: number): number;
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
/** Find-box debounce: one repaint per pause in typing, not per keystroke. */
export const NAV_DEBOUNCE_MS = 80;
/** `title` and `search` are filled on first use and live as long as the entry (one card build). */
interface ConnectionEntry { node: number; name: string; label: string; relations: string[]; title?: string; search?: string }
interface NavigatorSection { key: number; label: string; entries: ConnectionEntry[] }
/** One row per connected note, under its declared group; retain all relationship directions.
 * Titles are not fetched here: only rows that are drawn or searched ask for one (`entryTitle`). */
export function navigatorSections(groups: ConnectionGroup[], host: Pick<CardHost, 'name' | 'group'>): NavigatorSection[] {
  const sections = new Map<number, NavigatorSection>(), notes = new Map<number, ConnectionEntry>();
  for (const g of groups) for (const node of g.nodes) {
    let row = notes.get(node);
    if (!row) {
      const group = host.group?.(node) ?? { key: -1, label: 'Ungrouped' };
      let section = sections.get(group.key);
      if (!section) sections.set(group.key, section = { ...group, entries: [] });
      notes.set(node, row = { node, name: host.name(node), label: group.label, relations: [] }); section.entries.push(row);
    }
    const relation = `${g.out ? '→' : '←'} ${g.type || 'relationship'}`;
    if (!row.relations.includes(relation)) row.relations.push(relation);
  }
  return [...sections.values()].sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label) || a.key - b.key);
}
/** The bounded display title, fetched once per entry. */
export const entryTitle = (e: ConnectionEntry, host: Pick<CardHost, 'title'>) => e.title ??= host.title?.(e.node)?.trim().slice(0, 256) || e.name;
/** Every entry matching all query terms, flat and in section order. */
export function filterConnections(sections: NavigatorSection[], query: string, title: (e: ConnectionEntry) => string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean), all = sections.flatMap(s => s.entries);
  return terms.length ? all.filter(r => terms.every(t => (r.search ??= [r.label, title(r), r.name, ...r.relations].join(' ').toLocaleLowerCase()).includes(t))) : all;
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
  /** Search results shown, in pages of ROWS. */
  private navShown = ROWS;
  private navTimer?: ReturnType<typeof setTimeout>;
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
    if (n !== this.node) { this.setQuery(''); this.navOpen.clear(); this.navPages.clear(); this.navSecond.clear(); this.navGroupLimit = 100; this.navSections = []; }
    this.node = n; if (!this.moving) this.history.visit(n); this.render();
  }
  /** Closing keeps the visit history (the breadcrumb outlives the card); the renderer clears it on a view change. */
  hide() { this.setQuery(this.navQuery); if (this.node >= 0) this.host.disclose?.(this.node, undefined, []); this.node = -1; this.rows = []; this.size = undefined; this.lensToggle = undefined; this.navList = this.navInput = this.navStatus = undefined; this.navSections = []; this.root.textContent = ''; this.root.removeAttribute?.('aria-label'); }
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
    if (this.navTimer !== undefined) this.setQuery(this.navInput!.value); // typing still pending survives the rebuild
    // Section keys are group codes: after a regroup a code may name another group, so drop open/closed/page state
    // for any key whose group label changed or vanished (the graph would otherwise light the wrong section).
    const labels = new Map(this.navSections.map(s => [s.key, s.label]));
    for (const s of before) if (labels.get(s.key) !== s.label) for (const state of [this.navOpen, this.navSecond, this.navPages]) state.delete(s.key);
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
    // Expand shows only when something is hidden: never a disabled "+0".
    const hidden = h.frontier?.(n) ?? 0;
    if (!h.isolated()) tool('network', 'Only connections', 'Show only connections of ' + name, 'isolate');
    else if (hidden) tool('plus', 'Expand', `Add ${hidden} hidden neighbours of ${name}`, 'expand').append(el('span', '+' + hidden, 'graph-ng-count'));
    this.lensToggle = h.lensed ? tool('search', 'Lens', 'Connection lens for ' + name, 'lens') : undefined; this.syncLens();
    tool('link', 'Copy link', 'Copy link to ' + name, 'copy');
    const nav = c.appendChild(el('div', '', 'graph-ng-navigator'));
    this.navStatus = nav.appendChild(el('div', '', 'graph-ng-nav-status')); this.navStatus.setAttribute('role', 'status');
    const field = nav.appendChild(el('label', '', 'graph-ng-connection-filter'));
    field.append(el('span', 'Find a connection'));
    const input = this.navInput = field.appendChild(el('input')) as HTMLInputElement;
    input.type = 'search'; input.placeholder = 'Name, ID or group'; input.maxLength = 160; input.value = this.navQuery;
    input.setAttribute('aria-label', 'Filter connections by name, ID, group or relationship'); input.setAttribute('aria-controls', this.navId);
    input.oninput = () => { clearTimeout(this.navTimer); this.navTimer = setTimeout(() => { this.setQuery(input.value); this.paintConnections(); }, NAV_DEBOUNCE_MS); };
    this.navList = nav.appendChild(el('div', '', 'graph-ng-connections')); this.navList.id = this.navId; this.navList.setAttribute('aria-label', 'Direct connections by declared group');
    if (initial && (direct <= ROWS || this.navSections.length === 1)) for (const section of this.navSections) this.navOpen.add(section.key);
    this.paintConnections();
  }
  /** Set the query now, dropping any pending debounce; a new query starts at the first page. */
  private setQuery(q: string) {
    clearTimeout(this.navTimer); this.navTimer = undefined;
    if (q !== this.navQuery) this.navShown = ROWS;
    this.navQuery = q; if (this.navInput) this.navInput.value = q;
  }
  private title = (e: ConnectionEntry) => entryTitle(e, this.host);
  /** One connection button; search results also name the group. */
  private row(entry: ConnectionEntry, flat: boolean) {
    const title = this.title(entry), id = title !== entry.name ? ' (' + entry.name + ')' : '', group = flat ? ' in ' + entry.label : '';
    const row = button('', `Go to ${title}${id}${group}: ${entry.relations.join(', ')}`, () => this.go(entry.node), 'graph-ng-connection');
    const swatch = row.appendChild(el('span', '', 'graph-ng-swatch')); swatch.style.background = this.host.color(entry.node);
    const text = row.appendChild(el('span', '', 'graph-ng-connection-text')); text.append(el('span', title, 'graph-ng-connection-title'));
    const meta = text.appendChild(el('span', '', 'graph-ng-connection-meta'));
    if (flat) meta.append(el('span', entry.label, 'graph-ng-connection-label'));
    if (id) meta.append(el('span', entry.name, 'graph-ng-connection-id'));
    meta.append(el('span', entry.relations.join(', '), 'graph-ng-connection-relation')); row.title = [title, entry.name, ...(flat ? [entry.label] : []), ...entry.relations].join('\n');
    row.onmouseenter = row.onfocus = () => this.host.cue(entry.node); row.onmouseleave = row.onblur = () => this.host.cue(-1); this.rows.push(row);
    return row;
  }
  /** Repaint only results: typing never replaces the input, moves the camera or changes selection.
   * A query shows one flat page of matches; an empty query shows the sections as the user left them. */
  private paintConnections() {
    const list = this.navList!, sections = this.navSections, searching = !!this.navQuery.trim();
    const total = sections.reduce((sum, s) => sum + s.entries.length, 0);
    // A hub with some (not all) sections open lights only those sections on the graph.
    const open = sections.filter(s => this.navOpen.has(s.key)), scoped = total > ROWS && open.length > 0 && open.length < sections.length;
    list.textContent = ''; list.scrollTop = 0; this.rows = []; this.size = undefined;
    if (searching) {
      const found = filterConnections(sections, this.navQuery, this.title), shown = this.navShown;
      this.navStatus!.textContent = `${found.length.toLocaleString()} of ${total.toLocaleString()} connections`;
      if (!found.length) list.append(el('div', 'No matching connections. Try another name, ID or group.', 'graph-ng-explore-note'));
      for (const entry of found.slice(0, shown)) list.append(this.row(entry, true));
      if (found.length > shown) list.append(button(`Show ${Math.min(ROWS, found.length - shown)} more`, 'Show more matching connections', () => {
        const scroll = list.scrollTop; this.navShown += ROWS; this.paintConnections(); list.scrollTop = scroll; this.rows[shown]?.focus();
      }, 'graph-ng-connection-more'));
    } else {
      this.navStatus!.textContent = `${total.toLocaleString()} direct connection${total === 1 ? '' : 's'} in ${sections.length.toLocaleString()} group${sections.length === 1 ? '' : 's'}`;
      if (!total) list.append(el('div', 'No direct connections', 'graph-ng-explore-note'));
      for (const section of sections.slice(0, this.navGroupLimit)) {
        const { key, label, entries } = section, expanded = this.navOpen.has(key);
        const block = list.appendChild(el('section', '', 'graph-ng-connection-section'));
        const toggle = block.appendChild(button('', `${label}, ${entries.length} connections`, () => {
          const scroll = list.scrollTop;
          if (expanded) this.navOpen.delete(key); else this.navOpen.add(key);
          this.paintConnections(); list.scrollTop = scroll;
          (list.querySelector(`[data-group="${key}"]`) as HTMLElement | null)?.focus();
        }, 'graph-ng-connection-group'));
        toggle.dataset.group = String(key); toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-controls', `${this.navId}-${key}`);
        toggle.append(el('span', expanded ? '⌄' : '›', 'graph-ng-section-arrow'), el('span', label), el('span', entries.length.toLocaleString(), 'graph-ng-count'));
        const body = block.appendChild(el('div')); body.id = `${this.navId}-${key}`; body.hidden = !expanded;
        if (!expanded) continue;
        if (scoped) {
          const on = this.navSecond.has(key), two = body.appendChild(button('Neighbours of neighbours', `Show neighbours of neighbours for ${label} on the graph`, () => {
            const scroll = list.scrollTop; if (on) this.navSecond.delete(key); else this.navSecond.add(key);
            this.paintConnections(); list.scrollTop = scroll; (list.querySelector(`[data-second="${key}"]`) as HTMLElement | null)?.focus();
          }, 'graph-ng-section-second'));
          two.dataset.second = String(key); two.setAttribute('aria-pressed', String(on));
        }
        const limit = this.navPages.get(key) ?? ROWS;
        for (const entry of entries.slice(0, limit)) body.append(this.row(entry, false));
        if (entries.length > limit) body.append(button(`Show ${Math.min(ROWS, entries.length - limit)} more`, `Show more connections in ${label}`, () => {
          const scroll = list.scrollTop, at = this.rows.findIndex(r => body.contains(r)); this.navPages.set(key, limit + ROWS); this.paintConnections(); list.scrollTop = scroll; this.rows[at + limit]?.focus();
        }, 'graph-ng-connection-more'));
      }
      if (sections.length > this.navGroupLimit) list.append(button('Show more groups', `Show ${Math.min(100, sections.length - this.navGroupLimit)} more groups`, () => {
        const scroll = list.scrollTop, next = sections[this.navGroupLimit]!; this.navGroupLimit += 100; this.paintConnections(); list.scrollTop = scroll;
        (list.querySelector(`[data-group="${next.key}"]`) as HTMLElement | null)?.focus();
      }));
    }
    this.host.disclose?.(this.node, scoped ? open.flatMap(s => s.entries.map(e => e.node)) : undefined, scoped ? open.filter(s => this.navSecond.has(s.key)).flatMap(s => s.entries.map(e => e.node)) : []);
    // Clear any obsolete row cue and schedule the host to remeasure the changed card rectangle.
    this.host.cue(-1);
  }
  /** Reflect the host's lens state on the Lens action (aria-pressed). */
  syncLens() { if (this.lensToggle && this.node >= 0) this.lensToggle.setAttribute('aria-pressed', String(!!this.host.lensed?.(this.node))); }
  /** "+N more" opens a predictable navigator destination, not an unbounded flat list. */
  showAll() {
    if (this.node < 0) return;
    this.setQuery(''); this.navPages.clear(); this.navOpen.clear();
    const first = this.navSections[0]; if (first) this.navOpen.add(first.key);
    this.paintConnections(); this.navInput!.focus({ preventScroll: true }); this.navList!.scrollTop = 0;
  }
  /** Card keys: Escape clears the find box, then closes; Alt+Left/Right go back/forward; Down from the
   * box enters the rows, arrows/Home/End move through them, Up from the first returns; Enter travels. */
  key(e: KeyboardEvent) {
    const inBox = e.target === this.navInput, i = this.rows.indexOf(e.target as HTMLElement), alt = e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
    if (inBox && e.key === 'ArrowDown' && this.rows[0]) this.rows[0].focus();
    // The card's input owns text-editing keys (especially L/R); never forward them to graph actions.
    else if (inBox && e.key !== 'Escape' && !alt) { e.stopPropagation?.(); return true; }
    else if (e.key === 'Escape' && (this.navQuery || this.navInput?.value)) { this.setQuery(''); this.paintConnections(); this.navInput!.focus({ preventScroll: true }); }
    else if (e.key === 'Escape') this.host.close();
    else if (alt) this.step(e.key === 'ArrowLeft' ? -1 : 1);
    else if (i === 0 && e.key === 'ArrowUp' && this.navInput) this.navInput.focus({ preventScroll: true });
    else if (i >= 0 && e.key === 'Enter') this.rows[i]!.click();
    else {
      const last = this.rows.length - 1, move = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: last }[e.key];
      if (i < 0 || move === undefined) return false;
      this.rows[Math.max(0, Math.min(last, move))]!.focus();
    }
    e.preventDefault(); e.stopPropagation?.(); return true;
  }
}
/** Persistent anchor, exact mask count, explicit reach and a single exit. */
export function isolationBar(bar: HTMLElement, name: string, hops: number, count: number, expanded: number, partial: boolean, setHops: (hops: number) => void, clear: () => void) {
  bar.textContent = ''; if (!name) return;
  const title = bar.appendChild(el('span', `Only connections of ${name}, reach ${hops}, ${count.toLocaleString()} ${count === 1 ? 'note' : 'notes'}`, 'graph-ng-count'));
  title.setAttribute('role', 'status');
  const controls = bar.appendChild(el('div', '', 'graph-ng-reach')); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Reach');
  controls.append(el('span', 'Reach'));
  for (let h = 0; h <= 3; h++) { const b = controls.appendChild(button(String(h), `Reach ${h} hops`, () => setHops(h), 'graph-ng-count')); b.setAttribute('aria-pressed', String(h === hops)); }
  controls.append(closeButton(clear));
  bar.append(el('small', partial ? 'Partial: scan limit reached' : expanded ? 'Expanded beyond reach. Change reach to reset.' : 'Expand a + badge to reveal hidden neighbours.'));
}
