import { test, expect } from 'bun:test';
import { actions, Interaction, type RendererControls } from '../src/interaction';

// A fake renderer surface: notes 0..3 sit at x = 100 * id, y = 100; a line runs between 0 and 1 at y = 200.
function surface() {
  const log: string[] = [], menus: { ids: string[]; x: number; y: number; node: number }[] = [], hovers: [number, number][] = [];
  const h: any = {
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {}, removeEventListener() {} },
    live: true, width: 800, height: 600, visible: new Uint8Array(4).fill(1), camera: { x: .5, y: .5, ratio: 1 },
    settings: { visuals: { hoverHighlight: true, clickOpens: false } },
    selected: -1, hovered: -1, hoveredEdge: -1, focusNode: -1, lensNode: -1, cardNode: -1, edgeCard: false, isolated: false,
    pick: (x: number, y: number) => Math.abs(y - 100) < 10 && x % 100 < 10 ? Math.floor(x / 100) : -1,
    pickHub: () => -1, pickEdge: (_x: number, y: number) => Math.abs(y - 200) < 5 ? 0 : -1,
    screenPoint: (n: number) => ({ x: n * 100, y: 100 }), owns: () => false,
    selectNote: (n: number, card?: boolean) => { h.selected = n; h.cardNode = card && n >= 0 ? n : -1; log.push(`select ${n}`); },
    selectEdge: (e: number) => log.push(`edge ${e}`),
    setHover: (n: number, e: number) => { h.hovered = n; h.hoveredEdge = e; hovers.push([n, e]); },
    hint() {}, openable: () => true, open: (n: number) => log.push(`open ${n}`), stopFlight() {}, panBy() {}, setCamera() {},
    act: (a: string, n: number) => log.push(`${a} ${n}`), travel: (n: number) => log.push(`travel ${n}`), fitAll: () => log.push('fit'), isolate: (n: number) => log.push(`only ${n}`), setLens: (n: number) => { h.lensNode = n; },
    relationship: async (e: number) => ({ source: 0, target: 1, note: e === 0 ? () => log.push('relationship note') : undefined }),
    showMenu: (entries: { id: string }[], x: number, y: number, node: number) => menus.push({ ids: entries.map(e => e.id), x, y, node }),
  };
  const input = new Interaction(h as RendererControls);
  return { h, input, g: input.gestures, log, menus, hovers };
}
const at = (pointerId: number, x: number, y: number, pointerType = 'touch', extra = {}) => ({ pointerId, clientX: x, clientY: y, pointerType, button: 0, ...extra }) as unknown as PointerEvent;
const NOTE = ['menu-open', 'menu-tab', 'menu-right', 'menu-focus', 'menu-lens', 'menu-only', 'menu-copy'];

test('menu items per target: note, relationship with and without a relationship note, empty canvas', async () => {
  const { h } = surface(), ids = (ctx: object) => actions.menu({ host: h, ...ctx } as any).map(a => a.id);
  expect(ids({ node: 2, edge: -1 })).toEqual(NOTE);
  h.openable = () => false; expect(ids({ node: 2, edge: -1 })).toEqual(NOTE.slice(3)); h.openable = () => true;
  expect(ids({ node: -1, edge: 0, relation: { source: 0, target: 1, note() {} } })).toEqual(['menu-note', 'menu-source', 'menu-target']);
  expect(ids({ node: -1, edge: 3, relation: { source: 0, target: 1 } })).toEqual(['menu-source', 'menu-target']);
  expect(ids({ node: -1, edge: -1 })).toEqual(['menu-fit']);
  h.selected = 1; expect(ids({ node: -1, edge: -1 })).toEqual(['menu-fit', 'menu-clear']);
  // Built-in key actions never leak into the menu.
  expect(actions.menu({ host: h, node: 1 } as any).every(a => a.id.startsWith('menu-'))).toBe(true);
});

test('right-click opens the menu for what is under the pointer; entries run against the clicked target', async () => {
  const s = surface();
  s.input.contextMenu({ clientX: 205, clientY: 100, preventDefault() {} } as MouseEvent);
  expect(s.menus[0]).toEqual({ ids: NOTE, x: 205, y: 100, node: 2 });
  // A second open inside the de-duplication window (browser long-press menu plus ours) is ignored.
  s.input.contextMenu({ clientX: 205, clientY: 100, preventDefault() {} } as MouseEvent); expect(s.menus.length).toBe(1);
  const g = surface(), open = (x: number, y: number) => { (g.g as any).opened = -Infinity; g.input.contextMenu({ clientX: x, clientY: y, preventDefault() {} } as MouseEvent); };
  open(50, 200); await Bun.sleep(0); expect(g.menus[0]!.ids).toEqual(['menu-note', 'menu-source', 'menu-target']); expect(g.menus[0]!.node).toBe(-1);
  open(50, 400); expect(g.menus[1]!.ids).toEqual(['menu-fit']);
  // Shift+F10 and the ContextMenu key open it at the selected note; plain F10 does not.
  g.h.selected = 3; (g.g as any).opened = -Infinity;
  const key = (key: string, shiftKey = false) => { let handled = false; g.input.keyDown({ key, shiftKey, target: g.h.canvas, preventDefault() { handled = true; } } as any); return handled; };
  expect(key('F10')).toBe(false); expect(key('F10', true)).toBe(true); expect(g.menus[2]).toEqual({ ids: NOTE, x: 300, y: 100, node: 3 });
  (g.g as any).opened = -Infinity; expect(key('ContextMenu')).toBe(true); expect(g.menus.length).toBe(4);
});

test('touch long-press opens the menu and swallows the tap; movement, a pinch or lifting cancels it', async () => {
  const still = surface(), moved = surface(), pinch = surface(), lifted = surface(), mouse = surface();
  still.input.pointerDown(at(1, 100, 100));
  moved.input.pointerDown(at(1, 100, 100)); moved.input.pointerMove(at(1, 112, 100));
  pinch.input.pointerDown(at(1, 100, 100)); pinch.input.pointerDown(at(2, 300, 100));
  lifted.input.pointerDown(at(1, 100, 100)); lifted.input.pointerUp(at(1, 100, 100));
  mouse.input.pointerDown(at(1, 100, 100, 'mouse'));
  await Bun.sleep(560);
  expect(still.menus.map(m => m.node)).toEqual([1]); still.input.pointerUp(at(1, 100, 100)); expect(still.log).toEqual([]); // no select after the menu
  for (const s of [moved, pinch, lifted, mouse]) expect(s.menus).toEqual([]);
  expect(lifted.log).toEqual(['select 1']); // a quick tap still selects
});

test('hover is only a light preview: it never selects, never waits, and has no lock; a click commits focus', async () => {
  const { h, input, hovers, log } = surface(), move = (x: number, alt = false) => input.pointerMove(at(9, x, 100, 'mouse', { altKey: alt }));
  move(100); expect(hovers.at(-1)).toEqual([1, -1]); expect(h.selected).toBe(-1);
  h.selected = 0; move(200); move(300, true); await Bun.sleep(20); expect(hovers).toEqual([[1, -1], [2, -1], [3, -1]]); expect(h.selected).toBe(0);
  // Empty canvas drops the preview at once: there is no hover focus to keep.
  move(150); expect(hovers.at(-1)).toEqual([-1, -1]);
  // Neither the old lock key nor the old menu entry exists.
  const key = (key: string) => { let handled = false; input.keyDown({ key, target: h.canvas, preventDefault() { handled = true; } } as any); return handled; };
  expect(key('k')).toBe(false); expect(key('Alt')).toBe(false);
  expect(actions.menu({ host: h, node: 3 } as any).some(a => /lock/.test(a.id))).toBe(false);
  // Escape with only a hover does nothing; a click commits, and Escape then clears it.
  h.selected = -1; move(300); expect(key('Escape')).toBe(false);
  input.pointerDown(at(1, 300, 100, 'mouse')); input.pointerUp(at(1, 300, 100, 'mouse')); expect(log.at(-1)).toBe('select 3'); expect(h.cardNode).toBe(3);
  input.detach({ removeEventListener() {} } as any);
});


test('release cancels long-press; stale relationship replies never reopen a menu', async () => {
  const s = surface(); s.h.selected = 0;
  s.input.pointerDown(at(1, 100, 100)); s.input.release();
  await Bun.sleep(550); expect(s.menus).toEqual([]);
  let resolve!: (r: any) => void;
  s.h.relationship = () => new Promise(done => { resolve = done; });
  s.g.open(-1, 0, 0, 0); s.input.release(); resolve({ source: 0, target: 1 });
  await Promise.resolve(); expect(s.menus).toEqual([]);
  (s.g as any).opened = -Infinity;
  s.g.open(-1, 0, 0, 0); s.h.visible = s.h.visible.slice(); resolve({ source: 0, target: 1 });
  await Promise.resolve(); expect(s.menus).toEqual([]);
  s.g.dispose();
});

test('hub hover updates hints from empty canvas and between hubs, then resets on leave', () => {
  const { h, input } = surface(), hints: number[] = [];
  h.pickHub = (x: number, y: number) => y === 300 ? x < 200 ? 0 : 1 : -1;
  h.hint = (hub: number) => hints.push(hub);
  input.pointerMove(at(9, 150, 400, 'mouse'));
  input.pointerMove(at(9, 150, 300, 'mouse')); input.pointerMove(at(9, 250, 300, 'mouse'));
  input.pointerMove(at(9, 260, 300, 'mouse')); // same hub does not repeat the work
  expect(hints).toEqual([0, 1]); input.pointerLeave();
  input.pointerMove(at(9, 250, 300, 'mouse')); expect(hints).toEqual([0, 1, -1, 1]);
  input.detach({ removeEventListener() {} } as any);
});
