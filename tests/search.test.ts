import { test, expect, beforeAll, afterAll } from 'bun:test';
import { matchRank, rankMatches, searchKey, searchSteps, type SearchHit } from '../src/core/explore';
import { encodeStrings } from '../src/core/columns';
import type { Projection } from '../src/core/projection';
import { actions, type RendererControls } from '../src/interaction';
import { omnibox, searchable, SEARCH_DEBOUNCE_MS, type SearchSource } from '../src/search';
import type { RenderProjection } from '../src/render-projection';

/** Just enough DOM for the find box: no layout, no events beyond the handler properties it sets. */
class El {
  children: El[] = []; parentElement: El | null = null; attrs: Record<string, string> = {}; style: Record<string, string> = {};
  hidden = false; className = ''; id = ''; value = ''; type = ''; placeholder = ''; maxLength = 0; spellcheck = true; text = '';
  [handler: `on${string}`]: ((e?: any) => void) | undefined | null;
  static active: El | null = null;
  constructor(readonly tagName: string) {}
  get textContent(): string { return this.text + this.children.map(c => c.textContent).join(''); }
  set textContent(v: string) { this.children = []; this.text = v; }
  appendChild(c: El) { c.parentElement = this; this.children.push(c); return c; }
  contains(n: unknown): boolean { return n === this || this.children.some(c => c.contains(n)); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  focus() { El.active = this; }
  select() {}
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
  return { nodeCount: names.length, paths: encodeStrings(paths(names)), offsets: new Uint32Array(names.length + 1), source: Uint32Array.from(pairs, p => p[0]), target: Uint32Array.from(pairs, p => p[1]), type: new Uint32Array(pairs.length), types: [], carrier: new Uint32Array(pairs.length), carrierNodes: new Uint32Array(names.length), quarantined: [], groups: [] };
}
function drain<T>(steps: Generator<void, T>) { let s = steps.next(), yields = 0; while (!s.done) { yields++; s = steps.next(); } return { value: s.value, yields }; }
function rig(p = render(), w = worker(), visible = Uint8Array.from({ length: p.nodeCount }, (_, i) => +(i !== 5)), rank?: SearchSource['rank']) {
  const stage = new El('div'), canvas = new El('canvas'); stage.appendChild(canvas);
  const calls: string[] = [], filters: string[] = [], masks: Uint8Array[] = [];
  let cardNode = -1;
  const host = {
    canvas, live: true, width: 200, height: 300, visible, selected: -1, hovered: -1, focusNode: -1, lensNode: -1, edgeCard: false, isolated: false,
    get cardNode() { return cardNode; },
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
  // Each row: name, connection count, path.
  expect(rows[0]!.children.map(c => c.textContent)).toEqual(['alpha', '3 connections', 'Folder/alpha.md']);
  expect(rows[2]!.children[1]!.textContent).toBe('1 connection');
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
