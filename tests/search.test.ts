import { test, expect, beforeAll, afterAll } from 'bun:test';
import { matchRank, rankMatches, searchKey, searchSteps, type SearchHit } from '../src/core/explore';
import { encodeStrings } from '../src/core/columns';
import type { Projection } from '../src/core/projection';
import { actions, type RendererControls } from '../src/interaction';
import { omnibox, searchable, invalidateSearch, disposeSearch, SEARCH_DEBOUNCE_MS, type SearchSource } from '../src/search';
import type { RenderProjection } from '../src/render-projection';
import { workingText } from '../src/working';

/** Just enough DOM for the find box: no layout, no events beyond the handler properties it sets. */
class El {
  children: El[] = []; parentElement: El | null = null; attrs: Record<string, string> = {}; style: Record<string, string> = {};
  hidden = false; className = ''; id = ''; value = ''; type = ''; placeholder = ''; maxLength = 0; spellcheck = true; text = '';
  [handler: `on${string}`]: ((e?: any) => void) | undefined | null;
  static active: El | null = null;
  constructor(readonly tagName: string) {}
  get lastElementChild(): El | null { return this.children.at(-1) ?? null; }
  addClass(cls: string) { if (!this.className.split(' ').includes(cls)) this.className = [this.className, cls].filter(Boolean).join(' '); }
  get textContent(): string { return this.text + this.children.map(c => c.textContent).join(''); }
  set textContent(v: string) { this.children = []; this.text = v; }
  empty() { this.textContent = ''; }
  appendChild(c: El) { c.parentElement = this; this.children.push(c); return c; }
  createEl(tag: string, options: any = {}) { const c = this.appendChild(new El(tag)); c.className = options.cls ?? ''; c.textContent = options.text ?? ''; for (const [k, v] of Object.entries(options.attr ?? {})) c.setAttribute(k, String(v)); return c; }
  createSpan(options?: any) { return this.createEl('span', options); }
  addEventListener(type: string, fn: (e: any) => void) { this[`on${type}`] = fn; }
  removeEventListener(type: string) { this[`on${type}`] = null; }
  contains(n: unknown): boolean { return n === this || this.children.some(c => c.contains(n)); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  focus() { El.active = this; }
  select() {}
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; }
  find(cls: string): El[] { return this.children.flatMap(c => [...(c.className === cls ? [c] : []), ...c.find(cls)]); }
}
const g = globalThis as { document?: unknown }, real = g.document;
beforeAll(() => { g.document = { createElement: (tag: string) => new El(tag) }; });
afterAll(() => { if (real === undefined) delete g.document; else g.document = real; });

const NAMES = ['Zeta Alpha', 'alpha', 'Alphabet soup', 'Beta', 'Gamma', 'hidden alpha'];
const IDS = ['z-1', 'a-1', 'alp-2', 'ALPHA-beta', 'g', 'h'];
const paths = (names: string[]) => names.map(n => `Folder/${n}.md`);
/** The worker's view (paths and identities) and the main realm's (packed paths and edges only). */
function worker(names = NAMES, ids = IDS) { return { paths: paths(names), identities: ids } as unknown as Projection; }
function render(names = NAMES, pairs: [number, number][] = [[1, 0], [1, 2], [1, 3], [2, 3]]): RenderProjection {
  // Incidence CSR offsets, as buildProjection makes them (each row counts at both ends).
  const offsets = new Uint32Array(names.length + 1); for (const [a, b] of pairs) { offsets[a + 1]!++; offsets[b + 1]!++; } for (let i = 1; i < offsets.length; i++) offsets[i]! += offsets[i - 1]!;
  return { nodeCount: names.length, paths: encodeStrings(paths(names)), offsets, source: Uint32Array.from(pairs, p => p[0]), target: Uint32Array.from(pairs, p => p[1]), type: new Uint32Array(pairs.length), types: [], carrier: new Uint32Array(pairs.length), carrierNodes: new Uint32Array(names.length), quarantined: [], groups: [] };
}
function drain<T>(steps: Generator<void, T>) { let s = steps.next(), yields = 0; while (!s.done) { yields++; s = steps.next(); } return { value: s.value, yields }; }
function rig(p = render(), w = worker(), visible = Uint8Array.from({ length: p.nodeCount }, (_, i) => +(i !== 5)), rank?: SearchSource['rank']) {
  const stage = new El('div'), canvas = new El('canvas'); stage.appendChild(canvas);
  const calls: string[] = [], filters: string[] = [], masks: Uint8Array[] = [];
  let cardNode = -1;
  const host = {
    canvas, live: true, width: 200, height: 300, visible, selected: -1, hovered: -1, focusNode: -1, lensNode: -1, edgeCard: false, isolated: false,
    get cardNode() { return cardNode; },
    groupLabel: () => '<Declared group>',
    openable: (n: number) => !!visible[n],
    screenPoint: (n: number) => ({ x: n * 100 - 50, y: 40 }),
    focusCanvas: () => { calls.push('focus'); canvas.focus(); },
    flyToNote: (n: number) => { calls.push(`fly ${n}`); cardNode = n; },
    selectNote: (n: number) => { calls.push(`select ${n}`); cardNode = -1; },
    setCamera: () => calls.push('camera'), flyTo: () => calls.push('camera'), setHover: () => calls.push('hover'),
  } as unknown as RendererControls;
  const source: SearchSource = {
    projection: () => p,
    rank: rank ?? (async (q, keep) => { masks.push(keep); return drain(searchSteps(w, q, keep)).value.map(h => h.node); }),
    filter: q => filters.push(q),
  };
  searchable(stage as unknown as HTMLElement, source);
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => {
    let prevented = false;
    const e = { key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, repeat: false, target: canvas, preventDefault: () => { prevented = true; }, stopPropagation() {}, ...mods } as unknown as KeyboardEvent;
    return actions.dispatch({ host, node: -1, event: e }, true) || prevented;
  };
  const type = (k: string, mods: Partial<KeyboardEvent> = {}) => omnibox(host)!.findKey({ key: k, shiftKey: false, isComposing: false, preventDefault() {}, stopPropagation() {}, ...mods } as unknown as KeyboardEvent);
  return { host, calls, filters, masks, key, type, box: () => omnibox(host)! };
}
const names = (hits: SearchHit[]) => hits.map(h => NAMES[h.node]);

test('working text preserves progress sweep, cross-fades stages and stops on completion', () => {
  const el = new El('div'), status = el as unknown as HTMLElement;
  workingText(status, 'Reading notes 40%', true);
  const first = el.lastElementChild;
  workingText(status, 'Reading notes 60%', true);
  expect(el.lastElementChild).toBe(first); expect(el.textContent).toBe('Reading notes 60%');
  workingText(status, 'Laying out 60/100', true);
  expect(el.children).toHaveLength(2);
  expect(el.children[0]!.getAttribute('aria-hidden')).toBe('true');
  expect(el.children[0]!.getAttribute('data-text')).toBe('Reading notes 60%');
  expect(el.textContent).toBe('Laying out 60/100');
  workingText(status, 'Ready');
  expect(el.lastElementChild!.className).toBe('graph-ng-status-current');
  workingText(status, ''); expect(el.children).toHaveLength(0);
});

test('search working status belongs to the current request and clears on close or stale view', async () => {
  const pending: ((v: number[]) => void)[] = [];
  const r = rig(undefined, undefined, undefined, () => new Promise(resolve => pending.push(resolve))), b = r.box();
  b.findShow(); b.findInput.value = 'a'; const first = b.findSearch();
  const status = b.findStatus as unknown as El;
  expect(status.textContent).toBe('Searching…'); expect(status.lastElementChild!.className).toContain('graph-ng-working');
  b.findInput.value = 'b'; const second = b.findSearch();
  pending[0]!([1]); await first; expect(status.textContent).toBe('Searching…');
  pending[1]!([3]); await second; expect(status.textContent).toBe('');
  b.findInput.value = 'c'; const stale = b.findSearch(); (r.host as { visible: Uint8Array }).visible = r.host.visible.slice();
  pending[2]!([0]); await stale; expect(status.children).toHaveLength(0);
  const closed = b.findSearch(); b.findClose(); expect(status.children).toHaveLength(0);
  pending[3]!([]); await closed; expect(status.children).toHaveLength(0);
});

test('working status treats labels as text and bounds retained transition nodes', () => {
  const el = new El('div');
  for (const text of ['<img onerror=alert(1)>', 'Saving…', 'Applying…', 'Done']) workingText(el as unknown as HTMLElement, text, text !== 'Done');
  expect(el.children).toHaveLength(2); expect(el.textContent).toBe('Done');
  expect(el.children.every(c => c.tagName === 'span')).toBe(true);
  expect(el.children.every(c => !c.className.split(' ').includes('graph-ng-working'))).toBe(true);
});

test('match classes: name prefix, then name substring, then identity only', () => {
  expect(searchKey('Folder/Alpha Beta.MD', 'ID-7')).toBe('alpha beta\u0000id-7');
  const t = searchKey('a/Alphabet.md', 'xyz-alpha');
  expect([matchRank(t, 'alp'), matchRank(t, 'bet'), matchRank(t, 'xyz'), matchRank(t, 'nope'), matchRank(t, '')]).toEqual([0, 1, 2, -1, -1]);
  // A name hit outranks the same text in the identity.
  expect(matchRank(searchKey('Beta.md', 'beta'), 'beta')).toBe(0);
});

test('ranking: class, then shorter name, then note order; bounded; chunks merge to the same answer', () => {
  const text = (i: number) => searchKey(paths(NAMES)[i]!, IDS[i]!);
  const all = rankMatches(text, 'alpha', 0, NAMES.length, []);
  // Prefixes, shorter name first; then name substrings; then the identity-only match.
  expect(names(all)).toEqual(['alpha', 'Alphabet soup', 'Zeta Alpha', 'hidden alpha', 'Beta']);
  expect(all.map(h => h.rank)).toEqual([0, 0, 1, 1, 2]);
  expect(names(rankMatches(text, 'alpha', 0, NAMES.length, [], 2))).toEqual(['alpha', 'Alphabet soup']);
  const chunked: SearchHit[] = []; for (let i = 0; i < NAMES.length; i += 2) rankMatches(text, 'alpha', i, i + 2, chunked, 3);
  expect(chunked).toEqual(rankMatches(text, 'alpha', 0, NAMES.length, [], 3));
  // Equal class and length keep note order.
  expect(rankMatches(i => 'ab\u0000', 'a', 0, 3, []).map(h => h.node)).toEqual([0, 1, 2]);
});

test('worker search steps: normalised query, visible mask, one yield per chunk, capped list', () => {
  const all = new Uint8Array(NAMES.length).fill(1), w = worker();
  expect(names(drain(searchSteps(w, '  ALPHA\0 ', all)).value)).toEqual(['alpha', 'Alphabet soup', 'Zeta Alpha', 'hidden alpha', 'Beta']);
  const some = all.slice(); some[5] = 0; some[1] = 0;
  expect(names(drain(searchSteps(w, 'alpha', some)).value)).toEqual(['Alphabet soup', 'Zeta Alpha', 'Beta']);
  expect(drain(searchSteps(w, '   ', all)).value).toEqual([]);
  expect(() => drain(searchSteps(w, 'a', new Uint8Array(2)))).toThrow('SEARCH_MASK');
  const n = 10_000, many = worker(Array.from({ length: n }, (_, i) => `note ${i}`), Array.from({ length: n }, String)), run = drain(searchSteps(many, 'note 1', new Uint8Array(n).fill(1), 20, 4096));
  expect(run.yields).toBe(2); expect(run.value.length).toBe(20); expect(run.value[0]!.node).toBe(1);
  expect(drain(searchSteps(many, 'note', new Uint8Array(n).fill(1), 10_000)).value.length).toBe(50);
});

test('search X is named, keeps focus inside until dismissal, and ignores late ranking replies', async () => {
  let resolve!: (hits: number[]) => void;
  const r = rig(render(), worker(), undefined, () => new Promise(done => { resolve = done; }));
  r.key('/'); const box = r.box(), root = box.findBox as unknown as El;
  const close = root.find('graph-ng-find-head')[0]!.children[1]!;
  expect(close.tagName).toBe('button'); expect(close.type).toBe('button');
  expect(close.getAttribute('aria-label')).toBe('Close search');
  expect(close.children[0]!.getAttribute('data-icon')).toBe('x'); expect(close.textContent).toBe('');
  box.findInput.value = 'alpha'; const pending = box.findSearch();
  close.focus(); root.onfocusout!({ relatedTarget: close }); expect(box.findOpen).toBe(true);
  close.onclick!(); expect(box.findOpen).toBe(false); expect(r.calls).toEqual(['focus']);
  expect(El.active).toBe(r.host.canvas as unknown as El);
  resolve([1]); await pending; expect(box.findHits).toEqual([]); expect(box.findRing.hidden).toBe(true);
  expect(r.filters).toEqual([]); disposeSearch(r.host.canvas);
});

test('find-and-fly key flow: / opens, typing ranks after a pause, arrows ring without moving the camera, Enter flies and opens the card', async () => {
  const r = rig(), box = r.box;
  // Plain k does nothing; / opens and takes focus.
  expect(r.key('k')).toBe(false);
  expect(r.key('/')).toBe(true);
  expect(box().findOpen).toBe(true); expect(El.active).toBe(box().findInput as unknown as El);
  box().findInput.value = 'ALPHA '; box().findInput.oninput!(new Event('input'));
  expect(r.masks.length).toBe(0);
  await Bun.sleep(SEARCH_DEBOUNCE_MS + 40);
  // One ranking per pause, over the notes the view can open.
  expect(r.masks.length).toBe(1); expect([...r.masks[0]!]).toEqual([1, 1, 1, 1, 1, 0]);
  const rows = (box().findList as unknown as El).find('graph-ng-find-row');
  expect(rows.map(row => row.children[0]!.textContent)).toEqual(['alpha', 'Alphabet soup', 'Zeta Alpha', 'Beta']);
  // Each row: name, current declared group, path.
  expect(rows[0]!.children.map(c => c.textContent)).toEqual(['alpha', '<Declared group>', 'Folder/alpha.md']);
  expect(rows[2]!.children[1]!.textContent).toBe('<Declared group>');
  expect(box().findInput.getAttribute('aria-expanded')).toBe('true');
  // Arrows preview with the ring only.
  r.type('ArrowDown'); r.type('ArrowDown'); r.type('ArrowUp');
  expect(box().findActive).toBe(0); expect(box().findRing.hidden).toBe(false);
  expect(box().findRing.style.transform).toBe('translate(50px, 40px) translate(-50%, -50%)');
  expect(rows[0]!.getAttribute('aria-selected')).toBe('true'); expect(box().findInput.getAttribute('aria-activedescendant')).toBe(rows[0]!.id);
  // Up from the top wraps; an off-screen note rings at the edge.
  r.type('ArrowUp'); expect(box().findActive).toBe(3);
  expect(box().findRing.style.transform).toBe('translate(192px, 40px) translate(-50%, -50%)');
  r.type('ArrowDown'); r.type('ArrowDown');
  expect(r.calls).toEqual([]);
  // Enter flies to the previewed note (flyToNote selects it and opens its card) and closes the box.
  r.type('Enter'); await Bun.sleep(0);
  expect(r.calls).toEqual(['focus', 'fly 2']);
  expect(box().findOpen).toBe(false); expect(box().findRing.hidden).toBe(true);
});

test('Enter with a changed query ranks first; Shift+Enter filters; Escape outranks the card; Ctrl/Cmd+K opens', async () => {
  const r = rig(), box = r.box;
  expect(r.key('K', { ctrlKey: true })).toBe(true); expect(box().findOpen).toBe(true);
  // Enter before the debounce fires still lands on the best match for what was typed.
  box().findInput.value = 'gam'; box().findInput.oninput!(new Event('input'));
  r.type('Enter'); await Bun.sleep(0);
  expect(r.calls).toEqual(['focus', 'fly 4']);
  // The card is open now. With the box open again, Escape closes only the box, then the card.
  r.calls.length = 0;
  expect(r.key('k', { metaKey: true })).toBe(true);
  expect(r.key('Escape')).toBe(true);
  expect(box().findOpen).toBe(false); expect(r.calls).toEqual(['focus']);
  expect(r.key('Escape')).toBe(true); expect(r.calls).toEqual(['focus', 'select -1', 'focus']);
  // Shift+Enter applies the text filter (today's behaviour) and closes.
  r.key('/'); box().findInput.value = ' Alpha '; r.type('Enter', { shiftKey: true });
  expect(r.filters).toEqual(['Alpha']); expect(box().findOpen).toBe(false);
  // No match says so, and Enter stays put.
  r.key('/'); box().findInput.value = 'zzz'; await box().findSearch();
  expect(box().findHits).toEqual([]); expect(box().findStatus.textContent).toBe('No matching notes');
  r.type('Enter'); await Bun.sleep(0); expect(box().findOpen).toBe(true);
  r.type('Escape'); expect(box().findOpen).toBe(false);
});

test('a newer query wins over a slower older one; a failed ranking shows no rows; hidden indices are dropped', async () => {
  const pending: ((v: number[]) => void)[] = [];
  const r = rig(undefined, undefined, undefined, () => new Promise(resolve => pending.push(resolve))), box = r.box;
  r.key('/');
  box().findInput.value = 'a'; const first = box().findSearch();
  box().findInput.value = 'b'; const second = box().findSearch();
  pending[1]!([3]); await second; pending[0]!([1, 2]); await first;
  expect(box().findHits).toEqual([3]);
  // Out-of-range or filtered-out indices never become rows.
  box().findInput.value = 'c'; const third = box().findSearch(); pending[2]!([5, 99, -1, 0]); await third;
  expect(box().findHits).toEqual([0]);
  const failing = rig(undefined, undefined, undefined, () => Promise.reject(new Error('Expression superseded')));
  failing.key('/'); failing.box().findInput.value = 'x'; await failing.box().findSearch();
  expect(failing.box().findHits).toEqual([]);
});

test('with a note selected, Alt+Enter (or Alt-click) on a result finds the path from it; the box says so', async () => {
  const r = rig(), box = r.box, paths: number[][] = [], host = r.host as unknown as { selected: number; findPath: (a: number, b: number) => void };
  host.findPath = (a, b) => { paths.push([a, b]); };
  // Nothing selected: on-demand help describes the shortcut, but Alt+Enter just flies.
  r.key('/'); expect((box() as unknown as { findBox: El }).findBox.find('graph-ng-help-popover')[0]!.hidden).toBe(true);
  box().findInput.value = 'gam'; r.type('Enter', { altKey: true }); await Bun.sleep(0);
  expect(r.calls).toEqual(['focus', 'fly 4']); expect(paths).toEqual([]);
  host.selected = 1; r.calls.length = 0;
  r.key('/'); expect((box() as unknown as { findBox: El }).findBox.textContent).toContain('Alt+Enter finds a path from the selected note.');
  box().findInput.value = 'beta'; r.type('Enter', { altKey: true }); await Bun.sleep(0);
  expect(paths).toEqual([[1, 3]]); expect(r.calls).toEqual(['focus']); expect(box().findOpen).toBe(false);
  // Alt-click on a row does the same; a plain Enter still flies.
  r.key('/'); box().findInput.value = 'gam'; await box().findSearch();
  ((box().findList as unknown as El).find('graph-ng-find-row')[0]!.onclick!)({ altKey: true }); await Bun.sleep(0);
  expect(paths).toEqual([[1, 3], [1, 4]]);
  r.key('/'); box().findInput.value = 'gam'; r.type('Enter'); await Bun.sleep(0); expect(r.calls.at(-1)).toBe('fly 4');
});

test('the keep mask may be transferred to the worker (detached) without losing the rows', async () => {
  const w = worker();
  const r = rig(undefined, w, undefined, async (q, keep) => {
    const hits = drain(searchSteps(w, q, keep)).value.map(h => h.node);
    structuredClone(keep, { transfer: [keep.buffer as ArrayBuffer] }); expect(keep.length).toBe(0);
    return hits;
  });
  r.key('/'); r.box().findInput.value = 'alpha'; await r.box().findSearch();
  expect(r.box().findHits.length).toBeGreaterThan(0);
  expect(r.box().findHits).not.toContain(5);
});


test('search invalidates on input before debounce, on filter change and on disposal', async () => {
  const pending: ((v: number[]) => void)[] = [];
  const r = rig(undefined, undefined, undefined, () => new Promise(resolve => pending.push(resolve))), b = r.box();
  r.key('/'); b.findInput.value = 'a'; const first = b.findSearch();
  b.findInput.value = 'b'; b.findInput.oninput!({} as Event);
  pending[0]!([1]); await first; expect(b.findHits).toEqual([]);
  const second = b.findSearch(); pending[1]!([3]); await second; b.findPreview(0);
  expect(b.findRing.hidden).toBe(false);
  invalidateSearch(r.host.canvas);
  expect(b.findHits).toEqual([]); expect(b.findRing.hidden).toBe(true); expect(b.findOpen).toBe(false);
  expect(b.findInput.getAttribute('aria-expanded')).toBe('false');
  expect(b.findInput.getAttribute('aria-activedescendant')).toBeNull();
  r.key('/'); const last = b.findSearch();
  const parent = b.findBox.parentElement!;
  disposeSearch(r.host.canvas); pending.at(-1)!([1]); await last;
  expect(b.findHits).toEqual([]); expect(parent.contains(b.findBox)).toBe(false); expect(parent.contains(b.findRing)).toBe(false);
  expect(b.findInput.oninput).toBeNull();
});

test('search never previews or travels to a result hidden since ranking, and reports worker failures', async () => {
  const r = rig(), b = r.box(); r.key('/'); b.findInput.value = 'alpha'; await b.findSearch();
  r.host.visible[1] = 0; b.findPreview(0); await b.findGo(0);
  expect(b.findRing.hidden).toBe(true); expect(r.calls).toEqual([]);
  const failed = rig(undefined, undefined, undefined, () => Promise.reject(new Error('worker stopped')));
  failed.key('/'); failed.box().findInput.value = 'x'; await failed.box().findSearch();
  expect(failed.box().findStatus.textContent).toBe('Search unavailable. Try again.');
  disposeSearch(r.host.canvas); disposeSearch(failed.host.canvas);
});


test('cold worker search builds its text cache in cancellable chunks, never on an invalid mask', () => {
  const n = 16000, w = worker(Array.from({ length: n }, (_, i) => `note ${i}`), Array.from({ length: n }, String));
  let reads = 0;
  w.identities = new Proxy(w.identities, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } });
  expect(() => drain(searchSteps(w, 'note', new Uint8Array(1)))).toThrow('SEARCH_MASK'); expect(reads).toBe(0);
  const visible = new Uint8Array(n).fill(1), first = searchSteps(w, 'note', visible, 20, 256);
  expect(first.next().done).toBe(false); expect(reads).toBe(256); first.return([]);
  // The cancelled partial cache is not reused; a completed cache is reused without identity reads.
  const next = drain(searchSteps(w, 'note', visible, 20, 256));
  expect(next.value.length).toBe(20); expect(reads).toBe(n + 256);
  drain(searchSteps(w, 'note 1', visible)); expect(reads).toBe(n + 256);
});


test('search help is on demand and keeps focus inside the box until Tab leaves it', () => {
  const r = rig(), box = r.box(), root = box.findBox as unknown as El;
  box.findShow();
  const tip = root.find('graph-ng-help-popover')[0]!, help = root.find('graph-ng-help-trigger')[0]!;
  expect(help.textContent).toBe('Keys'); expect(tip.hidden).toBe(true); expect(tip.textContent).toContain('Alt+Enter');
  root.onfocusout!({ relatedTarget: help }); expect(box.findOpen).toBe(true);
  root.onfocusout!({ relatedTarget: new El('button') }); expect(box.findOpen).toBe(false);
});
