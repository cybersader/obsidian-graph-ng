import { test, expect, beforeAll, afterAll } from 'bun:test';
import { connectionGroups, navigatorSections, filterConnections, entryTitle, ConnectionCard, NAV_DEBOUNCE_MS, type CardHost, reach, neighbourhood, NavHistory, dockCard, sheetCard, DOCK_ROOM, SHEET_WIDTH } from '../src/connection-card';
import { incidentEdges } from '../src/render-data';
import { buildProjection } from '../src/core/projection';
import { validateDeclaration, type GraphDeclaration } from '../src/core/declaration';
import { renderProjection } from '../src/render-projection';

// Synthetic graph. Types: 0 'cites', 1 'part of'. Node 9 is a relationship-note dot owned by row 0
// (carrierNodes[9] = 1 = carrier row 0 + 1); its far endpoint 10 is a direct connection of 0.
const NONE = 0xffffffff;
const rows: [number, number, number, number][] = [
  [0, 1, 0, NONE], [0, 2, 0, NONE], [3, 0, 1, NONE], [0, 4, 1, NONE], [0, 1, 1, NONE], [1, 5, 0, NONE], [5, 6, 0, NONE], [2, 1, 0, NONE],
  [0, 9, 0, 0], [9, 10, 0, 0], [7, 7, 0, NONE], [4, 8, 0, NONE],
];
const n = 11;
function graph() {
  const p = { nodeCount: n, source: Uint32Array.from(rows, r => r[0]), target: Uint32Array.from(rows, r => r[1]), type: Uint32Array.from(rows, r => r[2]), types: ['cites', 'part of'], carrier: Uint32Array.from(rows, r => r[3]), carrierNodes: new Uint32Array(n) };
  p.carrierNodes[9] = 1;
  const inc = incidentEdges(p), degree = (i: number) => inc.offsets[i + 1]! - inc.offsets[i]!;
  return { p, inc, degree, order: (a: number, b: number) => degree(b) - degree(a) || a - b, all: new Uint8Array(n).fill(1), on: () => true };
}

test('connections group by type and direction; groups largest first, then type, outgoing first; rows by degree then name', () => {
  const g = graph(), { groups, direct } = connectionGroups(0, g.inc, g.p, g.on, g.all, g.order);
  expect(groups.map(x => [x.type, x.out, x.nodes])).toEqual([
    // 1 has degree 4 and 2 degree 2; the dot 9 is transparent, listing its far endpoint 10.
    ['cites', true, [1, 2, 10]],
    ['part of', true, [1, 4]],
    ['part of', false, [3]],
  ]);
  // Distinct notes: 1 appears in two groups but counts once; the dot itself is not a row.
  expect(direct).toBe(5);
  // Hidden types and filtered notes leave the list; a hidden or missing focus has none.
  const typed = connectionGroups(0, g.inc, g.p, e => g.p.type[e] === 0, g.all, g.order);
  expect(typed.groups.map(x => x.type)).toEqual(['cites']);
  const vis = g.all.slice(); vis[1] = 0; vis[10] = 0;
  const filtered = connectionGroups(0, g.inc, g.p, g.on, vis, g.order);
  expect(filtered.groups.map(x => [x.type, x.out, x.nodes])).toEqual([['cites', true, [2]], ['part of', true, [4]], ['part of', false, [3]]]); expect(filtered.direct).toBe(3);
  expect(connectionGroups(-1, g.inc, g.p, g.on, g.all, g.order)).toEqual({ groups: [], direct: 0 });
  vis[0] = 0; expect(connectionGroups(0, g.inc, g.p, g.on, vis, g.order).direct).toBe(0);
  // Self-loops never list the focus.
  expect(connectionGroups(7, g.inc, g.p, g.on, g.all, g.order)).toEqual({ groups: [], direct: 0 });
  // Ties sort by the supplied comparator (here: names), deterministically.
  const names = ['z', 'b', 'a', 'c', 'd', '', '', '', '', '', 'e'], byName = (a: number, b: number) => names[a]!.localeCompare(names[b]!);
  expect(connectionGroups(0, g.inc, g.p, g.on, g.all, byName).groups[0]!.nodes).toEqual([2, 1, 10]);
});

function carrierFixture(sources: number[], targets: number[]) {
  const dot = 3, links = [...sources.map(n => [n, dot]), ...targets.map(n => [dot, n])];
  const p = { nodeCount: 4, source: Uint32Array.from(links, e => e[0]!), target: Uint32Array.from(links, e => e[1]!),
    type: new Uint32Array(links.length), types: ['relates'], carrier: new Uint32Array(links.length), carrierNodes: Uint32Array.of(0, 0, 0, 1) };
  return { p, inc: incidentEdges(p), visible: Uint8Array.of(1, 1, 1, 1) };
}

test('card final review: a real shared carrier keeps each declaring rule and counts its neighbour once', () => {
  const d: GraphDeclaration = { version: 2, identity: [{ key: 'item' }], groups: [], colors: [], columns: [], display: { reifiedAsNodes: true }, edges: [
    { kind: 'reified', name: 'cites', sourceProperty: 'citing', targetProperty: 'cited' },
    { kind: 'reified', name: 'supports', sourceProperty: 'supporting', targetProperty: 'supported' },
  ] };
  validateDeclaration(d);
  const card = (supported: string, supporting = 'A') => {
    const rows = ['A', 'B', 'C', 'D'].map(item => ({ path: item + '.md', properties: { item } }));
    const raw = buildProjection([...rows, { path: 'R.md', properties: { item: 'R', citing: 'A', cited: 'B', supporting, supported } }], d);
    const p = renderProjection(raw, d), visible = new Uint8Array(p.nodeCount).fill(1);
    expect(p.rule).toBe(raw.rule);
    expect(renderProjection(raw, { ...d, edges: d.edges.slice(0, 1) })).not.toHaveProperty('rule');
    expect(renderProjection(raw, { ...d, display: { reifiedAsNodes: false } })).not.toHaveProperty('rule');
    return connectionGroups(raw.paths.indexOf('A.md'), incidentEdges(p), p, () => true, visible, (a, b) => a - b);
  };
  expect(card('B')).toEqual({ direct: 1, groups: [{ type: 'cites', out: true, nodes: [1] }, { type: 'supports', out: true, nodes: [1] }] });
  expect(card('C').groups).toEqual([{ type: 'cites', out: true, nodes: [1] }, { type: 'supports', out: true, nodes: [2] }]);
  // Distinct rules can intentionally share a display type. Neither name nor type identifies the paired leg.
  for (const edge of d.edges) if (edge.kind === 'reified') edge.type = 'link';
  expect(card('D', 'C')).toEqual({ direct: 1, groups: [{ type: 'link', out: true, nodes: [1] }] });
});

test('card second review: carrier crossings exclude co-sources with and without the target visible', () => {
  const { p, inc, visible } = carrierFixture([0, 2], [1]);
  const card = (n: number) => connectionGroups(n, inc, p, () => true, visible, (a, b) => a - b);
  expect(card(0).groups).toEqual([{ type: 'relates', out: true, nodes: [1] }]);
  expect(card(1).groups).toEqual([{ type: 'relates', out: false, nodes: [0, 2] }]);
  visible[1] = 0; expect(card(0)).toEqual({ direct: 0, groups: [], hidden: true });
});

test('card second review: proving a hidden repeated self-relationship empty inspects linear incident rows', () => {
  const { p, inc, visible } = carrierFixture(Array(128).fill(0), [0]);
  let inspected = 0;
  const edges = new Proxy(inc.edges, { get(target, key) { if (typeof key === 'string' && /^\d+$/.test(key)) inspected++; return Reflect.get(target, key, target); } });
  expect(connectionGroups(0, { ...inc, edges }, p, () => false, visible, (a, b) => a - b)).toEqual({ groups: [], direct: 0 });
  // Visible pass + unfiltered pass over the anchor, and at most one carrier scan per direction.
  expect(inspected).toBeLessThanOrEqual(4 * p.source.length);
});

test('show only connections: focus plus direct connections, 2-hop adds neighbours of neighbours, dots kept', () => {
  const g = graph(), one = reach(0, g.inc, g.p, g.on, g.all, 1), two = reach(0, g.inc, g.p, g.on, g.all, 2);
  expect([...one.nodes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 9, 10]);
  expect([one.direct, one.second, one.truncated]).toEqual([5, 0, false]);
  expect([...two.nodes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 8, 9, 10]);
  expect([two.direct, two.second, two.truncated]).toEqual([5, 2, false]);
  // The host filter bounds the set; the 2-hop scan reports truncation instead of silently stopping.
  const vis = g.all.slice(); vis[4] = 0;
  expect([...reach(0, g.inc, g.p, g.on, vis, 2).nodes]).not.toContain(4);
  expect([...reach(0, g.inc, g.p, g.on, vis, 2).nodes]).not.toContain(8);
  expect(reach(0, g.inc, g.p, g.on, g.all, 2, 0).truncated).toBe(true);
  expect(reach(0, g.inc, g.p, g.on, new Uint8Array(n), 2).nodes.size).toBe(0);
});

test('navigation history: back, forward, a new visit drops the forward branch, repeats collapse, bounded', () => {
  const h = new NavHistory(4);
  for (const v of [1, 2, 3]) h.visit(v);
  expect(h.go(-1)).toBe(2); expect(h.go(-1)).toBe(1); expect(h.go(-1)).toBeUndefined(); expect(h.at).toBe(0);
  expect(h.go(1)).toBe(2); h.visit(7); expect(h.items).toEqual([1, 2, 7]); expect(h.go(1)).toBeUndefined();
  h.visit(7); expect(h.items).toEqual([1, 2, 7]);
  for (const v of [8, 9, 10]) h.visit(v);
  expect(h.items).toEqual([7, 8, 9, 10]); expect(h.at).toBe(3);
  h.clear(); expect(h.go(-1)).toBeUndefined(); expect(h.items).toEqual([]);
});

test('the card docks to the top-right edge (no note position involved); narrow views get a bottom sheet', () => {
  expect(dockCard(800, 600, 320, 200)).toEqual([472, 8, 320, 200]);
  // Wider than the view: pinned to the left margin, never off screen.
  expect(dockCard(600, 400, 700, 200, 8, 0, 'side')).toEqual([8, 8, 700, 200]);
  expect(dockCard(SHEET_WIDTH - 1, 600, 300, 240)).toEqual([0, 360, SHEET_WIDTH - 1, 240]);  // An open tools panel over the right 368 px: the card docks left of it, or becomes a sheet across what is left.
  expect(dockCard(800, 600, 320, 200, 8, 368)).toEqual([0, 400, 432, 200]); expect(sheetCard(800, 368)).toBe(true);
  expect(sheetCard(950, 368, 'side')).toBe(true); expect(sheetCard(1600, 368, 'side')).toBe(false);
  expect(sheetCard(950, 0, 'sheet')).toBe(true); expect(sheetCard(700, 0, 'side')).toBe(false);
  expect(sheetCard(800, 800 - DOCK_ROOM + 1)).toBe(true); expect(dockCard(800, 600, 320, 200, 8, 500)).toEqual([0, 400, 300, 200]);
});

test('history pruning preserves the current stop and both branches while dropping unavailable indices', () => {
  const h = new NavHistory(); for (const n of [0, 1, 2, 3, 4]) h.visit(n);
  h.go(-2); h.retain(n => n !== 1 && n !== 3);
  expect(h.items).toEqual([0, 2, 4]); expect(h.at).toBe(1); expect(h.go(-1)).toBe(0); expect(h.go(2)).toBe(4);
  h.retain(() => false); expect(h.items).toEqual([]); expect(h.at).toBe(-1);
});


test('navigator deduplicates notes across relationships and preserves declared group keys, not guessed names', () => {
  const host = { name: (n: number) => `ID-${n}`, title: (n: number) => n === 1 ? '<b>Recovery checks</b>' : '', group: (n: number) => ({ key: n % 2, label: 'Same label' }) };
  const grouped = navigatorSections([
    { type: 'supports', out: true, nodes: [1, 2, 3] },
    { type: 'supports', out: false, nodes: [1] },
    { type: 'related', out: true, nodes: [1, 4] },
  ], host), title = (e: Parameters<typeof entryTitle>[0]) => entryTitle(e, host);
  expect(grouped.map(g => [g.key, g.entries.length])).toEqual([[0, 2], [1, 2]]);
  const row = grouped[1]!.entries[0]!;
  expect(title(row)).toBe('<b>Recovery checks</b>'); expect(row.name).toBe('ID-1'); expect(row.label).toBe('Same label');
  expect(row.relations).toEqual(['→ supports', '← supports', '→ related']);
  expect(title(grouped[0]!.entries[0]!)).toBe('ID-2');
  expect(filterConnections(grouped, 'same RECOVERY id-1 related', title).map(r => r.node)).toEqual([1]);
  expect(filterConnections(grouped, 'no match', title)).toEqual([]);
  expect(filterConnections(grouped, '   ', title).length).toBe(4);
});

test('navigator fallback, bounded title and hub filtering fetch each title once, and only when searched', () => {
  let lookups = 0;
  const host = { name: (n: number) => `ID-${n}`, title: (n: number) => { lookups++; return n === 1 ? 'x'.repeat(400) : n % 2 ? 'Access review' : 'Recovery check'; } };
  const sections = navigatorSections([{ type: 'maps', out: true, nodes: Array.from({ length: 221 }, (_, i) => i + 1) }], host);
  const title = (e: Parameters<typeof entryTitle>[0]) => entryTitle(e, host);
  expect(lookups).toBe(0);
  expect(sections[0]!.label).toBe('Ungrouped'); expect(title(sections[0]!.entries[0]!).length).toBe(256);
  expect(filterConnections(sections, 'recovery', title).length).toBe(110);
  expect(filterConnections(sections, 'ID-221', title).map(r => r.node)).toEqual([221]);
  expect(lookups).toBe(221);
});

/** Just enough DOM for the card: no layout, no native events beyond the handler properties it sets. */
class El {
  children: El[] = []; parent: El | null = null; attrs: Record<string, string> = {}; style: Record<string, string> = {}; dataset: Record<string, string> = {};
  open = false; hidden = false; disabled = false; className = ''; id = ''; title = ''; value = ''; type = ''; placeholder = ''; maxLength = 0; scrollTop = 0; text = '';
  onclick?: (e: any) => void; oninput?: () => void; onfocus?: () => void; onblur?: () => void;
  static active: El | null = null;
  constructor(readonly tagName: string) {}
  get textContent(): string { return this.text + this.children.map(c => c.textContent).join(''); }
  set textContent(v: string) { this.children = []; this.text = v; }
  appendChild(c: El) { c.parent = this; this.children.push(c); return c; }
  append(...cs: El[]) { cs.forEach(c => this.appendChild(c)); }
  createEl(tag: string, options: any = {}) { const c = this.appendChild(new El(tag)); c.className = options.cls ?? ''; c.textContent = options.text ?? ''; for (const [k, v] of Object.entries(options.attr ?? {})) c.setAttribute(k, String(v)); return c; }
  createSpan(options?: any) { return this.createEl('span', options); }
  empty() { this.children = []; this.text = ''; }
  contains(n: unknown): boolean { return n === this || this.children.some(c => c.contains(n)); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  querySelector(selector: string) { return this.all().find(c => selector.startsWith('[data-group=') ? c.dataset.group === selector.split('"')[1] : selector.startsWith('.') ? c.className.split(' ').includes(selector.slice(1)) : c.tagName === selector) ?? null; }
  focus() { El.active = this; this.onfocus?.(); }
  click() { this.onclick?.({ preventDefault() {} }); }
  all(): El[] { return this.children.flatMap(c => [c, ...c.all()]); }
  find(cls: string) { return this.all().filter(c => c.className === cls); }
  tag(tag: string) { return this.all().filter(c => c.tagName === tag); }
}
const g = globalThis as Record<string, unknown>, real = { document: g.document, setTimeout: g.setTimeout, clearTimeout: g.clearTimeout };
/** Manual timers: the debounce runs only when a test flushes it. */
let timers: { run: () => void; ms: number }[] = [];
beforeAll(() => {
  g.document = { createElement: (tag: string) => new El(tag), get activeElement() { return El.active; } };
  g.setTimeout = (run: () => void, ms: number) => { const t = { run, ms }; timers.push(t); return t; };
  g.clearTimeout = (t: unknown) => { timers = timers.filter(x => x !== t); };
});
afterAll(() => { for (const [k, v] of Object.entries(real)) if (v === undefined) delete g[k]; else g[k] = v; });

/** A focus note 0 with `count` connections spread over three groups; counts title lookups per connection. */
function rig(count = 120, extra: Partial<CardHost> = {}) {
  const lookups: number[] = [], calls: string[] = [], nodes = Array.from({ length: count }, (_, i) => i + 1);
  const host: CardHost = {
    name: n => `ID-${n}`, color: () => 'red', title: n => { if (n) lookups.push(n); return `Note ${n}`; },
    group: n => ({ key: n % 3, label: `Group ${n % 3}` }), groups: () => ({ groups: [{ type: 'maps', out: true, nodes }], direct: count }),
    isolated: () => false, act() {}, travel: n => calls.push(`travel ${n}`), cue() {}, close: () => calls.push('close'), ...extra,
  };
  const root = new El('div'), card = new ConnectionCard(root as unknown as HTMLElement, host); timers = []; card.show(0);
  const input = root.tag('input')[0]!, list = root.find('graph-ng-connections')[0]!;
  const type = (text: string) => { input.value = text; input.oninput!(); };
  const flush = () => timers.splice(0).forEach(t => t.run());
  const key = (k: string, target: El = El.active!) => card.key({ key: k, target, altKey: false, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent);
  const more = () => list.find('graph-ng-connection-more')[0];
  return { card, root, input, list, lookups, calls, type, flush, key, more, rows: () => card.rows as unknown as El[], status: () => root.find('graph-ng-nav-status')[0]!.textContent };
}

test('find box debounces typing: one repaint per pause, not per keystroke', () => {
  const r = rig();
  r.type('i'); r.type('id'); r.type('id-1');
  expect(timers.map(t => t.ms)).toEqual([NAV_DEBOUNCE_MS]); expect(NAV_DEBOUNCE_MS).toBe(80);
  expect(r.status()).toBe('120 direct connections in 3 groups'); expect(r.rows()).toHaveLength(0);
  r.flush();
  expect(r.status()).toBe('32 matching connections'); expect(r.rows()).toHaveLength(32);
  // A redraw while typing is pending keeps the typed text instead of dropping it.
  r.type('id-12'); r.card.render(); expect(timers).toHaveLength(0);
  expect(r.root.tag('input')[0]!.value).toBe('id-12'); expect(r.status()).toBe('2 matching connections');
});

test('matches are one flat list of 50 rows with their group, paged by "Show 50 more"; clearing restores the sections', () => {
  const r = rig(120);
  // Open one section before searching; the query must not disturb it.
  r.list.find('graph-ng-connection-group').find(t => t.textContent.includes('Group 1'))!.click();
  const expanded = () => r.list.find('graph-ng-connection-group').map(t => t.attrs['aria-expanded']);
  const before = expanded(); expect(before.filter(x => x === 'true')).toHaveLength(1);
  r.type('note'); r.flush();
  expect(r.list.find('graph-ng-connection-section')).toHaveLength(0);
  expect(r.rows()).toHaveLength(50); expect(r.more()!.textContent).toBe('Show 50 more');
  expect(r.rows()[0]!.find('graph-ng-connection-label')[0]!.textContent).toMatch(/^Group \d$/);
  r.more()!.click(); expect(r.rows()).toHaveLength(100); expect(El.active).toBe(r.rows()[50]!); expect(r.more()!.textContent).toBe('Show 20 more');
  r.more()!.click(); expect(r.rows()).toHaveLength(120); expect(r.more()).toBeUndefined();
  // A new query starts again at one page.
  r.type('id-1'); r.flush(); expect(r.rows()).toHaveLength(32); r.type('note'); r.flush(); expect(r.rows()).toHaveLength(50);
  r.type(''); r.flush();
  expect(expanded()).toEqual(before); expect(r.rows()).toHaveLength(40); expect(r.list.find('graph-ng-connection-label')).toHaveLength(0);
});

test('find box keys: Down enters the results, Up returns, Enter travels, Escape clears then closes', () => {
  const r = rig();
  r.type('id-1'); r.flush(); r.input.focus();
  expect(r.key('ArrowDown')).toBe(true); expect(El.active).toBe(r.rows()[0]!);
  expect(r.key('ArrowDown')).toBe(true); expect(El.active).toBe(r.rows()[1]!);
  r.key('ArrowUp'); expect(El.active).toBe(r.rows()[0]!);
  r.key('ArrowUp'); expect(El.active).toBe(r.input);
  // Other keys in the box stay with the text field.
  expect(r.key('l')).toBe(true); expect(El.active).toBe(r.input);
  r.key('ArrowDown'); r.key('ArrowDown'); r.key('Enter');
  expect(r.calls).toEqual(['travel 15']);
  r.input.focus(); r.key('Escape');
  expect(r.input.value).toBe(''); expect(r.status()).toBe('120 direct connections in 3 groups'); expect(El.active).toBe(r.input); expect(r.calls).toEqual(['travel 15']);
  r.key('Escape'); expect(r.calls).toEqual(['travel 15', 'close']);
  // Escape also clears text still waiting on the debounce.
  r.type('pending'); r.key('Escape', r.input); expect(r.input.value).toBe(''); expect(timers).toHaveLength(0); expect(r.calls).toHaveLength(2);
});

test('titles are fetched only for drawn rows and memoized for the card build', () => {
  const r = rig(120), fresh = () => r.lookups.splice(0).length, toggle = () => r.list.find('graph-ng-connection-group')[0]!;
  expect(fresh()).toBe(0); // 120 connections over three closed sections: no rows, no titles
  toggle().click(); expect(fresh()).toBe(40);
  toggle().click(); toggle().click(); expect(fresh()).toBe(0); // repaints reuse the memo
  r.type('note'); r.flush(); expect(fresh()).toBe(80); // searching needs every title, each once
  r.type('id-1'); r.flush(); r.type(''); r.flush(); expect(fresh()).toBe(0);
  r.card.render(); expect(fresh()).toBe(40); // a new build fetches again, only for the 40 drawn rows
});

test('neighbourhood mask: zero through three hops, distinct frontier, transparent carriers and additive branches', () => {
  const g = graph(), run = (h: number, expanded = new Set<number>(), base = g.all, on = g.on) => neighbourhood(0, h, expanded, g.inc, g.p, on, base);
  expect([...reach(0, g.inc, g.p, g.on, g.all, 0).nodes]).toEqual([0]);
  expect([...reach(0, g.inc, g.p, g.on, g.all, 3).nodes]).toContain(6);
  const zero = run(0); expect([...zero.frontier]).toEqual([[0, 5]]); expect(zero.mask[9]).toBe(0);
  const one = run(1); expect(one.mask[9]).toBe(1); expect(one.mask[10]).toBe(1); expect([...one.frontier]).toEqual([[1, 1], [4, 1]]);
  const more = run(1, new Set([1, 5])); expect(more.mask[5]).toBe(1); expect(more.mask[6]).toBe(1); expect(more.mask[8]).toBe(0); expect(more.mask[4]).toBe(1);
  expect([...run(1).mask]).toEqual([...one.mask]);
  const base = g.all.slice(); base[1] = 0;
  const filtered = run(1, new Set([1, 5]), base); expect(filtered.mask[6]).toBe(0); expect(filtered.mask[5]).toBe(0); expect(filtered.mask[1]).toBe(0);
  expect([...run(3, new Set(), g.all, () => false).frontier]).toEqual([]);
  expect(run(3, new Set(), g.all, () => false).mask.reduce((a, b) => a + b)).toBe(1);
});
test('neighbourhood scan budget includes carrier fan-out and visibly reports incomplete traversal', () => {
  // One incoming source leg and 598 outgoing target legs, not 599 unrelated co-sources.
  const n = 600, source = new Uint32Array(n - 1), target = Uint32Array.from({ length: n - 1 }, (_, i) => i + 1);
  source[0] = 1; target[0] = 0;
  const p = { nodeCount: n, source, target, type: new Uint32Array(n - 1), types: ['link'], carrier: new Uint32Array(n - 1), carrierNodes: new Uint32Array(n) }; p.carrierNodes[0] = 1;
  const inc = incidentEdges(p), all = new Uint8Array(n).fill(1);
  const bounded = reach(1, inc, p, () => true, all, 1, 2); expect(bounded.truncated).toBe(true); expect(bounded.nodes.size).toBeLessThan(4);
  const result = neighbourhood(1, 3, new Set(), inc, p, () => true, all);
  expect(result.partial).toBe(true); expect(result.mask[1]).toBe(1);
});

test('neighbourhood remains bounded at 16k nodes / 55k edges and never admits excluded nodes', () => {
  const n = 16000, m = 55000, source = Uint32Array.from({ length: m }, (_, i) => i % n), target = Uint32Array.from(source, (v, i) => (v + 1 + (Math.floor(i / n) % 7) * 17) % n);
  const p = { nodeCount: n, source, target, type: new Uint32Array(m), types: ['edge'], carrier: new Uint32Array(m).fill(NONE), carrierNodes: new Uint32Array(n) };
  const base = new Uint8Array(n).fill(1); for (let i = 100; i < n; i += 31) base[i] = 0;
  let checked = 0;
  const result = neighbourhood(0, 3, new Set(), incidentEdges(p), p, () => { checked++; return true; }, base);
  expect(result.partial).toBe(false); expect(result.mask[0]).toBe(1); expect(result.mask.length).toBe(n);
  expect(checked).toBeLessThanOrEqual(200000);
  for (let i = 0; i < n; i++) if (!base[i]) expect(result.mask[i]).toBe(0);
  for (const [node, count] of result.frontier) { expect(result.mask[node]).toBe(1); expect(count).toBeGreaterThan(0); }
});

test('neighbourhood travel reveals: a shown target joins alone, with its linking dot, only while it touches the region', () => {
  const g = graph(), run = (h: number, shown: number[], base = g.all) => neighbourhood(0, h, new Set(), g.inc, g.p, g.on, base, shown);
  const ones = (mask: Uint8Array) => [...mask.keys()].filter(i => mask[i]);
  // Reach 0 plus the target 10: the relationship-note dot 9 that links it comes too, and nothing else.
  expect(ones(run(0, [10]).mask)).toEqual([0, 9, 10]);
  // 5 touches the region through 1; 6 then touches 5, in visit order. 8 (beyond 4) stays hidden.
  const chain = run(1, [5, 6]); expect(chain.mask[5]).toBe(1); expect(chain.mask[6]).toBe(1); expect(chain.mask[8]).toBe(0);
  expect(chain.frontier.get(1)).toBeUndefined(); expect(chain.frontier.get(4)).toBe(1);
  // A target that does not touch the region is not admitted; neither is a filtered one.
  expect(run(1, [6]).mask[6]).toBe(0);
  const base = g.all.slice(); base[5] = 0; expect(ones(run(1, [5, 6], base).mask)).toEqual(ones(run(1, []).mask));
  // Expanding a travel-revealed note works whatever the order: 5 is shown, then expanded to reach 6.
  expect(neighbourhood(0, 1, new Set([5]), g.inc, g.p, g.on, g.all, [5]).mask[6]).toBe(1);
  expect(run(1, [6, 5]).mask[6]).toBe(1);
});


test('card exposes two primary actions, keeps secondary actions in a closed disclosure, and removes duplicate visit chips', () => {
  const r = rig(3), primary = r.root.find('graph-ng-card-primary')[0]!, more = r.root.find('graph-ng-card-more')[0]!;
  expect(primary.tag('button').map(b => b.textContent)).toEqual(['Open note', 'Show only connections']);
  expect(more.open).toBe(false);
  expect(more.children).toHaveLength(2);
  expect(more.children[1]!.className).toBe('graph-ng-disclosure-body');
  expect(more.children[1]!.tag('button')).toHaveLength(4);
  expect(more.tag('summary')[0]!.textContent).toBe('More actions');
  expect(more.tag('button').map(b => b.textContent)).toEqual(['New tab', 'Open to the right', 'Focus here', 'Copy link']);
  more.open = true; more.tag('button')[0]!.focus(); r.key('Escape');
  expect(more.open).toBe(false); expect(El.active).toBe(more.tag('summary')[0]!); expect(r.calls).toEqual([]);
  r.card.show(1); expect(r.root.find('graph-ng-card-trail')).toEqual([]); expect(r.card.history.items).toEqual([0, 1]);
  r.key('Escape', r.root); expect(r.calls).toEqual(['close']);
});
test('group disclosures retain counts, declared names and focus after toggling', () => {
  const r = rig(), group = r.list.find('graph-ng-connection-group')[0]!;
  expect(group.tagName).toBe('summary'); expect(group.attrs['aria-expanded']).toBe('false');
  expect(group.children.at(-1)!.textContent).toBe('40'); expect(group.tag('svg')[0]!.attrs['data-icon']).toBe('chevron-right');
  group.click(); const next = r.list.find('graph-ng-connection-group')[0]!;
  expect(next.attrs['aria-expanded']).toBe('true'); expect(El.active).toBe(next); expect(r.rows()).toHaveLength(40);
});

test('card rows use concise referenced names, readable relationship endpoints and middle truncation', () => {
  const root = new El('div'), long = 'Source '.repeat(20) + 'ending';
  const host: CardHost = { name: n => n ? 'opaque-record' : 'Anchor', title: n => n ? long + ' note' : '', color: () => 'red', relationship: n => n ? { name: long + ' → Target', type: 'supports' } : undefined, groups: () => ({ groups: [{ type: 'link', out: true, nodes: [1] }], direct: 1 }), isolated: () => false, act() {}, travel() {}, cue() {}, close() {} };
  const card = new ConnectionCard(root as unknown as HTMLElement, host); card.show(0);
  const row = card.rows[0] as unknown as El, label = row.find('graph-ng-connection-title')[0]!;
  expect(row.attrs['aria-label']).toBeUndefined(); expect(row.attrs['aria-labelledby']).toBe(label.id);
  expect(label.textContent).toContain('…'); expect(label.textContent.endsWith('ending note')).toBe(true); expect(label.title).toBe(long + ' note');
  expect(row.textContent).toContain('→ Target (supports)'); expect(row.textContent).toContain('→ link'); expect(row.textContent).toContain('opaque-record');
  card.size = [320, 200]; row.focus(); expect(label.textContent).toBe(label.title); expect(card.size).toBeUndefined();
  card.size = [320, 240]; (row as any).onblur(); expect(label.textContent).toContain('…'); expect(card.size).toBeUndefined();
});

test('isolation retains traversed legs, not unrelated links between retained neighbours', () => {
  const g = graph(), run = (h = 1, expanded = new Set<number>(), on: (e: number) => boolean = g.on, shown: number[] = []) => neighbourhood(0, h, expanded, g.inc, g.p, on, g.all, shown);
  const first = run();
  expect([...first.edges].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 8, 9]);
  expect(first.mask[1]).toBe(1); expect(first.mask[2]).toBe(1); expect(first.edges.has(7)).toBe(false);
  expect(first.mask[9]).toBe(1); expect(first.mask[10]).toBe(1);
  expect(run(2).edges.has(7)).toBe(true); expect(run(1, new Set([1])).edges.has(5)).toBe(true);
  expect(run(1, new Set(), e => g.p.type[e] === 1).edges).toEqual(new Set([2, 3, 4]));
  const travel = run(1, new Set(), g.on, [5]); expect(travel.edges.has(5)).toBe(true); expect(travel.mask[5]).toBe(1);
});


test('card clarity: equal filenames retain their own group and full folder', () => {
  const folders = ['West/Long/'.repeat(8) + 'Shelf', 'East/Shelf'];
  const r = rig(1, { name: () => 'Index', path: n => `${folders[n]}/Index.md` });
  for (const n of [0, 1]) {
    r.card.show(n); const line = r.root.find('graph-ng-card-identity')[0]!;
    expect(line.textContent).toContain(`Group ${n}`); expect(line.title).toContain(folders[n]!);
    expect(line.textContent).toContain('Shelf');
  }
});
test('card identity shows a matching first folder only once and keeps the full note path in the tooltip', () => {
  for (const folder of ['Group 0', 'Group 0/Nearest', 'Group 01/Nearest']) {
    const path = `${folder}/Index.md`, line = rig(0, { path: () => path }).root.find('graph-ng-card-identity')[0]!;
    expect(line.children.map(c => c.textContent)).toEqual(folder === 'Group 0' ? ['Group 0'] : ['Group 0', folder.startsWith('Group 0/') ? 'Nearest' : folder]);
    expect(line.title).toContain(path);
  }
});
test('card clarity: only existing neighbours get declared parent and child roles', () => {
  // 0 has parents 1 and 4; 2 has parents 0 and 1. 4 is not a listed neighbour.
  const up = { offsets: Uint32Array.of(0, 2, 2, 4, 4, 4), targets: Uint32Array.of(1, 4, 0, 1) };
  for (const hierarchy of [up, undefined]) {
    const r = rig(3, { up: hierarchy }); const rows = r.rows(); expect(rows).toHaveLength(3);
    const meta = (n: number) => rows.find(row => row.textContent.includes(`Note ${n}`))!.find('graph-ng-connection-relation')[0]!.textContent;
    expect(meta(1)).toBe(hierarchy ? 'Parent, → maps' : '→ maps'); expect(meta(2)).toBe(hierarchy ? 'Child, → maps' : '→ maps'); expect(meta(3)).toBe('→ maps');
  }
});
test('card clarity: a folded empty card has a visible summary outside its navigator', () => {
  const r = rig(0); r.root.dataset.folded = 'true';
  expect(r.root.children.find(c => c.className === 'graph-ng-card-empty')?.textContent).toContain('No connections');
  const empty = r.root.find('graph-ng-card-empty')[0]!;
  expect(empty.attrs.role).toBe('status'); expect(r.root.children.indexOf(empty)).toBeGreaterThan(r.root.children.indexOf(r.root.find('graph-ng-card-primary')[0]!));
  expect(r.root.tag('input')).toHaveLength(0); expect(r.root.find('graph-ng-nav-status')).toHaveLength(0); expect(r.root.find('graph-ng-isolate-toggle')).toHaveLength(0);
  expect(rig(0, { isolated: () => true }).root.find('graph-ng-isolate-toggle')[0]!.textContent).toBe('Show all notes');
  expect(() => r.card.showAll()).not.toThrow(); expect(rig(1).root.find('graph-ng-card-empty')).toHaveLength(0);
});
test('card clarity: one connection is singular in the group accessibility label and live count', () => {
  const r = rig(1); expect(r.list.find('graph-ng-connection-group')[0]!.attrs['aria-label']).toBe('Group 1, 1 connection'); expect(r.status()).toBe('1 direct connection in 1 group');
});

test('card review: hidden type and hidden neighbour qualify the empty status but self-loops do not', () => {
  const g = graph(), mask = g.all.slice(); mask[0] = 0;
  for (const [node,on,vis,want] of [[6,()=>false,g.all,'No connections in this view'],[3,g.on,mask,'No connections in this view'],[7,g.on,g.all,'No connections']] as const) {
    const r=rig(0,{groups:()=>connectionGroups(node,g.inc,g.p,on,vis,g.order)});
    const status=r.root.find('graph-ng-card-empty')[0]!; expect(status.attrs.role).toBe('status'); expect(status.text).toBe(want);
  }
});
test('card review: parent row identifies the travelled relationship note and its actual mentions edge', () => {
  const r=rig(1,{ name:n=>n?'R':'C', title:()=>'',up:{offsets:Uint32Array.of(0,1,1),targets:Uint32Array.of(1)}, relationship:()=>({name:'S → T',type:'relates'}),groups:()=>({groups:[{type:'mentions',out:true,nodes:[1]}],direct:1}) });
  const row=r.rows()[0]!; expect(row.find('graph-ng-connection-title')[0]!.textContent).toBe('R'); expect(row.textContent).toContain('S → T'); expect(row.textContent).toContain('relates'); expect(row.textContent).toContain('Parent, → mentions'); row.click(); expect(r.calls).toEqual(['travel 1']);
});
test('card review: leaving isolation from an empty card focuses Open note', () => {
  let active=true;const r=rig(0,{isolated:()=>active,act:()=>{active=false;r.card.render();}});const old=r.root.find('graph-ng-isolate-toggle')[0]!;old.focus();old.click();expect(El.active).toBe(r.root.find('mod-cta')[0]!);
});


test('card second review: large endpoint caption has bounded readable text and a full tooltip', () => {
  const endpoints = Array.from({ length: 300 }, (_, i) => `Note ${i}`).join(', ') + ' → Last', caption = `${endpoints} (relates)`;
  const r = rig(1, { name: n => n ? 'Destination' : 'Selected', title: () => '', relationship: () => ({ name: endpoints, type: 'relates' }), groups: () => ({ groups: [{ type: 'mentions', out: true, nodes: [1] }], direct: 1 }) });
  const row = r.rows()[0]!, secondary = row.find('graph-ng-endpoints')[0]!, detail = row.find('graph-ng-connection-relation')[0]!;
  expect(secondary.textContent.length).toBeLessThanOrEqual(72); expect(secondary.textContent).toContain('…'); expect(secondary.title).toBe(caption);
  expect(row.attrs['aria-describedby']).toBe(detail.id); expect(detail.textContent).not.toContain(endpoints); expect(detail.textContent).toContain('→ mentions');
  expect(row.find('graph-ng-connection-title')[0]!.textContent).toBe('Destination');
});
