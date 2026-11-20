import { performanceRenderer as reviewRenderer } from './support/performance-renderer';
import { test, expect, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { defaults, upgradeSettings, validateSettings } from '../src/settings';
import { encodeStrings } from '../src/core/columns';
import { ControlElement, control } from './support/controls-dom';
import { topLeftHub } from './support/top-left-hub';
import { focusTiers, incidentEdges, shownTier } from '../src/render-data';
import { miniFit, miniBounds, toCamera } from '../src/minimap';
import { shaderNames } from '../scripts/glsl.mjs';

// Actual production classes; the DOM/driver seam does not establish native rendering/performance.
const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const rendererName = source.match(/await ([\w$]+)\.create\(this\.stage,/)?.[1];
if (!rendererName) throw new Error('Production renderer seam missing: build before tests');
const ctx: any = new Proxy({ fillStyle: '#ffffff', measureText: (s: string) => ({ width: s.length * 7 }), getImageData: () => ({ data: new Uint8ClampedArray([80, 90, 100, 255]) }) }, { get: (o: any, k: any) => k in o ? o[k] : () => {} });
class Element extends ControlElement {
  style: any = { setProperty(key: string, value: string) { this[key] = value; } }; width = 0; height = 0; clientWidth = 800; clientHeight = 600; title = '';
  append(...nodes: any[]) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node: any) { node.parent = this; this.children.push(node); return node; }
  getContext(kind: string) { return kind === '2d' ? ctx : null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  listeners = new Map<string, unknown>();
  addEventListener(type: string, listener: unknown) { this.listeners.set(type, listener); }
  removeEventListener(type: string, listener: unknown) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
  setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; }
  createDiv(options: any = {}) { const e = new Element(); e.className = options.cls; return this.appendChild(e); }
  removeAttribute(key: string) { delete this.attributes[key]; }
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
let fixtureReducedMotion = false, rejectStorage = false;
const rendererStorage = { getItem() { if (rejectStorage) throw new Error('storage denied'); return null; }, setItem() { if (rejectStorage) throw new Error('storage denied'); } };
const rendererWindow = { devicePixelRatio: 1 };
const module = { exports: {} as any };
const obsidian = { ItemView: class {}, Menu: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, apiVersion: 'synthetic', Notice: class {}, setIcon: (el: any, icon: string) => { el.empty(); el.dataset ??= {}; el.dataset.icon = icon; el.icon = icon; if (icon === 'circle-stop') { const svg = el.createEl('svg'), circle = svg.createEl('circle'); circle.cloneNode = () => new ControlElement('CIRCLE'); svg.createEl('rect'); } } };
vm.runInNewContext(source + `\n;module.exports.__renderer=${rendererName};`, { module, exports: module.exports, require: () => obsidian, console, structuredClone, setTimeout: fixtureTimeout, clearTimeout: clearFixtureTimeout, performance, TextEncoder, TextDecoder, MessageChannel, document, localStorage: rendererStorage, window: rendererWindow, devicePixelRatio: 1, getComputedStyle: () => ({ getPropertyValue: () => '' }), matchMedia: (query: string) => ({ get matches() { return query.includes('prefers-reduced-motion') && fixtureReducedMotion; }, addEventListener() {}, removeEventListener() {} }), ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame }, { filename: 'production-main.js' });
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
  const plugin: any = new GraphPlugin(); plugin.settings = defaults('links'); plugin.settings.visuals.labelStyle = 'ranked';
  const writes: any[] = []; plugin.saveData = async (data: any) => { writes.push(structuredClone(data)); };
  let requests = 0;
  const next = new Float32Array([80, 90, 82, 92, 300, 400]);
  plugin.pipeline = { request: async (_revision: number, request: any) => { expect(request.kind).toBe('recompute'); requests++; return { positions: next, milliseconds: 1, cached: false }; } };
  const view: any = new GraphView(null, plugin), stage = new Element(), p = projection(), visible = new Uint8Array([1, 1, 1]), positions = new Float32Array([0, 0, 2, 2, 100, 100]);
  const renderer = await Renderer.create(stage, p, positions, visible, plugin.settings, () => {}, () => {}, new Uint32Array(3), () => true, true, () => {}, renderView);
  renderers.push(renderer);
  Object.assign(view, { [compiled('statusSummary')]: new ControlElement(), activeRevision: 7, detailGeneration: 7, projection: p, positions, visible, colors: new Uint32Array(3), contentEl: { dataset: { mode: 'nodes' } }, stage, detailRenderer: renderer, renderer });
  Object.defineProperty(view, 'statusText', { configurable: true, get() { return this.statusMessage ?? ''; }, set(text: string) { this.statusMessage = text; } });
  renderer.camera = { x: .25, y: .4, ratio: 2 }; renderer.selected = 2;
  return { plugin, view, stage, renderer, writes, next, positions, requests: () => requests };
}
test('loading preview attaches pan and zoom while suppressing picking and retains the user camera', async () => {
  const f = await fixture({ loading: true }), r = f.renderer;
  expect(r.canvas.listeners.has('pointerdown')).toBe(true); expect(r.canvas.listeners.has('wheel')).toBe(true);
  expect(r.grid.heads).toBeUndefined(); expect(r.grid.next).toBeUndefined();
  const before = { ...r.camera }, input = r.controls();
  input[compiled('panBy')](30, 10); input[compiled('zoomAt')](1.2, 0, 0);
  expect(r.camera).not.toEqual(before); const moved = { ...r.camera };
  expect(input.pick(0, 0)).toBe(-1); expect(input[compiled('pickHub')](0, 0)).toBe(-1); expect(input[compiled('pickEdge')](0, 0)).toBe(-1);
  r[compiled('streamPositions')](f.next); expect(r.grid.heads).toBeUndefined(); expect(r.grid.positions).toBe(f.next); expect(r.camera).toEqual(moved); expect(r.overlay.hidden).toBe(true);
});

test('Reduced, Off and system reduced motion hold one Apply overview without losing progress or the user camera', async () => {
  for (const [motion, system] of [['reduced', false], ['off', false], ['full', true]] as const) {
    fixtureReducedMotion = system;
    try {
      const f = await fixture(), frames = [f.next.slice(), f.next.slice(), f.next.slice()], recycled: ArrayBuffer[] = [];
      f.plugin.settings.visuals = { ...f.plugin.settings.visuals, motion }; f.view[compiled('provisional')] = false; f.view.report = {};
      f.plugin.pipeline.recycle = (b: ArrayBuffer) => recycled.push(b);
      f.plugin.pipeline.request = async () => {
        frames.forEach((positions, i) => f.plugin.pipeline.onPositions({ revision: 7, iteration: i + 1, total: 8, positions }));
        expect(f.renderer.positions).toBe(frames[0]); expect(recycled).toEqual(frames.slice(1).map(p => p.buffer));
        f.plugin.pipeline.onProgress(7, 8); expect(f.view.report.progress.iteration).toBe(7);
        f.renderer.controls()[compiled('panBy')](20, 30); f.renderer.fitAll = () => { throw Error('Pan was undone'); };
        return { positions: f.next, milliseconds: 1, looksDone: true };
      };
      await f.view[compiled('applyLayout')](values); expect(f.renderer.positions).toBe(f.next); expect(f.view.statusText).toBe('Layout ready');
    } finally { fixtureReducedMotion = false; }
  }
});

test('Notes previews keep arriving on timer-backed draws when animation frames are withheld', async () => {
  const { WorkerPipeline } = await import('../src/pipeline');
  const f = await fixture(), sent: any[] = [], entered = deferred();
  const transport = { onmessage: null as any, onerror: null, terminate() {}, postMessage(m: any) { sent.push(m); if (m.kind === 'recompute') entered.resolve(); } };
  const pipeline = f.plugin.pipeline = new WorkerPipeline(transport, () => 10000);
  const tick = () => new Promise<void>(r => setTimeout(r, 0));
  const emit = (iteration: number) => { const positions = f.next.slice(); transport.onmessage({ data: { kind: 'positions', revision: 7, iteration, total: 100, positions } }); return positions; };
  const credits = () => sent.filter(m => m.kind === 'preview-credit').map(m => m.id);
  const raf = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  const work = outcome(f.view[compiled('applyLayout')](values));
  try {
    await entered.promise; const first = emit(1); await tick();
    expect(credits()).toEqual([1]); // first picture draws synchronously
    emit(2); const newest = emit(3); await tick(); expect(credits()).toEqual([1]);
    expect(f.renderer.positions).toBe(first); // no upload before the pending draw
    const delayedFrame = frameCallbacks.values().next().value!;
    expect(backstops.size).toBe(1); backstops.values().next().value!(); await tick();
    expect(credits()).toEqual([1, 1]); expect(f.renderer.positions).toBe(newest);
    delayedFrame(); await tick(); expect(credits()).toEqual([1, 1]); // even a late callback cannot acknowledge twice
    emit(4); await tick(); expect(credits()).toEqual([1, 1]);
    transport.onmessage({ data: { id: 1, revision: 7, result: { positions: f.next, milliseconds: 1, cached: false } } });
    const next = pipeline.request(7, { kind: 'layout', preview: { from: 1, wanted: true } });
    backstops.values().next().value!(); await tick();
    expect(credits()).toEqual([1, 1]); // late draw cannot credit the next pass, even at the same revision
    transport.onmessage({ data: { id: 2, revision: 7, result: {} } }); await next;
    expect(await work).toBe('success');
  } finally { pipeline.dispose(); await work; globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel; }
});

test('Stop layout remains beside status, sends one active revision and hides without removing its slot', async () => {
  const f = await fixture(), summary = f.view[compiled('statusSummary')]; let stopped = -1;
  const label = summary.createSpan({ text: 'Arranging notes' });
  f.plugin.pipeline.stopLayout = (revision: number) => { stopped = revision; };
  f.view[compiled('layoutControl')](true); const button = control(summary, 'Stop layout');
  const ring = f.view.layoutRing;
  expect(button.getAttribute('aria-label')).toBe('Stop layout'); expect(f.view.layoutTip.textContent).toBe('Stop layout');
  expect(button.getAttribute('type')).toBe('button');
  expect(ring.getAttribute('pathLength')).toBe('100'); expect(ring.getAttribute('stroke-dashoffset')).toBe('100');
  expect(summary.classes.has('graph-ng-layout-active')).toBe(true);
  expect(button.disabled).toBe(false);
  button.click(); expect(stopped).toBe(7); expect(button.disabled).toBe(true);
  expect(f.view.layoutStopped).toBe(true); expect(f.view.statusText).toBe('Stopping layout…');
  f.view[compiled('layoutControl')](false); expect(button.disabled).toBe(true); expect(summary.children[0]).toBe(label); expect(summary.classes.has('graph-ng-layout-active')).toBe(false);
  f.view[compiled('layoutControl')](true); expect(control(summary, 'Stop layout')).toBe(button); expect(button.disabled).toBe(false); expect(f.view.layoutStopped).toBe(false);
});


test('layout progress keeps shimmer and ring motion optional without a JavaScript animation clock', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css).toContain('background-clip:text'); expect(css).toContain('animation:gng-working 2s linear infinite');
  expect(css).toContain('@keyframes gng-working { from { background-position:100% 0; } to { background-position:0% 0; } }');
  expect(css).toContain('@media (prefers-reduced-motion:reduce) { .graph-ng-layout-stop circle.graph-ng-layout-ring { transition:none; } }');
  expect(css).toContain('.graph-ng-working { background:none; -webkit-text-fill-color:currentColor; }');
  expect(css).toContain('[data-motion=off] .graph-ng-layout-ring, [data-motion=reduced] .graph-ng-layout-ring { transition:none !important; }');
  expect(css).toContain('.graph-ng-summary :focus-visible { outline:2px solid var(--interactive-accent)');
});

test('compiled Canvas computes base radius once and preserves radii across zoom and preview', async () => {
  const { renderer: r } = await fixture(), baseKey = compiled('baseNodeRadius'), original = r[baseKey], oldArc = ctx.arc;
  let calls = 0; const arcs: number[][] = [];
  r[baseKey] = function() { calls++; return original.call(this); }; ctx.arc = (...a: number[]) => { arcs.push(a); };
  try {
    for (const ratio of [.25, 1, 4]) for (const preview of [false, true]) {
      r.camera.ratio = ratio;
      r[compiled('previewSizing')](preview ? { radius: 4, prominence: 2, compensation: .5, floor: .3, curve: 'log' } : null);
      const expected = [0, 1, 2].map(n => r[compiled('drawnRadius')](n, n === r.selected, r[compiled('focusLevel')]));
      calls = 0; arcs.length = 0; r[compiled('drawCanvas')]();
      expect(calls).toBe(1); expect(arcs.slice(0, 3).map(a => a[2])).toEqual(expected);
    }
  } finally { r[baseKey] = original; ctx.arc = oldArc; }
});
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
test('Apply rejects seed frames, streams on the same renderer and keeps pan/zoom while labels are hidden', async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), canvas = f.renderer.canvas;
  const frame = new Float32Array([10, 12, 20, 22, 400, 500]); let recycled = 0;
  f.view[compiled('provisional')] = false; f.view.report = {}; f.plugin.settings.persistLayout = true;
  const calls: string[] = []; f.plugin.pipeline.stopLayout = () => release.resolve();
  f.plugin.pipeline.recycle = () => recycled++;
  f.plugin.pipeline.request = async (_: number, r: any) => {
    calls.push(r.kind); if (r.kind === 'adoptLayout') return { cacheable: false };
    expect(f.view.layoutSteps.textContent).toBe('0 of 100 steps');
    expect(f.renderer.positions).toBe(f.positions); expect(f.renderer.overlay.hidden).toBe(true);
    f.plugin.pipeline.onPositions({ revision: 7, iteration: 0, total: 100, positions: new Float32Array(6) });
    expect(f.renderer.positions).toBe(f.positions);
    f.plugin.pipeline.onPositions({ revision: 7, iteration: 20, total: 100, positions: frame });
    entered.resolve(); await release.promise; return { positions: f.next, settled: false };
  };
  const work = f.view[compiled('applyLayout')](values); await entered.promise;
  expect(f.renderer.positions).toBe(frame); expect(f.renderer.canvas).toBe(canvas); expect(f.view.positions).toBe(f.positions); expect(recycled).toBe(1);
  const input = f.renderer.controls(); input[compiled('panBy')](30, 10); input[compiled('zoomAt')](1.2, 0, 0); const camera = { ...f.renderer.camera };
  expect(input.pick(0, 0)).toBe(-1); expect(f.view.statusMessage).toBe('Arranging notes');
  const action = control(f.view[compiled('statusSummary')], 'Explore now');
  expect(f.view.layoutSteps.textContent).toBe('20 of 100 steps'); expect(f.view.layoutTip.textContent).toBe('Finish this pass and use the current layout.');
  const preview = f.renderer.screenPoint(2); expect(input.pick(preview.x, preview.y)).toBe(-1);
  action.click(); await work;
  expect(calls).toEqual(['recompute', 'adoptLayout']); const final = f.renderer.screenPoint(2); expect(input.pick(final.x, final.y)).toBe(2);
  expect(f.renderer.positions).toBe(f.next); expect(f.renderer.camera).toEqual(camera); expect(f.renderer.overlay.hidden).toBe(false);
  expect(f.view[compiled('layoutWorking')]).toBe(false); expect(f.view.statusMessage).toBe('Layout not settled'); expect(f.view[compiled('statusSummary')].querySelector('.graph-ng-working')).toBeFalsy();
});
test('Keep refining respects a pan before Explore now without another gesture', async () => {
  const f = await fixture(), r = f.renderer; let fits = 0, pass = 0;
  r.fitAll = () => { fits++; }; f.plugin.pipeline.stopLayout = () => {};
  let camera: unknown;
  f.plugin.pipeline.request = async (_: number, request: any) => {
    if (request.kind === 'adoptLayout') return { cacheable: false };
    f.plugin.pipeline.onPositions({ revision: 7, iteration: 20, total: 100, positions: f.next.slice() });
    if (++pass === 1) { r.controls()[compiled('panBy')](30, 10); camera = { ...r.camera }; control(f.view[compiled('statusSummary')], 'Explore now').click(); }
    return { positions: f.next.slice(), settled: false };
  };
  await f.view[compiled('applyLayout')](values); await f.view[compiled('applyLayout')]({});
  expect(fits).toBe(0); expect(r.camera).toEqual(camera);
});
test('coordinate-only refinement adopts without writing settings', async () => {
  const f = await fixture(), calls: string[] = [];
  f.plugin.saveData = async () => { throw Error('Unexpected settings write'); };
  f.plugin.pipeline.request = async (_: number, request: any) => { calls.push(request.kind); return { positions: f.next, settled: false }; };
  await f.view[compiled('applyLayout')]({}); expect(calls).toEqual(['recompute', 'adoptLayout']); expect(f.renderer.positions).toBe(f.next);
});
test('provisional Apply restores the unverified properties summary without shimmer', async () => {
  const f = await fixture(); delete f.view.statusText; f.view.status = new ControlElement();
  f.view.contentEl.dataset.state = 'ready'; f.view.report = { [compiled('provisional')]: true, [compiled('pendingProperties')]: 691 };
  await f.view[compiled('applyLayout')](values);
  const summary = f.view[compiled('statusSummary')]; expect(summary.textContent).toContain('691 notes with unverified properties'); expect(summary.querySelector('.graph-ng-working')).toBeFalsy();
});
test('failed refinement announces an error rather than graph ready', async () => {
  const f = await fixture(); delete f.view.statusText; f.view.status = new ControlElement(); f.view.contentEl.dataset.state = 'ready';
  const live = f.view.stageAnnouncement = new ControlElement(); f.plugin.pipeline.request = async () => { throw Error('Synthetic failure'); };
  expect(await outcome(f.view[compiled('applyLayout')]({}))).toContain('Synthetic failure'); expect(live.textContent).toBe('Layout update failed');
});
test('worker reply retires stopped steps before coordinate preparation', async () => {
  const f = await fixture(); delete f.view.statusText; f.view.status = new ControlElement(); f.view.contentEl.dataset.state = 'ready';
  f.view.report = { [compiled('provisional')]: true }; f.plugin.pipeline.stopLayout = () => {};
  f.plugin.pipeline.request = async (_: number, req: any) => {
    if (req.kind === 'adoptLayout') return { cacheable: false };
    f.plugin.pipeline.onPositions({ revision: 7, iteration: 90, total: 100, positions: f.next.slice() });
    control(f.view[compiled('statusSummary')], 'Explore now').click(); return { positions: f.next, settled: false };
  };
  const key = compiled('preparePositions'), prepare = f.renderer[key].bind(f.renderer);
  f.renderer[key] = (...args: any[]) => { expect(f.view.report.progress).toBeUndefined(); const summary = f.view[compiled('statusSummary')].textContent; expect(summary).toContain('Preparing graph'); expect(summary).not.toContain('Stopping layout'); return prepare(...args); };
  await f.view[compiled('applyLayout')](values);
});
test('failed streamed Apply restores last-good geometry without undoing pan/zoom', async () => {
  const f = await fixture(), display = f.renderer.display;
  f.plugin.pipeline.request = async () => {
    f.plugin.pipeline.onPositions({ revision: 7, iteration: 20, total: 100, positions: new Float32Array([8, 9, 10, 11, 12, 13]) });
    f.renderer.controls()[compiled('panBy')](20, 10); return { positions: f.next };
  };
  f.plugin.saveData = async () => { throw Error('synthetic disk failure'); };
  expect(await outcome(f.view[compiled('applyLayout')](values))).toContain('synthetic disk failure');
  retained(f); expect(f.renderer.display).toBe(display); expect(f.renderer.overlay.hidden).toBe(false);
  expect(f.renderer.camera.x).not.toBe(.25); expect(f.plugin.pipeline.onPositions).toBeUndefined();
});
test('Apply updates zoom-out extent after expanded coordinates without reframing the camera', async () => {
  const f = await fixture(), camera = { ...f.renderer.camera }, frame = f.renderer[compiled('cameraFrame')];
  f.plugin.pipeline.request = async () => ({ positions: new Float32Array([0, 0, 200, 200, 20000, 20000]) });
  await f.view[compiled('applyLayout')](values);
  expect(f.renderer.camera).toEqual(camera); expect(f.renderer[compiled('cameraFrame')]).toBe(frame);
  f.renderer.controls()[compiled('zoomAt')](1000, 0, 0); expect(f.renderer.camera.ratio).toBeGreaterThan(100);
  expect(f.renderer[compiled('anchorKey')]).toEqual([]); expect(f.renderer[compiled('rankedKey')]).toEqual([]);
});
test('review: retained layout suppresses semantic actions but keeps pan and zoom', async () => {
  const f = await fixture(), r = f.renderer, k = (s: string) => mangle[s] ?? s, calls: string[] = [];
  r[k('onNode')] = () => calls.push('open'); r[k('travel')] = () => calls.push('travel'); r[k('showMenu')] = () => calls.push('menu');
  const finish = r[compiled('beginLayout')](), input = r.controls(), camera = { ...r.camera };
  input.open(2); input[k('travel')](2); input[k('showMenu')]([], 0, 0, 2);
  input[k('panBy')](30, 10); input[k('zoomAt')](1.2, 0, 0);
  expect(calls).toEqual([]); expect(input[k('openable')](2)).toBe(false); expect(r.camera).not.toEqual(camera);
  finish(false); input.open(2); expect(calls).toEqual(['open']);
});
test('review: streamed geometry updates zoom extents before final adoption', async () => {
  const f = await fixture(), r = f.renderer, finish = r[compiled('beginLayout')](), frame = r[compiled('cameraFrame')];
  const positions = new Float32Array([0, 0, 10000, 10000, 20000, 20000]);
  r[compiled('streamPositions')](positions);
  expect(r.grid.width).toBeGreaterThan(10000); expect(r.grid.positions).toBe(positions);
  r.controls()[compiled('zoomAt')](1000, 0, 0); expect(r.camera.ratio).toBeGreaterThan(100); expect(r[compiled('cameraFrame')]).toBe(frame);
  finish(false); expect(r.grid.positions).toBe(f.positions);
});
test('review: sizing invalidation during retained layout rebuilds labels on rollback', async () => {
  const f = await fixture(), r = f.renderer, finish = r[compiled('beginLayout')]();
  r[compiled('queueSizingLabels')](); await Bun.sleep(220); expect(r.atlas).toBeUndefined();
  finish(false); await Bun.sleep(220); expect(r.atlas).toBeDefined();
});
test('review: property promotion cannot erase active Apply progress', async () => {
  const f = await fixture(); f.view.groupGraph = {}; f.view.contentEl.dataset.state = 'ready';
  f.plugin.adapter = { [compiled('factsComplete')]: () => true, [compiled('linksPending')]: () => false, [compiled('pendingProperties')]: () => 0 };
  f.view[compiled('layoutWorking')] = true; f.view.statusText = 'Arranging notes';
  f.view[compiled('promoteProperties')](); expect(f.view.statusText).toBe('Arranging notes');
});
test('review: committed expanded coordinates rebuild minimap bounds without moving camera frame', async () => {
  const f = await fixture(), r = f.renderer, frame = r[compiled('cameraFrame')], camera = { ...r.camera };
  f.plugin.pipeline.request = async () => ({ positions: new Float32Array([0, 0, 10000, 10000, 20000, 20000]) });
  await f.view[compiled('applyLayout')](values); r[compiled('placeOverlay')]();
  const mini = r[compiled('miniMap')], state = mini[compiled('miniLast')];
  expect(state[compiled('layoutFrame')]?.width).toBeGreaterThan(10000);
  expect(r[compiled('cameraFrame')]).toBe(frame); expect(r.camera).toEqual(camera);
  const bounds = mini[compiled('miniShown')][0]; expect(bounds.minX + bounds.width).toBeGreaterThan(20000);
});
function retained(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.view.positions).toBe(f.positions); expect(f.renderer.positions).toBe(f.positions); expect(f.view.detailRenderer).toBe(f.renderer);
  expect(f.plugin.settings.layout.force.scalingRatio).toBe(2);
}

test('production software Apply preserves renderer/canvas/camera/frame/selection and changes picking once', async () => {
  const f = await fixture(), canvas = f.renderer.canvas, frame = f.renderer[compiled('cameraFrame')], camera = { ...f.renderer.camera }, center = [f.renderer[compiled('centerX')], f.renderer[compiled('centerY')], f.renderer.scale];
  const atlas = f.renderer.atlas;
  f.renderer.fitAll = () => { throw new Error('Fit after manual pan'); };
  const begin = f.renderer[compiled('beginLayout')].bind(f.renderer); f.renderer[compiled('beginLayout')] = () => { const finish = begin(); f.renderer.controls()[compiled('stopFlight')](); return finish; };
  Renderer.create = new Proxy(Renderer.create, { apply() { throw new Error('Renderer reconstructed'); } });
  try { await f.view[compiled('applyLayout')](values); } finally { Renderer.create = originalFactory; }
  expect(f.view.detailRenderer).toBe(f.renderer); expect(f.renderer.canvas).toBe(canvas); expect(f.renderer[compiled('cameraFrame')]).toBe(frame); expect(f.renderer.camera).toEqual(camera); expect([f.renderer[compiled('centerX')], f.renderer[compiled('centerY')], f.renderer.scale]).toEqual(center);
  expect(f.renderer.selected).toBe(2); expect(f.renderer.grid.pick(80, 90, .1)).toBe(0); expect(f.renderer.grid.pick(0, 0, .1)).toBe(-1);
  expect(f.renderer.positions).toBe(f.next); expect(f.renderer.atlas).not.toBe(atlas); expect(f.view.contentEl.dataset.mode).toBe('nodes'); expect(f.requests()).toBe(1); expect(f.writes.length).toBe(1);
});
test('settled Apply adopts only committed positions and persists through encode', async () => {
  const f = await fixture(), calls: string[] = [], generation = { meta: { key: 'refined' } };
  f.plugin.settings.persistLayout = true; f.view[compiled('provisional')] = false; f.plugin.adapter = { [compiled('linksResolved')]: true };
  f.plugin.pipeline.request = async (_revision: number, request: any) => {
    calls.push(request.kind);
    if (request.kind === 'recompute') return { positions: f.next, settled: true };
    expect(f.view.positions).toBe(f.next); expect(f.writes.length).toBe(1);
    return request.kind === 'adoptLayout' ? { cacheable: true } : generation;
  };
  f.plugin.cache = async (value: any, current: () => boolean) => { expect(value).toBe(generation); expect(current()).toBe(true); calls.push('cache'); };
  await f.view[compiled('applyLayout')](values);
  expect(calls).toEqual(['recompute', 'adoptLayout', 'encode', 'cache']);
  expect(f.view.contentEl.dataset.cacheError).toBe('');
});
test('failed settings save never adopts or persists a settled refinement', async () => {
  const f = await fixture(), calls: string[] = [];
  f.plugin.saveData = async () => { throw new Error('save rejected'); };
  f.plugin.pipeline.request = async (_revision: number, request: any) => { calls.push(request.kind); return { positions: f.next, settled: true }; };
  expect(await outcome(f.view[compiled('applyLayout')](values))).toContain('save rejected');
  expect(calls).toEqual(['recompute']); expect(f.view.positions).toBe(f.positions);
});
test('streaming follows growing extent until manual input, respecting disabled motion', async () => {
  const f = await fixture(), r = f.renderer;
  f.plugin.settings.visuals.motion = 'off';
  const finish = r[compiled('beginLayout')](), before = r.camera.ratio;
  r[compiled('streamPositions')](Float32Array.from(f.positions, (x: number) => x * 100));
  expect(r.camera.ratio).toBeGreaterThan(before);
  r.controls()[compiled('panBy')](12, 0); const held = { ...r.camera };
  r[compiled('streamPositions')](Float32Array.from(f.positions, (x: number) => x * 1000));
  expect(r.camera).toEqual(held); finish(true); expect(r.camera).toEqual(held);
});
const onScreen = (r: any, ids: number[]) => ids.map(i => r.screenPoint(i)).every(p => p.x >= 0 && p.x <= r.width && p.y >= 0 && p.y <= r.height);
test('batch 4 L3 Fit graph frames current coordinates of a small set after Apply without replacing the camera frame', async () => {
  const f = await fixture(); await f.view[compiled('applyLayout')](values); const frame = f.renderer[compiled('cameraFrame')];
  f.renderer.fitAll(0); expect(onScreen(f.renderer, [0, 1, 2])).toBe(true); expect(f.renderer[compiled('cameraFrame')]).toBe(frame);
});
test('batch 4 L3 adjacent: Fit graph after filtering to nodes outside the construction frame shows them', async () => {
  const f = await fixture(), r = await Renderer.create(f.stage, f.view.projection, f.positions, new Uint8Array([1, 1, 0]), f.plugin.settings, () => {}, () => {}, new Uint32Array(3), () => true, true, () => {}, {});
  renderers.push(r); r.setView(new Uint8Array([0, 0, 1]), {}); r.fitAll(0); expect(onScreen(r, [2])).toBe(true);
});
test('Fit all frames the connected notes, not a far ring of unconnected ones; under 8 connected frames everything', async () => {
  const fit = async (linkedCount: number) => {
    const n = 40, p: any = projection(n), pairs = Array.from({ length: linkedCount - 1 }, (_, i) => [i, i + 1] as const), degree = new Array(n).fill(0);
    for (const [a, b] of pairs) { degree[a]++; degree[b]++; }
    Object.assign(p, { source: Uint32Array.from(pairs, x => x[0]), target: Uint32Array.from(pairs, x => x[1]), type: new Uint32Array(pairs.length), types: ['link'], carrier: new Uint32Array(pairs.length).fill(0xffffffff), offsets: Uint32Array.from({ length: n + 1 }, (_, i) => degree.slice(0, i).reduce((s, d) => s + d, 0)) });
    // Connected notes in a small cluster; the rest on a ring 50 times wider, as a force layout leaves them.
    const positions = Float32Array.from({ length: n * 2 }, (_, k) => { const i = k >> 1, angle = i * 2 * Math.PI / n; return i < linkedCount ? (k % 2 ? i % 3 : i) * 2 : (k % 2 ? Math.sin(angle) : Math.cos(angle)) * 1000; });
    const r = await Renderer.create(new Element(), p, positions, new Uint8Array(n).fill(1), defaults('links'), () => {}, () => {}, new Uint32Array(n), () => true, true, () => {}, {});
    renderers.push(r); r.fitAll(0); return { r, ring: Array.from({ length: n - linkedCount }, (_, i) => linkedCount + i) };
  };
  const web = await fit(12), span = web.r.screenPoint(11).x - web.r.screenPoint(0).x;
  expect(onScreen(web.r, Array.from({ length: 12 }, (_, i) => i))).toBe(true); expect(span).toBeGreaterThan(web.r.width / 3);
  expect(web.ring.every(i => !onScreen(web.r, [i]))).toBe(true);
  const few = await fit(5); expect(onScreen(few.r, [...Array.from({ length: 5 }, (_, i) => i), ...few.ring])).toBe(true);
});
test('Fit all counts connected notes before sampling and ignores filtered endpoints and hidden types', async () => {
  const { renderer: r } = await fixture();
  const n = 20000, visible = new Uint8Array(n), positions = new Float32Array(n * 2), k = (name: string) => mangle[name] ?? name;
  const ids = [101, 103, 105, 107, 109, 111, 113, 114], source = Uint32Array.from(ids.slice(1), () => ids[0]!), target = Uint32Array.from(ids.slice(1));
  const p: any = { source, target, offsets: new Uint32Array(n + 1) };
  for (let e = 0; e < source.length; e++) { p.offsets[source[e]! + 1]++; p.offsets[target[e]! + 1]++; }
  for (let i = 1; i <= n; i++) p.offsets[i] += p.offsets[i - 1];
  for (const i of ids) { visible[i] = 1; positions[i * 2] = 100 + i; positions[i * 2 + 1] = 50; }
  visible[19100] = 1; positions[19100 * 2] = 10000; positions[19100 * 2 + 1] = 10000;
  // Old fitting sampled even absolute indices: one of eight connected notes, so it framed the far ring.
  let bounds: number[] = [];
  Object.assign(r, { projection: p, visible }); r[k('display')] = positions;
  r[k('filterVisible')] = visible; r[k('edgeOn')] = new Uint8Array(source.length).fill(1); r[k('hubs')] = [];
  r[k('cardInset')] = () => [0, 0]; r[k('clampRatio')] = (v: number) => v;
  r[k('frame')] = (...args: number[]) => { bounds = args.slice(0, 4); return 1; };
  r[k('flyTo')] = () => { throw Error('Nonempty view mistaken for empty'); };
  r.fitAll(0); expect(bounds).toEqual([201, 50, 214, 50]);
  // Seven currently connected notes: frame the unconnected distant note as well.
  visible[ids[7]!] = 0; r.fitAll(0); expect(bounds[2]).toBe(10000);
  // Eight visible notes with a hidden hub endpoint have no current connections.
  visible[ids[7]!] = 1; visible[ids[0]!] = 0; r.fitAll(0); expect(bounds[2]).toBe(10000);
  visible[ids[0]!] = 1; r[k('edgeOn')].fill(0); r.fitAll(0); expect(bounds[2]).toBe(10000);
  visible.fill(0); visible[ids[0]!] = 1; r.fitAll(0); expect(bounds).toEqual([201, 50, 201, 50]);
});
const originalFactory = Renderer.create;

test('production same-context upload reuses position/atlas textures, buffers and programs', async () => {
  const f = await fixture(), d = driver(f.renderer), canvas = f.renderer.canvas, programs = f.renderer[compiled('programs')], gl = f.renderer.gl;
  await f.view[compiled('applyLayout')](values);
  expect(f.renderer.gl).toBe(gl); expect(f.renderer.canvas).toBe(canvas); expect(Array.isArray(programs)).toBe(true); expect(f.renderer[compiled('programs')]).toBe(programs); expect(d.allocations()).toBe(0);
  expect(d.calls.filter(c => c[0] === 'sub').length).toBe(2); expect(d.calls.filter(c => c[0] === 'image').length).toBe(0); expect(f.requests()).toBe(1);
});

test('production collapsed geometry/picker/group framing/discs and label collisions follow new coordinates', async () => {
  const f = await fixture({ groupCodes: new Uint32Array([0, 0, 1]), groupLabels: ['one', 'two'], collapsed: new Uint8Array([1, 0]) });
  expect(f.renderer.hubs[0].x).toBe(1);
  await f.view[compiled('applyLayout')](values);
  expect(f.renderer.hubs[0].x).toBe(81); expect(f.renderer.hubs[0].y).toBe(91); expect(f.renderer.display[0]).toBe(81); expect(f.renderer.display[2]).toBe(81);
  expect(f.renderer.visible[0]).toBe(0); expect(f.renderer.coordinateState(f.next, f.view.visible, {}).picker.pick(80, 90, .1)).toBe(0);
  expect(f.renderer.atlas.nodes.every((nodes: Uint32Array) => !nodes.includes(0) && !nodes.includes(1))).toBe(true);
  let target: any; f.renderer.flyTo = (...args: any[]) => { target = args; }; f.renderer[compiled('frameGroup')](0); expect(target).toBeDefined();
});

test('production failed save/compensation retains CPU/display state, reports disk uncertainty, later Apply succeeds', async () => {
  const f = await fixture(), display = f.renderer.display; let count = 0;
  f.plugin.saveData = async () => { if (++count === 1) throw new Error('disk write failed'); };
  expect(await outcome(f.view[compiled('applyLayout')](values))).toContain('disk write failed'); retained(f); expect(f.renderer.display).toBe(display);
  f.plugin.saveData = async () => { throw new Error('disk unavailable'); };
  const error = await outcome(f.view[compiled('applyLayout')](values)); expect(error).toContain('restoring saved settings also failed'); expect(error).toContain('recovery uncertain'); retained(f);
  f.plugin.saveData = async () => {}; await f.view[compiled('applyLayout')](values); expect(f.renderer.positions).toBe(f.next);
});

test('production actual CPU preparation validates every coordinate, rejects stale viewport/theme/view/disposal', async () => {
  for (const next of [new Float32Array([1, 2]), new Float32Array([1, 2, 3, 4, NaN, 6]), new Float32Array([1, 2, 3, 4, 5, Infinity])]) {
    const f = await fixture(); expect(await outcome(prepare(f.renderer, next, () => true))).not.toBe('success'); retained(f);
  }
  for (const mode of ['resize', 'labels', 'theme', 'view', 'disposed', 'scope']) {
    const f = await fixture(), entered = deferred(), release = deferred(); let count = 0;
    f.plugin.saveData = async (data: any) => { f.writes.push(structuredClone(data)); if (++count === 1) { entered.resolve(); await release.promise; } };
    const pending = outcome(f.view[compiled('applyLayout')](values)); await entered.promise;
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
  const pending = f.view[compiled('applyLayout')](values); await entered.promise; f.plugin.settings.visuals.glow = .42; f.renderer.camera = { x: 7, y: 8, ratio: 4 };
  const ordinary = f.plugin.save(); release.resolve(); await Promise.all([pending, ordinary]);
  expect(f.writes.at(-1).settings.layout.force.scalingRatio).toBe(8); expect(f.writes.at(-1).settings.visuals.glow).toBe(.42); expect(f.renderer.camera).toEqual({ x: 7, y: 8, ratio: 4 });
  const g = await fixture(), start = deferred(), finish = deferred(); count = 0;
  g.plugin.saveData = async (data: any) => { g.writes.push(structuredClone(data)); if (++count === 1) { start.resolve(); await finish.promise; } };
  const first = outcome(g.view[compiled('applyLayout')](values)); await start.promise; g.view.activeRevision++; g.view.detailGeneration++;
  const second = outcome(g.view[compiled('applyLayout')]({ ...values, scalingRatio: 9 })); finish.resolve(); expect(await first).toContain('generation changed'); expect(await second).toBe('success'); expect(g.writes.at(-1).settings.layout.force.scalingRatio).toBe(9);
});

test('production upload failure restores last-good CPU/GPU state; lost context and failed rollback report uncertainty', async () => {
  for (const mode of ['once', 'lost', 'throw']) {
    const f = await fixture(), d = driver(f.renderer), atlas = f.renderer.atlas; d.fail(mode);
    const result = await outcome(f.view[compiled('applyLayout')](values)); expect(result).not.toBe('success'); retained(f); expect(f.renderer.atlas).toBe(atlas); expect(f.writes.length).toBe(2);
    if (mode === 'once') expect(result).toContain('GPU coordinate upload failed'); else expect(result).toContain('GPU recovery uncertain');
  }
});

test('production token discard/rollback cannot overwrite a newer winning token', async () => {
  const f = await fixture(), first = await prepare(f.renderer, f.next, () => true), second = await prepare(f.renderer, new Float32Array([9, 8, 7, 6, 5, 4]), () => true);
  expect(first.current()).toBe(false); expect(() => first.commit()).toThrow('generation changed'); first.discard(); second.commit();
  expect(() => first.rollback()).toThrow('owner changed'); expect([...f.renderer.positions]).toEqual([9, 8, 7, 6, 5, 4]); second.discard();
});


test('production sizing readout includes the device-pixel minimum', async () => {
  const f = await fixture();
  f.renderer[compiled('previewSizing')]({ radius: .16, prominence: 9, compensation: .92, floor: .885, curve: 'legacy' });
  expect(f.renderer[compiled('sizingReadout')]()).toContain('leaf 1.00 px; largest visible hub 1.00 px');
  f.renderer.dpr = 2;
  expect(f.renderer[compiled('sizingReadout')]()).toContain('leaf 0.50 px; largest visible hub 0.50 px');
  f.renderer.dispose();
});
test('production sizing preview/cancel keeps renderer camera selection scope settings and layout unchanged', async () => {
  const f = await fixture(); f.plugin.settings.visuals.emphasis = 'scale';
  const original = structuredClone(f.plugin.settings), camera = { ...f.renderer.camera }, positions = f.renderer.positions, canvas = f.renderer.canvas;
  const value = { radius: 12, prominence: 5, compensation: 0, floor: .3, curve: 'sqrt' as const };
  f.renderer[compiled('previewSizing')](value);
  expect(f.plugin.settings).toEqual(original); expect(f.writes.length).toBe(0); expect(f.requests()).toBe(0);
  expect(f.renderer.camera).toEqual(camera); expect(f.renderer.selected).toBe(2); expect(f.renderer.positions).toBe(positions); expect(f.renderer.canvas).toBe(canvas);
  expect(f.renderer[compiled('sizingReadout')]()).toContain('leaf 12.00 px; largest visible hub 12.00 px');
  const point = f.renderer.screenPoint(2); expect(f.renderer.pick(point.x + 16, point.y)).toBe(2);
  const radii: number[] = []; ctx.arc = (_x: number, _y: number, radius: number) => radii.push(radius);
  f.renderer[compiled('drawCanvas')](); expect(radii.slice(0, 2)).toEqual([12, 12]);
  // The selected note is the graduated focus: radius 14 grows by 60% at full focus and gains its ring stroke.
  const level = f.renderer[compiled('focusLevel')]; [14 * (1 + .6 * level), 14 * (1 + .6 * level) * 1.22].slice(0, level ? 2 : 1).forEach((v, i) => expect(radii[2 + i]!).toBeCloseTo(v, 9));
  await f.renderer[compiled('prepareLabels')](() => true);
  expect(f.renderer.atlas.levels.every((level: Float32Array) => level.length % 13 === 0)).toBe(true);
  const populated = f.renderer.atlas.levels.find((level: Float32Array) => level.length > 0); expect(populated).toBeDefined(); expect(populated[10]).toBe(1);
  // Each label leads with one plate row (atlas v = 2) spanning every one of its padded glyph quads.
  for (const level of f.renderer.atlas.levels as Float32Array[]) for (let i = 0; i < level.length;) {
    expect(level[i + 6]).toBe(2); const node = level[i]!, left = level[i + 1]!, right = left + level[i + 3]!;
    for (i += 13; i < level.length && level[i + 6] !== 2; i += 13) { expect(level[i]).toBe(node); expect(level[i + 1]).toBeGreaterThanOrEqual(left); expect(level[i + 1]! + level[i + 3]!).toBeLessThanOrEqual(right + 1e-4); }
  }
  f.renderer[compiled('previewSizing')](null); expect(f.renderer.pick(point.x + original.nodeSize * (1 + original.visuals.degreeSizing) * (1 + .6 * level) + 5, point.y)).not.toBe(2); expect(f.plugin.settings).toEqual(original); expect(f.renderer.camera).toEqual(camera);
});

test('production sizing apply acknowledgement and rejected save preserve last-saved policy', async () => {
  const f = await fixture(), value = { radius: 6, prominence: 9, compensation: .5, floor: .2, curve: 'linear' as const }, camera = { ...f.renderer.camera };
  f.renderer[compiled('previewSizing')](value); await f.plugin[compiled('commitSizing')](value, () => true); f.renderer[compiled('previewSizing')](null, true);
  expect(f.plugin.settings.nodeSizing.policy).toBe('predictable'); expect(f.plugin.settings.nodeSize).toBe(6); expect(f.renderer.camera).toEqual(camera); expect(f.renderer.selected).toBe(2); expect(f.requests()).toBe(0);
  const saved = structuredClone(f.plugin.settings); let calls = 0; f.plugin.saveData = async () => { if (++calls === 1) throw new Error('synthetic failure'); };
  f.renderer[compiled('previewSizing')]({ ...value, radius: 10 });
  await expect(f.plugin[compiled('commitSizing')]({ ...value, radius: 10 }, () => true)).rejects.toThrow('synthetic failure'); f.renderer[compiled('previewSizing')](null, true);
  expect(f.plugin.settings).toEqual(saved); expect(calls).toBe(2);
});


test('Repair R2 carrier-size edits invalidate stale label multipliers and coalesce without relayout', async () => {
  const f = await fixture(), v = { radius: 10, prominence: 1, compensation: 0, floor: .3, curve: 'log' as const }, camera = { ...f.renderer.camera }, positions = f.renderer.positions;
  f.renderer.projection.carrierNodes[0] = 1; f.plugin.settings.visuals.carrierLod = false;
  f.renderer.setView(new Uint8Array([1, 0, 0]), {});
  await f.plugin[compiled('commitSizing')](v, () => true); f.renderer[compiled('previewSizing')](null, true);
  await f.renderer[compiled('prepareLabels')](() => true);
  const multiplier = () => f.renderer.atlas.levels.find((level: Float32Array) => level.length > 0)[10];
  expect(multiplier()).toBeCloseTo(.6);
  f.plugin.settings.visuals.carrierSize = 1; f.renderer.refreshVisuals(false); const firstTimer = f.renderer[compiled('sizingTimer')];
  expect(f.renderer.atlas).toBeUndefined(); expect(firstTimer).toBeDefined();
  f.plugin.settings.visuals.carrierSize = 2; f.renderer.refreshVisuals(false);
  expect(f.renderer[compiled('sizingTimer')]).not.toBe(firstTimer); expect(f.renderer.atlas).toBeUndefined();
  await f.renderer[compiled('prepareLabels')](() => true);
  expect(multiplier() * 10).toBeCloseTo(20);
  const atlas = f.renderer.atlas, timer = f.renderer[compiled('sizingTimer')]; f.renderer.refreshVisuals(false);
  expect(f.renderer.atlas).toBe(atlas); expect(f.renderer[compiled('sizingTimer')]).toBe(timer);
  const radii: number[] = []; ctx.arc = (_x: number, _y: number, radius: number) => radii.push(radius); f.renderer[compiled('drawCanvas')]();
  // This fixture has no declared legs: an orphan relationship dot must stay hidden.
  expect(radii).toEqual([]); expect(f.renderer[compiled('drawnRadius')](0, false, 0)).toBe(20); expect(f.renderer.camera).toEqual(camera); expect(f.renderer.positions).toBe(positions); expect(f.renderer.selected).toBe(2); expect(f.requests()).toBe(0);
});


test('Repair R2 legacy carrier edit retains existing atlas and creates no sizing rebuild', async () => {
  const f = await fixture(), atlas = f.renderer.atlas;
  expect(f.plugin.settings.nodeSizing.policy).toBe('legacy'); f.plugin.settings.visuals.carrierSize = 2; f.renderer.refreshVisuals(false);
  expect(f.renderer.atlas).toBe(atlas); expect(f.renderer[compiled('sizingTimer')]).toBeUndefined(); expect(f.requests()).toBe(0);
});

// Driver/Canvas calls from the production bundle; no GPU execution is claimed.
test('UX production Canvas detail honors zero and fractional opacity without changing graph rows', async () => {
  const {r, k: key, settings} = await graduated([[0,1]], 2);
  const stroke = ctx.stroke; let calls: number[] = []; ctx.stroke = () => calls.push(ctx.globalAlpha);
  try { for (const opacity of [0, .00001, .2]) { calls = []; settings.visuals.edgeOpacity = opacity; r[key('drawCanvas')](); expect(calls.length).toBe(opacity ? 1 : 0); if (opacity) { expect(calls[0]).toBeGreaterThan(0); expect(calls[0]).toBeLessThanOrEqual(opacity * 3.75); } expect(r.projection.source.length).toBe(1); } } finally { ctx.stroke = stroke; }
});
test('Edges mode in production Canvas: Off draws no lines, Focus only draws none until a note is focused', async () => {
  const {r, k: key, settings} = await graduated([[0,1]], 2), v = settings.visuals;
  const stroke = ctx.stroke; let calls: number[] = []; ctx.stroke = () => calls.push(ctx.globalAlpha);
  try {
    v.edgeOpacity = .2;
    for (const [mode, lines] of [['all', 1], ['focus', 0], ['off', 0]] as const) { calls = []; v.edgeMode = mode; r[key('drawCanvas')](); expect(calls.length).toBe(lines); }
    expect(r.projection.source.length).toBe(1);
  } finally { ctx.stroke = stroke; v.edgeMode = 'all'; }
});
test('UX production WebGL scheduling omits edges at zero even with hover/focus, preserves context', async () => {
  const f = await fixture(), r = f.renderer, key = (name: string) => typeof mangle[name] === 'string' ? mangle[name] : name;
  let current = -1; const draws: number[] = [], alphas: number[] = [];
  const gl: any = new Proxy({ useProgram: (handle: number) => { current = handle; }, uniform1f: (name: string, value: number) => { if (name === 'edgeAlpha') alphas.push(value); }, drawArraysInstanced: () => draws.push(current), drawElementsInstanced: () => draws.push(current) }, { get: (o: any, k: string) => k in o ? o[k] : k.toUpperCase() === k ? 1 : () => {} });
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
    r.selected = 0; r[key('theme')].palette[19] = 128; records.length = 0; r[key('drawCanvas')](); expect(records.at(-1)!.alpha).toBe(128 / 255); expect(records.at(-1)!.radius).toBe(f.plugin.settings.nodeSize + 2);
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
async function graduated(pairs: [number, number][], n = 5, max = 0, paths?: string[], xy?: Float32Array) {
  const settings = defaults('links'), opened: number[] = [], p: any = projection(n);
  settings.visuals.labelStyle = 'ranked'; // Existing graduated-label fixtures explicitly exercise the legacy style.
  if (paths) p.paths = encodeStrings(paths);
  if (max) { settings.canvasMaxDetailNodes = max; settings.canvasMaxDetailEdges = max; }
  Object.assign(p, { source: Uint32Array.from(pairs, x => x[0]), target: Uint32Array.from(pairs, x => x[1]), type: new Uint32Array(pairs.length), types: ['link'], carrier: new Uint32Array(pairs.length).fill(0xffffffff) });
  const positions = xy ?? Float32Array.from({ length: n * 2 }, (_, i) => i % 2 ? (i >> 1) * 37 % 100 : (i >> 1) * 50);
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
for (const count of [20000, 80]) test(`default software Notes keeps ${count} notes and dense relationships with bounded paint`, async () => {
  const settings = defaults('links'), p = projection(count), m = 30000, visible = new Uint8Array(count).fill(1);
  p.source = Uint32Array.from({ length: m }, (_, i) => i % count); p.target = p.source.map(n => (n + 1) % count);
  for (let e = 0; e < m; e++) { p.offsets[p.source[e]! + 1]!++; p.offsets[p.target[e]! + 1]!++; }
  for (let i = 1; i <= count; i++) p.offsets[i]! += p.offsets[i-1]!;
  p.type = new Uint32Array(m); p.carrier = new Uint32Array(m).fill(0xffffffff);
  const positions = Float32Array.from({ length: count * 2 }, (_, i) => i % 2 ? Math.floor((i >> 1) / 200) : (i >> 1) % 200);
  const r = await Renderer.create(new Element(), p, positions, visible, settings, () => {}, () => {}, new Uint32Array(count), () => true, true); renderers.push(r);
  expect(r.gpu).toBe(false); expect(r.visible).toBe(visible); expect(r.positions).toBe(positions); expect(r.projection.source.length).toBe(m);
  const fill = ctx.fill, move = ctx.moveTo; let dots = 0, lines = 0;
  try {
    ctx.fill = () => { dots++; }; ctx.moveTo = () => { lines++; }; r[compiled('drawCanvas')]();
    expect(dots).toBeGreaterThan(0); expect(dots).toBeLessThanOrEqual(settings.canvasMaxDetailNodes); expect(lines).toBeGreaterThan(0); expect(lines).toBeLessThanOrEqual(settings.canvasMaxDetailEdges);
    expect(r.canvasHint.hidden).toBe(false); expect(r.canvasHint.textContent).toBe(count === 20000 ? 'Sampled notes and connections' : 'Sampled connections');
    if (count === 20000) {
      const omitted = Array.from(visible.keys()).find(n => !r.paintedDots.has(n))!;
      r[compiled('focusNote')](omitted); r[compiled('drawCanvas')](); expect(r.selected).toBe(omitted); expect(r.paintedDots.has(omitted)).toBe(true);
      const n = count - 1; r.setCamera(1, 1, .02); r[compiled('drawCanvas')](); const point = r.screenPoint(n);
      expect(r.pick(point.x, point.y)).toBe(n);
    }
    const narrow = new Uint8Array(count); narrow[0] = narrow[1] = 1; r.setView(narrow, {}); expect(r.canvasHint.hidden).toBe(true);
  } finally { ctx.fill = fill; ctx.moveTo = move; }
});
test('offscreen connection rings leave room for an unrelated visible pick', async () => {
  const n = 400, xy = Float32Array.from({length: 2*n}, (_,i) => i%2 ? Math.floor((i>>1)/20) : (i>>1)%20);
  const {r,k} = await graduated(Array.from({length: 250}, (_,i) => [0,i+1]),n,32,undefined,xy);
  r[k('focusNote')](0,true); r[k('animateLens')](performance.now()+1000); r.setCamera(1,1,.02); r[k('drawCanvas')]();
  expect(r[k('lensRows')].length).toBe(31); const p = r.screenPoint(n-1); expect(r.pick(p.x,p.y)).toBe(n-1);
});
test('folded relationship dots do not reserve slots in the ordinary note sample', async () => {
  const n = 256, pairs: [number,number][] = [];
  for (let i = 0; i < n; i += 2) pairs.push([i,i+1],[i+1,(i+2)%n]);
  const {r,k,settings} = await graduated(pairs,n,n/2);
  r.projection.carrier = Uint32Array.from({length:n}, (_,i) => (i>>1)*2+1);
  r.projection.carrierNodes = Uint32Array.from({length:n},(_,i) => i%2 ? i+1 : 0); r[k('carrierCount')] = n/2;
  settings.visuals.carrierLines = 'direct'; r.setView(new Uint8Array(n).fill(1),{}); r[k('drawCanvas')]();
  expect([...r.paintedDots].sort((a,b) => Number(a)-Number(b))).toEqual(Array.from({length:n/2},(_,i) => 2*i));
});
test('streamed Canvas poses reuse one membership index and publish exact geometry only at commit', async () => {
  const n = 256, { r, k } = await graduated([], n, 16), original = r.positions;
  const index = () => r[k('canvasIndex')], initial = index(), make = r[k('makeCanvasIndex')].bind(r);
  const builds: { index: any; bytes: number }[] = [];
  r[k('makeCanvasIndex')] = (...args: any[]) => {
    const built = make(...args), arrays = new Set<Uint32Array>([built.ids, ...built[k('levels')]]);
    builds.push({ index: built, bytes: [...arrays].reduce((sum, a) => sum + a.byteLength, 0) }); return built;
  };
  const pose = (phase: number) => Float32Array.from({ length: n * 2 }, (_, j) =>
    j % 2 ? (j >> 1) % 16 + phase : ((j >> 1) * 31 % n) + phase * n);
  const assertExact = (xy: Float32Array) => {
    expect(r.positions).toBe(xy); expect(r.grid.positions).toBe(xy);
    // Every new coordinate resolves its own row, not an approximate overview or the previous pose.
    for (let i = 0; i < n; i++) {
      const hits: number[] = []; index()[k('sample')](xy[2*i], xy[2*i+1], 0, 0, 16, (id: number) => hits.push(id));
      expect(hits).toEqual([i]);
    }
  };
  for (const commit of [false, true]) {
    builds.length = 0; const finish = r[k('beginLayout')]();
    for (let j = 1; j <= 4; j++) {
      const next = pose(j); r[k('streamPositions')](next, 'drawing');
      expect(r.positions).toBe(next); expect(r.grid.positions).toBe(next);
    }
    expect(builds.map(b => b.bytes)).toEqual([n * 4]);
    const transient = index(); expect(transient).toBe(builds[0]!.index); expect(transient[k('levels')]).toHaveLength(0);
    expect(transient[k('bounds')]).toBeUndefined(); // previous pose buffers are recyclable
    const final = pose(5), token = await prepare(r, final, () => true);
    expect(builds).toHaveLength(2); const exact = builds[1]!.index;
    expect(builds[1]!.bytes).toBe(initial[k('levels')].length * n * 4);
    expect(index()).toBe(transient); expect(r.positions).not.toBe(final);
    token.commit(); expect(index()).toBe(exact); assertExact(final);
    if (!commit) { token.rollback(); expect(index()).toBe(transient); }
    token.discard(); finish(commit);
    expect(index()).toBe(commit ? exact : initial); assertExact(commit ? final : original);
    expect(builds).toHaveLength(2);
  }
});
test('stream rollback after a filter change indexes the original pose with current membership', async () => {
  const n = 64, { r, k } = await graduated([], n, 8), original = r.positions, index = () => r[k('canvasIndex')];
  const finish = r[k('beginLayout')](), moved = original.map((v: number) => v + 20000);
  r[k('streamPositions')](moved, 'drawing'); const all = index();
  const visible = Uint8Array.from({ length: n }, (_, i) => i % 2); r.setView(visible, {});
  r[k('streamPositions')](moved.slice(), 'drawing'); expect(index()).not.toBe(all);
  expect([...index().ids]).toEqual(Array.from({ length: n / 2 }, (_, i) => 2*i+1));
  finish(false); expect(r.positions).toBe(original); expect(index()[k('bounds')]).toBe(r.grid);
  for (let i = 0; i < n; i++) {
    const hits: number[] = []; index()[k('sample')](original[2*i], original[2*i+1], 0, 0, 8, (id: number) => hits.push(id));
    expect(hits).toEqual(i % 2 ? [i] : []);
  }
});
test('lost or disposed renderer cannot adopt a prepared Canvas index', async () => {
  for (const dispose of [false, true]) {
    const { r, k } = await graduated([], 64, 16), original = r.positions, initial = r[k('canvasIndex')];
    const finish = r[k('beginLayout')](); r[k('streamPositions')](original.slice(), 'drawing');
    const token = await prepare(r, original.slice(), () => true);
    if (dispose) r.dispose(); else r.canvas.listeners.get('webglcontextlost')({ preventDefault() {} });
    expect(token.current()).toBe(false); expect(() => token.commit()).toThrow(); token.discard(); finish(false);
    if (!dispose) { expect(r.positions).toBe(original); expect(r[k('canvasIndex')]).toBe(initial); }
    r.dispose(); expect(r[k('canvasIndex')]).toBeUndefined();
  }
});
test('selected and path geometry get a whole unit; disabled and non-fitting units yield their slots', async () => {
  const m = 60, pairs: [number,number][] = Array.from({length:m}, () => [0,1]);
  pairs.push([2,3],[3,4],[2,3],[3,5]);
  const {r,k,settings} = await graduated(pairs,6,4), v = new Uint8Array(6).fill(1);
  const legs = [m,m+1,m+2,m+3]; r.projection.carrier.fill(3,m); r.projection.carrierNodes[3] = 4; r[k('carrierCount')] = 1;
  settings.visuals.carrierLines = 'through'; r.setView(v,{}); r[k('focusNote')](3); r[k('drawCanvas')]();
  expect([...r[k('canvasEdges')]]).toEqual(legs);
  r[k('findPath')](2,4); r[k('emphasize')](true); r[k('drawCanvas')]();
  expect(r[k('pathView')].edges).toEqual([m,m+1]); expect([...r[k('canvasEdges')]]).toEqual(legs);
  for (const e of legs) expect(r.paintedLines.has(e)).toBe(true);
  settings.canvasMaxDetailEdges = 3; r.setView(v,{}); const rows = () => [...r[k('canvasEdges')]] as number[];
  expect(rows()).toHaveLength(3); expect(rows().every(e => e < m)).toBe(true);
  const masked = v.slice(); masked[4] = masked[5] = 0; settings.canvasMaxDetailEdges = m+1; r.setView(masked,{}); r[k('drawCanvas')]();
  expect(rows()).toEqual(Array.from({length:m},(_,i) => i)); expect(r.paintedLines.size).toBeGreaterThan(0);
});
// Complete synthetic geometry through real setView, focus/path, Canvas draw and pick.
// Owner is the synthetic relationship note index, not a parsed key.
async function admissionFixture(n: number, links: [number, number, number?][], xy?: Float32Array) {
  const f = await graduated(links.map(([a,b]) => [a,b]), n, 0, undefined, xy ?? Float32Array.from({length:2*n}, (_,i) => i%2 ? Math.floor((i>>1)/100) : (i>>1)%100));
  const {r,k,settings} = f, p = r.projection, mask = new Uint8Array(n).fill(1);
  p.carrierNodes = new Uint32Array(n);
  links.forEach(([a,b,owner],e) => { p.offsets[a+1]++; p.offsets[b+1]++; if (owner !== undefined) { p.carrierNodes[owner] = owner+1; p.carrier[e] = owner; } });
  for (let i=1;i<=n;i++) p.offsets[i] += p.offsets[i-1];
  r[k('carrierCount')] = p.carrierNodes.reduce((sum: number, id: number) => sum + +!!id, 0);
  settings.visuals.carrierLines = 'through'; settings.visuals.motion = 'off';
  r.setView(mask,{});
  const draw = () => r[k('drawCanvas')](), rows = (): number[] => [...r[k('canvasEdges')]], center = (node: number) => {
    const f = r[k('cameraFrame')]; r.setCamera((r.positions[2*node]-f.minX)/f.width,(r.positions[2*node+1]-f.minY)/f.height,.02);
  };
  return {...f, draw, rows, center, mask};
}
test('software admission: a retained star reserves only its owned rows and endpoints, never the component', async () => {
  const links: [number,number,number?][] = [];
  for (let i=1;i<=6;i++) links.push([i-1,i,i],[i,7,i]);
  links.push([8,9],[9,10],[10,11],[8,9],[9,10],[10,11]);
  const {r,k,settings,draw,rows,mask} = await admissionFixture(12,links);
  settings.canvasMaxDetailEdges = 10; settings.visuals.carrierOpacity = 0; r.setView(mask,{}); draw();
  expect(rows()).toEqual([12,13,14,15,16,17]); expect([...r.paintedLines].sort()).toEqual(rows().sort());
  settings.visuals.carrierOpacity = 1; r[k('focusNote')](2); r[k('edgeQuiet')] = () => [1,Infinity]; draw();
  expect(rows().filter(e => e<12)).toEqual([2,3]); expect(r.paintedDots.has(1)).toBe(true); expect(r.paintedDots.has(2)).toBe(true);
  expect(r.paintedDots.has(3)).toBe(false);
  // Even when the rest fits the hard cap, a low ink share suppresses its context.
  settings.canvasMaxDetailEdges = 16; r.setView(mask,{}); r[k('edgeQuiet')] = () => [.2,Infinity]; draw();
  expect(rows().filter(e => e<12)).toHaveLength(12); expect([...r.paintedLines].filter(e => Number(e)<12).sort()).toEqual([2,3]);
  r[k('focusNote')](11); r.fitAll(0); r.hovered = 2; r[k('animate')](performance.now()); draw();
  expect([...r.paintedLines].filter(e => Number(e)<12).sort()).toEqual([2,3]);
});
test('software admission: exact cap and one unusable row over it have the same drawable ink pool', async () => {
  const links: [number,number,number?][] = []; for (let i=0;i<9951;i++) links.push([1+i%100,0,0],[0,101+Math.floor(i/100),0]);
  for (let i=201;i<251;i++) links.push([i,i+1]);
  const {r,k,draw,rows,mask} = await admissionFixture(2300,links); mask.fill(0,101,201);
  // Mask the final incoming leg separately via the existing type filter.
  r.projection.type[19900] = 1;
  for (const extra of [false,true]) {
    r.setView(mask,{[compiled('typeHidden')]:new Uint8Array([0,+!extra])}); draw();
    expect(r[k('visibleEdges')]).toBe(10000 + +extra); expect(rows()).toHaveLength(50); expect(r.paintedLines.size).toBe(50);
  }
});
test('software admission: a rejected relationship center cannot paint or intercept a hit even when selected', async () => {
  const {r,k,settings,mask,center,draw,rows} = await admissionFixture(10,[[0,1,1],[1,2,1],[0,1,1],[1,3,1],[6,7]]);
  settings.canvasMaxDetailEdges = 3; settings.visuals.zoomAdapt = false; r.setView(mask,{}); r[k('focusNote')](1); center(1); draw();
  expect(rows()).toEqual([4]); expect(r.paintedDots.has(1)).toBe(false); expect(r.pick(400,300)).not.toBe(1);
});
test('software admission: the only eligible focus center paints and picks ahead of coincident inactive centers', async () => {
  const m=4000, xy=new Float32Array(6*m), links: [number,number,number?][]=[];
  xy.fill(10000,2*m); for (let i=0;i<m;i++) links.push([m+i,i,i],[i,2*m+i,i]);
  const {r,k,settings,draw} = await admissionFixture(3*m,links,xy);
  settings.visuals.edgeMode='focus'; settings.visuals.zoomAdapt=false; r[k('focusNote')](m); r.setCamera(0,0,.02); draw();
  expect([...r.paintedDots]).toEqual([0]); expect(r.pick(400,300)).toBe(0); expect(r.paintedLines.size).toBe(2);
});
test('software admission: rejected neighbors cannot hide the only admitted relationship center', async () => {
  const m = 5001, n = m + 2105, links: [number, number, number?][] = [], xy = new Float32Array(n * 2);
  for (let i = 1; i <= m; i++) {
    links.push([i === 1 ? m + 2 : i - 1, i, i], [i, m + 1, i]);
    xy[2*i] = 1 + i % 70; xy[2*i+1] = 1 + Math.floor(i / 70);
  }
  links.push([m+3, 0, 0], [0, m+4, 0]); xy.fill(10000, 2*(m+1)); xy[2*(m+3)+1] = xy[2*(m+4)] = 0;
  const {r, settings, mask, draw} = await admissionFixture(n, links, xy);
  Object.assign(settings.visuals, defaults('links').visuals, {motion:'off'});
  for (const hideNeighbors of [false, true]) {
    if (hideNeighbors) mask.fill(0, 1, m+1);
    r.setView(mask, {}); r.setCamera(0, 0, .02); draw();
    expect(r.paintedLines.size).toBe(2); expect(r.paintedDots.has(0)).toBe(true);
    expect(r.pick(400,300)).toBe(0);
  }
});
test('software admission: a highlighted hop reserves its joining dot without creating another semantic hop', async () => {
  const {r,k,settings,draw} = await admissionFixture(4100,[[1,0,0],[0,2,0]]); settings.visuals.zoomAdapt=false;
  r[k('findPath')](1,2); r.fitAll(0); draw(); expect(r[k('pathView')].hops).toHaveLength(1);
  for (const n of [0,1,2]) expect(r.paintedDots.has(n)).toBe(true); expect(r.paintedLines.size).toBe(2);
});
test.each([20,3000])('software admission: zero-alpha context is not a hit in a %i-note view', async n => {
  const {r,k,settings,draw,center} = await admissionFixture(n,[[0,1]]);
  settings.visuals.dimOpacity=0; r[k('focusNote')](0); center(10); draw();
  const point = r.screenPoint(10); expect(r.paintedDots.has(10)).toBe(false); expect(r.pick(point.x,point.y)).not.toBe(10);
  center(0); draw(); const focus = r.screenPoint(0); expect(r.pick(focus.x,focus.y)).toBe(0);
});
test('warm sampled paints visit bounded candidates, also with a focused hub and overlays', async () => {
  const n = 30000, m = 60000, cap = 160, {r,k} = await graduated(Array.from({length: m}, (_,i) => [0,1 + i%(n-1)]), n, cap);
  const draw = () => r[k('draw')](), visits = {visible: 0, source: 0, predicate: 0, candidates: 0, spatial: 0};
  const measure = (array: Uint8Array | Uint32Array | Float32Array, key: 'visible' | 'source' | 'spatial') => new Proxy(array, {get(a,k) {
    if (typeof k === 'string' && /^\d+$/.test(k)) visits[key]++;
    const v = Reflect.get(a,k,a); return typeof v === 'function' ? v.bind(a) : v;
  }});
  r.visible = measure(r.visible,'visible'); r.projection.source = measure(r.projection.source,'source');
  const index = r[k('canvasIndex')], sample = index[k('sample')].bind(index), edge = r[k('edgeDrawn')];
  r.grid.positions = measure(r.grid.positions, 'spatial');
  index[k('sample')] = (x: number,y: number,w: number,h: number,c: number,add: (n: number) => void,mask: number) => sample(x,y,w,h,c,(n: number) => { visits.candidates++; add(n); },mask);
  r[k('edgeDrawn')] = (e: number) => { visits.predicate++; return edge(e); };
  for (const focused of [false,true]) {
    if (focused) { r[k('focusNote')](0,true); r[k('emphasize')](true); }
    draw(); for (const key of Object.keys(visits) as (keyof typeof visits)[]) visits[key] = 0;
    draw(); expect(visits.candidates).toBeGreaterThan(0); expect(visits.candidates).toBeLessThanOrEqual(4*cap);
    expect(visits.spatial).toBeLessThan(2000); expect(visits.visible).toBeLessThan(10*cap);
    expect(visits.predicate).toBeGreaterThan(0); expect(visits.predicate).toBeLessThanOrEqual(3*cap);
    expect(visits.source).toBeLessThan(16*cap);
  }
});
test('sampled Canvas replays a stationary hover after publishing the new painted set', async () => {
  const { r, k, hover } = await graduated([[0, 1],[0, 1],[0, 1],[0, 1],[0, 1],[0, 1]], 5, 5);
  hover(2); expect(r.hovered).toBe(2);
  r.setView(new Uint8Array(5).fill(1), {}); r[k('draw')](); expect(r.hovered).toBe(2);
});
test('sampled Canvas picks a painted lifted tier before a closer background centre', async () => {
  const { r, k } = await graduated(Array.from({length: 6}, () => [0, 1]), 5, 5, undefined, Float32Array.of(0,0,350,350,2,0,400,0,0,400));
  r[k('focusNote')](0); r[k('emphasize')](true); r[k('drawCanvas')]();
  const p = r.screenPoint(2); expect(r.paintedDots.has(2)).toBe(true); expect(r.pick(p.x,p.y)).toBe(0);
});
test('selection names survive an edge-only budget with focus highlighting disabled', async () => {
  const { r,k,settings } = await graduated(Array.from({length: 6}, () => [0,1]), 5, 5);
  settings.visuals.labelStyle = 'anchored'; settings.visuals.namePriority = 'selection'; settings.visuals.hoverHighlight = false;
  r[k('focusNote')](0); r[k('draw')](); expect(r[k('focusNode')]).toBe(-1);
  expect(r[k('anchorNames')].map((a: any) => a.node)).toEqual([0,1]);
});
const EMPTY = { x: 1, y: 599 };
test('graduated production: a click is the one CPU tier authority, hover never retiers; every reset path clears', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f;
  const camera = { ...r.camera }, positions = r.positions, rows = r.projection.source, saved = JSON.stringify(f.settings);
  // A click selects and shows the connection card; it no longer opens by itself.
  f.tap(0); expect(f.opened).toEqual([]); expect(r.selected).toBe(0); expect(f.actual()).toEqual([[255, 255, 128, 0, 0], [255, 128, 0]]);
  // Hover is a light preview: it rings the note but the tiers stay on the click.
  for (const i of [3, 1, 4, 2]) { f.hover(i); expect(r.hovered).toBe(i); expect(f.actual()).toEqual(f.expected(0)); }
  r[k('pointerLeave')](); expect(r.hovered).toBe(-1); expect(f.actual()).toEqual(f.expected(0));
  for (const i of [1, 3, 1, 4, 2, 2, 0]) { f.tap(i); expect(f.actual()).toEqual(f.expected(i)); }
  f.hover(EMPTY); expect(f.actual()).toEqual(f.expected(0));
  const all = new Uint8Array(5).fill(1);
  r.setView(all, { [compiled('typeHidden')]: new Uint8Array([1]) }); expect(f.actual()).toEqual(f.expected(0, new Uint8Array(3))); expect(f.tiers()).toEqual([255, 0, 0, 0, 0]);
  r.setView(new Uint8Array([1, 0, 1, 1, 1]), {}); expect(f.actual()).toEqual(f.expected(0, undefined, new Uint8Array([1, 0, 1, 1, 1])));
  r.setView(new Uint8Array([0, 1, 1, 1, 1]), {}); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]);
  r.setView(all, {}); expect(f.actual()).toEqual(f.expected(0));
  f.settings.visuals.hoverHighlight = false; f.tap(2); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]);
  f.settings.visuals.hoverHighlight = true; f.tap(1); expect(f.actual()).toEqual(f.expected(1));
  // With nothing selected, hover still only previews.
  f.tap(EMPTY); f.hover(2); expect(r.hovered).toBe(2); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]);
  r[k('pointerLeave')](); f.tap(EMPTY); expect(r.selected).toBe(-1); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]); expect(f.opened).toEqual([]);
  expect(r.camera.ratio).toBe(camera.ratio); expect(r.positions).toBe(positions); expect(r.projection.source).toBe(rows); expect(JSON.stringify(f.settings)).toBe(saved);
});
test('graduated production Canvas parity: tier batches, graded nodes and labels, zero opacity keeps edges hidden', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f, dim = f.settings.visuals.dimOpacity;
  const saved = { stroke: ctx.stroke, fill: ctx.fill, moveTo: ctx.moveTo, beginPath: ctx.beginPath, fillText: ctx.fillText };
  let strokes: [number, number][] = [], fills: number[] = [], labels: [string, number][] = [], segments = 0;
  Object.assign(ctx, { beginPath: () => { segments = 0; }, moveTo: () => { segments++; }, stroke: () => strokes.push([ctx.globalAlpha, segments]), fill: () => fills.push(ctx.globalAlpha), fillText: (t: string) => labels.push([t, ctx.globalAlpha]) });
  const paint = (level: number) => { strokes = []; fills = []; labels = []; r[k('focusLevel')] = level; r[k('drawCanvas')](); return { strokes, fills, labels }; };
  try {
    // The reviewed tier weights, with the optional finding aids (strong focus lines, rings) off.
    Object.assign(f.settings.visuals, { emphasis: 'scale', focusEdges: false, tierRings: false });
    f.tap(0); const plain = paint(0); expect(plain.strokes.length).toBe(2); expect(plain.strokes[0]![1]).toBe(3);
    const a = plain.strokes[0]![0], lit = paint(1);
    // Three edge batches, then the focus ring (an arc stroke with no line segments) at full focus.
    expect(lit.strokes.map(s => s[1])).toEqual([1, 1, 1, 0]); expect(lit.strokes[3]![0]).toBeCloseTo(plain.fills[0]!, 12);
    [a * (1 - (1 - dim * .6)), a, Math.min(1, a * 3)].forEach((v, i) => expect(lit.strokes[i]![0]).toBeCloseTo(v, 12));
    const ratio = lit.fills.map((v, i) => v / plain.fills[i]!);
    [1, 1 - (1 - dim) * (1 - 128 / 255), dim, dim, 1].forEach((v, i) => expect(ratio[i]!).toBeCloseTo(v, 12));
    // Tiered atlas labels hand over to the graduated DOM labels; context labels go very faint.
    for (const [text, alpha] of lit.labels) { expect(+text).toBeGreaterThanOrEqual(3); expect(alpha).toBeCloseTo(dim * .5, 12); }
    expect(plain.labels.every(([, alpha]) => alpha === 1)).toBe(true);
    // Finding aids on: the direct line is its own near-opaque stroke, 2-hop and context strokes fade
    // further (strongEdge), then the focus ring plus the contrast rings (direct, focus outer).
    Object.assign(f.settings.visuals, { focusEdges: true, tierRings: true }); const strong = paint(1);
    expect(strong.strokes.map(s => s[1])).toEqual([1, 1, 1, 0, 0, 0]);
    [a * dim * .6 * .35, a * .5, .95].forEach((v, i) => expect(strong.strokes[i]![0]).toBeCloseTo(v, 12));
    expect(strong.fills).toEqual(lit.fills);
    f.settings.visuals.edgeOpacity = 0; const hidden = paint(1);
    expect(hidden.strokes.filter(s => s[1])).toEqual([]); expect(hidden.fills.map((v, i) => v / plain.fills[i]!)).toEqual(ratio);
  } finally { Object.assign(ctx, saved); }
});
test('finding connections in production: legend counts and toggles, off-screen pip pans, ripple, lifted pick', async () => {
  // 0 focus; 1, 2 direct; 3 neighbour of neighbour; 4 context.
  const f = await graduated([[0, 1], [0, 2], [1, 3]]), { r, k } = f, v = f.settings.visuals;
  const frame = () => { r[k('focusLevel')] = 1; r[k('placeOverlay')](); };
  const legend = r.legend, rows = r[k('legendRows')], counts = r[k('legendCounts')], pips = r[k('pipEls')];
  expect(legend.hidden).toBe(true); expect(pips.every((p: any) => p.hidden)).toBe(true);
  f.tap(0); frame();
  expect(legend.hidden).toBe(false); expect(rows.map((x: any) => x.hidden)).toEqual([false, true, false, true]);
  expect(counts.map((x: any) => x.textContent)).toEqual(['2', '0', '1', '0']); expect(rows[0].attributes['aria-pressed']).toBe('true');
  // Selecting starts one ripple; the frame loop ends after it.
  expect(r[k('ripple')]).toBeDefined(); expect(r[k('rippleEl')].hidden).toBe(false);
  // A legend row switches that tier's emphasis off and back on (focus never masked).
  rows[0].onclick(); expect(rows[0].attributes['aria-pressed']).toBe('false'); expect(r.tierMask).toBe(14); rows[0].onclick(); expect(r.tierMask).toBe(15);
  v.tierLegend = false; frame(); expect(legend.hidden).toBe(true); v.tierLegend = true;
  // All on screen: no pips. Zoomed in on the focus: one lower-right pip for both direct connections.
  expect(pips.every((p: any) => p.hidden)).toBe(true);
  v.cameraAnimationMs = 0; r.setCamera(0, 0, .02); frame();
  const shown = pips.filter((p: any) => !p.hidden); expect(shown.length).toBe(1);
  expect(shown[0].attributes['aria-label']).toBe('2 direct connections lower right. Go to the nearest.');
  // The pip centres its note in the room left of the docked card (800 px less the card and its margins).
  const [right] = r[k('cardInset')](); expect(right).toBeGreaterThan(0);
  shown[0].onclick(); const at = r.screenPoint(1); expect(at.x).toBeCloseTo((800 - right) / 2, 6); expect(at.y).toBeCloseTo(300, 6);
  v.offscreenPips = false; r.setCamera(0, 0, .02); frame(); expect(pips.every((p: any) => p.hidden)).toBe(true);
  // Minimum highlighted size: at overview zoom a direct connection is pickable within its 7 px floor.
  Object.assign(f.settings, { nodeSize: 1, nodeSizing: { policy: 'predictable', compensation: 0, floor: 1 } });
  r.setCamera(.5, .5, 8); r[k('focusLevel')] = 1; const p1 = r.screenPoint(1);
  expect(r.pick(p1.x + 9, p1.y)).toBe(1); v.tierMinSize = 0; expect(r.pick(p1.x + 9, p1.y)).not.toBe(1);
  f.tap(EMPTY); frame(); expect(legend.hidden).toBe(true);
});
test('graduated production labels: focus largest, direct then 2-hop by priority, placed once per focus or LOD change, every reset clears', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [3, 4]]), { r, k } = f;
  const paint = () => { r[k('focusLevel')] = 1; r[k('placeOverlay')](); return r[k('tierLabels')].map((el: any) => [el.textContent, el.className, el.style.opacity]); };
  const name = (n: number) => r[k('name')](n);
  f.tap(1); const first = paint();
  expect(first).toEqual([[name(0), 'graph-ng-focus-label graph-ng-tier-1', '1'], [name(2), 'graph-ng-focus-label graph-ng-tier-1', '1'], [name(3), 'graph-ng-focus-label graph-ng-tier-3', '1']]);
  expect(r[k('hoverLabel')].className).toBe('graph-ng-hover-label graph-ng-focus'); expect(r[k('hoverLabel')].textContent).toBe(name(1));
  // Per frame only translates; the placement is reused until focus or LOD changes.
  const ranked = r[k('rankedLabels')]; r.setCamera(r.camera.x + .01, r.camera.y, r.camera.ratio); paint(); expect(r[k('rankedLabels')]).toBe(ranked);
  r.setCamera(r.camera.x, r.camera.y, r.camera.ratio * 16); paint(); expect(r[k('rankedLabels')]).not.toBe(ranked);
  // Budget: one label per viewport keeps only the focus (shown by the focus readout).
  f.settings.labelsMaxPerViewport = 1; f.tap(2); expect(paint()).toEqual([]); f.settings.labelsMaxPerViewport = 400;
  f.tap(3); expect(paint().map((x: string[]) => x[0])).toEqual([name(2), name(4), name(1)]);
  f.tap(EMPTY); expect(paint()).toEqual([]); expect(r[k('hoverLabel')].textContent).toBe('');
  f.settings.visuals.hoverHighlight = false; f.tap(2); f.hover(2); expect(paint()).toEqual([]); expect(r[k('hoverLabel')].className).toBe('graph-ng-hover-label');
  // Hover shows only the name, never the graduated labels; a click shows them.
  f.settings.visuals.hoverHighlight = true; f.tap(EMPTY); f.hover(3); expect(paint()).toEqual([]); expect(r[k('hoverLabel')].textContent).toBe(name(3));
  f.tap(3); expect(paint().length).toBe(3); f.tap(EMPTY); expect(paint()).toEqual([]);
});
test('graduated labels fold unlabelled direct connections into a "+N more" button wired to onMoreConnections', async () => {
  const f = await graduated(Array.from({ length: 40 }, (_, i) => [0, i + 1] as [number, number]), 41), { r, k } = f, asked: number[] = [];
  const paint = () => { r[k('focusLevel')] = 1; r[k('placeOverlay')](); };
  f.tap(0); paint();
  // "+N more" counts direct connections without a label shown this frame (one may sit under the card).
  const more = r[k('moreButton')], shown = r[k('tierLabels')].filter((el: any, i: number) => !el.hidden && r[k('rankedLabels')][i].rank === 1).length, hidden = 40 - shown;
  expect(shown).toBeGreaterThan(0); expect(shown).toBeLessThanOrEqual(24); expect(more.hidden).toBe(false); expect(more.tagName).toBe('BUTTON');
  expect(more.textContent).toBe(`+${hidden} more`); expect(more.attributes['aria-label']).toBe(`Show ${hidden} more direct connections of ${r[k('name')](0)}`);
  // The default hook is a safe no-op; a host hook receives the focus.
  more.click(); r[compiled('onMoreConnections')] = (n: number) => asked.push(n); more.click(); expect(asked).toEqual([0]); expect(f.opened).toEqual([]);
  // Labels carry the full name for assistive technology without hover tooltips.
  for (const el of r[k('tierLabels')]) expect(el.attributes['aria-description']).toBe(el.textContent);
  f.tap(EMPTY); paint(); expect(more.hidden).toBe(true); expect(r[k('tierLabels')]).toEqual([]);
});
test('focus-label placement re-runs on coordinate change at constant zoom and on viewport resize; DOM font matches the measured font', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [3, 4]]), { r, k } = f;
  const paint = () => { r[k('focusLevel')] = 1; r[k('placeOverlay')](); };
  f.tap(1); paint(); const ranked = r[k('rankedLabels')];
  paint(); expect(r[k('rankedLabels')]).toBe(ranked);
  // Labels render with the exact font string used for measureText during placement.
  const el = r[k('tierLabels')][0]; expect(el.style.font).toBe(`600 ${f.settings.labelSize}px ${r[k('theme')].font}`);
  // Coordinate adoption or rollback swaps the display array without touching the camera.
  const display = r[k('display')]; r[k('display')] = Float32Array.from(display, (x: number) => x + 3); paint(); expect(r[k('rankedLabels')]).not.toBe(ranked);
  const moved = r[k('rankedLabels')]; r[k('display')] = display; paint(); expect(r[k('rankedLabels')]).not.toBe(moved);
  const back = r[k('rankedLabels')]; r[k('width')] += 40; paint(); expect(r[k('rankedLabels')]).not.toBe(back);
});
test('graduated production WebGL uploads the tier column and state on focus and on view re-upload', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f;
  let bound: unknown; const uploads: unknown[][] = [], images: unknown[] = [];
  r.gl = new Proxy({ isContextLost: () => false, bindBuffer: (_: unknown, b: unknown) => { bound = b; }, bufferData: (_: unknown, data: unknown) => uploads.push([bound, data]), texImage2D: (...args: unknown[]) => images.push(args.at(-1)) }, { get: (o: any, key: string) => key in o ? o[key] : key.toUpperCase() === key ? 1 : () => {} });
  r[k('buffers')] = ['source', 'target', 'on', 'tier', 'sizes'];
  f.tap(2); expect(uploads.some(([b, d]) => b === 'tier' && d === r[k('edgeTier')])).toBe(true); expect(images).toContain(r[k('stateBytes')]);
  uploads.length = images.length = 0; r[k('uploadView')]();
  expect(uploads.some(([b, d]) => b === 'tier' && d === r[k('edgeTier')])).toBe(true); expect(uploads.some(([b, d]) => b === 'on' && d === r[k('carrierGeometry')].enabled)).toBe(true); expect(images).toContain(r[k('stateBytes')]);
  r.gl = null;
});
test('graduated production dense hub reports deterministic 2-hop truncation in the visible hover readout', async () => {
  const pairs: [number, number][] = [[0, 1], [0, 2]]; let id = 3;
  for (const hub of [1, 2]) for (let i = 0; i < 33000; i++) pairs.push([hub, id++]);
  const f = await graduated(pairs, id, 70000), { r, k } = f, started = performance.now();
  f.tap(0); const ms = performance.now() - started; r[k('focusLevel')] = 1; r[k('placeOverlay')]();
  expect(r[k('hoverLabel')].textContent).toContain('neighbours of neighbours truncated'); expect(f.tiers().filter(v => v === 128).length).toBeLessThanOrEqual(65536);
  expect(f.actual()).toEqual(f.expected(0)); expect(ms).toBeLessThan(5000);
  f.hover(3); r[k('placeOverlay')](); expect(r[k('hoverLabel')].textContent).not.toContain('truncated');
});
test('graduated production touch tap selects with a text-only connection card and never opens by itself', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f, card = () => r[k('noteCard')];
  f.tap(1, 'touch'); expect(f.opened).toEqual([]); expect(r.selected).toBe(1); expect(f.actual()).toEqual(f.expected(1));
  const open = control(card(), 'Open note'); expect(card().textContent).toContain('2 direct connections'); expect(open.attributes['aria-label']).toBe('Open 1');
  // No duplicated count chips: each section count is the shared tabular count element, as are the tier legend counts.
  expect(card().querySelectorAll('div').some((c: any) => c.className === 'graph-ng-card-chips')).toBe(false);
  const section = card().querySelectorAll('summary').find((b: any) => b.className === 'graph-ng-connection-group');
  expect(section.children.map((c: any) => [c.className, c.textContent]).at(-1)).toEqual(['graph-ng-count', '2']);
  expect(r[k('legendCounts')].every((c: any) => c.className === 'graph-ng-count')).toBe(true);
  open.click(); expect(f.opened).toEqual([1]);
  f.tap(2, 'touch'); expect(f.opened).toEqual([1]); expect(control(card(), 'Open note').attributes['aria-label']).toBe('Open 2'); expect(f.actual()).toEqual(f.expected(2));
  r.setView(new Uint8Array([1, 1, 0, 1, 1]), {}); expect(card().textContent).toBe(''); expect(f.tiers()).toEqual([0, 0, 0, 0, 0]);
  // A filter-hidden selection cannot be opened with Enter.
  r[k('keyDown')]({ key: 'Enter', target: r.canvas, preventDefault() {} }); expect(f.opened).toEqual([1]);
  r.setView(new Uint8Array(5).fill(1), {}); f.tap(EMPTY, 'touch'); expect(r.selected).toBe(-1); expect(card().textContent).toBe(''); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]);
  // A secondary-button press neither selects nor opens.
  { const q = r.screenPoint(3), e = { pointerId: 2, button: 2, clientX: q.x, clientY: q.y, pointerType: 'mouse' }; r[k('pointerDown')](e); r[k('pointerUp')](e); expect(f.opened).toEqual([1]); expect(r.selected).toBe(-1); }
  // Mouse and pen show the card by default; Ctrl/Cmd-click or "Click opens notes directly" opens with no card.
  f.tap(3, 'mouse'); expect(f.opened).toEqual([1]); expect(card().textContent).toContain('Open'); f.tap(0, 'pen'); expect(f.opened).toEqual([1]);
  { const q = r.screenPoint(2), e = { pointerId: 3, clientX: q.x, clientY: q.y, pointerType: 'mouse', ctrlKey: true }; r[k('pointerDown')](e); r[k('pointerUp')](e); expect(f.opened).toEqual([1, 2]); expect(card().textContent).toBe(''); }
  f.settings.visuals.clickOpens = true;
  f.tap(3, 'mouse'); f.tap(0, 'pen'); expect(f.opened).toEqual([1, 2, 3, 0]); expect(card().textContent).toBe(''); expect(f.actual()).toEqual(f.expected(0));
  const overlay = card().parent; r.dispose(); expect(r.canvas.parent.children).not.toContain(r.canvas); expect(overlay.parent.children).not.toContain(overlay);
});
test('graduated production keyboard path: focusable canvas, arrows select, Enter opens, Escape clears and returns focus', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f, key = (name: string, target = r.canvas) => { let prevented = false; r[k('keyDown')]({ key: name, target, preventDefault: () => { prevented = true; } }); return prevented; };
  expect(r.canvas.tabIndex).toBe(0); expect(r.overlay.children.find((e: any) => e.id === r.canvas.getAttribute('aria-describedby'))?.textContent).toContain('Escape');
  expect(key('ArrowRight')).toBe(true); const first = r.selected; expect(first).toBeGreaterThanOrEqual(0); expect(f.actual()).toEqual(f.expected(first)); control(r[k('noteCard')], 'Open note');
  const p = r.screenPoint(first); expect(key('ArrowRight')).toBe(true); expect(r.positions[r.selected * 2]).toBeGreaterThan(r.positions[first * 2]); expect(f.actual()).toEqual(f.expected(r.selected));
  expect(key('ArrowLeft')).toBe(true); expect(r.selected).toBe(first); expect(f.opened).toEqual([]);
  expect(key('Enter')).toBe(true); expect(f.opened).toEqual([first]);
  const button = control(r[k('noteCard')], 'Open note'); expect(key('Enter', button)).toBe(false); expect(f.opened).toEqual([first]);
  button.focus(); expect(key('Escape', button)).toBe(true); expect(r.selected).toBe(-1); expect(r[k('noteCard')].textContent).toBe(''); expect(f.actual()).toEqual([[0, 0, 0, 0, 0], [0, 0, 0]]); expect((ControlElement as any).active).toBe(r.canvas);
  expect(key('Escape')).toBe(false); expect(key('a')).toBe(false);
});
// Connection navigator card through the compiled renderer (Canvas fixture, synthetic DOM). No native layout claimed.
test('connection card: grouped rows travel, history goes back and forward, keys move and close, the leader cue follows a row', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [0, 4]]), { r, k } = f, card = () => r[k('noteCard')];
  const rows = () => card().querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-connection');
  const cardKey = (key: string, target: any, altKey = false) => { let prevented = false; card().onkeydown({ key, altKey, target, preventDefault: () => { prevented = true; }, stopPropagation() {} }); return prevented; };
  f.tap(1); expect(r.selected).toBe(1); expect(f.opened).toEqual([]);
  expect(card().textContent).toContain('2 direct connections'); expect(card().textContent).not.toContain('neighbours of neighbours'); expect(card().textContent).not.toContain('·');
  // Equal-size groups: outgoing first. Rows are text-only names with a swatch.
  expect(rows().map((b: any) => b.textContent)).toEqual(['2→ link', '0← link']); expect(rows()[1].attributes['aria-label']).toBeUndefined(); expect(rows()[1].attributes['aria-labelledby']).toMatch(/-note-0$/);
  expect(control(card(), 'Back').disabled).toBe(true); expect(card().textContent).not.toContain('Close');
  // Hover/focus a row: ring and leader line to that note; leaving clears.
  rows()[0].onmouseenter(); r[k('placeOverlay')](); expect(r[k('cueRing')].hidden).toBe(false); expect(r[k('cueLine')].style.transform).toContain('rotate(');
  rows()[0].onmouseleave(); r[k('placeOverlay')](); expect(r[k('cueRing')].hidden).toBe(true);
  // Travel: focus and selection move, the camera flies, a history entry is added.
  rows()[1].click(); expect(r.selected).toBe(0); expect(f.actual()).toEqual(f.expected(0)); expect(r[k('flight')]).toBeDefined(); expect(f.opened).toEqual([]);
  expect(card().textContent).toContain('2 direct connections'); expect(card().querySelectorAll('nav')).toHaveLength(0); expect(control(card(), 'Back').disabled).toBe(false);
  expect(r[k('keyDown')]({ key: 'ArrowLeft', altKey: true, target: r.canvas, preventDefault() {} })).toBeUndefined(); expect(r.selected).toBe(1);
  expect(cardKey('ArrowRight', card(), true)).toBe(true); expect(r.selected).toBe(0); expect(control(card(), 'Forward').disabled).toBe(true);
  // Arrow keys move through rows; Escape closes the card and returns focus to the canvas.
  rows()[0].focus(); expect(cardKey('ArrowDown', rows()[0])).toBe(true); expect((ControlElement as any).active).toBe(rows()[1]);
  expect(cardKey('End', rows()[1])).toBe(true); expect(cardKey('Home', rows()[1])).toBe(true); expect((ControlElement as any).active).toBe(rows()[0]);
  expect(cardKey('Escape', rows()[0])).toBe(true); expect(r.selected).toBe(-1); expect(card().textContent).toBe(''); expect((ControlElement as any).active).toBe(r.canvas);
  // Narrow views get a bottom sheet.
  f.tap(2); r[k('width')] = 400; r[k('placeOverlay')](); expect(card().className).toBe('graph-ng-card graph-ng-sheet');
});
test('neighbourhood: reach 0–3, additive expansion, anchored travel, filters and one exit', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [0, 4]]), { r, k } = f, card = () => r[k('noteCard')], bar = () => r[k('isolationBar')], opens: string[][] = [], copies: string[] = [];
  f.tap(0); control(card(), 'Open note').click(); control(card(), 'New tab').click(); expect(f.opened).toEqual([0, 0]);
  r[compiled('openNote')] = (path: string, mode: string) => opens.push([path, mode]); r.copyLink = (path: string) => copies.push(path);
  for (const name of ['Open note', 'New tab', 'Open to the right', 'Copy link']) control(card(), name).click();
  expect(opens).toEqual([['0.md', 'reuse'], ['0.md', 'tab'], ['0.md', 'split']]); expect(copies).toEqual(['0.md']);
  const before = { ...r.camera }; control(card(), 'Focus here').click(); expect(r[k('flight')].to).not.toEqual(before);
  control(card(), 'Show only connections').click();
  expect([...r[k('filterVisible')]]).toEqual([1, 1, 0, 0, 1]); expect(bar().textContent).toContain('Only connections of 0'); expect(bar().textContent).toContain('3 notes');
  control(bar(), 'Reach 2 hops').click(); expect([...r[k('filterVisible')]]).toEqual([1, 1, 1, 0, 1]);
  control(bar(), 'Reach 3 hops').click(); expect([...r[k('filterVisible')]]).toEqual([1, 1, 1, 1, 1]);
  control(bar(), 'Reach 0 hops').click(); expect([...r[k('filterVisible')]]).toEqual([1, 0, 0, 0, 0]);
  control(bar(), 'Reach 1 hops').click();
  // Travel within the region keeps its anchor and mask; hidden adjacent rows expand on demand.
  r[k('travel')](1); expect(r.selected).toBe(1); expect([...r[k('filterVisible')]]).toEqual([1, 1, 0, 0, 1]);
  expect(r[k('frontier')].get(1)).toBe(1); expect(card().textContent).toContain('Expand 1 hidden neighbours');
  const camera = { ...r.camera }, positions = r.positions;
  control(card(), 'Add 1 hidden neighbours of 1').click(); expect([...r[k('filterVisible')]]).toEqual([1, 1, 1, 0, 1]);
  expect(r.camera).toEqual(camera); expect(r.positions).toBe(positions); expect(r[k('isolation')].node).toBe(0);
  r[k('travel')](2); r[k('travel')](3); expect(r.selected).toBe(3); expect([...r[k('filterVisible')]]).toEqual([1, 1, 1, 1, 1]);
  control(bar(), 'Reach 1 hops').click(); expect(r.selected).toBe(0); expect(r[k('isolation')].expanded.size).toBe(0);
  // Host filter removes an expansion route; filtered nodes can never be restored by expansion.
  r.setView(new Uint8Array([1, 1, 0, 1, 1]), {}); expect([...r[k('filterVisible')]]).toEqual([1, 1, 0, 0, 1]);
  control(bar(), 'Close').click(); expect([...r[k('filterVisible')]]).toEqual([1, 1, 0, 1, 1]); expect(bar().textContent).toBe('');
  expect(r[k('frontierBadges')]).toHaveLength(0);
  control(card(), 'Show only connections').click(); r[k('keyDown')]({ key: 'Escape', target: r.canvas, preventDefault() {} }); expect(bar().textContent).not.toBe('');
  r[k('keyDown')]({ key: 'Escape', target: r.canvas, preventDefault() {} }); expect(bar().textContent).toBe('');
});
test('neighbourhood frontier badges are bounded, clickable, text-only and independent of hover', async () => {
  const pairs: [number, number][] = [];
  for (let n = 1; n <= 30; n++) pairs.push([0, n], [n, n + 30]);
  const f = await graduated(pairs, 61), { r, k } = f;
  f.tap(0); r.isolate(0, 1, false);
  expect(r[k('frontier')].size).toBe(30); expect(r[k('frontierBadges')]).toHaveLength(6);
  expect(r[k('isolationBar')].textContent).toContain('24 more expandable notes');
  const mask = r[k('filterVisible')]; f.hover(1); expect(r[k('filterVisible')]).toBe(mask); expect(r[k('isolation')].node).toBe(0);
  const badge = r[k('frontierBadges')][0]; expect(badge.el.textContent).toBe('+1'); expect(badge.el.className).toContain('graph-ng-count');
  badge.el.click(); expect(r[k('filterVisible')][badge.node + 30]).toBe(1); expect(r[k('frontier')].has(badge.node)).toBe(false);
  r.setView(new Uint8Array(61).fill(1), { [compiled('typeHidden')]: new Uint8Array([1]) });
  expect(r[k('filterVisible')].reduce((a: number, b: number) => a + b)).toBe(1); expect(r[k('frontierBadges')]).toHaveLength(0);
  const base = new Uint8Array(61).fill(1); base[0] = 0; r.setView(base, {});
  expect(r[k('isolation')]).toBeUndefined(); expect(r[k('filterVisible')]).toBe(base);
});
test('frontier badges rank by hidden neighbours (largest first, ties to the lower id) and precede the minimap and card in Tab order', async () => {
  // Degrees: 1 → 4, 2 → 3, 3 → 2 and 10 → 2 (a tie with 3).
  const pairs: [number, number][] = [[0, 1], [1, 4], [1, 5], [1, 6], [0, 2], [2, 7], [2, 8], [0, 10], [10, 11], [0, 3], [3, 9]];
  const f = await graduated(pairs, 12), { r, k } = f, degree = new Array(12).fill(0);
  for (const [a, b] of pairs) { degree[a]++; degree[b]++; }
  r.projection.offsets = Uint32Array.from({ length: 13 }, (_, i) => degree.slice(0, i).reduce((a, b) => a + b, 0));
  r.isolate(0, 1, false);
  const badges = r[k('frontierBadges')]; expect(badges.map((b: any) => b.node)).toEqual([1, 2, 3, 10]);
  const kids = r[k('overlay')].children, at = (e: any) => kids.indexOf(e);
  expect(badges.map((b: any) => at(b.el))).toEqual([...badges.map((b: any) => at(b.el))].sort((a: number, b: number) => a - b));
  expect(at(badges[3].el)).toBeLessThan(at(r[k('miniMap')].root)); expect(at(r[k('miniMap')].root)).toBeLessThan(at(r[k('noteCard')]));
});
test('Only connections bar offers "Expand a + badge" only when badges are present', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k } = f, bar = () => r[k('isolationBar')].textContent;
  r.isolate(0, 1, false); expect(r[k('frontierBadges')]).toHaveLength(1); expect(bar()).toContain('Expand a + badge');
  r.isolate(0, 2, false); expect(r[k('frontierBadges')]).toHaveLength(0); expect(bar()).not.toContain('Expand a + badge');
});
test('travelling to a note already in the travel-reveal list does not add it twice', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k } = f;
  r.isolate(0, 1, false); const s = r[k('isolation')]; s.shown = [2];
  r[k('travel')](2); expect(r[k('isolation')].shown).toEqual([2]); expect(r.selected).toBe(2);
});
test('neighbourhood expansion keeps its anchor and adds the full mask above the Canvas drawing budget', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f;
  r.isolate(0, 1, false); f.settings.canvasMaxDetailNodes = 2;
  r[k('expandNeighbourhood')](1);
  expect(r[k('filterVisible')][2]).toBe(1); expect(r[k('isolation')].node).toBe(0); expect(r.reducedCanvas).toBe(true);
});
test('Only connections refusal is detected by type: an unrelated error that merely mentions CANVAS_DETAIL_ still propagates', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f;
  r.isolate(0, 1, false); const region = r[k('isolation')];
  r[k('applyView')] = () => { throw new Error('CANVAS_DETAIL_ lookalike from another layer'); };
  expect(() => r[k('expandNeighbourhood')](1)).toThrow('CANVAS_DETAIL_ lookalike');
  expect(r[k('isolationBar')].textContent).not.toContain('Too many notes to draw'); expect(region.node).toBe(0);
});
test('Only connections card: Expand names hidden neighbours and is absent when nothing is hidden', async () => {
  const f = await graduated([[0, 1], [1, 2], [1, 3], [0, 4]]), { r, k } = f, card = () => r[k('noteCard')];
  const expandButton = (): any => card().querySelectorAll('button').find((b: any) => b.textContent.startsWith('Expand'));
  f.tap(0); control(card(), 'Show only connections').click();
  expect(expandButton()).toBeUndefined(); // the anchor shows every neighbour at reach 1
  r[k('travel')](1); const expand = expandButton(), focus: any = control(card(), 'Focus here');
  expect(expand.className).toBe(focus.className); expect(expand.attributes['aria-label']).toBe('Add 2 hidden neighbours of 1');
  expect(expand.textContent).toBe('Expand 2 hidden neighbours');
  expand.click(); expect([...r[k('filterVisible')]]).toEqual([1, 1, 1, 1, 1]);
  r[k('travel')](2); r[k('travel')](1); expect(r.selected).toBe(1); expect(expandButton()).toBeUndefined(); // fully revealed: no "+0"
});
test('Only connections travel reveals only the hidden target, never the other hidden neighbours of the current note', async () => {
  const f = await graduated([[0, 1], [1, 2], [1, 3], [0, 4]]), { r, k } = f, bar = () => r[k('isolationBar')];
  f.tap(0); r.isolate(0, 1, false); r[k('travel')](1); expect([...r[k('filterVisible')]]).toEqual([1, 1, 0, 0, 1]);
  r[k('travel')](2); expect(r.selected).toBe(2); expect([...r[k('filterVisible')]]).toEqual([1, 1, 1, 0, 1]);
  expect(r[k('frontier')].get(1)).toBe(1); expect(r[k('isolation')].node).toBe(0); expect(r[k('isolation')].expanded.size).toBe(0);
  expect(bar().textContent).toContain('Only connections of 0'); expect(bar().textContent).toContain('4 notes');
  // Changing reach drops travel reveals; a jump to a note that does not touch the region exits.
  control(bar(), 'Reach 0 hops').click(); expect([...r[k('filterVisible')]]).toEqual([1, 0, 0, 0, 0]); expect(r[k('isolation')].shown).toEqual([]);
  r[k('travel')](3); expect(r[k('isolation')]).toBeUndefined(); expect(r.selected).toBe(3); expect([...r[k('filterVisible')]]).toEqual([1, 1, 1, 1, 1]);
});
test('hub navigator auto-opens a lone section, collapses on demand and pages each group by 50', async () => {
  const pairs: [number, number][] = Array.from({ length: 60 }, (_, i) => [0, i + 1]);
  const f = await graduated(pairs, 61), { r, k } = f, card = () => r[k('noteCard')], rows = () => card().querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-connection');
  f.tap(0, 'touch'); expect(card().textContent).toContain('60 direct connections'); expect(rows().length).toBe(50);
  control(card(), 'Ungrouped, 60 connections').click(); expect(rows().length).toBe(0);
  control(card(), 'Ungrouped, 60 connections').click(); expect(rows().length).toBe(50);
  control(card(), 'Show 10 more').click(); expect(rows().length).toBe(60);
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
  f.tap(0); expect(r.selected).toBe(0); expect(f.edges()).toEqual([]); expect(f.opened).toEqual([]);
  for (const pointer of ['mouse', 'touch', 'pen']) {
    f.tap(f.mid(0, 1), pointer); expect(f.opened).toEqual([]); expect(r.selected).toBe(-1); expect(f.edges()).toEqual([0, 1]);
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
  expect(r.overlay.children.find((e: any) => e.id === r.canvas.getAttribute('aria-describedby'))?.textContent).toContain('R cycles relationships');
  expect(f.key('r')).toBe(false); expect(f.edges()).toEqual([]);
  f.tap(1, 'touch'); expect(f.key('r')).toBe(true); expect(f.edges()).toEqual([0, 1]);
  expect(f.key('r')).toBe(true); expect(f.edges()).toEqual([2]);
  expect(f.key('r')).toBe(true); expect(f.edges()).toEqual([0, 1]);
  expect(f.key('R', true)).toBe(true); expect(f.edges()).toEqual([2]);
  expect(f.key('Enter')).toBe(false); expect(f.opened).toEqual([]);
  expect(f.key('Escape')).toBe(true); expect(f.edges()).toEqual([]); expect(f.card().textContent).toBe(''); expect(f.actual()).toEqual([[0, 0, 0], [0, 0, 0]]);
});
// "How are these connected?" through the compiled renderer (Canvas fixture): bytes, card text and reset paths only.
test('path finder: Shift-click lights the path as its own tier, lists hops with Open, finds another path, Escape clears', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [0, 4], [4, 3]], 6), { r, k } = f, card = () => r[k('noteCard')];
  const shift = (n: number) => { const { x, y } = r.screenPoint(n), e = { pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse', shiftKey: true }; r[k('pointerDown')](e); r[k('pointerUp')](e); };
  // Shift-click without a selection only selects.
  shift(0); expect(r.selected).toBe(0); expect(r[k('pathView')]).toBeUndefined();
  shift(3); expect(r.selected).toBe(-1);
  expect(f.actual()).toEqual([[255, 0, 0, 255, 255, 0], [0, 0, 0, 253, 253]]);
  expect(card().textContent).toContain('Path: 0 → 3'); expect(card().textContent).toContain('2 steps');
  const hops = card().querySelectorAll('li'); expect(hops.map((li: any) => li.children.map((c: any) => c.textContent))).toEqual([['link', '4'], ['link', '3']]);
  control(card(), '0').click(); hops[0].children[1].click(); expect(f.opened).toEqual([0, 4]);
  r[k('drawCanvas')](); r[k('placeOverlay')]();
  control(card(), 'Another path').click(); expect(card().textContent).toContain('3 steps (path 2)');
  expect(f.actual()).toEqual([[255, 255, 255, 255, 0, 0], [253, 253, 253, 0, 0]]);
  control(card(), 'Another path').click(); expect(card().textContent).toContain('No other path within 6 steps');
  expect(card().querySelectorAll('button').some((b: any) => b.textContent === 'Another path')).toBe(false);
  // Hover never replaces the path highlight; Escape clears path, bytes and card.
  f.hover(5); expect(f.actual()[1]).toEqual([253, 253, 253, 0, 0]);
  r[k('keyDown')]({ key: 'Escape', target: r.canvas, preventDefault() {} });
  expect(r[k('pathView')]).toBeUndefined(); expect(card().textContent).toBe(''); expect(f.actual()[1]).toEqual([0, 0, 0, 0, 0]);
  // Unreachable notes say so; a filter that hides an endpoint drops the path.
  f.tap(0); shift(5); expect(card().textContent).toContain('No path within 6 steps');
  f.tap(0); shift(3); r.setView(new Uint8Array([1, 1, 1, 0, 1, 1]), {}); expect(r[k('pathView')]).toBeUndefined(); expect(card().textContent).toBe('');
});
test('graduated focus pick radius follows the 60% enlarged focus node', async () => {
  const f = await relationships(), { r, k } = f, s = f.settings; s.visuals.emphasis = 'scale';
  f.tap(2, 'touch'); const p = r.screenPoint(2), at = { x: p.x + s.nodeSize * (1 + s.visuals.degreeSizing) * 1.3 + 4, y: p.y };
  r[k('focusLevel')] = 0; expect(r.pick(at.x, at.y)).toBe(-1);
  r[k('focusLevel')] = 1; expect(r.pick(at.x, at.y)).toBe(2);
});


// Lens integration uses the actual compiled class and driver/Canvas seams, not a second renderer.
// It does not establish native readability, GPU rasterization or a frame-time budget.
test('lens production animation and picking follow sparse overrides without changing layout or settings', async () => {
  const f = await graduated([[0, 1], [0, 2], [1, 3]]), { r, k } = f;
  const positions = r.positions, bytes = [...positions], display = r[k('display')], camera = { ...r.camera }, settings = JSON.stringify(f.settings);
  const before = [0, 1, 2, 3, 4].map(n => r.screenPoint(n));
  r[compiled('setLens')](0); expect(r[compiled('lensNode')]).toBe(0); expect(r[k('lensPoints')].size).toBe(2);
  const motion = r[k('lensMotion')]; r[k('animate')](motion.start + 110);
  expect(r[k('lensBlend')]).toBeCloseTo(.5, 10); const middle = r.screenPoint(1); expect(r.pick(middle.x, middle.y)).toBe(1);
  r[k('animate')](motion.start + 220); const pulled = r.screenPoint(1);
  expect(pulled).not.toEqual(before[1]); expect(r.pick(pulled.x, pulled.y)).toBe(1); expect(r.pick(before[1].x, before[1].y)).not.toBe(1);
  for (const n of [0, 3, 4]) expect(r.screenPoint(n)).toEqual(before[n]);
  f.hover(1); expect(r[k('focusNode')]).toBe(0); expect(r[compiled('lensNode')]).toBe(0);
  const distance = Math.hypot(pulled.x - before[0].x, pulled.y - before[0].y);
  r.setCamera(r.camera.x, r.camera.y, r.camera.ratio / 2);
  const a = r.screenPoint(0), b = r.screenPoint(1); expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(distance, 4);
  r.setCamera(camera.x, camera.y, camera.ratio); r[compiled('setLens')](-1); r[k('animate')](r[k('lensMotion')].start + 220);
  expect(r[k('lensPoints')].size).toBe(0); expect(r[compiled('lensNode')]).toBe(-1);
  for (let n = 0; n < 5; n++) expect(r.screenPoint(n)).toEqual(before[n]);
  expect(r.positions).toBe(positions); expect([...positions]).toEqual(bytes); expect(r[k('display')]).toBe(display); expect(r.camera).toEqual(camera); expect(JSON.stringify(f.settings)).toBe(settings);
});
test('lens production retargeting and view invalidation remove stale overrides', async () => {
  const { r, k } = await graduated([[0, 1], [0, 2], [1, 3]]);
  const finish = () => r[k('animate')](r[k('lensMotion')].start + 220);
  r[compiled('setLens')](0); finish(); r[compiled('setLens')](3); expect(r[compiled('lensNode')]).toBe(3); expect(r[k('lensAnchor')]).toBe(0);
  finish(); expect(r[k('lensAnchor')]).toBe(3); finish(); expect([...r[k('lensPoints')].keys()]).toEqual([1]); expect(r[k('lensBytes')][2 * 4 + 2]).toBe(0);
  r.setView(new Uint8Array(5).fill(1), { [compiled('typeHidden')]: new Uint8Array([1]) }); expect(r[k('lensPoints')].size).toBe(0);
  r.setView(new Uint8Array(5).fill(1), {}); expect([...r[k('lensPoints')].keys()]).toEqual([1]);
  r.setView(new Uint8Array([1, 1, 1, 0, 1]), {}); expect(r[compiled('lensNode')]).toBe(-1); finish(); expect(r[k('lensAnchor')]).toBe(-1); expect(r[k('lensPoints')].size).toBe(0);
  expect(() => r[compiled('setLens')](NaN)).toThrow('LENS_NODE_INDEX'); expect(() => r[compiled('setLens')](99)).toThrow('LENS_NODE_INDEX');
});
test('lens production L and Escape are keyboard reachable; reduced motion has no pending transition', async () => {
  const { r, k } = await graduated([[0, 1], [0, 2]]); r.selected = 0;
  const key = (name: string) => { let handled = false; r[k('keyDown')]({ key: name, target: r.canvas, preventDefault() { handled = true; } }); return handled; };
  try {
    fixtureReducedMotion = true; expect(key('L')).toBe(true); expect(r[compiled('lensNode')]).toBe(0); expect(r[k('lensBlend')]).toBe(1); expect(r[k('lensMotion')]).toBeUndefined();
    expect(key('Escape')).toBe(true); expect(r[compiled('lensNode')]).toBe(-1); expect(r[k('lensPoints')].size).toBe(0); expect(r.selected).toBe(0);
    key('l'); key('l'); expect(r[compiled('lensNode')]).toBe(-1); expect(r[k('lensMotion')]).toBeUndefined();
  } finally { fixtureReducedMotion = false; }
});
test('lens production Canvas edges, node arcs and relationship picking use the interpolated coordinates', async () => {
  const { r, k } = await graduated([[0, 1], [0, 2]]), saved = { arc: ctx.arc, moveTo: ctx.moveTo, lineTo: ctx.lineTo };
  const arcs: number[][] = [], starts: number[][] = [], ends: number[][] = [];
  Object.assign(ctx, { arc: (...v: number[]) => arcs.push(v), moveTo: (...v: number[]) => starts.push(v), lineTo: (...v: number[]) => ends.push(v) });
  try {
    r[compiled('setLens')](0); r[k('animate')](r[k('lensMotion')].start + 110); r[k('drawCanvas')]();
    const a = r.screenPoint(0), b = r.screenPoint(1);
    expect(arcs.some(([x, y]) => x === b.x && y === b.y)).toBe(true);
    expect(starts).toContainEqual([a.x, a.y]); expect(ends).toContainEqual([b.x, b.y]);
    expect(r[k('pickEdge')]((a.x + b.x) / 2, (a.y + b.y) / 2)).toBe(0);
  } finally { Object.assign(ctx, saved); }
});
test('lens production WebGL batches touched offsets by texture row; animation changes no position buffers', async () => {
  const { r, k } = await graduated([[0, 1], [0, 2]]), writes: any[][] = [];
  r.gl = new Proxy({ isContextLost: () => false, texImage2D: (...v: any[]) => writes.push(['image', ...v]), texSubImage2D: (...v: any[]) => writes.push(['sub', ...v]), bufferData: (...v: any[]) => writes.push(['buffer', ...v]) }, { get: (o: any, key: string) => key in o ? o[key] : key.toUpperCase() === key ? 1 : () => {} });
  try {
    r[compiled('setLens')](0); const offsets = writes.filter(v => v[0] === 'sub'); expect(offsets.length).toBe(1);
    expect(offsets[0]!.slice(3, 7)).toEqual([1, 0, 2, 1]);
    expect([...offsets[0]!.at(-1)]).toEqual(Array.from(r[k('lensBytes')]).slice(4, 12));
    writes.length = 0; const motion = r[k('lensMotion')]; r[k('animate')](motion.start + 110); r[k('animate')](motion.start + 220);
    expect(writes).toEqual([]);
    r[k('uploadLens')](); expect(writes[0]?.at(-1)).toBe(r[k('lensBytes')]); // restoration allocation retains the active ring
    r[compiled('setLens')](-1); r[k('animate')](r[k('lensMotion')].start + 220); expect([...r[k('lensBytes')]].every(v => v === 0)).toBe(true);
  } finally { r.gl = null; }
});

test('lens production layout adoption and rollback retain a coherent overlay without owning coordinates', async () => {
  const { r, k } = await graduated([[0, 1], [0, 2]]), original = r.positions;
  r[compiled('setLens')](0); r[k('animate')](r[k('lensMotion')].start + 220);
  const before = r.screenPoint(1), next = Float32Array.from(original, (v: number) => v + 50);
  const token = await prepare(r, next, () => true); token.commit();
  expect(r.positions).toBe(next); expect(r[compiled('lensNode')]).toBe(0); const moved = r.screenPoint(1); expect(moved).not.toEqual(before); expect(r.pick(moved.x, moved.y)).toBe(1);
  token.rollback(); token.discard(); expect(r.positions).toBe(original); expect(r.screenPoint(1)).toEqual(before); expect(r.pick(before.x, before.y)).toBe(1);
});

// Wave-3 wiring through the compiled renderer (Canvas fixture, synthetic DOM): labels "+N more" ->
// card, card Lens action, lens-displaced overlays/picking and the Escape/L/Alt+arrow key layers.
test('wiring: "+N more" opens a bounded group list and focuses its filter without travelling', async () => {
  const f = await graduated(Array.from({ length: 60 }, (_, i) => [0, i + 1] as [number, number]), 61), { r, k } = f, card = () => r[k('noteCard')];
  const rows = () => card().querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-connection');
  expect(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')).toContain('onMoreConnections = focus => this.detailRenderer?.showConnections(focus)');
  r[compiled('onMoreConnections')] = (n: number) => r[compiled('showConnections')](n); // the main.ts hook
  // Two declared groups (55 and 5), so the hub starts as a collapsed overview.
  r.setView(new Uint8Array(61).fill(1), { groupCodes: Uint32Array.from({ length: 61 }, (_, i) => i > 55 ? 1 : 0), groupLabels: ['Alpha', 'Beta'] });
  f.tap(0); r[k('focusLevel')] = 1; r[k('placeOverlay')](); expect(rows().length).toBe(0);
  const camera = { ...r.camera }, positions = r.positions;
  const more = r[k('moreButton')]; expect(more.hidden).toBe(false); more.click();
  expect(r.selected).toBe(0); expect(rows().length).toBe(50); expect(card().textContent).not.toContain('Show all'); expect((ControlElement as any).active).toBe(card().querySelector('input'));
  expect(r.camera).toEqual(camera); expect(r.positions).toBe(positions);
  // From no selection the hook selects the focus and opens its card; a hidden note is ignored.
  f.tap(EMPTY); expect(card().textContent).toBe(''); r[compiled('showConnections')](0); expect(r.selected).toBe(0); expect(rows().length).toBe(50);
  r[compiled('showConnections')](-1); r[compiled('showConnections')](99); expect(r.selected).toBe(0);
});
// The owner's case: a 221-connection hub near the top-left, its labels running under the Recent strip and
// tier legend. Panel rects are injected (the synthetic DOM has no layout); the browser evidence harness
// re-checks real DOM rectangles. Every visible label, the hover label and "+N more" must clear every panel.
const STACK = [8, 8, 230, 120];
const boxOf = (el: any, w: number, h: number, centred = false) => { const [, x, y] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform)!.map(Number); return [x!, centred ? y! - h / 2 : y!, w, h]; };
const meets = (a: number[], b: number[]) => b[2]! > 0 && b[3]! > 0 && a[0]! < b[0]! + b[2]! && a[0]! + a[2]! > b[0]! && a[1]! < b[1]! + b[3]! && a[1]! + a[3]! > b[1]!;
test('top-left hub: no label, hover label or "+N more" meets the card, Recent strip or tier legend', async () => {
  const h = topLeftHub(), f = await graduated(h.pairs, h.n, 0, h.paths, h.xy), { r, k } = f;
  r.setView(new Uint8Array(h.n).fill(1), { groupCodes: h.groupCodes, groupLabels: h.groupLabels });
  // One world unit per pixel, hub at (100, 80): the Recent/legend stack covers [8, 8, 230, 120].
  const frame = r[k('cameraFrame')], ratio = r.fit; r.setCamera(r.camera.x, r.camera.y, ratio);
  const cx = r.width / 2 - 100, cy = r.height / 2 - 80; r.setCamera((cx - frame.minX) / frame.width, (cy - frame.minY) / frame.height, ratio);
  expect(r.screenPoint(0).x).toBeCloseTo(100, 3); expect(r.screenPoint(0).y).toBeCloseTo(80, 3);
  f.tap(0); expect(r.selected).toBe(0); r.setCamera((cx - frame.minX) / frame.width, (cy - frame.minY) / frame.height, ratio); r[k('panelRects')] = [STACK, [0, 0, 0, 0]]; r[k('focusLevel')] = 1; r[k('placeOverlay')]();
  const card = r[k('cardRect')], panels = [card, STACK], labels = r[k('tierLabels')], slots = r[k('rankedLabels')];
  expect(card[2]).toBeGreaterThan(0); expect(slots.length).toBeGreaterThan(0);
  // The fixture reproduces the complaint: some label's dot and anchor clear the stack but its text would run under it.
  const caught = slots.filter((s: any, i: number) => { const p = r.screenPoint(s.node); return labels[i].hidden && !panels.some(b => meets([p.x, p.y, 1, 1], b)); });
  expect(caught.length).toBeGreaterThan(0);
  let shown = 0;
  slots.forEach((s: any, i: number) => { if (labels[i].hidden) return; if (s.rank === 1) shown++; const box = boxOf(labels[i], s.w, s.h, true); for (const b of panels) expect(meets(box, b)).toBe(false); });
  // "+N more" counts the direct connections without a shown label, and clears every panel.
  const more = r[k('moreButton')]; expect(more.textContent).toBe(`+${221 - shown} more`);
  if (!more.hidden) { const [w, mh] = r[k('moreSize')], box = boxOf(more, w, mh, true); for (const b of panels) expect(meets(box, b)).toBe(false); }
  // The hover label tries right, left, above and below; it never lands on a panel.
  const hover = r[k('hoverLabel')];
  for (const node of [0, 1, 2, 3, 4, 5, 6, 40, 90]) {
    f.hover(node); r[k('placeOverlay')]();
    if (hover.hidden) continue;
    const [, w, hh] = r[k('hoverBox')], box = boxOf(hover, w, hh); for (const b of panels) expect(meets(box, b)).toBe(false);
  }
  // A dot whose right side is under the stack moves its name to a free side instead of hiding it.
  f.hover(3); r[k('placeOverlay')](); const p = r.screenPoint(3);
  expect(hover.hidden).toBe(false); expect(boxOf(hover, 1, 1)[1]).toBeGreaterThan(p.y);
});
test('hub sections: an open section lights only its notes, with an explicit neighbours-of-neighbours toggle', async () => {
  // Hub 0: Alpha holds 1..55, Beta 56..60; 61 hangs off Beta's 56 and 62 off Alpha's 1.
  const pairs: [number, number][] = [...Array.from({ length: 60 }, (_, i) => [0, i + 1] as [number, number]), [56, 61], [1, 62]];
  const f = await graduated(pairs, 63), { r, k } = f, card = () => r[k('noteCard')];
  r.setView(new Uint8Array(63).fill(1), { groupCodes: Uint32Array.from({ length: 63 }, (_, i) => i > 55 && i !== 62 ? 1 : 0), groupLabels: ['Alpha', 'Beta'] });
  const lit = () => f.tiers().flatMap((t, i) => t ? [i] : []), toggles = () => card().querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-section-second');
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  // No section open: the graph is the whole hub, as before.
  f.tap(0, 'touch'); expect(lit()).toEqual(range(0, 62)); expect(toggles()).toEqual([]);
  // Opening Beta lights Beta alone; tier counts, labels and "+N more" follow the lit notes.
  control(card(), 'Beta, 5 connections').click();
  expect(lit()).toEqual([0, ...range(56, 60)]); expect(r[k('directs')].length).toBe(5); expect(f.tiers()[57]).toBe(255);
  expect(toggles().length).toBe(1); expect(toggles()[0].attributes['aria-pressed']).toBe('false'); expect(r.selected).toBe(0);
  // Neighbours of neighbours is per section: Beta reaches 61, never Alpha's 62.
  toggles()[0].click(); expect(lit()).toEqual([0, ...range(56, 61)]); expect(f.tiers()[61]).toBe(128); expect(toggles()[0].attributes['aria-pressed']).toBe('true');
  // Opening every section restores the whole hub and drops the toggle; closing all does too.
  control(card(), 'Alpha, 55 connections').click(); expect(lit()).toEqual(range(0, 62)); expect(toggles()).toEqual([]);
  control(card(), 'Alpha, 55 connections').click(); expect(lit()).toEqual([0, ...range(56, 61)]);
  control(card(), 'Beta, 5 connections').click(); expect(lit()).toEqual(range(0, 62));
  // Selecting another note and coming back starts from the whole hub again.
  control(card(), 'Beta, 5 connections').click(); f.tap(EMPTY); expect(lit()).toEqual([]);
  f.tap(0, 'touch'); expect(lit()).toEqual(range(0, 62));
  // Review regression: section keys are group codes. A regroup that gives Beta's code to Alpha must not
  // leave "Alpha" open (and lit) because Beta was; open state for a renamed code is dropped.
  control(card(), 'Beta, 5 connections').click(); expect(lit()).toEqual([0, ...range(56, 60)]);
  r.setView(new Uint8Array(63).fill(1), { groupCodes: Uint32Array.from({ length: 63 }, (_, i) => i > 55 && i !== 62 ? 0 : 1), groupLabels: ['Beta', 'Alpha'] });
  expect(control(card(), 'Alpha, 55 connections').attributes['aria-expanded']).toBe('false');
  expect(control(card(), 'Beta, 5 connections').attributes['aria-expanded']).toBe('false'); expect(lit()).toEqual(range(0, 62));
});
test('wiring: card Lens action, lens-displaced picking/arrows/cue/labels, and Escape, L and Alt+arrow layers', async () => {
  const f = await graduated([[0, 1], [0, 2], [1, 3]]), { r, k } = f, card = () => r[k('noteCard')];
  const rows = () => card().querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-connection');
  const canvasKey = (key: string) => { let handled = false; r[k('keyDown')]({ key, target: r.canvas, preventDefault() { handled = true; } }); return handled; };
  const cardKey = (key: string, target: any, altKey = false) => card().onkeydown({ key, altKey, target, preventDefault() {}, stopPropagation() {} });
  const before = r.screenPoint(1);
  try {
    fixtureReducedMotion = true;
    f.tap(0); const lens = control(card(), 'Connection rings'); expect(lens.attributes['aria-pressed']).toBe('false'); expect(lens.attributes['aria-label']).toBe('Connection rings: 0');
    lens.click(); expect(r[compiled('lensNode')]).toBe(0); expect(control(card(), 'Connection rings').attributes['aria-pressed']).toBe('true');
    const pulled = r.screenPoint(1); expect(pulled).not.toEqual(before);
    // Tier-lifted picking (min size) finds the displaced note at its drawn position, not its grid cell.
    r[k('focusLevel')] = 1; expect(r.pick(pulled.x, pulled.y)).toBe(1); expect(r.pick(before.x, before.y)).not.toBe(1);
    expect(r[k('pickTiered')](pulled.x, pulled.y, r[k('worldPoint')](pulled.x, pulled.y), 1, () => true)).toBe(1);
    // Off-screen arrows project the drawn positions; labels re-place on a lens change; the cue ring follows the row.
    r[k('placeOverlay')](); const directs = r[k('directs')], xy = r[k('pipXY')];
    directs.forEach((n: number, i: number) => { const q = r.screenPoint(n); expect([xy[i * 2], xy[i * 2 + 1]]).toEqual([q.x, q.y]); });
    expect(r[k('rankedKey')][5]).toBe(r[k('lensRevision')]);
    const row = rows().find((b: any) => b.attributes['aria-labelledby']?.endsWith('-note-1')); row.onmouseenter(); r[k('placeOverlay')]();
    expect(r[k('cueRing')].style.transform).toContain(`translate(${Math.round(pulled.x)}px, ${Math.round(pulled.y)}px)`);
    // Travel moves the lens with the card; Alt+Left in the card goes back (and the lens follows).
    row.click(); expect(r.selected).toBe(1); expect(r[compiled('lensNode')]).toBe(1); expect(r[k('lensAnchor')]).toBe(1); expect(control(card(), 'Connection rings').attributes['aria-pressed']).toBe('true');
    cardKey('ArrowLeft', card(), true); expect(r.selected).toBe(0); expect(r[compiled('lensNode')]).toBe(0);
    // L from inside the card toggles exactly once (card keys do not swallow it, nothing fires twice).
    cardKey('l', rows()[0]); expect(r[compiled('lensNode')]).toBe(-1); expect(control(card(), 'Connection rings').attributes['aria-pressed']).toBe('false');
    cardKey('L', rows()[0]); expect(r[compiled('lensNode')]).toBe(0);
    // Escape layers: the card first (lens stays), then the lens, then nothing left to clear.
    expect(canvasKey('Escape')).toBe(true); expect(card().textContent).toBe(''); expect(r.selected).toBe(-1); expect(r[compiled('lensNode')]).toBe(0);
    expect(canvasKey('Escape')).toBe(true); expect(r[compiled('lensNode')]).toBe(-1); expect(r[k('lensPoints')].size).toBe(0);
    { const d = r[k('display')]; expect(r.screenPoint(1)).toEqual({ x: (d[2] - r[compiled('centerX')]) * r.scale + r[k('width')] / 2, y: (d[3] - r[compiled('centerY')]) * r.scale + r[k('height')] / 2 }); }
    // The card's own Escape also closes only the card.
    f.tap(0); control(card(), 'Connection rings').click(); expect(r[compiled('lensNode')]).toBe(0); cardKey('Escape', rows()[0]); expect(card().textContent).toBe(''); expect(r[compiled('lensNode')]).toBe(0);
    // A click on empty canvas still clears both.
    f.tap(EMPTY); expect(r[compiled('lensNode')]).toBe(-1);
  } finally { fixtureReducedMotion = false; }
});

// Review regressions exercise the shipped class, not an alternate UI implementation.
test('review: hover never shows the focus controls; a click does, and they stay when the pointer leaves for the overlay', async () => {
  const f = await graduated(Array.from({ length: 40 }, (_, i) => [0, i + 1] as [number, number]), 41), { r, k } = f;
  r[compiled('onMoreConnections')] = (n: number) => r[compiled('showConnections')](n);
  f.hover(0); r[k('focusLevel')] = 1; r[k('placeOverlay')]();
  expect(r[k('focusNode')]).toBe(-1); expect(r[k('moreButton')]).toBeUndefined(); expect(r[k('legend')].hidden).toBe(true); expect(r.card.node).toBe(-1);
  f.tap(0); r[k('focusLevel')] = 1; r[k('placeOverlay')]();
  const more = r[k('moreButton')]; expect(more.hidden).toBe(false); expect(r[k('legend')].hidden).toBe(false);
  r[k('pointerLeave')]({ relatedTarget: more }); f.hover(EMPTY); r[k('placeOverlay')](); expect(r[k('focusNode')]).toBe(0); expect(more.hidden).toBe(false);
  r[k('keyDown')]({ key: 'Escape', target: r.canvas, preventDefault() {} }); expect(r[k('focusNode')]).toBe(-1);
  const container = r.container; expect(container.listeners.has('pointerleave')).toBe(true);
  r.dispose(); expect(container.listeners.has('pointerleave')).toBe(false);
});

test('review: carrier dots neither consume direct-label slots nor inflate the connection-card more count', async () => {
  const pairs: [number, number][] = [];
  for (let i = 0; i < 40; i++) pairs.push([0, i + 41], [i + 41, i + 1]);
  const f = await graduated(pairs, 81), { r, k } = f;
  for (let i = 0; i < 40; i++) { r.projection.carrierNodes[i + 41] = i + 1; r.projection.carrier[i * 2] = r.projection.carrier[i * 2 + 1] = i; }
  r.setView(new Uint8Array(81).fill(1), {}); f.tap(0); r[k('focusLevel')] = 1; r[k('placeOverlay')]();
  const direct = r[k('rankedLabels')].filter((slot: any) => slot.rank === 1);
  expect(direct.length).toBeGreaterThan(0); expect(direct.every((slot: any) => slot.node < 41)).toBe(true);
  expect(r[k('moreButton')].textContent).toBe(`+${40 - direct.length} more`);
  expect(r[k('tierTotals')][0]).toBe(40); expect(r[k('noteCard')].textContent).toContain('40 direct connections');
});

test('review: relationship cards remeasure after note cards, async details and same-mode viewport resizing', async () => {
  const f = await graduated([[0, 1], [1, 2]]), { r, k } = f, root = r[k('noteCard')];
  root.offsetWidth = 300; root.offsetHeight = 120;
  f.tap(0); r[k('placeOverlay')](); expect(r.card.size).toEqual([300, 120]);
  let resolve!: (info: any[]) => void;
  r[k('describeEdges')] = () => new Promise(done => { resolve = done; });
  r[k('selectEdge')](0); expect(r.card.size).toBeUndefined();
  root.offsetHeight = 180; r[k('placeOverlay')](); expect(r.card.size).toEqual([300, 180]);
  resolve([{ rule: 'synthetic rule', carrier: 'Synthetic relationship.md' }]); await Promise.resolve();
  expect(r.card.size).toBeUndefined(); root.offsetHeight = 280; r[k('placeOverlay')](); expect(r.card.size).toEqual([300, 280]);
  const [x, y, w, h] = r[k('cardRect')]; expect(x).toBeGreaterThanOrEqual(8); expect(y + h).toBeLessThanOrEqual(r.height - 8); expect(x + w).toBeLessThanOrEqual(r.width - 8);
  r.container.clientHeight = 350; root.offsetHeight = 200; r.resize(); expect(r.card.size).toBeUndefined();
  r[k('placeOverlay')](); expect(r.card.size).toEqual([300, 200]);
  r[k('selectNote')](-1); expect(r.card.size).toBeUndefined();
});

test('review: filtered history skips removed targets without drifting from the displayed card', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f;
  for (const n of [0, 1, 2]) r[k('travel')](n);
  expect(r.card.history.items).toEqual([0, 1, 2]);
  r.setView(new Uint8Array([1, 0, 1, 1, 1]), {});
  expect(r.card.history.items).toEqual([0, 2]); expect(r.card.history.at).toBe(1);
  control(r[k('noteCard')], 'Back').click(); expect(r.selected).toBe(0); expect(r.card.node).toBe(0); expect(r.card.history.at).toBe(0);
  control(r[k('noteCard')], 'Forward').click(); expect(r.selected).toBe(2); expect(r.card.history.at).toBe(1);
  // Local isolation does not discard history still available under the host filter.
  r.isolate(2, 1, false); expect(r.card.history.items).toEqual([0, 2]);
  r.card.step(-1); expect(r.selected).toBe(0); expect(r.card.node).toBe(0); expect(r.card.history.items).toEqual([0, 2]); expect(r.card.history.at).toBe(0);
  r.card.step(1); expect(r.selected).toBe(2); expect(r.card.history.at).toBe(1);
});

test('review: a distant high-degree lens cannot starve picking a nearby unrelated edge', async () => {
  const pairs: [number, number][] = [];
  for (let i = 1; i <= 400; i++) { pairs.push([0, i]); for (let j = 401; j <= 500; j++) pairs.push([i, j]); }
  pairs.push([501, 502]);
  const { r, k } = await graduated(pairs, 503, 50000), next = r.positions.slice();
  next[1002] = 1e7; next[1003] = 0; next[1004] = 1e7 + 100; next[1005] = 0;
  const token = await prepare(r, next, () => true); token.commit(); token.discard();
  r[compiled('setLens')](0); r[k('animate')](r[k('lensMotion')].start + 220);
  const a = r.screenPoint(501), b = r.screenPoint(502);
  expect(r[k('lensPoints')].size).toBe(400);
  expect(r[k('pickEdge')]((a.x + b.x) / 2, (a.y + b.y) / 2)).toBe(pairs.length - 1);
});

test('review: a 5000-connection lens uploads at most one span per touched texture row, including cleared offsets', async () => {
  const { r, k } = await graduated(Array.from({ length: 5000 }, (_, i) => [0, i + 1] as [number, number]), 5001, 6000), writes: any[][] = [];
  const gpu = new Float32Array(r[k('lensBytes')].length), width = r.positionWidth;
  r.gl = new Proxy({ isContextLost: () => false, texSubImage2D: (...v: any[]) => { writes.push(v); gpu.set(v[8], (v[3] * width + v[2]) * 4); } }, { get: (o: any, key: string) => key in o ? o[key] : key.toUpperCase() === key ? 1 : () => {} });
  try {
    r[compiled('setLens')](0); expect(writes.length).toBe(Math.ceil(5001 / width)); expect(gpu).toEqual(r[k('lensBytes')]);
    r[k('animate')](r[k('lensMotion')].start + 220); writes.length = 0;
    r[compiled('setLens')](-1); r[k('animate')](r[k('lensMotion')].start + 220);
    expect(writes.length).toBe(Math.ceil(5001 / width)); expect(gpu.every(v => v === 0)).toBe(true);
  } finally { r.gl = null; }
});

test('review: Focus action frames effective lens coordinates, not hidden layout positions', async () => {
  const { r, k } = await graduated([[0, 1], [0, 2]]); r[k('selectNote')](0, true);
  r[compiled('setLens')](0); r[k('animate')](r[k('lensMotion')].start + 220);
  let box: number[] = []; r.frame = (...args: number[]) => { box = args; };
  control(r[k('noteCard')], 'Focus here').click();
  const xs = [0, 1, 2].map(n => r[k('renderCoordinate')](n, 0)), ys = [0, 1, 2].map(n => r[k('renderCoordinate')](n, 1));
  expect(box.slice(0, 4)).toEqual([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  expect(box.slice(0, 4)).not.toEqual([0, 0, 100, 74]);
});

test('review: Open reuses only unpinned notes and reveals the destination; explicit tab and split still create leaves', async () => {
  const plugin: any = new GraphPlugin(); plugin.settings = defaults('links'); plugin.settings.visuals.labelStyle = 'ranked';
  const view = new GraphView(null, plugin), file = new obsidian.TFile(), opened: string[] = [], revealed: any[] = [], requested: any[][] = [];
  const leaf = (name: string, pinned = false) => ({ getViewState: () => ({ pinned }), openFile: async (f: unknown) => { expect(f).toBe(file); opened.push(name); } });
  const pinned = leaf('pinned', true), reusable = leaf('reuse'), created = leaf('created'); let leaves = [pinned, reusable];
  view.app = { vault: { getAbstractFileByPath: () => file }, workspace: { getLeavesOfType: () => leaves, getLeaf: (...args: unknown[]) => { requested.push(args); return created; }, revealLeaf: async (target: unknown) => { revealed.push(target); } } };
  view[compiled('openNote')]('Synthetic.md', 'reuse'); await Promise.resolve(); await Promise.resolve();
  expect(opened).toEqual(['reuse']); expect(revealed).toEqual([reusable]); expect(requested).toEqual([]);
  leaves = [pinned]; view[compiled('openNote')]('Synthetic.md', 'reuse'); await Promise.resolve(); await Promise.resolve();
  expect(requested).toEqual([['tab']]); expect(revealed.at(-1)).toBe(created);
  view[compiled('openNote')]('Synthetic.md', 'tab'); view[compiled('openNote')]('Synthetic.md', 'split'); await Promise.resolve(); await Promise.resolve();
  expect(requested.slice(-2)).toEqual([['tab'], ['split', 'vertical']]); expect(opened).not.toContain('pinned');
});

// Wave-5 focus model and docked card through the compiled renderer (Canvas fixture, synthetic DOM).
// The Obsidian Menu itself is a host seam; native menu rendering and CSS stacking are not claimed.
test('focus model: hover never retiers or opens the card; a click commits a sticky focus that only a click, row, history or Escape changes', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f, card = () => r[k('noteCard')];
  const key = (key: string) => { let handled = false; r[k('keyDown')]({ key, target: r.canvas, preventDefault() { handled = true; } }); return handled; };
  const alt = (n: number) => { const p = r.screenPoint(n); r[k('pointerMove')]({ pointerId: 9, clientX: p.x, clientY: p.y, pointerType: 'mouse', altKey: true }); };
  const none = [[0, 0, 0, 0, 0], [0, 0, 0]];
  f.hover(3); expect(r.hovered).toBe(3); expect(f.actual()).toEqual(none); expect(r.card.node).toBe(-1);
  f.tap(0); expect(f.actual()).toEqual(f.expected(0)); expect(r.card.node).toBe(0);
  // Sticky: hovering, resting, Alt and leaving the graph keep the focus.
  f.hover(3); alt(2); await Bun.sleep(40); r[k('pointerLeave')](); expect(f.actual()).toEqual(f.expected(0)); expect(r.card.node).toBe(0);
  // There is no lock anymore: no K binding, no card chip.
  expect(key('k')).toBe(false); expect(card().textContent).not.toContain('Lock'); expect(r.overlay.children.find((e: any) => e.id === r.canvas.getAttribute('aria-describedby'))?.textContent).not.toContain('K ');
  f.tap(2); expect(f.actual()).toEqual(f.expected(2));
  card().querySelectorAll('button').find((b: any) => b.className === 'graph-ng-connection' && b.attributes['aria-labelledby']?.endsWith('-note-3')).click(); expect(f.actual()).toEqual(f.expected(3));
  control(card(), 'Back').click(); expect(f.actual()).toEqual(f.expected(2));
  expect(key('Escape')).toBe(true); expect(f.actual()).toEqual(none);
  f.tap(1); f.tap(EMPTY); expect(f.actual()).toEqual(none);
});
test('docked card: a fixed right-edge panel that never moves with the camera; labels under it are hidden; framing fits beside it', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [0, 4]]), { r, k } = f, root = r[k('noteCard')];
  root.offsetWidth = 320; root.offsetHeight = 300;
  f.tap(1); r[k('focusLevel')] = 1; r[k('placeOverlay')]();
  const docked = root.style.transform, rect = [...r[k('cardRect')]];
  expect(rect).toEqual([800 - 8 - 320, 8, 320, 300]); expect(docked).toBe('translate(472px, 8px)');
  // Header: name, then Back, Forward and an X icon named Close (never a visible "Close" label).
  const head = root.children[0]; expect(head.children[0].textContent).toBe('1');
  expect(head.children.slice(1).map((b: any) => [b.attributes['aria-label'], b.textContent])).toEqual([['Back', ''], ['Forward', ''], ['Expand connections', ''], ['Close', '']]);
  expect(control(head, 'Close').children[0]!.dataset.icon).toBe('x');
  // Primary rows remain visible; secondary actions share a closed disclosure.
  const open = root.children.find((c: any) => c.className === 'graph-ng-card-primary'); expect(open.children.map((b: any) => b.textContent)).toEqual(['Open note', 'Show only connections']);
  expect(root.children.find((c: any) => c.className === 'graph-ng-card-more').open).not.toBe(true);
  expect(root.querySelectorAll('div').find((c: any) => c.className === 'graph-ng-card-actions').children.map((b: any) => b.textContent)).toEqual(['New tab', 'Open to the right', 'Focus here', 'Connection rings', 'Copy link']);
  // Panning and zooming never move the card.
  r[k('pointerDown')]({ pointerId: 1, button: 0, clientX: 300, clientY: 300 }); r[k('pointerMove')]({ pointerId: 1, clientX: 120, clientY: 210 }); r[k('pointerUp')]({ pointerId: 1, clientX: 120, clientY: 210 });
  r.setCamera(r.camera.x + .2, r.camera.y - .1, r.camera.ratio * .5); r[k('placeOverlay')]();
  expect(r.selected).toBe(1); expect(root.style.transform).toBe(docked); expect([...r[k('cardRect')]]).toEqual(rect);
  // A graduated label or hover name anchored under the card is hidden; outside it is shown.
  r.setCamera(r.camera.x - .2, r.camera.y + .1, r.camera.ratio * 2); r[k('placeOverlay')]();
  const inside = (q: { x: number; y: number }) => q.x >= rect[0]! && q.x <= rect[0]! + rect[2]! && q.y >= rect[1]! && q.y <= rect[1]! + rect[3]!;
  const labels = () => r[k('rankedLabels')].map((slot: any, i: number) => [inside(r.screenPoint(slot.node)), r[k('tierLabels')][i].hidden]);
  const pan = (dx: number) => { const p = r.screenPoint(1); r.setCamera(r.camera.x + (p.x - (rect[0]! + 40 + dx)) / r.scale / r[k('cameraFrame')].width, r.camera.y + (p.y - 150) / r.scale / r[k('cameraFrame')].height, r.camera.ratio); r[k('placeOverlay')](); };
  pan(0); const under = labels(); expect(under.some(([x]: boolean[]) => x)).toBe(true); for (const [x, hidden] of under) if (x) expect(hidden).toBe(true);
  pan(-400); expect(labels().some(([, hidden]: boolean[]) => !hidden)).toBe(true);
  f.hover(1); pan(0); expect(r[k('hoverLabel')].hidden).toBe(true); pan(-400); expect(r[k('hoverLabel')].hidden).toBe(false);
  // The leader cue still runs from the docked card's edge to the cued row's note.
  const row = root.querySelectorAll('button').find((b: any) => b.className === 'graph-ng-connection'); row.onmouseenter(); r[k('placeOverlay')]();
  expect(r[k('cueRing')].hidden).toBe(false); expect(r[k('cueLine')].style.transform).toContain(`translate(${rect[0]}px,`);
  // Focus here fits the box in the view minus the docked card, centred in the remaining area.
  let box: number[] = []; const frame = r.frame; r.frame = (...args: number[]) => { box = args; }; control(root, 'Focus here').click(); r.frame = frame;
  expect(box.slice(5)).toEqual([336, 0]);
  r.frame(0, 0, 100, 100, 0, 336, 0); expect((50 - r[compiled('centerX')]) * r.scale + 400).toBeCloseTo((800 - 336) / 2, 6); expect(100 * r.scale).toBeLessThanOrEqual(800 - 336);
  // Narrow views keep the bottom sheet; framing then insets the bottom instead.
  r[k('width')] = 400; r[k('placeOverlay')](); expect(root.className).toBe('graph-ng-card graph-ng-sheet'); expect(r[k('cardRect')][0]).toBe(0);
});
test('docked card beside the graph tools: the card docks left of an open panel; framing and off-screen arrows keep clear of both', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [0, 4]]), { r, k } = f, root = r[k('noteCard')];
  root.offsetWidth = 320; root.offsetHeight = 300;
  let tools = 0; r.measureTools = () => tools;
  // No panel: the card docks to the view's right edge.
  f.tap(1); r[k('focusLevel')] = 1; r[k('placeOverlay')]();
  expect([...r[k('cardRect')]]).toEqual([800 - 8 - 320, 8, 320, 300]);
  // Opening the panel (368 px over the stage) moves the card left of it, not under it.
  tools = 368; r[compiled('syncTools')](); r[k('placeOverlay')]();
  const rect = [...r[k('cardRect')]]; expect(rect).toEqual([0, 300, 432, 300]); expect(root.style.transform).toBe(''); expect(root.dataset.folded).toBe('true');
  expect(rect[0]! + rect[2]!).toBeLessThanOrEqual(800 - 368);
  // The panel covers the minimap's column, so the card may use the full height.
  expect(root.style.maxHeight).toBe('');
  // Focus framing fits the notes left of card and panel together.
  let box: number[] = []; const frame = r.frame; r.frame = (...args: number[]) => { box = args; }; control(root, 'Focus here').click();
  expect(box.slice(5)).toEqual([368, 308]);
  // Group framing keeps clear of the panel even without a card.
  r[k('selectNote')](-1); r[k('view')].groupCodes = new Uint32Array(5); r[compiled('frameGroup')](0); r.frame = frame;
  expect(box.slice(5)).toEqual([368, 0]);
  // Off-screen arrows sit inside the area left of card and panel.
  f.tap(1); r[k('focusLevel')] = 1; r.setCamera(r.camera.x, r.camera.y, r.camera.ratio * .05); r[k('placeOverlay')]();
  const shown = r[k('pipEls')].filter((el: any) => !el.hidden);
  expect(shown.length).toBeGreaterThan(0);
  for (const el of shown) expect(Number(/translate\((-?[\d.]+)px/.exec(el.style.transform)![1]) + 16).toBeLessThanOrEqual(800 - 368);
  // A panel that leaves no room for the docked card turns the card into a sheet across the remaining width.
  tools = 500; r[compiled('syncTools')](); r[k('placeOverlay')]();
  expect(root.className).toBe('graph-ng-card graph-ng-sheet'); expect(root.style.width).toBe('300px'); expect(r[k('cardRect')][2]).toBe(300);
  // A panel that covers the graph is ignored; closing it restores the edge dock.
  tools = 700; r[compiled('syncTools')](); r[k('placeOverlay')](); expect([...r[k('cardRect')]]).toEqual([472, 8, 320, 300]); expect(root.style.width).toBe('272px');
  tools = 368; r[compiled('syncTools')](); tools = 0; r[compiled('syncTools')](); r[k('placeOverlay')](); expect([...r[k('cardRect')]]).toEqual([472, 8, 320, 300]);
});
test('docked card: Only connections, Lens and path cards share the dock; labels never draw over them', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [0, 4], [4, 3]], 6), { r, k } = f, root = r[k('noteCard')];
  root.offsetWidth = 320; root.offsetHeight = 260;
  const dock = () => { r[k('placeOverlay')](); return root.style.transform; };
  f.tap(0); const at = dock(); expect(at).toBe('translate(472px, 8px)');
  control(root, 'Show only connections').click(); expect(r[k('isolation')]).toBeDefined(); expect(dock()).toBe(at);
  // The anchor has no hidden neighbours at reach 1: no Expand at all, never a disabled "+0".
  expect(root.querySelectorAll('button').some((b: any) => b.textContent.startsWith('Expand'))).toBe(false);
  control(root, 'Connection rings').click(); expect(r[compiled('lensNode')]).toBe(0); expect(dock()).toBe(at);
  r.isolate(-1); r[compiled('setLens')](-1);
  const shift = (n: number) => { const { x, y } = r.screenPoint(n), e = { pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse', shiftKey: true }; r[k('pointerDown')](e); r[k('pointerUp')](e); };
  f.tap(0); shift(3); expect(root.textContent).toContain('Path: 0 → 3'); expect(dock()).toBe(at);
  expect(control(root, 'Close').textContent).toBe(''); expect(root.textContent).not.toContain('×');
  // Path framing leaves room for the docked card.
  let box: number[] = []; const frame = r.frame; r.frame = (...args: number[]) => { box = args; }; control(root, 'Another path').click(); r.frame = frame;
  expect(box.slice(5)).toEqual([336, 0]);
});
test('context menu: right-click on a note, a line and empty canvas shows the registry entries through the host menu seam', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f, menus: { ids: string[]; path?: string; run: (id: string) => void }[] = [];
  r[k('showMenu')] = (entries: any[], _x: number, _y: number, path?: string) => menus.push({ ids: entries.map(e => e.id), path, run: id => entries.find(e => e.id === id).run() });
  const opens: [string, string][] = []; r[compiled('openNote')] = (path: string, mode: string) => opens.push([path, mode]);
  const right = async (q: { x: number; y: number }) => { let prevented = false; r.input[compiled('contextMenu')]({ clientX: q.x, clientY: q.y, preventDefault() { prevented = true; } }); expect(prevented).toBe(true); await Bun.sleep(0); };
  const a = r.screenPoint(1), b = r.screenPoint(2);
  await right(a); expect(menus[0]!.ids).toEqual(['menu-open', 'menu-tab', 'menu-right', 'menu-focus', 'menu-lens', 'menu-only', 'menu-copy']); expect(typeof menus[0]!.path).toBe('string');
  menus[0]!.run('menu-right'); expect(opens).toEqual([[menus[0]!.path!, 'split']]);
  menus[0]!.run('menu-focus'); expect(r.selected).toBe(1); expect(r.card.node).toBe(1);
  await Bun.sleep(850); await right({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  expect(menus[1]!.ids).toEqual(['menu-source', 'menu-target']); expect(menus[1]!.path).toBeUndefined(); // no relationship note on this line
  menus[1]!.run('menu-target'); expect(r.selected).toBe(2);
  await Bun.sleep(850); await right(EMPTY); expect(menus[2]!.ids).toEqual(['menu-fit', 'menu-clear']);
  menus[2]!.run('menu-clear'); expect(r.selected).toBe(-1);
});
test('orientation: wheel and pinch zoom-out clamp with a brief Groups chip, never a switch; breadcrumb and minimap travel', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]], 4), { r, k } = f, chip = r[k('limitChip')].chip, crumbs = r[k('crumbTrail')].root, mini = r[k('miniMap')].root;
  const home = r[k('homeRatio')], limit = Math.max(1, home) * 1.8; expect(home).toBeLessThan(limit); // Fit all is inside the limit
  let overviews = 0; r[k('onZoomOut')] = () => { overviews++; };
  const wheel = () => r.input.wheel({ preventDefault() {}, deltaY: 1000, clientX: 400, clientY: 300 });
  // Nothing selected: the wheel clamps too; the chip shows once for the gesture.
  for (let i = 0; i < 6; i++) wheel();
  expect(overviews).toBe(0); expect(r.camera.ratio).toBeCloseTo(limit); expect(chip.hidden).toBe(false);
  chip.hidden = true; wheel(); expect(chip.hidden).toBe(true); // same gesture: not again
  await Bun.sleep(450); wheel(); expect(chip.hidden).toBe(false); expect(overviews).toBe(0); // a new gesture shows it again
  control(chip, 'Groups').click(); expect(overviews).toBe(1); expect(chip.hidden).toBe(true);
  // With a selection, the wheel and a pinch stop at the same limit.
  f.tap(0); r.setCamera(r.camera.x, r.camera.y, 1); for (let i = 0; i < 6; i++) wheel(); expect(r.camera.ratio).toBeCloseTo(limit);
  r.setCamera(r.camera.x, r.camera.y, 1); r[k('pointerDown')]({ pointerId: 1, button: 0, clientX: 300, clientY: 300 }); r[k('pointerDown')]({ pointerId: 2, button: 0, clientX: 500, clientY: 300 });
  r[k('pointerMove')]({ pointerId: 2, clientX: 310, clientY: 300 }); expect(r.camera.ratio).toBeCloseTo(limit); expect(overviews).toBe(1);
  r[k('pointerUp')]({ pointerId: 2, clientX: 310, clientY: 300 }); r[k('pointerUp')]({ pointerId: 1, clientX: 300, clientY: 300 });
  // The card history drives the breadcrumb; a chip travels back.
  const row = (name: string) => r[k('noteCard')].querySelectorAll('button').find((b: any) => b.attributes['aria-labelledby']?.endsWith(`-note-${name}`));
  r.setCamera(.5, .5, 1); row('1').click(); row('2').click(); r[k('placeOverlay')]();
  const chipEls = () => crumbs.querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-crumb');
  expect(crumbs.hidden).toBe(false); expect(chipEls().map((b: any) => [b.textContent, b.getAttribute('aria-current')])).toEqual([['0', null], ['1', null], ['2', 'location']]);
  // The trail is one strip in the top-left stack with the legend; X clears it (icon only, labelled).
  expect(crumbs.parent).toBe(r[k('legend')].parent); const clear = crumbs.querySelectorAll('button').find((b: any) => b.getAttribute('aria-label') === 'Clear recent notes');
  expect(clear.textContent).toBe(''); expect(clear.icon).toBe('x');
  control(crumbs, '0').click(); expect(r.selected).toBe(0); r[k('placeOverlay')](); expect(chipEls()[0].getAttribute('aria-current')).toBe('location');
  f.settings.visuals.breadcrumb = false; r[k('placeOverlay')](); expect(crumbs.hidden).toBe(true);
  // Minimap: shown on wide canvases; a click centres the camera on that point.
  expect(mini.hidden).toBe(false);
  // The drawn bounds hold the layout and the view, so a click maps through them back to the camera frame.
  const canvas = mini.children[0], frame = r[k('cameraFrame')], last = r[k('miniMap')][k('miniLast')];
  const bounds = miniBounds(frame, last.cx, last.cy, last[k('worldW')], last[k('worldH')]), fit = miniFit(bounds, 160, 120);
  canvas.listeners.get('pointerdown')({ button: 0, pointerId: 3, clientX: 400, clientY: 300 });
  const [x, y] = toCamera(bounds, fit, 80, 60, frame); expect(r.camera.x).toBeCloseTo(x); expect(r.camera.y).toBeCloseTo(y);
  // Collapse: an icon button hides the map; the choice is the minimap's own state.
  const toggle = mini.children[1]; expect(toggle.textContent).toBe('Hide minimap'); expect(toggle.getAttribute('title')).toBeNull(); expect(mini.tabIndex).toBe(0);
  toggle.onclick(); expect(canvas.hidden).toBe(true); expect(toggle.textContent).toBe('Show minimap'); expect(mini.tabIndex).toBe(-1);
  toggle.onclick(); expect(canvas.hidden).toBe(false); expect(mini.tabIndex).toBe(0);
  mini.listeners.get('keydown')({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} }); expect(r.camera.x).toBeGreaterThan(x);
  r[k('width')] = 400; r[k('placeOverlay')](); expect(mini.hidden).toBe(false); expect(canvas.hidden).toBe(true); expect(toggle.hidden).toBe(true);
  r[k('width')] = 800; f.settings.visuals.minimap = false; r[k('placeOverlay')](); expect(mini.hidden).toBe(false); expect(canvas.hidden).toBe(true); expect(toggle.hidden).toBe(true);
  let fits = 0; r.fitAll = () => fits++; const fitButton = control(mini, 'Fit graph'); fitButton.click(); expect(fits).toBe(1); expect(fitButton.getAttribute('title')).toBeNull();
});
// Wave-4 wiring through the compiled renderer: menu path start, Escape layers, breadcrumb lifetime, hover intent vs. lens and path.
test('wave-4 wiring: Find path to… in the menu; Escape clears path, card, lens, isolation in order; the trail outlives the card and prunes on filter', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [0, 4], [4, 3]], 6), { r, k } = f, card = () => r[k('noteCard')], crumbs = r[k('crumbTrail')].root;
  const menus: { ids: string[]; run: (id: string) => void }[] = [];
  r[k('showMenu')] = (entries: any[]) => menus.push({ ids: entries.map(e => e.id), run: id => entries.find(e => e.id === id).run() });
  const esc = () => r[k('keyDown')]({ key: 'Escape', target: r.canvas, preventDefault() {} });
  const chips = () => { r[k('placeOverlay')](); return crumbs.hidden ? [] : crumbs.querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-crumb').map((b: any) => b.textContent); };
  const row = (name: string) => card().querySelectorAll('button').find((b: any) => b.attributes['aria-labelledby']?.endsWith(`-note-${name}`));
  // Right-click a second note with a selection: the registry menu offers the path.
  f.tap(0); const q = r.screenPoint(3); r.input[compiled('contextMenu')]({ clientX: q.x, clientY: q.y, preventDefault() {} }); await Bun.sleep(0);
  expect(menus[0]!.ids).toContain('find-path'); menus[0]!.run('find-path');
  expect(r[k('pathView')]).toBeDefined(); expect(card().textContent).toContain('Path: 0 → 3');
  esc(); expect(r[k('pathView')]).toBeUndefined(); expect(card().textContent).toBe('');
  // Visits build the trail; closing the card keeps it and a chip travels from a closed card.
  f.tap(0); row('1').click(); row('2').click(); expect(chips()).toEqual(['0', '1', '2']);
  esc(); expect(r.card.node).toBe(-1); expect(chips()).toEqual(['0', '1', '2']);
  control(crumbs, '0').click(); expect(r.selected).toBe(0); expect(r.card.node).toBe(0); expect(r.card.history.items).toEqual([0, 1, 2]);
  // Escape layers: card, then lens, then only-connections.
  r[k('keyDown')]({ key: 'l', target: r.canvas, preventDefault() {} }); expect(r[compiled('lensNode')]).toBe(0); r.isolate(0);
  esc(); expect(r.card.node).toBe(-1); expect(r[compiled('lensNode')]).toBe(0);
  esc(); expect(r[compiled('lensNode')]).toBe(-1); expect(r[k('isolation')]).toBeDefined();
  esc(); expect(r[k('isolation')]).toBeUndefined();
  // A filter prunes hidden visits; a different view clears the trail.
  r.setView(new Uint8Array([1, 0, 1, 1, 1, 1]), {}); expect(chips()).toEqual(['0', '2']);
  r[k('clearTrail')](); expect(chips()).toEqual([]);
});
test('wave-4 wiring: hover never moves a path highlight or a pinned lens', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3], [0, 4], [4, 3]], 6), { r, k } = f;
  const shift = (n: number) => { const { x, y } = r.screenPoint(n), e = { pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse', shiftKey: true }; r[k('pointerDown')](e); r[k('pointerUp')](e); };
  f.tap(0); shift(3); const path = f.actual(); expect(path[1]).toEqual([0, 0, 0, 253, 253]);
  f.hover(1); await Bun.sleep(50); expect(r.hovered).toBe(1); expect(f.actual()).toEqual(path);
  r[k('pointerMove')]({ pointerId: 9, clientX: r.screenPoint(2).x, clientY: r.screenPoint(2).y, pointerType: 'mouse', altKey: true }); expect(f.actual()).toEqual(path);
  r[k('pointerLeave')](); f.tap(EMPTY);
  f.tap(0); r[k('keyDown')]({ key: 'l', target: r.canvas, preventDefault() {} }); expect(r[compiled('lensNode')]).toBe(0);
  const lensed = f.actual(); f.hover(3); await Bun.sleep(50); expect(r.hovered).toBe(3); expect(f.actual()).toEqual(lensed); expect(r[compiled('lensNode')]).toBe(0);
});


test('review: minimap rebuild is not starved by continuous frames and disposal cancels it', async () => {
  const { r, k } = await graduated([[0, 1], [1, 2]]);
  r[k('placeOverlay')](); const mini = r[k('miniMap')], version = mini[k('densityVersion')];
  r.setView(new Uint8Array([1, 1, 0, 1, 1]), {});
  for (let i = 0; i < 7; i++) { r[k('placeOverlay')](); await Bun.sleep(50); }
  expect(mini[k('densityVersion')]).toBe(version + 1);
  r.setView(new Uint8Array(5).fill(1), {}); r[k('placeOverlay')]();
  r.dispose(); await Bun.sleep(300); expect(mini[k('densityVersion')]).toBe(version + 1);
});

test('review: minimap theme changes recolor immediately and cancel stale deferred work', async () => {
  const { r, k } = await graduated([[0, 1]]); r[k('placeOverlay')]();
  const mini = r[k('miniMap')], a = mini[k('miniLast')], version = mini[k('densityVersion')];
  mini.update({ ...a, visible: a.visible.slice() });
  mini.update({ ...a, [k('ink')]: '#abcdef' });
  expect(mini[k('densityVersion')]).toBe(version + 1);
  await Bun.sleep(300); expect(mini[k('densityVersion')]).toBe(version + 1);
});
test('review: minimap can revisit a source after a pending rebuild returned to the original', async () => {
  const { r, k } = await graduated([[0, 1]]); r[k('placeOverlay')]();
  const mini = r[k('miniMap')], a = mini[k('miniLast')], b = { ...a, visible: a.visible.slice() }, version = mini[k('densityVersion')];
  mini.update(b); mini.update(a); await Bun.sleep(300);
  mini.update(b); await Bun.sleep(300);
  expect(mini[k('densityVersion')]).toBe(version + 2);
});

test('review: relationship menu retains endpoint actions when optional carrier lookup fails', async () => {
  const { r, k } = await graduated([[0, 1]]), menus: any[][] = [];
  r.projection.carrier[0] = 0;
  r[k('describeEdges')] = async () => { throw new Error('worker unavailable'); };
  r[k('showMenu')] = (entries: any[]) => menus.push(entries);
  const a = r.screenPoint(0), b = r.screenPoint(1);
  r.canvas.listeners.get('contextmenu')({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2, preventDefault() {} });
  await Bun.sleep(0);
  expect(menus[0]!.map(e => e.id)).toEqual(['menu-source', 'menu-target']);
  menus[0]![1].run(); expect(r.selected).toBe(1);
});

test('a collapsed-group hub label never lands on the hover label', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f;
  r.setView(new Uint8Array(5).fill(1), { groupCodes: new Uint32Array([0, 1, 1, 0, 0]), groupLabels: ['Ends', 'Middle'], collapsed: new Uint8Array([0, 1]) });
  f.hover(0); r[k('placeOverlay')]();
  const hover = r[k('hoverLabel')], label = r[k('hubLabels')][0], hub = r[k('hubs')][0];
  expect(hover.hidden).toBe(false); expect(hover.textContent).not.toBe('');
  const [x, y] = hover.style.transform.match(/-?[\d.]+/g).map(Number), scale = r[k('scale')];
  // Move the hub so its centred label (below the disc) would sit on the hover label, then away again.
  const put = (sx: number, sy: number) => { hub.x = r[k('centerX')] + (sx - r[k('width')] / 2) / scale; hub.y = r[k('centerY')] + (sy - hub.radius - 4 - r[k('height')] / 2) / scale; r[k('placeOverlay')](); };
  // Covered by visibility, never `hidden`: display:none would zero its measured width and flip it back every frame.
  label.offsetWidth = 200; label.offsetHeight = 18;
  put(x + 10, y + 2); expect(hover.hidden).toBe(false); expect(label.style.visibility).toBe('hidden'); expect(label.hidden).toBeFalsy();
  r[k('placeOverlay')](); expect(label.style.visibility).toBe('hidden');
  put(r.width / 2, r.height - 50); expect(label.style.visibility).toBe('');
});

test('review: collapsing an inner path note clears its path, not just paths with hidden endpoints', async () => {
  const { r, k } = await graduated([[0, 1], [1, 2], [2, 3]]);
  r[k('findPath')](0, 3); expect(r[k('pathView')]).toBeDefined();
  r.setView(new Uint8Array(5).fill(1), { groupCodes: new Uint32Array([0, 1, 1, 0, 0]), groupLabels: ['Ends', 'Middle'], collapsed: new Uint8Array([0, 1]) });
  expect(r[k('pathView')]).toBeUndefined(); expect(r[k('noteCard')].textContent).toBe('');
});

test('review: a failed Back-to detail attempt consumes pending focus before any early return', async () => {
  const { view } = await fixture();
  const setFocus = () => { view[compiled('pendingFocus')] = { projection: view.projection, node: 2, lens: true }; };
  setFocus(); view.positions = undefined; await view[compiled('showDetails')](); expect(view[compiled('pendingFocus')]).toBeUndefined();
  view.positions = new Float32Array(6); view.gpu = { available: false, reason: 'synthetic refusal' };
  view.stage = { empty() { throw Error('Synthetic unavailable stage'); } }; view.showGroups = () => {}; setFocus(); let saves = 0; view.app = { ...view.app, workspace: { ...view.app?.workspace, requestSaveLayout: () => { saves++; } } };
  await view[compiled('showDetails')](); expect(view[compiled('pendingFocus')]).toBeUndefined();
  expect(view.getState()).toEqual({ presentation: 'nodes' }); expect(saves).toBe(1);
});

test('review: travel, clamped framing and Fit all centre in the unobscured stage', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k } = f;
  f.settings.visuals.cameraAnimationMs = 0; f.tap(0);
  r.measureTools = () => 200; r[compiled('syncTools')]();
  for (const width of [800, 500]) {
    r[k('width')] = width; r[k('placeOverlay')]();
    r[k('travel')](1);
    const [right, bottom] = r[k('cardInset')](), q = r.screenPoint(1);
    expect(q.x).toBeCloseTo((width - right) / 2, 6); expect(q.y).toBeCloseTo((600 - bottom) / 2, 6);
    f.settings.cameraMinRatio = 2;
    r.frame(0, 0, 0, 0, 0, right, bottom);
    expect(r.camera.ratio).toBe(2);
    expect((0 - r[compiled('centerX')]) * r.scale + width / 2).toBeCloseTo((width - right) / 2, 6);
    expect((0 - r[compiled('centerY')]) * r.scale + 300).toBeCloseTo((600 - bottom) / 2, 6);
  }
  f.settings.cameraMinRatio = .02; r[k('width')] = 800;
  r[k('selectNote')](-1); r.fitAll(0);
  expect((50 - r[compiled('centerX')]) * r.scale + 400).toBeCloseTo(300, 6);
  expect(r.screenPoint(0).x).toBeGreaterThan(0); expect(r.screenPoint(2).x).toBeLessThan(600);
  expect(r[k('homeRatio')]).toBe(r.camera.ratio);
});

test('review: hidden edges cannot be picked, including legend-hidden focus tiers and zero opacity', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k } = f;
  f.tap(0); r[k('focusLevel')] = 1;
  const a = r.screenPoint(0), b = r.screenPoint(1), pick = () => r[k('pickEdge')]((a.x + b.x) / 2, (a.y + b.y) / 2);
  f.settings.visuals.edgeMode = 'focus'; expect(pick()).toBe(0);
  r[k('tierMask')] = 0; expect(pick()).toBe(-1);
  // Paths are drawn independently of legend switches.
  r[k('edgeTier')][0] = 253; expect(pick()).toBe(0);
  f.settings.visuals.hoverHighlight = false; expect(pick()).toBe(-1);
  f.settings.visuals.hoverHighlight = true; r[k('focusLevel')] = 0; expect(pick()).toBe(-1);
  r[k('focusLevel')] = 1; f.settings.visuals.edgeMode = 'off'; expect(pick()).toBe(-1);
  f.settings.visuals.edgeMode = 'all'; f.settings.visuals.edgeOpacity = 0; expect(pick()).toBe(-1);
});

test('WebGL picking follows the ink share and long-line fade without culling hovered, focused or path edges', async () => {
  const { r, k, settings } = await graduated([[0, 1], [2, 3]], 4, 0, undefined, new Float32Array([0, 0, 10, 0, 0, 10, 10, 10]));
  const a = r.screenPoint(2), b = r.screenPoint(3), pick = () => r[k('pickEdge')]((a.x + b.x) / 2, (a.y + b.y) / 2), gl = r.gl;
  let share = 0, reach = Infinity;
  r[k('edgeQuiet')] = () => [share, reach];
  try {
    // Both paths omit the same context edges, including from picking.
    expect(pick()).toBe(-1); share = 1; expect(pick()).toBe(1); share = 0; r.gl = {};
    expect(pick()).toBe(-1); share = 1; expect(pick()).toBe(1);
    reach = 1; expect(pick()).toBe(-1); reach = Infinity; share = 0;
    r[k('hoveredEdge')] = 1; expect(pick()).toBe(1); r[k('hoveredEdge')] = -1;
    r[k('edgeTier')][1] = 255; r[k('focusLevel')] = .5; expect(pick()).toBe(1);
    r[k('tierMask')] = 0; expect(pick()).toBe(-1);
    r[k('edgeTier')][1] = 253; expect(pick()).toBe(1);
    settings.visuals.hoverHighlight = false; expect(pick()).toBe(-1);
    settings.visuals.hoverHighlight = true; r[k('edgeOn')][1] = 0; expect(pick()).toBe(-1);
  } finally { r.gl = gl; }
});

test('review: clearing Recent refreshes card navigation and starts the next trip at the open note', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k } = f;
  f.tap(0); r[k('travel')](1); r[k('placeOverlay')]();
  const card = r[k('noteCard')], nav = () => card.querySelectorAll('button').filter((b: any) => /^(Back|Forward)$/.test(b.getAttribute('aria-label') ?? ''));
  expect(nav().map((b: any) => b.disabled)).toEqual([false, true]);
  const clear = r[k('crumbTrail')].root.querySelectorAll('button').find((b: any) => b.getAttribute('aria-label') === 'Clear recent notes'); clear.click();
  expect(nav().map((b: any) => b.disabled)).toEqual([true, true]); expect(r.card.history.items).toEqual([1]);
  r[k('travel')](2); expect(r.card.step(-1)).toBe(true); expect(r.card.node).toBe(1);
});

test('review: minimap collapse schedules a card-height refresh; stable drawing never remeasures tools', async () => {
  const f = await graduated([[0, 1]], 2), { r, k } = f;
  f.tap(0); const card = r[k('noteCard')], mini = r[k('miniMap')]; let measures = 0;
  r.measureTools = () => { measures++; return 0; }; r[compiled('syncTools')]();
  r[k('draw')](); expect(card.style.maxHeight).toBe('456px');
  mini.root.children[1].onclick(); expect(frameCallbacks.size).toBeGreaterThan(0);
  r[k('draw')](); expect(card.style.maxHeight).toBe('544px');
  for (let i = 0; i < 3; i++) r[k('draw')](); expect(measures).toBe(1);
});

test('review: disabled ink budgeting never samples geometry in either renderer path; active geometry stays cached', async () => {
  const f = await graduated([[0, 1]], 2), { r, k } = f, v = f.settings.visuals;
  for (const disabled of ['off', 'zero', 'adapt']) {
    v.edgeMode = disabled === 'off' ? 'off' : 'all'; v.edgeOpacity = disabled === 'zero' ? 0 : .4; v.zoomAdapt = disabled !== 'adapt';
    r[k('ink')] = undefined; r[k('drawCanvas')](); expect(r[k('ink')]).toBeUndefined();
    expect([...r[k('edgeQuiet')](1, false)]).toEqual([1, Infinity]); expect(r[k('ink')]).toBeUndefined();
  }
  v.zoomAdapt = true; r[k('drawCanvas')](); const ink = r[k('ink')]; expect(ink).toBeDefined();
  r.setCamera(.3, .4, .5); r[k('drawCanvas')](); expect(r[k('ink')]).toBe(ink);
  r.setView(new Uint8Array([1, 0]), {}); r[k('drawCanvas')](); expect(r[k('ink')]).not.toBe(ink);
});

test('review: filter changes remove stale hover and minimap focus; hidden-type edges lose their hint', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k } = f;
  f.tap(0); f.hover(2); expect(r.hovered).toBe(2);
  r.setView(new Uint8Array([0, 1, 0]), {}); r[k('placeOverlay')]();
  expect(r.hovered).toBe(-1); expect(r[k('hoverLabel')].textContent).toBe('');
  expect(r[k('miniMap')][k('miniLast')].focus).toBe(-1);
  const all = new Uint8Array([1, 1, 1]); r.setView(all, {});
  const a = r.screenPoint(0), b = r.screenPoint(1);
  f.hover({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); expect(r[k('hoveredEdge')]).toBe(0);
  r.setView(all, { [compiled('typeHidden')]: new Uint8Array([1]) });
  expect(r[k('hoveredEdge')]).toBe(-1); expect(r.container.title).toBe('');
  r.setView(all, {}); expect(r[k('hoveredEdge')]).toBe(0);
  f.settings.visuals.edgeOpacity = 0; r.refreshVisuals(); expect(r[k('hoveredEdge')]).toBe(-1);
});

test('review: denied minimap storage never prevents view creation, collapse or disposal', async () => {
  rejectStorage = true;
  try {
    const f = await graduated([[0, 1]], 2), { r, k } = f, mini = r[k('miniMap')];
    expect(mini.folded).toBe(false); expect(() => mini.root.children[1].onclick()).not.toThrow();
    expect(mini.folded).toBe(true); expect(() => mini.root.children[1].onclick()).not.toThrow();
    expect(mini.folded).toBe(false); r.dispose();
    expect(mini.root.listeners.has('keydown')).toBe(false); expect(r.canvas.listeners.size).toBe(0);
  } finally { rejectStorage = false; }
});
test('hover pulse: only the hovered note grows and rings, the graph is untouched, frames stop when idle, reduced motion is static', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]]), { r, k } = f, fx = () => r[k('hoverFx')], scale = () => r[k('fx')][0], draw = () => r[k('draw')]();
  const radius = (n: number) => r[k('drawnRadius')](n, true, r[k('focusLevel')]);
  f.tap(0); r[k('ripple')] = undefined; r[k('focusLevel')] = r[k('focusTarget')]; draw(); expect(frameCallbacks.size).toBe(0);
  const graph = JSON.stringify([f.actual(), r[k('focusNode')], r.selected, [...r[k('colorBytes')]], r.camera]), rest = radius(2), other = radius(1);
  const arcs: number[][] = [], arc = ctx.arc; ctx.arc = (x: number, y: number, a: number) => arcs.push([x, y, a]);
  try {
    draw(); const plain = arcs.splice(0);
    // Hover: only that note eases up; two breaths finish even while the pointer rests.
    f.hover(2); expect(r.hovered).toBe(2); draw(); expect(fx().n).toBe(2); expect(scale()).toBeLessThan(1.1); expect(frameCallbacks.size).toBe(1);
    fx().at -= 150; arcs.length = 0; draw(); expect(scale()).toBeCloseTo(1.6, 2); expect(radius(2)).toBeGreaterThanOrEqual(rest * 1.6 - 1e-6); expect(radius(1)).toBe(other);
    const p = r.screenPoint(2), q = r.screenPoint(1); expect(r.pick(p.x + rest * 1.45 + 4, p.y)).toBe(2);
    // Canvas parity: every other circle is drawn exactly as before; the hovered note is bigger and gains a ring.
    const at = (a: number[], s: { x: number; y: number }) => a[0] === s.x && a[1] === s.y;
    expect(arcs.filter(a => !at(a, p))).toEqual(plain.filter(a => !at(a, p))); expect(arcs.filter(a => at(a, p)).length).toBe(plain.filter(a => at(a, p)).length + 1); expect(arcs.some(a => at(a, q))).toBe(true);
    expect(JSON.stringify([f.actual(), r[k('focusNode')], r.selected, [...r[k('colorBytes')]], r.camera])).toBe(graph);
    fx().at -= 2150; draw(); expect(frameCallbacks.size).toBe(0); expect(r[k('fx')]).toEqual([1.6, .5]);
    // Leave: eases back down, then the loop stops.
    r[k('pointerLeave')](); draw(); expect(fx().out).toBe(true); expect(frameCallbacks.size).toBe(1);
    fx().at -= 120; draw(); expect(fx().n).toBe(-1); expect(scale()).toBe(1); expect(frameCallbacks.size).toBe(0); expect(radius(2)).toBe(rest);
    expect(JSON.stringify([f.actual(), r[k('focusNode')], r.selected, [...r[k('colorBytes')]], r.camera])).toBe(graph);
    // Reduced motion: a static enlarged ring, no frame loop.
    fixtureReducedMotion = true; f.hover(3); draw(); expect(r[k('fx')]).toEqual([1.6, .5]); expect(frameCallbacks.size).toBe(0);
    r[k('pointerLeave')](); draw(); expect(fx().n).toBe(-1); expect(frameCallbacks.size).toBe(0);
  } finally { ctx.arc = arc; fixtureReducedMotion = false; }
});

test('navigator filters lazily fetched titles and declared groups without graph motion, catches text keys, and resets on travel', async () => {
  const f = await graduated(Array.from({ length: 221 }, (_, i) => [0, i + 1] as [number, number]), 222), { r, k } = f;
  let titles = 0; r[compiled('noteTitle')] = (path: string) => { titles++; return Number(path.replace('.md', '')) % 2 ? '<b>Recovery check</b>' : 'Access review'; };
  r.setView(new Uint8Array(222).fill(1), { groupCodes: Uint32Array.from({ length: 222 }, (_, n) => n % 3), groupLabels: ['Atlas', 'Beacon', 'Cedar'] });
  f.tap(0); const card = r[k('noteCard')], input = card.querySelector('input'), rows = () => card.querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-connection');
  expect(rows().length).toBe(0); expect(card.textContent).toContain('221 direct connections in 3 groups');
  const camera = { ...r.camera }, positions = r.positions, tiers = f.actual(), lookups = titles;
  // The find box is debounced (80 ms); `type` waits past it.
  const type = async (value: string) => { input.value = value; input.oninput(); await Bun.sleep(100); };
  await type('beacon RECOVERY'); expect(card.querySelector('input')).toBe(input);
  expect(rows().length).toBe(37); expect(card.textContent).toContain('37 matching connections'); expect(card.querySelectorAll('b').length).toBe(0);
  expect(rows().every((row: any) => row.textContent.includes('<b>Recovery check</b>'))).toBe(true);
  // Search fetches each connection's title once; a refined query reuses them.
  expect(titles - lookups).toBe(221); await type('beacon recovery check'); expect(titles - lookups).toBe(221); expect(r.camera).toEqual(camera); expect(r.positions).toBe(positions); expect(r.selected).toBe(0); expect(f.actual()).toEqual(tiers);
  // Typing must not invoke graph shortcuts or suppress native input behavior.
  for (const key of ['l', 'r', 'Home', 'ArrowLeft', 'Enter']) {
    let prevented = false; card.onkeydown({ key, target: input, preventDefault() { prevented = true; }, stopPropagation() {} }); expect(prevented).toBe(false);
    expect(r[compiled('lensNode')]).toBe(-1); expect(r.selected).toBe(0);
  }
  await type('no such title'); expect(rows().length).toBe(0); expect(card.textContent).toContain('No matching connections');
  card.onkeydown({ key: 'Escape', target: input, preventDefault() {}, stopPropagation() {} }); expect(r.selected).toBe(0); expect(input.value).toBe('');
  await type('beacon recovery'); rows()[0].click(); expect(r.selected).not.toBe(0); expect(card.querySelector('input').value).toBe('');
});

test('large hub labels are a six-note preview while the full topology remains available', async () => {
  const f = await graduated(Array.from({ length: 221 }, (_, i) => [0, i + 1] as [number, number]), 222), { r, k } = f;
  f.tap(0); r[k('focusLevel')] = 1; r[k('placeOverlay')]();
  expect(r[k('directs')].length).toBe(221);
  expect(r[k('rankedLabels')].filter((slot: any) => slot.rank === 1).length).toBeLessThanOrEqual(6);
  expect(r[k('rankedLabels')].every((slot: any) => slot.rank === 1)).toBe(true);
  expect(r[k('moreButton')].textContent).toMatch(/^\+21[5-9] more$|^\+22[01] more$/);
  expect(f.actual()).toEqual(f.expected(0));
});

test('navigator bounds group headers, searches beyond the page, and preserves collapsed state on refresh', async () => {
  const f = await graduated(Array.from({ length: 150 }, (_, i) => [0, i + 1] as [number, number]), 151), { r, k } = f;
  r.setView(new Uint8Array(151).fill(1), { groupCodes: Uint32Array.from({ length: 151 }, (_, n) => n), groupLabels: Array.from({ length: 151 }, (_, n) => `Group ${String(n).padStart(3, '0')}`) });
  f.tap(0); const card = r[k('noteCard')], groups = () => card.querySelectorAll('summary').filter((b: any) => b.className === 'graph-ng-connection-group');
  expect(groups().length).toBe(100); control(card, 'Show more groups').click(); expect(groups().length).toBe(150);
  // A query lists matches flat (with their group name) from every group, beyond the header page.
  const input = card.querySelector('input'), rows = () => card.querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-connection');
  input.value = 'Group 150'; input.oninput(); await Bun.sleep(100); expect(groups().length).toBe(0);
  expect(rows().length).toBe(1); expect(rows()[0].textContent).toContain('Group 150');
  // Clearing restores the sections as they were, including the extra header page.
  input.value = ''; input.oninput(); await Bun.sleep(100); expect(groups().length).toBe(150); expect(groups()[0].attributes['aria-expanded']).toBe('false');
  // A small neighbourhood initially expands, but an explicit collapse survives a same-note refresh.
  r[k('focusNote')](1); const section = card.querySelectorAll('summary').find((b: any) => b.className === 'graph-ng-connection-group');
  expect(section.attributes['aria-expanded']).toBe('true'); section.click(); r.card.show(1);
  expect(card.querySelectorAll('summary').find((b: any) => b.className === 'graph-ng-connection-group').attributes['aria-expanded']).toBe('false');
});


test('overview base radius is shared by Canvas/WebGL, preserves degree sizing and honours opt-out', async () => {
  const f = await graduated([[0, 1], [0, 2], [0, 3]], 4), { r, k, settings } = f;
  r.visibleNodes = 100000; r.camera.ratio = r[k('homeRatio')] * 100;
  const original = r.gl;
  for (const size of [.4, 3, 12]) {
    settings.nodeSize = size; settings.visuals.zoomAdapt = true;
    r.gl = null; const canvas = r[k('baseNodeRadius')](); r.gl = {};
    expect(r[k('baseNodeRadius')]()).toBe(canvas); expect(canvas).toBeGreaterThanOrEqual(Math.min(size, 1.2)); expect(canvas).toBeLessThanOrEqual(size);
    settings.visuals.zoomAdapt = false; r.gl = null; expect(r[k('baseNodeRadius')]()).toBe(size);
  }
  r.gl = original;
});

test('compiled Canvas retains all 483 selected hub edges even when context admission is zero', async () => {
  const degree = 483, xy = new Float32Array((degree + 1) * 2);
  for (let i = 1; i <= degree; i++) { xy[i * 2] = 100 * Math.cos(i * Math.PI * 2 / degree); xy[i * 2 + 1] = 100 * Math.sin(i * Math.PI * 2 / degree); }
  const f = await graduated(Array.from({ length: degree }, (_, i) => [0, i + 1] as [number, number]), degree + 1, 0, undefined, xy), { r, k } = f;
  const saved = { stroke: ctx.stroke, moveTo: ctx.moveTo, beginPath: ctx.beginPath };
  let segments = 0; const strokes: [number, number][] = [];
  Object.assign(ctx, { beginPath: () => { segments = 0; }, moveTo: () => { segments++; }, stroke: () => { if (segments) strokes.push([ctx.globalAlpha, segments]); } });
  try {
    Object.assign(f.settings.visuals, { focusEdges: true, zoomAdapt: true });
    f.tap(0); expect(r.selected).toBe(0); expect(r[k('directs')]).toHaveLength(degree);
    r[k('focusLevel')] = 1; r[k('edgeQuiet')] = () => [0, 1]; r.atlas = undefined;
    r[k('drawCanvas')](); expect(strokes).toHaveLength(1); expect(strokes[0]![1]).toBe(degree);
    expect(strokes[0]![0]).toBeCloseTo(.95 / Math.sqrt(degree / 24), 12);
    strokes.length = 0; f.settings.visuals.edgeOpacity = 0; r[k('drawCanvas')](); expect(strokes).toEqual([]);
  } finally { Object.assign(ctx, saved); }
});

test('compiled overview admission is capped at eight shares and retained alpha has no close-zoom boost', async () => {
  const { r, k, settings } = await graduated([[0, 1]], 2);
  settings.visuals.zoomAdapt = true; r.visibleEdges = 10000;
  r[k('ink')] = { display: r[k('display')], area: 1, length: 1, clipped: 1 };
  for (const zoom of [.001, .125, .25, 1, 8]) {
    r.camera.ratio = r[k('homeRatio')] * zoom;
    const share = r[k('edgeQuiet')](1)[0], base = .2 / (10000 / r.scale);
    expect(share).toBeCloseTo(Math.min(1, base * Math.max(1, Math.min(8, zoom * 8))), 12);
    expect(share).toBeLessThanOrEqual(Math.min(1, base * 8));
  }
  r[k('edgeQuiet')] = () => [1, Infinity]; r.atlas = undefined;
  const saved = ctx.stroke, alphas: number[] = []; ctx.stroke = () => alphas.push(ctx.globalAlpha);
  try {
    for (const zoom of [.05, .2, 1]) { r.camera.ratio = r[k('homeRatio')] * zoom; r[k('drawCanvas')](); }
    expect(alphas).toHaveLength(3); expect(alphas[0]).toBe(alphas[1]); expect(alphas[1]).toBe(alphas[2]);
  } finally { ctx.stroke = saved; }
});

test('Only connections draws the selected fan after opaque dots, without adding a Canvas edge pass', async () => {
  const f = await graduated([[0, 1], [0, 2], [1, 3]], 4), { r, k } = f;
  const old = { fill: ctx.fill, stroke: ctx.stroke, moveTo: ctx.moveTo, beginPath: ctx.beginPath };
  let segments = 0; const order: string[] = [];
  Object.assign(ctx, { beginPath: () => { segments = 0; }, moveTo: () => { segments++; }, fill: () => order.push('node'), stroke: () => { if (segments) order.push(`edge:${segments}`); } });
  try {
    f.tap(0); r[k('focusLevel')] = 1; r.atlas = undefined; r[k('edgeQuiet')] = () => [1, Infinity];
    r[k('drawCanvas')](); const count = order.filter(x => x.startsWith('edge')).length;
    expect(order.indexOf('edge:2')).toBeLessThan(order.indexOf('node'));
    r.isolate(0, 2, false); order.length = 0; r[k('drawCanvas')]();
    expect(order.filter(x => x.startsWith('edge'))).toHaveLength(count);
    expect(order.indexOf('edge:2')).toBeGreaterThan(order.indexOf('node'));
    expect(order.at(-1)).toBe('node'); // Selected dot is protected above the fan.
    f.settings.visuals.edgeOpacity = 0; order.length = 0; r[k('drawCanvas')]();
    expect(order.filter(x => x.startsWith('edge'))).toEqual([]);
  } finally { Object.assign(ctx, old); }
});

test('Escape clears hovered animation and stale pointer replay, while history remains navigable without a current ring', async () => {
  const f = await graduated([[0, 1], [1, 2]], 4), { r, k } = f;
  f.tap(0); f.tap(1); r.isolate(1, 2, false); f.hover(2);
  r[k('animate')](performance.now() + 500); r[k('placeOverlay')]();
  expect(r[k('hoverFx')].n).toBe(2); const history = [...r.card.history.items];
  r[k('keyDown')]({ key: 'Escape', target: r.canvas, preventDefault() {} });
  r[k('placeOverlay')]();
  expect(r.selected).toBe(-1); expect(r.hovered).toBe(-1); expect(r[compiled('hoveredEdge')]).toBe(-1);
  expect(r[k('hoverFx')].n).toBe(-1); expect(r[k('focusNode')]).toBe(-1); expect(r[k('near')]).toEqual([]);
  expect(r[k('hoverLabel')].textContent).toBe(''); expect(r[k('pathView')]).toBeUndefined();
  expect(r.card.history.items).toEqual(history);
  expect(r[k('crumbTrail')].root.querySelectorAll('[aria-current]')).toEqual([]);
  // Coordinate changes cannot resurrect the old pointer location. A new pointer event still works.
  r.input[k('replayHover')](); expect(r.hovered).toBe(-1);
  f.hover(2); expect(r.hovered).toBe(2);
});

test('atlas glyphs carry shared whole-label bounds and pips retain a full-height viewport inset', async () => {
  const f = await graduated([[0, 1], [1, 2]], 4), { r, k } = f;
  await r[k('prepareLabels')](() => true);
  for (const level of r.atlas.levels as Float32Array[]) for (let i = 0; i < level.length;) {
    const left = level[i + 11]!, width = level[i + 12]!;
    expect(level[i + 1]).toBe(left); expect(level[i + 3]).toBe(width);
    for (i += 13; i < level.length && level[i + 6] !== 2; i += 13) {
      expect(level[i + 11]).toBe(left); expect(level[i + 12]).toBe(width);
    }
  }
  f.tap(0); r[k('focusLevel')] = 1;
  r.setCamera(r.camera.x, r.camera.y, .02); r[k('placeHighlights')](1);
  const pips = r[k('pipEls')].filter((el: any) => !el.hidden);
  expect(pips.length).toBeGreaterThan(0);
  for (const el of pips) {
    const [x, y] = el.style.transform.match(/-?[\d.]+/g).map(Number);
    expect(x).toBeGreaterThanOrEqual(32); expect(y).toBeGreaterThanOrEqual(32);
    expect(x + 32).toBeLessThanOrEqual(r.width - 32); expect(y + 32).toBeLessThanOrEqual(r.height - 32);
  }
});

test('WebGL frames reuse edge ranks without endpoint scans or another edge pass in Only connections', async () => {
  const f = await graduated([[0, 1], [0, 2], [1, 3]], 4), { r, k } = f;
  f.tap(0); r[k('focusLevel')] = 1; r[k('focusTarget')] = 1;
  const d = driver(r), calls: number[] = []; let program = -1;
  r[k('programs')] = [0, 1, 2, 3].map(handle => ({ handle, uniforms: {} }));
  d.gl.useProgram = (handle: number) => { program = handle; };
  d.gl.drawArraysInstanced = d.gl.drawElementsInstanced = () => calls.push(program);
  r[k('draw')](); const ranks = r[compiled('lineRanks')], ink = r[k('ink')], columns = [r.projection.source, r.projection.target, r.projection.offsets];
  const guard = (column: Uint32Array) => new Proxy(column, { get(target, key) { if (typeof key === 'string' && /^\d+$/.test(key)) throw new Error('per-frame edge/degree scan'); return Reflect.get(target, key, target); } });
  [r.projection.source, r.projection.target, r.projection.offsets] = columns.map(guard);
  try {
    calls.length = 0; r[k('draw')](); const normal = [...calls];
    r.isolation = { node: 0, hops: 2, expanded: new Set(), shown: [] };
    calls.length = 0; r[k('draw')]();
    expect(calls.filter(x => x === 0)).toHaveLength(1); expect(calls).toHaveLength(normal.length);
    expect(normal.indexOf(0)).toBeLessThan(normal.indexOf(1)); expect(calls.indexOf(0)).toBeGreaterThan(calls.indexOf(1));
    expect(r[compiled('lineRanks')]).toBe(ranks); expect(r[k('ink')]).toBe(ink);
  } finally { [r.projection.source, r.projection.target, r.projection.offsets] = columns; }
});

test('density production passes are bounded, reuse target, restore blend/viewport and bypass focus-only/off', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k, settings } = f;
  const d = driver(r), events: any[] = []; let program = -1, layer = 1, textures = 0, targets = 0;
  r[k('programs')] = [0, 1, 2, 3, 4].map(handle => ({ handle, uniforms: { layer: 'layer' } }));
  d.gl.createTexture = () => { textures++; return {}; }; d.gl.createFramebuffer = () => { targets++; return {}; };
  d.gl.checkFramebufferStatus = () => d.gl.FRAMEBUFFER_COMPLETE;
  d.gl.useProgram = (p: number) => { program = p; };
  d.gl.uniform1i = (u: string, x: number) => { if (u === 'layer') layer = x; };
  d.gl.drawArraysInstanced = d.gl.drawElementsInstanced = () => events.push(['draw', program, layer]);
  d.gl.drawArrays = () => events.push(['quad', program]);
  d.gl.blendFunc = (...args: number[]) => events.push(['blend', ...args]);
  d.gl.viewport = (...args: number[]) => events.push(['viewport', ...args]);
  d.gl.bindFramebuffer = (_: number, target: unknown) => events.push(['target', target]);
  r[k('draw')](); expect(textures).toBe(0); expect(targets).toBe(0);
  const baseline = events.filter(x => x[0] === 'draw'); expect(baseline.filter(x => x[1] === 0)).toEqual([['draw', 0, 1]]);
  settings.visuals.edgeCompositing = 'density'; events.length = 0; r[k('draw')]();
  expect(events.filter(x => x[0] === 'draw' && x[1] === 0)).toEqual([['draw', 0, 2], ['draw', 0, 3]]);
  expect(events.filter(x => x[0] === 'quad')).toEqual([['quad', 4]]);
  expect(events.filter(x => x[0] === 'target').at(-1)).toEqual(['target', null]);
  expect(events.filter(x => x[0] === 'blend').at(-1)).toEqual(['blend', d.gl.ONE, d.gl.ONE_MINUS_SRC_ALPHA]);
  expect(events.filter(x => x[0] === 'viewport').at(-1)).toEqual(['viewport', 0, 0, r.canvas.width, r.canvas.height]);
  const images = d.calls.filter(x => x[0] === 'image').length, ranks = r[compiled('lineRanks')];
  r[k('draw')](); expect(textures).toBe(1); expect(targets).toBe(1); expect(d.calls.filter(x => x[0] === 'image')).toHaveLength(images); expect(r[compiled('lineRanks')]).toBe(ranks);
  for (const mode of ['focus', 'off'] as const) { settings.visuals.edgeMode = mode; events.length = 0; r[k('draw')](); expect(events.some(x => x[0] === 'quad')).toBe(false); }
  settings.visuals.edgeMode = 'all'; settings.visuals.edgeOpacity = 0; events.length = 0; r[k('draw')](); expect(events.some(x => x[0] === 'quad')).toBe(false);
  settings.visuals.edgeOpacity = .4; settings.visuals.edgeCompositing = 'blend'; events.length = 0; r[k('draw')](); expect(events.filter(x => x[0] === 'draw')).toEqual(baseline);
  r[k('width')] = 4096; r[k('height')] = 2048; r[k('densityTarget')](); expect(r[k('densitySize')]).toEqual([2048, 1024]); expect(textures).toBe(1); expect(targets).toBe(1);
  const sized = d.calls.length; r.dpr = 3; r[k('densityTarget')](); expect(d.calls).toHaveLength(sized);
  let deleted = 0; d.gl.deleteFramebuffer = () => { deleted++; }; r.dispose(); expect(deleted).toBe(1);
});

test('density production refuses incomplete or failed allocations without retrying each frame; restore discards stale handles', async () => {
  const { r, k } = await graduated([[0, 1]], 2), d = driver(r); let allocations = 0;
  d.gl.createTexture = () => ({}); d.gl.createFramebuffer = () => ({});
  d.gl.texImage2D = () => { allocations++; }; d.gl.checkFramebufferStatus = () => 0;
  expect(r[k('densityTarget')]()).toBe(false); expect(r[k('densityTarget')]()).toBe(false); expect(allocations).toBe(1);
  d.gl.checkFramebufferStatus = () => d.gl.FRAMEBUFFER_COMPLETE; r[k('width')]++;
  d.gl.getError = () => 1285; expect(r[k('densityTarget')]()).toBe(false);
  d.gl.getError = () => d.gl.NO_ERROR; r[k('width')]++; expect(r[k('densityTarget')]()).toBe(true);
  let initialized = 0; r[k('initialize')] = async () => { initialized++; };
  r[k('contextRestored')](); await Promise.resolve();
  expect(initialized).toBe(1); expect(r[k('densitySize')]).toEqual([0, 0]); expect(r[k('densityBuffer')]).toBeNull(); expect(r[k('densityReady')]).toBe(false); expect(r.textures).toEqual([]);
});

test('density requested on Canvas uses identical existing strokes without an offscreen target', async () => {
  const { r, k, settings } = await graduated([[0, 1], [1, 2]], 3), strokes: any[] = [], previous = ctx.stroke;
  ctx.stroke = () => strokes.push([ctx.globalAlpha, ctx.strokeStyle, ctx.lineWidth]);
  try {
    r[k('drawCanvas')](); const baseline = [...strokes]; strokes.length = 0;
    settings.visuals.edgeCompositing = 'density'; r[k('drawCanvas')]();
    expect(strokes).toEqual(baseline); expect(r[k('densityBuffer')]).toBeNull();
  } finally { ctx.stroke = previous; }
});

// The shipped shader scalar expressions are evaluated against the compiled CPU renderer.
// This is arithmetic/driver parity, not a substitute for GPU raster acceptance.
const shaderOriginalNames = Object.fromEntries(Object.entries(shaderNames).map(([name, short]) => [short, name]));
const emphasisShader = source.match(/if\(emphasis>0\.\)\{([\s\S]*?)\}else\{/)![1]!.replace(/\b[A-Za-z_]\w*\b/g, name => shaderOriginalNames[name] ?? name);
const emphasisGL = new Function('e', `with(e) { ${emphasisShader.replace(/\bfloat\b/g, 'let')} return radius; }`) as (e: any) => number;
test('adaptive compiled Canvas, bundled GLSL and hit radii agree across tiers, zoom, fan-out and hover easing', async () => {
  const f = await graduated([[0, 1], [1, 2]], 5), { r, k } = f, v = f.settings.visuals;
  f.tap(0); v.emphasis = 'adaptive'; v.tierRings = false;
  r[k('focusLevel')] = 1; r[k('focusTarget')] = 1;
  const saved = { arc: ctx.arc, fill: ctx.fill }, radii: number[] = []; let current = 0;
  ctx.arc = (_x: number, _y: number, rad: number) => { current = rad; }; ctx.fill = () => radii.push(current);
  try {
    for (const count of [2, 240]) for (const ratio of [.05, 1, 8]) for (const pulse of [1, 1.3, 1.6]) for (const level of [0, .4, 1]) {
      r[k('directs')] = new Array(count).fill(1); r.setCamera(.5, .5, ratio); r[k('focusLevel')] = level;
      r[k('hoverFx')].n = 1; r.fx[0] = pulse; r.fx[1] = .5; r.hovered = 1;
      radii.length = 0; r[k('drawCanvas')](); expect(radii.length).toBe(5);
      for (let n = 0; n < 5; n++) {
        const hot = n === 0 || n === 1, ego = n === 0, radius = r.nodeRadius(n, hot), g = r[k('stateBytes')][n * 4 + 1] / 255;
        const expected = Math.max(n === 0 ? 5 : 1 / r.dpr, emphasisGL({ radius, ego, note: false, st: { g }, emphasis: r[compiled('emphasisBudget')](), minSize: v.tierMinSize, focus: level, id: n, hovered: 1, pulse: { x: pulse }, max: Math.max }));
        expect(radii[n === 0 ? 4 : n - 1]).toBeCloseTo(expected, 8); expect(r[k('drawnRadius')](n, hot, level)).toBeCloseTo(expected, 8);
      }
    }
    // All nodes far apart: the drawn disc plus the existing 4 px click tolerance, not a legacy global radius.
    Object.assign(f.settings, { nodeSize: 1, nodeSizing: { policy: 'predictable', compensation: 0, floor: 1 } });
    r.setCamera(.5, .5, .5); r[k('focusLevel')] = 1; r.fx[0] = 1; r[k('hoverFx')].n = -1; r.hovered = -1;
    for (const sizing of ['predictable', 'legacy'] as const) for (const px of [0, 7, 16]) {
      f.settings.nodeSizing.policy = sizing; v.tierMinSize = px;
      for (const n of [0, 1, 2, 4]) {
        const p = r.screenPoint(n), rad = r[k('drawnRadius')](n, n === 0, 1);
        expect(r.pick(p.x, p.y + rad + 3.99)).toBe(n); expect(r.pick(p.x, p.y + rad + 4.01)).not.toBe(n);
      }
    }
    // A hidden tier stays at its base size; a folded carrier is still unpickable.
    r.tierMask = 0; expect(r[k('drawnRadius')](1, false, 1)).toBe(r.nodeRadius(1));
    r.projection.carrierNodes[1] = 1; v.carrierLodNear = .01; v.carrierLodFar = .02;
    r.setCamera(.5, .5, 8); const p = r.screenPoint(1); expect(r.pick(p.x, p.y)).not.toBe(1);
  } finally { Object.assign(ctx, saved); }
});

test('adaptive compiled fan-out shifts disc area into contrast without enlarging legible dots; scale retains exact old radius', async () => {
  const f = await graduated([[0, 1], [1, 2]], 5), { r, k } = f, v = f.settings.visuals;
  f.tap(0); r[k('hoverFx')].n = -1;
  r[k('baseNodeRadius')] = () => 1; r.sizes.fill(1);
  const sample = (degree: number) => { r[k('directs')] = new Array(degree).fill(1); return [r[k('drawnRadius')](1, false, 1), r[compiled('emphasisDim')]()]; };
  const sparse = sample(2), dense = sample(240); expect(sparse[0]).toBeGreaterThan(6); expect(dense[0]).toBeGreaterThan(4); expect(dense[0]).toBeLessThan(5);
  expect(dense[1]).toBeLessThan(sparse[1]); expect(r[k('drawnRadius')](0, true, 1)).toBe(7);
  // Broad 2-hop focus also spends less area, even if the focus itself has few direct connections.
  r[k('directs')] = [1, 2]; const near = r.near; r.near = new Array(2000).fill(2); expect(r[k('drawnRadius')](1, false, 1)).toBeGreaterThan(3.8); expect(r[k('drawnRadius')](1, false, 1)).toBeLessThan(4.5); r.near = near;
  r[k('baseNodeRadius')] = () => 20; expect(r[k('drawnRadius')](1, false, 1)).toBe(20);
  r[k('hoverFx')].n = 1; r.fx[0] = 1.6; expect(r[k('drawnRadius')](1, true, 1)).toBeCloseTo(23, 8);
  v.emphasis = 'scale'; expect(r[k('drawnRadius')](1, true, 1)).toBeCloseTo(22 * 1.25 * 1.6, 8); expect(r[compiled('emphasisDim')]()).toBe(v.dimOpacity);
  expect(r[k('drawnRadius')](0, true, 1)).toBeCloseTo(22 * 1.6, 8);
});

test('compiled WebGL dispatch supplies adaptive budget and contrast, with no coordinate upload', async () => {
  const f = await graduated([[0, 1]], 3), { r, k } = f; f.tap(0); r[k('directs')] = new Array(240).fill(1);
  const uniforms: Record<string, number> = {}; let uploads = 0;
  const gl: any = new Proxy({ uniform1f: (name: string, value: number) => { uniforms[name] = value; }, texSubImage2D: () => { uploads++; } }, { get: (o: any, key: string) => key in o ? o[key] : key.toUpperCase() === key ? 1 : () => {} });
  r.gl = gl; r[k('programs')] = [0, 1, 2, 3].map(handle => ({ handle, uniforms: new Proxy({}, { get: (_o, key) => key }) })); r.atlas = undefined;
  r[k('focusLevel')] = 1; r[k('focusTarget')] = 1;
  for (const mode of ['adaptive', 'scale'] as const) {
    f.settings.visuals.emphasis = mode; r[k('draw')]();
    expect(uniforms.emphasis).toBe(mode === 'adaptive' ? 1 / Math.sqrt(21) : 0);
    expect(uniforms.dim).toBe(mode === 'adaptive' ? .036 : .12);
  }
  expect(uploads).toBe(0);
});

test('review: adaptive context dim holds through the deselect fade instead of jumping before it', async () => {
  const f = await graduated([[0, 1], [1, 2]], 5), { r, k } = f; f.settings.visuals.emphasis = 'adaptive';
  f.tap(0); r[k('directs')] = new Array(240).fill(1); r[k('focusTarget')] = 1; r[k('focusLevel')] = 1;
  const focused = r[compiled('emphasisDim')](); expect(focused).toBeLessThan(f.settings.visuals.dimOpacity);
  r[k('directs')] = []; r.near = []; r[k('focusTarget')] = 0; r[k('focusLevel')] = .5;
  expect(r[compiled('emphasisDim')]()).toBe(focused);
  r[k('focusLevel')] = 0; expect(r[compiled('emphasisDim')]()).toBe(f.settings.visuals.dimOpacity);
});

test('review: the density target upsamples with linear filtering', async () => {
  const { r, k } = await graduated([[0, 1]], 2), d = driver(r), params: number[][] = [];
  d.gl.createTexture = () => ({}); d.gl.createFramebuffer = () => ({}); d.gl.checkFramebufferStatus = () => d.gl.FRAMEBUFFER_COMPLETE;
  d.gl.texParameteri = (_t: number, name: number, value: number) => params.push([name, value]);
  r[k('densitySize')] = [0, 0]; r[k('densityTarget')]();
  expect(params.slice(-2)).toEqual([[d.gl.TEXTURE_MIN_FILTER, d.gl.LINEAR], [d.gl.TEXTURE_MAG_FILTER, d.gl.LINEAR]]);
});


test('anchored overview reuses ranked LOD candidates and culls offscreen names before its collision cap', async () => {
  const { r, k } = await graduated([], 302);
  let lod = 0; r[k('lodLevel')] = () => lod;
  r.atlas.nodes = [Uint32Array.from({ length: 301 }, (_, n) => n), new Uint32Array([301])];
  r.screenPoint = (n: number) => ({ x: n < 300 ? -100 : 200, y: 200 });
  const place = () => r[k('placeAnchored')](-1, 0, () => 2, (x: number) => x < 0);
  place(); expect([...r[k('anchorPrevious')].keys()]).toEqual([300]);
  const measured = r[k('anchorNames')]; place(); expect(r[k('anchorNames')]).toBe(measured);
  lod = 1; place(); expect([...r[k('anchorPrevious')].keys()]).toEqual([301]);
  expect(r[k('anchorPool')]).toHaveLength(1);
});

test('anchored production labels pool opaque uniform names, preserve tier toggles, and clear on style switch', async () => {
  const f = await graduated([[0, 1], [0, 2], [2, 3]], 4), { r, k } = f;
  f.settings.visuals.labelStyle = 'anchored';
  const paint = () => { r[k('focusLevel')] = 1; r[k('placeOverlay')](); return r[k('anchorPool')].filter((p: any) => !p.hidden); };
  f.hover(0); let shown = paint(); expect(shown.length).toBeGreaterThan(0);
  expect(r.canvas.getAttribute('aria-label')).toBeNull(); expect(r.canvas.getAttribute('aria-describedby')).toBeTruthy(); expect(r.container.title).toBe('');
  for (const p of shown) { expect(p.style.font).toStartWith('13px '); expect(p.style.opacity).toBeUndefined(); expect(p.style['--anchor-radius']).toEndWith('px'); expect(p.style['--anchor-angle']).toEndWith('deg'); }
  const pool = [...r[k('anchorPool')]]; paint(); expect(r[k('anchorPool')]).toEqual(pool);
  expect(pool.length).toBeLessThanOrEqual(64);
  f.tap(0); paint(); r[k('tierMask')] = 0; paint();
  expect([...r[k('anchorPrevious')].keys()]).toEqual([0]);
  f.settings.visuals.labelStyle = 'ranked'; r[k('rankedKey')] = []; r[k('placeOverlay')]();
  expect(r[k('anchorPool')].every((p: any) => p.hidden)).toBe(true);
});

test('Recent keyboard edits keep card and renderer selection aligned, including removing current and hidden history', async () => {
  const f = await graduated([[0, 1], [1, 2], [2, 3]], 4), { r, k } = f, trail = r[k('crumbTrail')].root;
  [0, 1, 2, 3].forEach(n => f.tap(n)); r[k('placeOverlay')]();
  const chips = () => trail.querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-crumb');
  const key = (el: any, key: string) => el.onkeydown({ key, preventDefault() {}, stopPropagation() {} });
  control(trail, '1').click(); r[k('placeOverlay')](); expect(r.card.history.at).toBe(1);
  key(control(trail, '1'), 'Backspace'); r[k('placeOverlay')]();
  expect(r.card.history.items).toEqual([0, 1]); expect(r.card.node).toBe(1); expect(r.selected).toBe(1);
  key(control(trail, '1'), 'Delete'); r[k('placeOverlay')]();
  expect(r.card.history.items).toEqual([0]); expect(r.card.node).toBe(0); expect(r.selected).toBe(0); expect(trail.hidden).toBe(true);
  expect(ControlElement.active).toBe(r.canvas);
});

test('Recent current visit reopens a closed card rather than opening edit actions', async () => {
  const f = await graduated([[0, 1]], 2), { r, k } = f;
  f.tap(0); f.tap(1); r[k('selectNote')](-1); r[k('placeOverlay')]();
  control(r[k('crumbTrail')].root, '1').click();
  expect(r.selected).toBe(1); expect(r.card.node).toBe(1); expect(r.card.history.items).toEqual([0, 1]);
});

test('Recent exposes complete untrusted names as text and renders fewer chips on narrow panes', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k } = f;
  const long = 'start-' + 'x'.repeat(180) + '-<img>-ending';
  r.projection.paths = encodeStrings([long + '.md', 'Second.md', 'Third.md']);
  [0, 1, 2].forEach(n => f.tap(n)); r[k('placeOverlay')]();
  const root = r[k('crumbTrail')].root, chips = () => root.querySelectorAll('button').filter((b: any) => b.className === 'graph-ng-crumb');
  const first = chips()[0]; expect(first.getAttribute('aria-label')).toBe(long);
  expect(first.textContent).toStartWith('start-'); expect(first.textContent).toEndWith('-ending'); expect(first.textContent).toContain('…');
  expect(first.children.every((e: any) => e.tagName === 'SPAN')).toBe(true);
  r[k('width')] = 420; r[k('placeOverlay')](); expect(chips().length).toBe(2);
  expect(root.querySelectorAll('button').some((b: any) => b.getAttribute('aria-label') === '1 other recent visits')).toBe(true);
});

test('click framing defaults off, upgrades missing keys, and validates both new presentation choices', () => {
  const s = defaults('links'), old: any = structuredClone(s); delete old.visuals.clickFraming; delete old.visuals.cardPlacement;
  expect(upgradeSettings(old, 'links').visuals.clickFraming).toBe('off'); expect(upgradeSettings(old, 'links').visuals.cardPlacement).toBe('auto');
  for (const clickFraming of ['off', 'center', 'fit-neighbours'] as const) for (const cardPlacement of ['auto', 'side', 'sheet'] as const) {
    validateSettings({ ...s, visuals: { ...s.visuals, clickFraming, cardPlacement } });
  }
  for (const key of ['clickFraming', 'cardPlacement']) expect(() => validateSettings({ ...s, visuals: { ...s.visuals, [key]: 'unexpected' } })).toThrow('visuals.' + key);
});

test('card opening minimally uncovers a selection without zoom; optional center and fit settle under Motion', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k, settings } = f;
  const frame = r[k('cameraFrame')], positions = r.positions, rows = r.projection.source;
  const hide = () => { r[k('selectNote')](-1); const q = r.screenPoint(1); r.setCamera(r.camera.x - (760 - q.x) / r.scale / frame.width, r.camera.y, r.camera.ratio); };
  const settle = () => { const t = r[k('flight')]?.to; if (t) r.setCamera(t.x, t.y, t.ratio); };
  hide(); const ratio = r.camera.ratio; r[k('selectNote')](1, true);
  expect(r[k('flight')]).toBeUndefined(); expect(r.camera.ratio).toBe(ratio);
  const [right] = r[k('cardInset')](); expect(r.screenPoint(1).x).toBeLessThanOrEqual(r.width - right - 47);
  const still = { ...r.camera }; r[k('selectNote')](1, true); expect(r.camera).toEqual(still);
  settings.visuals.clickFraming = 'center'; hide(); r[k('selectNote')](1, true); expect(r[k('flight')]).toBeDefined();
  r.card.size = undefined; r[k('placeOverlay')](); expect(r[k('flight')]).toBeDefined(); settle();
  expect(r.screenPoint(1).x).toBeCloseTo((r.width - r[k('cardInset')]()[0]) / 2, 5);
  const centered = { ...r.camera }; r[k('selectNote')](1, true); expect(r.camera).toEqual(centered); expect(r[k('flight')]).toBeUndefined();
  settings.visuals.motion = 'off'; hide(); r[k('selectNote')](1, true); expect(r[k('flight')]).toBeUndefined();
  settings.visuals.clickFraming = 'fit-neighbours'; r.setCamera(r.camera.x, r.camera.y, .05); r[k('selectNote')](1, true); expect(r[k('flight')]).toBeUndefined();
  for (const n of [0, 1, 2]) { const q = r.screenPoint(n); expect(q.x).toBeGreaterThan(0); expect(q.x).toBeLessThan(r.width - r[k('cardInset')]()[0]); expect(q.y).toBeGreaterThan(0); expect(q.y).toBeLessThan(r.height); }
  expect(r.positions).toBe(positions); expect(r.projection.source).toBe(rows);
});

test('retained Apply suppresses selection framing, then frames expanded coordinates beside the card', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k, settings } = f;
  settings.visuals.motion = 'off'; f.tap(1);
  const frame = r[k('cameraFrame')], finish = r[compiled('beginLayout')]();
  const next = new Float32Array([0, 0, 10000, 10000, 20000, 20000]);
  r[k('streamPositions')](next);
  const camera = { ...r.camera };
  for (const mode of ['off', 'center', 'fit-neighbours']) r[k('frameSelection')](mode);
  r.card.size = undefined; r[k('placeOverlay')]();
  expect(r.camera).toEqual(camera); expect(r[k('flight')]).toBeUndefined();
  const token = await prepare(r, next, () => true); token.commit(); token.discard(); finish(true);
  r[k('frameSelection')]('fit-neighbours');
  expect(r[k('cameraFrame')]).toBe(frame); expect(r.camera.ratio).toBeGreaterThan(10);
  for (const n of [0, 1, 2]) {
    const q = r.screenPoint(n);
    expect(q.x).toBeGreaterThan(0); expect(q.x).toBeLessThan(r.width - r[k('cardInset')]()[0]);
    expect(q.y).toBeGreaterThan(0); expect(q.y).toBeLessThan(r.height);
  }
});

test('Only connections frames its whole region on entry and reverses without another zoom', async () => {
  const f = await graduated([[0, 1], [1, 2]], 4), { r, k } = f, card = () => r[k('noteCard')]; f.settings.visuals.motion = 'off';
  f.tap(0); const camera = { ...r.camera }, history = [...r.card.history.items];
  control(card(), 'Show only connections').click(); expect(r[k('isolation')].node).toBe(0); expect(r.camera).not.toEqual(camera); const isolatedCamera = { ...r.camera };
  control(card(), 'Show all notes').click(); expect(r[k('isolation')]).toBeUndefined(); expect(r.camera.ratio).toBe(isolatedCamera.ratio); expect(r.card.history.items).toEqual(history);
  control(card(), 'Show only connections').click(); control(r[k('isolationBar')], 'Close').click();
  expect(r[k('isolation')]).toBeUndefined(); expect(control(card(), 'Show only connections')).toBeDefined();
});

test('relationship row presentation follows explicit carrier-owned directed legs, never a parsed ID', async () => {
  const f = await graduated([[0, 1], [1, 2], [3, 1]], 4, 0, ['Source.md', 'opaque-record.md', 'Target.md', 'Anchor.md']), { r, k } = f;
  r.projection.carrierNodes[1] = 1; r.projection.carrier[0] = r.projection.carrier[1] = 0;
  f.tap(3); const row = r[k('noteCard')].querySelectorAll('button').find((b: any) => b.className === 'graph-ng-connection');
  expect(row.textContent).toBe('Source → Targetlink'); expect(row.attributes['aria-label']).toBeUndefined();
  r.projection.carrier[0] = 99; r.card.render(); expect(r[k('noteCard')].textContent).toContain('opaque-record');
});

test('only note sheets fold beside tools; edge and path cards stay readable', async () => {
  const f = await graduated([[0, 1], [1, 2]], 3), { r, k } = f, root = r[k('noteCard')];
  r[k('toolsInset')] = 368; f.tap(1); r[k('placeOverlay')]();
  expect(root.dataset.folded).toBe('true');
  control(root, 'Expand connections').click(); r[k('placeOverlay')](); expect(root.dataset.folded).toBe('false');
  r[k('selectEdge')](0); r[k('placeOverlay')](); expect(root.dataset.compact).toBe('false'); expect(root.dataset.folded).toBe('false');
  expect(root.textContent).toContain('Go to source');
  r[k('pathView')] = { from: 0, to: 2, hops: [], found: [], edges: [], note: 'No path' };
  r[k('showPath')](); r[k('placeOverlay')](); expect(root.dataset.folded).toBe('false'); expect(root.textContent).toContain('No path');
});

test('review regression: deleting a non-current Recent visit with the card closed does not render a missing node', async () => {
  const { r, k } = await graduated([[0, 1], [1, 2]], 3);
  [0, 1, 2].forEach(n => r[k('selectNote')](n, true));
  r[k('selectNote')](-1); r[k('placeOverlay')]();
  const chip: any = control(r[k('crumbTrail')].root, '0');
  expect(() => chip.onkeydown!({ key: 'Delete', preventDefault() {}, stopPropagation() {} })).not.toThrow();
  expect(r.card.history.items).toEqual([1, 2]); expect(r.card.history.at).toBe(1);
  expect(r.card.node).toBe(-1); expect(r.selected).toBe(-1); expect(r[k('noteCard')].textContent).toBe('');
  r[k('placeOverlay')](); control(r[k('crumbTrail')].root, '1').click();
  expect(r.card.node).toBe(1); expect(r.selected).toBe(1);
});

test.each(['canvas keyboard', 'card keyboard', 'card buttons', 'Recent chips'])('review regression: retained Apply blocks %s before history mutation', async entry => {
  const { r, k } = await graduated([[0, 1], [1, 2]], 3);
  [0, 1, 2].forEach(n => r[k('selectNote')](n, true)); r.card.step(-1); r[k('placeOverlay')]();
  const card = r[k('noteCard')], recent = r[k('crumbTrail')].root;
  const finish = r[compiled('beginLayout')](), camera = { ...r.camera };
  try {
    for (const step of [-1, 1]) {
      const event = { key: step < 0 ? 'ArrowLeft' : 'ArrowRight', altKey: true, target: entry === 'canvas keyboard' ? r.canvas : card, preventDefault() {}, stopPropagation() {} };
      if (entry === 'canvas keyboard') { r.canvas.focus(); r[k('keyDown')](event); }
      else if (entry === 'card keyboard') card.onkeydown(event);
      else if (entry === 'card buttons') control(card, step < 0 ? 'Back' : 'Forward').click();
      else control(recent, step < 0 ? '0' : '2').click();
      expect(r.card.history.at).toBe(1); expect(r.card.history.items).toEqual([0, 1, 2]);
      expect(r.card.node).toBe(1); expect(r.selected).toBe(1); expect(r.camera).toEqual(camera);
    }
  } finally { finish(false); }
  expect(r.card.step(-1)).toBe(true); expect(r.selected).toBe(0); expect(r.card.history.at).toBe(0);
  expect(r.card.step(1)).toBe(true); expect(r.selected).toBe(1); expect(r.card.history.at).toBe(1);
});

test('review regression: Connections travel frames a collapsed member at its hub clear of the card', async () => {
  const { r, k, settings } = await graduated([[0, 1], [1, 2]], 3);
  settings.visuals.motion = 'off';
  r.setView(new Uint8Array([1, 1, 1]), { groupCodes: new Uint32Array([0, 1, 1]), groupLabels: ['Start', 'Collapsed'], collapsed: new Uint8Array([0, 1]) });
  r[k('selectNote')](0, true); r[k('placeOverlay')]();
  expect(r.visible[1]).toBe(0); expect(r[k('filterVisible')][1]).toBe(1);
  const row = r[k('noteCard')].querySelectorAll('button').find((b: any) => b.className === 'graph-ng-connection');
  const camera = { ...r.camera }; row.click();
  expect(r.card.node).toBe(1); expect(r.selected).toBe(1); expect(r.camera).not.toEqual(camera);
  const hub = r[k('hubs')][0], [right, bottom] = r[k('cardInset')](), point = r.screenPoint(1);
  expect(r[k('renderCoordinate')](1, 0)).toBe(hub.x); expect(r[k('renderCoordinate')](1, 1)).toBe(hub.y);
  expect(point.x).toBeCloseTo((r.width - right) / 2, 5); expect(point.y).toBeCloseTo((r.height - bottom) / 2, 5);
});

test('review regression: rejected Apply preserves the previous refresh error and working state', async () => {
  const f = await fixture(), status = 'Refresh failed: synthetic projection error', previousStream = () => {};
  f.view.detailGeneration = -1; f.view.provisional = true; f.view.report = { linksPending: true };
  f.view.statusText = status; f.plugin.pipeline.onPositions = previousStream;
  const working = f.view[compiled('layoutWorking')];
  expect(await outcome(f.view[compiled('applyLayout')](values))).toContain('Layout unavailable or generation changed');
  expect(f.view.statusText).toBe(status); expect(f.view[compiled('layoutWorking')]).toBe(working);
  expect(f.plugin.pipeline.onPositions).toBe(previousStream); expect(f.requests()).toBe(0); expect(f.writes).toEqual([]);
});


test('selected WebGL dot is one final instance with its own size and restored vertex attribute', async () => {
  const f = await graduated([[0, 2], [1, 2], [2, 3]], 4), { r, k } = f;
  r[k('selectNote')](2, true); r[k('focusLevel')] = 1; r[k('focusTarget')] = 1;
  r.isolation = { node: 2, hops: 1, expanded: new Set(), shown: [] };
  r[k('adaptSizes')] = () => {}; r[k('sizes')][2] = 7;
  const d = driver(r), events: any[] = []; let program = -1, layer = 1;
  r[k('programs')] = [0, 1, 2, 3].map(handle => ({ handle, uniforms: { layer: 'layer' } }));
  d.gl.useProgram = (p: number) => { program = p; };
  d.gl.uniform1i = (u: string, value: number) => { if (u === 'layer') layer = value; };
  d.gl.disableVertexAttribArray = (index: number) => events.push(['disable', index]);
  d.gl.vertexAttrib1f = (index: number, value: number) => events.push(['size', index, value]);
  d.gl.enableVertexAttribArray = (index: number) => events.push(['enable', index]);
  d.gl.drawArraysInstanced = (_: number, __: number, ___: number, count: number) => events.push(['draw', program, layer, count]);
  d.gl.drawElementsInstanced = (_: number, indices: number, type: number, offset: number, count: number) => {
    expect(type).toBe(d.gl.UNSIGNED_SHORT); expect(offset).toBe(0);
    if (program === 1) expect(indices).toBe(6);
    events.push(['draw', program, layer, count]);
  };
  r[k('draw')]();
  const last = events.findIndex(e => e[0] === 'disable');
  expect(events.slice(last, last + 6)).toEqual([['disable', 0], ['size', 0, r[k('sizes')][2]], ['disable', 1], ['draw', 1, 2, 1], ['enable', 0], ['enable', 1]]);
  expect(r[k('sizes')][2]).not.toBe(r[k('sizes')][0]);
  expect(events.findIndex(e => e[0] === 'draw' && e[1] === 0)).toBeLessThan(last);
  f.settings.visuals.hoverHighlight = false; f.settings.nodeSize = .16;
  expect(r[k('drawnRadius')](2, false, 0)).toBeGreaterThanOrEqual(5);
});

test('anchored name priorities reuse bounded atlas candidates and put direct notes before unrelated hubs', async () => {
  const { r, k, settings } = await graduated([[0, 1], [1, 2], [3, 4]], 6);
  settings.visuals.labelStyle = 'anchored'; r[k('selectNote')](0, true); r[k('focusLevel')] = 1;
  const paint = () => { r[k('anchorKey')] = []; r[k('placeOverlay')](); return r[k('anchorNames')].map((x: any) => [x.node, x.rank]); };
  settings.visuals.namePriority = 'selection'; const focused = paint();
  expect(focused.map((x: number[]) => x[0])).toContain(1); expect(focused.every((x: number[]) => x[1]! < 5)).toBe(true);
  settings.visuals.namePriority = 'all'; const all = paint();
  expect(all.findIndex((x: number[]) => x[0] === 1)).toBeLessThan(all.findIndex((x: number[]) => x[0] === 3));
  expect(all.length).toBeLessThanOrEqual(64); expect(r[k('anchorPool')].length).toBeLessThanOrEqual(64);
  r[k('selectNote')](-1, false); r[k('focusLevel')] = 0; settings.visuals.namePriority = 'selection'; expect(paint()).toEqual([]);
  settings.visuals.namePriority = 'connected'; expect(paint().length).toBeGreaterThan(0);
});

test('wave12: streaming preview gestures survive final renderer adoption in world coordinates', async () => {
  for (const gesture of ['panBy', 'zoomAt', 'new-pan', 'none']) {
    const f = await fixture({ loading: true }), r = f.renderer, k = (name: string) => mangle[name] ?? name;
    f.view.detailRenderer = undefined; f.view.panel = new Element();
    f.view.gpu = { available: false, reason: 'synthetic Canvas' };
    f.view.app = { workspace: { requestSaveLayout() {} } };
    f.view[k('toolsOverlap')] = () => 0;
    f.view.positions = new Float32Array([100, 200, 300, 400, 900, 1200]);
    const create = Renderer.create; let before: number[] = [], fits = 0;
    Renderer.create = async (...args: any[]) => {
      const final = await create(...args); renderers.push(final);
      // Include gestures made while the replacement renderer is being prepared.
      const target = gesture === 'new-pan' ? final : r;
      if (gesture !== 'none') target.controls()[k(gesture === 'new-pan' ? 'panBy' : gesture)](...(gesture === 'zoomAt' ? [1.5, 120, 80] : [40, 20]));
      const fit = final.fitAll.bind(final); final.fitAll = (...args: any[]) => { fits++; return fit(...args); };
      before = [target[k('centerX')], target[k('centerY')], target[k('scale')]];
      return final;
    };
    try { await f.view[k('showDetails')](); } finally { Renderer.create = create; }
    const final = f.view.detailRenderer;
    expect(f.view.contentEl.dataset.mode).toBe('nodes'); expect(final).not.toBe(r);
    if (gesture !== 'none') [final[k('centerX')], final[k('centerY')], final[k('scale')]].forEach((v: number, i: number) => expect(v).toBeCloseTo(before[i]!, 8));
    expect(final[k('followLayout')]).toBe(gesture === 'none'); expect(fits).toBe(gesture === 'none' ? 1 : 0);
  }
});

test('wave12: property promotion preserves unsettled status until a layout settles', async () => {
  const f = await fixture(), k = (name: string) => mangle[name] ?? name;
  f.view.groupGraph = {}; f.view.contentEl.dataset.state = 'ready';
  f.plugin.adapter = { [k('factsComplete')]: () => true, [k('linksPending')]: () => false, [k('pendingProperties')]: () => 0 };
  f.view[k('layoutSettled')] = false; f.view.statusText = 'Layout not settled';
  f.view[k('promoteProperties')](); expect(f.view.statusText).toBe('Layout not settled');
  f.view[k('layoutSettled')] = true; f.view[k('promoteProperties')](); expect(f.view.statusText).toBe('');
});

test('wave12: selection captions survive pointer leave without connection highlighting', async () => {
  for (const style of ['anchored', 'ranked'] as const) {
    const f = await graduated([[0, 1], [1, 2], [3, 4]], 5), { r, k, settings } = f;
    settings.visuals.labelStyle = style;
    settings.visuals.namePriority = 'selection'; settings.visuals.hoverHighlight = false;
    r[k('selectNote')](0, true); f.hover(3); r[k('pointerLeave')]();
    r[k('placeOverlay')]();
    const names = r[k('anchorNames')].map((n: any) => n.node);
    expect(names).toContain(0); expect(names).toContain(1); expect(names).not.toContain(3);
    expect(r[k('anchorPool')].some((e: any) => !e.hidden)).toBe(true);
    expect(r[k('focusTarget')]).toBe(0); expect(f.tiers()).toEqual([0, 0, 0, 0, 0]);
    r[k('placeAnchored')](1, 0, () => 2, () => false);
    expect(r[k('anchorPool')].filter((e: any) => !e.hidden).length).toBeGreaterThanOrEqual(2);
    expect(!r[k('moreButton')] || r[k('moreButton')].hidden).toBe(true);
    r[k('selectNote')](3, true); r[k('pointerLeave')](); r[k('placeOverlay')]();
    expect(r[k('anchorNames')].map((n: any) => n.node)).toEqual(expect.arrayContaining([3, 4]));
    expect(r[k('anchorNames')].map((n: any) => n.node)).not.toContain(0);
    let opened = -1; r[k('onMoreConnections')] = (n: number) => { opened = n; };
    r[k('moreControl')]().onclick(); expect(opened).toBe(3);
    r.setView(new Uint8Array(5).fill(1), { [k('typeHidden')]: new Uint8Array([1]) }); r[k('placeOverlay')]();
    expect(r[k('anchorNames')].map((n: any) => n.node)).toEqual([3]);
    r[k('selectNote')](-1); r[k('placeOverlay')](); expect(r[k('anchorNames')]).toEqual([]);
  }
});

async function groupCanvasFixture(count: number, size: number) {
  const f = await fixture(), k = (name: string) => mangle[name] ?? name;
  f.plugin.settings.groupCanvasPageSize = size;
  f.view.groupGraph = { groups: Array.from({ length: count }, (_, i) => ({ id: String(i), label: `Group ${i}`, count: count - i })), groupEdges: [] };
  f.view.panel = new Element(); f.view[k('paginate')] = () => {}; f.view[k('section')] = () => new Element(); f.view[k('toolsOverlap')] = () => 0;
  f.view.showGroups();
  return { ...f, pager: () => f.stage.children.find((e: any) => e.className === 'graph-ng-canvas-pager')! };
}

test('wave12: canvas respects saved page sizes below 12 and above 24', async () => {
  for (const size of [6, 30, 1000]) {
    const f = await groupCanvasFixture(120, size);
    try {
      expect(f.view.contentEl.dataset.canvasGroups).toBe(String(Math.min(100, size)));
      if (size > 100) expect(f.stage.textContent).toContain('100 groups per page limit');
    }
    finally { f.view.renderer.dispose(); }
  }
});

test('wave12: last group page hides zero-more while retaining back navigation', async () => {
  const f = await groupCanvasFixture(25, 12);
  try {
    control(f.pager(), 'Next groups').click(); control(f.pager(), 'Next groups').click();
    const pager = f.pager(), next = pager.querySelectorAll('button').find((e: any) => e.getAttribute('aria-label') === 'Next groups');
    expect(!next || next.hidden).toBe(true); expect(pager.hidden).toBe(false);
    const previous = control(pager, 'Previous groups'); expect(previous.disabled).toBe(false); expect(ControlElement.active).toBe(previous); previous.click();
    expect(control(f.pager(), 'Next groups').hidden).toBe(false);
  } finally { f.view.renderer.dispose(); }
});

test('wave12: one-page group canvas hides its entire pager', async () => {
  for (const count of [0, 5, 12]) {
    const f = await groupCanvasFixture(count, 12);
    try { expect(!f.pager() || f.pager().hidden).toBe(true); }
    finally { f.view.renderer.dispose(); }
  }
});

test('clicking a new note retargets an active lens to only its direct connections', async () => {
  const f = await graduated([[0, 1], [0, 2], [0, 3], [1, 4]]), { r, k } = f;
  f.settings.visuals.motion = 'off'; f.tap(1); r[compiled('setLens')](1);
  f.tap(0);
  expect(r.selected).toBe(0); expect(r[compiled('lensNode')]).toBe(0);
  expect([...r[k('lensPoints')].keys()].sort()).toEqual([1, 2, 3]);
  expect(r[k('lensBytes')][4 * 4 + 2]).toBe(0);
  r[compiled('setLens')](-1); expect(r[k('lensPoints')].size).toBe(0);
});
test('highlight and visit history follow clicks immediately during a lens retarget', async () => {
  const f = await graduated([[0, 1], [0, 2], [0, 3], [1, 4]]), { r, k } = f;
  f.tap(1); r[compiled('setLens')](1); r[k('animate')](r[k('lensMotion')].start + 220);
  f.tap(0);
  expect(r.selected).toBe(0); expect(r[k('focusNode')]).toBe(0);
  expect(r.card.node).toBe(0); expect(r.card.history.items[r.card.history.at]).toBe(0);
  expect(r[k('lensAnchor')]).toBe(1); // Old geometry returns smoothly before the new ring opens.
  r[k('animate')](r[k('lensMotion')].start + 220);
  r[k('animate')](r[k('lensMotion')].start + 220);
  expect(r[k('lensAnchor')]).toBe(0); expect(r[k('focusNode')]).toBe(0);
});

test('direct-open clicks advance the same visit history as card selections', async () => {
  const f = await graduated([[0, 1], [0, 2]]), { r, k } = f;
  f.tap(0); f.settings.visuals.clickOpens = true; f.tap(1); r[k('placeOverlay')]();
  expect(f.opened).toEqual([1]); expect(r.selected).toBe(1); expect(r[k('focusNode')]).toBe(1);
  expect(r.card.node).toBe(-1); expect(r.card.history.items).toEqual([0, 1]);
  expect(r.card.history.items[r.card.history.at]).toBe(1);
});

test('anchored overflow badge names one hidden connection in the singular', async () => {
  const f = await graduated([[0, 1]], 2), { r, k } = f;
  f.settings.visuals.labelStyle = 'anchored'; f.tap(0);
  r[k('focusLevel')] = 1; r[k('tierMask')] = 0; r[k('placeOverlay')]();
  expect(r[k('moreButton')].textContent).toBe('1 more connection');
});
async function carrierRenderer(n = 3) {
  const f = await graduated([[0, 1], [1, 2]], n), { r, k } = f;
  r.projection.carrier = new Uint32Array([7, 7]); r.projection.carrierNodes = new Uint32Array(n); r.projection.carrierNodes[1] = 8; r[k('carrierCount')] = 1;
  r.setView(new Uint8Array(n).fill(1), {}); f.settings.visuals.carrierLines = 'through'; r[k('baseNodeRadius')] = () => .01;
  return f;
}
function carrierPaint(r: any, k: (s: string) => string) {
  const old = [ctx.arc, ctx.moveTo, ctx.lineTo], dots: number[][] = [], lines: number[][] = []; let from: number[] = [];
  ctx.arc = (x: number, y: number, radius: number) => dots.push([x, y, radius, ctx.globalAlpha]);
  ctx.moveTo = (x: number, y: number) => { from = [x, y]; }; ctx.lineTo = (x: number, y: number) => lines.push([...from, x, y]);
  try { r[k('drawCanvas')](); } finally { [ctx.arc, ctx.moveTo, ctx.lineTo] = old; }
  return { dots, lines };
}
test('review: production path retains its carrier dot and both legs with direct legend disabled', async () => {
  const { r, k, settings } = await carrierRenderer(), edges = [0, 1]; settings.visuals.edgeMode = 'focus';
  r[k('pathView')] = { edges, from: 0, to: 2 }; r[k('setFocus')](-1, true, edges); r[k('tierMask')] = 14;
  const point = r.screenPoint(1), paint = carrierPaint(r, k);
  expect(paint.lines.length).toBeGreaterThanOrEqual(2);
  expect(paint.dots.some(d => d[0] === point.x && d[1] === point.y && d[2]! >= 2 && d[3]! >= .25)).toBe(true);
  // Execute the production shader's owner-tier override, not a parallel desired topology model.
  const text = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8'), line = text.split('\n').find(l => l.includes('if (owner >= 0') && l.includes('tier ='))!;
  const tier = new Function('owner', 'tierByte', 'focusNode', 'state', 'shownTier', 'uint', 'retained', `let tier = 255; ${line.replace(/(\d)u\b/g, '$1')} return tier;`);
  expect(tier(1, 253, -1, () => ({ g: 1 }), (g: number, ego: boolean) => ego ? g : 0, Math.floor)).toBe(255);
});
test('review: production collapse keeps incidence lines at the hub and never rewrites traversal masks', async () => {
  const { r, k } = await carrierRenderer(4), view = { groupCodes: new Uint32Array([0, 1, 2, 0]), groupLabels: ['one', 'two', 'three'], collapsed: new Uint8Array([1, 0, 0]) };
  r.setView(new Uint8Array([1, 1, 1, 1]), view);
  expect(r.visible[0]).toBe(0); expect(Array.from(r[k('edgeOn')])).toEqual([1, 1]); expect(Array.from(r[k('carrierGeometry')].enabled)).toEqual([1, 1]);
  const paint = carrierPaint(r, k), a = r.screenPoint(0), b = r.screenPoint(1);
  expect(paint.lines).toContainEqual([a.x, a.y, b.x, b.y]);
  r.setView(new Uint8Array([0, 1, 1, 1]), {}); expect(Array.from(r[k('edgeOn')])).toEqual([1, 1]); expect(Array.from(r[k('carrierGeometry')].enabled)).toEqual([0, 0]);
});
test('review: production hovered Direct carrier remains drawn after zoom changes its ink admission', async () => {
  const { r, k, settings } = await carrierRenderer(); settings.visuals.carrierLines = 'direct'; r[k('hoveredEdge')] = 0; r[k('edgeQuiet')] = () => [0, Infinity];
  for (const ratio of [.05, 8]) { r.camera.ratio = ratio; const paint = carrierPaint(r, k), a = r.screenPoint(0), b = r.screenPoint(2); expect(paint.lines).toContainEqual([a.x, a.y, b.x, b.y]); }
  const text = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8'), expression = text.slice(text.indexOf('const edgeVertex')).match(/bool hot = (.*);/)![1]!;
  const hot = new Function('gl_InstanceID', 'edgeHovered', 'owner', 'selected', 'hovered', 'edgeNote', `return ${expression};`);
  expect(hot(0, 0, 1, -1, -1, 1)).toBe(true); expect(hot(1, 0, 1, -1, -1, 1)).toBe(true);
  settings.visuals.carrierLines = 'through'; const paint = carrierPaint(r, k), n = r.screenPoint(1);
  expect(paint.lines).toHaveLength(2); expect(paint.dots.some(d => d[0] === n.x && d[1] === n.y)).toBe(true);
});
test('review: production edge picking computes topology once and visits numeric targets without pair arrays', async () => {
  const { r, k, settings } = await carrierRenderer(); settings.visuals.carrierLines = 'direct';
  const level = r.carrierLevel, target = r[k('lineTarget')]; let levels = 0, targets = 0, numeric = true;
  r.carrierLevel = function(...a: any[]) { levels++; return level.apply(this, a); };
  r[k('lineTarget')] = function(...a: any[]) { const value = target.apply(this, a); targets++; numeric &&= typeof value === 'number'; return value; };
  r[k('picker')].visit = (_x: number, _y: number, _r: number, visit: (n: number) => void) => { for (let i = 0; i < 5000; i++) visit(0); };
  r[k('edgeQuiet')] = () => [1, Infinity]; const a = r.screenPoint(0), b = r.screenPoint(2);
  expect(r[k('pickEdge')]((a.x + b.x) / 2, (a.y + b.y) / 2)).toBe(0); expect(levels).toBe(1); expect(targets).toBe(5000); expect(numeric).toBe(true);
});


test('named chip X exits only its layer with scopes, selection and filters retained', async () => {
  const f = await fixture(), r = f.renderer, key = compiled, base = r[key('baseVisible')];
  const state = () => r[key('namedViewState')], strip = () => r[key('stateStrip')];
  r[key('selectNote')](0, true); expect(state()).toBe('Selected note');
  control(strip(), 'Leave Selected note').click(); expect(r.selected).toBe(-1); expect(state()).toBe('Notes');
  r[key('selectNote')](0, true); r.isolate(0); expect(state()).toBe('Only connections');
  control(strip(), 'Leave Only connections').click(); expect(r.selected).toBe(0); expect(r.isolation).toBeUndefined(); expect(r[key('baseVisible')]).toBe(base);
  r.isolate(0); r[key('setLens')](0); expect(state()).toBe('Connection rings');
  expect(strip().querySelectorAll('button').filter((b: any) => b.getAttribute('aria-label')?.startsWith('Leave')).map((b: any) => b.getAttribute('aria-label'))).toEqual(['Leave Connection rings', 'Leave Only connections']);
  control(strip(), 'Leave Only connections').click(); expect(r[key('lensNode')]).toBe(0); expect(r.selected).toBe(0);
  r.isolate(0); control(strip(), 'Leave Connection rings').click(); expect(r[key('lensNode')]).toBe(-1); expect(r.isolation.node).toBe(0); expect(state()).toBe('Only connections');
  // Even a no-route path owns a dismissal; its underlying neighbourhood stays.
  r[key('pathView')] = { from: 0, to: 0, found: [], hops: [], edges: [], note: 'No path' }; r[key('syncViewState')]();
  expect(state()).toBe('Path between notes'); control(strip(), 'Leave Path between notes').click();
  expect(r[key('pathView')]).toBeUndefined(); expect(r.isolation.node).toBe(0); expect(r[key('baseVisible')]).toBe(base);
});
test('state chip survives dismissed cards and ignores hover; menu switches use existing actions', async () => {
  const f = await fixture(), r = f.renderer, key = compiled;
  r[key('selectNote')](0, true); r[key('setLens')](0); r[key('selectNote')](-1, false, true);
  const strip = r[key('stateStrip')], chip = strip.children[0];
  expect(chip.textContent).toContain('0'); expect(r[key('namedViewState')]).toBe('Connection rings');
  r.hovered = 2; r[key('syncViewState')](); expect(strip.children[0]).toBe(chip);
  let tuned = ''; r[key('tuneViewState')] = (state: string) => { tuned = state; };
  control(strip, 'Tune this view').click(); expect(tuned).toBe('Connection rings');
  control(strip, 'Only connections').click(); expect(r[key('lensNode')]).toBe(-1); expect(r.isolation.node).toBe(0);
  control(strip, 'Notes').click(); expect(r[key('namedViewState')]).toBe('Notes'); expect(r.isolation).toBeUndefined(); expect(r.selected).toBe(-1);
});

async function retainedRenderer(nested: boolean, n = 6) {
  const pairs: [number, number][] = nested ? [[0, 1], [1, 2], [1, 3], [3, 4], [5, 1]] : [[0, 1], [1, 2], [5, 1]], f = await graduated(pairs, n), { r, k, settings } = f;
  r.projection.carrier = new Uint32Array(nested ? [7, 7, 8, 8, 0xffffffff] : [7, 7, 0xffffffff]); r.projection.carrierNodes = new Uint32Array(n); r.projection.carrierNodes.set(nested ? [0, 8, 0, 9, 0, 0] : [0, 8, 0, 0, 0, 0]);
  r[k('carrierCount')] = nested ? 2 : 1; r.setView(new Uint8Array(n).fill(1), {}); settings.visuals.carrierLines = 'direct'; settings.visuals.carrierSize = .001; r[k('baseNodeRadius')] = () => .01; r[k('edgeQuiet')] = () => [1, 1];
  return { ...f, pairs };
}
for (const nested of [false, true]) test(`retention: production ${nested ? 'nested relationships' : 'ordinary carrier endpoint'} stays attached in Direct when its whole component fits`, async () => {
  const { r, k, settings, pairs } = await retainedRenderer(nested), geometry = r[k('carrierGeometry')], nodes = nested ? [1, 3] : [1];
  expect(geometry.groups.map((g: number[][]) => g[0])).toEqual([nodes]);
  for (const mode of ['direct', 'auto', 'through'] as const) for (const ratio of [.03, 1, 8]) {
    settings.visuals.carrierLines = mode; r.camera.ratio = ratio; const paint = carrierPaint(r, k);
    expect(paint.lines).toHaveLength(pairs.length);
    for (const [a, b] of pairs) { const s = r.screenPoint(a), t = r.screenPoint(b); expect(paint.lines).toContainEqual([s.x, s.y, t.x, t.y]); }
    for (const node of nodes) { const p = r.screenPoint(node); expect(paint.dots.some(d => d[0] === p.x && d[1] === p.y && d[2]! >= 2 && d[3]! >= .25)).toBe(true); }
    expect(r[k('carrierGeometry')]).toBe(geometry);
  }
});
test('retention: production focus, filter, collapse, zero opacity and reset keep the component together', async () => {
  const { r, k, settings } = await retainedRenderer(true); settings.visuals.edgeMode = 'focus'; r[k('tierMask')] = 0;
  expect(carrierPaint(r, k).lines).toHaveLength(0);
  r[k('setFocus')](0, true); expect(r[k('stateBytes')][5]).toBe(255); expect(r[k('stateBytes')][13]).toBe(255);
  expect(carrierPaint(r, k).lines.length).toBeGreaterThanOrEqual(5);
  r[k('setFocus')](-1, true); expect(r[k('stateBytes')][5]).toBe(0); expect(r[k('stateBytes')][13]).toBe(0); expect(carrierPaint(r, k).lines).toHaveLength(0);
  settings.visuals.edgeMode = 'all'; r.setView(new Uint8Array(6).fill(1), { groupCodes: new Uint32Array([0, 1, 2, 3, 4, 0]), groupLabels: ['a', 'b', 'c', 'd', 'e'], collapsed: new Uint8Array([1, 0, 0, 0, 0]) });
  expect(r.visible[0]).toBe(0); expect(carrierPaint(r, k).lines).toHaveLength(5);
  r.setView(new Uint8Array([0, 1, 1, 1, 1, 1]), {}); expect(Array.from(r[k('edgeOn')])).toEqual([1, 1, 1, 1, 1]); expect(Array.from(r[k('carrierGeometry')].enabled)).toEqual([0, 0, 0, 0, 0]); expect(carrierPaint(r, k).lines).toHaveLength(0);
  r.setView(new Uint8Array(6).fill(1), {}); const edges = [0, 1, 2, 3]; r[k('pathView')] = { edges, from: 0, to: 4 }; r[k('setFocus')](-1, true, edges);
  for (const key of ['carrierOpacity', 'edgeOpacity'] as const) { const old = settings.visuals[key]; settings.visuals[key] = 0; expect(carrierPaint(r, k).lines).toHaveLength(0); for (const node of [1, 3]) expect(r[k('carrierShown')](node, 1, 1)).toBe(false); settings.visuals[key] = old; }
  settings.visuals.edgeMode = 'off'; expect(carrierPaint(r, k).lines).toHaveLength(0);
});
test('retention: shader marker excludes ordinary-node sentinels and bypasses sampling only for retained edges', () => {
  const text = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8'), expression = text.match(/bool retained = (.*);/)![1]!.replace(/(\d)u\b/g, '$1'), retained = new Function('carrierRank', `return ${expression};`);
  expect(retained(0xffffffff)).toBe(false); expect(retained(0x1ffffff)).toBe(false); expect(retained(0x3000000)).toBe(true);
  const edge = text.slice(text.indexOf('const edgeVertex')), quiet = new Function('retained', 'hot', 'share', 'lineRank', 'float', `return ${edge.match(/float quiet = (.*);/)![1]!.replace(/(\d)u\b/g, '$1')};`);
  expect(quiet(true, false, 0, 0x3000000, Number)).toBe(1); expect(quiet(false, false, 0, 0, Number)).toBe(0);
});

test('retention review: production lens picking admits retained dots through the same per-node predicate', async () => {
  const { r, k, settings } = await retainedRenderer(true); settings.visuals.motion = 'off'; r[k('selectNote')](0, false); r[k('setLens')](0);
  expect(r[k('lensPoints')].size).toBeGreaterThan(0); expect(r.carrierLevel().visibility).toBe(0);
  const p = r.screenPoint(1); expect(r[k('carrierShown')](1, 1, 1)).toBe(true); expect(r.pick(p.x, p.y)).toBe(1);
  r[k('edgeQuiet')] = () => [0, 1]; expect(r.pick(p.x, p.y)).not.toBe(1);
});
test('retention review: production 15000-carrier chain at zero ink has no drawn or pickable fragments', async () => {
  const count = 15000, pairs: [number, number][] = [], own: number[] = [], notes = new Uint32Array(count + 2);
  for (let n = 1; n <= count; n++) { pairs.push([n - 1, n], [n, count + 1]); own.push(n + 7, n + 7); notes[n] = n + 8; }
  const { r, k, settings } = await graduated(pairs, count + 2, 40000); r.projection.carrier = Uint32Array.from(own); r.projection.carrierNodes = notes; r[k('carrierCount')] = count; r.setView(new Uint8Array(count + 2).fill(1), {});
  settings.visuals.carrierLines = 'direct'; r[k('edgeQuiet')] = () => [0, Infinity]; r[k('setFocus')](1, true);
  const paint = carrierPaint(r, k); expect(paint.lines).toHaveLength(0);
  const ordinary = new Set([0, count + 1].map(n => { const p = r.screenPoint(n); return `${p.x},${p.y}`; })); expect(paint.dots.every(d => ordinary.has(`${d[0]},${d[1]}`))).toBe(true);
  for (let n = 1; n <= count; n++) expect(r[k('carrierShown')](n, 0, 1)).toBe(false);
  const p = r.screenPoint(1); expect(r.pick(p.x, p.y)).not.toBe(1); expect(r[k('carrierGeometry')].groups).toHaveLength(1);
  // Actual selection is a bounded exception: two owned legs, not the entire 30k-leg chain.
  r[k('selectNote')](2, false); expect(r.selected).toBe(2);
  const selected = carrierPaint(r, k), unique = new Set(selected.lines.map(line => JSON.stringify(line)));
  expect(unique.size).toBe(2); expect(r[k('carrierShown')](1, 0, 1)).toBe(true); expect(r[k('carrierShown')](2, 0, 1)).toBe(true);
  for (let n = 3; n <= count; n++) expect(r[k('carrierShown')](n, 0, 1)).toBe(false);

});

test('retention review: production shader rejects an oversized whole component before focus exemptions', () => {
  const text = readFileSync(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8'), edge = text.slice(text.indexOf('const edgeVertex'));
  const condition = edge.match(/if \(through && carrierAlpha <= 0\. \|\| (retained && .*?)\) \{/)![1]!.replace(/(\d)u\b/g, '$1');
  const reject = new Function('retained', 'lineRank', 'inkShare', 'float', 'pinned', `return ${condition};`);
  for (const share of [0, .001, .3, .99]) expect(reject(true, 0x3ffffff, share, Number)).toBe(true);
  expect(reject(true, 0x3ffffff, 0, Number, true)).toBe(false); expect(reject(true, 0x3ffffff, 1, Number)).toBe(false); expect(reject(false, 0x3ffffff, 0, Number)).toBe(false);
  expect(edge.indexOf('if (through && carrierAlpha')).toBeLessThan(edge.indexOf('bool hot ='));
});

test('retention review two: actual selection then lower ink preserves only its own legs and endpoint dots', async () => {
  const { r, k, settings } = await retainedRenderer(true); settings.visuals.motion = 'off';
  r[k('selectNote')](3, false); expect(r.selected).toBe(3);
  r[k('edgeQuiet')] = () => [0, Infinity]; r.camera.ratio *= 8;
  const check = () => {
    const paint = carrierPaint(r, k), unique = [...new Set(paint.lines.map(line => JSON.stringify(line)))];
    expect(unique).toHaveLength(2);
    for (const [a, b] of [[1, 3], [3, 4]]) { const s = r.screenPoint(a), t = r.screenPoint(b); expect(unique).toContain(JSON.stringify([s.x, s.y, t.x, t.y])); }
    for (const n of [1, 3]) { const p = r.screenPoint(n); expect(r[k('carrierShown')](n, 0, 1)).toBe(true); expect(paint.dots.some(d => d[0] === p.x && d[1] === p.y && d[2]! >= 2 && d[3]! >= .25)).toBe(true); }
  };
  check(); settings.visuals.dimOpacity = 0; r[k('tierMask')] = 0; check();
  const endpoint = r.screenPoint(4); expect(carrierPaint(r, k).dots.some(d => d[0] === endpoint.x && d[1] === endpoint.y && d[3]! >= .25)).toBe(true);
  // Hover is an explicit one-hop exception too, even with highlighting switched off.
  r[k('selectNote')](-1, false); settings.visuals.hoverHighlight = false; r.hovered = 3; r[k('animate')](performance.now()); check();
  r.hovered = -1; r[k('animate')](performance.now()); expect(carrierPaint(r, k).lines).toHaveLength(0);
  r[k('selectNote')](3, false); check();
  for (const key of ['carrierOpacity', 'edgeOpacity'] as const) { const old = settings.visuals[key]; settings.visuals[key] = 0; expect(carrierPaint(r, k).lines).toHaveLength(0); expect(r[k('carrierShown')](3, 0, 1)).toBe(false); settings.visuals[key] = old; }
  settings.visuals.edgeMode = 'off'; expect(carrierPaint(r, k).lines).toHaveLength(0); settings.visuals.edgeMode = 'all';
  r.setView(new Uint8Array([0, 1, 1, 1, 1, 1]), {}); expect(carrierPaint(r, k).lines).toHaveLength(0); expect(r[k('carrierShown')](3, 0, 1)).toBe(false);
});

test('retention review two: hidden relationship labels cannot leave false endpoint rings behind', async () => {
  const { r, k, settings } = await retainedRenderer(true); settings.visuals.labelStyle = 'anchored'; settings.visuals.namePriority = 'all';
  r[k('selectNote')](0, false); r[k('edgeQuiet')] = () => [1, Infinity]; r[k('placeOverlay')]();
  expect(r[k('anchorNames')].some((it: any) => it.node === 1 || it.node === 3)).toBe(true);
  r[k('edgeQuiet')] = () => [0, Infinity]; r[k('placeOverlay')]();
  const hidden = new Set([r.name(1), r.name(3)]);
  for (const el of r[k('anchorPool')]) if (!el.hidden) expect(hidden.has(el.getAttribute('aria-description'))).toBe(false);
});

// Execute visibility/coverage expressions extracted from the shipped, minified shader strings.
// Geometry/rasterization remains a separate native acceptance lane.
function shippedCarrierScalar() {
  const names = (text: string) => text.replace(/\b[A-Za-z_]\w*\b/g, name => shaderOriginalNames[name] ?? name);
  const js = (text: string) => text.replace(/\b(?:int|uint|float|bool|vec4) (?=\w)/g, 'let ').replace(/(\d)u\b/g, '$1').replace(/return;/g, 'return 0;');
  const node = names(source.match(/void main\(\)\{int id=layer==2[\s\S]*?float \w+=nodeSize/)![0]!).replace(/^void main\(\)\{/, '').replace(/float \w+=nodeSize$/, '');
  const edge = names(source.match(/void main\(\)\{int s=int\(source\)[\s\S]*?if\(layer==2\)[^;]+;\}/)![0]!).replace(/^void main\(\)\{/, '');
  const prelude = edge.slice(0, edge.indexOf('int segment=')), quiet = edge.match(/float share=.*?float quiet=.*?;/)![0]!, alpha = edge.match(/float alpha=edgeAlpha[\s\S]*?(?=if\(tier==254u)/)![0]!;
  const floor = edge.match(/if\(through&&alpha>0\.\)alpha=max\(\.25,alpha\);/)![0]!;
  return { node: new Function('e', `with(e){${js(node)} return k;}`), edge: new Function('e', `with(e){${js(prelude + quiet + alpha + floor)} return alpha;}`) };
}
function carrierUniforms(r: any, k: (s: string) => string) {
  const d = driver(r), values: Record<string, number> = {}; let current = -1;
  r[k('programs')] = [0, 1, 2, 3].map(handle => ({ handle, uniforms: new Proxy({}, { get: (_o, key) => key }) })); r.atlas = undefined;
  d.gl.useProgram = (handle: number) => { current = handle; };
  const uniform = (name: string, value: number) => { if (current === 0) values[name] = value; };
  d.gl.uniform1f = uniform; d.gl.uniform1i = uniform; r[k('draw')]();
  return { ...values, seed: 0, tint: 0, gl_Position: 0, offscreen: 0, len: 1, u: .5,
    min: Math.min, max: Math.max, float: Number, int: Math.trunc, uint: Math.trunc, vec4: () => 0, mix: (a: number, b: number, t: number) => a + (b - a) * t,
    state: (n: number) => { const b = r[k('stateBytes')]; return { r: b[n * 4] / 255, g: b[n * 4 + 1] / 255, b: b[n * 4 + 2] / 255, a: b[n * 4 + 3] / 255 }; },
    shownTier: (g: number, ego: boolean) => shownTier(Math.round(g * 255), values.tierMask!, ego) / 255 };
}
for (const retained of [false, true]) test(`retention review three: compiled WebGL and Canvas ${retained ? 'hover outside zero-dim focus' : 'ordinary selected carrier in Focus mode'} preserve dot and owned legs`, async () => {
  const { r, k, settings } = retained ? await retainedRenderer(true, 7) : await carrierRenderer(7);
  settings.visuals.motion = 'off'; settings.visuals.edgeMode = 'focus'; settings.visuals.carrierLines = 'through'; settings.visuals.focusEdges = false; settings.visuals.edgeDirection = false; settings.visuals.dimOpacity = 0;
  if (retained) {
    r[k('selectNote')](6, false); expect(r[k('stateBytes')][13]).toBe(0); expect(r[k('edgeTier')][2]).toBe(0);
    r[k('focusLevel')] = r[k('focusTarget')] = 1; r.hovered = 3; r[k('animate')](performance.now()); r[k('edgeQuiet')] = () => [0, Infinity];
  } else { settings.visuals.hoverHighlight = false; r[k('selectNote')](1, false); r[k('edgeQuiet')] = () => [0, Infinity]; }
  const n = retained ? 3 : 1, edges = retained ? [2, 3] : [0, 1], paint = carrierPaint(r, k), point = r.screenPoint(n);
  expect(paint.lines.length).toBeGreaterThanOrEqual(2);
  const uniforms = carrierUniforms(r, k), scalar = shippedCarrierScalar();
  for (const e of edges) {
    const alpha = scalar.edge({ ...uniforms, gl_InstanceID: e, source: r.projection.source[e], target: r.projection.target[e], foldEnd: r[k('carrierGeometry')].ends[e], lineRank: r[k('lineRanks')][e], tierByte: r[k('edgeTier')][e], typeOn: 1 });
    expect(alpha).toBeGreaterThanOrEqual(.25);
    const a = r.screenPoint(r.projection.source[e]), b = r.screenPoint(r.projection.target[e]); expect(paint.lines).toContainEqual([a.x, a.y, b.x, b.y]);
  }
  expect(scalar.node({ ...uniforms, layer: retained ? 0 : 2, gl_InstanceID: n, carrierRank: r[k('carrierGeometry')].nodes[n] })).toBeGreaterThan(0);
  expect(paint.dots.some(d => d[0] === point.x && d[1] === point.y && d[3]! >= .25)).toBe(true);
});

test('review1: rings entered over a path own the chip subject and scoped exit', async () => {
  const { r, k, hover } = await graduated([[0, 1], [1, 2], [2, 3]], 4);
  r[k('findPath')](0, 2); const path = r[k('pathView')]; expect(path).toBeDefined();
  hover(3); r[k('toggleLens')]();
  expect(r[k('lensNode')]).toBe(3); expect(r[k('focusNode')]).toBe(3);
  expect(r[k('namedViewState')]).toBe('Connection rings');
  expect(r[k('stateStrip')].querySelector('.graph-ng-state-subject').textContent).toBe('3');
  control(r[k('stateStrip')], 'Leave Connection rings').click();
  expect(r[k('lensNode')]).toBe(-1); expect(r[k('pathView')]).toBe(path);
  expect(r[k('namedViewState')]).toBe('Path between notes');
  control(r[k('stateStrip')], 'Leave Path between notes').click();
  expect(r[k('pathView')]).toBeUndefined(); expect(r[k('namedViewState')]).toBe('Notes');
});

test('review2: filtered-out targets disable state transitions and stale actions cannot reopen cards', async () => {
  const { renderer: r } = await fixture(), k = compiled;
  r[k('selectNote')](0, true);
  const stale = control(r[k('stateStrip')], 'Only connections');
  r.setView(new Uint8Array([0, 1, 1]), {});
  expect(r[k('namedViewState')]).toBe('Notes'); expect(r.card.node).toBe(-1);
  for (const name of ['Selected note', 'Only connections', 'Connection rings']) {
    const button = control(r[k('stateStrip')], name); expect(button.disabled).toBe(true); button.click();
    expect(r.card.node).toBe(-1); expect(r.isolation).toBeUndefined(); expect(r[k('lensNode')]).toBe(-1);
  }
  stale.click(); expect(r.card.node).toBe(-1); expect(r.isolation).toBeUndefined();
  r.setView(new Uint8Array([1, 1, 1]), {});
  expect(control(r[k('stateStrip')], 'Only connections').disabled).toBe(false);
});

test('review3: Groups owns its chip, appearance link, caret menu and Notes exit across redraws', async () => {
  const f = await groupCanvasFixture(25, 12); let notes = 0, tuned = '';
  f.view[compiled('showDetails')] = () => { notes++; };
  f.view[compiled('explorePanel')] = { [compiled('showAppearance')]: (state: string) => { tuned = state; } };
  try {
    expect(f.view.detailRenderer).toBeUndefined();
    control(f.stage, 'Groups appearance').click(); expect(tuned).toBe('Groups');
    expect(control(f.stage, 'View state menu').tagName).toBe('SUMMARY');
    for (const name of ['Selected note', 'Only connections', 'Connection rings']) expect(control(f.stage, name).disabled).toBe(true);
    control(f.stage, 'Notes').click(); expect(notes).toBe(1);
    control(f.stage, 'Leave Groups').click(); expect(notes).toBe(2);
    control(f.pager(), 'Next groups').click();
    control(f.stage, 'Leave Groups').click(); expect(notes).toBe(3);
  } finally { f.view.renderer.dispose(); }
});

test('review4: isolation scope retains a text-only live announcement under overlapping rings', async () => {
  const { renderer: r } = await fixture(), k = compiled;
  const announcements = () => r[k('stateStrip')].querySelectorAll('span').filter((e: any) => e.getAttribute('role') === 'status');
  r[k('selectNote')](0, true); r.isolate(0);
  expect(announcements().map((e: any) => e.textContent)).toEqual(['Only connections of 0']);
  expect(announcements()[0].className).toBe('graph-ng-screen-reader');
  r[k('setLens')](0); expect(announcements().map((e: any) => e.textContent)).toEqual(['Only connections of 0']);
  r[k('setLens')](-1); r.isolate(1);
  expect(announcements().map((e: any) => e.textContent)).toEqual(['Only connections of 1']);
  control(r[k('stateStrip')], 'Leave Only connections').click(); expect(announcements()).toHaveLength(0);
});


test('settlement winning a stop race does not leave stopped feedback', async () => {
  const f = await fixture(); f.plugin.settings.persistLayout = false;
  f.plugin.pipeline.stopLayout = () => {};
  f.plugin.pipeline.request = async (_revision: number, request: any) => {
    if (request.kind === 'recompute') {
      control(f.view[compiled('statusSummary')], 'Stop layout').click();
      expect(f.view.layoutStopped).toBe(true);
      return { positions: f.next, settled: true };
    }
    return {};
  };
  await f.view[compiled('applyLayout')](values);
  expect(f.view.layoutStopped).toBe(false);
});

test('bundled performance UI regressions', () => { execFileSync('node', ['tests/performance-ui-regressions.cjs']); });

test('verification-only promotion does not make an incomplete adopted projection cacheable', async () => {
  const { WorkerPipeline } = await import('../src/pipeline'), { packRows } = await import('../src/core/columns');
  const f = await fixture(), config = { declaration: f.plugin.settings.declaration, layout: f.plugin.settings.layout, source: 'synthetic/local', groupLevel: 0, streamEveryIterations: 5 };
  const p = f.plugin.pipeline = new WorkerPipeline(new Worker(new URL('../src/layout-worker.ts', import.meta.url).href) as any, () => 10000);
  try {
    await p.request(7, { kind: 'configure', config });
    await p.request(7, { kind: 'rows', reset: true, columns: packRows(Array.from({ length: 3 }, (_, i) => ({ path: `${i}.md`, properties: {} })), config.declaration) });
    await p.request(7, { kind: 'project', complete: false }); await p.request(7, { kind: 'layout' });
    f.plugin.settings.persistLayout = true; f.view[compiled('provisional')] = true; f.view.groupGraph = {};
    f.plugin.adapter = { [compiled('factsComplete')]: () => true, [compiled('linksResolved')]: true }; f.view[compiled('promoteProperties')]();
    expect(f.view.contentEl.dataset.verified).toBe('true');
    const calls: string[] = [], request = p.request.bind(p); p.request = (revision, req) => { calls.push(req.kind); return request(revision, req); };
    await f.view[compiled('applyLayout')](values);
    expect(calls).toEqual(['recompute', 'adoptLayout']); expect(f.writes.length).toBe(1);
    expect(await request(7, { kind: 'encode' }).catch(String)).toContain('Projection incomplete');
  } finally { p.dispose(); }
});

for (const failure of ['adoptLayout', 'encode', 'cache']) test(`post-commit ${failure} error is a cache warning`, async () => {
  const f = await fixture(); f.view[compiled('provisional')] = false; f.plugin.settings.persistLayout = true; f.plugin.adapter = { [compiled('linksResolved')]: true };
  f.plugin.pipeline.request = async (_: number, req: any) => {
    if (req.kind === 'recompute') return { positions: f.next, settled: true };
    if (req.kind === failure) throw Error('cache unavailable');
    return { cacheable: true };
  };
  f.plugin.cache = async () => { throw Error('cache unavailable'); };
  await f.view[compiled('applyLayout')](values); expect(f.writes.length).toBe(1); expect(f.view.positions).toBe(f.next);
  expect(f.view.contentEl.dataset.cacheError).toContain('cache unavailable'); expect(f.view.statusText).not.toContain('failed');
});

test('one Graphics trial overrides only the dispatched pass, never its saved preference or the following pass', async () => {
  const f = await fixture(), engines: string[] = []; f.plugin.settings.quickStart = true;
  f.plugin.pipeline.request = async (_: number, req: any) => { engines.push(req.layoutEngine); expect(req.quickStart).toBeFalsy(); return { positions: f.next, milliseconds: 1 }; };
  await f.view[compiled('applyLayout')]({}, true); await f.view[compiled('applyLayout')]({});
  expect(engines).toEqual(['graphics','auto']); expect(f.plugin.settings.layoutEngine).toBe('auto'); expect(f.writes).toHaveLength(0);
});


test('review: live OS preference controls the active worker preview subscription both ways', async () => {
  const f = await fixture();
  const h = reviewRenderer(false, { reduced: true });
  const r = await h.Renderer.create(h.stage, f.view.projection, f.positions, f.view.visible, f.plugin.settings, () => {}, () => {}, new Uint32Array(3), () => true, true);
  f.view.detailRenderer = f.view.renderer = r;
  const { WorkerPipeline } = await import('../src/pipeline');
  const entered = deferred(), sent: any[] = [];
  const transport = { onmessage: null as any, onerror: null, terminate() {}, postMessage(m: any) { sent.push(m); if (m.kind === 'recompute') entered.resolve(); } };
  f.plugin.pipeline = new WorkerPipeline(transport, () => 10000);
  const work = f.view[compiled('applyLayout')](values);
  try {
    await entered.promise;
    transport.onmessage({ data: { kind: 'positions', revision: 7, iteration: 1, total: 100, positions: f.next.slice() } });
    expect(sent.filter(m => m.kind === 'preview-wanted').map(m => m.wanted)).toEqual([false]);
    h.reduce(false); h.frame(); await Promise.resolve();
    expect(r[h.key('calmLayout')]).toBe(false);
    expect(sent.filter(m => m.kind === 'preview-wanted').map(m => m.wanted)).toEqual([false, true]);
    h.reduce(true);
    expect(sent.filter(m => m.kind === 'preview-wanted').map(m => m.wanted)).toEqual([false, true, false]);
  } finally {
    transport.onmessage({ data: { id: 1, revision: 7, result: { positions: f.next, milliseconds: 1, cached: false } } });
    await work; h.dispose(r);
  }
});

test('review: first create survives context loss in the yielded VAO upload and accepts restoration', async () => {
  const h = reviewRenderer(true), k = h.key, s = defaults('fixture'), p = projection();
  const proto = h.Renderer.prototype, integer = proto[k('integer')];
  let owner: any, restore: (() => void) | undefined;
  proto[k('integer')] = function (...args: any[]) {
    if (!owner) {
      owner = this;
      queueMicrotask(() => { owner[k('contextLost')]({ preventDefault() {} }); });
      restore = () => owner[k('contextRestored')]();
    }
    return integer.apply(this, args);
  };
  try {
    // Park the lost context until create's upload continuation has run. The
    // contextRestored event is still comfortably inside the restore deadline.
    const opening = h.Renderer.create(h.stage, p, Float32Array.of(0, 0, 1, 2, 3, 4), new Uint8Array(3).fill(1), s, () => {}, () => {}, new Uint32Array(3));
    const result = await opening.then((r: any) => r, (e: Error) => e.message);
    expect(owner.canvas.dataset.context).toBe('lost'); restore!();
    for (let i = 0; i < 100 && owner.canvas.dataset.context === 'lost'; i++) await new Promise(r => setTimeout(r, 2));
    expect({ opened: result === owner, context: owner.canvas.dataset.context }).toEqual({ opened: true, context: 'restored' });
  } finally { proto[k('integer')] = integer; h.dispose(owner); }
});

test('review: a second context loss observed by polling does not consume the restore timeout', async () => {
  const h = reviewRenderer(true), k = h.key, s = defaults('fixture'); let unavailable = 0;
  const r = await h.Renderer.create(h.stage, projection(), Float32Array.of(0, 0, 1, 2, 3, 4), new Uint8Array(3).fill(1), s, () => {}, () => {}, new Uint32Array(3), () => true, false, () => { unavailable++; });
  try {
    const gl = r.gl; let driverLost = false;
    r[k('contextLost')]({ preventDefault() {} });
    gl.isContextLost = () => driverLost;
    gl.linkProgram = () => { driverLost = true; };
    r[k('contextRestored')](); // new batch; driver loses this context before its DOM event runs
    await new Promise(resolve => setTimeout(resolve, 30));
    expect({ unavailable, failed: r.canvas.dataset.context === 'failed' }).toEqual({ unavailable: 0, failed: false });
    s.contextRestoreTimeoutMs = 10;
    r[k('contextLost')]({ preventDefault() {} });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect({ unavailable, context: r.canvas.dataset.context }).toEqual({ unavailable: 1, context: 'failed' });
  } finally { h.dispose(r); }
});

for (const gpu of [false, true]) test(`review: handoff retains zoom near the limit after extent growth (WebGL=${gpu})`, async () => {
  const h = reviewRenderer(gpu), k = h.key, s = defaults('fixture');
  const create = (extent: number, loading: boolean) => h.Renderer.create(h.stage, projection(), Float32Array.of(0, 0, 10, 10, extent, extent), new Uint8Array(3).fill(1), s, () => {}, () => {}, new Uint32Array(3), () => true, !gpu, () => {}, { loading });
  const preview = await create(100, true), final = await create(200, false);
  try {
    preview.controls()[k('zoomAt')](.001, 0, 0);
    expect(preview.camera.ratio).toBe(s.cameraMinRatio);
    expect(final[k('adoptCamera')](preview)).toBe(true);
    expect(final[k('scale')]).toBeCloseTo(preview[k('scale')], 8);
    expect([final[k('centerX')], final[k('centerY')]]).toEqual([preview[k('centerX')], preview[k('centerY')]]);
    final.controls()[k('panBy')](10, 10); final.controls()[k('zoomAt')](1, 0, 0);
    expect(final[k('scale')]).toBeCloseTo(preview[k('scale')], 8);
  } finally { h.dispose(final); h.dispose(preview); }
});
