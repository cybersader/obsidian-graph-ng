import { Menu, setIcon } from 'obsidian';
import { middleTruncate } from './label-layout';

/** One chip of the visited-notes trail: its position in the history and whether it is where you are. */
export interface Crumb { index: number; node: number; current: boolean }
/** At most `max` consecutive history entries, shifted back to include the current entry. */
export function crumbs(items: readonly number[], at: number, max = 8): Crumb[] {
  if (at < 0 || at >= items.length) return [];
  const start = Math.min(Math.max(0, items.length - max), at), out: Crumb[] = [];
  for (let i = start; i < Math.min(items.length, start + max); i++) out.push({ index: i, node: items[i]!, current: i === at });
  return out;
}
/** Four inline visits, with all other retained visits in the menu, newest first. The card caps history at 32. */
export function trail(items: readonly number[], at: number, max = 4, cap = 32): { shown: Crumb[]; older: Crumb[] } {
  const shown = items.length < 2 ? [] : crumbs(items, at, max), older: Crumb[] = [];
  if (shown.length) for (let i = items.length - 1; i >= 0 && older.length < cap; i--) if (i < shown[0]!.index || i > shown[shown.length - 1]!.index) older.push({ index: i, node: items[i]!, current: false });
  return { shown, older };
}
/** Mutates the existing card history, never a second navigation authority. Travel precedes removing a current visit. */
export function trimHistory(history: { items: number[]; at: number }, index: number, newer: boolean) {
  if (index < 0 || index >= history.items.length) return;
  history.items.splice(index + (newer ? 1 : 0), newer ? history.items.length : 1);
  history.at = Math.min(history.items.length - 1, history.at - (!newer && index < history.at ? 1 : 0));
}

/** Recent notes. Native menus expose complete names and history edits without adding an action to every chip. */
export class Breadcrumb {
  readonly root: HTMLElement;
  private crumbKey: unknown[] = [];
  constructor(parent: HTMLElement, private crumbName: (n: number) => string, private travelBy: (by: number) => void, private clearCrumbs: () => void, private editCrumbs: (index: number, newer: boolean) => void) {
    this.root = parent.appendChild(Object.assign(document.createElement('nav'), { className: 'graph-ng-crumbs' }));
    this.root.setAttribute('aria-label', 'Recent notes'); this.root.hidden = true;
  }
  /** Per frame: only rebuild when history moves. Keep keyboard focus through travel and edits. */
  update(on: boolean, history: { items: readonly number[]; at: number }, selected = history.items[history.at], width = 800) {
    const { items, at } = history, max = width < 600 ? 2 : 3, key = [on, max, selected, items, items.length, at, items[0], items[at], items[items.length - 1]];
    if (key.every((x, i) => x === this.crumbKey[i])) return;
    this.crumbKey = key;
    const focused = this.root.contains(document.activeElement), { shown, older } = on ? trail(items, at, max) : { shown: [], older: [] };
    this.root.hidden = shown.length < 2; this.root.textContent = '';
    if (this.root.hidden) return;
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement = this.root) => parent.appendChild(Object.assign(document.createElement(tag), { className: cls }));
    const icon = make('span', 'graph-ng-crumbs-icon'); setIcon(icon, 'history'); icon.setAttribute('aria-hidden', 'true');
    const menuAt = (menu: Menu, el: HTMLElement) => { const r = el.getBoundingClientRect(); menu.showAtPosition({ x: r.left, y: r.bottom }); };
    if (older.length) {
      const more = make('button', 'graph-ng-crumbs-more'); more.textContent = '…'; more.setAttribute('aria-label', `${older.length} other recent visits`); more.setAttribute('aria-haspopup', 'menu');
      more.onclick = () => { const menu = new Menu(); for (const c of older) menu.addItem(i => i.setTitle(this.crumbName(c.node)).onClick(() => this.travelBy(c.index - at))); menuAt(menu, more); };
    }
    const ol = make('ol', '');
    shown.forEach((c, i) => {
      const li = make('li', '', ol), label = this.crumbName(c.node), current = c.current && c.node === selected;
      if (i || older.length) { const chevron = make('span', 'graph-ng-crumbs-sep', li); setIcon(chevron, 'chevron-right'); chevron.setAttribute('aria-hidden', 'true'); }
      const chip = make('button', 'graph-ng-crumb', li), short = Array.from(middleTruncate(label, 22)), split = Math.max(0, short.length - 8);
      make('span', '', chip).textContent = short.slice(0, split).join(''); make('span', '', chip).textContent = short.slice(split).join('');
      chip.setAttribute('aria-label', label); chip.setAttribute('aria-keyshortcuts', 'Backspace Delete Shift+F10');
      if (current) chip.setAttribute('aria-current', 'location');
      chip.onclick = () => current ? actions() : this.travelBy(c.index - at);
      if (current) chip.setAttribute('aria-haspopup', 'menu');
      const edit = (newer: boolean) => this.editCrumbs(c.index, newer);
      const actions = () => {
        const menu = new Menu(); menu.addItem(i => i.setTitle(label).setDisabled(true));
        menu.addItem(i => i.setTitle('Forget newer').setDisabled(c.index === items.length - 1).onClick(() => edit(true)));
        menu.addItem(i => i.setTitle('Remove visit').onClick(() => edit(false))); menuAt(menu, chip);
      };
      chip.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); actions(); };
      chip.onkeydown = e => {
        if (e.key === 'Backspace' || e.key === 'Delete') edit(e.key === 'Backspace');
        else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) actions();
        else return;
        e.preventDefault(); e.stopPropagation();
      };
    });
    const clear = make('button', 'clickable-icon graph-ng-crumbs-clear'); setIcon(clear, 'x'); clear.setAttribute('aria-label', 'Clear recent notes'); clear.onclick = () => this.clearCrumbs();
    if (focused) (this.root.querySelector<HTMLElement>('[aria-current]') ?? clear).focus();
  }
}
