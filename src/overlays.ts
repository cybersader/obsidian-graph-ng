import { TIERS } from './render-data';

/** Elements of the bounded, text-only highlight overlay. */
export interface HighlightOverlay {
  ripple: HTMLElement;
  /** Top-left column: the recent-notes trail (CSS order first) above the legend. */
  stack: HTMLElement;
  legend: HTMLElement;
  /** One toggle row per TIERS entry, and its count cell. */
  rows: HTMLElement[];
  counts: HTMLElement[];
  /** Eight off-screen direction pips, and each pip's [arrow, count] parts. */
  pips: HTMLElement[];
  parts: [HTMLElement, HTMLElement][];
}

/** Build the tier legend (4 toggle rows, in a top-left stack the trail joins), 8 off-screen pips and one ripple ring inside `overlay`.
 * Rows call `toggleTier(row)`; pips call `goToPip(pip)`. Text only, no markup from notes. */
export function highlightOverlay(overlay: HTMLElement, toggleTier: (row: number) => void, goToPip: (pip: number) => void): HighlightOverlay {
  const make = (tag: string, cls: string, parent: HTMLElement = overlay) => parent.appendChild(Object.assign(document.createElement(tag), { className: cls }));
  const ripple = make('div', 'graph-ng-ripple'); ripple.hidden = true; ripple.setAttribute('aria-hidden', 'true');
  const stack = make('div', 'graph-ng-focus-stack'), legend = make('div', 'graph-ng-tier-legend', stack); legend.hidden = true; legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', 'Graduated connection highlighting');
  const counts: HTMLElement[] = [], pips: HTMLElement[] = [], parts: [HTMLElement, HTMLElement][] = [];
  const rows = TIERS.map(([name], i) => {
    const row = make('button', 'graph-ng-tier-row', legend); row.hidden = true;
    make('span', 'graph-ng-tier-key graph-ng-tier-key-' + i, row); make('span', 'graph-ng-tier-name', row).textContent = name; counts.push(make('span', 'graph-ng-legend-count', row));
    row.onclick = () => toggleTier(i);
    return row;
  });
  for (let i = 0; i < 8; i++) {
    const pip = make('button', 'graph-ng-pip'), arrow = make('span', 'graph-ng-pip-arrow', pip); pip.hidden = true; arrow.setAttribute('aria-hidden', 'true'); parts.push([arrow, make('span', 'graph-ng-pip-count', pip)]);
    pip.onclick = () => goToPip(i); pips.push(pip);
  }
  return { ripple, stack, legend, rows, counts, pips, parts };
}

/** Legend rows: hidden when the tier is empty, pressed when its emphasis is on. */
export function paintLegend(rows: HTMLElement[], counts: HTMLElement[], mask: number, totals: number[]) {
  rows.forEach((row, i) => {
    const on = !!(mask & 1 << i); row.hidden = !totals[i]; row.setAttribute('aria-pressed', String(on)); row.className = 'graph-ng-tier-row' + (on ? '' : ' graph-ng-tier-off');
    counts[i]!.textContent = totals[i]!.toLocaleString();
  });
}
