import { test, expect, beforeEach, afterEach } from 'bun:test';
import './support/obsidian-fixture';
import { ControlElement } from './support/controls-dom';
import { panelHelp, disclosure } from '../src/panel-help';
import { ExplorePanel } from '../src/explore-panel';
import { defaults } from '../src/settings';
import { emptyView, explore } from '../src/core/explore';
import { buildProjection, colorGroups } from '../src/core/projection';
import { readFileSync } from 'node:fs';
const old = new Map<string, any>();
beforeEach(() => {
  for (const key of ['document', 'HTMLElement', 'HTMLInputElement']) old.set(key, (globalThis as any)[key]);
  Object.assign(globalThis, { document: { get activeElement() { return ControlElement.active; } }, HTMLElement: ControlElement, HTMLInputElement: ControlElement });
});
afterEach(() => { for (const [key, value] of old) { if (value === undefined) delete (globalThis as any)[key]; else (globalThis as any)[key] = value; } ControlElement.active = undefined; });
function fixture() {
  const settings = defaults('links'), root = new ControlElement(), view = emptyView();
  const p = buildProjection([{ path: 'Synthetic/A.md', properties: {} }], settings.declaration);
  const result = explore(p, settings.declaration, view, colorGroups(p, settings.declaration), 0, { facetValues: 10 });
  const host: any = { settings: () => settings, result: () => result, mode: () => 'nodes', policy: () => [], carriers: () => 0, setView() {}, persist() {}, visualsChanged() {}, applyLayout() {} };
  const panel: any = new ExplorePanel(root as any, host, view);
  return { root, panel, host, settings };
}
test('dotted help is text-only and supports focus, hover, tap, Escape and blur without native titles', () => {
  const root = new ControlElement(), tip: any = panelHelp(root as any, 'Node size', '<b>Text only</b>');
  const trigger: any = root.querySelector('.graph-ng-help-trigger'), wrap: any = root.children[0];
  let opens = 0, closes = 0, stopped = 0;
  trigger.ownerDocument = { defaultView: { innerWidth: 320, innerHeight: 240 }, activeElement: null };
  trigger.getBoundingClientRect = () => ({ left: 300, bottom: 230 });
  tip.offsetWidth = 200; tip.offsetHeight = 80; tip.showPopover = () => opens++; tip.hidePopover = () => closes++;
  expect(tip.hidden).toBe(true); expect(tip.textContent).toBe('<b>Text only</b>'); expect(tip.children).toHaveLength(0);
  expect(trigger.getAttribute('aria-describedby')).toBe(tip.id); expect(trigger.getAttribute('title')).toBeNull(); expect(trigger.getAttribute('aria-label')).toBeNull();
  trigger.onfocus(); expect(tip.hidden).toBe(false); expect(tip.style.left).toBe('112px'); expect(tip.style.top).toBe('152px');
  trigger.onkeydown({ key: 'Escape', preventDefault() { stopped++; }, stopPropagation() { stopped++; } }); expect(stopped).toBe(2); expect(tip.hidden).toBe(true);
  trigger.onpointerenter(); expect(tip.hidden).toBe(false); wrap.onpointerleave(); expect(tip.hidden).toBe(true);
  trigger.onclick(); expect(tip.hidden).toBe(false); trigger.onblur(); expect(tip.hidden).toBe(true);
  expect(opens).toBe(3); expect(closes).toBe(3);
  const section = root.createEl('details'); disclosure(section as any, 'More options');
  expect(section.querySelector('summary')!.textContent).toBe('More options'); expect(section.querySelector('svg')!.getAttribute('data-icon')).toBe('chevron-right');
});
test('panel descriptions are hidden, values align, and Ranked-only controls stay reachable', () => {
  const f = fixture(); f.panel.show('appearance');
  const input = (name: string) => f.root.querySelectorAll('input').find(e => e.getAttribute('aria-label') === name);
  expect(f.root.querySelectorAll('.graph-ng-setting-desc')).toHaveLength(0);
  for (const help of f.root.querySelectorAll('.graph-ng-help-popover')) expect(help.hidden).toBe(true);
  expect(f.root.textContent).not.toMatch(/CSS px|% > 0|Ordinary unhighlighted radius/);
  for (const row of f.root.querySelectorAll('.graph-ng-slider')) {
    const line = row.querySelector('.graph-ng-slider-line')!;
    expect(line.children.map(e => [...e.classes][0])).toEqual(['graph-ng-slider-track', 'graph-ng-slider-chip', 'clickable-icon']);
  }
  expect(input('Label size range')).toBeUndefined();
  const select: any = f.root.querySelectorAll('select').find(e => e.getAttribute('aria-label') === 'Label style');
  expect(select.value).toBe('anchored'); select.value = 'ranked'; select.onchange();
  expect(f.settings.visuals.labelStyle).toBe('ranked'); expect(input('Label size range')).toBeDefined();
  expect(input('Fade labels')).toBeDefined();
  f.panel.show('layout'); expect(f.root.querySelectorAll('.graph-ng-setting-desc')).toHaveLength(0);
  for (const help of f.root.querySelectorAll('.graph-ng-help-popover')) expect(help.hidden).toBe(true);
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css.match(/\.graph-ng-legend \{[^}]+\}/)?.[0]).toContain('max-height:none; overflow:visible'); expect(css).toContain('scrollbar-gutter:stable');
  expect(css).toContain('details[open] > summary > .graph-ng-chevron'); f.panel.dispose();
});
test('progress updates only the summary, preserving focused drafts and scroll, and is inert when closed', () => {
  const f = fixture(); let done = 0;
  f.host.loading = () => ({ stage: 'Reading links', done, total: 100 }); f.panel.show('layout');
  const body = f.panel.body, children = [...body.children], field = body.querySelector('input');
  field.focus(); body.scrollTop = 101;
  for (done = 1; done <= 100; done++) f.panel.updateSummary();
  expect(body.children).toEqual(children); expect(ControlElement.active).toBe(field); expect(body.scrollTop).toBe(101);
  expect(f.panel.counts.textContent).toContain('Notes shown so far'); expect(f.panel.counts.textContent).toContain('Reading links100%'); expect(f.panel.counts.textContent).not.toContain('Hidden, see why');
  f.host.loading = () => undefined; f.panel.updateSummary(); expect(f.panel.counts.textContent).not.toContain('so far');
  f.panel.close(); const counts = [...f.panel.counts.children]; f.panel.updateSummary(); expect(f.panel.counts.children).toEqual(counts); f.panel.dispose();
});
