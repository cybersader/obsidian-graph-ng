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
    setView: (view: any, after?: () => void) => { state.viewCalls++; state.view = view; settings.explore.view = view; after?.(); }, persist: () => state.saved++, previewSizing: (value: any) => { state.preview = value; }, applySizing: async () => {}, sizingReadout: () => '0.01–0.09 CSS px', applyLayout: async () => { state.layout++; }, fit: () => { state.fit++; }, visualsChanged: () => { state.visual++; }, camera: () => camera, restoreCamera: () => { state.restored++; }, presentation: (mode: string) => { state.presentation = mode; }, information: root.createDiv(), members: root.createDiv() };
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
  const radius = input(f.panel.root, 'Base node radius'); radius.value = '0.0123'; radius.oninput();
  control(f.panel.root, 'Preview sizing').click(); expect(f.state.preview.radius).toBe(.0123); expect(f.settings.nodeSize).toBe(3);
  let stopped = 0; f.panel.root.onkeydown({ key: 'Escape', preventDefault() { stopped++; }, stopPropagation() { stopped++; } });
  expect(stopped).toBe(2); expect(ControlElement.active).toBe(opener); expect(f.state.preview).toBeNull(); expect(f.settings.nodeSize).toBe(3);
  opener.click(); expect(input(f.panel.root, 'Base node radius').value).toBe('0.0123'); expect(f.panel.sizingMessage).toContain('Preview ended'); f.panel.dispose();
});
test('UX closing while sizing save is pending does not cancel the submitted transaction', async () => {
  const f = fixture(); f.panel.show('appearance'); let release!: () => void;
  f.host.applySizing = () => new Promise<void>(resolve => { release = resolve; });
  control(f.panel.root, 'Preview sizing').click(); const preview = f.state.preview;
  const done = (control(f.panel.root, 'Apply and save sizing') as any).onclick(); expect(f.panel.sizingBusy).toBe(true);
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
  expect(text).toContain('No saved views here yet'); expect(text).toContain('not view files'); expect(f.state.presentation).toBe('');
  expect(f.panel.root.querySelectorAll('button').some((button: any) => ['Notes', 'Group overview'].includes(button.textContent))).toBe(false);
  control(f.toolbar, 'Notes').click(); expect(f.state.presentation).toBe('nodes'); control(f.toolbar, 'Group overview').click(); expect(f.state.presentation).toBe('groups'); f.panel.dispose();
});
test('UX exact low-opacity input preserves zero; invalid input never saves and guards sit by controls', () => {
  const f = fixture(); f.panel.show('appearance'); const opacity = input(f.panel.root, 'Edge opacity (0–1)');
  opacity.value = '0.00001'; opacity.oninput(); expect(f.settings.visuals.edgeOpacity).toBe(.00001); opacity.value = '0'; opacity.oninput(); expect(f.settings.visuals.edgeOpacity).toBe(0);
  const calls = f.state.visual; for (const bad of ['', '-1', 'Infinity', '1.01']) { opacity.value = bad; opacity.oninput(); expect(opacity.getAttribute('aria-invalid')).toBe('true'); }
  expect(f.state.visual).toBe(calls); expect(f.settings.visuals.edgeOpacity).toBe(0);
  const guards = f.panel.root.querySelectorAll('.graph-ng-guard'), curves = guards.find((g: any) => g.querySelector('summary').textContent.startsWith('Curves'));
  expect(curves.hidden).toBe(false); expect(curves.querySelector('div').textContent).toContain('60,000');
  const toggle = input(f.panel.root, 'Curved edges'); toggle.checked = false; toggle.onchange(); expect(curves.hidden).toBe(true); f.panel.dispose();
});
test('UX radius slider broadens precision without weakening finite numeric safety bounds', () => {
  const f = fixture(); f.panel.show('appearance'); const slider = input(f.panel.root, 'Base node radius slider'); expect(slider.getAttribute('aria-valuemin')).toBe('0.01'); expect(slider.getAttribute('aria-valuemax')).toBe('20');
  slider.value = '0'; slider.oninput(); expect(input(f.panel.root, 'Base node radius').value).toBe('0.01'); slider.value = '1000'; slider.oninput(); expect(input(f.panel.root, 'Base node radius').value).toBe('20'); expect(slider.getAttribute('aria-valuenow')).toBe('20');
  const radius = input(f.panel.root, 'Base node radius'); radius.value = '1e20'; radius.oninput(); control(f.panel.root, 'Preview sizing').click(); expect(f.state.preview).toBeNull(); expect(f.panel.sizingMessage).toContain('Not previewed'); f.panel.dispose();
});
test('UX member navigator renders bounded name/path rows, searches existing members and supports arrows', () => {
  const view: any = Object.create(GraphView.prototype), opened: string[] = [];
  Object.assign(view, { panel: new ControlElement(), plugin: { settings: { listPageSize: 7 } }, openPath: (path: string) => opened.push(path), showGroups() {} });
  const items = Array.from({ length: 16399 }, (_, i) => `Framework/Folder ${i % 3}/Note ${i}.md`); view.memberList(items, (s: string) => s);
  let rows = view.panel.querySelectorAll('.graph-ng-member'); expect(rows.length).toBe(7); expect(rows[0].querySelector('span').textContent).toBe('Note 0'); expect(rows[0].querySelector('small').textContent).toBe(items[0]);
  rows[0].focus(); view.panel.querySelector('.graph-ng-members').onkeydown({ key: 'ArrowDown', preventDefault() {} }); expect(ControlElement.active).toBe(rows[1]); rows[1].click(); expect(opened).toEqual([items[1]!]);
  const search = input(view.panel, 'Search available group members'); search.value = 'Note 16398.md'; search.oninput(); rows = view.panel.querySelectorAll('.graph-ng-member'); expect(rows.length).toBe(1); expect(rows[0].getAttribute('aria-label')).toContain('16398'); expect(view.panel.querySelector('.graph-ng-explore-note').textContent).toBe('1 of 16,399 available members');
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
  return { view, panel, pending, backs: () => backs, status: () => panel.querySelectorAll('div').find(e => e.getAttribute('role') === 'status') };
}
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
  expect(f.panel.textContent).toContain('Synthetic/Note.md'); expect(f.pending.length).toBe(1);
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
  const renderer: any = Object.create(GroupRenderer.prototype); Object.assign(renderer, { s, p: graph, container: { clientWidth: 800, clientHeight: 600 }, canvas: { style: {}, getContext: () => ctx }, nodes: new Map(), radii: new Map(), groupColors: [] });
  for (const opacity of [0, .0001, .5]) { s.visuals.edgeOpacity = opacity; strokes = []; renderer.draw(); expect(strokes.length).toBe(opacity ? 1 : 0); if (opacity) expect(strokes[0]).toBeCloseTo(edgeAlpha(s.visuals, 1, 1, false), 12); expect(graph.groupEdges.length).toBe(1); }
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
test('UX graph status uses structured phase, coverage and failures rather than English keyword guesses', () => {
  const view: any = Object.create(GraphView.prototype);
  Object.assign(view, { contentEl: { dataset: { state: 'building' } }, status: new ControlElement(), statusSummary: new ControlElement(), plugin: { settings: {} }, provisional: true, gpu: { available: true } });
  view.statusText = 'partial, provisional, pending'; expect(view.statusSummary.textContent).toBe('Preparing graph…');
  view.contentEl.dataset.state = 'ready'; view.statusText = '0 unresolved'; expect(view.statusSummary.textContent).toContain('still loading');
  view.provisional = false; view.statusText = 'error is a note name, not a health signal'; expect(view.statusSummary.hidden).toBe(true);
  view.report = { nodes: 4, edges: 2, indexed: 4, listed: 4, linksPending: false, provisional: false, unresolved: 3, duplicates: 0 }; view.statusText = 'details'; expect(view.statusSummary.textContent).toBe('3 unresolved links'); view.report = undefined;
  view.contentEl.dataset.state = 'error'; view.statusText = 'Projection refresh failed: synthetic missing file'; expect(view.statusSummary.textContent).toContain('synthetic missing file'); expect(view.statusSummary.textContent).not.toContain('Retry');
  view.contentEl.dataset.state = 'ready'; view.plugin.settings.projectionFile = 'synthetic.json'; view.statusText = 'aggregate'; expect(view.statusSummary.textContent).toContain('not verified');
  view.plugin.settings.projectionFile = ''; view.gpu = { available: false, reason: 'Synthetic renderer unavailable' }; view.statusText = 'fallback'; expect(view.statusSummary.textContent).toContain('Synthetic renderer unavailable'); expect(view.statusSummary.textContent).toContain('Browse groups and members');
});

/** Production shell/Notes transition and renderer visibility; only graphics/boot boundaries are fake. */
async function navigationFixture() {
  const view: any = Object.create(GraphView.prototype), root = new ControlElement(), settings = defaults('links');
  let clear = 0, disposed = 0, frames = 0, creates = 0;
  const requests: string[] = [], originalCreate = DetailRenderer.create;
  Object.assign(view, { contentEl: root, view: { ...emptyView(), query: 'keep', filters: [{ kind: 'exists', key: 'category' }] }, closed: false, renderRevision: 0,
    plugin: { settings, subscribe: () => () => {}, saveSoon() {}, pipeline: { request(_revision: number, request: any) { requests.push(request.kind); throw new Error('Unexpected worker request'); } } },
    app: { workspace: { on() {} } }, registerEvent() {}, async refresh() {}, contributionPage: { clear() { clear++; } } });
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
  members.click(); expect(members.getAttribute('aria-expanded')).toBe('true'); expect(ControlElement.active).toBe(control(f.panel.root, 'Close'));
  control(f.toolbar, 'Saved views').click(); expect(members.getAttribute('aria-expanded')).toBe('false');
  members.click(); f.panel.root.onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  expect(members.getAttribute('aria-expanded')).toBe('false'); expect(f.panel.root.hidden).toBe(true); expect(ControlElement.active).toBe(members); f.panel.dispose();
});

async function softwareNavigationFixture(maxNodes: number, maxEdges: number) {
  const f = await navigationFixture(), p = f.renderer.projection;
  Object.assign(p, { source: new Uint32Array([0, 1, 0]), target: new Uint32Array([1, 2, 2]), type: new Uint32Array(3) });
  Object.assign(f.renderer, { gpu: false, gl: null, ctx: {}, edgeOn: new Uint8Array(3) });
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
      expect(JSON.stringify(f.view.view)).toBe(query); expect(f.view.status.textContent).toContain(reason); expect(f.view.status.textContent).toContain('use group member lists');
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
      expect(f.view.explorePanel.alert.textContent).toContain('Too many notes to draw individually on this renderer'); expect(f.view.statusSummary.textContent).toContain('Narrow filters to see notes');
      expect(f.view.explorePanel.alert.querySelectorAll('button').length).toBe(0); expect(f.view.status.textContent).toContain(reason);
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
  const note = f.panel.root.querySelectorAll('div').find((e: any) => e.textContent.startsWith('Lines: each'))!; expect(note.textContent).toContain('adds 44,123 dots'); expect(note.textContent).not.toContain(' · ');
  fail = true; await nodes.onclick(); expect(applies).toBe(1); expect(f.panel.root.textContent).toContain('Not switched: Error: synthetic save failure');
  expect(plugin.settings.declaration.display.reifiedAsNodes).toBe(false);
  fail = false; await (buttons()[1] as any).onclick(); expect(applies).toBe(2);
  expect(plugin.settings.declaration.display.reifiedAsNodes).toBe(true); expect(plugin.settings.explore.view.query).toBe('kept');
  expect(f.settings.declaration.display.reifiedAsNodes).toBe(false); // the previous settings object is not mutated
  await setRelationshipDisplay(plugin, true); expect(applies).toBe(2); // no-op when already in that display
  f.panel.dispose();
});
