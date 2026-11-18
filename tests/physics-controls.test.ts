import { test, expect } from 'bun:test';
import './support/obsidian-fixture';
import { defaults } from '../src/settings';
import { physicsSettings, presetValues, PHYSICS_FIELDS, PHYSICS_PRESETS, PRESET_BOUNDS } from '../src/physics-controls';
import { recommendedPhysics } from '../src/recommend';
import { upgradeSettings } from '../src/settings';
import { ExplorePanel } from '../src/explore-panel';
import { emptyView } from '../src/core/explore';
import { ControlElement, control } from './support/controls-dom';
const { default: GraphPlugin, GraphView } = await import('../src/main');
const values = { scalingRatio: 2, gravity: 1, slowDown: 1 };
function fixture(extra: object = {}) {
  const settings = defaults('links'), root = new ControlElement(); settings.declaration.hierarchy = { parentProperty: 'parentRef' }; let applied = 0;
  const render = ExplorePanel.prototype.render; ExplorePanel.prototype.render = function () {};
  let panel: any;
  try { panel = new ExplorePanel(root as any, { settings: () => settings, result: () => ({ nodes: 16000, edges: 50000 }), async applyLayout(v: any) { applied++; settings.layout = physicsSettings(settings, v).layout; }, ...extra } as any, emptyView()); }
  finally { ExplorePanel.prototype.render = render; }
  panel.render = () => { panel.body.empty(); panel.physics(panel.body); }; panel.render();
  return { panel, settings, applied: () => applied };
}
function choose(f: ReturnType<typeof fixture>, name: string) { const select = f.panel.body.querySelector('select'); select.value = name; control(f.panel.body, 'Use preset').click(); }
const numbers = (f: ReturnType<typeof fixture>): any[] => f.panel.body.querySelectorAll('input').filter((e: any) => e.type === 'number');
function input(f: ReturnType<typeof fixture>, key: number, value: string) {
  const e: any = numbers(f)[key]; e.value = value; e.oninput();
}
test('full settings merge preserves custom physics, visuals, saved views and other settings without clamping', () => {
  const s = defaults('links'); s.layout.force.linLogMode = true; s.layout.maxForce = 123; s.visuals.glow = .123;
  const before = structuredClone(s);
  for (const v of [values, { scalingRatio: 1e7, gravity: 0, slowDown: 1e8 }, { scalingRatio: .001, gravity: 9, slowDown: .25 }]) {
    const next = physicsSettings(s, v); expect(next.layout.force).toEqual({ ...s.layout.force, ...v });
    expect({ ...next, layout: s.layout }).toEqual(s); expect(next.layout.maxForce).toBe(123);
  }
  expect(s).toEqual(before);
});
test('invalid zero negative NaN Infinity and invalid full settings are atomic', () => {
  const s = defaults('links'), before = structuredClone(s);
  for (const key of ['scalingRatio', 'gravity', 'slowDown']) for (const value of [-1, NaN, Infinity, -Infinity, ...(key === 'gravity' ? [] : [0])]) expect(() => physicsSettings(s, { ...values, [key]: value })).toThrow();
  expect(s).toEqual(before); expect(() => physicsSettings({ ...s, nodeSize: NaN }, values)).toThrow();
});
const byLabel = (f: ReturnType<typeof fixture>, label: string): any => f.panel.body.querySelectorAll('input').find((e: any) => e.getAttribute('aria-label') === label);
const room = recommendedPhysics(16000, 50000);
test('numeric drafts survive rerenders; reset restores every recommended value; explicit apply runs once', async () => {
  const f = fixture(); f.settings.layout.force.scalingRatio = 100000; f.panel.physicsDraft = undefined; f.panel.render();
  expect(numbers(f)[0].value).toBe('100000');
  input(f, 0, '999999'); input(f, 1, '0'); f.panel.render();
  expect(numbers(f)[0].value).toBe('999999'); expect(f.applied()).toBe(0);
  expect(f.panel.body.textContent).toContain('2 changes'); expect(f.panel.body.textContent).toContain('Spread notes100000 → 999999'); expect(f.panel.body.textContent).toContain('Pull to center1 → 0');
  choose(f, 'Recommended'); expect(f.settings.layout.force.scalingRatio).toBe(100000);
  const d = room;
  for (const [key, label] of PHYSICS_FIELDS) { const e = byLabel(f, label); expect(typeof d[key] === 'boolean' ? e.checked : e.value).toBe(typeof d[key] === 'boolean' ? d[key] : String(d[key])); }
  const apply: any = control(f.panel.body, 'Apply layout'); const pending = apply.onclick(); apply.onclick(); await pending;
  expect(f.applied()).toBe(1); expect(f.settings.layout.force.scalingRatio).toBe(10); expect(f.settings.layout.force.strongGravityMode).toBe(true); f.panel.dispose();
});
test('layout engine help describes the shipping policy behind its disclosure', () => {
  const f = fixture();
  try {
    const tip = control(f.panel.body, 'Layout engine').parentElement!.querySelector('.graph-ng-help-popover')!;
    expect(tip.hidden).toBe(true);
    expect(tip.textContent).toMatch(/Auto.*Processor.*every graph size/);
    expect(tip.textContent).toMatch(/Graphics chip.*much faster.*large graphs.*capable GPU/);
    expect(tip.textContent).not.toMatch(/trial|[\u2014\u00b7]/);
  } finally { f.panel.dispose(); }
});
test('every control has a plain label and an effect hint; advanced controls sit in a collapsed section', () => {
  const f = fixture(), details: any = f.panel.body.querySelector('details');
  expect(details.open).toBeFalsy(); expect(details.textContent).toContain('Advanced layout');
  for (const [, label, hint, advanced] of PHYSICS_FIELDS) {
    expect(hint.length).toBeGreaterThan(30); expect(f.panel.body.textContent).toContain(hint);
    expect(details.contains(byLabel(f, label))).toBe(advanced);
  }
  expect(PHYSICS_FIELDS.filter(([, , , advanced]) => !advanced).map(([key]) => key)).toEqual(['scalingRatio', 'gravity', 'familyPull', 'hubGravity']);
  f.panel.dispose();
});
test('presets and checkboxes only fill drafts; one explicit apply sends every exposed value', async () => {
  const f = fixture(); let sent: any; f.panel.host.applyLayout = async (v: any) => { sent = v; f.settings.layout = physicsSettings(f.settings, v).layout; };
  const before = structuredClone(f.settings);
  choose(f, 'Groups apart');
  expect(f.settings).toEqual(before); expect(sent).toBeUndefined();
  expect(byLabel(f, 'Strong gravity').checked).toBe(true); expect(byLabel(f, 'Pull to center').value).toBe(String(room.gravity / 2));
  expect(f.panel.body.querySelector('select').value).toBe('Groups apart');
  const overlap = byLabel(f, 'Prevent overlap'); overlap.checked = true; overlap.onchange();
  f.panel.render(); expect(byLabel(f, 'Prevent overlap').checked).toBe(true);
  await (control(f.panel.body, 'Apply layout') as any).onclick();
  expect(sent).toEqual({ ...presetValues('Groups apart', room), adjustSizes: true });
  expect(f.settings.layout.iterations).toBe(room.iterations); expect(f.settings.layout.force.gravity).toBe(room.gravity / 2);
  expect(f.settings.layout.force.strongGravityMode).toBe(true); expect(f.settings.layout.force.adjustSizes).toBe(true);
  expect({ ...f.settings.layout, iterations: 100, force: before.layout.force }).toEqual(before.layout);
  f.panel.dispose();
});
test('presets validate, touch only exposed controls, and older saved settings without them still migrate', () => {
  const s = defaults('links'); s.layout.seed = 9; s.layout.maxForce = 7; s.layout.force.edgeWeightInfluence = 3; s.layout.force.barnesHutOptimize = false;
  for (const [name] of PHYSICS_PRESETS) {
    const next = physicsSettings(s, presetValues(name));
    expect(next.layout.seed).toBe(9); expect(next.layout.maxForce).toBe(7); expect(next.layout.force.edgeWeightInfluence).toBe(3); expect(next.layout.force.barnesHutOptimize).toBe(false);
  }
  expect(() => presetValues('Nope')).toThrow(); expect(() => physicsSettings(s, { ...values, seed: 1 } as any)).toThrow('Unknown layout control');
  for (const bad of [{ iterations: 0 }, { iterations: 1.5 }, { barnesHutTheta: 0 }, { linLogMode: 'yes' }]) expect(() => physicsSettings(s, { ...values, ...bad } as any)).toThrow();
  const old = upgradeSettings({ layout: { iterations: 50, force: { scalingRatio: 5, gravity: 2, slowDown: 1 } } }, 'links');
  expect(old.layout.iterations).toBe(50); expect(old.layout.force.scalingRatio).toBe(5); expect(old.layout.force.linLogMode).toBe(false);
  expect(physicsSettings(old, values).layout.iterations).toBe(50);
});
test('invalid and disposed panel apply neither saves nor runs; rejected host shows inline error', async () => {
  const f = fixture(), before = structuredClone(f.settings);
  for (const bad of ['', 'NaN', 'Infinity', '0']) { input(f, 0, bad); await (control(f.panel.body, 'Apply layout') as any).onclick(); expect(f.panel.physicsError).toContain('Not applied'); }
  expect(f.settings).toEqual(before); expect(f.applied()).toBe(0);
  input(f, 0, '2'); f.panel.host.applyLayout = async () => { throw new Error('worker rejected'); };
  await (control(f.panel.body, 'Apply layout') as any).onclick(); expect(f.panel.physicsError).toContain('worker rejected'); expect(f.settings).toEqual(before);
  f.panel.dispose(); await (control(f.panel.body, 'Apply layout') as any).onclick(); expect(f.applied()).toBe(0);
});
function runtime() {
  const v: any = Object.create(GraphView.prototype), settings = defaults('links'); let saves = 0, calls = 0;
  Object.assign(v, { statusSummary: new ControlElement(), activeRevision: 7, detailGeneration: 7, renderRevision: 2, projection: {}, positions: new Float32Array([1, 2]), closed: false,
    plugin: Object.assign(new GraphPlugin(null as any, {} as any), { settings, saveData: async () => { saves++; }, pipeline: { request: async (revision: number, request: any) => { calls++; expect(revision).toBe(7); expect(request.kind).toBe('recompute'); return { positions: new Float32Array([3, 4]) }; } } }) });
  Object.defineProperty(v, 'statusText', { configurable: true, get() { return this.statusMessage ?? ''; }, set(text: string) { this.statusMessage = text; } });
  return { v, saves: () => saves, calls: () => calls };
}
test('canvas and Layout panel share a queued pass and retain unapplied drafts on settlement', async () => {
  const { v } = runtime(), root = new ControlElement(); delete v.statusText;
  Object.assign(v, { contentEl: root, app: { workspace: { on() {} } }, registerEvent() {}, view: emptyView(), refresh() {}, layoutStopped: true, layoutSettled: false });
  Object.assign(root.dataset, { state: 'ready', mode: 'nodes' }); v.plugin.saveSoon = () => {};
  const render = ExplorePanel.prototype.render; ExplorePanel.prototype.render = () => {};
  try { await v.onOpen(); } finally { ExplorePanel.prototype.render = render; }
  const panel = v.explorePanel; panel.render = () => { panel.body.empty(); panel.physics(panel.body); }; panel.show('layout');
  const spread = () => byLabel({ panel } as any, 'Spread notes'); spread().value = '99'; spread().oninput(); v.statusText = 'Layout not settled';
  const apply = control(panel.body, 'Keep refining'), canvas = control(v.statusSummary, 'Keep refining');
  let release!: () => void, runs = 0; v.plugin.work = new Promise<void>(r => { release = r; });
  v.plugin.pipeline.request = async (_: number, req: any) => { if (req.kind === 'recompute') runs++; return { positions: new Float32Array(2), settled: true }; }; v.plugin.settings.persistLayout = false;
  try {
    canvas.click(); const busy = panel.body.querySelector('.mod-cta'); expect(busy.disabled).toBe(true);
    canvas.click(); apply.click(); release(); await v.plugin.work; await Bun.sleep(0);
    expect(runs).toBe(1); expect(control(panel.body, 'Apply layout').disabled).toBe(false); expect(panel.body.textContent).not.toContain('Layout not settled'); expect(spread().value).toBe('99'); expect(v.plugin.settings.layout.force.scalingRatio).not.toBe(99);
  } finally { release(); await v.plugin.work.catch(() => {}); panel.dispose(); }
});
test('host runs one layout-only RPC, preserves untouched settings, and commits only successful current generation', async () => {
  const f = runtime(), before = structuredClone(f.v.plugin.settings); await f.v.applyLayout({ ...values, gravity: 0 });
  expect(f.calls()).toBe(1); expect(f.saves()).toBe(1); expect([...f.v.positions]).toEqual([3, 4]);
  expect({ ...f.v.plugin.settings, layout: before.layout }).toEqual(before);
});
test('Apply cannot commit behind a Notes renderer awaiting its first paint', async () => {
  const f = runtime(); f.v.contentEl = { dataset: { mode: 'nodes-building' } };
  await expect(f.v.applyLayout({ gravity: 4 })).rejects.toThrow('generation changed');
  expect(f.calls()).toBe(0); expect(f.saves()).toBe(0);
});
test('host rejects invalid stale disposed and worker-failed apply with prior graph and settings intact', async () => {
  for (const mode of ['invalid', 'closed-before', 'closed-after', 'stale', 'rebuild', 'settings', 'worker']) {
    const f = runtime(), positions = f.v.positions, settings = structuredClone(f.v.plugin.settings);
    if (mode === 'closed-before') f.v.closed = true;
    f.v.plugin.pipeline.request = async () => {
      if (mode === 'closed-after') f.v.closed = true;
      if (mode === 'stale') f.v.activeRevision++;
      if (mode === 'rebuild') f.v.renderRevision++;
      if (mode === 'settings') f.v.plugin.settings.layout = structuredClone(f.v.plugin.settings.layout);
      if (mode === 'worker') throw new Error('worker rejected');
      return { positions: new Float32Array([9, 9]) };
    };
    await expect(f.v.applyLayout({ ...values, gravity: mode === 'invalid' ? NaN : 4 })).rejects.toThrow();
    expect(f.v.positions).toBe(positions); expect(f.v.plugin.settings).toEqual(settings); expect(f.saves()).toBe(0);
  }
});

test('real worker recompute is finite, layout-only and streams progressed frames; stale/invalid requests preserve prior generation', async () => {
  const { WorkerPipeline } = await import('../src/pipeline');
  const { packRows } = await import('../src/core/columns');
  const s = defaults('links'), options = { ...s.layout, iterations: 2, relaxIterations: 2, convergenceThreshold: 1e20, convergenceIterations: 2 };
  const p = new WorkerPipeline(new Worker(new URL('../src/layout-worker.ts', import.meta.url).href) as any, () => 10000);
  try {
    await p.request(1, { kind: 'configure', config: { declaration: s.declaration, layout: options, source: 'fixture/local', groupLevel: 0, streamEveryIterations: 1 } });
    await p.request(1, { kind: 'rows', reset: true, columns: packRows([{ path: 'a.md', properties: {} }, { path: 'b.md', properties: {} }], s.declaration) });
    await p.request(1, { kind: 'project' }); await p.request(1, { kind: 'layout' });
    const before = await p.request<import('../src/core/binary-layout').BinaryGeneration>(1, { kind: 'encode' }); let streams = 0, groups = 0;
    p.onPositions = () => { streams++; }; p.onGroups = () => groups++;
    const result: any = await p.request(1, { kind: 'recompute', options: { ...options, force: { ...options.force, gravity: 0, scalingRatio: 100000 } } });
    expect(result.positions.length).toBe(4); expect(result.positions.every(Number.isFinite)).toBe(true); expect(result.cached).toBe(false);
    expect(streams).toBe(1); expect(groups).toBe(0);
    // Await real worker delivery before synchronous matcher assertions: Bun's promise
    // rejection matcher can block Worker message delivery in this mixed host fixture.
    const rejected = await Promise.all([0, 2].map(revision => p.request(revision, { kind: 'recompute', options }).then(() => '', error => String(error))));
    expect(rejected).toEqual(['Error: Error: Projection generation changed', 'Error: Error: Projection generation changed']);
    const invalid = await p.request(1, { kind: 'recompute', options: { ...options, force: { ...options.force, slowDown: 0 } } }).then(() => '', error => String(error));
    expect(invalid).toContain('Invalid force.slowDown');
    expect(await p.request<import('../src/core/binary-layout').BinaryGeneration>(1, { kind: 'encode' })).toEqual(before);
  } finally { p.dispose(); }
});

test('recompute callers settle by exact RPC ownership; late responses cannot complete another caller and disposal rejects the queue', async () => {
  const { WorkerPipeline } = await import('../src/pipeline');
  const transport: any = { onmessage: null, onerror: null, postMessage() {}, terminate() {} };
  const p = new WorkerPipeline(transport, () => 1000), options = defaults('links').layout;
  const emit = (data: object) => transport.onmessage({ data });
  try {
    const first = p.request(7, { kind: 'recompute', options });
    const second = p.request(9, { kind: 'recompute', options }).then(() => '', error => String(error));
    emit({ id: 1, revision: 7, result: 'current' }); expect(await first).toBe('current');
    let completed = false; second.then(() => { completed = true; });
    emit({ id: 1, revision: 7, result: 'late' }); emit({ id: 1, revision: 9, result: 'wrong id' });
    await Promise.resolve(); expect(completed).toBe(false);
    emit({ id: 2, revision: 9, error: 'Projection generation changed' });
    expect(await second).toContain('Projection generation changed');
    const active = p.request(9, { kind: 'recompute', options }).then(() => '', error => String(error));
    const queued = p.request(9, { kind: 'recompute', options }).then(() => '', error => String(error));
    p.dispose(new Error('cancelled by disposal'));
    expect(await Promise.all([active, queued])).toEqual(['Error: cancelled by disposal', 'Error: cancelled by disposal']);
  } finally { p.dispose(); }
});

test('preset transforms are relative to the base, bounded, and never compound', () => {
  for (const [nodes, edges] of [[500, 1500], [16000, 50000]] as const) {
    const base = recommendedPhysics(nodes, edges);
    for (const [name, scale] of PHYSICS_PRESETS) {
      const out = presetValues(name, base);
      expect(presetValues(name, base)).toEqual(out); expect(base).toEqual(recommendedPhysics(nodes, edges));
      for (const [key] of PHYSICS_FIELDS) {
        const factor = (scale as Record<string, number>)[key];
        if (factor === undefined) expect(out[key]).toBe(base[key]);
        else expect(Math.abs((out[key] as number) / (base[key] as number) - factor)).toBeLessThan(.02);
      }
      expect(() => physicsSettings(defaults('links'), out)).not.toThrow();
    }
  }
  const extreme = { ...recommendedPhysics(500, 1500), gravity: 15, iterations: 30, barnesHutTheta: 2.9 };
  expect(presetValues('Fill the screen', extreme).gravity).toBe(PRESET_BOUNDS.gravity[1]);
  expect(presetValues('Faster', extreme)).toMatchObject({ iterations: PRESET_BOUNDS.iterations[0], barnesHutTheta: PRESET_BOUNDS.barnesHutTheta[1] });
  expect(PHYSICS_PRESETS.length).toBeGreaterThanOrEqual(3); expect(PHYSICS_PRESETS.length).toBeLessThanOrEqual(5);
});
test('recommended values scale with graph size and stay valid', () => {
  const sizes = [[50, 60], [500, 1500], [2000, 6000], [16000, 50000], [200000, 900000]].map(([n, e]) => recommendedPhysics(n!, e!));
  for (let i = 1; i < sizes.length; i++) { expect(sizes[i]!.gravity).toBeLessThanOrEqual(sizes[i - 1]!.gravity); expect(sizes[i]!.iterations).toBeGreaterThanOrEqual(sizes[i - 1]!.iterations); }
  expect(sizes[0]!.gravity).toBeGreaterThan(sizes[3]!.gravity); expect(sizes[0]!.iterations).toBeLessThan(sizes[3]!.iterations);
  for (const v of sizes) { expect(v.strongGravityMode).toBe(true); expect(v.gravity).toBeGreaterThanOrEqual(.1); expect(v.gravity).toBeLessThanOrEqual(.25); expect(() => physicsSettings(defaults('links'), v)).not.toThrow(); }
  expect(recommendedPhysics(16000, 50000)).toMatchObject({ scalingRatio: 10, gravity: .125, slowDown: 1, iterations: 310, barnesHutTheta: 1.2 });
  expect(recommendedPhysics(0, 0).iterations).toBe(300);
});
test('undo restores the tuned values before a preset, and re-applies them in one click once the preset was applied', async () => {
  const f = fixture(); f.settings.layout.force.scalingRatio = 1200; f.settings.layout.force.gravity = 20; f.settings.layout.force.slowDown = 20; f.panel.physicsDraft = undefined; f.panel.render();
  const before = structuredClone(f.settings), undo = () => control(f.panel.body, 'Undo preset') as any;
  expect(f.panel.body.querySelectorAll('button').some((e: any) => e.getAttribute('aria-label') === 'Undo preset')).toBe(false);
  input(f, 0, '900'); choose(f, 'Fill the screen');
  expect(byLabel(f, 'Pull to center').value).toBe(String(room.gravity * 3)); expect(undo().disabled).toBe(false);
  undo().click();
  expect(byLabel(f, 'Spread notes').value).toBe('900'); expect(byLabel(f, 'Pull to center').value).toBe('20'); expect(byLabel(f, 'Strong gravity').checked).toBe(false);
  expect(f.applied()).toBe(0); expect(f.settings).toEqual(before); expect(f.panel.body.querySelectorAll('button').some((e: any) => e.getAttribute('aria-label') === 'Undo preset')).toBe(false);
  input(f, 0, '1200'); choose(f, 'Faster'); await (control(f.panel.body, 'Apply layout') as any).onclick();
  expect(f.applied()).toBe(1); expect(f.settings.layout.iterations).toBe(Math.round(room.iterations / 2));
  undo().click(); await new Promise(r => setTimeout(r, 0));
  expect(f.applied()).toBe(2); expect(f.settings.layout).toEqual(before.layout);
  choose(f, 'Recommended'); undo().click(); expect(byLabel(f, 'Spread notes').value).toBe('1200');
  f.panel.dispose();
});
test('Pull in notes loads only Strong gravity and its pull into the draft; nothing is saved', async () => {
  const reason = '8,000 notes sit in disconnected parts.', f = fixture({ layoutAdvice: () => ({ gravity: .124, reason }) });
  Object.assign(f.settings.layout.force, { scalingRatio: 23.64, gravity: .5, strongGravityMode: false }); f.panel.physicsDraft = undefined; f.panel.render();
  expect(f.panel.body.textContent).toContain(reason);
  const before = structuredClone(f.settings); control(f.panel.body, 'Pull in notes').click();
  expect(f.settings).toEqual(before); expect(f.applied()).toBe(0);
  expect(f.panel.physicsDraft).toMatchObject({ scalingRatio: '23.64', gravity: '0.124', strongGravityMode: true });
  expect(f.panel.body.textContent).toContain('Pull to center0.5 → 0.124'); expect(f.panel.body.textContent).toContain('Strong gravityoff → on');
  await (control(f.panel.body, 'Apply layout') as any).onclick();
  expect(f.settings.layout.force).toMatchObject({ scalingRatio: 23.64, gravity: .124, strongGravityMode: true }); f.panel.dispose();
  const plain = fixture(); expect(plain.panel.body.textContent).not.toContain('Pull in notes'); plain.panel.dispose();
});
test('family control needs a declaration; pending count lives beside Apply and empty status is hidden', async () => {
  const f = fixture();
  expect(byLabel(f, 'Family pull').value).toBe('0');
  const changes = f.panel.body.querySelector('.graph-ng-layout-changes');
  expect(changes.hidden).toBe(true); expect(f.panel.body.textContent).not.toContain('No pending changes');
  const family = byLabel(f, 'Family pull'); family.value = '2'; family.oninput();
  expect(changes.hidden).toBe(false); expect(changes.textContent).toContain('1 change');
  expect(changes.parentElement.contains(control(f.panel.body, 'Apply layout'))).toBe(true);
  await (control(f.panel.body, 'Apply layout') as any).onclick(); expect(f.settings.layout.force.familyPull).toBe(2);
  expect(f.panel.body.querySelector('.graph-ng-layout-changes').hidden).toBe(true);
  delete f.settings.declaration.hierarchy; f.panel.render(); expect(byLabel(f, 'Family pull')).toBeUndefined();
  const legacy = JSON.parse(JSON.stringify(f.settings)); delete legacy.layout.force.familyPull;
  expect(upgradeSettings(legacy, 'links').layout.force.familyPull).toBe(0); f.panel.dispose();
});
