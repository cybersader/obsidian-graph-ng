import { test, expect, beforeEach, afterEach } from 'bun:test';
import './support/obsidian-fixture';
import { ControlElement, control } from './support/controls-dom';
import { ExplorePanel, setRelationshipDisplay } from '../src/explore-panel';
import { defaults } from '../src/settings';
import { emptyView, explore } from '../src/core/explore';
import { buildProjection, colorGroups } from '../src/core/projection';
import { renderProjection } from '../src/render-projection';
import { edgeAlpha, effectPolicy } from '../src/render-effects';
import { GroupRenderer, DetailRenderer } from '../src/renderer';
import { GraphView } from '../src/main';
import { readFileSync } from 'node:fs';
const old = new Map<string, any>();
beforeEach(() => {
  for (const key of ['document', 'HTMLElement', 'HTMLInputElement', 'window']) old.set(key, (globalThis as any)[key]);
  Object.assign(globalThis, { document: { get activeElement() { return ControlElement.active; } }, HTMLElement: ControlElement, HTMLInputElement: ControlElement, window: { devicePixelRatio: 1 } });
});
afterEach(() => { for (const [key, value] of old) { if (value === undefined) delete (globalThis as any)[key]; else (globalThis as any)[key] = value; } ControlElement.active = undefined; });
function fixture() {
  const settings = defaults('links'), root = new ControlElement(), toolbar = root.createDiv(), canvas = root.createEl('canvas'), context = {}, camera = { x: .3, y: .4, ratio: .2 }, scope = new Uint8Array([1, 0]);
  const state = { settings, root, toolbar, canvas, context, camera, scope, selection: 1, view: emptyView(), saved: 0, viewCalls: 0, fit: 0, layout: 0, visual: 0, restored: 0, presentation: '', preview: null as any };
  const host: any = { settings: () => settings, result: () => undefined, mode: () => 'nodes', scope: () => 'Synthetic group', policy: () => effectPolicy(settings.visuals, 100, 60001, 2, false, true).reasons, carriers: () => 0,
    setView: (view: any, after?: () => void) => { state.viewCalls++; state.view = view; settings.explore.view = view; after?.(); }, persist: () => state.saved++, previewSizing: (value: any) => { state.preview = value; }, applySizing: async () => {}, sizingReadout: () => '0.01–0.09 px', applyLayout: async () => { state.layout++; }, fit: () => { state.fit++; }, visualsChanged: () => { state.visual++; }, camera: () => camera, restoreCamera: () => { state.restored++; }, presentation: (mode: string) => { state.presentation = mode; }, information: root.createDiv(), members: root.createDiv() };
  const panel: any = new ExplorePanel(root as any, host, state.view, toolbar as any);
  return { ...state, state, host, panel };
}
const input = (root: ControlElement, name: string) => root.querySelectorAll('input').find(e => e.getAttribute('aria-label') === name) as any;
test('UX stable tools retain canvas/context/camera/selection/query/scope; no Fit/layout/view requests', () => {
  const f = fixture(); f.state.view.query = 'retained query'; f.panel.setState(f.state.view);
  const refs = [f.canvas, f.context, f.camera, f.scope], before = JSON.stringify(f.state.view);
  for (let round = 0; round < 10; round++) for (const tool of ['filters', 'appearance', 'layout', 'information', 'views']) {
    f.panel.show(tool); const open = [...f.panel.buttons.values()].filter((b: any) => b.getAttribute('aria-expanded') === 'true'); expect(open.length).toBe(1);
    f.panel.close(); expect(f.panel.root.hidden).toBe(true); expect(f.panel.search.hidden).toBe(false);
  }
  expect([f.state.canvas, f.state.context, f.state.camera, f.state.scope]).toEqual(refs); expect(f.camera).toEqual({ x: .3, y: .4, ratio: .2 }); expect(f.state.selection).toBe(1); expect(JSON.stringify(f.state.view)).toBe(before);
  expect(f.state.fit + f.state.layout + f.state.viewCalls).toBe(0); expect(f.state.visual).toBe(0);
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.graph-ng-explore { position:absolute;'); expect(css).toContain('inset:8px 8px 8px auto;'); expect(css).not.toContain('flex:0 0 288px');
  // This is ownership + CSS geometry contract evidence, NOT a browser rectangle measurement.
  f.panel.dispose();
});
test('UX Escape/Close returns focus to correct opener without committing drafts', () => {
  const f = fixture(), opener = control(f.toolbar, 'Appearance'); opener.click();
  const radius = input(f.panel.root, 'Node size'); radius.value = '0.0123'; radius.oninput();
  control(f.panel.root, 'Preview sizing').click(); expect(f.state.preview.radius).toBe(.0123); expect(f.settings.nodeSize).toBe(3);
  let stopped = 0; f.panel.root.onkeydown({ key: 'Escape', preventDefault() { stopped++; }, stopPropagation() { stopped++; } });
  expect(stopped).toBe(2); expect(ControlElement.active).toBe(opener); expect(f.state.preview).toBeNull(); expect(f.settings.nodeSize).toBe(3);
  opener.click(); expect(input(f.panel.root, 'Node size').value).toBe('0.0123'); expect(f.panel.sizingMessage).toContain('Preview ended'); f.panel.dispose();
});
test('UX closing while sizing save is pending does not cancel the submitted transaction', async () => {
  const f = fixture(); f.panel.show('appearance'); let release!: () => void;
  f.host.applySizing = () => new Promise<void>(resolve => { release = resolve; });
  control(f.panel.root, 'Preview sizing').click(); const preview = f.state.preview;
  const done = (control(f.panel.root, 'Apply sizing') as any).onclick(); expect(f.panel.sizingBusy).toBe(true);
  f.panel.close(); expect(f.state.preview).toBe(preview); release(); await done; expect(f.panel.sizingBusy).toBe(false); expect(f.panel.sizingMessage).toBe('Saved'); f.panel.dispose();
});
test('UX named view opening is inert; only explicit Open restores existing record and camera', async () => {
  const f = fixture(); f.settings.explore.savedViews = [{ name: 'Synthetic selection', view: { ...emptyView(), query: 'sample' }, camera: { x: .1, y: .2, ratio: 1 } }];
  f.panel.show('views'); expect(f.state.viewCalls).toBe(0); expect(f.state.restored).toBe(0);
  f.host.openSavedView = async (saved: any) => { f.host.setView(saved.view, () => f.host.restoreCamera(saved.camera)); f.panel.setState(saved.view); };
  await (control(f.panel.root, 'Open') as any).onclick(); expect(f.state.viewCalls).toBe(1); expect(f.state.view.query).toBe('sample'); expect(f.state.restored).toBe(1);
  expect(f.panel.buttons.get('views').title).toContain('Synthetic selection'); expect(f.state.layout).toBe(0); f.panel.dispose();
});
test('UX honest empty picker and explicit presentation choices preserve opening mode', () => {
  const f = fixture(); const text = f.panel.root.querySelectorAll('*').map((e: any) => e.textContent).join(' ');
  expect(text).toContain('No saved views yet'); expect(text).toContain('not files'); expect(f.state.presentation).toBe('');
  expect(f.panel.root.querySelectorAll('button').some((button: any) => ['Notes', 'Group overview'].includes(button.textContent))).toBe(false);
  control(f.toolbar, 'Notes').click(); expect(f.state.presentation).toBe('nodes'); control(f.toolbar, 'Group overview').click(); expect(f.state.presentation).toBe('groups'); f.panel.dispose();
});
test('UX exact low-opacity input preserves zero; invalid input never saves and guards sit by controls', () => {
  const f = fixture(); f.panel.show('appearance'); const opacity = input(f.panel.root, 'Edge opacity');
  opacity.value = '0.00001'; opacity.oninput(); expect(f.settings.visuals.edgeOpacity).toBe(.00001); opacity.value = '0'; opacity.oninput(); expect(f.settings.visuals.edgeOpacity).toBe(0);
  const calls = f.state.visual; for (const bad of ['', '-1', 'Infinity', '1.01']) { opacity.value = bad; opacity.oninput(); expect(opacity.getAttribute('aria-invalid')).toBe('true'); }
  expect(f.state.visual).toBe(calls); expect(f.settings.visuals.edgeOpacity).toBe(0);
  const guards = f.panel.root.querySelectorAll('.graph-ng-guard'), curves = guards.find((g: any) => g.querySelector('summary').textContent.startsWith('Curves'));
  expect(curves.hidden).toBe(false); expect(curves.querySelector('div').textContent).toContain('60,000');
  const toggle = input(f.panel.root, 'Curved edges'); toggle.checked = false; toggle.onchange(); expect(curves.hidden).toBe(true); f.panel.dispose();
});
test('UX radius slider broadens precision without weakening finite numeric safety bounds', () => {
  const f = fixture(); f.panel.show('appearance'); const slider = input(f.panel.root, 'Node size slider'); expect(slider.getAttribute('aria-valuemin')).toBe('0.01'); expect(slider.getAttribute('aria-valuemax')).toBe('20');
  slider.value = '0'; slider.oninput(); expect(input(f.panel.root, 'Node size').value).toBe('0.01'); slider.value = '1000'; slider.oninput(); expect(input(f.panel.root, 'Node size').value).toBe('20'); expect(slider.getAttribute('aria-valuenow')).toBe('20');
  const radius = input(f.panel.root, 'Node size'); radius.value = '1e20'; radius.oninput(); control(f.panel.root, 'Preview sizing').click(); expect(f.state.preview).toBeNull(); expect(f.panel.sizingMessage).toContain('Not previewed'); f.panel.dispose();
});
test('UX member navigator renders bounded name/path rows, searches existing members and supports arrows', () => {
  const view: any = Object.create(GraphView.prototype), opened: string[] = [];
  Object.assign(view, { panel: new ControlElement(), plugin: { settings: { listPageSize: 7 } }, openPath: (path: string) => opened.push(path), showGroups() {} });
  const items = Array.from({ length: 16399 }, (_, i) => `Framework/Folder ${i % 3}/Note ${i}.md`); view.memberList(items, (s: string) => s);
  let rows = view.panel.querySelectorAll('.graph-ng-member'); expect(rows.length).toBe(7); expect(rows[0].querySelector('span').textContent).toBe('Note 0'); expect(rows[0].querySelector('small').textContent).toBe('Framework/Folder 0');
  rows[0].focus(); view.panel.querySelector('.graph-ng-members').onkeydown({ key: 'ArrowDown', preventDefault() {} }); expect(ControlElement.active).toBe(rows[1]); rows[1].click(); expect(opened).toEqual([items[1]!]);
  const search = input(view.panel, 'Search available group members'); search.value = 'Note 16398.md'; search.oninput(); rows = view.panel.querySelectorAll('.graph-ng-member'); expect(rows.length).toBe(1); expect(rows[0].getAttribute('aria-label')).toContain('16398'); expect(view.panel.querySelector('.graph-ng-explore-note').textContent).toBe('1 matching note');
});
test('UI batch group fold retains replacement focus across changing labels and subsequent render', () => {
  const f = fixture(), key = 'Odd["group]', p = buildProjection([{ path: `${key}/Note.md`, properties: {} }], f.settings.declaration);
  f.state.view.group = { from: 'folder', depth: 1 };
  f.host.result = () => explore(p, f.settings.declaration, f.state.view, colorGroups(p, f.settings.declaration), 0, { facetValues: 10 });
  let groupFocus = 0; f.host.groupColor = () => '#808080'; f.host.focusGroup = () => { groupFocus++; };
  f.panel.show('filters');
  const fold = (action: string) => f.panel.body.querySelectorAll('button').find((b: ControlElement) => b.getAttribute('aria-label') === `${action} ${key}`)!;
  const collapse = fold('Collapse'); expect(collapse).toBeDefined(); collapse.focus(); collapse.click();
  const expand = fold('Expand'); expect(expand).not.toBe(collapse); expect(ControlElement.active).toBe(expand);
  expect(f.panel.body.contains(expand)).toBe(true); expect(expand.getAttribute('aria-pressed')).toBe('true');
  expand.click(); const next = fold('Collapse'); expect(next).not.toBe(collapse); expect(ControlElement.active).toBe(next);
  expect(next.getAttribute('aria-pressed')).toBe('false'); f.panel.setState(f.state.view);
  expect(ControlElement.active).toBe(fold('Collapse')); expect(ControlElement.active).not.toBe(next);
  expect(f.panel.body.contains(ControlElement.active)).toBe(true); expect(f.state.viewCalls).toBe(2);
  expect(groupFocus).toBe(1); expect(f.state.fit + f.state.layout).toBe(0); f.panel.dispose();
});
function memberRequestFixture() {
  const view: any = Object.create(GraphView.prototype), panel = new ControlElement(), settings = defaults('links');
  const projection = renderProjection(buildProjection([{ path: 'Synthetic/Note.md', properties: {} }], settings.declaration));
  const pending: { resolve: (value: Uint32Array) => void; reject: (error: Error) => void }[] = [];
  let backs = 0;
  Object.assign(view, { panel, projection, activeRevision: 1, detailGeneration: 1, viewGeneration: 1, renderRevision: 0, closed: false,
    groupGraph: { groups: [{ id: 'first', label: 'First', count: 1 }, { id: 'second', label: 'Second', count: 1 }] },
    contributionPage: { clear() {} }, explorePanel: { show() {} }, gpu: { available: false, reason: 'Synthetic no-GPU path' },
    plugin: { settings, pipeline: { request(_revision: number, request: any) { expect(request.kind).toBe('members'); return new Promise<Uint32Array>((resolve, reject) => pending.push({ resolve, reject })); } } },
    showGroups() { backs++; panel.empty(); }, openPath() {} });
  return { view, panel, pending, backs: () => backs, status: () => panel.querySelectorAll('div').find(e => e.getAttribute('role') === 'status' && e.getAttribute('aria-live') === 'polite') };
}
test('group browser pages and searches the existing dictionary without changing graph state', () => {
  const f = fixture(), opened: string[] = [];
  f.settings.listPageSize = 3;
  let groups = Array.from({ length: 9 }, (_, i) => ({ id: String(i), label: `Group ${i}`, count: i + 1 }));
  f.host.memberGroups = () => groups; f.host.groupColor = () => '#808080'; f.host.openGroup = (id: string) => opened.push(id);
  f.panel.show('members'); const host = f.host.members;
  expect(host.querySelectorAll('.graph-ng-legend-row')).toHaveLength(3);
  expect(host.querySelectorAll('.graph-ng-swatch')).toHaveLength(3);
  expect(host.textContent).toContain('1 note'); expect(host.textContent).toContain('2 notes');
  control(host, 'Show more groups').click(); expect(host.querySelectorAll('.graph-ng-legend-row')).toHaveLength(6);
  f.panel.browseGroups('5'); expect(ControlElement.active).toBe(control(host, 'Open members of Group 5'));
  let search = input(host, 'Find a group'); search.focus(); groups = [...groups]; f.panel.render();
  search = input(host, 'Find a group'); expect(ControlElement.active).toBe(search);
  search.value = 'Group 8'; search.oninput();
  expect(host.querySelectorAll('.graph-ng-legend-row')).toHaveLength(1);
  control(host, 'Open members of Group 8').click(); expect(opened).toEqual(['8']);
  f.panel.browseGroups('8'); expect(ControlElement.active).toBe(control(host, 'Open members of Group 8'));
  const next = input(host, 'Find a group'); next.value = 'no match'; next.oninput();
  expect(host.textContent).toContain('No matching groups.');
  groups = []; f.panel.render(); expect(host.textContent).toContain('No groups in this view.');
  expect(f.state.viewCalls + f.state.fit + f.state.layout).toBe(0); expect(f.state.presentation).toBe(''); f.panel.dispose();
});
for (const finish of ['resolve', 'reject', 'back'] as const) test(`panel-only group drill ${finish} preserves camera, scope and renderer`, async () => {
  const f = memberRequestFixture(), scope = new Uint8Array([1]), camera = { x: .4, y: .2, ratio: .7 }, renderer = { camera };
  Object.assign(f.view, { detailScope: scope, scopeName: 'Original', detailRenderer: renderer, gpu: { reason: 'Not probed' } });
  let back = ''; f.view.explorePanel.browseGroups = (id: string) => { back = id; f.panel.empty(); };
  const done = f.view.drill('first', true), button = control(f.panel, 'Back to groups');
  expect(button.textContent).toBe(''); expect(button.querySelector('svg')?.getAttribute('data-icon')).toBe('arrow-left');
  if (finish === 'back') button.click();
  if (finish === 'reject') f.pending[0]!.reject(Error('Synthetic failure')); else f.pending[0]!.resolve(new Uint32Array([0]));
  await done;
  expect(f.view.detailScope).toBe(scope); expect(f.view.scopeName).toBe('Original'); expect(f.view.detailRenderer).toBe(renderer); expect(f.view.renderRevision).toBe(0);
  expect(f.pending).toHaveLength(1); expect(f.backs()).toBe(0);
  if (finish === 'back') { expect(back).toBe('first'); expect(f.panel.children).toHaveLength(0); }
  else { expect(f.panel.querySelectorAll('.graph-ng-member')).toHaveLength(finish === 'resolve' ? 1 : 0); control(f.panel, 'Back to groups').click(); expect(back).toBe('first'); }
});

test('UI batch member failure has pending status and explicit recovery without retries or focus movement', async () => {
  const f = memberRequestFixture(), focus = new ControlElement('BUTTON'); focus.focus();
  const done = f.view.drill('first'); expect(f.status()?.textContent).toBe('Loading members…'); expect(f.status()?.getAttribute('aria-live')).toBe('polite');
  f.pending[0]!.reject(new Error('synthetic worker rejection')); await done;
  expect(f.status()?.textContent).toContain('Could not load members'); expect(f.status()?.textContent).not.toContain('synthetic worker rejection');
  expect(f.pending.length).toBe(1); expect(ControlElement.active).toBe(focus);
  control(f.panel, 'Back to groups').click(); expect(f.backs()).toBe(1);
  const retry = f.view.drill('first'); f.pending[1]!.resolve(new Uint32Array([0])); await retry;
  expect(f.status()).toBeUndefined(); expect(f.panel.querySelectorAll('.graph-ng-member').length).toBe(1); expect(f.pending.length).toBe(2);
});
test('UI batch member success removes pending status and keeps normal bounded rows', async () => {
  const f = memberRequestFixture(), done = f.view.drill('first'); expect(f.status()?.textContent).toBe('Loading members…');
  f.pending[0]!.resolve(new Uint32Array([0])); await done;
  expect(f.status()).toBeUndefined(); expect(f.panel.querySelectorAll('.graph-ng-member').length).toBe(1);
  expect(f.panel.querySelector('.graph-ng-member')?.getAttribute('aria-label')).toBe('Open Synthetic/Note.md'); expect(f.pending.length).toBe(1);
});
for (const settle of ['reject', 'resolve'] as const) for (const supersession of ['selection', 'closed', 'revision', 'view', 'contents'] as const) test(`UI batch stale member ${settle} after ${supersession} never leaves Loading members`, async () => {
  const f = memberRequestFixture(), done = f.view.drill('first'); let newer: Promise<void> | undefined;
  if (supersession === 'selection') newer = f.view.drill('second');
  else if (supersession === 'closed') f.view.closed = true;
  else if (supersession === 'revision') f.view.activeRevision++;
  else if (supersession === 'view') f.view.viewGeneration++;
  else { f.panel.empty(); f.panel.createDiv({ text: 'Replacement contents' }); }
  const before = f.panel.textContent, focus = new ControlElement('BUTTON'); focus.focus();
  if (settle === 'reject') f.pending[0]!.reject(new Error('obsolete')); else f.pending[0]!.resolve(new Uint32Array([0])); await done;
  if (supersession === 'revision' || supersession === 'view') {
    // The panel still owns this status: resolve it to an explicit recovery, never a stuck spinner.
    expect(f.status()?.textContent).toBe('Members out of date. Select the group again.'); expect(ControlElement.active).toBe(focus);
    expect(f.panel.querySelectorAll('.graph-ng-member').length).toBe(0); control(f.panel, 'Back to groups').click(); expect(f.backs()).toBe(1); expect(f.pending.length).toBe(1); return;
  }
  expect(f.panel.textContent).toBe(before); expect(ControlElement.active).toBe(focus);
  expect(f.panel.querySelectorAll('button').some(b => b.textContent === 'Back to groups')).toBe(false);
  if (newer) { f.pending[1]!.resolve(new Uint32Array([0])); await newer; expect(f.panel.querySelectorAll('.graph-ng-member').length).toBe(1); }
});
test('scout W3 aggregate graphs disable note search and drop pending search dispatch without clearing stored query', async () => {
  const f = fixture(), wait = () => new Promise(resolve => setTimeout(resolve, 200));
  f.state.view.query = 'kept'; f.panel.setState(f.state.view);
  f.settings.projectionFile = 'synthetic-aggregate.json'; f.panel.render();
  expect(f.panel.search.disabled).toBe(true); expect(f.panel.search.getAttribute('aria-label')).toContain('unavailable in aggregate graphs');
  f.panel.search.value = 'latent'; f.panel.search.oninput(); await wait(); expect(f.state.viewCalls).toBe(0);
  f.settings.projectionFile = ''; f.panel.render(); f.panel.search.value = 'pending'; f.panel.search.oninput();
  f.settings.projectionFile = 'synthetic-aggregate.json'; await wait();
  expect(f.state.viewCalls).toBe(0); expect(f.settings.explore.view.query).toBe(emptyView().query);
  f.settings.projectionFile = ''; f.panel.render();
  expect(f.panel.search.disabled).toBe(false); expect(f.panel.view.query).toBe('kept'); f.panel.dispose();
});
test('scout N1 saved records stack a wrapping full name above definition and actions', () => {
  const f = fixture(), name = 'A long synthetic saved view name that must remain readable';
  f.settings.explore.savedViews = [{ name, view: { ...emptyView(), query: 'x'.repeat(200) }, camera: null }]; f.panel.show('views');
  const record = f.panel.body.querySelector('.graph-ng-saved-record'); expect(record).toBeDefined();
  expect(record.querySelector('.graph-ng-saved-name').textContent).toBe(name); expect(record.querySelector('.graph-ng-legend-name')).toBeUndefined();
  const actions = record.children.at(-1); expect(actions.classes.has('graph-ng-row')).toBe(true);
  expect(actions.querySelectorAll('button').map((b: ControlElement) => b.textContent)).toEqual(['Open', 'Delete']);
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.graph-ng-saved-record { display:grid;'); expect(css).toContain('.graph-ng-saved-record > * { min-width:0; overflow-wrap:anywhere; white-space:normal; }');
  // Scoped markup/CSS evidence only; rendered 320/480 px visibility still needs native inspection.
  f.panel.dispose();
});
test('UX opacity endpoints and approach to zero are continuous for both blend policies', () => {
  const s = defaults('links'); for (const additive of [false, true]) for (const count of [0, 1, 60000, 1000000]) for (const zoom of [.01, 1, 10]) {
    s.visuals.edgeOpacity = 0; expect(edgeAlpha(s.visuals, count, zoom, additive)).toBe(0);
    s.visuals.edgeOpacity = .000001; const near = edgeAlpha(s.visuals, count, zoom, additive); expect(near).toBeGreaterThan(0); expect(near).toBeLessThan(.00001);
    s.visuals.edgeOpacity = .000002; expect(edgeAlpha(s.visuals, count, zoom, additive)).toBeCloseTo(near * 2, 12);
  }
  const shader = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8').split('const edgeVertex')[1]!.split('const solidFragment')[0]!;
  expect(shader).toContain('edgeAlpha <= 0.'); expect(shader).not.toContain('alpha = 1.'); expect(shader).not.toContain('+ .35');
});
test('UX actual group Canvas draw suppresses edge strokes at zero without deleting relationships', () => {
  const s = defaults('links'); let kind = '', strokes: number[] = [];
  const ctx: any = new Proxy({ globalAlpha: 1, beginPath() { kind = ''; }, moveTo() { kind = 'edge'; }, arc() { kind = 'node'; }, stroke() { if (kind === 'edge') strokes.push(this.globalAlpha); }, createLinearGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 20 }) }, { get: (o: any, k: any) => k in o ? o[k] : () => {} });
  const graph = { groups: [{ id: 'a', label: 'Alpha', count: 1 }, { id: 'b', label: 'Beta', count: 1 }], groupEdges: [{ a: 'a', b: 'b', typeCounts: { link: 1 }, total: 1 }] };
  const renderer: any = Object.create(GroupRenderer.prototype); Object.assign(renderer, { s, p: graph, container: { clientWidth: 800, clientHeight: 600 }, canvas: { clientWidth: 800, style: {}, getContext: () => ctx }, nodes: new Map(), radii: new Map(), groupColors: [] });
  for (const opacity of [0, .0001, .5]) { s.visuals.edgeOpacity = opacity; strokes = []; renderer.draw(); expect(strokes.length).toBe(opacity ? 1 : 0); if (opacity) expect(strokes[0]).toBeCloseTo(edgeAlpha(s.visuals, 1, 1, false), 12); expect(graph.groupEdges.length).toBe(1); }
});

test('group framing snaps clear of opening tools, eases closed, and respects reduced motion', () => {
  const previous = globalThis.matchMedia; let reduced = false, overlap = 0;
  globalThis.matchMedia = (() => ({ matches: reduced })) as any;
  try {
    const renderer: any = Object.create(GroupRenderer.prototype), canvas = { style: { width: '1080px', transition: '' } };
    Object.assign(renderer, { base: defaults('links'), canvas, container: { clientWidth: 1080 }, measureTools: () => overlap });
    overlap = 368; renderer.syncTools(); expect(canvas.style.width).toBe('712px'); expect(canvas.style.transition).toBe('none');
    overlap = 0; renderer.syncTools(); expect(canvas.style.width).toBe('1080px'); expect(canvas.style.transition).toBe('width 180ms ease-out');
    renderer.syncTools(); expect(canvas.style.transition).toBe('width 180ms ease-out'); // ResizeObserver does not restart it.
    overlap = 368; renderer.syncTools(); reduced = true; overlap = 0; renderer.syncTools(); expect(canvas.style.transition).toBe('none');
    reduced = false;
    for (const motion of ['reduced', 'off']) { renderer.base.visuals.motion = motion; overlap = 368; renderer.syncTools(); overlap = 0; renderer.syncTools(); expect(canvas.style.transition).toBe('none'); }
    overlap = 2000; renderer.syncTools(); expect(canvas.style.width).toBe('0px');
  } finally { globalThis.matchMedia = previous; }
});

test('group circles, labels and hit targets fit the available canvas, not the covered stage', () => {
  const s = defaults('links'), ctx: any = new Proxy({ measureText: (text: string) => ({ width: text.length * 7 }) }, { get: (o: any, k: any) => k in o ? o[k] : () => {} });
  const graph = { groups: Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: `Group ${i}`, count: 20 })), groupEdges: [] };
  const canvas = { clientWidth: 712, style: {}, getContext: () => ctx }, renderer: any = Object.create(GroupRenderer.prototype);
  Object.assign(renderer, { s, p: graph, container: { clientWidth: 1080, clientHeight: 674 }, canvas, nodes: new Map(), radii: new Map(), groupColors: [] });
  for (const width of [712, 1080, 500]) {
    canvas.clientWidth = width; renderer.draw();
    for (const g of graph.groups) {
      const p = renderer.nodes.get(g.id), radius = renderer.radii.get(g.id);
      expect(p.x - Math.max(radius, 45)).toBeGreaterThanOrEqual(0); expect(p.x + Math.max(radius, 45)).toBeLessThanOrEqual(width);
      expect(p.y - radius).toBeGreaterThanOrEqual(0); expect(p.y + s.groupRadius + s.labelSize * 3 + 4).toBeLessThanOrEqual(674);
      expect(renderer.nodeAt(p)?.id).toBe(g.id);
    }
  }
});

test('UX representation buttons, saved views and workspace scope have distinct accessible destinations', () => {
  const f = fixture(); f.host.scoped = () => true; f.panel.render();
  for (const label of ['Notes', 'Group overview', 'Saved views', 'Members', 'Workspace scope']) {
    const button = control(f.toolbar, label); expect(button.getAttribute('aria-label')).toBe(label); expect(button.querySelector('svg')).toBeDefined();
  }
  expect(control(f.toolbar, 'Notes').getAttribute('aria-pressed')).toBe('true');
  expect(control(f.toolbar, 'Group overview').getAttribute('aria-pressed')).toBe('false');
  f.panel.close(); control(f.toolbar, 'Saved views').click(); expect(f.state.presentation).toBe(''); expect(f.state.viewCalls).toBe(0);
  f.panel.close(); expect(ControlElement.active).toBe(control(f.toolbar, 'Saved views'));
  control(f.toolbar, 'Workspace scope').click(); expect(f.state.presentation).toBe('workspace'); expect(f.state.viewCalls).toBe(0);
  f.host.scoped = () => false; f.panel.render(); expect(control(f.toolbar, 'Workspace scope').disabled).toBe(true);
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.graph-ng-toolbar .graph-ng-tool:hover:not(:disabled)'); expect(css).toContain('.graph-ng-toolbar :focus-visible');
  expect(css).toContain('[aria-pressed=true]'); expect(css).toContain('box-shadow:none; border:1px solid transparent'); f.panel.dispose();
});
test('UX compact toolbar groups every panel, toggles Members and retains accessible focus', () => {
  const f = fixture(), group = f.toolbar.querySelector('.graph-ng-tools')!;
  expect(group.getAttribute('aria-label')).toBe('Graph panels');
  expect(group.querySelectorAll('button').map(b => b.getAttribute('aria-label'))).toEqual(['Saved views', 'Filters', 'Appearance', 'Layout', 'Graph information', 'Members']);
  for (const button of group.querySelectorAll('button')) {
    expect(button.getAttribute('aria-controls')).toBe(f.panel.root.id);
    if (!f.panel.root.hidden) f.panel.close();
    button.click(); expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(ControlElement.active).toBe(f.panel.closeButton);
    expect(group.querySelectorAll('button').filter(b => b.getAttribute('aria-expanded') === 'true')).toEqual([button]);
    button.click(); expect(f.panel.root.hidden).toBe(true); expect(ControlElement.active).toBe(button);
  }
  const scope = control(f.toolbar, 'Workspace scope'); expect(scope.hidden).toBe(true);
  f.host.scoped = () => true; f.panel.render(); expect(scope.hidden).toBe(false); expect(scope.disabled).toBe(false);
  scope.focus(); f.host.scoped = () => false; f.panel.render();
  expect(scope.hidden).toBe(true); expect(ControlElement.active).toBe(control(f.toolbar, 'Notes'));
  f.panel.dispose();
});
test('UX compact Filters badge follows active filter count without replacing its accessible name', () => {
  const f = fixture(), filters = control(f.toolbar, 'Filters');
  expect(filters.dataset.count).toBe('');
  f.panel.setState({ ...emptyView(), filters: [{ field: 'name', op: 'contains', value: 'sample' }] });
  expect(filters.dataset.count).toBe('1'); expect(filters.getAttribute('aria-label')).toBe('Filters');
  f.panel.setState(emptyView()); expect(filters.dataset.count).toBe(''); f.panel.dispose();
});
test('UX graph status uses structured phase, coverage and failures rather than English keyword guesses', () => {
  const view: any = Object.create(GraphView.prototype);
  Object.assign(view, { contentEl: { dataset: { state: 'building' } }, status: new ControlElement(), statusSummary: new ControlElement(), plugin: { settings: {} }, provisional: true, gpu: { available: true } });
  view.statusText = 'partial, provisional, pending'; expect(view.statusSummary.textContent).toBe('partial, provisional, pending');
  view.contentEl.dataset.state = 'ready'; view.statusText = '0 unresolved'; expect(view.statusSummary.textContent).toBe('Waiting for property verification');
  view.provisional = false; view.statusText = 'error is a note name, not a health signal'; expect(view.statusSummary.hidden).toBe(true);
  view.report = { nodes: 4, edges: 2, indexed: 4, listed: 4, linksPending: false, provisional: false, unresolved: 3, duplicates: 0 }; view.statusText = 'details'; expect(view.statusSummary.textContent).toBe('4 notes2 edges'); expect(view.statusSummary.hidden).toBe(false); view.report = undefined;
  view.contentEl.dataset.state = 'error'; view.statusText = 'Projection refresh failed: synthetic missing file'; expect(view.statusSummary.textContent).toContain('synthetic missing file'); expect(view.statusSummary.textContent).not.toContain('Retry');
  view.contentEl.dataset.state = 'ready'; view.plugin.settings.projectionFile = 'synthetic.json'; view.statusText = 'aggregate'; expect(view.statusSummary.textContent).toContain('not verified');
  view.plugin.settings.projectionFile = ''; view.gpu = { available: false, reason: 'Synthetic renderer unavailable' }; view.detailFallback = 'Synthetic renderer unavailable. Showing Group overview.'; view.statusText = 'fallback'; expect(view.statusSummary.textContent).toContain('Synthetic renderer unavailable'); expect(view.statusSummary.textContent).toContain('Showing Group overview');
});

/** Production shell/Notes transition and renderer visibility; only graphics/boot boundaries are fake. */
async function navigationFixture() {
  const view: any = Object.create(GraphView.prototype), root = new ControlElement(), settings = defaults('links');
  let clear = 0, disposed = 0, frames = 0, creates = 0;
  const requests: string[] = [], originalCreate = DetailRenderer.create;
  Object.assign(view, { contentEl: root, view: { ...emptyView(), query: 'keep', filters: [{ kind: 'exists', key: 'category' }] }, closed: false, renderRevision: 0,
    plugin: { settings, subscribe: () => () => {}, saveSoon() {}, pipeline: { request(_revision: number, request: any) { requests.push(request.kind); throw new Error('Unexpected worker request'); } } },
    app: { workspace: { on() {}, requestSaveLayout() {} } }, registerEvent() {}, async refresh() {}, contributionPage: { clear() { clear++; } } });
  await view.onOpen();
  const renderer: any = Object.create(DetailRenderer.prototype), canvas = view.stage.createEl('canvas'), context = {};
  const projection = { nodeCount: 3, source: new Uint32Array(), target: new Uint32Array(), type: new Uint32Array(), carrierNodes: new Uint8Array(3) };
  const positions = new Float32Array([0, 0, 10, 10, 20, 20]);
  Object.assign(renderer, { projection, positions, settings, canvas, context, camera: { x: .3, y: .4, ratio: .2 }, selected: 0,
    filterVisible: new Uint8Array([1, 0, 0]), view: {}, grid: { visible: new Uint8Array() }, near: [], stateBytes: new Uint8Array(12), edgeOn: new Uint8Array(), timings: {}, ready: false,
    // Appearance/GPU effects are outside navigation; setView and coordinateState stay real.
    previewSizing() {}, recolor() {}, choosePolicy() {}, updateSizingRange() {}, refresh() { frames++; }, dispose() { disposed++; },
    fitAll() { throw new Error('Unexpected fit'); }, flyTo() { throw new Error('Unexpected camera change'); } });
  Object.assign(view, { projection, positions, visible: new Uint8Array([1, 0, 1]), detailScope: new Uint8Array([1, 1, 0]), scopeName: 'Synthetic group', gpu: { available: true, reason: 'Synthetic graphics boundary' }, colors: new Uint32Array(3) });
  (DetailRenderer as any).create = async (...args: any[]) => { creates++; renderer.setView(args[3], args[11]); return renderer; };
  return { view, renderer, canvas, context, requests, counts: () => ({ clear, disposed, frames, creates }), restore() { DetailRenderer.create = originalCreate; view.explorePanel.dispose(); } };
}
test('TBR-1 production Notes transition from group overview intersects group scope with active filters', async () => {
  const f = await navigationFixture();
  try {
    const scope = f.view.detailScope, query = JSON.stringify(f.view.view);
    f.view.contentEl.dataset.mode = 'groups';
    await (control(f.view.toolbar, 'Notes') as any).onclick();
    expect(f.view.contentEl.dataset.mode).toBe('nodes'); expect(f.counts().creates).toBe(1);
    expect([...f.renderer.filterVisible]).toEqual([1, 0, 0]); expect([...f.renderer.visible]).toEqual([1, 0, 0]);
    expect(f.renderer.visibleNodes).toBe(1); expect(f.view.detailScope).toBe(scope); expect(JSON.stringify(f.view.view)).toBe(query); expect(f.requests).toEqual([]);
  } finally { f.restore(); }
});
test('TBR-2 production Workspace scope uses real renderer visibility update without remount or selection loss', async () => {
  const f = await navigationFixture();
  try {
    Object.assign(f.view, { renderer: f.renderer, detailRenderer: f.renderer }); f.view.contentEl.dataset.mode = 'nodes';
    const camera = f.renderer.camera, positions = f.renderer.positions, query = JSON.stringify(f.view.view), scope = f.view.detailScope;
    f.view.explorePanel.render(); await (control(f.view.toolbar, 'Workspace scope') as any).onclick();
    expect(f.counts()).toEqual({ clear: 0, disposed: 0, frames: 1, creates: 0 }); expect(f.view.stage.children).toContain(f.canvas);
    expect(f.view.detailRenderer).toBe(f.renderer); expect(f.renderer.canvas).toBe(f.canvas); expect(f.renderer.context).toBe(f.context);
    expect(f.renderer.camera).toBe(camera); expect(camera).toEqual({ x: .3, y: .4, ratio: .2 }); expect(f.renderer.positions).toBe(positions); expect(f.renderer.selected).toBe(0);
    expect([...f.renderer.filterVisible]).toEqual([1, 0, 1]); expect([...f.renderer.visible]).toEqual([1, 0, 1]); expect(f.renderer.visibleNodes).toBe(2);
    expect(f.view.detailScope).toBeUndefined(); expect([...scope]).toEqual([1, 1, 0]); expect(JSON.stringify(f.view.view)).toBe(query); expect(f.requests).toEqual([]);
  } finally { f.restore(); }
});
test('TBR-3 Members exposes controlled region and expanded state across open, switch and Escape', () => {
  const f = fixture(), members = control(f.toolbar, 'Members');
  expect(members.getAttribute('aria-controls')).toBe(f.panel.root.id); expect(members.getAttribute('aria-expanded')).toBe('false');
  members.click(); expect(members.getAttribute('aria-expanded')).toBe('true'); expect(ControlElement.active).toBe(f.panel.closeButton);
  control(f.toolbar, 'Saved views').click(); expect(members.getAttribute('aria-expanded')).toBe('false');
  members.click(); f.panel.root.onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  expect(members.getAttribute('aria-expanded')).toBe('false'); expect(f.panel.root.hidden).toBe(true); expect(ControlElement.active).toBe(members); f.panel.dispose();
});

async function softwareNavigationFixture(maxNodes: number, maxEdges: number) {
  const f = await navigationFixture(), p = f.renderer.projection;
  Object.assign(p, { offsets: new Uint32Array([0, 2, 4, 6]), source: new Uint32Array([0, 1, 0]), target: new Uint32Array([1, 2, 2]), type: new Uint32Array(3) });
  Object.assign(f.renderer, { gpu: false, gl: null, ctx: {}, edgeOn: new Uint8Array(3), edgeDrawn: (e: number) => !!f.renderer.edgeOn[e] && !!f.renderer.filterVisible[p.source[e]!] && !!f.renderer.filterVisible[p.target[e]!] });
  Object.assign(f.view.plugin.settings, { canvasMaxDetailNodes: maxNodes, canvasMaxDetailEdges: maxEdges });
  Object.assign(f.view, { renderer: f.renderer, detailRenderer: f.renderer, visible: new Uint8Array([1, 1, 1]), detailScope: new Uint8Array([1, 1, 0]), gpu: { available: false, reason: 'Synthetic software renderer' } });
  f.view.contentEl.dataset.mode = 'nodes'; f.renderer.setView(f.view.detailScope, {}); f.view.explorePanel.render();
  expect([...f.renderer.canvasEdges]).toEqual([0]); expect(f.renderer.visibleEdges).toBe(1);
  return f;
}
for (const [nodes, edges, reason] of [[2, 3, 'CANVAS_DETAIL_NODE_LIMIT'], [3, 1, 'CANVAS_DETAIL_EDGE_LIMIT']] as const) {
  test(`TBR-2R software Workspace refuses ${reason} before mutating live scope or renderer`, async () => {
    const f = await softwareNavigationFixture(nodes, edges);
    try {
      const scope = f.view.detailScope, visible = f.renderer.filterVisible, oldEdges = f.renderer.canvasEdges, camera = f.renderer.camera, state = [...f.renderer.stateBytes], query = JSON.stringify(f.view.view), counts = f.counts();
      await (control(f.view.toolbar, 'Workspace scope') as any).onclick();
      expect(f.view.detailScope).toBe(scope); expect(f.view.contentEl.dataset.mode).toBe('nodes'); expect(f.view.detailRenderer).toBe(f.renderer);
      expect(f.renderer.filterVisible).toBe(visible); expect([...visible]).toEqual([1, 1, 0]); expect(f.renderer.visibleNodes).toBe(2);
      expect(f.renderer.canvasEdges).toBe(oldEdges); expect([...oldEdges]).toEqual([0]); expect(f.renderer.visibleEdges).toBe(1); expect([...f.renderer.stateBytes]).toEqual(state);
      expect(f.renderer.camera).toBe(camera); expect(camera).toEqual({ x: .3, y: .4, ratio: .2 }); expect(f.renderer.selected).toBe(0);
      expect(f.view.stage.children).toContain(f.canvas); expect(f.renderer.canvas).toBe(f.canvas); expect(f.counts()).toEqual(counts); expect(f.requests).toEqual([]);
      expect(JSON.stringify(f.view.view)).toBe(query); expect(f.view.status.textContent).toContain('limit'); expect(f.view.status.textContent).not.toContain('Showing Group overview');
    } finally { f.restore(); }
  });
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
for (const [nodes, edges, reason] of [[2, 3, 'CANVAS_DETAIL_NODE_LIMIT'], [3, 1, 'CANVAS_DETAIL_EDGE_LIMIT']] as const) {
  test(`batch 4 L1 ordinary software view over ${reason} is applied but shown as Group overview, never drawn or truncated`, async () => {
    const f = await softwareNavigationFixture(nodes, edges);
    try {
      const shown = new Uint8Array([1, 1, 0]), dictionary = { groupKeys: ['A'], groupCodes: new Uint32Array(3), groupLabels: ['A'], types: [], facets: [{ key: 'category', values: [] }], nodes: 3, edges: 3 };
      const result = { ...dictionary, visible: new Uint8Array([1, 1, 1]), visibleEdges: 3 };
      Object.assign(f.view, { detailScope: undefined, visible: shown, explored: { ...dictionary, visible: shown, visibleEdges: 1 }, activeRevision: 1, detailGeneration: 1, members: new Map(), contributions: new Map(), contributionPage: { clear() {}, update() {} } });
      f.renderer.setView(shown, {}); const filterVisible = f.renderer.filterVisible, canvasEdges = f.renderer.canvasEdges, state = [...f.renderer.stateBytes];
      f.view.plugin.pipeline = { async request(_revision: number, message: any) { f.requests.push(message.kind); return { explore: result, colors: new Uint32Array(3), groups: { groups: [], groupEdges: [] }, view: 3 }; }, cancelEvaluation() {} };
      let groups = 0; f.view.showGroups = () => { groups++; f.view.detailRenderer = undefined; f.view.contentEl.dataset.mode = 'groups'; };
      f.view.setView({ ...f.view.view, query: '' }); await flush();
      // Requested view is adopted (settings, counts, groups) …
      expect(f.requests).toEqual(['explore']); expect(f.view.explored).toBe(result); expect(f.view.plugin.settings.explore.view.query).toBe(''); expect(f.view.view.query).toBe('');
      // … but the software renderer never adopts an over-budget mask or keeps a stale edge subset.
      expect(groups).toBe(1); expect(f.view.contentEl.dataset.mode).toBe('groups'); expect(f.renderer.filterVisible).toBe(filterVisible); expect(f.renderer.canvasEdges).toBe(canvasEdges);
      expect(f.renderer.visibleNodes).toBe(2); expect([...f.renderer.stateBytes]).toEqual(state);
      expect(f.view.statusSummary.textContent).toContain('limit'); expect(f.view.statusSummary.textContent).toContain('Narrow filters to see notes');
      expect(f.view.explorePanel.alert.querySelectorAll('button').length).toBe(0); expect(f.view.status.textContent).toContain('limit');
      // Narrowing a refused Notes view retries Notes; explicit Group overview does not.
      result.visible = shown; result.visibleEdges = 1; let notes = 0;
      f.view.showDetails = async () => { expect(f.view.admitDetail(f.view.visible, true)).toBe(true); notes++; };
      f.view.presentation = 'nodes'; f.view.setView({ ...f.view.view, query: 'narrow' }); await flush(); expect(notes).toBe(1);
      f.view.presentation = 'groups'; f.view.setView({ ...f.view.view, query: 'narrower' }); await flush(); expect(notes).toBe(1);
    } finally { f.restore(); }
  });
}
test('batch 4 L1 software renderer refuses an over-budget mask before mutating any state', async () => {
  const f = await softwareNavigationFixture(2, 3);
  try {
    const filterVisible = f.renderer.filterVisible, canvasEdges = f.renderer.canvasEdges, state = [...f.renderer.stateBytes];
    expect(() => f.renderer.setView(new Uint8Array([1, 1, 1]), {})).toThrow('CANVAS_DETAIL_NODE_LIMIT');
    expect(f.renderer.filterVisible).toBe(filterVisible); expect(f.renderer.canvasEdges).toBe(canvasEdges); expect(f.renderer.visibleNodes).toBe(2); expect(f.renderer.visibleEdges).toBe(1); expect([...f.renderer.stateBytes]).toEqual(state);
  } finally { f.restore(); }
});
test('TBR-2R admitted software Workspace updates real Canvas edge membership in place', async () => {
  const f = await softwareNavigationFixture(3, 3);
  try {
    const camera = f.renderer.camera, oldEdges = f.renderer.canvasEdges;
    await (control(f.view.toolbar, 'Workspace scope') as any).onclick();
    expect(f.view.detailScope).toBeUndefined(); expect([...f.renderer.filterVisible]).toEqual([1, 1, 1]); expect(f.renderer.visibleNodes).toBe(3);
    expect([...f.renderer.canvasEdges]).toEqual([0, 1, 2]); expect(f.renderer.canvasEdges).not.toBe(oldEdges); expect(f.renderer.visibleEdges).toBe(3);
    expect(f.view.detailRenderer).toBe(f.renderer); expect(f.view.stage.children).toContain(f.canvas); expect(f.renderer.camera).toBe(camera); expect(f.renderer.selected).toBe(0);
    expect(f.counts()).toEqual({ clear: 0, disposed: 0, frames: 2, creates: 0 }); expect(f.requests).toEqual([]);
  } finally { f.restore(); }
});
test('UX relationship notes Lines | Nodes: shown only with reified rules; one apply flips display; failure keeps it', async () => {
  const f = fixture(), buttons = () => f.panel.root.querySelectorAll('button').filter((b: any) => b.textContent === 'Lines' || b.textContent === 'Nodes');
  let applies = 0, fail = false; const plugin = { settings: f.settings, apply: async (s: any) => { applies++; if (fail) throw new Error('synthetic save failure'); plugin.settings = s; } };
  f.host.relationshipNotes = () => 44123; f.host.setRelationshipDisplay = (nodes: boolean) => setRelationshipDisplay(plugin, nodes);
  f.state.view.query = 'kept'; f.settings.explore.view = f.state.view; f.panel.show('appearance');
  expect(buttons().length).toBe(0);
  f.settings.declaration.edges.push({ kind: 'reified', name: 'crosswalk', sourceProperty: 'from', targetProperty: 'to' }); f.panel.render();
  const [lines, nodes] = buttons() as any[]; expect(lines.getAttribute('aria-pressed')).toBe('true'); expect(lines.disabled).toBe(true); expect(nodes.disabled).toBe(false);
  const note = f.panel.root.querySelectorAll('.graph-ng-help-popover').find((e: any) => e.textContent.startsWith('Lines join'))!; expect(note.textContent).toContain('44,123 added dots'); expect(note.hidden).toBe(true); expect(note.textContent).not.toContain(' · ');
  fail = true; await nodes.onclick(); expect(applies).toBe(1); expect(f.panel.root.textContent).toContain('Not switched: Error: synthetic save failure');
  expect(plugin.settings.declaration.display.reifiedAsNodes).toBe(false);
  fail = false; await (buttons()[1] as any).onclick(); expect(applies).toBe(2);
  expect(plugin.settings.declaration.display.reifiedAsNodes).toBe(true); expect(plugin.settings.explore.view.query).toBe('kept');
  expect(f.settings.declaration.display.reifiedAsNodes).toBe(false); // the previous settings object is not mutated
  await setRelationshipDisplay(plugin, true); expect(applies).toBe(2); // no-op when already in that display
  f.panel.dispose();
});
test('settings rows: Edges and layout Presets use the name, description and control row; a panel title is never repeated as a heading', () => {
  const f = fixture(), headings = () => [...f.panel.root.querySelectorAll('h3'), ...f.panel.root.querySelectorAll('h4')].map(e => e.textContent);
  const row = (name: string) => f.panel.root.querySelectorAll('.graph-ng-setting').find((r: any) => (r.children[0]?.querySelector('.graph-ng-help-trigger')?.textContent ?? r.children[0]?.textContent) === name) as any;
  const parts = (r: any) => r.children.map((c: any) => [...c.classes].find((n: string) => n.startsWith('graph-ng-setting-')));
  f.panel.show('appearance');
  expect(headings().filter(t => t === 'Appearance')).toHaveLength(1); expect(headings()).toContain('Color rules');
  const edges = row('Edges'); expect(edges.tagName).toBe('DIV'); expect(parts(edges)).toEqual(['graph-ng-setting-name', 'graph-ng-setting-line']);
  const modes = edges.children[1]; expect(modes.getAttribute('role')).toBe('group'); expect(modes.getAttribute('aria-label')).toBe('Edges');
  expect(modes.children.map((b: any) => b.textContent)).toEqual(['All', 'Focus only', 'Off']);
  control(modes, 'Focus only').click(); expect(f.settings.visuals.edgeMode).toBe('focus'); expect(modes.children.map((b: any) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  // Sliders share the row: name first, a description line where given, then the track line.
  const slider = row('Highlighted size target'); expect(parts(slider).filter(Boolean)).toEqual(['graph-ng-setting-name']);
  expect(f.panel.root.textContent).not.toContain('Hover delay');
  f.panel.show('layout');
  expect(headings().filter(t => t === 'Layout')).toHaveLength(1);
  const presets = row('Presets'); expect(presets.tagName).toBe('DIV'); expect(parts(presets)).toEqual(['graph-ng-setting-name', 'graph-ng-setting-line']);
  const buttons = presets.children[1]; expect(buttons.getAttribute('aria-label')).toBe('Layout presets');
  expect(buttons.children.map((b: any) => b.tagName)).toEqual(['SELECT', 'BUTTON']);
  expect(buttons.querySelector('select').children.map((o: any) => o.textContent)).toEqual(['Recommended', 'Groups apart', 'Fill the screen', 'Faster']);
  expect(buttons.querySelector('select').value).toBe('Recommended');
  expect(buttons.querySelector('button').textContent).toBe('Use preset');
  f.panel.show('views'); expect(headings().filter(t => t === 'Saved views')).toHaveLength(1);
});
test('count lists: group legend rows keep the name and the count in separate elements; the count class is tabular and right-aligned', () => {
  const f = fixture(), long = 'A very long synthetic folder name that must truncate before the number column';
  const notes = [...Array.from({ length: 1200 }, (_, i) => ({ path: `${long}/N${i}.md`, properties: {} })), { path: 'Short/One.md', properties: {} }];
  const p = buildProjection(notes, f.settings.declaration);
  f.state.view.group = { from: 'folder', depth: 1 };
  f.host.result = () => explore(p, f.settings.declaration, f.state.view, colorGroups(p, f.settings.declaration), 0, { facetValues: 10 });
  f.host.groupColor = () => '#808080'; f.host.focusGroup = () => {};
  f.panel.show('filters');
  const rows = f.panel.body.querySelectorAll('.graph-ng-legend-row').filter((r: ControlElement) => r.querySelector('.graph-ng-legend-name'));
  const cells = rows.map((r: ControlElement) => [r.querySelector('.graph-ng-legend-name')!.textContent, r.children.find(c => c.classes.has('graph-ng-count'))?.textContent]);
  expect(cells).toContainEqual([long, '1,200 notes']); expect(cells).toContainEqual(['Short', '1 note']);
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8'), rule = css.match(/^\.graph-ng-count \{([^}]*)\}/m)?.[1] ?? '';
  expect(rule).toContain('font-variant-numeric:tabular-nums'); expect(rule).toContain('text-align:right'); expect(rule).toContain('white-space:nowrap');
  expect(css).toMatch(/\.graph-ng-count-row \{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  expect(css).not.toContain('graph-ng-legend-count'); f.panel.dispose();
});


test('UI foundation uses host type roles, one spacing scale and scalable control rows', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const foundation = css.match(/\.graph-ng-view \{([^}]+)\}/)![1]!;
  for (const [role, host] of [['xs', 'smaller'], ['sm', 'small'], ['md', 'medium'], ['lg', 'large']]) {
    expect(foundation).toContain(`--gng-text-${role}:var(--font-ui-${host})`);
  }
  for (const [index, size] of [4, 8, 12, 16, 24].entries()) {
    expect(foundation).toMatch(new RegExp(`--gng-space-${index + 1}:var\\(--size-[\\w-]+, ${size}px\\)`));
  }
  expect(foundation).toContain('--gng-row-h:max(var(--size-4-8, 32px), 2.25em)');
  expect(foundation).toContain('font-family:var(--font-interface)');
  expect(foundation).toContain('--gng-text-muted:color-mix(in srgb, var(--text-muted) 80%, var(--text-normal))');
  expect(css).not.toMatch(/font-size:\s*\d+(?:\.\d+)?px/);
  expect(css).not.toMatch(/font-weight:\s*\d/);
  expect(css).not.toMatch(/text-transform:\s*uppercase/);
  const defined = [...css.matchAll(/(--gng-[\w-]+):/g)].map(m => m[1]);
  expect(new Set(defined).size).toBe(defined.length);
  for (const [, token] of css.matchAll(/var\((--gng-[\w-]+)/g)) expect(defined).toContain(token);
});
test('UI foundation keeps aligned settings, wrapping labels and inline help exceptions', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const rule = (selector: string) => css.split(`\n${selector} {`)[1]!.split('}')[0]!;
  expect(rule('.graph-ng-setting')).toContain('grid-template-columns:minmax(0,1fr) var(--gng-value-w) var(--gng-row-h)');
  expect(rule('.graph-ng-slider-line')).toContain('display:contents');
  expect(rule('.graph-ng-slider-track')).toContain('grid-column:1 / -1; grid-row:2');
  expect(rule('.graph-ng-slider-chip')).toContain('grid-column:2; grid-row:1');
  expect(css).toContain('.graph-ng-setting > .checkbox-container:focus-within');
  expect(css).toContain('text-align:start; justify-content:flex-start');
  expect(css).not.toContain('.graph-ng-stat-warning > .graph-ng-stat-icon { color:var(--text-warning)');
  expect(rule('.graph-ng-setting-name')).toContain('line-height:var(--gng-leading-tight)');
  expect(rule('.graph-ng-stat-label')).toContain('overflow-wrap:anywhere');
  expect(rule('button.graph-ng-help-trigger')).toContain('min-height:0');
  expect(rule('.graph-ng-explore .graph-ng-slider-chip input[type=number]')).toContain('min-height:0');
  expect(css).toContain('scrollbar-gutter:stable');
  expect(css).toContain('@container graph-ng-tools (max-width: 260px)');
  expect(css).toContain('min-height:44px');
  // The renderer reserves exactly +12 width / +4 height for these canvas labels.
  // UI spacing changes must not enlarge their DOM box past the collision footprint.
  expect(rule('.graph-ng-anchor-text')).toContain('padding:2px 6px');
  expect(rule('.graph-ng-more')).toContain('min-height:32px');
});
test('Filters exposes one advanced grouping entry and seeds the current expression on demand', () => {
  const f = fixture(); f.settings.declaration.columns = ['category'];
  const p = buildProjection([{ path: 'Folder/Note.md', properties: { category: 'Sample' } }], f.settings.declaration);
  f.state.view.group = { from: 'key', key: 'category' };
  f.host.result = () => explore(p, f.settings.declaration, f.state.view, colorGroups(p, f.settings.declaration), 0, { facetValues: 10 });
  f.host.groupColor = () => '#808080'; f.host.focusGroup = () => {};
  f.panel.show('filters');
  const group = f.panel.body.querySelector('.graph-ng-explore-groups'), content = group.querySelector('div');
  const details = content.children.filter((e: ControlElement) => e.tagName === 'DETAILS');
  expect(details.length).toBe(1); expect(details[0].querySelector('summary').textContent).toBe('Advanced grouping');
  expect(details[0].open).toBe(false); expect(details[0].querySelector('.graph-ng-derived')).toBeDefined();
  const expression = details[0].querySelector('.graph-ng-expression');
  expect(input(expression, 'Group expression').value).toBe('');
  expression.open = true; expression.ontoggle();
  expect(input(expression, 'Group expression').value).toBe('note.category');
  expect(f.state.viewCalls).toBe(0);
  f.panel.render(); expect(f.panel.body.querySelector('.graph-ng-group-advanced').open).toBe(true);
  expect(f.panel.body.querySelector('.graph-ng-group-advanced').querySelector('.graph-ng-expression').open).toBe(true);
  f.panel.drafts.delete('Group expression'); f.state.view.group = { from: 'folder', depth: 1 }; f.panel.render();
  const blank = f.panel.body.querySelector('.graph-ng-group-advanced').querySelector('.graph-ng-expression');
  blank.open = true; blank.ontoggle();
  expect(input(blank, 'Group expression').value).toBe('');
  expect(blank.querySelector('.graph-ng-expression-status').textContent).toBe('');
  expect(control(blank, 'Group by expression').disabled).toBe(true); f.panel.dispose();
});
test('Filter chips name hidden notes and remove their filter without duplicate explanatory prose', () => {
  const f = fixture(), p = buildProjection([{ path: 'A/Note.md', properties: {} }, { path: 'B/Note.md', properties: {} }], f.settings.declaration);
  f.state.view.filters = [{ kind: 'folder', prefix: ['A'] }];
  f.host.result = () => explore(p, f.settings.declaration, f.state.view, colorGroups(p, f.settings.declaration), 0, { facetValues: 10 });
  f.host.groupColor = () => '#808080'; f.host.focusGroup = () => {};
  f.panel.show('filters');
  const chip = f.panel.body.querySelector('.graph-ng-chip');
  expect(chip.querySelector('.graph-ng-count').textContent).toBe('1 note hidden');
  expect(chip.querySelector('.graph-ng-help-trigger').textContent).toBe('In folder A');
  expect(chip.querySelector('.graph-ng-chip-text').getAttribute('title')).toBeNull();
  expect(chip.querySelector('.graph-ng-chip-json').querySelector('.graph-ng-chevron')).toBeDefined();
  control(chip, 'Remove filter: In folder A').click();
  expect(f.state.view.filters).toEqual([]); expect(f.panel.body.querySelector('.graph-ng-chip')).toBeUndefined();
  expect(f.panel.body.textContent).not.toContain('Every note is shown'); f.panel.dispose();
});
test('Legend separates shown and hidden counts and retains one-note underscore folders', () => {
  const f = fixture(), p = buildProjection([{ path: '_local/Note.md', properties: {} }], f.settings.declaration);
  f.state.view.group = { from: 'folder', depth: 1 };
  f.host.result = () => ({ ...explore(p, f.settings.declaration, f.state.view, colorGroups(p, f.settings.declaration), 0, { facetValues: 10 }), types: ['link'], typeVisible: [12345], typeTotals: [12347] });
  f.host.groupColor = () => '#808080'; f.host.focusGroup = () => {};
  f.panel.show('filters');
  const groups = f.panel.body.querySelector('.graph-ng-group-legend');
  expect(groups.querySelectorAll('.graph-ng-legend-row').length).toBe(1);
  expect(groups.querySelector('.graph-ng-legend-name').textContent).toBe('_local');
  expect(groups.querySelector('.graph-ng-count').textContent).toBe('1 note');
  const fold = control(groups, 'Collapse _local'); expect(fold.children[0]!.getAttribute('data-icon')).toBe('minus');
  const types = f.panel.body.querySelector('.graph-ng-type-legend');
  expect(types.querySelector('.graph-ng-count').textContent).toBe('12,345 edges2 hidden edges');
  expect(types.querySelector('small').textContent).toBe('2 hidden edges');
  const show = input(types, 'Show link relationships'); show.checked = false; show.onchange();
  expect(f.state.view.hiddenTypes).toEqual(['link']);
  const direction = input(f.panel.body, 'Show direction'); direction.checked = true; direction.onchange();
  expect(f.settings.visuals.edgeDirection).toBe(true); f.panel.dispose();
});
test('Members keeps root notes clean, names page counts and exposes full paths accessibly', () => {
  const view: any = Object.create(GraphView.prototype), opened: string[] = [];
  Object.assign(view, { panel: new ControlElement(), plugin: { settings: { listPageSize: 2 } }, openPath: (path: string) => opened.push(path), showGroups() {} });
  const items = ['Root.md', 'Long folder/Note.md', 'Elsewhere/Note.md']; view.memberList(items, (s: string) => s);
  const rows = view.panel.querySelectorAll('.graph-ng-member');
  expect(rows[0].querySelector('small')).toBeUndefined();
  expect(rows[1].querySelector('small').textContent).toBe('Long folder');
  expect(rows[1].getAttribute('aria-label')).toBe('Open Long folder/Note.md');
  expect(view.panel.querySelector('.graph-ng-page-controls').textContent).toContain('Notes 1–2, 3 total');
  rows[1].click(); expect(opened).toEqual(['Long folder/Note.md']);
  const search = input(view.panel, 'Search available group members'); search.value = 'missing'; search.oninput();
  expect(view.panel.querySelector('.graph-ng-explore-note').textContent).toBe('0 matching notes');
  expect(view.panel.querySelector('.graph-ng-explore-note').getAttribute('role')).toBe('status');
});
test('Filter rows use shared columns, keyboard-visible actions and only one scroll owner', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.graph-ng-group-legend { grid-template-columns:auto');
  expect(css).toContain('.graph-ng-type-legend { grid-template-columns:auto minmax(0,1fr) auto; }');
  expect(css).toContain('.graph-ng-legend-row:focus-within .graph-ng-fold { opacity:1; }');
  expect(css).toContain('@media (hover:hover) and (pointer:fine)');
  expect(css).toContain('scrollbar-gutter:stable;'); expect(css).toContain('max-height:none; overflow:visible;');
});

test('adaptive emphasis control switches live without moving the camera or rebuilding the view', () => {
  const f = fixture(); f.panel.show('appearance');
  const field: any = f.panel.root.querySelectorAll('select').find((e: any) => e.getAttribute('aria-label') === 'Highlight emphasis');
  expect(field.tagName).toBe('SELECT'); expect(field.children.map((e: any) => e.textContent)).toEqual(['Adaptive (default)', 'Scale']);
  expect(field.children[0].selected).toBe(true);
  for (const mode of ['scale', 'adaptive'] as const) { field.value = mode; field.onchange(); expect(f.settings.visuals.emphasis).toBe(mode); }
  expect(f.state.visual).toBe(2); expect(f.state.fit + f.state.layout + f.state.viewCalls).toBe(0);
  expect(f.camera).toEqual({ x: .3, y: .4, ratio: .2 }); f.panel.dispose();
});

test('duplicate-ID inspection opens the existing quarantine destination and focuses its disclosure', () => {
  const plugin: any = { settings: defaults('links') }, view: any = new GraphView(null as any, plugin), calls: string[] = [];
  const panel = new ControlElement(), list: any = panel.createEl('details', { cls: 'graph-ng-quarantine' }), summary = list.createEl('summary');
  list.scrollIntoView = () => calls.push('scroll'); view.panel = panel; view.toGroups = () => calls.push('groups'); view.explorePanel = { show: (tool: string) => calls.push(tool) };
  view.informationActions.duplicates(); expect(calls).toEqual(['groups', 'members', 'scroll']);
  expect(list.open).toBe(true); expect(ControlElement.active).toBe(summary);
});


test('Graph information reserves one action slot for counts and disclosure chevrons', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.graph-ng-status .graph-ng-stat, .graph-ng-explore .graph-ng-status summary { display:grid; grid-template-columns:16px minmax(0,1fr) auto var(--gng-row-h)');
  expect(css).toContain('.graph-ng-status summary > .graph-ng-stat { display:contents; }');
  expect(css).toContain('.graph-ng-status summary > .graph-ng-chevron { grid-column:4; grid-row:1;');
  expect((css.match(/@keyframes gng-working/g) ?? []).length).toBe(1);
});
