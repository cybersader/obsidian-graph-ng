import { setIcon } from 'obsidian';
let helpId = 0;
/** Dotted labels reveal text on hover, focus or tap. Native popovers escape panel clipping,
 * dismiss on outside tap, and need no document listeners to clean up on panel rebuild. */
export function panelHelp(host: HTMLElement, label: string, text?: string, cls = '') {
  const wrap = host.createSpan({ cls });
  if (!text) { wrap.textContent = label; return wrap; }
  const id = `graph-ng-help-${++helpId}`;
  const trigger = wrap.createEl('button', { cls: 'graph-ng-help-trigger', text: label, attr: { type: 'button', 'aria-describedby': id } });
  const tip = wrap.createSpan({ cls: 'graph-ng-help-popover', text, attr: { id, popover: 'auto', role: 'tooltip' } });
  tip.hidden = true;
  const close = () => { tip.hidePopover?.(); tip.hidden = true; };
  const open = () => {
    tip.hidden = false; tip.showPopover?.();
    const r = trigger.getBoundingClientRect(), w = trigger.ownerDocument.defaultView!;
    tip.style.left = `${Math.max(8, Math.min(r.left, w.innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(r.bottom, w.innerHeight - tip.offsetHeight - 8))}px`;
  };
  trigger.onfocus = trigger.onpointerenter = trigger.onclick = open;
  trigger.onblur = close;
  wrap.onpointerleave = () => { if (trigger.ownerDocument.activeElement !== trigger) close(); };
  trigger.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  return tip;
}
/** The same host chevron for every panel disclosure; native summary keyboard behavior stays intact. */
export function disclosure(host: HTMLElement, text = '', attr: Record<string, string> = {}) {
  const summary = host.createEl('summary', { attr });
  setIcon(summary.createSpan({ cls: 'graph-ng-chevron' }), 'chevron-right');
  summary.createSpan({ cls: 'graph-ng-disclosure-label', text });
  return summary;
}
