import type { Settings } from './settings';
import type { CardAction } from './connection-card';
import { Gestures, MENU_ACTIONS, type MenuEntry, type Relation } from './context-menu';

/** Everything input handling may ask of the renderer. The renderer builds one object (see
 * `DetailRenderer.controls`); interaction code never reaches into renderer internals. Screen
 * coordinates are CSS pixels relative to the canvas. */
export interface RendererControls {
  readonly canvas: HTMLCanvasElement;
  /** False once disposed or while the GPU context is lost: input is ignored. */
  readonly live: boolean;
  readonly settings: Settings;
  readonly width: number;
  readonly height: number;
  /** Render-visible nodes. */
  readonly visible: Uint8Array;
  readonly camera: Readonly<{ x: number; y: number; ratio: number }>;
  readonly selected: number;
  readonly hovered: number;
  readonly hoveredEdge: number;
  /** The note the graduated highlighting is centred on, or -1. */
  readonly focusNode: number;
  /** The lens target, or -1. */
  readonly lensNode: number;
  /** Note shown in the connection card, or -1. */
  readonly cardNode: number;
  /** A relationship (line) or path card is open. */
  readonly edgeCard: boolean;
  /** "Only connections" is active. */
  readonly isolated: boolean;
  pick(x: number, y: number): number;
  pickHub(x: number, y: number): number;
  pickEdge(x: number, y: number): number;
  screenPoint(node: number): { x: number; y: number };
  /** The canvas or the renderer's overlay contains this element. */
  owns(target: EventTarget | null | undefined): boolean;
  selectNote(node: number, card?: boolean, keepLens?: boolean): void;
  selectEdge(edge: number): void;
  /** Step through the selection's relationships; false when there is nothing to step. */
  cycleEdge(step: number): boolean;
  /** Set the light hover preview (ring and name) and redraw. Hover never moves the graduated highlight. */
  setHover(node: number, edge: number): void;
  /** Tooltip for what is under the pointer; also sets the cursor when `cursor` is true. */
  hint(hub: number, node: number, edge: number, cursor: boolean): void;
  /** Note is filter-visible and can be opened. */
  openable(node: number): boolean;
  open(node: number): void;
  openHub(group: number): void;
  stopFlight(): void;
  setCamera(x: number, y: number, ratio: number): void;
  flyTo(x: number, y: number, ratio: number, ms?: number): void;
  /** Drag the view by a screen delta. */
  panBy(dx: number, dy: number): void;
  /** Zoom by `factor` about a point given relative to the view centre. The wheel may hand over to
   * the overview unless a note is selected or lensed (then it clamps); a pinch never hands over. */
  zoomAt(factor: number, x: number, y: number, pinch?: boolean): void;
  setLens(node: number): void;
  toggleLens(): void;
  /** Let the connection card handle a key first; true when it did. */
  cardKey(e: KeyboardEvent): boolean;
  /** Card history back (-1) or forward (1); false when there is nowhere to go. */
  cardStep(step: number): boolean;
  /** "Only connections" around a note; -1 returns to the full graph. */
  isolate(node: number): void;
  focusCanvas(): void;
  /** Go to a note as the card's Go to does: select it with its card and fly the camera there. */
  flyToNote(node: number): void;
  /** A connection-card action on a note: open modes, focus, lens, only connections, copy. */
  act(action: CardAction, node: number): void;
  /** Select a note, show its card and fly to it. */
  travel(node: number): void;
  fitAll(): void;
  /** A relationship's ends and its relationship note, if any. */
  relationship(edge: number): Promise<Relation>;
  /** Show a context menu at client coordinates; `node` is the clicked note or -1. */
  showMenu(entries: MenuEntry[], x: number, y: number, node: number): void;
  /** "How are these connected?": find, highlight, frame and list the shortest path between two notes. */
  findPath(from: number, to: number): void;
}

export interface ActionContext {
  readonly host: RendererControls;
  /** The note the action applies to: the selection, else the hover (a context menu passes the clicked note). */
  readonly node: number;
  /** The relationship a context menu was opened on, or -1. */
  readonly edge?: number;
  /** The key press that triggered the action; absent when run from a menu. */
  readonly event?: KeyboardEvent;
}

export interface Action {
  /** Unique, kebab-case. */
  id: string;
  /** Short plain-English label for menus and help. */
  label: string;
  /** `KeyboardEvent.key` values that trigger it. */
  key?: string | readonly string[];
  /** Only when the canvas itself has keyboard focus (not the card). */
  canvasOnly?: boolean;
  /** Listed in the right-click menu. */
  menu?: boolean;
  /** Lower runs first among actions bound to the same key. Built-ins use 10 to 110; default 1000. */
  order?: number;
  when?(ctx: ActionContext): boolean;
  /** Return false to decline and let the next matching action try. */
  run(ctx: ActionContext): boolean | void;
}

/** Ordered key and menu actions. The first matching action whose `when` passes and whose `run`
 * does not return false handles the key; the default is then prevented. */
export class ActionRegistry {
  private list: Action[] = [];
  register(action: Action): () => void {
    if (this.list.some(a => a.id === action.id)) throw new Error(`Duplicate action: ${action.id}`);
    const order = action.order ?? 1000, at = this.list.findIndex(a => (a.order ?? 1000) > order);
    this.list.splice(at < 0 ? this.list.length : at, 0, action);
    return () => { const i = this.list.indexOf(action); if (i >= 0) this.list.splice(i, 1); };
  }
  /** Run the first action bound to this key; true when one handled it. */
  dispatch(ctx: ActionContext & { event: KeyboardEvent }, onCanvas: boolean) {
    for (const a of this.list) {
      if (a.key === undefined || !(typeof a.key === 'string' ? a.key === ctx.event.key : a.key.includes(ctx.event.key))) continue;
      if (a.canvasOnly && !onCanvas || a.when && !a.when(ctx)) continue;
      if (a.run(ctx) !== false) return true;
    }
    return false;
  }
  /** Menu actions available for this context, in order. */
  menu(ctx: ActionContext) { return this.list.filter(a => a.menu && (!a.when || a.when(ctx))); }
}

/** Shared registry: add bindings here instead of editing the renderer. */
export const actions = new ActionRegistry();
export const registerAction = (action: Action) => actions.register(action);

const ARROWS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
// Escape layers: the card (or relationship card) first, then the lens, then a card-less selection, then "Only connections".
// Hover holds no focus, so there is no hover layer.
for (const action of [
  { id: 'close-card', label: 'Close card', key: 'Escape', order: 10, when: ({ host }) => host.cardNode >= 0 || host.edgeCard, run: ({ host }) => { host.selectNote(-1, false, true); host.focusCanvas(); } },
  { id: 'close-lens', label: 'Close connection lens', key: 'Escape', order: 20, when: ({ host }) => host.lensNode >= 0, run: ({ host }) => { host.setLens(-1); host.focusCanvas(); } },
  { id: 'clear-selection', label: 'Clear selection', key: 'Escape', order: 30, when: ({ host }) => host.selected >= 0, run: ({ host }) => { host.selectNote(-1); host.focusCanvas(); } },
  { id: 'show-all', label: 'Show all notes', key: 'Escape', order: 50, when: ({ host }) => host.isolated, run: ({ host }) => host.isolate(-1) },
  { id: 'history-step', label: 'Back or forward', key: ['ArrowLeft', 'ArrowRight'], order: 60, when: ({ event }) => !!event?.altKey, run: ({ host, event }) => host.cardStep(event!.key === 'ArrowLeft' ? -1 : 1) },
  { id: 'toggle-lens', label: 'Toggle connection lens', key: ['l', 'L'], order: 70, when: ({ event: e }) => !e || !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat, run: ({ host }) => host.toggleLens() },
  { id: 'cycle-relationships', label: 'Next relationship', key: ['r', 'R'], order: 80, run: ({ host, event }) => host.cycleEdge(event?.shiftKey ? -1 : 1) },
  { id: 'open-note', label: 'Open note', key: 'Enter', canvasOnly: true, order: 90, when: ({ host }) => host.openable(host.selected), run: ({ host }) => host.open(host.selected) },
  {
    id: 'select-direction', label: 'Select nearest note in that direction', key: ARROWS, canvasOnly: true, order: 100, run: ({ host, event }) => {
      // Unit direction for Right, Down, Left, Up.
      const d = ARROWS.indexOf(event!.key), from = host.selected < 0 ? { x: host.width / 2, y: host.height / 2 } : host.screenPoint(host.selected), ux = (1 - d) % 2, uy = (2 - d) % 2, visible = host.visible;
      let best = -1, score = Infinity;
      for (let i = 0; i < visible.length; i++) if (visible[i]) { const q = host.screenPoint(i), x = q.x - from.x, y = q.y - from.y, a = x * ux + y * uy, t = a + 2 * Math.abs(x * uy - y * ux); if (a > 0 && t < score) { best = i; score = t; } }
      if (best >= 0) host.selectNote(best, true);
    }
  },
] satisfies Action[]) actions.register(action);
for (const action of MENU_ACTIONS) actions.register(action);

/** Pointer, wheel and keyboard input for one renderer: drag and pinch, hover, click versus
 * Ctrl-click, and key actions through the registry. */
export class Interaction {
  private pointers = new Map<number, { x: number; y: number }>();
  private moved = false;
  private downX = 0;
  private downY = 0;
  private lastPointer?: { clientX: number; clientY: number };
  private hoverHub = -1;
  /** Context menu and touch long-press (src/context-menu.ts). */
  readonly gestures: Gestures;
  constructor(private host: RendererControls, private registry = actions) { this.gestures = new Gestures(host, registry); }
  attach(container: HTMLElement) {
    const c = this.host.canvas; container.addEventListener('pointerleave', this.pointerLeave);
    c.addEventListener('pointerdown', this.pointerDown); c.addEventListener('pointermove', this.pointerMove); c.addEventListener('pointerup', this.pointerUp); c.addEventListener('pointercancel', this.pointerCancel); c.addEventListener('pointerleave', this.pointerLeave); c.addEventListener('keydown', this.keyDown); c.addEventListener('wheel', this.wheel, { passive: false }); c.addEventListener('contextmenu', this.contextMenu);
  }
  detach(container: HTMLElement) {
    const c = this.host.canvas; container.removeEventListener('pointerleave', this.pointerLeave);
    c.removeEventListener('pointerdown', this.pointerDown); c.removeEventListener('pointermove', this.pointerMove); c.removeEventListener('pointerup', this.pointerUp); c.removeEventListener('pointercancel', this.pointerCancel); c.removeEventListener('pointerleave', this.pointerLeave); c.removeEventListener('keydown', this.keyDown); c.removeEventListener('wheel', this.wheel); c.removeEventListener('contextmenu', this.contextMenu);
    this.release(); this.gestures.dispose();
  }
  /** Drop active pointers (context loss, dispose). */
  release() { this.pointers.clear(); this.gestures.cancel(); }
  /** Re-run hover at the last pointer position after coordinates change under it. */
  replayHover() { if (this.lastPointer) this.pointerMove({ ...this.lastPointer, pointerId: -1 } as PointerEvent); }
  pointerDown = (e: PointerEvent) => { const h = this.host; if (!h.live || e.button > 0) return; h.stopFlight(); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); h.canvas.setPointerCapture(e.pointerId); this.downX = e.clientX; this.downY = e.clientY; this.moved = this.pointers.size > 1;
    // A still touch held for 500 ms opens the menu; a drag, a second finger or lifting cancels it.
    if (e.pointerType === 'touch' && !this.moved) this.gestures.hold(() => { const r = h.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, node = h.pick(x, y); this.pointerCancel(e); this.gestures.open(node, node < 0 ? h.pickEdge(x, y) : -1, e.clientX, e.clientY); });
    else this.gestures.unpress();
  };
  pointerMove = (e: PointerEvent) => {
    const h = this.host; if (!h.live) return;
    this.lastPointer = { clientX: e.clientX, clientY: e.clientY };
    const old = this.pointers.get(e.pointerId);
    if (old) {
      if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 3) { this.moved = true; this.gestures.unpress(); }
      if (this.pointers.size === 2) { for (const [id, other] of this.pointers) if (id !== e.pointerId) { const before = Math.hypot(old.x - other.x, old.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y); if (before > 0 && after > 0) h.zoomAt(before / after, 0, 0, true); } }
      else h.panBy(e.clientX - old.x, e.clientY - old.y);
      old.x = e.clientX; old.y = e.clientY; return;
    }
    const rect = h.canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    const hub = h.pickHub(x, y), node = hub >= 0 ? -1 : h.pick(x, y), edge = node < 0 && hub < 0 ? h.pickEdge(x, y) : -1;
    // Hover is a light preview only: a ring and the name. Only a click moves the highlight and card.
    // A collapsed hub is neither a node nor an edge, so it is compared separately for its tooltip and cursor.
    if (node === h.hovered && edge === h.hoveredEdge && hub === this.hoverHub) return;
    this.hoverHub = hub; h.setHover(node, edge); h.hint(hub, node, edge, true);
  };
  pointerUp = (e: PointerEvent) => {
    const h = this.host; if (!h.live) return;
    this.gestures.unpress(); const had = this.pointers.delete(e.pointerId); if (h.canvas.hasPointerCapture(e.pointerId)) h.canvas.releasePointerCapture(e.pointerId);
    if (had && !this.moved) {
      const rect = h.canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top, hub = h.pickHub(x, y);
      if (hub >= 0) { h.openHub(hub); return; }
      // A touch tap only selects (precise taps on dense graphs misfire); mouse/pen clicks still open.
      // A tap or click on empty canvas clears the selection.
      // Notes outrank lines. A line click or tap selects its relationship and never opens anything.
      const node = h.pick(x, y), touch = e.pointerType === 'touch', edge = node < 0 ? h.pickEdge(x, y) : -1;
      if (edge >= 0) { h.selectEdge(edge); return; }
      // Shift-click a second note: how are these connected?
      if (e.shiftKey && node >= 0 && h.selected >= 0 && node !== h.selected) { h.findPath(h.selected, node); return; }
      // A click shows the connection card; Ctrl/Cmd-click (or "Click opens notes directly") opens.
      const direct = !touch && (h.settings.visuals.clickOpens || e.ctrlKey || e.metaKey);
      h.selectNote(node, !direct); if (node >= 0 && direct) h.open(node);
    }
  };
  pointerCancel = (e: PointerEvent) => { this.gestures.unpress(); this.pointers.delete(e.pointerId); this.moved = true; };
  /** Right-click (or the browser's own long-press menu): the menu for the note, line or empty canvas under the pointer. */
  contextMenu = (e: MouseEvent) => {
    e.preventDefault(); const h = this.host; if (!h.live) return;
    this.gestures.unpress(); if (this.pointers.size) this.moved = true;
    const r = h.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, node = h.pick(x, y);
    this.gestures.open(node, node < 0 ? h.pickEdge(x, y) : -1, e.clientX, e.clientY);
  };
  pointerLeave = (e?: PointerEvent) => {
    const h = this.host, next = e?.relatedTarget;
    if (next && h.owns(next)) return;
    this.lastPointer = undefined; if (!this.pointers.size) { this.hoverHub = -1; h.setHover(-1, -1); h.hint(-1, -1, -1, false); }
  };
  wheel = (e: WheelEvent) => {
    e.preventDefault(); const h = this.host; if (!h.live) return;
    const rect = h.canvas.getBoundingClientRect();
    h.zoomAt(Math.exp(Math.max(-1, Math.min(1, e.deltaY * .001))), e.clientX - rect.left - h.width / 2, e.clientY - rect.top - h.height / 2);
  };
  /** Keyboard path through the action registry: Escape layers, Alt+Left/Right history, L lens, R
   * relationships, then (canvas focus only) Enter opens and arrows select the nearest note. */
  keyDown = (e: KeyboardEvent) => {
    const h = this.host;
    if (this.registry.dispatch({ host: h, node: h.selected >= 0 ? h.selected : h.hovered, event: e }, e.target === h.canvas)) e.preventDefault();
  };
  /** Keys inside the card: the card first, then the canvas bindings. */
  cardKeyDown = (e: KeyboardEvent) => { if (!(this.host.cardNode >= 0 && this.host.cardKey(e))) this.keyDown(e); };
}
