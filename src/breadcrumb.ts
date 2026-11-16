import { setIcon } from 'obsidian';

/** One chip of the visited-notes trail: its position in the history and whether it is where you are. */
export interface Crumb { index: number; node: number; current: boolean }
/** At most `max` consecutive history entries: the most recent ones, shifted back if needed so the
 * current entry is always included. Pure; reads the connection card's history, never copies it. */
export function crumbs(items: readonly number[], at: number, max = 8): Crumb[] {
  if (at < 0 || at >= items.length) return [];
  const start = Math.min(Math.max(0, items.length - max), at), out: Crumb[] = [];
  for (let i = start; i < Math.min(items.length, start + max); i++) out.push({ index: i, node: items[i]!, current: i === at });
  return out;
}
/** The trail as shown: nothing under two visits; otherwise up to `max` chips around the current note,
 * and the entries before them (most recent first, at most `cap`) for the "…" menu. */
export function trail(items: readonly number[], at: number, max = 4, cap = 12): { shown: Crumb[]; older: Crumb[] } {
  const shown = items.length < 2 ? [] : crumbs(items, at, max), older: Crumb[] = [];
  for (let i = (shown[0]?.index ?? 0) - 1; i >= 0 && older.length < cap; i--) older.push({ index: i, node: items[i]!, current: false });
  return { shown, older };
}
/** Chip opacity by distance from the current note: older visits fade, never below half. */
export const crumbFade = (distance: number) => Math.max(.5, 1 - Math.abs(distance) * .15);

/** Recent notes: one strip (history icon, chips joined by chevrons, a clear button) stacked above the
 * tier legend. Older visits collapse into a "…" menu. Chips travel through the card history. Text only. */
export class Breadcrumb {
  readonly root: HTMLElement;
  private crumbKey: unknown[] = [];
  constructor(parent: HTMLElement, private crumbName: (n: number) => string, private travelBy: (by: number) => void, private clearCrumbs: () => void) {
    this.root = parent.appendChild(Object.assign(document.createElement('nav'), { className: 'graph-ng-crumbs' }));
    this.root.setAttribute('aria-label', 'Recent notes'); this.root.hidden = true;
  }
  /** Per frame: re-renders only when the history moved. A single entry is not a trail and stays hidden. */
  update(on: boolean, history: { items: readonly number[]; at: number }, selected = history.items[history.at]) {
    const { items, at } = history, key = [on, selected, items, items.length, at, items[0], items[at], items[items.length - 1]];
    if (key.every((x, i) => x === this.crumbKey[i])) return;
    this.crumbKey = key;
    const { shown, older } = on ? trail(items, at) : { shown: [], older: [] };
    this.root.hidden = shown.length < 2; this.root.textContent = '';
    if (this.root.hidden) return;
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement = this.root) => parent.appendChild(Object.assign(document.createElement(tag), { className: cls }));
    const icon = make('span', 'graph-ng-crumbs-icon'); setIcon(icon, 'history'); icon.setAttribute('aria-hidden', 'true'); this.root.title = 'Recent notes';
    const go = (c: Crumb, el: HTMLElement) => { el.onclick = () => this.travelBy(c.index - at); };
    if (older.length) {
      const more = make('button', 'graph-ng-crumbs-more'), menu = make('div', 'graph-ng-crumbs-menu');
      more.textContent = '…'; more.setAttribute('aria-label', `${older.length} older notes`); more.setAttribute('aria-expanded', 'false'); menu.hidden = true;
      const show = (open: boolean) => { menu.hidden = !open; more.setAttribute('aria-expanded', String(open)); };
      more.onclick = () => { show(menu.hidden); if (!menu.hidden) (menu.firstChild as HTMLElement | null)?.focus(); };
      menu.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); show(false); more.focus(); } };
      for (const c of older) { const label = this.crumbName(c.node), b = make('button', 'graph-ng-crumbs-item', menu); b.textContent = label; b.title = label; b.setAttribute('aria-label', 'Back to ' + label); go(c, b); }
    }
    const ol = make('ol', '');
    shown.forEach((c, i) => {
      const li = make('li', '', ol), label = this.crumbName(c.node);
      if (i || older.length) { const chevron = make('span', 'graph-ng-crumbs-sep', li); setIcon(chevron, 'chevron-right'); chevron.setAttribute('aria-hidden', 'true'); }
      const chip = make('button', 'graph-ng-crumb', li); chip.textContent = label; chip.title = label; chip.style.opacity = String(crumbFade(c.index - at));
      if (c.current && c.node === selected) chip.setAttribute('aria-current', 'location');
      else { chip.setAttribute('aria-label', (c.index < at ? 'Back to ' : c.index > at ? 'Forward to ' : 'Return to ') + label); go(c, chip); }
    });
    const clear = make('button', 'clickable-icon graph-ng-crumbs-clear'); setIcon(clear, 'x'); clear.setAttribute('aria-label', 'Clear recent notes'); clear.title = 'Clear recent notes'; clear.onclick = () => this.clearCrumbs();
  }
}
