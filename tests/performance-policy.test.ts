import { expect, test } from 'bun:test';
import './support/obsidian-fixture';
import { deviceTier, devicePerformance, PerformanceState, performanceRecords } from '../src/performance';
import { defaults, upgradeSettings, validateSettings } from '../src/settings';
import { DevicePerformanceStore, deviceDefaults, sharedPerformanceData } from '../src/device-performance';
import { performanceChoices, performanceSettings } from '../src/performance-ui';
import { buildLabels } from '../src/render-labels';
import { buildProjection } from '../src/core/projection';
import { renderProjection } from '../src/render-projection';
import { PickGrid } from '../src/render-data';

test('coarse tier handles missing signals, weak CPUs, memory and software graphics', () => {
  expect(deviceTier()).toBe('standard');
  for (const hints of [[4, 8], [12, 4], [2, undefined]] as const) expect(deviceTier(...hints)).toBe('low');
  expect(deviceTier(12, 8, 4096)).toBe('low');
  expect(deviceTier(12, 8, 16384, true)).toBe('low');
  expect(deviceTier(12, 8, 16384)).toBe('standard');
  expect(deviceTier(NaN, -1)).toBe('standard');
});
test('measured drawing contradicts hints with hysteresis; explicit modes override it', () => {
  const d = new PerformanceState(12, 8);
  for (let i = 0; i < 8; i++) d.frame(40);
  expect(d.tier).toBe('low'); expect(d.fast('auto')).toBe(true); expect(d.fast('quality')).toBe(false);
  for (let i = 0; i < 240; i++) d.frame(1);
  expect(d.tier).toBe('standard'); expect(d.fast('fast')).toBe(true);
  d.task(80); d.task(80); d.task(80); expect(d.tier).toBe('low');
  const previous = d.frameMs; d.frame(NaN); expect(d.frameMs).toBe(previous);
});
test('suggestion reason follows the admitting signal without inventing a layout cause', () => {
  const d = new PerformanceState(12, 8);
  expect(d.suggestion({ notes: 9999, edges: 49999, layoutMs: 80000 }, 999999999)).toBeUndefined();
  expect(d.suggestion({ notes: 10000 })).toEqual(['This graph is large', '10,000 notes in this graph']);
  expect(d.suggestion({ notes: 4000, edges: 50000 })).toEqual(['This graph is large', '50,000 edges in this graph']);
  expect(d.suggestion({}, 1.1e9)).toEqual(['This app is using a lot of memory', 'About 1,100 MB of app memory in use']);
  const low = new PerformanceState(4, 4);
  expect(low.suggestion({ notes: 10000 })).toEqual(['This graph is large for this device', '10,000 notes in this graph']);
  expect(low.suggestion({ notes: 4000 })).toEqual(['This graph may be slow on this device', '4,000 notes on a lower power device']);
  expect(low.suggestion()).toEqual(['This graph may be slow on this device', 'Lower power device detected']);
  d.task(80); d.task(80); d.task(80);
  expect(d.suggestion()).toEqual(['This app is busy on this device', '3 long tasks took about 240 ms']);
  for (let i = 0; i < 8; i++) d.frame(80);
  expect(d.suggestion({ notes: 20000 })).toEqual(['Drawing is slow on this device', 'Frames took about 80 ms']);
  for (let i = 0; i < 240; i++) d.frame(1);
  expect(d.suggestion({ notes: 4000 })).toBeUndefined();
});
test('performance settings upgrade with diagnostics off and reject invalid types', () => {
  const s = defaults('links'); expect(s.performance).toBe('auto'); expect(s.performanceDiagnostics).toBe(false);
  const old: any = { ...s }; delete old.performance; delete old.performanceDiagnostics; delete old.performanceSuggestions; delete old.performancePrompted;
  expect(upgradeSettings(old, 'links').performance).toBe('auto'); expect(upgradeSettings(old, 'links').performancePrompted).toBe(false);
  for (const performance of ['auto', 'fast', 'quality'] as const) expect(() => validateSettings({ ...s, performance })).not.toThrow();
  expect(() => validateSettings({ ...s, performance: 'secret-note.md' } as any)).toThrow();
  expect(() => validateSettings({ ...s, performanceDiagnostics: 'yes' } as any)).toThrow();
});
test('diagnostics allowlist strips note names, paths, content, strings and nonfinite numbers', () => {
  const privateText = 'Private Folder/Secret Note.md';
  const rows = performanceRecords(Array.from({ length: 40 }, () => ({ tier: 'low', mode: 'auto', notes: 123, layoutMs: 1.6, path: privateText, name: privateText, content: privateText, heapBytes: Infinity, edges: privateText, frameMs: NaN, longTaskMs: -1 })));
  expect(rows).toHaveLength(16); expect(rows[0]).toEqual({ tier: 'low', mode: 'auto', notes: 123, layoutMs: 2 });
  expect(JSON.stringify(rows)).not.toContain(privateText);
  expect(performanceRecords([{ tier: privateText, mode: 'auto' }, null, { tier: 'low', mode: privateText }])).toEqual([]);
});
test('performance suggestions list only enabled work and change only checked choices', () => {
  const s = defaults('links'); s.performance = 'quality'; s.visuals.labelStyle = 'ranked'; s.visuals.curvedEdges = true; s.declaration.display.reifiedAsNodes = true;
  expect(performanceChoices(s).map(r => r[0])).toEqual(['fast', 'labels', 'curves', 'motion', 'relationships']);
  const next = performanceSettings(s, new Set(['labels', 'relationships']));
  expect(next.visuals.labelStyle).toBe('anchored'); expect(next.declaration.display.reifiedAsNodes).toBe(false);
  expect(next.performance).toBe('quality');
  expect(next.visuals.curvedEdges).toBe(true); expect(next.layout).toBe(s.layout); expect(s.visuals.labelStyle).toBe('ranked');
  const all = performanceSettings(s, new Set(['fast', 'labels', 'curves', 'motion', 'relationships'])); expect(performanceChoices(all)).toEqual([]); expect(all.performance).toBe('fast');
});
test('anchored labels keep ranked placement and widths without raster or glyph geometry', async () => {
  const s = defaults('links'), rows = Array.from({ length: 20 }, (_, i) => ({ path: `Synthetic/Note-${i}.md`, properties: {}, links: {} }));
  const p = renderProjection(buildProjection(rows, s.declaration)), visible = new Uint8Array(20).fill(1), positions = Float32Array.from({ length: 40 }, (_, i) => i * 10);
  const grid = new PickGrid(positions, visible); const previous = globalThis.document;
  let painted = 0;
  (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ measureText: (text: string) => ({ width: text.length * 7 }), fillText: () => painted++ }) }) };
  try {
    const a = await buildLabels(p, grid, s, 1280, 800, 'sans-serif', () => true);
    expect(a.canvas.width).toBe(1); expect(painted).toBe(0); expect(a.levels.every(l => l.length === 0)).toBe(true);
    s.visuals.labelStyle = 'ranked'; const b = await buildLabels(p, grid, s, 1280, 800, 'sans-serif', () => true);
    expect(b.canvas.width).toBe(2048); expect(painted).toBeGreaterThan(0);
    expect(a.nodes).toEqual(b.nodes); expect(a.scales).toEqual(b.scales); expect(a.widths).toEqual(b.widths);
    expect(b.levels.some(l => l.length > 0)).toBe(true);
  } finally { (globalThis as any).document = previous; }
});

test('performance checklist omits motion already suppressed by effective performance mode', () => {
  const s = defaults('links'), tier = devicePerformance.tier;
  try {
    s.performance = 'fast'; expect(performanceChoices(s).some(row => row[0] === 'fast')).toBe(false); expect(performanceChoices(s).some(row => row[0] === 'motion')).toBe(false);
    s.performance = 'auto'; devicePerformance.tier = 'low'; expect(performanceChoices(s).some(row => row[0] === 'fast')).toBe(false); expect(performanceChoices(s).some(row => row[0] === 'motion')).toBe(false);
    s.performance = 'quality'; expect(performanceChoices(s)[0]?.[0]).toBe('fast'); expect(performanceChoices(s).some(row => row[0] === 'motion')).toBe(true);
  } finally { devicePerformance.tier = tier; }
});

test('shared serialization strips device fields without changing graph or appearance settings', () => {
  const settings = defaults('links'); settings.performance = 'fast'; settings.performanceDiagnostics = true;
  const source = { settings, performanceLog: [{ tier: 'low', mode: 'fast', notes: 10 }], deviceNamespace: 'a'.repeat(32), generations: { synthetic: 1 } };
  const shared = sharedPerformanceData(source);
  for (const key of Object.keys(deviceDefaults())) expect(Object.hasOwn(shared.settings, key)).toBe(false);
  expect(Object.hasOwn(shared, 'performanceLog')).toBe(false);
  expect(shared.deviceNamespace).toBe(source.deviceNamespace); expect(shared.generations).toEqual(source.generations);
  for (const [key, value] of Object.entries(settings)) if (!Object.hasOwn(deviceDefaults(), key)) expect((shared.settings as any)[key]).toEqual(value);
  expect(source.settings.performance).toBe('fast'); expect(source.performanceLog).toHaveLength(1);
  expect(upgradeSettings(shared.settings, 'links').visuals).toEqual(settings.visuals);
});

test('device store migrates preferences once and never imports shared samples', () => {
  const storage = memoryStorage(), namespace = 'a'.repeat(32), s = { ...deviceDefaults(), performance: 'fast' as const, performanceDiagnostics: true, performancePrompted: true };
  const store = new DevicePerformanceStore(namespace, 'graph-ng', () => storage);
  const migrated = store.load({ ...s, performanceLog: [{ tier: 'low', mode: 'fast', notes: 99 }] });
  expect(migrated.settings).toEqual(s); expect(migrated.performanceLog).toEqual([]);
  store.save({ ...s, performance: 'quality' }, [{ tier: 'standard', mode: 'quality', notes: 7, path: 'Synthetic/ignored.md' }]);
  const reloaded = new DevicePerformanceStore(namespace, 'graph-ng', () => storage).load(s);
  expect(reloaded.settings.performance).toBe('quality'); expect(reloaded.performanceLog).toEqual([{ tier: 'standard', mode: 'quality', notes: 7 }]);
  expect(new DevicePerformanceStore('b'.repeat(32), 'graph-ng', () => storage).load(deviceDefaults()).settings.performance).toBe('auto');
  expect(new DevicePerformanceStore(namespace, 'other-plugin', () => storage).load(deviceDefaults()).settings.performance).toBe('auto');
  store.save({ ...s, performanceDiagnostics: false }, reloaded.performanceLog);
  expect(new DevicePerformanceStore(namespace, 'graph-ng', () => storage).load(s).performanceLog).toEqual([]);
});

test('missing, denied, corrupt and oversized local storage remain optional and allowlisted', () => {
  const namespace = 'c'.repeat(32), key = `graph-ng:graph-ng:${namespace}:performance:v1`;
  for (const access of [() => undefined, () => { throw Error('denied'); }, () => ({ getItem() { throw Error('read'); }, setItem() { throw Error('write'); } }), () => ({ getItem() { return null; }, setItem() { throw Error('quota'); } })]) {
    const store = new DevicePerformanceStore(namespace, 'graph-ng', access);
    expect(() => store.load(deviceDefaults())).not.toThrow(); expect(() => store.save({ ...deviceDefaults(), performance: 'fast' }, [])).not.toThrow();
  }
  const storage = memoryStorage();
  for (const bad of ['{', 'x'.repeat(16385), JSON.stringify({ version: 4 }), JSON.stringify({ version: 1, settings: { performance: 'invalid', performancePrompted: 'yes' }, performanceLog: ['bad'] })]) {
    storage.setItem(key, bad);
    const value = new DevicePerformanceStore(namespace, 'graph-ng', () => storage).load({ ...deviceDefaults(), performance: 'fast' });
    expect(value.settings).toEqual(deviceDefaults()); expect(value.performanceLog).toEqual([]);
  }
  let accessed = false;
  new DevicePerformanceStore(undefined, 'graph-ng', () => { accessed = true; return storage; }).load(deviceDefaults());
  expect(accessed).toBe(false);
});
function memoryStorage() {
  const rows = new Map<string, string>();
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
}
