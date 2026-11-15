import { test, expect, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { defaults } from '../src/settings';
import { encodeStrings } from '../src/core/columns';
import { ControlElement } from './support/controls-dom';
import { focusTiers, incidentEdges } from '../src/render-data';

// Actual production classes; the DOM/driver seam does not establish native rendering/performance.
const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const rendererName = source.match(/this\.detailRenderer=await ([\w$]+)\.create\(this\.stage/)?.[1];
if (!rendererName) throw new Error('Production renderer seam missing: build before tests');
const ctx: any = new Proxy({ fillStyle: '#ffffff', measureText: (s: string) => ({ width: s.length * 7 }), getImageData: () => ({ data: new Uint8ClampedArray([80, 90, 100, 255]) }) }, { get: (o: any, k: any) => k in o ? o[k] : () => {} });
class Element extends ControlElement {
  style: any = {}; width = 0; height = 0; clientWidth = 800; clientHeight = 600; title = '';
  append(...nodes: any[]) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node: any) { node.parent = this; this.children.push(node); return node; }
  getContext(kind: string) { return kind === '2d' ? ctx : null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  addEventListener() {} removeEventListener() {}
  setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; }
  createDiv(options: any = {}) { const e = new Element(); e.className = options.cls; return this.appendChild(e); }
  className = '';
}
const document = { createElement: (tag: string) => new Element(tag.toUpperCase()), documentElement: { style: {} } };
// These are upload/transaction fixtures, not complete GL drawing programs. Own both
// frame clocks explicitly; ordinary save/timeout work still uses real timers.
const renderers: any[] = [];
const frameCallbacks = new Map<number, (...args: any[]) => void>();
const backstops = new Map<number, () => void>();
let nextFrame = 1, nextBackstop = -1;
const requestFrame = (callback: (...args: any[]) => void) => { const id = nextFrame++; frameCallbacks.set(id, callback); return id; };
const cancelFrame = (id: number) => { frameCallbacks.delete(id); };
const fixtureTimeout = (callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
  if ([...frameCallbacks.values()].includes(callback)) {
    const id = nextBackstop--; backstops.set(id, () => callback(...args)); return id;
  }
  return setTimeout(callback, delay, ...args);
};
const clearFixtureTimeout = (id: ReturnType<typeof setTimeout> | number | undefined) => {
  if (typeof id === 'number' && backstops.delete(id)) return;
  clearTimeout(id);
};
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  expect(frameCallbacks.size).toBe(0);
  expect(backstops.size).toBe(0);
});
const rendererWindow = { devicePixelRatio: 1 };
const module = { exports: {} as any };
const obsidian = { ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, apiVersion: 'synthetic', Notice: class {} };
vm.runInNewContext(source + `\n;module.exports.__renderer=${rendererName};`, { module, exports: module.exports, require: () => obsidian, console, structuredClone, setTimeout: fixtureTimeout, clearTimeout: clearFixtureTimeout, performance, TextEncoder, TextDecoder, MessageChannel, document, window: rendererWindow, devicePixelRatio: 1, getComputedStyle: () => ({ getPropertyValue: () => '' }), matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }), ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame }, { filename: 'production-main.js' });
const GraphPlugin = module.exports.default, GraphView = module.exports.GraphView, Renderer = module.exports.__renderer;
const mangle = JSON.parse(readFileSync(new URL('../.workspace/evidence/main-mangle-cache.json', import.meta.url), 'utf8'));
const compiled = (name: string) => { const key = mangle[name]; if (typeof key !== 'string') throw new Error(`Production mapping missing: ${name}`); return key; };
const scopeProperty = compiled('detailScope');
const prepare = (renderer: any, next: Float32Array, current: () => boolean) => renderer[compiled('preparePositions')](next, current);
const values = { scalingRatio: 8, gravity: 0, slowDown: 3 };
const outcome = (p: Promise<unknown>) => p.then(() => 'success', e => String(e));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function projection(n = 3) { return { nodeCount: n, paths: encodeStrings(Array.from({ length: n }, (_, i) => `${i}.md`)), offsets: new Uint32Array(n + 1), source: new Uint32Array(), target: new Uint32Array(), type: new Uint32Array(), types: [], quarantined: [], carrierNodes: new Uint8Array(n), carrier: new Uint32Array(), groups: [] }; }
async function fixture(renderView: any = {}) {
  const plugin: any = new GraphPlugin(); plugin.settings = defaults('links');
  const writes: any[] = []; plugin.saveData = async (data: any) => { writes.push(structuredClone(data)); };
  let requests = 0;
  const next = new Float32Array([80, 90, 82, 92, 300, 400]);
  plugin.pipeline = { request: async (_revision: number, request: any) => { expect(request.kind).toBe('recompute'); requests++; return { positions: next, milliseconds: 1, cached: false }; } };
  const view: any = new GraphView(null, plugin), stage = new Element(), p = projection(), visible = new Uint8Array([1, 1, 1]), positions = new Float32Array([0, 0, 2, 2, 100, 100]);
  const renderer = await Renderer.create(stage, p, positions, visible, plugin.settings, () => {}, () => {}, new Uint32Array(3), () => true, true, () => {}, renderView);
  renderers.push(renderer);
  Object.assign(view, { activeRevision: 7, detailGeneration: 7, projection: p, positions, visible, colors: new Uint32Array(3), contentEl: { dataset: { mode: 'nodes' } }, stage, detailRenderer: renderer, renderer });
  renderer.camera = { x: .25, y: .4, ratio: 2 }; renderer.selected = 2;
  return { plugin, view, stage, renderer, writes, next, positions, requests: () => requests };
}
function driver(r: any) {
  let error = 0, lost = false, mode = '', allocations = 0;
  const calls: any[] = [];
  const gl: any = new Proxy({ NO_ERROR: 0, isContextLost: () => lost, getError: () => { const e = error; error = 0; return e; }, createBuffer: () => { allocations++; return {}; }, createVertexArray: () => { allocations++; return {}; }, texSubImage2D: (...args: any[]) => { calls.push(['sub', ...args]); if (args.length === 9) { if (mode === 'once') { error = 1282; mode = ''; } if (mode === 'lost') lost = true; if (mode === 'throw') throw new Error('driver upload failed'); } }, bufferData: (...args: any[]) => calls.push(['buffer', ...args]), texImage2D: (...args: any[]) => calls.push(['image', ...args]) }, { get: (o: any, k: string) => k in o ? o[k] : k.toUpperCase() === k ? 1 : () => {} });
  r.gl = gl;
  // Exact final esbuild mapping, never constructor/method-body text guessing.
  const labelUpload = compiled('uploadLabels');
  if (typeof r[labelUpload] !== 'function') throw new Error('Compiled label uploader missing');
  r[labelUpload](); allocations = 0; calls.length = 0;
  return { gl, calls, allocations: () => allocations, fail: (s: string) => { mode = s; } };
}
function retained(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.view.positions).toBe(f.positions); expect(f.renderer.positions).toBe(f.positions); expect(f.view.detailRenderer).toBe(f.renderer);
  expect(f.plugin.settings.layout.force.scalingRatio).toBe(2);
}

test('production software Apply preserves renderer/canvas/camera/frame/selection and changes picking once', async () => {
  const f = await fixture(), canvas = f.renderer.canvas, frame = f.renderer[compiled('cameraFrame')], camera = { ...f.renderer.camera }, center = [f.renderer.centerX, f.renderer.centerY, f.renderer.scale];
  const atlas = f.renderer.atlas;
  f.renderer.fitAll = () => { throw new Error('Hidden Fit'); };
  Renderer.create = new Proxy(Renderer.create, { apply() { throw new Error('Renderer reconstructed'); } });
  try { await f.view.applyLayout(values); } finally { Renderer.create = originalFactory; }
  expect(f.view.detailRenderer).toBe(f.renderer); expect(f.renderer.canvas).toBe(canvas); expect(f.renderer[compiled('cameraFrame')]).toBe(frame); expect(f.renderer.camera).toEqual(camera); expect([f.renderer.centerX, f.renderer.centerY, f.renderer.scale]).toEqual(center);
  expect(f.renderer.selected).toBe(2); expect(f.renderer.grid.pick(80, 90, .1)).toBe(0); expect(f.renderer.grid.pick(0, 0, .1)).toBe(-1);
  expect(f.renderer.positions).toBe(f.next); expect(f.renderer.atlas).not.toBe(atlas); expect(f.view.contentEl.dataset.mode).toBe('nodes'); expect(f.requests()).toBe(1); expect(f.writes.length).toBe(1);
});
const onScreen = (r: any, ids: number[]) => ids.map(i => r.screenPoint(i)).every(p => p.x >= 0 && p.x <= r.width && p.y >= 0 && p.y <= r.height);
test('batch 4 L3 Fit graph frames current coordinates of a small set after Apply without replacing the camera frame', async () => {
  const f = await fixture(); await f.view.applyLayout(values); const frame = f.renderer[compiled('cameraFrame')];
  f.renderer.fitAll(0); expect(onScreen(f.renderer, [0, 1, 2])).toBe(true); expect(f.renderer[compiled('cameraFrame')]).toBe(frame);
});
test('batch 4 L3 adjacent: Fit graph after filtering to nodes outside the construction frame shows them', async () => {
  const f = await fixture(), r = await Renderer.create(f.stage, f.view.projection, f.positions, new Uint8Array([1, 1, 0]), f.plugin.settings, () => {}, () => {}, new Uint32Array(3), () => true, true, () => {}, {});
  renderers.push(r); r.setView(new Uint8Array([0, 0, 1]), {}); r.fitAll(0); expect(onScreen(r, [2])).toBe(true);
});
const originalFactory = Renderer.create;

test('production same-context upload reuses position/atlas textures, buffers and programs', async () => {
  const f = await fixture(), d = driver(f.renderer), canvas = f.renderer.canvas, programs = f.renderer[compiled('programs')], gl = f.renderer.gl;
  await f.view.applyLayout(values);
  expect(f.renderer.gl).toBe(gl); expect(f.renderer.canvas).toBe(canvas); expect(Array.isArray(programs)).toBe(true); expect(f.renderer[compiled('programs')]).toBe(programs); expect(d.allocations()).toBe(0);
  expect(d.calls.filter(c => c[0] === 'sub').length).toBe(2); expect(d.calls.filter(c => c[0] === 'image').length).toBe(0); expect(f.requests()).toBe(1);
});

test('production collapsed geometry/picker/group framing/discs and label collisions follow new coordinates', async () => {
  const f = await fixture({ groupCodes: new Uint32Array([0, 0, 1]), groupLabels: ['one', 'two'], collapsed: new Uint8Array([1, 0]) });
  expect(f.renderer.hubs[0].x).toBe(1);
  await f.view.applyLayout(values);
  expect(f.renderer.hubs[0].x).toBe(81); expect(f.renderer.hubs[0].y).toBe(91); expect(f.renderer.display[0]).toBe(81); expect(f.renderer.display[2]).toBe(81);
  expect(f.renderer.visible[0]).toBe(0); expect(f.renderer.coordinateState(f.next, f.view.visible, {}).picker.pick(80, 90, .1)).toBe(0);
  expect(f.renderer.atlas.nodes.every((nodes: Uint32Array) => !nodes.includes(0) && !nodes.includes(1))).toBe(true);
  let target: any; f.renderer.flyTo = (...args: any[]) => { target = args; }; f.renderer.frameGroup(0); expect(target).toBeDefined();
});

test('production failed save/compensation retains CPU/display state, reports disk uncertainty, later Apply succeeds', async () => {
  const f = await fixture(), display = f.renderer.display; let count = 0;
  f.plugin.saveData = async () => { if (++count === 1) throw new Error('disk write failed'); };
  expect(await outcome(f.view.applyLayout(values))).toContain('disk write failed'); retained(f); expect(f.renderer.display).toBe(display);
  f.plugin.saveData = async () => { throw new Error('disk unavailable'); };
  const error = await outcome(f.view.applyLayout(values)); expect(error).toContain('restoring saved settings also failed'); expect(error).toContain('recovery uncertain'); retained(f);
  f.plugin.saveData = async () => {}; await f.view.applyLayout(values); expect(f.renderer.positions).toBe(f.next);
});

test('production actual CPU preparation validates every coordinate, rejects stale viewport/theme/view/disposal', async () => {
  for (const next of [new Float32Array([1, 2]), new Float32Array([1, 2, 3, 4, NaN, 6]), new Float32Array([1, 2, 3, 4, 5, Infinity])]) {
    const f = await fixture(); expect(await outcome(prepare(f.renderer, next, () => true))).not.toBe('success'); retained(f);
  }
  for (const mode of ['resize', 'labels', 'theme', 'view', 'disposed', 'scope']) {
    const f = await fixture(), entered = deferred(), release = deferred(); let count = 0;
    f.plugin.saveData = async (data: any) => { f.writes.push(structuredClone(data)); if (++count === 1) { entered.resolve(); await release.promise; } };
    const pending = outcome(f.view.applyLayout(values)); await entered.promise;
    if (mode === 'resize') f.renderer.width++;
    if (mode === 'labels') f.plugin.settings.labelSize++;
    if (mode === 'theme') f.renderer.refreshTheme();
    if (mode === 'view') f.renderer.setView(f.view.visible, {});
    if (mode === 'disposed') f.renderer.dispose();
    if (mode === 'scope') f.view[scopeProperty] = new Uint8Array([1, 0, 0]);
    release.resolve(); expect(await pending).not.toBe('success'); retained(f); expect(f.writes.length).toBe(2);
  }
});

test('production ordinary save snapshots latest settings and camera; later winning Apply is not clobbered', async () => {
  const f = await fixture(), entered = deferred(), release = deferred(); let count = 0;
  f.plugin.saveData = async (data: any) => { f.writes.push(structuredClone(data)); if (++count === 1) { entered.resolve(); await release.promise; } };
  const pending = f.view.applyLayout(values); await entered.promise; f.plugin.settings.visuals.glow = .42; f.renderer.camera = { x: 7, y: 8, ratio: 4 };
  const ordinary = f.plugin.save(); release.resolve(); await Promise.all([pending, ordinary]);
  expect(f.writes.at(-1).settings.layout.force.scalingRatio).toBe(8); expect(f.writes.at(-1).settings.visuals.glow).toBe(.42); expect(f.renderer.camera).toEqual({ x: 7, y: 8, ratio: 4 });
  const g = await fixture(), start = deferred(), finish = deferred(); count = 0;
  g.plugin.saveData = async (data: any) => { g.writes.push(structuredClone(data)); if (++count === 1) { start.resolve(); await finish.promise; } };
  const first = outcome(g.view.applyLayout(values)); await start.promise; g.view.activeRevision++; g.view.detailGeneration++;
  const second = outcome(g.view.applyLayout({ ...values, scalingRatio: 9 })); finish.resolve(); expect(await first).toContain('generation changed'); expect(await second).toBe('success'); expect(g.writes.at(-1).settings.layout.force.scalingRatio).toBe(9);
});

test('production upload failure restores last-good CPU/GPU state; lost context and failed rollback report uncertainty', async () => {
  for (const mode of ['once', 'lost', 'throw']) {
    const f = await fixture(), d = driver(f.renderer), atlas = f.renderer.atlas; d.fail(mode);
    const result = await outcome(f.view.applyLayout(values)); expect(result).not.toBe('success'); retained(f); expect(f.renderer.atlas).toBe(atlas); expect(f.writes.length).toBe(2);
    if (mode === 'once') expect(result).toContain('GPU coordinate upload failed'); else expect(result).toContain('GPU recovery uncertain');
  }
});

test('production token discard/rollback cannot overwrite a newer winning token', async () => {
  const f = await fixture(), first = await prepare(f.renderer, f.next, () => true), second = await prepare(f.renderer, new Float32Array([9, 8, 7, 6, 5, 4]), () => true);
  expect(first.current()).toBe(false); expect(() => first.commit()).toThrow('generation changed'); first.discard(); second.commit();
  expect(() => first.rollback()).toThrow('owner changed'); expect([...f.renderer.positions]).toEqual([9, 8, 7, 6, 5, 4]); second.discard();
});


test('production sizing preview/cancel keeps renderer camera selection scope settings and layout unchanged', async () => {
  const f = await fixture(), original = structuredClone(f.plugin.settings), camera = { ...f.renderer.camera }, positions = f.renderer.positions, canvas = f.renderer.canvas;
  const value = { radius: 12, prominence: 5, compensation: 0, floor: .3, curve: 'sqrt' as const };
  f.renderer.previewSizing(value);
  expect(f.plugin.settings).toEqual(original); expect(f.writes.length).toBe(0); expect(f.requests()).toBe(0);
  expect(f.renderer.camera).toEqual(camera); expect(f.renderer.selected).toBe(2); expect(f.renderer.positions).toBe(positions); expect(f.renderer.canvas).toBe(canvas);
  expect(f.renderer.sizingReadout()).toContain('12.00–12.00');
  const point = f.renderer.screenPoint(2); expect(f.renderer.pick(point.x + 16, point.y)).toBe(2);
  const radii: number[] = []; ctx.arc = (_x: number, _y: number, radius: number) => radii.push(radius);
  f.renderer[compiled('drawCanvas')](); expect(radii.slice(0, 2)).toEqual([12, 12]);
  // The selected note is the graduated focus: radius 14 grows by 60% at full focus and gains its ring stroke.
  const level = f.renderer[compiled('focusLevel')]; [14 * (1 + .6 * level), 14 * (1 + .6 * level) * 1.22].slice(0, level ? 2 : 1).forEach((v, i) => expect(radii[2 + i]!).toBeCloseTo(v, 9));
  await f.renderer[compiled('prepareLabels')](() => true);
  expect(f.renderer.atlas.levels.every((level: Float32Array) => level.length % 11 === 0)).toBe(true);
  const populated = f.renderer.atlas.levels.find((level: Float32Array) => level.length > 0); expect(populated).toBeDefined(); expect(populated[10]).toBe(1);
  f.renderer.previewSizing(null); expect(f.renderer.pick(point.x + original.nodeSize * (1 + original.visuals.degreeSizing) * (1 + .6 * level) + 5, point.y)).not.toBe(2); expect(f.plugin.settings).toEqual(original); expect(f.renderer.camera).toEqual(camera);
});

test('production sizing apply acknowledgement and rejected save preserve last-saved policy', async () => {
  const f = await fixture(), value = { radius: 6, prominence: 9, compensation: .5, floor: .2, curve: 'linear' as const }, camera = { ...f.renderer.camera };
  f.renderer.previewSizing(value); await f.plugin.commitSizing(value, () => true); f.renderer.previewSizing(null, true);
  expect(f.plugin.settings.nodeSizing.policy).toBe('predictable'); expect(f.plugin.settings.nodeSize).toBe(6); expect(f.renderer.camera).toEqual(camera); expect(f.renderer.selected).toBe(2); expect(f.requests()).toBe(0);
  const saved = structuredClone(f.plugin.settings); let calls = 0; f.plugin.saveData = async () => { if (++calls === 1) throw new Error('synthetic failure'); };
  f.renderer.previewSizing({ ...value, radius: 10 });
  await expect(f.plugin.commitSizing({ ...value, radius: 10 }, () => true)).rejects.toThrow('synthetic failure'); f.renderer.previewSizing(null, true);
  expect(f.plugin.settings).toEqual(saved); expect(calls).toBe(2);
});


test('Repair R2 carrier-size edits invalidate stale label multipliers and coalesce without relayout', async () => {
  const f = await fixture(), v = { radius: 10, prominence: 1, compensation: 0, floor: .3, curve: 'log' as const }, camera = { ...f.renderer.camera }, positions = f.renderer.positions;
  f.renderer.projection.carrierNodes[0] = 1; f.plugin.settings.visuals.carrierLod = false;
  f.renderer.setView(new Uint8Array([1, 0, 0]), {});
  await f.plugin.commitSizing(v, () => true); f.renderer.previewSizing(null, true);
  await f.renderer[compiled('prepareLabels')](() => true);
  const multiplier = () => f.renderer.atlas.levels.find((level: Float32Array) => level.length > 0)[10];
  expect(multiplier()).toBeCloseTo(.6);
  f.plugin.settings.visuals.carrierSize = 1; f.renderer.refreshVisuals(false); const firstTimer = f.renderer.sizingTimer;
  expect(f.renderer.atlas).toBeUndefined(); expect(firstTimer).toBeDefined();
  f.plugin.settings.visuals.carrierSize = 2; f.renderer.refreshVisuals(false);
  expect(f.renderer.sizingTimer).not.toBe(firstTimer); expect(f.renderer.atlas).toBeUndefined();
  await f.renderer[compiled('prepareLabels')](() => true);
  expect(multiplier() * 10).toBeCloseTo(20);
  const atlas = f.renderer.atlas, timer = f.renderer.sizingTimer; f.renderer.refreshVisuals(false);
  expect(f.renderer.atlas).toBe(atlas); expect(f.renderer.sizingTimer).toBe(timer);
  const radii: number[] = []; ctx.arc = (_x: number, _y: number, radius: number) => radii.push(radius); f.renderer[compiled('drawCanvas')]();
  expect(radii).toEqual([20]); expect(f.renderer.camera).toEqual(camera); expect(f.renderer.positions).toBe(positions); expect(f.renderer.selected).toBe(2); expect(f.requests()).toBe(0);
});


test('Repair R2 legacy carrier edit retains existing atlas and creates no sizing rebuild', async () => {
  const f = await fixture(), atlas = f.renderer.atlas;
  expect(f.plugin.settings.nodeSizing.policy).toBe('legacy'); f.plugin.settings.visuals.carrierSize = 2; f.renderer.refreshVisuals(false);
  expect(f.renderer.atlas).toBe(atlas); expect(f.renderer.sizingTimer).toBeUndefined(); expect(f.requests()).toBe(0);
});

// Driver/Canvas calls from the production bundle; no GPU execution is claimed.
test('UX production Canvas detail honors zero and fractional opacity without changing graph rows', async () => {
  const f = await fixture(), r = f.renderer, key = (name: string) => typeof mangle[name] === 'string' ? mangle[name] : name;
  r.projection.source = new Uint32Array([0]); r.projection.target = new Uint32Array([1]);
  r[key('edgeOn')] = new Uint8Array([1]); r[key('filterVisible')] = new Uint8Array([1, 1, 1]); r[key('canvasEdges')] = new Uint32Array([0]); r[key('visibleEdges')] = 1;
  const stroke = ctx.stroke; let calls: number[] = []; ctx.stroke = () => calls.push(ctx.globalAlpha);
  try { for (const opacity of [0, .00001, .2]) { calls = []; f.plugin.settings.visuals.edgeOpacity = opacity; r[key('drawCanvas')](); expect(calls.length).toBe(opacity ? 1 : 0); if (opacity) { expect(calls[0]).toBeGreaterThan(0); expect(calls[0]).toBeLessThanOrEqual(opacity * 3.75); } expect(r.projection.source.length).toBe(1); } } finally { ctx.stroke = stroke; }
});
test('UX production WebGL scheduling omits edges at zero even with hover/focus, preserves context', async () => {
  const f = await fixture(), r = f.renderer, key = (name: string) => typeof mangle[name] === 'string' ? mangle[name] : name;
  let current = -1; const draws: number[] = [], alphas: number[] = [];
  const gl: any = new Proxy({ useProgram: (handle: number) => { current = handle; }, uniform1f: (name: string, value: number) => { if (name === 'edgeAlpha') alphas.push(value); }, drawArraysInstanced: () => draws.push(current) }, { get: (o: any, k: string) => k in o ? o[k] : k.toUpperCase() === k ? 1 : () => {} });
  r.gl = gl; r[key('programs')] = [0, 1, 2, 3].map(handle => ({ handle, uniforms: new Proxy({}, { get: (_o, key) => key }) })); r.atlas = undefined; r[key('hoveredEdge')] = 0; r[key('focusLevel')] = 1; r[key('focusTarget')] = 1;
  for (const opacity of [0, .00001]) { draws.length = alphas.length = 0; f.plugin.settings.visuals.edgeOpacity = opacity; r[key('draw')](); expect(draws.includes(0)).toBe(opacity > 0); expect(r.gl).toBe(gl); expect(alphas.every(a => a >= 0 && a <= opacity * 3.75)).toBe(true); }
});

// Actual compiled Canvas renderer dispatch with a scalar compositor, not a browser canvas.
test('density production Canvas conserves ordinary alpha at dense and sparse overlap without state changes', async () => {
  const f = await fixture(), r = f.renderer, key = (name: string) => typeof mangle[name] === 'string' ? mangle[name] : name;
  const oldFill = ctx.fill, oldRect = ctx.fillRect, oldArc = ctx.arc, camera = { ...r.camera }, positions = r.positions, sourceRows = r.projection.source, saved = JSON.stringify(f.plugin.settings);
  const records: { alpha: number; radius: number }[] = []; let radius = 0, cleared = 0;
  ctx.arc = (_x: number, _y: number, next: number) => { radius = next; }; ctx.fill = () => records.push({ alpha: ctx.globalAlpha, radius }); ctx.fillRect = () => { cleared = ctx.globalAlpha; };
  try {
    for (const n of [1, 64, 512]) for (const alpha of [0, 1, 64, 255]) {
      r.visible = new Uint8Array(n).fill(1); r.projection.carrierNodes = new Uint8Array(n); r[key('display')] = new Float32Array(n * 2); r[key('sizes')] = new Float32Array(n).fill(1); r[key('stateBytes')] = new Uint8Array(n * 4);
      const colors = new Uint8Array(n * 4); for (let i = 0; i < n; i++) colors.set([220, 140, 70, alpha], i * 4); r[key('colorBytes')] = colors; r[key('visibleNodes')] = n; r.atlas = undefined; r.selected = r.hovered = -1;
      records.length = 0; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .2; r[key('drawCanvas')]();
      expect(ctx.globalCompositeOperation).toBe('source-over'); expect(cleared).toBe(1); expect(records.length).toBe(alpha ? n : 0);
      let pixel = [.08, .08, .08]; for (const mark of records) { expect(mark.alpha).toBe(alpha / 255); expect(mark.radius).toBe(f.plugin.settings.nodeSize); pixel = pixel.map((v, i) => [220, 140, 70][i]! / 255 * mark.alpha + v * (1 - mark.alpha)); }
      expect(pixel.every(v => v < .9)).toBe(true); expect(r.camera).toEqual(camera); expect(r.positions).toBe(positions); expect(r.projection.source).toBe(sourceRows); expect(JSON.stringify(f.plugin.settings)).toBe(saved); expect(f.requests()).toBe(0); expect(f.writes.length).toBe(0);
    }
    r.selected = 0; r[key('theme')].palette[19] = 128; records.length = 0; r[key('drawCanvas')](); expect(records[0]!.alpha).toBe(128 / 255); expect(records[0]!.radius).toBe(f.plugin.settings.nodeSize + 2);
  } finally { ctx.fill = oldFill; ctx.fillRect = oldRect; ctx.arc = oldArc; }
});


test('zoom DPR-only change updates backing resolution on next production paint without changing graph or CSS geometry', async () => {
  const f = await fixture(), r = f.renderer, key = (name: string) => typeof mangle[name] === 'string' ? mangle[name] : name;
  const camera = { ...r.camera }, positions = r.positions, visible = r.visible, colors = r[key('colorBytes')].slice(), settings = JSON.stringify(f.plugin.settings), css = { ...r.canvas.style }, point = r.screenPoint(0), picked = r.pick(point.x, point.y), selected = r.selected;
  let assignments = 0, width = r.canvas.width, height = r.canvas.height;
  Object.defineProperties(r.canvas, { width: { configurable: true, get: () => width, set: v => { assignments++; width = v; } }, height: { configurable: true, get: () => height, set: v => { assignments++; height = v; } } });
  try {
    for (const dpr of [2, 1.25, 1]) {
      rendererWindow.devicePixelRatio = dpr; r.setCamera(camera.x, camera.y, camera.ratio); r[key('draw')]();
      expect([width, height]).toEqual([Math.round(f.stage.clientWidth * dpr), Math.round(f.stage.clientHeight * dpr)]);
      expect(r.canvas.style).toEqual(css); expect(r.camera).toEqual(camera); expect(r.positions).toBe(positions); expect(r.visible).toBe(visible); expect(r[key('colorBytes')]).toEqual(colors); expect(r.screenPoint(0)).toEqual(point); expect(r.pick(point.x, point.y)).toBe(picked); expect(r.selected).toBe(selected); expect(JSON.stringify(f.plugin.settings)).toBe(settings); expect(f.writes.length).toBe(0); expect(f.requests()).toBe(0);
      const before = assignments; r[key('draw')](); expect(assignments).toBe(before);
    }
  } finally { rendererWindow.devicePixelRatio = 1; }
});

// Graduated connection highlighting through the compiled renderer: Canvas fixture draw calls and
// recorded GL upload calls only. No GPU raster, native visual quality, FPS or device input is claimed.
async function graduated(pairs: [number, number][], n = 5, max = 0) {
  const settings = defaults('links'), opened: number[] = [], p: any = projection(n);
  if (max) { settings.canvasMaxDetailNodes = max; settings.canvasMaxDetailEdges = max; }
  Object.assign(p, { source: Uint32Array.from(pairs, x => x[0]), target: Uint32Array.from(pairs, x => x[1]), type: new Uint32Array(pairs.length), types: ['link'], carrier: new Uint32Array(pairs.length).fill(0xffffffff) });
  const positions = Float32Array.from({ length: n * 2 }, (_, i) => i % 2 ? (i >> 1) * 37 % 100 : (i >> 1) * 50);
  const r = await Renderer.create(new Element(), p, positions, new Uint8Array(n).fill(1), settings, (i: number) => opened.push(i), () => {}, new Uint32Array(n), () => true, true, () => {}, {});
  renderers.push(r);
  const k = (name: string) => typeof mangle[name] === 'string' ? mangle[name] : name;
  const point = (q: number | { x: number; y: number }) => typeof q === 'number' ? r.screenPoint(q) : q;
  const tap = (q: number | { x: number; y: number }, pointerType = 'mouse') => { const { x, y } = point(q), e = { pointerId: 1, clientX: x, clientY: y, pointerType }; r[k('pointerDown')](e); r[k('pointerUp')](e); };
  const hover = (q: number | { x: number; y: number }) => { const { x, y } = point(q); r[k('pointerMove')]({ pointerId: 9, clientX: x, clientY: y, pointerType: 'mouse' }); };
  const tiers = () => Array.from({ length: n }, (_, i) => r[k('stateBytes')][i * 4 + 1]);
  const expected = (f: number, on = new Uint8Array(pairs.length).fill(1), vis = new Uint8Array(n).fill(1)) => { const state = new Uint8Array(n * 4), edge = new Uint8Array(pairs.length); focusTiers(f, incidentEdges(r.projection), r.projection, on, vis, state, edge, [], []); return [Array.from({ length: n }, (_, i) => state[i * 4 + 1]), [...edge]]; };
  return { r, settings, opened, k, tap, hover, tiers, expected, actual: () => [tiers(), [...r[k('edgeTier')]]] };
}
const EMPTY = { x: 1, y: 599 };
test('graduated production selection and hover drive one CPU tier authority; every reset path clears', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f;
  const camera = { ...r.camera }, positions = r.positions, rows = r.projection.source, saved = JSON.stringify(f.settings);
  f.tap(0); expect(f.opened).toEqual([0]); expect(r.selected).toBe(0); expect(f.actual()).toEqual([[255, 255, 128, 0, 0], [255, 128, 0]]);
  f.hover(3); expect(f.actual()).toEqual(f.expected(3)); expect(f.tiers()).toEqual([0, 128, 255, 255, 0]);
  r[k('pointerLeave')](); expect(f.actual()).toEqual(f.expected(0));
  for (const i of [1, 3, 1, 4, 2, 2, 0]) { f.hover(i); expect(f.actual()).toEqual(f.expected(i)); }
  f.hover(EMPTY); expect(f.actual()).toEqual(f.expected(0));
  const all = new Uint8Array(5).fill(1);
  r.setView(all, { typeHidden: new Uint8Array([1]) }); expect(f.actual()).toEqual(f.expected(0, new Uint8Array(3))); expect(f.tiers()).toEqual([255, 0, 0, 0, 0]);
  r.setView(new Uint8Array([1, 0, 1, 1, 1]), {}); expect(f.actual()).toEqual(f.expected(0, undefined, new Uint8Array([1, 0, 1, 1, 1])));
  r.setView(new Uint8Array([0, 1, 1, 1, 1]), {}); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]);
  r.setView(all, {}); expect(f.actual()).toEqual(f.expected(0));
  f.settings.visuals.hoverHighlight = false; f.hover(2); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]);
  f.settings.visuals.hoverHighlight = true; f.hover(1); expect(f.actual()).toEqual(f.expected(1));
  r[k('pointerLeave')](); f.tap(EMPTY); expect(r.selected).toBe(-1); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]); expect(f.opened).toEqual([0]);
  expect(r.camera).toEqual(camera); expect(r.positions).toBe(positions); expect(r.projection.source).toBe(rows); expect(JSON.stringify(f.settings)).toBe(saved);
});
test('graduated production Canvas parity: tier batches, graded nodes and labels, zero opacity keeps edges hidden', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f, dim = f.settings.visuals.dimOpacity;
  const saved = { stroke: ctx.stroke, fill: ctx.fill, moveTo: ctx.moveTo, beginPath: ctx.beginPath, fillText: ctx.fillText };
  let strokes: [number, number][] = [], fills: number[] = [], labels: [string, number][] = [], segments = 0;
  Object.assign(ctx, { beginPath: () => { segments = 0; }, moveTo: () => { segments++; }, stroke: () => strokes.push([ctx.globalAlpha, segments]), fill: () => fills.push(ctx.globalAlpha), fillText: (t: string) => labels.push([t, ctx.globalAlpha]) });
  const paint = (level: number) => { strokes = []; fills = []; labels = []; r[k('focusLevel')] = level; r[k('drawCanvas')](); return { strokes, fills, labels }; };
  try {
    f.tap(0); const plain = paint(0); expect(plain.strokes.length).toBe(1); expect(plain.strokes[0]![1]).toBe(3);
    const a = plain.strokes[0]![0], lit = paint(1);
    // Three edge batches, then the focus ring (an arc stroke with no line segments) at full focus.
    expect(lit.strokes.map(s => s[1])).toEqual([1, 1, 1, 0]); expect(lit.strokes[3]![0]).toBeCloseTo(plain.fills[0]!, 12);
    [a * (1 - (1 - dim * .6)), a, Math.min(1, a * 3)].forEach((v, i) => expect(lit.strokes[i]![0]).toBeCloseTo(v, 12));
    const ratio = lit.fills.map((v, i) => v / plain.fills[i]!);
    [1, 1, 1 - (1 - dim) * (1 - 128 / 255), dim, dim].forEach((v, i) => expect(ratio[i]!).toBeCloseTo(v, 12));
    // Tiered atlas labels hand over to the graduated DOM labels; context labels go very faint.
    for (const [text, alpha] of lit.labels) { expect(+text).toBeGreaterThanOrEqual(3); expect(alpha).toBeCloseTo(dim * .5, 12); }
    expect(plain.labels.every(([, alpha]) => alpha === 1)).toBe(true);
    f.settings.visuals.edgeOpacity = 0; const hidden = paint(1);
    expect(hidden.strokes.filter(s => s[1])).toEqual([]); expect(hidden.fills.map((v, i) => v / plain.fills[i]!)).toEqual(ratio);
  } finally { Object.assign(ctx, saved); }
});
test('graduated production labels: focus largest, direct then 2-hop by priority, placed once per focus or LOD change, every reset clears', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [3, 4]]), { r, k } = f;
  const paint = () => { r[k('focusLevel')] = 1; r[k('placeOverlay')](); return r[k('tierLabels')].map((el: any) => [el.textContent, el.className, el.style.opacity]); };
  const name = (n: number) => r[k('name')](n);
  f.tap(1); const first = paint();
  expect(first).toEqual([[name(0), 'graph-ng-focus-label graph-ng-tier-1', '1'], [name(2), 'graph-ng-focus-label graph-ng-tier-1', '1'], [name(3), 'graph-ng-focus-label graph-ng-tier-3', '1']]);
  expect(r[k('hoverLabel')].className).toBe('graph-ng-hover-label graph-ng-focus'); expect(r[k('hoverLabel')].textContent).toBe(name(1));
  // Per frame only translates; the placement is reused until focus or LOD changes.
  const ranked = r[k('ranked')]; r.setCamera(r.camera.x + .01, r.camera.y, r.camera.ratio); paint(); expect(r[k('ranked')]).toBe(ranked);
  r.setCamera(r.camera.x, r.camera.y, r.camera.ratio * 16); paint(); expect(r[k('ranked')]).not.toBe(ranked);
  // Budget: one label per viewport keeps only the focus (shown by the focus readout).
  f.settings.labelsMaxPerViewport = 1; f.tap(2); expect(paint()).toEqual([]); f.settings.labelsMaxPerViewport = 400;
  f.tap(3); expect(paint().map((x: string[]) => x[0])).toEqual([name(2), name(4), name(1)]);
  f.tap(EMPTY); expect(paint()).toEqual([]); expect(r[k('hoverLabel')].textContent).toBe('');
  f.settings.visuals.hoverHighlight = false; f.hover(2); expect(paint()).toEqual([]); expect(r[k('hoverLabel')].className).toBe('graph-ng-hover-label');
  f.settings.visuals.hoverHighlight = true; f.hover(3); expect(paint().length).toBe(3); r[k('pointerLeave')](); expect(paint()).toEqual([]);
});
test('focus-label placement re-runs on coordinate change at constant zoom and on viewport resize; DOM font matches the measured font', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [3, 4]]), { r, k } = f;
  const paint = () => { r[k('focusLevel')] = 1; r[k('placeOverlay')](); };
  f.tap(1); paint(); const ranked = r[k('ranked')];
  paint(); expect(r[k('ranked')]).toBe(ranked);
  // Labels render with the exact font string used for measureText during placement.
  const el = r[k('tierLabels')][0]; expect(el.style.font).toBe(`600 ${f.settings.labelSize}px ${r[k('theme')].font}`);
  // Coordinate adoption or rollback swaps the display array without touching the camera.
  const display = r[k('display')]; r[k('display')] = Float32Array.from(display, (x: number) => x + 3); paint(); expect(r[k('ranked')]).not.toBe(ranked);
  const moved = r[k('ranked')]; r[k('display')] = display; paint(); expect(r[k('ranked')]).not.toBe(moved);
  const back = r[k('ranked')]; r[k('width')] += 40; paint(); expect(r[k('ranked')]).not.toBe(back);
});
test('graduated production WebGL uploads the tier column and state on focus and on view re-upload', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f;
  let bound: unknown; const uploads: unknown[][] = [], images: unknown[] = [];
  r.gl = new Proxy({ isContextLost: () => false, bindBuffer: (_: unknown, b: unknown) => { bound = b; }, bufferData: (_: unknown, data: unknown) => uploads.push([bound, data]), texImage2D: (...args: unknown[]) => images.push(args.at(-1)) }, { get: (o: any, key: string) => key in o ? o[key] : key.toUpperCase() === key ? 1 : () => {} });
  r[k('buffers')] = ['source', 'target', 'on', 'tier', 'sizes'];
  f.tap(2); expect(uploads.some(([b, d]) => b === 'tier' && d === r[k('edgeTier')])).toBe(true); expect(images).toContain(r[k('stateBytes')]);
  uploads.length = images.length = 0; r[k('uploadView')]();
  expect(uploads.some(([b, d]) => b === 'tier' && d === r[k('edgeTier')])).toBe(true); expect(uploads.some(([b, d]) => b === 'on' && d === r[k('edgeOn')])).toBe(true); expect(images).toContain(r[k('stateBytes')]);
  r.gl = null;
});
test('graduated production dense hub reports deterministic 2-hop truncation in the visible hover readout', async () => {
  const pairs: [number, number][] = [[0, 1], [0, 2]]; let id = 3;
  for (const hub of [1, 2]) for (let i = 0; i < 33000; i++) pairs.push([hub, id++]);
  const f = await graduated(pairs, id, 70000), { r, k } = f, started = performance.now();
  f.hover(0); const ms = performance.now() - started; r[k('placeOverlay')]();
  expect(r[k('hoverLabel')].textContent).toContain('2-hop context truncated'); expect(f.tiers().filter(v => v === 128).length).toBeLessThanOrEqual(65536);
  expect(f.actual()).toEqual(f.expected(0)); expect(ms).toBeLessThan(5000);
  f.hover(3); r[k('placeOverlay')](); expect(r[k('hoverLabel')].textContent).not.toContain('truncated');
});
test('graduated production touch tap selects with a text-only Open card and never opens by itself', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f, card = () => r[k('noteCard')];
  f.tap(1, 'touch'); expect(f.opened).toEqual([]); expect(r.selected).toBe(1); expect(f.actual()).toEqual(f.expected(1));
  const open = card().children[0]; expect(card().textContent).toBe('1Open'); expect(open.tagName).toBe('BUTTON'); expect(open.textContent).toBe('Open'); expect(open.attributes['aria-label']).toBe('Open 1');
  open.click(); expect(f.opened).toEqual([1]);
  f.tap(2, 'touch'); expect(f.opened).toEqual([1]); expect(card().children[0].attributes['aria-label']).toBe('Open 2'); expect(f.actual()).toEqual(f.expected(2));
  r.setView(new Uint8Array([1, 1, 0, 1, 1]), {}); expect(card().textContent).toBe(''); expect(f.tiers()).toEqual([0, 0, 0, 0, 0]);
  // A filter-hidden selection cannot be opened with Enter.
  r[k('keyDown')]({ key: 'Enter', target: r.canvas, preventDefault() {} }); expect(f.opened).toEqual([1]);
  r.setView(new Uint8Array(5).fill(1), {}); f.tap(EMPTY, 'touch'); expect(r.selected).toBe(-1); expect(card().textContent).toBe(''); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]);
  // A secondary-button press neither selects nor opens.
  { const q = r.screenPoint(3), e = { pointerId: 2, button: 2, clientX: q.x, clientY: q.y, pointerType: 'mouse' }; r[k('pointerDown')](e); r[k('pointerUp')](e); expect(f.opened).toEqual([1]); expect(r.selected).toBe(-1); }
  // Mouse and pen keep click-to-open and show no card.
  f.tap(3, 'mouse'); f.tap(0, 'pen'); expect(f.opened).toEqual([1, 3, 0]); expect(card().textContent).toBe(''); expect(f.actual()).toEqual(f.expected(0));
  const overlay = card().parent; r.dispose(); expect(r.canvas.parent.children).not.toContain(r.canvas); expect(overlay.parent.children).not.toContain(overlay);
});
test('graduated production keyboard path: focusable canvas, arrows select, Enter opens, Escape clears and returns focus', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f, key = (name: string, target = r.canvas) => { let prevented = false; r[k('keyDown')]({ key: name, target, preventDefault: () => { prevented = true; } }); return prevented; };
  expect(r.canvas.tabIndex).toBe(0); expect(r.canvas.getAttribute('aria-label')).toContain('Escape');
  expect(key('ArrowRight')).toBe(true); const first = r.selected; expect(first).toBeGreaterThanOrEqual(0); expect(f.actual()).toEqual(f.expected(first)); expect(r[k('noteCard')].children[0].textContent).toBe('Open');
  const p = r.screenPoint(first); expect(key('ArrowRight')).toBe(true); expect(r.screenPoint(r.selected).x).toBeGreaterThan(p.x); expect(f.actual()).toEqual(f.expected(r.selected));
  expect(key('ArrowLeft')).toBe(true); expect(r.selected).toBe(first); expect(f.opened).toEqual([]);
  expect(key('Enter')).toBe(true); expect(f.opened).toEqual([first]);
  const button = r[k('noteCard')].children[0]; expect(key('Enter', button)).toBe(false); expect(f.opened).toEqual([first]);
  button.focus(); expect(key('Escape', button)).toBe(true); expect(r.selected).toBe(-1); expect(r[k('noteCard')].textContent).toBe(''); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]); expect((ControlElement as any).active).toBe(r.canvas);
  expect(key('Escape')).toBe(false); expect(key('a')).toBe(false);
});
// Relationship picking through the compiled renderer (Canvas fixture). Clicks and taps on lines select only.
async function relationships() {
  const f = await graduated([[0, 1], [1, 0], [1, 2]], 3), { r, k } = f, card = () => r[k('noteCard')], box = () => card().children[0];
  const mid = (a: number, b: number) => { const p = r.screenPoint(a), q = r.screenPoint(b); return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; };
  const key = (name: string, shiftKey = false) => { let prevented = false; r[k('keyDown')]({ key: name, shiftKey, target: r.canvas, preventDefault: () => { prevented = true; } }); return prevented; };
  return { ...f, card, box, mid, key, edges: () => r[k('selectedEdges')] };
}
test('relationship pick: notes outrank lines; a line click lists parallel rows, lights both endpoints and never opens', async () => {
  const f = await relationships(), { r } = f;
  f.tap(0); expect(r.selected).toBe(0); expect(f.edges()).toEqual([]); expect(f.opened).toEqual([0]);
  for (const pointer of ['mouse', 'touch', 'pen']) {
    f.tap(f.mid(0, 1), pointer); expect(f.opened).toEqual([0]); expect(r.selected).toBe(-1); expect(f.edges()).toEqual([0, 1]);
    expect(f.actual()).toEqual([[255, 255, 0], [255, 255, 0]]);
    const rows = f.box().children; expect(rows[0].textContent).toBe('0 → 1'); expect(rows[1].textContent).toBe('link'); expect(rows[2].textContent).toBe('link (reverse)');
    expect(f.card().textContent).not.toContain(' · ');
  }
  f.tap(f.mid(1, 2)); expect(f.edges()).toEqual([2]); expect(f.actual()).toEqual([[0, 255, 255], [0, 0, 255]]);
  // A filter that hides an endpoint clears the relationship and its card.
  r.setView(new Uint8Array([1, 1, 0]), {}); expect(f.edges()).toEqual([]); expect(f.card().textContent).toBe(''); expect(f.actual()).toEqual([[0, 0, 0], [0, 0, 0]]);
  r.setView(new Uint8Array(3).fill(1), {}); f.tap(f.mid(0, 1)); f.tap(EMPTY); expect(f.edges()).toEqual([]); expect(f.card().textContent).toBe(''); expect(f.actual()).toEqual([[0, 0, 0], [0, 0, 0]]);
});
test('relationship card resolves rule names and relationship notes per parallel row; open buttons are explicit', async () => {
  const f = await relationships(), { r, k } = f, paths: string[] = [], asked: number[][] = [];
  r[k('describeEdges')] = async (edges: number[]) => { asked.push([...edges]); return edges.map(e => e === 1 ? { rule: 'crosswalk', carrier: 'Crosswalks/edge-1.md' } : { rule: 'links' }); };
  r.openPath = (path: string) => paths.push(path);
  f.tap(f.mid(0, 1), 'touch'); await Promise.resolve(); await Promise.resolve();
  expect(asked).toEqual([[0, 1]]);
  const [, first, second, ends] = f.box().children;
  expect(first.textContent).toBe('linkRule: links'); expect(first.children.some((c: any) => c.tagName === 'BUTTON')).toBe(false);
  const open = second.children.find((c: any) => c.tagName === 'BUTTON'); expect(open.textContent).toBe('Open relationship note'); expect(open.attributes['aria-label']).toBe('Open relationship note Crosswalks/edge-1.md');
  open.click(); expect(paths).toEqual(['Crosswalks/edge-1.md']); expect(f.opened).toEqual([]);
  ends.children[0].click(); ends.children[1].click(); expect(f.opened).toEqual([0, 1]);
  // A stale answer after a newer selection never decorates the new card; a failed lookup says so.
  let release!: () => void; r[k('describeEdges')] = (edges: number[]) => new Promise(done => { release = () => done(edges.map(() => ({ carrier: 'stale.md' }))); });
  f.tap(f.mid(1, 2)); const stale = release; r[k('describeEdges')] = async () => { throw new Error('Projection generation changed'); };
  f.tap(f.mid(0, 1)); stale(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(f.card().textContent).not.toContain('Open relationship note'); expect(f.card().textContent).toContain('Details unavailable');
});
test('relationship keyboard: R cycles the selected note relationships one stop per neighbour; Escape clears; nothing opens', async () => {
  const f = await relationships(), { r } = f;
  expect(r.canvas.getAttribute('aria-label')).toContain('R cycles relationships');
  expect(f.key('r')).toBe(false); expect(f.edges()).toEqual([]);
  f.tap(1, 'touch'); expect(f.key('r')).toBe(true); expect(f.edges()).toEqual([0, 1]);
  expect(f.key('r')).toBe(true); expect(f.edges()).toEqual([2]);
  expect(f.key('r')).toBe(true); expect(f.edges()).toEqual([0, 1]);
  expect(f.key('R', true)).toBe(true); expect(f.edges()).toEqual([2]);
  expect(f.key('Enter')).toBe(false); expect(f.opened).toEqual([]);
  expect(f.key('Escape')).toBe(true); expect(f.edges()).toEqual([]); expect(f.card().textContent).toBe(''); expect(f.actual()).toEqual([[0, 0, 0], [0, 0, 0]]);
});
test('graduated focus pick radius follows the 60% enlarged focus node', async () => {
  const f = await relationships(), { r, k } = f, s = f.settings;
  f.tap(2, 'touch'); const p = r.screenPoint(2), at = { x: p.x + s.nodeSize * (1 + s.visuals.degreeSizing) * 1.3 + 4, y: p.y };
  r[k('focusLevel')] = 0; expect(r.pick(at.x, at.y)).toBe(-1);
  r[k('focusLevel')] = 1; expect(r.pick(at.x, at.y)).toBe(2);
});
