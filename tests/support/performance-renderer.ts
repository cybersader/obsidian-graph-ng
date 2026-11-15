import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ControlElement } from './controls-dom';

/** Production bundle with fake DOM/Canvas or full-scene WebGL command driver. Measures
 * JS submission only: no CSS layout, shader compilation, rasterization, GPU or display latency.
 * Canvas limits are NOT raised: its bounded visible mask retains the full projection. */
export function performanceRenderer(webgl = false) {
  let calls = 0, uploads = 0;
  const gl: any = new Proxy({ NO_ERROR: 0, isContextLost: () => false, getError: () => 0, getExtension: () => null,
    getParameter: () => 4096, getProgramParameter: () => true, getShaderParameter: () => true, getUniformLocation: () => ({}),
  }, { get: (o: any, k: string) => k in o ? o[k] : k.toUpperCase() === k ? 1 : k.startsWith('create') || k === 'fenceSync' ? () => ({}) : () => { calls++; if (['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D'].includes(k)) uploads++; } });
  const ctx: any = new Proxy({ measureText: (s: string) => ({ width: s.length * 7 }), createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), getImageData: () => ({ data: new Uint8ClampedArray([80, 90, 100, 255]) }) }, { get: (o: any, k: any) => k in o ? o[k] : () => { calls++; } });
  class Element extends ControlElement {
    style: any = {}; width = 0; height = 0; clientWidth = 1280; clientHeight = 800; className = ''; title = '';
    get parentElement() { return this.parent; }
    getContext(kind: string) { return kind === '2d' ? ctx : webgl && kind === 'webgl2' ? gl : null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
    addEventListener() {} removeEventListener() {} setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; }
    removeAttribute(k: string) { delete this.attributes[k]; }
    createDiv(options: any = {}) { const e = new Element(); e.className = options.cls; return this.appendChild(e); }
  }
  const frames = new Map<number, () => void>(), timers = new Set<ReturnType<typeof setTimeout>>(); let frame = 0;
  const source = readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  const name = source.match(/this\.detailRenderer=await ([\w$]+)\.create\(this\.stage/)?.[1];
  if (!name) throw new Error('Build production bundle before benchmarking');
  const mangle = JSON.parse(readFileSync(new URL('../../.workspace/evidence/main-mangle-cache.json', import.meta.url), 'utf8'));
  const key = (n: string) => typeof mangle[n] === 'string' ? mangle[n] : n;
  const module = { exports: {} as any };
  const obsidian = { ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Menu: class {}, Notice: class {}, TFile: class {}, apiVersion: 'synthetic', setIcon() {} };
  vm.runInNewContext(source + `\n;module.exports.__renderer=${name};`, {
    module, exports: module.exports, require: () => obsidian, console, structuredClone, performance, TextEncoder, TextDecoder, MessageChannel,
    document: { createElement: (tag: string) => new Element(tag.toUpperCase()), documentElement: { style: {} } },
    window: { devicePixelRatio: 1 }, devicePixelRatio: 1, localStorage: { getItem() { return null; }, setItem() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (f: () => void) => { frames.set(++frame, f); return frame; }, cancelAnimationFrame: (n: number) => frames.delete(n),
    setTimeout: (f: () => void, ms: number) => { if ([...frames.values()].includes(f)) return -1; const t = setTimeout(() => { timers.delete(t); f(); }, ms); timers.add(t); return t; },
    clearTimeout: (t: ReturnType<typeof setTimeout>) => { timers.delete(t); clearTimeout(t); },
  }, { filename: 'production-main.js' });
  return { Renderer: module.exports.__renderer, stage: new Element(), key,
    draw(r: any) { r[key('draw')](); }, calls: () => calls, uploads: () => uploads,
    dispose(r: any) { r?.dispose(); for (const t of timers) clearTimeout(t); timers.clear(); frames.clear(); },
  };
}
