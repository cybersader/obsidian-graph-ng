/** Keep one glyph span and CSS sweep through updates; no overlapping stage labels. */
export function workingText(el: HTMLElement, text: string, busy = false) {
  let current = el.querySelector<HTMLElement>('.graph-ng-status-current');
  const cls = `graph-ng-status-current${busy ? ' graph-ng-working' : ''}`;
  if (current?.textContent === text && current.className === cls) return;
  el.addClass('graph-ng-working-status');
  if (!text) { el.textContent = ''; return; }
  if (!current) current = el.createSpan({ cls });
  if (current.className !== cls) current.toggleClass('graph-ng-working', busy);
  if (current.firstChild) current.firstChild.nodeValue = text; else current.textContent = text;
}
