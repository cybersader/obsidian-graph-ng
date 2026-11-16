import { test, expect } from 'bun:test';
import { PickGrid, positionTexture, incidentEdges, segmentDistance, placeLabels, labelLOD, LABEL_RATIOS, canvasDetailEdges, CanvasLimit, resizeDrawingBuffer } from '../src/render-data';
import { buildProjection } from '../src/core/projection';
import { defaultDeclaration, validateDeclaration } from '../src/core/declaration';
import { defaults, upgradeSettings, validateSettings } from '../src/settings';
import { minifyGlsl, shaderNames } from '../scripts/glsl.mjs';

test('shader cleanup preserves public names, stage linkage, swizzles and nonshader text', () => {
  const input = 'const ui = `alpha tint`; const a = glsl`#version 300 es\nuniform float focus;\nuniform float dim;\nlayout(location=0) in float size;\nout vec4 tint;\nvoid main() { float alpha = focus; vec3 rgb = vec3(alpha); tint = vec4(rgb, dim); }`; const b = glsl`#version 300 es\nin vec4 tint;\nout vec4 outputColor;\nvoid main() { outputColor = vec4(tint.rgb, tint.a); }`;';
  const output = minifyGlsl(input);
  expect(output).toContain('const ui = `alpha tint`');
  expect(output).toContain('#version 300 es\n');
  expect(output).toContain('uniform float focus,dim;');
  expect(output).toContain('layout(location=0)in float size;');
  expect(output).toContain(`out vec4 ${shaderNames.tint};`);
  expect(output).toContain(`in vec4 ${shaderNames.tint};`);
  expect(output).toContain(`vec4(${shaderNames.tint}.rgb,${shaderNames.tint}.a)`);
  const qualifiers = minifyGlsl('glsl`flat out uint seed; out uint unqualified; layout(location=0) in float size; in float other;`');
  expect(qualifiers).toContain(`flat out uint ${shaderNames.seed};out uint unqualified;`);
  expect(qualifiers).toContain('layout(location=0)in float size;in float other;');
});
test('shader cleanup refuses private-name capture and public binding renames', () => {
  expect(() => minifyGlsl('glsl`float A = 1.;`')).toThrow('GLSL_PRIVATE_NAME_COLLISION');
  expect(() => minifyGlsl('glsl`uniform float tint;`')).toThrow('GLSL_PUBLIC_NAME_RENAME');
  expect(() => minifyGlsl('glsl`layout(location=0) in float alpha;`')).toThrow('GLSL_PUBLIC_NAME_RENAME');
});
test('every production shader retains identical tokens after expanding private names and grouped declarations', () => {
  const source = readZoomProbeSource(new URL('../src/webgl-renderer.ts', import.meta.url), 'utf8');
  const bodies = (text: string) => [...text.matchAll(/glsl`([^`]*)`/g)].map(m => m[1]!);
  const original = bodies(source), compact = bodies(minifyGlsl(source));
  const reverse = Object.fromEntries(Object.entries(shaderNames).map(([name, short]) => [short, name]));
  const tokens = (body: string) => body.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
  expect(compact.length).toBe(original.length);
  compact.forEach((body, i) => {
    const restored = body.replace(/\b[A-Za-z_]\w*\b/g, name => reverse[name] ?? name)
      .replace(/\b(uniform|in|out) (\w+) (\w+(?:,\w+)+);/g, (_, qualifier, type, names: string) => names.split(',').map(name => `${qualifier} ${type} ${name};`).join(''));
    expect(tokens(restored)).toBe(tokens(original[i]!));
  });
});

test('packed picking handles negative coordinates, ties, hidden and empty nodes', () => {
  const grid = new PickGrid(new Float32Array([-10, -5, -10, -5, 50, 50]), new Uint8Array([1, 1, 0]));
  expect(grid.pick(-10, -5, 1)).toBe(0); expect(grid.pick(50, 50, 1)).toBe(-1); expect(grid.pick(1e9, 1e9, 1)).toBe(-1);
  expect(new PickGrid(new Float32Array(), new Uint8Array()).pick(0, 0, 10)).toBe(-1);
  expect(() => new PickGrid(new Float32Array([0]), new Uint8Array([1]))).toThrow('RENDER_POSITION_COUNT');
  expect(() => new PickGrid(new Float32Array([NaN, 0]), new Uint8Array([1]))).toThrow('RENDER_NONFINITE_POSITION');
});
test('packed grid picks agree with a brute-force oracle for seeded synthetic points', () => {
  const positions = new Float32Array(4000), visible = new Uint8Array(2000); let state = 17;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 2000; i++) { positions[i * 2] = random() * 1000 - 500; positions[i * 2 + 1] = random() * 1000 - 500; visible[i] = i % 3 ? 1 : 0; }
  const grid = new PickGrid(positions, visible);
  for (let j = 0; j < 300; j++) {
    const x = random() * 1200 - 600, y = random() * 1200 - 600, r = random() * 80; let best = -1, distance = r * r;
    for (let i = 0; i < visible.length; i++) if (visible[i]) { const d = (positions[i * 2]! - x) ** 2 + (positions[i * 2 + 1]! - y) ** 2; if (d < distance) { distance = d; best = i; } }
    expect(grid.pick(x, y, r)).toBe(best);
  }
});
test('position texture preserves SoA coordinates, pads only final row and reuses aligned data', () => {
  const a = new Float32Array([1, 2, 3, 4, 5, 6]), t = positionTexture(a, 2);
  expect(t.width).toBe(2); expect(t.height).toBe(2); expect([...t.data]).toEqual([1, 2, 3, 4, 5, 6, 0, 0]);
  expect(positionTexture(a, 3).data).toBe(a); expect(positionTexture(new Float32Array()).data.length).toBe(2);
});
test('incident edge CSR includes incoming, outgoing, parallel and self edges', () => {
  const d = defaultDeclaration('test@1'); d.edges = [{ kind: 'inline', name: 'link', key: 'to', type: 'link' }];
  const p = buildProjection([{ path: 'A.md', properties: { to: ['A.md', 'B.md'] } }, { path: 'B.md', properties: { to: ['A.md'] } }], d), csr = incidentEdges(p);
  expect([...csr.offsets]).toEqual([0, 4, 6]);
  expect([...csr.edges.slice(csr.offsets[0], csr.offsets[1])].sort()).toEqual([0, 0, 1, 2]);
});
test('segment picking clamps endpoints and handles zero-length edges', () => {
  expect(segmentDistance(5, 2, 0, 0, 10, 0)).toBe(2); expect(segmentDistance(12, 0, 0, 0, 10, 0)).toBe(2); expect(segmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
});
test('per-LOD greedy placement is deterministic, bounded, nonoverlapping and crosses grid cells', () => {
  const candidates = Array.from({ length: 200 }, (_, node) => ({ node, x: node % 20 * 6 - 50, y: Math.floor(node / 20) * 8 - 50, w: 20, h: 14 }));
  const placed = placeLabels(candidates, 16, 15); expect(placed.length).toBe(15); expect(placeLabels(candidates, 16, 15)).toEqual(placed);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) { const a = placed[i]!, b = placed[j]!; expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false); }
});
test('LOD picks conservative precomputed scale, including out-of-range zoom', () => {
  expect(labelLOD(.3)).toBe(2); expect(labelLOD(1)).toBe(3); expect(labelLOD(.001)).toBe(0); expect(labelLOD(99)).toBe(LABEL_RATIOS.length - 1);
});
test('declared colors accept bounded variable references, not arbitrary CSS', () => {
  const d = defaultDeclaration('test@1'); d.colors = [{ name: 'color', color: 'var(--graph-custom-node)', predicate: { kind: 'folder', prefix: '' } }];
  expect(() => validateDeclaration(d)).not.toThrow();
  d.colors[0]!.color = 'url(https://invalid.example/x)'; expect(() => validateDeclaration(d)).toThrow('Color must');
});
test('new renderer knobs migrate missing settings and reject invalid ranges', () => {
  const s = defaults('test@1'), old = structuredClone(s) as any;
  const keys = ['labelsMaxPerViewport', 'canvasMaxDetailNodes', 'canvasMaxDetailEdges', 'labelCandidateMultiplier', 'frameBackstopMs', 'shaderPollMs', 'contextRestoreTimeoutMs', 'cameraMinRatio', 'cameraMaxRatio'] as const;
  for (const key of keys) delete old[key];
  const upgraded = upgradeSettings(old, 'test@1');
  for (const key of keys) { expect(upgraded[key]).toBe(s[key]); expect(() => validateSettings({ ...s, [key]: 0 })).toThrow(); }
  expect(() => validateSettings({ ...s, cameraMinRatio: 8, cameraMaxRatio: 8 })).toThrow('cameraMinRatio');
  expect(() => validateSettings({ ...s, labelCandidateMultiplier: 1.5 })).toThrow();
});
test('software edge and node budgets reject excess work, never silently truncate', () => {
  const p = { source: new Uint32Array([0, 0, 1, 2]), target: new Uint32Array([0, 1, 0, 0]) }, visible = new Uint8Array([1, 1, 0]);
  expect([...canvasDetailEdges(p, visible, 2, 3)]).toEqual([0, 1, 2]);
  expect(() => canvasDetailEdges(p, visible, 1, 3)).toThrow('CANVAS_DETAIL_NODE_LIMIT');
  expect(() => canvasDetailEdges(p, visible, 2, 2)).toThrow('CANVAS_DETAIL_EDGE_LIMIT');
  // Callers detect the refusal by type, not by matching message text.
  expect(() => canvasDetailEdges(p, visible, 1, 3)).toThrow(CanvasLimit); expect(() => canvasDetailEdges(p, visible, 2, 2)).toThrow(CanvasLimit);
});

test('drawing-buffer resize never resets an unchanged axis', () => {
  let width = 800, height = 600; const writes: string[] = [];
  const canvas = { get width() { return width; }, set width(v: number) { writes.push('width'); width = v; },
    get height() { return height; }, set height(v: number) { writes.push('height'); height = v; } };
  resizeDrawingBuffer(canvas, 800, 600); expect(writes).toEqual([]);
  resizeDrawingBuffer(canvas, 800, 500); expect(writes).toEqual(['height']);
  resizeDrawingBuffer(canvas, 900, 500); expect(writes).toEqual(['height', 'width']);
  resizeDrawingBuffer(canvas, 1800, 1000); expect(writes).toEqual(['height', 'width', 'width', 'height']);
  expect([canvas.width, canvas.height]).toEqual([1800, 1000]);
});


// Pure probe contracts; these do not execute a browser, renderer, or GPU.
import { test as zoomProbeTest, expect as zoomProbeExpect } from 'bun:test';
import { readFileSync as readZoomProbeSource } from 'node:fs';
import { cssRoi, classifyContext, backendAccepted, probeOutcome, type ContextFacts } from '../scripts/zoom-stability-support';
const zoomGpuFacts = (): ContextFacts => ({ actualBackend: 'webgl2', contextIsWebGL2: true, contextIsCanvas2D: false, gpuFlag: true, lostContext: false, contextAttributes: { antialias: false }, drawingBuffer: [800, 600], maskedRenderer: 'WebKit WebGL', unmaskedRenderer: 'ANGLE (NVIDIA GeForce RTX)', glVersion: 'WebGL 2.0' });
zoomProbeTest('ZR-P1 probe explicitly enables Chromium sandbox without alternate launch policy', () => {
  const code = readZoomProbeSource(new URL('../scripts/zoom-stability-probe.ts', import.meta.url), 'utf8');
  zoomProbeExpect(code).toContain('headless: true, chromiumSandbox: true'); zoomProbeExpect(code).not.toMatch(/--no-sandbox|--disable-setuid-sandbox|ignoreDefaultArgs/);
  zoomProbeExpect(code.match(/chromium\.launch\(/g)?.length).toBe(1);
});
zoomProbeTest('ZR-P2 requested hardware refuses actual Canvas fallback', () => {
  const facts: ContextFacts = { ...zoomGpuFacts(), actualBackend: 'canvas2d', contextIsWebGL2: false, contextIsCanvas2D: true, gpuFlag: false, contextAttributes: null, drawingBuffer: null, maskedRenderer: null, unmaskedRenderer: null, glVersion: null };
  zoomProbeExpect(classifyContext(facts)).toBe('canvas2d'); zoomProbeExpect(backendAccepted('webgl', facts)).toBe(false); zoomProbeExpect(backendAccepted('canvas', facts)).toBe(true);
});
zoomProbeTest('ZR-P2 software WebGL stays distinct and cannot pass hardware', () => {
  for (const name of ['ANGLE (Google SwiftShader)', 'llvmpipe', 'Mesa softpipe', 'lavapipe', 'Microsoft Basic Render Driver']) { const facts = { ...zoomGpuFacts(), unmaskedRenderer: name }; zoomProbeExpect(classifyContext(facts)).toBe('software-webgl'); zoomProbeExpect(backendAccepted('webgl', facts)).toBe(false); }
});
zoomProbeTest('ZR-P2 unknown identity, absent context and lost drawing buffer do not prove hardware', () => {
  for (const change of [{ unmaskedRenderer: null }, { unmaskedRenderer: 'Generic WebGL Renderer' }, { contextAttributes: null }, { drawingBuffer: null }, { lostContext: true }, { contextIsWebGL2: false }, { gpuFlag: false }]) zoomProbeExpect(backendAccepted('webgl', { ...zoomGpuFacts(), ...change })).toBe(false);
});
zoomProbeTest('ZR-P2 recognized hardware requires real WebGL2 context evidence', () => {
  zoomProbeExpect(classifyContext(zoomGpuFacts())).toBe('hardware-webgl'); zoomProbeExpect(backendAccepted('webgl', zoomGpuFacts())).toBe(true); zoomProbeExpect(backendAccepted('canvas', zoomGpuFacts())).toBe(false);
});
zoomProbeTest('ZR-P3 stale DPR baseline and updated candidate sample the same CSS region', () => {
  const baseline = cssRoi(800, 600, 800, 600), candidate = cssRoi(800, 600, 1600, 1200);
  zoomProbeExpect(baseline.requestedCSS).toEqual(candidate.requestedCSS); zoomProbeExpect(baseline.actualCSS).toEqual(candidate.actualCSS); zoomProbeExpect(baseline.actualCSS.width).toBe(128);
  zoomProbeExpect([baseline.width, candidate.width]).toEqual([128, 256]); zoomProbeExpect(candidate.samples / baseline.samples).toBe(4);
  zoomProbeExpect((baseline.samples / 4) / baseline.samples).toBe((candidate.samples / 4) / candidate.samples);
});
zoomProbeTest('ZR-P3 actual per-axis backing scale and fractional DPI preserve CSS correspondence', () => {
  const roi = cssRoi(800, 600, 1000, 1200); zoomProbeExpect([roi.scaleX, roi.scaleY]).toEqual([1.25, 2]); zoomProbeExpect(roi.actualCSS).toEqual(roi.requestedCSS); zoomProbeExpect([roi.width, roi.height]).toEqual([160, 256]); zoomProbeExpect(roi.glY).toBe(1200 - roi.y - roi.height);
  zoomProbeExpect(() => cssRoi(0, 600, 800, 600)).toThrow('ROI_DIMENSIONS');
});
zoomProbeTest('ZR-P4 probe observes public renderer lifecycle and owned scene inputs', () => {
  const code = readZoomProbeSource(new URL('../scripts/zoom-stability-entry.ts', import.meta.url), 'utf8');
  zoomProbeExpect(code).toContain('r.refresh(); requestAnimationFrame('); zoomProbeExpect(code).toContain("canvas.getContext('webgl2')"); zoomProbeExpect(code).toContain('internalDerivedColorsVerified: false');
  zoomProbeExpect(code).not.toMatch(/r\.(?:draw|gl|ctx|dpr|homeRatio|colorBytes)\b/);
});


import { transform as zoomRunnerTransform } from 'esbuild';
import { createHash as zoomRunnerHash } from 'node:crypto';
// Execute the actual authored runner with injected IO. No browser, network, pixel,
// screenshot or build is performed by these control-flow tests.
async function zoomRunnerFixture(kind: 'software' | 'fallback' | 'unknown' | 'broken' | 'drift') {
  const sourceText = readZoomProbeSource(new URL('../scripts/zoom-stability-probe.ts', import.meta.url), 'utf8');
  const { code } = await zoomRunnerTransform(sourceText.replace(/^import .*;\r?\n/gm, ''), { loader: 'ts', target: 'es2022', format: 'esm' });
  const sourceSha = zoomRunnerHash('sha256').update('fixture-source').digest('hex');
  let launches = 0, pages = 0, screenshots = 0, saved: any;
  const sandboxOptions: any[] = [], processStub = { env: { CHROME_BIN: '/synthetic/permitted-browser' }, exitCode: 0 };
  const empty = async () => {};
  const browserStub = { version: () => 'synthetic-control-flow', close: empty, newPage: async () => {
    const ordinal = pages++; let dpr = 1;
    const cdp = { send: async (_method: string, parameters: any) => { dpr = parameters.deviceScaleFactor; }, detach: empty };
    return { setDefaultTimeout() {}, addInitScript: empty, on() {}, context: () => ({ newCDPSession: async () => cdp }), goto: empty, waitForFunction: empty, close: empty,
      screenshot: async () => { screenshots++; if (kind === 'drift') dpr = 1; },
      evaluate: async (_callback: unknown, ratio?: number | string) => {
        if (ratio === 'zoom-probe-dpr') return { devicePixelRatio: dpr, viewport: [1024, 768] };
        if (ratio === undefined) return undefined;
        if (kind === 'broken') throw new Error('CONTEXT_READBACK_FAILED');
        const canvas = ordinal === 1 || kind === 'fallback';
        const facts: ContextFacts = canvas ? { ...zoomGpuFacts(), actualBackend: 'canvas2d', contextIsWebGL2: false, contextIsCanvas2D: true, gpuFlag: false, contextAttributes: null, drawingBuffer: null, maskedRenderer: null, unmaskedRenderer: null, glVersion: null } : { ...zoomGpuFacts(), drawingBuffer: [800 * dpr, 600 * dpr], unmaskedRenderer: kind === 'software' ? 'ANGLE (Google SwiftShader)' : 'Unidentified adapter' };
        return { ...facts, sourceSha, workersCreated: 0, glError: canvas ? null : 0, devicePixelRatio: dpr, css: [800, 600], backing: [800 * dpr, 600 * dpr], requestedRatio: ratio };
      },
    };
  } };
  const serverStub = { listen: (_port: number, _host: string, callback: () => void) => callback(), address: () => ({ port: 43123 }), closeAllConnections() {}, close: (callback: () => void) => callback() };
  const bindings: Record<string, unknown> = { chromium: { launch: async (options: unknown) => { launches++; sandboxOptions.push(options); return browserStub; } }, build: async () => ({ outputFiles: [{ text: 'synthetic harness bytes' }] }), glsl: {}, createServer: () => serverStub, mkdir: empty, readFile: async () => 'fixture-source', writeFile: async (_path: string, text: string) => { saved = JSON.parse(text); }, createHash: zoomRunnerHash, process: processStub, classifyContext, backendAccepted, probeOutcome };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(bindings), code)(...Object.values(bindings));
  return { launches, pages, screenshots, saved, processStub, sandboxOptions };
}
zoomProbeTest('ZR-P2R actual runner retains every usable nonhardware capture and independent Canvas lane before final refusal', async () => {
  for (const kind of ['software', 'fallback', 'unknown'] as const) {
    const result = await zoomRunnerFixture(kind);
    zoomProbeExpect([result.launches, result.pages, result.screenshots]).toEqual([1, 2, 16]); zoomProbeExpect(result.sandboxOptions[0].chromiumSandbox).toBe(true);
    zoomProbeExpect(result.saved.captures.length).toBe(16); zoomProbeExpect(result.saved.executed).toBe(true); zoomProbeExpect(result.processStub.exitCode).toBe(1); zoomProbeExpect(result.saved.failure).toContain('RESOLUTION_OR_HARDWARE_UNPROVEN');
    const first = result.saved.captures.slice(0, 8), second = result.saved.captures.slice(8);
    zoomProbeExpect(first.every((c: any) => c.backend === 'webgl' && c.backendAccepted === false)).toBe(true);
    zoomProbeExpect(first.every((c: any) => c.contextClassification === (kind === 'software' ? 'software-webgl' : kind === 'fallback' ? 'canvas2d' : 'unverified-webgl'))).toBe(true);
    zoomProbeExpect(second.every((c: any) => c.backend === 'canvas' && c.contextClassification === 'canvas2d' && c.backendAccepted === true)).toBe(true);
    zoomProbeExpect(first.map((c: any) => [c.name, c.devicePixelRatio])).toEqual(second.map((c: any) => [c.name, c.devicePixelRatio]));
    zoomProbeExpect(first.map((c: any) => c.name)).toEqual(['far', 'far-step', 'mid', 'near', 'far', 'far-step', 'mid', 'near']);
  }
});
zoomProbeTest('ZR-P2R actual runner still stops on unusable readback without retries or fabricated captures', async () => {
  const result = await zoomRunnerFixture('broken');
  zoomProbeExpect([result.launches, result.pages, result.screenshots]).toEqual([1, 1, 0]); zoomProbeExpect(result.saved.captures).toEqual([]); zoomProbeExpect(result.saved.executed).toBe(false); zoomProbeExpect(result.saved.failure).toContain('CONTEXT_READBACK_FAILED'); zoomProbeExpect(result.processStub.exitCode).toBe(1);
});

zoomProbeTest('paired harness distinguishes valid stale backing from invalid DPR control', () => {
  const captures = ['webgl', 'canvas'].flatMap(backend => [1, 2].flatMap(intendedDpr => ['far', 'far-step', 'mid', 'near'].map(name => ({ backend, intendedDpr, name, devicePixelRatio: intendedDpr, beforePixels: { devicePixelRatio: intendedDpr, viewport: [1024, 768] }, beforeScreenshot: { devicePixelRatio: intendedDpr, viewport: [1024, 768] }, afterScreenshot: { devicePixelRatio: intendedDpr, viewport: [1024, 768] }, backendAccepted: true, resolutionMatches: intendedDpr === 1 }))));
  zoomProbeExpect(probeOutcome({ executed: true, errors: [], captures })).toEqual({ schema: 'zoom-probe-outcome.v1', status: 'acceptance-rejected', matrixValid: true, reasons: ['BACKING_RESOLUTION_MISMATCH'] });
  const drifted = structuredClone(captures); drifted[4]!.afterScreenshot.devicePixelRatio = 1;
  zoomProbeExpect(probeOutcome({ executed: true, errors: [], captures: drifted }).status).toBe('infrastructure-failure');
  zoomProbeExpect(probeOutcome({ executed: true, errors: [], captures: captures.slice(1) }).matrixValid).toBe(false);
});
zoomProbeTest('actual runner records screenshot DPR drift as infrastructure failure, not known baseline defect', async () => {
  const result = await zoomRunnerFixture('drift'); zoomProbeExpect(result.saved.captures.length).toBe(16);
  zoomProbeExpect(result.saved.captures[4].beforeScreenshot.devicePixelRatio).toBe(2); zoomProbeExpect(result.saved.captures[4].afterScreenshot.devicePixelRatio).toBe(1);
  zoomProbeExpect(result.saved.outcome.status).toBe('infrastructure-failure'); zoomProbeExpect(result.saved.outcome.reasons).toContain('DPR_OR_VIEWPORT_CONTROL_DRIFT'); zoomProbeExpect(result.processStub.exitCode).toBe(1);
});


test('emphasis enum defaults and migrates to adaptive, preserves scale, and rejects unknown values', () => {
  const s = defaults('links'); expect(s.visuals.emphasis).toBe('adaptive');
  const old: any = structuredClone(s); delete old.visuals.emphasis;
  expect(upgradeSettings(old, 'links').visuals.emphasis).toBe('adaptive');
  old.visuals.emphasis = 'scale'; expect(upgradeSettings(old, 'links').visuals.emphasis).toBe('scale');
  for (const emphasis of ['adaptive', 'scale']) expect(() => validateSettings({ ...s, visuals: { ...s.visuals, emphasis } })).not.toThrow();
  expect(() => validateSettings({ ...s, visuals: { ...s.visuals, emphasis: 'giant' } })).toThrow('visuals.emphasis');
});
