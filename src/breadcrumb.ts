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
/** Breadcrumb strip at the top of the canvas: a chip per visited focus, joined by chevrons (CSS).
 * Clicking a chip travels there through the card history. Names are set as text only. */
export class Breadcrumb {
  readonly root: HTMLElement;
  private crumbKey: unknown[] = [];
  constructor(parent: HTMLElement, private crumbName: (n: number) => string, private travelBy: (by: number) => void) {
    this.root = parent.appendChild(Object.assign(document.createElement('nav'), { className: 'graph-ng-crumbs' }));
    this.root.setAttribute('aria-label', 'Visited notes'); this.root.hidden = true;
  }
  /** Per frame: re-renders only when the history moved. A single entry is not a trail and stays hidden. */
  update(on: boolean, history: { items: readonly number[]; at: number }) {
    const { items, at } = history, key = [on, items, items.length, at, items[0], items[at], items[items.length - 1]];
    if (key.every((x, i) => x === this.crumbKey[i])) return;
    this.crumbKey = key;
    const list = on ? crumbs(items, at) : [];
    this.root.hidden = list.length < 2; this.root.textContent = '';
    if (this.root.hidden) return;
    const ol = this.root.appendChild(document.createElement('ol'));
    for (const c of list) {
      const label = this.crumbName(c.node), chip = ol.appendChild(document.createElement('li')).appendChild(Object.assign(document.createElement('button'), { className: 'graph-ng-crumb', textContent: label }));
      chip.title = label;
      if (c.current) chip.setAttribute('aria-current', 'location');
      else { chip.setAttribute('aria-label', (c.index < at ? 'Back to ' : 'Forward to ') + label); chip.onclick = () => this.travelBy(c.index - at); }
    }
  }
}
