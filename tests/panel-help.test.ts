import { test, expect, beforeEach, afterEach } from 'bun:test';
import './support/obsidian-fixture';
import { ControlElement } from './support/controls-dom';
import { panelHelp, disclosure, settingSelect, panelButton } from '../src/panel-help';
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
test('one weighted build never regresses on repeated stages, revised totals or cache skips', async () => {
  const { BuildProgress } = await import('../src/working');
  const p = new BuildProgress(); p.start(); const seen: number[] = [];
  for (const [step, fraction] of [[0, 0], [0, .8], [0, .2], [1, 0], [2, .4], [0, 0], [2, .1], [3, 0], [4, 0]]) { p.text(step!, fraction); seen.push(p.percent); }
  expect(seen).toEqual([0, 24, 24, 30, 68, 68, 68, 95, 100]);
  p.start(); expect(p.text(0)).toBe('Reading notes 0%');
  expect(p.text(2, .4)).toBe('Laying out notes 68%');
});
test('summary retains the same working glyph span through number and step updates', () => {
  const f = fixture(); let stage = 'Reading notes 10%'; f.host.loading = () => ({ stage }); f.panel.show('filters');
  const span = f.panel.counts.querySelector('.graph-ng-working');
  f.panel.counts.empty = () => { throw new Error('Progress must stay connected during percentage and step updates'); };
  stage = 'Reading notes 20%'; f.panel.updateSummary(); expect(f.panel.counts.querySelector('.graph-ng-working')).toBe(span);
  expect(f.panel.counts.querySelector('.graph-ng-status-previous')).toBeUndefined();
  stage = 'Laying out notes 64%'; f.panel.updateSummary(); expect(f.panel.counts.querySelector('.graph-ng-working')).toBe(span);
  expect(f.panel.counts.querySelector('.graph-ng-status-previous')).toBeDefined(); f.panel.dispose();
});
test('Filters relationships exposes the existing Lines and Notes save/rebuild action', async () => {
  const f = fixture(); const calls: boolean[] = [];
  f.settings.declaration.edges.push({ kind: 'reified', name: 'relation', sourceProperty: 'source', targetProperty: 'target' });
  f.host.setRelationshipDisplay = async (nodes: boolean) => { calls.push(nodes); f.settings.declaration.display.reifiedAsNodes = nodes; };
  f.panel.show('filters'); const section = f.root.querySelector('.graph-ng-explore-edges')!;
  expect(section.textContent).toContain('Relationship notes'); expect(section.textContent).toContain('Saves globally and rebuilds');
  const button: any = section.querySelectorAll('button').find(e => e.textContent === 'Notes'); expect(button).toBeDefined(); await button.onclick();
  expect(calls).toEqual([true]); f.panel.show('appearance');
  expect(f.root.querySelectorAll('button').find(e => e.textContent === 'Notes')!.getAttribute('aria-pressed')).toBe('true'); f.panel.dispose();
});
function fixture() {
  const settings = defaults('links'), root = new ControlElement(), view = emptyView();
  const p = buildProjection([{ path: 'Synthetic/A.md', properties: {} }], settings.declaration);
  const result = explore(p, settings.declaration, view, colorGroups(p, settings.declaration), 0, { facetValues: 10 });
  const host: any = { information: root.createDiv({ cls: 'graph-ng-status' }), members: root.createDiv({ cls: 'graph-ng-panel' }), settings: () => settings, result: () => result, mode: () => 'nodes', groupColor: () => '#4477aa', policy: () => [], carriers: () => 0, setView() {}, persist() {}, visualsChanged() {}, applyLayout() {} };
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
  f.host.loading = () => ({ stage: `Reading links ${done}%` }); f.panel.show('layout');
  const body = f.panel.body, children = [...body.children], field = body.querySelector('input');
  field.focus(); body.scrollTop = 101;
  for (done = 1; done <= 100; done++) f.panel.updateSummary();
  expect(body.children).toEqual(children); expect(ControlElement.active).toBe(field); expect(body.scrollTop).toBe(101);
  expect(f.panel.counts.textContent).toContain('Notes shown so far'); expect(f.panel.counts.textContent).toContain('Reading links 100%'); expect(f.panel.counts.textContent).not.toContain('Hidden, see why');
  f.host.loading = () => undefined; f.panel.updateSummary(); expect(f.panel.counts.textContent).not.toContain('so far');
  f.panel.close(); const counts = [...f.panel.counts.children]; f.panel.updateSummary(); expect(f.panel.counts.children).toEqual(counts); f.panel.dispose();
});

test('layout loading percentage appears once', async () => {
  const { layoutProgress } = await import('../src/graph-information');
  const f = fixture(); f.host.loading = () => ({ stage: layoutProgress({ iteration: 35, total: 100 }), done: 35, total: 100 });
  f.panel.updateSummary(); expect(f.panel.counts.textContent.match(/35%/g)).toHaveLength(1); f.panel.dispose();
});

test('one layout draft change uses singular copy', () => {
  const f = fixture(); f.panel.show('layout');
  const input: any = f.root.querySelectorAll('input').find(e => e.getAttribute('aria-label') === 'Pull to center');
  expect(input).toBeDefined(); input.value = '2'; input.oninput();
  expect(f.root.querySelector('.graph-ng-layout-changes')!.textContent).toContain('1 change');
  expect(f.root.querySelector('.graph-ng-layout-changes')!.textContent).not.toContain('1 changes'); f.panel.dispose();
});

test('toggle names retain native labels and help names activate their checkbox', () => {
  const f = fixture(); f.panel.show('appearance');
  for (const row of f.root.querySelectorAll('.graph-ng-toggle').filter(r => r.classes.has('graph-ng-setting'))) {
    expect(row.tagName).toBe('LABEL');
    expect(row.classes.has('setting-item')).toBe(true);
    expect(row.children[0]!.classes.has('checkbox-container')).toBe(true);
    expect(row.children[0]!.querySelector('input')!.type).toBe('checkbox');
    const input = row.querySelector('input')!, trigger: any = row.querySelector('.graph-ng-help-trigger');
    if (trigger) {
      let clicks = 0; input.click = () => { clicks++; };
      trigger.ownerDocument = { defaultView: { innerWidth: 800, innerHeight: 600 } };
      trigger.getBoundingClientRect = () => ({ left: 0, bottom: 20 }); trigger.onclick();
      expect(clicks).toBe(1);
    }
  }
  f.panel.show('layout');
  for (const row of f.root.querySelectorAll('.graph-ng-toggle')) expect(row.tagName).toBe('LABEL');
  f.panel.dispose();
});

test('Motion uses a default and saves all choices through the live appearance path', () => {
  const f = fixture(); let updates = 0; f.host.visualsChanged = () => updates++; f.panel.show('appearance');
  const motion: any = f.root.querySelectorAll('select').find(e => e.getAttribute('aria-label') === 'Motion');
  expect(motion.value).toBe('full'); expect(motion.children.map((e: any) => e.textContent)).toEqual(['Full (default)', 'Reduced', 'Off']);
  for (const value of ['reduced', 'off', 'full'] as const) { motion.value = value; motion.onchange(); expect(f.settings.visuals.motion).toBe(value); }
  expect(updates).toBe(3); expect(motion.parentElement.querySelector('.graph-ng-help-popover').hidden).toBe(true); f.panel.dispose();
});

test('working text returns to idle when summary and apply operations finish', async () => {
  const f = fixture(); f.host.loading = () => ({ stage: 'Reading notes 50%' }); f.panel.show('layout');
  expect(f.panel.counts.querySelector('.graph-ng-working')!.textContent).toBe('Reading notes 50%');
  f.host.loading = () => undefined; f.panel.updateSummary(); expect(f.panel.counts.querySelector('.graph-ng-working')).toBeUndefined();
  let finish!: () => void; f.host.applyLayout = () => new Promise<void>(resolve => { finish = resolve; });
  const action = f.root.querySelectorAll('button').find(e => e.textContent === 'Apply layout')!;
  const pending = action.onclick!(); expect(f.root.querySelector('.graph-ng-working')!.textContent).toBe('Recomputing…');
  finish(); await pending; expect(f.root.querySelector('.graph-ng-working')).toBeUndefined(); f.panel.dispose();
});

test('saved view working text clears after either opening or saving completes', () => {
  const f = fixture(); f.panel.viewMessage = 'Opening ‘Synthetic’…'; f.panel.show('views');
  expect(f.root.querySelector('.graph-ng-working')!.textContent).toContain('Opening');
  f.panel.viewMessage = 'Opened ‘Synthetic’.'; f.panel.render(); expect(f.root.querySelector('.graph-ng-working')).toBeUndefined();
  f.panel.viewBusy = true; f.panel.viewMessage = 'Saving…'; f.panel.render(); expect(f.root.querySelector('.graph-ng-working')!.textContent).toBe('Saving…');
  f.panel.viewBusy = false; f.panel.viewMessage = 'Saved'; f.panel.render(); expect(f.root.querySelector('.graph-ng-working')).toBeUndefined(); f.panel.dispose();
});

test('builder JSON disclosure has the shared chevron and an accessible name', () => {
  const f = fixture(); f.panel.view = { ...emptyView(), filters: [{ kind: 'exists', key: 'rank' }] }; f.panel.body.empty(); f.panel.filters(f.panel.body, f.host.result());
  const summary = f.root.querySelector('.graph-ng-chip-json')!.querySelector('summary')!;
  expect(summary.getAttribute('aria-label')).toBe('Edit builder filter 1 as JSON');
  expect(summary.querySelectorAll('svg').some(e => e.getAttribute('data-icon') === 'chevron-right')).toBe(true); f.panel.dispose();
});

test('panel and canvas help ID namespaces cannot collide', () => {
  const root = new ControlElement(), tip = panelHelp(root as any, 'Help', 'Synthetic help');
  const source = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
  const prefix = /help\.id = `([^$]+)\$/.exec(source)![1]!;
  expect(tip.id.startsWith(prefix)).toBe(false);
});

test('PanelHost declares loading only once', () => {
  const source = readFileSync(new URL('../src/explore-panel.ts', import.meta.url), 'utf8');
  expect(source.match(/loading\?\(\)/g)).toHaveLength(1);
});

test('slider reset has an accessible name without a native tooltip', () => {
  const f = fixture(); f.panel.show('appearance');
  const resets = f.root.querySelectorAll('.graph-ng-slider-reset'); expect(resets.length).toBeGreaterThan(0);
  for (const reset of resets) { expect(reset.getAttribute('aria-label')).toMatch(/^Reset /); expect(reset.getAttribute('title')).toBeNull(); }
  f.panel.dispose();
});

test('Saved views uses hidden shared help, including draft effects; information has no duplicate header counts', () => {
  const f = fixture(); f.host.camera = () => null; f.panel.show('views');
  expect(f.root.querySelectorAll('.graph-ng-help-trigger').map(e => e.textContent)).toContain('What a view saves');
  for (const tip of f.root.querySelectorAll('.graph-ng-help-popover')) expect(tip.hidden).toBe(true);
  const notes = f.root.querySelectorAll('.graph-ng-explore-note').map(e => e.textContent).join(' ');
  expect(notes).not.toContain('Views save'); expect(notes).not.toContain('Explore one folder');
  f.root.querySelectorAll('button').find(e => e.textContent === 'Set up folder view…')!.click();
  expect(f.root.querySelectorAll('.graph-ng-help-trigger').map(e => e.textContent)).toContain('What opening changes');
  f.panel.show('information'); expect(f.panel.counts.hidden).toBe(true);
  f.panel.show('views'); expect(f.panel.counts.hidden).toBe(false); f.panel.dispose();
});

test('saved view definitions stay collapsed by default and preserve expansion on updates', () => {
  const f = fixture(); f.settings.explore.savedViews = [{ name: 'Synthetic view', view: emptyView(), camera: null }]; f.panel.show('views');
  const details = () => f.root.querySelector('.graph-ng-saved-record')!.querySelector('details') as any;
  expect(details().open).toBe(false); details().open = true; details().ontoggle();
  f.panel.render(); expect(details().open).toBe(true);
  expect(details().querySelector('summary').getAttribute('aria-label')).toBe('View definition: Synthetic view'); f.panel.dispose();
});


test('every tool keeps opaque summary chrome outside its divided scroll surface', () => {
  const f = fixture(), head = f.panel.root.querySelector('.graph-ng-explore-head');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const chrome = css.match(/\.graph-ng-explore > :is\(\.graph-ng-explore-head, \.graph-ng-explore-counts, \.graph-ng-explore-error\) \{([^}]+)\}/)![1]!;
  expect(chrome).toContain('flex:none'); expect(chrome).toContain('background:var(--background-primary)');
  const scroll = css.match(/\.graph-ng-explore-body, \.graph-ng-explore > \.graph-ng-status, \.graph-ng-explore > \.graph-ng-panel \{([^}]+)\}/)![1]!;
  expect(scroll).toContain('border-top:1px solid var(--background-modifier-border)');
  expect(scroll).toContain('padding-top:var(--gng-space-2)'); expect(scroll).toContain('scrollbar-gutter:stable');
  for (const tool of ['views', 'filters', 'appearance', 'layout', 'information', 'members']) {
    f.panel.show(tool);
    const surface = tool === 'information' ? f.host.information : tool === 'members' ? f.host.members : f.panel.body;
    expect(surface.hidden).toBe(false); expect(surface.parentElement).toBe(f.panel.root);
    expect(f.panel.counts.parentElement).toBe(f.panel.root); expect(head.parentElement).toBe(f.panel.root);
    expect(surface.contains(head)).toBe(false); expect(surface.contains(f.panel.counts)).toBe(false);
    surface.scrollTop = 96; f.panel.updateSummary(); expect(surface.scrollTop).toBe(96);
  }
  f.panel.dispose();
});

test('shared setting choices and actions retain text, accessible names and disabled behavior', async () => {
  const root = new ControlElement(), changes: string[] = [];
  const select: any = settingSelect(root as any, 'Synthetic choice', 'Synthetic help', [['a', 'First'], ['b', 'Second']], 'b', value => changes.push(value), 'graph-ng-select', true);
  expect(select.value).toBe('b'); expect(select.disabled).toBe(true); expect(select.getAttribute('aria-label')).toBe('Synthetic choice');
  expect(select.children.map((e: any) => [e.value, e.textContent])).toEqual([['a', 'First'], ['b', 'Second']]);
  expect(select.parentElement.querySelector('.graph-ng-help-popover').hidden).toBe(true);
  select.disabled = false; select.value = 'a'; select.onchange(); expect(changes).toEqual(['a']);
  let calls = 0;
  const button: any = panelButton(root as any, '<b>Action</b>', async () => ++calls, true, 'mod-cta', { 'aria-label': 'Synthetic action' });
  expect(button.children).toHaveLength(0); expect(button.textContent).toBe('<b>Action</b>'); expect(button.getAttribute('aria-label')).toBe('Synthetic action'); expect(button.classes.has('mod-cta')).toBe(true);
  button.click(); expect(calls).toBe(0); button.disabled = false; expect(await button.onclick()).toBe(1);
});

test('appearance choices keep their original save and label-refresh paths', () => {
  const f = fixture(), updates: boolean[] = []; f.host.visualsChanged = (labels: boolean) => updates.push(labels);
  for (const [key, name, choices, labels] of [
    ['edgeCompositing', 'Edge compositing', ['density', 'blend'], false],
    ['emphasis', 'Highlight emphasis', ['scale', 'adaptive'], false],
    ['labelStyle', 'Label style', ['ranked', 'anchored'], true],
    ['motion', 'Motion', ['off', 'reduced', 'full'], false],
  ] as const) {
    for (const value of choices) {
      f.panel.show('appearance');
      const select: any = f.root.querySelectorAll('select').find(e => e.getAttribute('aria-label') === name);
      select.value = value; select.onchange(); expect(f.settings.visuals[key]).toBe(value); expect(updates.at(-1)).toBe(labels);
    }
  }
  expect(updates).toHaveLength(9); f.panel.dispose();
});
