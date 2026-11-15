import type { App, Menu, TFile, WorkspaceLeaf } from 'obsidian';
import type { Action, ActionContext, ActionRegistry, RendererControls } from './interaction';
import type { CardAction } from './connection-card';

/** A relationship (line) under the menu: its ends and, when it has one, a way to open its relationship note. */
export interface Relation { source: number; target: number; note?: () => void }
/** One menu row, host-neutral so the menu logic is testable without Obsidian. */
export interface MenuEntry { id: string; title: string; checked?: boolean; run(): void }
/** Shows entries at client coordinates; `path` is the clicked note, for other plugins' file actions. */
export type MenuPresenter = (entries: MenuEntry[], x: number, y: number, path?: string) => void;
type MenuContext = ActionContext & { relation?: Relation };

/** Touch long-press delay; ignore a second open (browser long-press `contextmenu` plus ours) inside the window. */
const PRESS_MS = 500, REOPEN_MS = 800;
const views = new WeakMap<RendererControls, Gestures>();

/** Per-view context menu and hover intent. While a note is selected, hovering another note only
 * previews it (ring and label); the highlight moves after `hoverDwellMs`, at once with Alt, and
 * never while focus is locked. With nothing selected, hover retiers immediately as before. */
export class Gestures {
  /** Called when the lock changes, so the card can show it. */
  onLock?: () => void;
  /** The hovered note is shown as a preview, not the highlight centre. */
  previewing = false;
  private on = false;
  private dwell?: ReturnType<typeof setTimeout>;
  private press?: ReturnType<typeof setTimeout>;
  private opened = -Infinity;
  private menuToken = 0;
  constructor(readonly host: RendererControls, readonly registry: ActionRegistry) { views.set(host, this); }
  static of(host: RendererControls) { return views.get(host); }
  /** Focus lock applies to the current selection; the renderer releases it when the selection clears. */
  get locked() { return this.on && this.host.selected >= 0; }
  lock(on = !this.locked) {
    const h = this.host; this.on = on && h.selected >= 0;
    if (h.hovered >= 0) this.hover(h.hovered, h.hoveredEdge);
    this.onLock?.();
  }
  hover(node: number, edge: number, alt = false) {
    const h = this.host, wait = h.settings.visuals.hoverDwellMs; clearTimeout(this.dwell);
    this.previewing = node >= 0 && h.selected >= 0 && node !== h.selected && (this.locked || !alt && wait > 0);
    h.setHover(node, edge, this.previewing);
    if (this.previewing && !this.locked) this.dwell = setTimeout(() => { if (h.live && h.hovered === node && this.previewing && !this.locked) this.hover(node, h.hoveredEdge, true); }, wait);
  }
  /** Start a touch long-press; `fire` runs unless `unpress` comes first (move, pinch, lift). */
  hold(fire: () => void) { this.unpress(); this.press = setTimeout(() => { this.press = undefined; fire(); }, PRESS_MS); }
  unpress() { clearTimeout(this.press); this.press = undefined; }
  /** Open the menu for a note, a relationship or (both -1) the empty canvas, at client coordinates. */
  open(node: number, edge: number, x: number, y: number) {
    const now = performance.now(), h = this.host; if (now - this.opened < REOPEN_MS) return; this.opened = now; const token = ++this.menuToken, visible = h.visible;
    const show = (ctx: MenuContext) => token === this.menuToken && visible === h.visible && h.live && h.showMenu(this.registry.menu(ctx).map(a => ({ id: a.id, title: a.label, checked: CHECKED[a.id]?.(ctx), run: () => { a.run(ctx); } })), x, y, node);
    if (edge >= 0) void h.relationship(edge).then(relation => show({ host: h, node: -1, edge, relation }), () => {});
    else show({ host: h, node, edge: -1 });
  }
  cancel() { this.unpress(); clearTimeout(this.dwell); this.previewing = false; this.menuToken++; }
  dispose() { this.cancel(); }
}

const CHECKED: Record<string, (ctx: MenuContext) => boolean> = { 'menu-lens': c => c.host.lensNode === c.node, 'lock-focus': c => c.host.selected === c.node && !!Gestures.of(c.host)?.locked };
const note = (c: ActionContext) => c.node >= 0, openable = (c: ActionContext) => c.node >= 0 && c.host.openable(c.node), relation = (c: ActionContext) => (c as MenuContext).relation;
const canvas = (c: ActionContext) => c.node < 0 && !(c.edge! >= 0), plain = (e?: KeyboardEvent) => !e || !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat;

type Row = [id: string, label: string, when: (c: ActionContext) => boolean, run: (c: ActionContext) => boolean | void];
const go = (a: CardAction): Row[3] => c => c.host.act(a, c.node), lock: Row[3] = c => {
  const g = Gestures.of(c.host); if (!g) return false;
  if (c.host.selected !== c.node) { c.host.selectNote(c.node, true); g.lock(true); } else g.lock();
};
/** Menu entries (in menu order, from 200) and their keys, registered by src/interaction.ts after the built-in keys. */
export const MENU_ACTIONS: Action[] = ([
  ['menu-open', 'Open', openable, go('open')],
  ['menu-tab', 'Open in new tab', openable, go('tab')],
  ['menu-right', 'Open to the right', openable, go('split')],
  ['menu-focus', 'Focus here', note, c => { c.host.selectNote(c.node, true); c.host.act('focus', c.node); }],
  ['menu-lens', 'Lens', note, c => c.host.setLens(c.host.lensNode === c.node ? -1 : c.node)],
  ['lock-focus', 'Lock focus', c => note(c) && plain(c.event), lock],
  ['menu-only', 'Show only connections', note, c => c.host.isolate(c.node)],
  ['menu-copy', 'Copy link', note, go('copy')],
  ['menu-note', 'Open relationship note', c => !!relation(c)?.note, c => relation(c)!.note!()],
  ['menu-source', 'Go to source', c => !!relation(c), c => c.host.travel(relation(c)!.source)],
  ['menu-target', 'Go to target', c => !!relation(c), c => c.host.travel(relation(c)!.target)],
  ['menu-fit', 'Fit all', canvas, c => c.host.fitAll()],
  ['menu-clear', 'Clear selection', c => canvas(c) && (c.host.selected >= 0 || c.host.edgeCard), c => c.host.selectNote(-1)],
] satisfies Row[]).map(([id, label, when, run], i): Action => ({ id, label, when, run, menu: true, order: 200 + i, key: id === 'lock-focus' ? ['k', 'K'] : undefined })).concat([
  // Hold Alt to move the highlight to a previewed note now.
  { id: 'hover-now', label: 'Highlight hovered note', key: 'Alt', order: 230, when: c => !!Gestures.of(c.host)?.previewing, run: c => { const h = c.host; Gestures.of(h)!.hover(h.hovered, h.hoveredEdge, true); } },
  {
    id: 'open-menu', label: 'Open menu', key: ['ContextMenu', 'F10'], order: 231, when: c => c.event?.key !== 'F10' || c.event.shiftKey, run: c => {
      const h = c.host, r = h.canvas.getBoundingClientRect(), p = c.node >= 0 ? h.screenPoint(c.node) : { x: h.width / 2, y: h.height / 2 };
      Gestures.of(h)?.open(c.node, -1, r.left + p.x, r.top + p.y);
    }
  },
]);

/** Obsidian's public `Menu`, plus the workspace `file-menu` event so other plugins' file actions appear (as in the core graph). */
export const obsidianMenu = (app: App, MenuClass: new () => Menu, file: (path: string) => TFile | null, leaf?: WorkspaceLeaf): MenuPresenter => (entries, x, y, path) => {
  const menu = new MenuClass();
  for (const e of entries) menu.addItem(item => { item.setTitle(e.title).onClick(e.run); if (e.checked) item.setChecked(true); });
  const f = path ? file(path) : null;
  if (f) app.workspace.trigger('file-menu', menu, f, 'graph-context-menu', leaf);
  menu.showAtPosition({ x, y });
};
