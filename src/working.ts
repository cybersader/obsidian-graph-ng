/** One weighted rebuild: read 30%, project 20%, layout 45%, draw 5%.
 * Repeated stages and revised totals cannot move the same run backwards. */
export class BuildProgress {
  percent = 0;
  start() { this.percent = 0; }
  text(step: number, fraction = 0) {
    const start = [0, 30, 50, 95, 100], names = ['Reading notes', 'Building', 'Laying out notes', 'Drawing notes', 'Ready'];
    this.percent = Math.max(this.percent, Math.floor(start[step]! + ((start[step + 1] ?? 100) - start[step]!) * Math.max(0, Math.min(1, fraction || 0))));
    // Coverage is metadata readiness, not completed work. Unmeasured phases shimmer.
    return step < 2 ? names[step]! : `${names[step]} ${this.percent}%`;
  }
}
/** Keep one glyph span and CSS sweep through updates; no overlapping old percentages. */
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
