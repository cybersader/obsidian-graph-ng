import { test, expect } from 'bun:test';
import './support/obsidian-fixture';
import { defaults, settingsForSave, upgradeSettings, validateSettings } from '../src/settings';
import { graphStats, recommend, suggestionSettings, type GraphStats } from '../src/recommend';
import { ExplorePanel } from '../src/explore-panel';
import { DetailRenderer } from '../src/webgl-renderer';
import { emptyView } from '../src/core/explore';
import { ControlElement, control } from './support/controls-dom';
const { default: GraphPlugin } = await import('../src/main');
/** Synthetic CSR offsets from a degree list (no vault content). */
const offsets = (degrees: number[]) => { const o = new Uint32Array(degrees.length + 1); degrees.forEach((d, i) => { o[i + 1] = o[i]! + d; }); return o; };
const chain = (n: number) => graphStats(offsets(Array.from({ length: n }, (_, i) => i === 0 || i === n - 1 ? 1 : 2)), n - 1);
const dense = () => graphStats(offsets(new Array(30000).fill(14)), 210000);
const hub = () => graphStats(offsets([999, ...new Array(999).fill(1)]), 999, 600, 40);
const values = (s: GraphStats, settings = defaults('links')) => Object.fromEntries(recommend(s, settings).map(x => [x.key, x.value]));

test('small sparse graph: stronger edges, uniform sizes, more labels; no cost cuts', () => {
  expect(values(chain(50))).toEqual({ edgeOpacity: .6, degreeSizing: .6, labelDensity: 1.5 });
});
test('large dense graph: faint edges, fewer labels, glow and curves off', () => {
  const s = dense(); expect(s.averageDegree).toBe(14);
  expect(values(s)).toEqual({ edgeOpacity: .15, degreeSizing: .6, labelDensity: .5, glow: 0, curvedEdges: false });
});
test('hub-heavy graph: softer degree sizing; many groups and edge notes dimmed', () => {
  const s = hub(); expect(s.maxDegree).toBe(999); expect(s.hubRatio).toBeGreaterThan(25);
  expect(values(s)).toEqual({ degreeSizing: 1, carrierOpacity: .45 });
  const haloed = defaults('links'); haloed.visuals.groupHalos = true;
  expect(values(s, haloed).groupHalos).toBe(false);
  const moderate = graphStats(offsets([20, ...new Array(99).fill(2)]), 109);
  expect(values(moderate).degreeSizing).toBe(2.2);
});
test('deterministic, valid, never mutates, idempotent after applying, empty graph silent', () => {
  for (const stats of [chain(50), chain(3), dense(), hub(), graphStats(offsets([]), 0)]) {
    const settings = defaults('links'), before = structuredClone(settings), list = recommend(stats, settings);
    expect(recommend(stats, settings)).toEqual(list); expect(settings).toEqual(before);
    for (const item of list) expect(item.reason.length).toBeGreaterThan(0);
    const next = suggestionSettings(settings, list); validateSettings(next); expect(settings).toEqual(before);
    expect(upgradeSettings(settingsForSave(next), 'links')).toEqual(next);
    expect(recommend(stats, next)).toEqual([]);
  }
  expect(recommend(graphStats(offsets([]), 0), defaults('links'))).toEqual([]);
  // A hand-tuned value within 0.02 is not nagged about.
  const tuned = defaults('links'); tuned.visuals.edgeOpacity = .59; expect(values(chain(50), tuned).edgeOpacity).toBeUndefined();
  expect(() => suggestionSettings(defaults('links'), [{ key: 'glow', label: 'Glow', current: 0, value: 2, reason: 'x' }])).toThrow();
});

function fixture() {
  const plugin: any = new GraphPlugin(null as any, {} as any); plugin.settings = defaults('links');
  const writes: any[] = []; plugin.saveData = async (data: any) => { writes.push(structuredClone(data)); };
  const root = new ControlElement(), render = ExplorePanel.prototype.render; ExplorePanel.prototype.render = function () {};
  let panel: any, preview: any = 'none';
  const host: any = { settings: () => plugin.settings, suggestions: () => recommend(dense(), plugin.settings), previewSuggestions: (list: any) => { preview = list; }, applySuggestions: (list: any) => plugin.commitSuggestions(list, () => true) };
  try { panel = new ExplorePanel(root as any, host, emptyView()); } finally { ExplorePanel.prototype.render = render; }
  panel.render = () => { panel.body.empty(); panel.suggested(panel.body); }; panel.render();
  return { plugin, writes, panel, host, preview: () => preview };
}
test('card previews without saving, applies one or all through the acknowledged save path', async () => {
  const f = fixture(), before = structuredClone(f.plugin.settings), visuals = f.plugin.settings.visuals;
  expect(f.panel.body.textContent).toContain('Edge opacity: 0.4 → 0.15');
  control(f.panel.body, 'Preview suggestions').click(); expect(f.preview().length).toBe(5); expect(f.writes.length).toBe(0); expect(f.plugin.settings).toEqual(before);
  control(f.panel.body, 'End preview').click(); expect(f.preview()).toBeNull(); expect(f.writes.length).toBe(0);
  control(f.panel.body, 'Preview suggestions').click(); f.panel.endPreview(); expect(f.preview()).toBeNull(); expect(f.panel.suggestPreview).toBe(false);
  const one = f.panel.body.querySelectorAll('button').find((b: any) => b.getAttribute('aria-label') === 'Apply Glow');
  await one.onclick(); expect(f.writes.length).toBe(1); expect(f.writes[0].settings.visuals.glow).toBe(0);
  expect(f.plugin.settings.visuals.glow).toBe(0); expect(f.plugin.settings.visuals.edgeOpacity).toBe(.4); expect(f.plugin.settings.visuals).toBe(visuals);
  await (control(f.panel.body, 'Apply all and save') as any).onclick();
  expect(f.plugin.settings.labelDensity).toBe(.5); expect(f.plugin.settings.visuals.curvedEdges).toBe(false); expect(f.panel.suggestMessage).toBe('Saved');
  expect(f.panel.body.textContent).toContain('Settings already match.'); f.panel.dispose();
});
test('failed save leaves live settings untouched, restores storage and reports', async () => {
  const f = fixture(), before = structuredClone(f.plugin.settings); let calls = 0;
  f.plugin.saveData = async () => { if (++calls === 1) throw new Error('disk refused'); };
  await (control(f.panel.body, 'Apply all and save') as any).onclick();
  expect(f.plugin.settings).toEqual(before); expect(calls).toBe(2); expect(f.panel.suggestMessage).toContain('disk refused'); expect(f.panel.suggestBusy).toBe(false);
  await expect(f.plugin.commitSuggestions(recommend(dense(), f.plugin.settings), () => false)).rejects.toThrow('view changed'); expect(f.plugin.settings).toEqual(before);
  f.panel.dispose();
});
test('renderer preview swaps a candidate and restores the live settings object', () => {
  const live = defaults('links'), candidate = suggestionSettings(live, recommend(dense(), live)); let refreshed = 0;
  const r: any = { settings: live, refreshVisuals: () => { refreshed++; } };
  DetailRenderer.prototype.previewSettings.call(r, candidate); expect(r.settings).toBe(candidate);
  DetailRenderer.prototype.previewSettings.call(r, candidate); DetailRenderer.prototype.previewSettings.call(r, null);
  expect(r.settings).toBe(live); expect(refreshed).toBe(3);
  DetailRenderer.prototype.previewSettings.call(r, null); expect(r.settings).toBe(live);
});
test('group halos default off; an explicitly saved choice survives upgrade', () => {
  expect(defaults('links').visuals.groupHalos).toBe(false);
  const saved: any = settingsForSave(defaults('links')); saved.visuals.groupHalos = true;
  expect(upgradeSettings(saved, 'links').visuals.groupHalos).toBe(true);
  delete saved.visuals.groupHalos; expect(upgradeSettings(saved, 'links').visuals.groupHalos).toBe(false);
});
