import { test, expect } from 'bun:test';
import './support/obsidian-fixture';
import { defaults } from '../src/settings';
import { physicsSettings } from '../src/physics-controls';
import { ExplorePanel } from '../src/explore-panel';
import { emptyView } from '../src/core/explore';
import { ControlElement, control } from './support/controls-dom';
const { default: GraphPlugin, GraphView } = await import('../src/main');
const values = { scalingRatio: 2, gravity: 1, slowDown: 1 };
function fixture() {
  const settings = defaults('links'), root = new ControlElement(); let applied = 0;
  const render = ExplorePanel.prototype.render; ExplorePanel.prototype.render = function () {};
  let panel: any;
  try { panel = new ExplorePanel(root as any, { settings: () => settings, async applyLayout(v: any) { applied++; settings.layout = physicsSettings(settings, v).layout; } } as any, emptyView()); }
  finally { ExplorePanel.prototype.render = render; }
  panel.render = () => { panel.body.empty(); panel.physics(panel.body); }; panel.render();
  return { panel, settings, applied: () => applied };
}
function input(f: ReturnType<typeof fixture>, key: number, value: string) {
  const e: any = f.panel.body.querySelectorAll('input')[key]; e.value = value; e.oninput();
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
test('numeric drafts survive rerenders; reset changes only three drafts; explicit apply runs once', async () => {
  const f = fixture(); f.settings.layout.force.scalingRatio = 100000; f.panel.physicsDraft = undefined; f.panel.render();
  expect(f.panel.body.querySelectorAll('input')[0].value).toBe('100000');
  input(f, 0, '999999'); input(f, 1, '0'); f.panel.render();
  expect(f.panel.body.querySelectorAll('input')[0].value).toBe('999999'); expect(f.applied()).toBe(0);
  control(f.panel.body, 'Reset layout values').click(); expect(f.settings.layout.force.scalingRatio).toBe(100000);
  expect(f.panel.body.querySelectorAll('input').map((e: any) => e.value)).toEqual(['2', '1', '1']);
  const apply: any = control(f.panel.body, 'Apply and recompute'); const pending = apply.onclick(); apply.onclick(); await pending;
  expect(f.applied()).toBe(1); expect(f.settings.layout.force.scalingRatio).toBe(2); f.panel.dispose();
});
test('invalid and disposed panel apply neither saves nor runs; rejected host shows inline error', async () => {
  const f = fixture(), before = structuredClone(f.settings);
  for (const bad of ['', 'NaN', 'Infinity', '0']) { input(f, 0, bad); await (control(f.panel.body, 'Apply and recompute') as any).onclick(); expect(f.panel.physicsError).toContain('Not applied'); }
  expect(f.settings).toEqual(before); expect(f.applied()).toBe(0);
  input(f, 0, '2'); f.panel.host.applyLayout = async () => { throw new Error('worker rejected'); };
  await (control(f.panel.body, 'Apply and recompute') as any).onclick(); expect(f.panel.physicsError).toContain('worker rejected'); expect(f.settings).toEqual(before);
  f.panel.dispose(); await (control(f.panel.body, 'Apply and recompute') as any).onclick(); expect(f.applied()).toBe(0);
});
function runtime() {
  const v: any = Object.create(GraphView.prototype), settings = defaults('links'); let saves = 0, calls = 0;
  Object.assign(v, { activeRevision: 7, detailGeneration: 7, renderRevision: 2, projection: {}, positions: new Float32Array([1, 2]), closed: false,
    plugin: Object.assign(new GraphPlugin(null as any, {} as any), { settings, saveData: async () => { saves++; }, pipeline: { request: async (revision: number, request: any) => { calls++; expect(revision).toBe(7); expect(request.kind).toBe('recompute'); return { positions: new Float32Array([3, 4]) }; } } }) });
  return { v, saves: () => saves, calls: () => calls };
}
test('host runs one layout-only RPC, preserves untouched settings, and commits only successful current generation', async () => {
  const f = runtime(), before = structuredClone(f.v.plugin.settings); await f.v.applyLayout({ ...values, gravity: 0 });
  expect(f.calls()).toBe(1); expect(f.saves()).toBe(1); expect([...f.v.positions]).toEqual([3, 4]);
  expect({ ...f.v.plugin.settings, layout: before.layout }).toEqual(before);
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

test('real worker recompute is finite, layout-only and non-streaming; stale/invalid requests preserve prior generation', async () => {
  const { WorkerPipeline } = await import('../src/pipeline');
  const { packRows } = await import('../src/core/columns');
  const s = defaults('links'), options = { ...s.layout, iterations: 2, relaxIterations: 2 };
  const p = new WorkerPipeline(new Worker(new URL('../src/layout-worker.ts', import.meta.url).href) as any, () => 10000);
  try {
    await p.request(1, { kind: 'configure', config: { declaration: s.declaration, layout: options, source: 'fixture/local', groupLevel: 0, streamEveryIterations: 1 } });
    await p.request(1, { kind: 'rows', reset: true, columns: packRows([{ path: 'a.md', properties: {} }, { path: 'b.md', properties: {} }], s.declaration) });
    await p.request(1, { kind: 'project' }); await p.request(1, { kind: 'layout' });
    const before = await p.request<import('../src/core/binary-layout').BinaryGeneration>(1, { kind: 'encode' }); let streams = 0, groups = 0;
    p.onPositions = () => streams++; p.onGroups = () => groups++;
    const result: any = await p.request(1, { kind: 'recompute', options: { ...options, force: { ...options.force, gravity: 0, scalingRatio: 100000 } } });
    expect(result.positions.length).toBe(4); expect(result.positions.every(Number.isFinite)).toBe(true); expect(result.cached).toBe(false);
    expect(streams).toBe(0); expect(groups).toBe(0);
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
