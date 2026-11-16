/** One weighted rebuild: read 30%, project 20%, layout 45%, draw 5%.
 * Repeated stages and revised totals cannot move the same run backwards. */
export class BuildProgress {
  run = 0;
  percent = 0;
  start() { this.run++; this.percent = 0; }
  text(step: number, fraction = 0) {
    const start = [0, 30, 50, 95, 100], names = ['Reading notes', 'Resolving relationships', 'Laying out notes', 'Drawing notes', 'Ready'];
    this.percent = Math.max(this.percent, Math.floor(start[step]! + ((start[step + 1] ?? 100) - start[step]!) * Math.max(0, Math.min(1, fraction || 0))));
    return `Build ${this.run}: ${names[step]} ${this.percent}%`;
  }
}
/** Keep the same glyph span and CSS sweep through number and step changes.
 * Only a step change adds a fading old label; there is no per-number opacity fade. */
export function workingText(el: HTMLElement, text: string, busy = false) {
  let current = el.querySelector<HTMLElement>('.graph-ng-status-current');
  const old = current?.textContent ?? '', step = (s: string) => s.replace(/[\d.,/%]+/g, '');
  if (old === text && current?.className === `graph-ng-status-current${busy ? ' graph-ng-working' : ''}`) return;
  el.addClass('graph-ng-working-status');
  if (!text) { el.textContent = ''; return; }
  if (!current) current = el.createSpan({ cls: `graph-ng-status-current${busy ? ' graph-ng-working' : ''}` });
  if (old && step(old) !== step(text)) {
    el.querySelector('.graph-ng-status-previous')?.remove();
    const previous = el.createSpan({ cls: 'graph-ng-status-previous', attr: { 'data-text': old, 'aria-hidden': 'true' } });
    current.before(previous);
  }
  const cls = `graph-ng-status-current${busy ? ' graph-ng-working' : ''}`;
  if (current.className !== cls) current.toggleClass('graph-ng-working', busy);
  if (current.firstChild) current.firstChild.nodeValue = text; else current.textContent = text;
}
