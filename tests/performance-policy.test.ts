import { expect, test } from 'bun:test';
import './support/obsidian-fixture';
import { deviceTier, devicePerformance, PerformanceState, performanceRecords } from '../src/performance';
import { defaults, upgradeSettings, validateSettings } from '../src/settings';
import { lighterChoices, lighterSettings } from '../src/performance-ui';
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
test('lighter suggestions list only enabled work and change only checked choices', () => {
  const s = defaults('links'); s.performance = 'quality'; s.visuals.labelStyle = 'ranked'; s.visuals.curvedEdges = true; s.declaration.display.reifiedAsNodes = true;
  expect(lighterChoices(s).map(r => r[0])).toEqual(['labels', 'curves', 'motion', 'relationships']);
  const next = lighterSettings(s, new Set(['labels', 'relationships']));
  expect(next.visuals.labelStyle).toBe('anchored'); expect(next.declaration.display.reifiedAsNodes).toBe(false);
  expect(next.visuals.curvedEdges).toBe(true); expect(next.layout).toBe(s.layout); expect(s.visuals.labelStyle).toBe('ranked');
  const all = lighterSettings(s, new Set(['labels', 'curves', 'motion', 'relationships'])); expect(lighterChoices(all)).toEqual([]);
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

test('lighter checklist omits motion already suppressed by effective performance mode', () => {
  const s = defaults('links'), tier = devicePerformance.tier;
  try {
    s.performance = 'fast'; expect(lighterChoices(s).some(row => row[0] === 'motion')).toBe(false);
    s.performance = 'auto'; devicePerformance.tier = 'low'; expect(lighterChoices(s).some(row => row[0] === 'motion')).toBe(false);
    s.performance = 'quality'; expect(lighterChoices(s).some(row => row[0] === 'motion')).toBe(true);
  } finally { devicePerformance.tier = tier; }
});
