import { placeLabels } from '../src/render-data';
import { test, expect } from 'bun:test';
import './support/obsidian-fixture';
import { defaults, upgradeSettings, settingsForSave, validateSettings, loadSettings } from '../src/settings';
import { baseRadius, sizedRadius, sizingSettings, sizingValues, MAX_NODE_RADIUS } from '../src/node-sizing';
import { degreeSizes, densityScale } from '../src/render-effects';
import { ExplorePanel } from '../src/explore-panel';
import { emptyView } from '../src/core/explore';
import { ControlElement, control } from './support/controls-dom';
import { readFileSync } from 'node:fs';
const { default: GraphPlugin } = await import('../src/main');
const values = { radius: 6, prominence: 5, compensation: 1, floor: .3, curve: 'sqrt' as const };
test('legacy and new installations retain defaults until explicit adoption; loading never writes', async () => {
  const fresh = defaults('links'); expect(fresh.nodeSizing.policy).toBe('legacy'); expect(fresh.nodeSize).toBe(3);
  const old: any = structuredClone(fresh); delete old.nodeSizing; const before = JSON.stringify(old);
  validateSettings(old); const upgraded = upgradeSettings(old, 'links'); expect(upgraded.nodeSizing.policy).toBe('legacy'); expect(JSON.stringify(old)).toBe(before);
  const disk: any = { stat: async () => ({ size: before.length + 20 }), read: async () => JSON.stringify({ settings: old }), copy: async () => { throw new Error('must not copy'); } };
  expect((await loadSettings(disk, 'synthetic-settings', 'links', () => {})).settings.nodeSizing.policy).toBe('legacy');
  for (const canvas of [false, true]) expect(baseRadius(fresh, 800, 600, 60000, 1, canvas)).toBe(fresh.nodeSize * (canvas ? 1 : densityScale(800, 600, 60000, 1, 3)));
});
test('predictable radius linear in requested CSS px independently of zoom and density; renderer parity', () => {
  const s = sizingSettings(defaults('links'), values);
  for (const n of [0, 1, 60000, 1000000]) for (const z of [.01, 1, 20]) {
    const b = baseRadius(s, 800, 600, n, z);
    expect(baseRadius({ ...s, nodeSize: 12 }, 800, 600, n, z)).toBeCloseTo(b * 2, 10);
    expect(baseRadius(s, 800, 600, n, z, true)).toBe(b);
    expect(b).toBeGreaterThanOrEqual(6 * .3); expect(b).toBeLessThanOrEqual(6);
  }
});
test('compensation off, full retention, isolates, degree ordering and carrier/highlight units', () => {
  for (const override of [{ compensation: 0 }, { floor: 1 }]) { const s = sizingSettings(defaults('links'), { ...values, ...override }); expect(baseRadius(s, 1, 1, 1000000, 100)).toBe(6); }
  expect([...degreeSizes(new Uint32Array([0, 0, 0]), 8)]).toEqual([1, 1]);
  const offsets = new Uint32Array([0, 0, 1, 11]); const a = degreeSizes(offsets, 1), b = degreeSizes(offsets, 8);
  expect(b[0]).toBe(1); expect(b[2]).toBe(9); expect(b[2]).toBeGreaterThan(b[1]!); expect(b[1]).toBeGreaterThan(a[1]!);
  expect(sizedRadius(2, 5, .6, true)).toBe(8);
});
test('invalid input is atomic, finite bounds and persisted schema roundtrip', () => {
  const s = defaults('links'), before = structuredClone(s);
  for (const [key, bad] of [['radius', 0], ['radius', NaN], ['radius', Infinity], ['prominence', 0], ['prominence', 10], ['floor', 0], ['floor', 1.01], ['compensation', -1], ['compensation', Infinity]] as const) expect(() => sizingSettings(s, { ...values, [key]: bad })).toThrow();
  const next = sizingSettings(s, values); expect(s).toEqual(before); expect(upgradeSettings(settingsForSave(next), 'links').nodeSizing).toEqual(next.nodeSizing);
  expect(() => validateSettings({ ...next, nodeSizing: { ...next.nodeSizing, extra: 1 } })).toThrow();
});
function runtime() { const plugin: any = new GraphPlugin(null as any, {} as any); plugin.settings = defaults('links'); const writes: any[] = []; plugin.saveData = async (data: any) => { writes.push(structuredClone(data)); }; return { plugin, writes }; }
test('apply commits only acknowledged values; cancellation and failure preserve last saved sizing', async () => {
  const f = runtime(), before = structuredClone(f.plugin.settings); let release!: () => void;
  f.plugin.saveData = async (data: any) => { f.writes.push(structuredClone(data)); await new Promise<void>(r => { release = r; }); };
  const pending = f.plugin.commitSizing(values, () => true); await Promise.resolve(); await Promise.resolve();
  expect(f.plugin.settings).toEqual(before); release(); await pending; expect(f.plugin.settings.nodeSizing.policy).toBe('predictable');
  const failed = runtime(); let calls = 0; failed.plugin.saveData = async () => { if (++calls === 1) throw new Error('disk refused'); };
  await expect(failed.plugin.commitSizing(values, () => true)).rejects.toThrow('disk refused'); expect(failed.plugin.settings).toEqual(before); expect(calls).toBe(2);
  await expect(failed.plugin.commitSizing(values, () => false)).rejects.toThrow('view changed'); expect(failed.plugin.settings).toEqual(before);
});
test('stale save restores latest settings and preserves unrelated concurrent edits', async () => {
  const f = runtime(); let current = true; f.plugin.saveData = async (data: any) => { f.writes.push(structuredClone(data)); if (f.writes.length === 1) { f.plugin.settings.visuals.glow = .123; current = false; } };
  await expect(f.plugin.commitSizing(values, () => current)).rejects.toThrow('changed');
  expect(f.plugin.settings.nodeSizing.policy).toBe('legacy'); expect(f.writes[1].settings.visuals.glow).toBe(.123);
});
test('a live edit made while a candidate save is pending wins over the stale candidate and is then persisted', async () => {
  for (const kind of ['sizing', 'suggestion'] as const) {
    const f = runtime(); let release!: () => void;
    f.plugin.saveData = async (data: any) => { f.writes.push(structuredClone(data)); if (f.writes.length === 1) await new Promise<void>(r => { release = r; }); };
    const pending = kind === 'sizing' ? f.plugin.commitSizing(values, () => true)
      : f.plugin.commitSuggestions([{ key: 'edgeOpacity', label: 'e', current: .4, value: .2, reason: 'r' }, { key: 'glow', label: 'g', current: .3, value: .1, reason: 'r' }], () => true);
    await Promise.resolve(); await Promise.resolve();
    // The user moves a live Appearance slider for one touched key while the save is pending.
    if (kind === 'sizing') f.plugin.settings.visuals.degreeSizing = 7.5; else f.plugin.settings.visuals.edgeOpacity = .9;
    release(); await pending;
    const v = f.plugin.settings.visuals, last = f.writes.at(-1).settings.visuals;
    if (kind === 'sizing') { expect(v.degreeSizing).toBe(7.5); expect(last.degreeSizing).toBe(7.5); expect(f.plugin.settings.nodeSizing.policy).toBe('predictable'); expect(v.degreeCurve).toBe('sqrt'); }
    else { expect(v.edgeOpacity).toBe(.9); expect(last.edgeOpacity).toBe(.9); expect(v.glow).toBe(.1); expect(last.glow).toBe(.1); }
    expect(f.writes.length).toBe(2);
  }
});
function panelFixture() {
  const f = runtime(), root = new ControlElement(); const render = ExplorePanel.prototype.render; ExplorePanel.prototype.render = function () {};
  let panel: any, preview: any = null;
  const host: any = { settings: () => f.plugin.settings, previewSizing: (v: any) => { preview = v; }, applySizing: (v: any) => f.plugin.commitSizing(v, () => true), sizingReadout: () => 'synthetic readout' };
  try { panel = new ExplorePanel(root as any, host, emptyView()); } finally { ExplorePanel.prototype.render = render; }
  panel.render = () => { panel.body.empty(); panel.nodes(panel.body); }; panel.render();
  const input = (label: string, value: string) => { const e: any = panel.body.querySelectorAll('input').find((e: any) => e.getAttribute('aria-label') === label); e.value = value; e.oninput(); };
  return { ...f, panel, host, input, preview: () => preview };
}
test('numeric drafts preview/apply/cancel, invalid blank never reaches renderer or persistence', async () => {
  const f = panelFixture(), before = structuredClone(f.plugin.settings);
  f.input('Base node radius', ''); control(f.panel.body, 'Preview sizing').click(); expect(f.preview()).toBeNull(); expect(f.writes.length).toBe(0);
  f.input('Base node radius', '12'); control(f.panel.body, 'Preview sizing').click(); expect(f.preview().radius).toBe(12); expect(f.plugin.settings).toEqual(before);
  control(f.panel.body, 'Restore saved sizing').click(); expect(f.preview()).toBeNull(); expect(f.writes.length).toBe(0);
  f.input('Maximum degree prominence', '9'); await (control(f.panel.body, 'Apply and save sizing') as any).onclick(); expect(f.plugin.settings.visuals.degreeSizing).toBe(8); expect(f.panel.sizingMessage).toBe('Saved'); f.panel.dispose();
});
test('shared rendering source contract keeps appearance out of layout and uses dynamic label offsets', () => {
  const renderer = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
  expect(renderer).toContain('const nodeSize = this.baseNodeRadius()'); expect(renderer).toContain('r = this.nodeRadius(n, hot) * grow'); expect(renderer).toContain('ctx.arc(x(n), y(n), r, 0');
  expect(renderer).toContain('extra.z * nodeSize'); expect(renderer).toContain('this.nodeRadius(node, node === this.selected');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'); const body = main.split('commitSizing(values:')[1]!.split('private saveTimer')[0]!;
  expect(body).not.toContain('pipeline'); expect(body).not.toContain('positions'); expect(body).not.toContain('camera');
});


test('label shader uses shared nodeSize uniform once and loading has no settings rewrite', () => {
  const renderer = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
  const common = renderer.split('const common = glsl`')[1]!.split('`;')[0]!;
  const label = renderer.split('const labelVertex = common + glsl`')[1]!.split('`;')[0]!;
  expect(((common + label).match(/uniform float nodeSize;/g) ?? []).length).toBe(1);
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  expect(main.split('async onload()')[1]!.split('propertySource?:')[0]).not.toContain('this.save()');
});

test('UI save failure clears preview and exposes error without applying drafts', async () => {
  const f = panelFixture(), before = structuredClone(f.plugin.settings);
  f.input('Base node radius', '8'); control(f.panel.body, 'Preview sizing').click();
  f.host.applySizing = async () => { throw new Error('storage unavailable'); };
  await (control(f.panel.body, 'Apply and save sizing') as any).onclick();
  expect(f.preview()).toBeNull(); expect(f.plugin.settings).toEqual(before); expect(f.panel.sizingMessage).toContain('storage unavailable'); expect(f.panel.sizingBusy).toBe(false); f.panel.dispose();
});


test('Repair R1 rejects unsupported finite radii before preview or persistence', async () => {
  const f = panelFixture(), before = structuredClone(f.plugin.settings);
  for (const value of [1e20, Number.MAX_VALUE, MAX_NODE_RADIUS + 1, MAX_NODE_RADIUS * (1 + Number.EPSILON)]) {
    expect(() => sizingSettings(f.plugin.settings, { ...values, radius: value })).toThrow('binary32');
    f.input('Base node radius', String(value)); control(f.panel.body, 'Preview sizing').click();
    expect(f.preview()).toBeNull(); await (control(f.panel.body, 'Apply and save sizing') as any).onclick();
    expect(f.writes.length).toBe(0); expect(f.plugin.settings).toEqual(before);
  }
  const edge = sizingSettings(f.plugin.settings, { ...values, radius: MAX_NODE_RADIUS, prominence: 9 }); edge.visuals.carrierSize = 4; validateSettings(edge);
  expect((MAX_NODE_RADIUS * 9 * 4 + 2) * 2.3).toBeLessThan(2 ** 24);
  expect(upgradeSettings(settingsForSave(edge), 'links').nodeSize).toBe(MAX_NODE_RADIUS); f.panel.dispose();
});

test('Repair R1 label placement fails fast at overflow and unsafe integer coordinates', () => {
  const box = { node: 0, x: 0, y: 0, w: 7, h: 7 };
  for (const patch of [{ x: 1e20 }, { x: Infinity }, { x: Number.MAX_VALUE, w: Number.MAX_VALUE }, { y: Number.MIN_SAFE_INTEGER * 200 }, { w: -1 }]) expect(() => placeLabels([{ ...box, ...patch }], 100, 400)).toThrow('LABEL_GEOMETRY_RANGE');
  for (const cell of [0, -1, Number.MIN_VALUE, Infinity, NaN]) expect(() => placeLabels([{ ...box, x: 1 }], cell, 400)).toThrow('LABEL_GEOMETRY_RANGE');
  // Boundary cells use bounded offsets, never x++ at a large coordinate.
  expect(placeLabels([{ ...box, x: Number.MAX_SAFE_INTEGER - 16 }], 1, 400).length).toBe(1);
  expect(placeLabels([{ ...box, x: Number.MAX_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER, w: 0, h: 0 }], 1, 400).length).toBe(1);
});

test('Repair R1 wide label spans use bounded exact overlap fallback, no spatial traversal', () => {
  const boxes = [
    { node: 0, x: 0, y: 0, w: 1e12, h: 1e12 },
    { node: 1, x: 2, y: 2, w: 1, h: 1 },
    { node: 2, x: 2e12, y: 2e12, w: 1, h: 1 },
  ];
  expect(placeLabels(boxes, .001, 400).map(b => b.node)).toEqual([0, 2]);
  expect(placeLabels(boxes.slice().reverse(), .001, 400).map(b => b.node)).toEqual([2, 1]);
});


test('Repair R2 existing Relationship-note size slider dispatches the covered live refresh path', () => {
  const f = panelFixture(), calls: boolean[] = [];
  f.host.carriers = () => 1; f.host.policy = () => []; f.host.visualsChanged = (labels: boolean) => calls.push(labels);
  f.panel.body.empty(); f.panel.display(f.panel.body);
  const row = f.panel.body.querySelectorAll('.graph-ng-slider').find((row: any) => row.children.some((child: any) => child.textContent === 'Relationship-note size'));
  expect(row).toBeDefined(); const input: any = row.querySelectorAll('input').find((e: any) => e.type === 'number'); input.value = '2'; input.oninput();
  expect(f.plugin.settings.visuals.carrierSize).toBe(2); expect(calls).toEqual([false]); f.panel.dispose();
});

// Star-heavy synthetic degree list: many leaves, some mid nodes, one hub (CSR offsets).
const csr = (degrees: number[]) => { const o = new Uint32Array(degrees.length + 1); degrees.forEach((d, i) => { o[i + 1] = o[i]! + d; }); return o; };
const skewed = csr([0, 1, 1, 1, 2, 3, 10, 40, 200, 2000]);
test('degree curves: area-proportional linear/sqrt/log, legacy radius-log, all within [1, 1 + scale]', () => {
  for (const curve of ['linear', 'sqrt', 'log', 'legacy'] as const) {
    const s = degreeSizes(skewed, 4, curve);
    expect(s[0]).toBe(1); expect(s[9]).toBeCloseTo(5, 5);
    for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThanOrEqual(s[i - 1]!);
  }
  const area = (curve: 'linear' | 'sqrt' | 'log', i: number) => degreeSizes(skewed, 4, curve)[i]! ** 2 - 1;
  // Area above a degree-0 node is proportional to f(degree) / f(max).
  expect(area('linear', 7) / area('linear', 9)).toBeCloseTo(40 / 2000, 5);
  expect(area('sqrt', 7) / area('sqrt', 9)).toBeCloseTo(Math.sqrt(40 / 2000), 5);
  expect(area('log', 7) / area('log', 9)).toBeCloseTo(Math.log2(41) / Math.log2(2001), 5);
  expect([...degreeSizes(skewed, 0, 'sqrt')].every(x => x === 1)).toBe(true);
  expect([...degreeSizes(new Uint32Array([0, 0, 0]), 8, 'sqrt')]).toEqual([1, 1]);
});
test('default curve makes hubs measurably larger than leaves; single-degree nodes stay near the base radius', () => {
  const v = defaults('links').visuals; expect(v.degreeCurve).toBe('sqrt');
  const now = degreeSizes(skewed, v.degreeSizing, v.degreeCurve), before = degreeSizes(skewed, 1.6, 'legacy');
  expect(now[1]).toBeGreaterThanOrEqual(1); expect(now[1]).toBeLessThan(1.25);
  expect(now[9]! / now[1]!).toBeGreaterThan(4); expect(now[9]! / now[1]!).toBeGreaterThan(before[9]! / before[1]! * 1.5);
  expect(now[8]! ** 2 / now[6]! ** 2).toBeGreaterThan(2);
});
test('saved settings without a degree curve keep the earlier appearance; curve round-trips through apply', () => {
  const fresh = defaults('links'), old: any = structuredClone(fresh); delete old.visuals.degreeCurve; old.visuals.degreeSizing = 1.6;
  const up = upgradeSettings(old, 'links'); expect(up.visuals.degreeCurve).toBe('legacy'); expect(up.visuals.degreeSizing).toBe(1.6);
  const partial: any = structuredClone(fresh); partial.visuals = { glow: .2 }; expect(upgradeSettings(partial, 'links').visuals).toMatchObject({ degreeCurve: 'legacy', degreeSizing: 1.6, glow: .2 });
  // Saved settings with no visuals block at all are legacy too; only a fresh install (defaults()) adopts the new curve.
  expect(upgradeSettings({}, 'links').visuals).toMatchObject({ degreeCurve: 'legacy', degreeSizing: 1.6 }); expect(defaults('links').visuals).toMatchObject({ degreeCurve: 'sqrt', degreeSizing: 4 });
  expect(() => validateSettings({ ...fresh, visuals: { ...fresh.visuals, degreeCurve: 'cubic' } as any })).toThrow('degreeCurve');
  const next = sizingSettings(up, { ...values, curve: 'linear' }); expect(sizingValues(next).curve).toBe('linear');
  expect(upgradeSettings(settingsForSave(next), 'links').visuals.degreeCurve).toBe('linear');
});
test('curve selector drafts, previews and applies the curve explicitly', async () => {
  const f = panelFixture(); const select: any = f.panel.body.querySelectorAll('select').find((e: any) => e.getAttribute('aria-label') === 'Degree curve');
  expect(select.value).toBe('sqrt'); select.value = 'log'; select.onchange(); expect(f.preview()).toBeNull(); expect(f.writes.length).toBe(0);
  control(f.panel.body, 'Preview sizing').click(); expect(f.preview().curve).toBe('log'); expect(f.plugin.settings.visuals.degreeCurve).toBe('sqrt');
  await (control(f.panel.body, 'Apply and save sizing') as any).onclick(); expect(f.plugin.settings.visuals.degreeCurve).toBe('log'); f.panel.dispose();
});
