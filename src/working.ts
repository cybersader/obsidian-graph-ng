/** Text-only status, with CSS-owned motion. Progress updates keep the sweep running;
 * stage changes cross-fade once. No timers, animation frames or retained listeners. */
export function workingText(el: HTMLElement, text: string, busy = false) {
  const current = el.lastElementChild as HTMLElement | null, old = current?.textContent ?? '';
  const cls = `graph-ng-status-current${busy ? ' graph-ng-working' : ''}`;
  if (current?.className === cls && old.replace(/[\d.,/%]+/g, '') === text.replace(/[\d.,/%]+/g, '')) {
    if (old !== text) current.textContent = text;
    return;
  }
  el.textContent = ''; el.addClass('graph-ng-working-status');
  if (!text) return;
  if (old) el.createSpan({ cls: 'graph-ng-status-previous', attr: { 'data-text': old, 'aria-hidden': 'true' } });
  el.createSpan({ cls, text });
}
