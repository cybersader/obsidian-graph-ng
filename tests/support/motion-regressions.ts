import { test, expect } from 'bun:test';
import { defaults, upgradeSettings, validateSettings } from '../../src/settings';
import { buildProjection } from '../../src/core/projection';
import { defaultDeclaration } from '../../src/core/declaration';
import { renderProjection } from '../../src/render-projection';
import { LayoutPreview } from '../../src/layout-preview';
import { performanceRenderer } from './performance-renderer';

test('motion defaults, upgrades and validates without changing layout settings', () => {
  const settings = defaults('fixture'), old: any = structuredClone(settings); delete old.visuals.motion;
  expect(settings.visuals.motion).toBe('full'); expect(upgradeSettings(old, 'fixture').visuals.motion).toBe('full');
  for (const motion of ['full', 'reduced', 'off'] as const) {
    const next = { ...settings, visuals: { ...settings.visuals, motion } }; validateSettings(next);
    expect(upgradeSettings(next, 'fixture').visuals.motion).toBe(motion); expect(next.layout).toEqual(settings.layout);
  }
  expect(() => validateSettings({ ...settings, visuals: { ...settings.visuals, motion: 'always' } })).toThrow('visuals.motion');
});

test('compiled WebGL and Canvas motion settles to zero queued frames, interrupts and follows live OS reduction', async () => {
  const d = defaultDeclaration('fixture'); d.edges = [{ name: 'link', kind: 'inline', key: 'to', type: 'link' }];
  const p = renderProjection(buildProjection([{ path: 'A.md', properties: { to: 'B.md' } }, { path: 'B.md', properties: {} }, { path: 'C.md', properties: {} }], d));
  for (const gpu of [false, true]) {
    let now = 1000; const h = performanceRenderer(gpu, { now: () => now, reduced: false }), k = h.key, settings = defaults('fixture'); let r: any;
    try {
      r = await h.Renderer.create(h.stage, p, new Float32Array([0, 0, 100, 0, 0, 100]), new Uint8Array(3).fill(1), settings, () => {}, () => {}, new Uint32Array(3), () => true, !gpu);
      expect(r.canvas.style.visibility).toBe(''); expect(h.calls()).toBeGreaterThan(0);
      const settle = () => { let frames = 0; while (h.pendingFrames() && frames < 200) { now += 16; h.frame(); frames++; } expect(h.pendingFrames()).toBe(0); return frames; };
      settle();
      r.selected = 0; r[k('hovered')] = 0; r[k('emphasize')](); r.refresh();
      const uploads = h.uploads(), frames = settle(); expect(frames).toBeGreaterThan(120); expect(frames).toBeLessThan(140);
      expect(h.uploads()).toBe(uploads); expect(r[k('fx')]).toEqual([1.6, .5]); expect(h.frame()).toBe(false);
      now += 60000; expect(h.pendingFrames()).toBe(0);
      r.selected = -1; r[k('hovered')] = -1; r[k('emphasize')](); r.refresh(); settle(); expect(r[k('focusLevel')]).toBe(0);
      r.selected = 0; r[k('hovered')] = 0; r[k('emphasize')](); r.refresh(); now += 55; h.frame();
      expect(r[k('focusLevel')]).toBeCloseTo(.0625, 8);
      r.selected = -1; r[k('hovered')] = -1; r[k('emphasize')](); r.refresh(); settle(); expect(r[k('focusLevel')]).toBe(0);
      r.flyTo(.2, .3, .5, 400); now += 100; h.frame(); r.setCamera(.7, .6, .8); settle();
      expect(r.camera).toEqual({ x: .7, y: .6, ratio: .8 });
      r.flyTo(.1, .2, .4, 400); r.selected = 0; r[k('hovered')] = 0; r[k('emphasize')](); r[k('setLens')](0); r[k('startRipple')](0);
      h.reduce(true); h.frame(); expect(h.pendingFrames()).toBe(0); expect(r.camera).toEqual({ x: .1, y: .2, ratio: .4 });
      expect(r[k('focusLevel')]).toBe(1); expect(r[k('lensBlend')]).toBe(1); expect(r[k('ripple')]).toBeUndefined();
      expect(r[k('fx')]).toEqual([1.6, .5]); h.reduce(false); settle();
      for (const mode of ['reduced', 'off'] as const) {
        settings.visuals.motion = mode; r.flyTo(.4, .5, .6); r[k('setLens')](-1); r.refresh(); h.frame();
        expect(r.camera).toEqual({ x: .4, y: .5, ratio: .6 }); expect(h.pendingFrames()).toBe(0);
      }
    } finally { h.dispose(r); }
    expect(h.pendingFrames()).toBe(0); expect(h.motionListeners()).toBe(0);
  }
});

test('finished layout holds painted preview until replacement and recycles late streams once', async () => {
  const first = new Float32Array(2), late = new Float32Array(2), recycled: Float32Array[] = []; let disposed = 0;
  const preview = new LayoutPreview(async positions => ({ positions, streamPositions() { throw Error('stream after finish'); }, dispose() { disposed++; } }), p => recycled.push(p), () => true, e => { throw e; });
  preview.push(first); await new Promise(resolve => setTimeout(resolve, 0));
  await preview.finish(true); expect(disposed).toBe(0); expect(recycled).toEqual([]);
  preview.push(late); expect(recycled).toEqual([late]);
  await preview.finish(); await preview.finish(); expect(disposed).toBe(1); expect(recycled).toEqual([late, first]);
});
