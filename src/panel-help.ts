import { setIcon } from 'obsidian';
let helpId = 0;
export const RELATIONSHIP_HELP = 'A note that stands for a connection between two notes.\nAlso called: edge notes, junction notes, reified edges, join notes.\nLines shows one edge. Notes shows its own dot (an incidence graph).';
/** Shared native setting row; checkbox labels keep their activation semantics. */
export function settingRow(host: HTMLElement, label: string, cls = '', desc?: string) {
  const toggle = cls.includes('graph-ng-toggle'), row = host.createEl(toggle ? 'label' : 'div', { cls: `setting-item graph-ng-setting ${cls}` }), [, name = label, a, b] = (toggle && !desc && /^(.+?)(?: \((.+)\)|: (.+))$/.exec(label)) || [];
  if (row.tagName === 'LABEL') row.createSpan({ cls: 'checkbox-container' }).createEl('input', { attr: { type: 'checkbox', 'aria-label': name } });
  panelHelp(row, name, desc ?? a ?? b, 'setting-item-name graph-ng-setting-name');
  return row;
}
/** A named choice with the same help, options and change path in every panel. */
export function settingSelect(host: HTMLElement, label: string, desc: string, options: readonly (readonly [string, string])[], value: string, changed: (value: string) => void, cls = '', disabled = false) {
  const select = settingRow(host, label, cls, desc).createEl('select', { attr: { 'aria-label': label } });
  for (const [key, text] of options) select.createEl('option', { value: key, text }).selected = key === value;
  select.value = value; select.disabled = disabled; select.onchange = () => changed(select.value);
  return select;
}
/** Text-only actions share disabled, class and accessible-name plumbing. */
export function panelButton(host: HTMLElement, text: string, click: () => unknown, disabled = false, cls = '', attr: Record<string, string> = {}) {
  const button = host.createEl('button', { text, cls, attr });
  button.disabled = disabled; button.onclick = click; return button;
}
/** Icon actions always retain a text-only accessible name. */
export function iconButton(host: HTMLElement, label: string, icon: string, cls = 'clickable-icon', attr: Record<string, string> = {}) {
  const button = host.createEl('button', { cls, attr: { 'aria-label': label, ...attr } });
  setIcon(button, icon); return button;
}
/** Dotted labels reveal text on hover, focus or tap. Native popovers escape panel clipping,
 * dismiss on outside tap, and need no document listeners to clean up on panel rebuild. */
export function panelHelp(host: HTMLElement, label: string, text?: string, cls = '') {
  if (label.toLowerCase() === 'relationship notes') text = RELATIONSHIP_HELP;
  const wrap = host.createSpan({ cls });
  if (!text) { wrap.textContent = label; return wrap; }
  const id = `graph-ng-panel-help-${++helpId}`;
  const trigger = wrap.createEl('button', { cls: 'graph-ng-help-trigger', text: label, attr: { type: 'button', 'aria-describedby': id } });
  const tip = wrap.createSpan({ cls: 'graph-ng-help-popover', text, attr: { id, popover: 'auto', role: 'tooltip' } });
  tip.hidden = true;
  tip.ontoggle = e => { tip.hidden = (e as ToggleEvent).newState === 'closed'; };
  const close = () => { tip.hidePopover?.(); tip.hidden = true; };
  const open = () => {
    tip.hidden = false; tip.showPopover?.();
    const r = trigger.getBoundingClientRect(), w = trigger.ownerDocument.defaultView!;
    tip.style.left = `${Math.max(8, Math.min(r.left, w.innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(r.bottom, w.innerHeight - tip.offsetHeight - 8))}px`;
  };
  trigger.onfocus = trigger.onpointerenter = open;
  // Buttons inside labels suppress native activation; forward name clicks to the toggle.
  trigger.onclick = () => { open(); if (host.tagName === 'LABEL') host.querySelector('input')?.click(); };
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
