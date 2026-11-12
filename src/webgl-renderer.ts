import { renderPath, type RenderProjection } from './render-projection';
import type { Settings } from './settings';
import { PickGrid, positionTexture, incidentEdges, segmentDistance, labelLOD, canvasDetailEdges, resizeDrawingBuffer, LABEL_RATIOS } from './render-data';
import { readTheme, type GraphTheme } from './render-theme';
import { buildLabels, type LabelAtlas } from './render-labels';
import { carrierAlpha, carrierColors, carrierVisibility, categorical, degreeSizes, densityScale, edgeAlpha, effectPolicy, neutralizeGroups, easeInOut, groupHalos, isDark, labelFade, nodeColors, type EffectPolicy, type Halo, type RGB } from './render-effects';
import { yieldTask } from './core/scheduler';

/** Identity tag; the production build strips GLSL whitespace/comments at load time. */
const glsl = (s: TemplateStringsArray) => s[0]!;
// All shaders are constant source strings. Note text is only rasterized on Canvas2D.
// Every fragment writes premultiplied color; blending is ONE, ONE_MINUS_SRC_ALPHA, so a
// zero output alpha is additive glow (dark themes) and a nonzero one ordinary blending.
const common = glsl`#version 300 es
precision highp float;
precision highp int;
uniform sampler2D positions;
uniform sampler2D palette;
uniform sampler2D nodeColors;
uniform sampler2D nodeState;
uniform int positionWidth;
uniform vec2 center;
uniform vec2 viewport;
uniform float scale;
uniform float nodeSize;
uniform int hovered;
uniform int selected;
uniform float focus;
uniform int focusNode;
uniform float dim;
uniform float additive;
uniform float carrierAlpha;
uniform float carrierFold;
uniform float carrierSize;
uniform int layer;
ivec2 cell(int id) { return ivec2(id % positionWidth, id / positionWidth); }
vec2 point(int id) { return (texelFetch(positions, cell(id), 0).xy - center) * scale; }
vec4 color(int id) { return texelFetch(palette, ivec2(id % 256, id / 256), 0); }
vec4 nodeColor(int id) { return texelFetch(nodeColors, cell(id), 0); }
vec4 state(int id) { return texelFetch(nodeState, cell(id), 0); }
vec4 clip(vec2 p) { return vec4(p / viewport * vec2(2., -2.), 0., 1.); }
const vec2 corners[6] = vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
const vec4 offscreen = vec4(2.,2.,0.,1.);
`;
const nodeVertex = common + glsl`
layout(location=0) in float size;
uniform float glow;
out vec2 local;
out vec4 tint;
out float spread;
void main() {
 int id = gl_InstanceID; vec4 st = state(id);
 bool hot = id == hovered || id == selected, note = st.a > .5;
 // Edge notes (state alpha) draw in their own pass beneath the other nodes.
 // A highlighted edge note keeps its highlight but folds with the level of detail.
 float k = note ? (hot ? carrierFold : carrierAlpha) : 1.;
 float radius = nodeSize * size * (note ? carrierSize : 1.) + (hot ? 2. : 0.);
 spread = glow > 0. ? 2.3 : 1.;
 local = corners[gl_VertexID] * spread;
 gl_Position = st.r < .5 || st.b > .5 || note != (layer == 0) || k < .004 ? offscreen : clip(point(id) + local * radius);
 vec4 c = hot ? color(4) : nodeColor(id);
 tint = vec4(c.rgb, c.a * k * (focus > 0. && st.g < .5 && !hot ? mix(1., dim, focus) : 1.));
}`;
const nodeFragment = glsl`#version 300 es
precision highp float;
uniform float glow; uniform float additive;
in vec2 local; in vec4 tint; in float spread; out vec4 outputColor;
void main() {
 float d = length(local); if (d > spread) discard;
 float core = 1. - smoothstep(.82, 1., d);
 float halo = glow > 0. ? glow * .4 * exp(-3.4 * max(0., d - .9)) * (1. - smoothstep(spread * .75, spread, d)) * (1. - core) : 0.;
 vec3 shade = tint.rgb * (1. - .14 * smoothstep(.5, 1., d));
 outputColor = vec4((shade * core + tint.rgb * halo) * tint.a, (core + halo * (1. - additive)) * tint.a);
}`;
const edgeVertex = common + glsl`
layout(location=0) in uint source;
layout(location=1) in uint target;
layout(location=2) in uint typeOn;
uniform float edgeSize;
uniform int edgeHovered;
uniform int segments;
uniform float curvature;
uniform float edgeAlpha;
uniform float direction;
uniform float colorMix;
out vec4 tint;
void main() {
 int s = int(source), t = int(target); vec4 sa = state(s), sb = state(t);
 tint = vec4(0.);
 if (typeOn == 0u || sa.r < .5 || sb.r < .5) { gl_Position = offscreen; return; }
 int segment = gl_VertexID / 6; vec2 c = corners[gl_VertexID % 6];
 float u = (float(segment) + (c.x + 1.) * .5) / float(segments);
 vec2 a = point(s), b = point(t), delta = b - a; float len = length(delta);
 vec2 normal = len > 0. ? vec2(-delta.y, delta.x) / len : vec2(0., 1.);
 vec2 q = (a + b) * .5 + normal * len * curvature;
 vec2 tangent = mix(q - a, b - q, u); float tl = length(tangent);
 vec2 side = tl > 0. ? vec2(-tangent.y, tangent.x) / tl : normal;
 gl_Position = clip(mix(mix(a, q, u), mix(q, b, u), u) + side * c.y * max(.5, edgeSize));
 vec3 rgb = mix(color(1).rgb, mix(nodeColor(s).rgb, nodeColor(t).rgb, u), colorMix);
 float alpha = edgeAlpha * (direction > .5 ? mix(.12, 1., u) : 1.);
 if (focus > 0.) alpha = s == focusNode || t == focusNode ? mix(alpha, min(1., alpha * 3. + .35), focus) : alpha * mix(1., dim * .6, focus);
 if (gl_InstanceID == edgeHovered) { rgb = color(4).rgb; alpha = 1.; }
 tint = vec4(rgb * alpha, alpha * (1. - additive));
}`;
const solidFragment = glsl`#version 300 es
precision highp float; in vec4 tint; out vec4 outputColor;
void main() { outputColor = tint; }`;
const labelVertex = common + glsl`
layout(location=0) in vec4 a;
layout(location=1) in vec4 b;
layout(location=2) in vec2 extra;
uniform float labelAlpha;
uniform float labelCut;
out vec2 uv;
out vec4 tint;
void main() { vec2 q = (corners[gl_VertexID] + 1.) * .5; int id = int(a.x); vec4 st = state(id);
 float alpha = labelAlpha * smoothstep(labelCut, labelCut + .15, extra.y);
 if (focus > 0.) alpha = st.g > .5 || id == focusNode ? mix(alpha, 1., focus) : alpha * mix(1., dim, focus);
 gl_Position = st.r < .5 || st.b > .5 || alpha <= .004 ? offscreen : clip(point(id) + a.yz + q * vec2(a.w, b.x));
 uv = b.yz + q * vec2(b.w, extra.x); tint = vec4(color(3).rgb, alpha);
}`;
const labelFragment = glsl`#version 300 es
precision highp float; uniform sampler2D atlas; uniform vec3 outline; uniform vec2 texel;
in vec2 uv; in vec4 tint; out vec4 outputColor;
void main() {
 float a = texture(atlas, uv).a;
 float o = max(max(texture(atlas, uv + vec2(texel.x, 0.)).a, texture(atlas, uv - vec2(texel.x, 0.)).a), max(texture(atlas, uv + vec2(0., texel.y)).a, texture(atlas, uv - vec2(0., texel.y)).a));
 float alpha = max(a, o * .8) * tint.a;
 outputColor = vec4(mix(outline, tint.rgb, a) * alpha, alpha);
}`;
const discVertex = common + glsl`
layout(location=0) in vec4 geometry;
layout(location=1) in vec4 fill;
uniform float discAlpha;
out vec2 local;
out vec4 tint;
void main() { local = corners[gl_VertexID]; gl_Position = clip((geometry.xy - center) * scale + local * (geometry.z * scale + geometry.w)); tint = vec4(fill.rgb, fill.a * discAlpha); }`;
const discFragment = glsl`#version 300 es
precision highp float; uniform float hub; in vec2 local; in vec4 tint; out vec4 outputColor;
void main() {
 float d = length(local); if (d > 1.) discard;
 if (hub < .5) { float a = tint.a * pow(1. - d, 1.7); outputColor = vec4(tint.rgb * a, a); return; }
 float core = 1. - smoothstep(.92, 1., d), ring = smoothstep(.74, .8, d);
 float a = core * tint.a * mix(.62, 1., ring); outputColor = vec4(tint.rgb * mix(.7, 1.08, ring) * a, a);
}`;
const UNIFORMS = ['positions', 'palette', 'nodeColors', 'nodeState', 'positionWidth', 'center', 'viewport', 'scale', 'nodeSize', 'hovered', 'selected', 'focus', 'focusNode', 'dim', 'additive', 'glow', 'edgeSize', 'edgeHovered', 'segments', 'curvature', 'edgeAlpha', 'direction', 'colorMix', 'labelAlpha', 'labelCut', 'atlas', 'outline', 'texel', 'discAlpha', 'hub', 'carrierAlpha', 'carrierFold', 'carrierSize', 'layer'];
interface Program { handle: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> }
interface Camera { x: number; y: number; ratio: number }
/** Runtime view masks from the worker's explore result; colors stay worker-computed. */
export interface RenderView { groupCodes?: Uint32Array; groupLabels?: readonly string[]; collapsed?: Uint8Array; typeHidden?: Uint8Array; colors?: Uint32Array }
interface Hub { group: number; x: number; y: number; count: number; radius: number }
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Draw directly from projection columns. Camera frames touch uniforms only. */
export class DetailRenderer {
  readonly canvas: HTMLCanvasElement;
  /** Fixed camera frame for the lifetime of this renderer. */
  readonly grid: PickGrid;
  readonly camera: Camera = { x: .5, y: .5, ratio: 1 };
  readonly gpu: boolean;
  hovered = -1;
  selected = -1;
  hoveredEdge = -1;
  paletteUploads = 0;
  /** Render-visible nodes: filter-visible and not folded into a collapsed group. */
  visible: Uint8Array;
  policy!: EffectPolicy;
  onHub?: (group: number) => void;
  readonly timings: Record<string, number> = {};
  private gl: WebGL2RenderingContext | null;
  private ctx: CanvasRenderingContext2D | null = null;
  private theme: GraphTheme;
  private observer: ResizeObserver;
  private media = matchMedia('(prefers-color-scheme: dark)');
  private programs: Program[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  private buffers: WebGLBuffer[] = [];
  private textures: WebGLTexture[] = [];
  private labelBuffers: WebGLBuffer[] = [];
  private labelVaos: WebGLVertexArrayObject[] = [];
  private discBuffers: (WebGLBuffer | null)[] = [null, null];
  private atlas?: LabelAtlas;
  private labelsRevision = 0;
  private frameId = 0;
  private frameTimer: ReturnType<typeof setTimeout> | undefined;
  private restoreTimer: ReturnType<typeof setTimeout> | undefined;
  private canvasEdges = new Uint32Array();
  private disposed = false;
  private lost = false;
  private ready = false;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private fit = 1;
  /** Camera ratio of the last fit-all framing; effects scale relative to it. */
  private homeRatio = 1;
  private edges: ReturnType<typeof incidentEdges>;
  private colors: Uint32Array;
  private pointers = new Map<number, { x: number; y: number }>();
  private moved = false;
  private downX = 0;
  private downY = 0;
  private positionWidth = 1;
  private positionHeight = 1;
  private display: Float32Array;
  private filterVisible: Uint8Array;
  private picker: PickGrid;
  private view: RenderView = {};
  private groupCount = 0;
  private groupPalette?: Uint8Array;
  private colorBytes = new Uint8Array();
  private stateBytes = new Uint8Array();
  private sizes: Float32Array<ArrayBuffer>;
  private edgeOn: Uint8Array;
  private visibleEdges = 0;
  private visibleNodes = 0;
  /** Edge notes (reified edges drawn as nodes): total and render-visible. */
  readonly carrierCount: number;
  private visibleCarriers = 0;
  private near: number[] = [];
  private focusNode = -1;
  private focusLevel = 0;
  private focusTarget = 0;
  private focusAt = 0;
  private flight?: { from: Camera; to: Camera; start: number; ms: number };
  private halos: Halo[] = [];
  private hubs: Hub[] = [];
  private discData: Float32Array[] = [new Float32Array(), new Float32Array()];
  private overlay: HTMLElement;
  private hoverLabel: HTMLElement;
  private hubLabels: HTMLElement[] = [];
  static async create(container: HTMLElement, p: RenderProjection, positions: Float32Array, visible: Uint8Array, settings: Settings, onNode: (i: number) => void, onZoomOut: () => void, colors: Uint32Array, current = () => true, software = false, onUnavailable = onZoomOut, view: RenderView = {}) {
    await yieldTask(); if (!current()) throw new Error('Renderer superseded');
    const renderer = new DetailRenderer(container, p, positions, visible, settings, onNode, onZoomOut, colors, software, onUnavailable, view);
    try {
      await renderer.initialize();
      if (!current()) throw new Error('Renderer superseded');
      await renderer.prepareLabels(current);
      if (!current()) throw new Error('Renderer superseded');
      renderer.refresh(); return renderer;
    } catch (error) { renderer.dispose(); throw error; }
  }
  constructor(private container: HTMLElement, readonly projection: RenderProjection, readonly positions: Float32Array, visible: Uint8Array, private settings: Settings, private onNode: (i: number) => void, private onZoomOut: () => void, colors: Uint32Array, software = false, private onUnavailable = onZoomOut, view: RenderView = {}) {
    let started = performance.now();
    this.grid = new PickGrid(positions, visible); this.edges = incidentEdges(projection);
    this.filterVisible = visible; this.visible = visible; this.picker = this.grid; this.display = positions; this.colors = colors;
    this.carrierCount = projection.carrierNodes.reduce((n, v) => n + +!!v, 0);
    this.sizes = degreeSizes(projection.offsets, settings.visuals.degreeSizing); this.edgeOn = new Uint8Array(projection.source.length).fill(1);
    this.timings.grid = performance.now() - started; started = performance.now();
    this.theme = readTheme(container, settings);
    this.timings.theme = performance.now() - started; started = performance.now();
    this.canvas = document.createElement('canvas'); this.canvas.className = 'graph-ng-detail'; this.canvas.setAttribute('aria-label', 'Individual graph notes'); this.canvas.style.touchAction = 'none'; container.append(this.canvas);
    this.overlay = container.createDiv ? container.createDiv({ cls: 'graph-ng-overlay' }) : container.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-overlay' }));
    this.hoverLabel = this.overlay.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-hover-label' }));
    this.resize();
    this.gl = software ? null : this.canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    this.timings.context = performance.now() - started;
    this.gpu = Boolean(this.gl);
    if (!this.gl) {
      try { this.canvasEdges = canvasDetailEdges(projection, visible, settings.canvasMaxDetailNodes, settings.canvasMaxDetailEdges); } catch (e) { this.canvas.remove(); this.overlay.remove(); throw e; }
      this.ctx = this.canvas.getContext('2d'); if (!this.ctx) { this.canvas.remove(); this.overlay.remove(); throw new Error('CANVAS_UNAVAILABLE'); }
    }
    this.packState(); this.setView(visible, view, false); this.fitAll(0);
    this.canvas.addEventListener('webglcontextlost', this.contextLost); this.canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.canvas.addEventListener('pointerdown', this.pointerDown); this.canvas.addEventListener('pointermove', this.pointerMove); this.canvas.addEventListener('pointerup', this.pointerUp); this.canvas.addEventListener('pointercancel', this.pointerCancel); this.canvas.addEventListener('pointerleave', this.pointerLeave); this.canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.media.addEventListener('change', this.refreshTheme);
    this.observer = new ResizeObserver(() => { const changed = this.resize(); if (changed && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {}); }); this.observer.observe(container);
  }
  private packState() {
    const packed = positionTexture(this.positions); this.positionWidth = packed.width; this.positionHeight = packed.height;
    const cells = packed.width * packed.height * 4; this.stateBytes = new Uint8Array(cells); this.colorBytes = new Uint8Array(cells);
  }
  /** Apply worker view masks without rebuilding the renderer. O(n + m), no worker calls. */
  setView(filterVisible: Uint8Array, view: RenderView, upload = true) {
    const started = performance.now(), n = filterVisible.length, p = this.projection;
    const visibleChanged = filterVisible !== this.filterVisible || view.collapsed !== this.view.collapsed || view.groupCodes !== this.view.groupCodes;
    this.filterVisible = filterVisible; this.view = view; this.groupCount = view.groupLabels?.length ?? 0; if (view.colors && view.colors.length === filterVisible.length) this.colors = view.colors;
    const codes = view.groupCodes, collapsed = view.collapsed && codes && view.collapsed.some(Boolean) ? view.collapsed : undefined;
    // Collapsed members draw no node; their edges converge on the group centroid.
    const all = codes ? groupHalos(this.positions, filterVisible, codes, this.groupCount, this.groupCount) : [];
    this.hubs = collapsed ? all.filter(h => collapsed[h.group]).slice(0, this.settings.visuals.hubsMaxGroups).map(h => ({ ...h, radius: this.settings.nodeSize * Math.min(12, 2.4 + 1.1 * Math.log2(1 + h.count)) })) : [];
    const hubOf = new Int32Array(this.groupCount).fill(-1); this.hubs.forEach((h, i) => { hubOf[h.group] = i; });
    let display = this.positions; const render = collapsed ? new Uint8Array(n) : filterVisible;
    if (collapsed) {
      display = this.positions.slice();
      for (let i = 0; i < n; i++) {
        const hub = filterVisible[i] && collapsed[codes![i]!] ? hubOf[codes![i]!]! : -1;
        if (hub >= 0) { display[i * 2] = this.hubs[hub]!.x; display[i * 2 + 1] = this.hubs[hub]!.y; } else render[i] = filterVisible[i]!;
      }
    }
    this.display = display; this.visible = render;
    const hiddenTypes = view.typeHidden; this.visibleEdges = 0;
    for (let e = 0; e < p.source.length; e++) { const on = hiddenTypes?.[p.type[e]!] ? 0 : 1; this.edgeOn[e] = on; if (on && filterVisible[p.source[e]!] && filterVisible[p.target[e]!]) this.visibleEdges++; }
    this.visibleNodes = this.visibleCarriers = 0; const notes = p.carrierNodes;
    for (let i = 0; i < n; i++) { const o = i * 4; this.stateBytes[o] = filterVisible[i] ? 255 : 0; this.stateBytes[o + 2] = filterVisible[i] && !render[i] ? 255 : 0; this.stateBytes[o + 3] = notes[i] ? 255 : 0; if (render[i]) { this.visibleNodes++; if (notes[i]) this.visibleCarriers++; } }
    // Halos only for spatially coherent groups; a group spread across the web would be fog.
    const coherent = Math.max(this.grid.width, this.grid.height) * .22;
    this.halos = all.filter(h => !collapsed?.[h.group] && h.radius < coherent);
    // Software detail stays inside both refusal budgets; a too-large view keeps the last bounded edge set.
    if (!this.gl && this.ctx) try { this.canvasEdges = canvasDetailEdges(p, filterVisible, this.settings.canvasMaxDetailNodes, this.settings.canvasMaxDetailEdges); } catch { /* bounded: retain previous */ }
    if (visibleChanged || !this.picker) this.picker = render === this.grid.visible ? this.grid : new PickGrid(this.positions, render);
    if (this.near.length) this.setFocus(-1, true);
    this.recolor(); this.choosePolicy();
    this.timings.view = performance.now() - started;
    if (!upload) return;
    if (this.gl && this.ready && !this.lost) this.uploadView();
    if (visibleChanged && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {});
    this.refresh();
  }
  private choosePolicy() {
    const nodes = this.visible.reduce((n, v) => n + v, 0), bg = this.theme.palette.subarray(8, 11);
    this.policy = effectPolicy(this.settings.visuals, nodes, this.visibleEdges, this.groupCount, !this.gl, isDark([bg[0]!, bg[1]!, bg[2]!]));
  }
  private recolor() {
    const p = this.theme.palette, bg: RGB = [p[8]!, p[9]!, p[10]!], v = this.settings.visuals;
    this.groupPalette = v.autoPalette && this.view.groupCodes && this.groupCount ? neutralizeGroups(categorical(Math.min(this.groupCount, 4096), bg), this.view.groupLabels, p) : undefined;
    nodeColors(this.colors, this.settings.declaration.colors.length, p, this.view.groupCodes, this.groupPalette, this.colorBytes);
    if (v.carrierTint && this.carrierCount) carrierColors(this.projection.carrierNodes, this.projection.source, this.projection.target, this.projection.carrier, this.colorBytes, v.carrierBridge, p.subarray(16, 19), v.carrierBridgeAccent);
    this.packDiscs();
  }
  /** Group tint for legends and hubs: the same bytes the node texture uses. */
  groupColor(group: number): string { const [r, g, b] = this.groupRgb(group); return `rgb(${r},${g},${b})`; }
  /** A declared rule named like the group wins; otherwise the group palette, else the node color. */
  private groupRgb(group: number): number[] {
    const rule = this.settings.declaration.colors.findIndex(c => c.name === this.view.groupLabels?.[group]), p = this.theme.palette, g = this.groupPalette;
    const [bytes, k] = rule >= 0 ? [p, (rule + 5) * 4] : g ? [g, (group % (g.length / 4)) * 4] : [p, 0];
    return [bytes[k]!, bytes[k + 1]!, bytes[k + 2]!];
  }
  private packDiscs() {
    const fill = (h: { group: number }) => [...this.groupRgb(h.group).map(v => v / 255), 1];
    const halos = this.halos.slice(0, this.settings.visuals.halosMaxGroups);
    this.discData[0] = new Float32Array(halos.flatMap(h => [h.x, h.y, h.radius * 1.7, 0, ...fill(h)]));
    this.discData[1] = new Float32Array(this.hubs.flatMap(h => [h.x, h.y, 0, h.radius, ...fill(h)]));
    while (this.hubLabels.length > Math.min(64, this.hubs.length)) this.hubLabels.pop()!.remove();
    while (this.hubLabels.length < Math.min(64, this.hubs.length)) this.hubLabels.push(this.overlay.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-hub-label' })));
    this.hubLabels.forEach((el, i) => { const h = this.hubs[i]!; el.textContent = `${this.view.groupLabels?.[h.group] ?? ''} · ${h.count.toLocaleString()}`; });
  }
  private async program(vertex: string, fragment: string): Promise<Program> {
    const gl = this.gl!, shaders: WebGLShader[] = [], parallel = gl.getExtension('KHR_parallel_shader_compile');
    const handle = gl.createProgram()!;
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type)!; shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(handle, shader);
      }
      // COMPILE_STATUS/LINK_STATUS can synchronously wait hundreds of milliseconds.
      // The extension's completion query is nonblocking; defer status until ready.
      gl.linkProgram(handle); const deadline = performance.now() + this.settings.workerTimeoutMs;
      await yieldTask();
      if (parallel) while (!gl.getProgramParameter(handle, parallel.COMPLETION_STATUS_KHR)) {
        if (this.disposed || this.lost) throw new Error('Renderer superseded');
        if (performance.now() > deadline) throw new Error('GL_COMPILE_TIMEOUT');
        await new Promise<void>(resolve => setTimeout(resolve, this.settings.shaderPollMs));
      }
      if (this.disposed || this.lost) throw new Error('Renderer superseded');
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(`GL_LINK: ${gl.getProgramInfoLog(handle)}`);
      const uniforms: Program['uniforms'] = {};
      for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(handle, name);
      return { handle, uniforms };
    } catch (e) { gl.deleteProgram(handle); throw e; } finally { for (const shader of shaders) gl.deleteShader(shader); }
  }
  private buffer(data: ArrayBufferView, usage = this.gl!.STATIC_DRAW) { const gl = this.gl!, b = gl.createBuffer()!; this.buffers.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage); return b; }
  private integer(location: number, data: Uint32Array | Uint8Array) { const gl = this.gl!, b = this.buffer(data); gl.enableVertexAttribArray(location); gl.vertexAttribIPointer(location, 1, data instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(location, 1); return b; }
  private texture(unit: number) { const gl = this.gl!, t = gl.createTexture()!; this.textures[unit] = t; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
  private bytes(unit: number, data: Uint8Array) { const gl = this.gl!; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]!); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.positionWidth, this.positionHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); }
  private async initialize() {
    if (this.disposed || this.lost) return;
    const gl = this.gl;
    if (!gl) { this.ready = true; this.refresh(); return; }
    for (const [v, f] of [[edgeVertex, solidFragment], [nodeVertex, nodeFragment], [labelVertex, labelFragment], [discVertex, discFragment]]) {
      const started = performance.now(); this.programs.push(await this.program(v!, f!)); this.timings[`program${this.programs.length}`] = performance.now() - started; await yieldTask(); if (this.disposed || this.lost) return;
    }
    // ResizeObserver may fire while parallel shader compilation is pending.
    // Resizing that drawing buffer synchronously waits on the driver; apply its
    // latest CSS size only after all program completion polls have finished.
    await this.waitForResize(); this.resize(true);
    const uploadStart = performance.now(), max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (this.positionWidth > max || this.positionHeight > max || this.theme.palette.length / 1024 > max) throw new Error('GL_TEXTURE_LIMIT');
    for (let unit = 0; unit < 5; unit++) this.texture(unit);
    this.uploadPalette();
    for (let i = 0; i < 2; i++) { const vao = gl.createVertexArray()!; this.vaos.push(vao); gl.bindVertexArray(vao);
      if (i === 0) { this.integer(0, this.projection.source); this.integer(1, this.projection.target); this.integer(2, this.edgeOn); }
      else { this.buffer(this.sizes); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 1); }
      await yieldTask(); if (this.disposed || this.lost) return;
    }
    for (let i = 0; i < 2; i++) { const vao = gl.createVertexArray()!, b = gl.createBuffer()!; this.vaos.push(vao); this.discBuffers[i] = b; gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      for (let a = 0; a < 2; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 32, a * 16); gl.vertexAttribDivisor(a, 1); } }
    gl.bindVertexArray(null); this.uploadView();
    this.timings.upload = performance.now() - uploadStart;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    await this.waitForResize(); this.resize(true); this.ready = true; if (this.atlas) this.uploadLabels(); this.refresh();
  }
  /** View/hover changes re-upload compact per-node textures and one per-edge byte column. */
  private uploadView() {
    const gl = this.gl!, packed = positionTexture(this.display, this.positionWidth);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures[0]!); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, packed.width, packed.height, 0, gl.RG, gl.FLOAT, packed.data);
    this.bytes(3, this.colorBytes); this.bytes(4, this.stateBytes);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[2]!); gl.bufferData(gl.ARRAY_BUFFER, this.edgeOn, gl.STATIC_DRAW);
    for (let i = 0; i < 2; i++) { gl.bindBuffer(gl.ARRAY_BUFFER, this.discBuffers[i]!); gl.bufferData(gl.ARRAY_BUFFER, this.discData[i]!, gl.DYNAMIC_DRAW); }
  }
  private uploadPalette() { const gl = this.gl!; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.textures[1]!); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, this.theme.palette.length / 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.theme.palette); this.paletteUploads++; }
  private async prepareLabels(current: () => boolean) {
    const revision = ++this.labelsRevision, w = this.width, h = this.height;
    const valid = () => !this.disposed && revision === this.labelsRevision && current();
    const started = performance.now();
    const atlas = await buildLabels(this.projection, this.grid, this.settings, w, h, this.theme.font, valid, this.visible);
    this.timings.labels = performance.now() - started;
    if (!valid()) return; this.atlas = atlas; if (this.gl && this.ready && !this.lost) this.uploadLabels(); this.refresh();
  }
  private uploadLabels() {
    const started = performance.now(), gl = this.gl!;
    for (const b of this.labelBuffers) gl.deleteBuffer(b); for (const v of this.labelVaos) gl.deleteVertexArray(v); this.labelBuffers = []; this.labelVaos = [];
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.textures[2]!); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas!.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const data of this.atlas!.levels) {
      const vao = gl.createVertexArray()!, b = gl.createBuffer()!; this.labelVaos.push(vao); this.labelBuffers.push(b); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, i === 2 ? 2 : 4, gl.FLOAT, false, 40, i * 16); gl.vertexAttribDivisor(i, 1); }
    }
    gl.bindVertexArray(null); this.timings.labelUpload = performance.now() - started;
  }
  refreshTheme = () => {
    if (this.disposed) return;
    const font = this.theme.font; this.theme = readTheme(this.container, this.settings);
    this.recolor(); this.choosePolicy();
    if (this.gl && this.ready && !this.lost) { this.uploadPalette(); this.bytes(3, this.colorBytes); for (let i = 0; i < 2; i++) { this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.discBuffers[i]!); this.gl.bufferData(this.gl.ARRAY_BUFFER, this.discData[i]!, this.gl.DYNAMIC_DRAW); } }
    if (font !== this.theme.font && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {});
    this.refresh();
  };
  /** Live display knobs: degree sizes may change; everything else is a uniform. */
  refreshVisuals(labels = false) {
    if (this.disposed) return;
    this.sizes = degreeSizes(this.projection.offsets, this.settings.visuals.degreeSizing, this.sizes); this.recolor(); this.choosePolicy();
    if (this.gl && this.ready && !this.lost) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[3]!); gl.bufferData(gl.ARRAY_BUFFER, this.sizes, gl.STATIC_DRAW); this.uploadView(); }
    if (labels && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {});
    this.refresh();
  }
  private async waitForResize() {
    this.resize();
    const gl = this.gl;
    if (!gl || (this.canvas.width === Math.round(this.width * this.dpr) && this.canvas.height === Math.round(this.height * this.dpr))) return;
    // A buffer reset can implicitly wait for queued driver work. A WebGL2 fence
    // lets that work finish without synchronously blocking the main thread.
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) throw new Error('GL_RESIZE_FENCE');
    const deadline = performance.now() + this.settings.workerTimeoutMs;
    try {
      gl.flush();
      for (;;) {
        if (this.disposed || this.lost) throw new Error('Renderer superseded');
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return;
        if (status === gl.WAIT_FAILED) throw new Error('GL_RESIZE_WAIT');
        if (performance.now() > deadline) throw new Error('GL_RESIZE_TIMEOUT');
        await new Promise<void>(resolve => setTimeout(resolve, this.settings.shaderPollMs));
      }
    } finally { gl.deleteSync(fence); }
  }
  private resize(allowGpuResize = false) {
    const changed = this.width !== Math.max(1, this.container.clientWidth) || this.height !== Math.max(1, this.container.clientHeight) || this.dpr !== (window.devicePixelRatio || 1);
    if (!changed && this.canvas.width === Math.round(this.width * this.dpr) && this.canvas.height === Math.round(this.height * this.dpr)) return false;
    this.width = Math.max(1, this.container.clientWidth); this.height = Math.max(1, this.container.clientHeight); this.dpr = window.devicePixelRatio || 1;
    const started = performance.now(), width = Math.round(this.width * this.dpr), height = Math.round(this.height * this.dpr);
    // Even assigning the existing size resets the drawing buffer and can wait on
    // the GPU. A height-only panel change must not reset an unchanged width.
    if (!this.gl || this.ready || allowGpuResize) resizeDrawingBuffer(this.canvas, width, height);
    this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`;
    this.timings.maxResize = Math.max(this.timings.maxResize || 0, performance.now() - started);
    this.fit = Math.min(this.width / (this.grid.width * 1.1), this.height / (this.grid.height * 1.1)); this.refresh(); return changed;
  }
  private get scale() { return this.fit / this.camera.ratio; }
  private get centerX() { return this.grid.minX + this.camera.x * this.grid.width; }
  private get centerY() { return this.grid.minY + this.camera.y * this.grid.height; }
  private clampRatio(ratio: number) { return Math.max(this.settings.cameraMinRatio, Math.min(this.settings.cameraMaxRatio, ratio)); }
  setCamera(x: number, y: number, ratio: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(ratio)) throw new Error('CAMERA_NONFINITE');
    this.flight = undefined; this.camera.x = x; this.camera.y = y; this.camera.ratio = this.clampRatio(ratio); this.refresh();
  }
  /** Eased camera transition; honors reduced motion and the configured duration. */
  flyTo(x: number, y: number, ratio: number, ms = this.settings.visuals.cameraAnimationMs) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(ratio)) throw new Error('CAMERA_NONFINITE');
    if (ms <= 0 || reducedMotion()) { this.setCamera(x, y, ratio); return; }
    this.flight = { from: { ...this.camera }, to: { x, y, ratio: this.clampRatio(ratio) }, start: performance.now(), ms }; this.refresh();
  }
  /** Frame a world-space box (nodes, a group or everything) with margin. */
  frame(minX: number, minY: number, maxX: number, maxY: number, ms?: number): number {
    const w = Math.max(maxX - minX, this.grid.width * .02), h = Math.max(maxY - minY, this.grid.height * .02);
    const ratio = Math.max(w * 1.25 * this.fit / this.width, h * 1.25 * this.fit / this.height);
    this.flyTo(((minX + maxX) / 2 - this.grid.minX) / this.grid.width, ((minY + maxY) / 2 - this.grid.minY) / this.grid.height, ratio, ms);
    return ratio;
  }
  frameGroup(group: number, ms?: number) {
    const codes = this.view.groupCodes; if (!codes) return;
    let x = Infinity, y = Infinity, xx = -Infinity, yy = -Infinity;
    for (let i = 0; i < codes.length; i++) if (codes[i] === group && this.filterVisible[i]) { const a = this.positions[i * 2]!, b = this.positions[i * 2 + 1]!; x = Math.min(x, a); y = Math.min(y, b); xx = Math.max(xx, a); yy = Math.max(yy, b); }
    if (x !== Infinity) this.frame(x, y, xx, yy, ms);
  }
  /** Frame the 1st–99th percentile of visible nodes so a few isolated outliers do not shrink the web. */
  fitAll(ms?: number) {
    const xs: number[] = [], ys: number[] = [], step = Math.max(1, Math.floor(this.visible.length / 8192));
    for (let i = 0; i < this.visible.length; i += step) if (this.visible[i]) { xs.push(this.display[i * 2]!); ys.push(this.display[i * 2 + 1]!); }
    for (const h of this.hubs) { xs.push(h.x); ys.push(h.y); }
    if (xs.length < 8) { this.homeRatio = 1; this.flyTo(.5, .5, 1, ms); return; }
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(a.length * f))]!;
    this.homeRatio = this.clampRatio(this.frame(q(xs, .01), q(ys, .01), q(xs, .99), q(ys, .99), ms));
  }
  /** Test/host seam; not a second graph or renderer object model. */
  path(id: number) { return renderPath(this.projection, id); }
  screenPoint(id: number) { return { x: (this.display[id * 2]! - this.centerX) * this.scale + this.width / 2, y: (this.display[id * 2 + 1]! - this.centerY) * this.scale + this.height / 2 }; }
  private worldPoint(x: number, y: number) { return { x: (x - this.width / 2) / this.scale + this.centerX, y: (y - this.height / 2) / this.scale + this.centerY }; }
  /** Edge-note level of detail at this zoom: LOD visibility and the drawn alpha. */
  carrierLevel(zoom = this.camera.ratio / this.homeRatio) { const v = this.settings.visuals; return { visibility: carrierVisibility(zoom, v.carrierLodNear, v.carrierLodFar, v.carrierLod), alpha: carrierAlpha(v, this.visibleCarriers, zoom) }; }
  /** Edge notes folded away by the level of detail are not pickable. */
  pick(x: number, y: number) { const w = this.worldPoint(x, y); return this.picker.pick(w.x, w.y, (this.settings.nodeSize * (1 + this.settings.visuals.degreeSizing) + 4) / this.scale, this.carrierCount && this.carrierLevel().visibility < .25 ? this.projection.carrierNodes : undefined); }
  pickHub(x: number, y: number) {
    for (let i = this.hubs.length - 1; i >= 0; i--) { const h = this.hubs[i]!, sx = (h.x - this.centerX) * this.scale + this.width / 2, sy = (h.y - this.centerY) * this.scale + this.height / 2; if (Math.hypot(sx - x, sy - y) <= h.radius + 3) return h.group; }
    return -1;
  }
  private pickEdge(x: number, y: number) {
    const w = this.worldPoint(x, y), radius = this.grid.cell, p = this.projection;
    let best = -1, distance = this.settings.groupEdgeHitRadius / this.scale;
    // Deliberately incident-edge hover, not an O(m) all-segment scan or GPU readback.
    this.picker.visit(w.x, w.y, radius, node => {
      for (let j = this.edges.offsets[node]!; j < this.edges.offsets[node + 1]!; j++) { const e = this.edges.edges[j]!, a = p.source[e]!, b = p.target[e]!; if (!this.edgeOn[e] || !this.filterVisible[a] || !this.filterVisible[b]) continue;
        const d = segmentDistance(w.x, w.y, this.display[a * 2]!, this.display[a * 2 + 1]!, this.display[b * 2]!, this.display[b * 2 + 1]!); if (d < distance) { best = e; distance = d; }
      }
    }); return best;
  }
  /** One-hop neighborhood flags in the state texture; old flags are cleared, not rescanned. */
  private setFocus(node: number, immediate = false) {
    const s = this.stateBytes;
    if (node !== this.focusNode || immediate) {
      for (const i of this.near) s[i * 4 + 1] = 0;
      this.near = [];
      if (node >= 0) {
        const p = this.projection; this.near.push(node);
        for (let j = this.edges.offsets[node]!; j < this.edges.offsets[node + 1]!; j++) { const e = this.edges.edges[j]!; if (this.edgeOn[e]) this.near.push(p.source[e]! === node ? p.target[e]! : p.source[e]!); }
        for (const i of this.near) s[i * 4 + 1] = 255;
        this.focusNode = node;
      }
      if (this.gl && this.ready && !this.lost) this.bytes(4, s);
    }
    this.focusTarget = node >= 0 ? 1 : 0; this.focusAt = performance.now();
    if (immediate) { this.focusLevel = this.focusTarget; if (node < 0) this.focusNode = -1; }
  }
  refresh() {
    if (this.disposed || this.lost || this.frameId || this.frameTimer !== undefined) return;
    this.frameId = requestAnimationFrame(this.draw);
    // Embedded/occluded Electron windows can withhold rAF indefinitely. One bounded
    // backstop paints on demand; it is not a perpetual background animation loop.
    this.frameTimer = setTimeout(this.draw, this.settings.frameBackstopMs);
  }
  /** Advance bounded animations; returns true while another frame is needed. */
  private animate(now: number) {
    let more = false;
    if (this.flight) {
      const f = this.flight, t = Math.min(1, (now - f.start) / f.ms), e = easeInOut(t);
      this.camera.x = f.from.x + (f.to.x - f.from.x) * e; this.camera.y = f.from.y + (f.to.y - f.from.y) * e;
      this.camera.ratio = Math.exp(Math.log(f.from.ratio) + (Math.log(f.to.ratio) - Math.log(f.from.ratio)) * e);
      if (t >= 1) this.flight = undefined; else more = true;
    }
    if (this.focusLevel !== this.focusTarget) {
      const step = (now - this.focusAt) / (reducedMotion() ? 1 : 140); this.focusAt = now;
      this.focusLevel = this.focusTarget > this.focusLevel ? Math.min(1, this.focusLevel + step) : Math.max(0, this.focusLevel - step);
      if (this.focusLevel === 0 && this.focusTarget === 0) this.focusNode = -1;
      more ||= this.focusLevel !== this.focusTarget;
    }
    return more;
  }
  private draw = () => {
    cancelAnimationFrame(this.frameId); clearTimeout(this.frameTimer); this.frameTimer = undefined;
    this.frameId = 0; if (this.disposed || this.lost || !this.ready) return;
    const drawStart = performance.now(), more = this.animate(drawStart);
    const gl = this.gl, p = this.theme.palette;
    if (!gl) { this.drawCanvas(); this.placeOverlay(); if (more) this.refresh(); return; }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(p[8]! / 255, p[9]! / 255, p[10]! / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const lod = labelLOD(this.camera.ratio), v = this.settings.visuals, policy = this.policy, fade = labelFade(this.settings.nodeSize, this.settings.labelRenderedSizeThreshold, this.camera.ratio, LABEL_RATIOS, v.labelFade);
    const zoom = this.camera.ratio / this.homeRatio, notes = this.carrierLevel(zoom);
    const nodeSize = this.settings.nodeSize * densityScale(this.width, this.height, this.visibleNodes - this.visibleCarriers * (1 - notes.visibility), zoom, this.settings.nodeSize);
    const focus = v.hoverHighlight ? this.focusLevel : 0, haloAlpha = v.haloOpacity * Math.min(1, Math.max(0, (this.camera.ratio - .06) / .25));
    // Halos (under), edges, edge notes, other nodes, collapsed hubs, labels.
    const passes: [number, number, number, number?][] = [];
    if (policy.halos && haloAlpha > .002 && this.discData[0]!.length) passes.push([3, 2, 0]);
    passes.push([0, 0, 0]);
    if (this.visibleCarriers) passes.push([1, 1, 0, 0]);
    passes.push([1, 1, 0, 1]);
    if (this.discData[1]!.length) passes.push([3, 3, 1]);
    if (this.atlas && fade.alpha > .004) passes.push([2, -1, 0]);
    for (const [i, vaoIndex, hub, layer = 1] of passes) {
      const program = this.programs[i]!, u = program.uniforms;
      gl.useProgram(program.handle); gl.uniform1i(u.positions!, 0); gl.uniform1i(u.palette!, 1); gl.uniform1i(u.atlas!, 2); gl.uniform1i(u.nodeColors!, 3); gl.uniform1i(u.nodeState!, 4); gl.uniform1i(u.positionWidth!, this.positionWidth);
      gl.uniform2f(u.center!, this.centerX, this.centerY); gl.uniform2f(u.viewport!, this.width, this.height); gl.uniform1f(u.scale!, this.scale); gl.uniform1f(u.nodeSize!, nodeSize); gl.uniform1f(u.edgeSize!, this.settings.edgeSize); gl.uniform1i(u.hovered!, this.hovered); gl.uniform1i(u.selected!, this.selected); gl.uniform1i(u.edgeHovered!, this.hoveredEdge);
      gl.uniform1f(u.focus!, focus); gl.uniform1i(u.focusNode!, this.focusNode); gl.uniform1f(u.dim!, v.dimOpacity); gl.uniform1f(u.additive!, policy.additive ? 1 : 0); gl.uniform1f(u.glow!, layer ? policy.glow : 0);
      gl.uniform1f(u.carrierAlpha!, notes.alpha); gl.uniform1f(u.carrierFold!, notes.visibility); gl.uniform1f(u.carrierSize!, v.carrierSize); gl.uniform1i(u.layer!, layer);
      gl.uniform1i(u.segments!, policy.segments); gl.uniform1f(u.curvature!, policy.curves ? v.curvature : 0); gl.uniform1f(u.edgeAlpha!, edgeAlpha(v, this.visibleEdges, zoom, policy.additive)); gl.uniform1f(u.direction!, v.edgeDirection ? 1 : 0); gl.uniform1f(u.colorMix!, v.edgeColorMix);
      gl.uniform1f(u.labelAlpha!, fade.alpha); gl.uniform1f(u.labelCut!, fade.cut); gl.uniform3f(u.outline!, p[8]! / 255, p[9]! / 255, p[10]! / 255); gl.uniform2f(u.texel!, 1 / 2048, 1 / 2048); gl.uniform1f(u.discAlpha!, hub ? 1 : haloAlpha); gl.uniform1f(u.hub!, hub);
      gl.bindVertexArray(vaoIndex < 0 ? this.labelVaos[lod]! : this.vaos[vaoIndex]!);
      if (i === 0) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6 * policy.segments, this.projection.source.length);
      else if (i === 1) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.visible.length);
      else if (i === 2) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.atlas!.levels[lod]!.length / 10);
      else gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.discData[hub]!.length / 8);
    }
    gl.bindVertexArray(null); this.placeOverlay(); this.timings.maxDraw = Math.max(this.timings.maxDraw || 0, performance.now() - drawStart);
    if (more) this.refresh();
  };
  /** DOM text for the hovered note and collapsed groups only: bounded, text-only. */
  private placeOverlay() {
    const node = this.hovered;
    if (node >= 0) { const s = this.screenPoint(node), r = this.settings.nodeSize * this.sizes[node]!; this.hoverLabel.textContent = this.path(node).split('/').pop()!.replace(/\.md$/, ''); this.hoverLabel.style.transform = `translate(${Math.round(s.x + r + 6)}px, ${Math.round(s.y - 10)}px)`; }
    else this.hoverLabel.textContent = '';
    // Greedy vertical nudge keeps coincident hub labels legible (hubs are bounded).
    const placed: [number, number, number][] = [];
    this.hubLabels.forEach((el, i) => {
      const h = this.hubs[i]!, x = (h.x - this.centerX) * this.scale + this.width / 2, half = el.offsetWidth / 2 || 40, line = el.offsetHeight || 18;
      let y = (h.y - this.centerY) * this.scale + this.height / 2 + h.radius + 4;
      for (let k = 0; k < placed.length; k++) { const [px, py, ph] = placed[k]!; if (Math.abs(px - x) < half + ph && Math.abs(py - y) < line) { y = py + line + 2; k = -1; } }
      placed.push([x, y, half]); el.style.transform = `translate(-50%, 0) translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    });
  }
  private drawCanvas() {
    const ctx = this.ctx!, s = this.settings, c = this.colorBytes, focus = s.visuals.hoverHighlight ? this.focusLevel : 0, dim = 1 - (1 - s.visuals.dimOpacity) * focus;
    const x = (n: number) => (this.display[n * 2]! - this.centerX) * this.scale + this.width / 2, y = (n: number) => (this.display[n * 2 + 1]! - this.centerY) * this.scale + this.height / 2;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.fillStyle = this.theme.background; ctx.fillRect(0, 0, this.width, this.height); ctx.strokeStyle = this.theme.edge; ctx.lineWidth = s.edgeSize;
    ctx.globalAlpha = dim; ctx.beginPath();
    for (const e of this.canvasEdges) { const a = this.projection.source[e]!, b = this.projection.target[e]!; if (!this.edgeOn[e] || !this.filterVisible[a] || !this.filterVisible[b]) continue; ctx.moveTo(x(a), y(a)); ctx.lineTo(x(b), y(b)); } ctx.stroke();
    const notes = this.projection.carrierNodes, level = this.carrierLevel();
    // Edge notes first (beneath), then the other nodes.
    for (const layer of [1, 0]) for (let n = 0; n < this.visible.length; n++) if (this.visible[n] && +!!notes[n] === layer) {
      const hot = n === this.selected || n === this.hovered, k = n * 4, p = this.theme.palette, a = layer ? (hot ? level.visibility : level.alpha * c[k + 3]! / 255) : 1;
      if (a < .004) continue;
      ctx.globalAlpha = a * (hot || this.stateBytes[k + 1] || !focus ? 1 : dim);
      ctx.fillStyle = hot ? `rgb(${p[16]},${p[17]},${p[18]})` : `rgb(${c[k]},${c[k + 1]},${c[k + 2]})`; ctx.beginPath(); ctx.arc(x(n), y(n), s.nodeSize * this.sizes[n]! * (layer ? s.visuals.carrierSize : 1) + (hot ? 2 : 0), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const h of this.hubs) { ctx.fillStyle = this.groupColor(h.group); ctx.beginPath(); ctx.arc((h.x - this.centerX) * this.scale + this.width / 2, (h.y - this.centerY) * this.scale + this.height / 2, h.radius, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = `${s.labelSize}px ${this.theme.font}`; ctx.fillStyle = this.theme.text;
    if (this.atlas && s.nodeSize >= s.labelRenderedSizeThreshold * Math.sqrt(this.camera.ratio)) for (const n of this.atlas.nodes[labelLOD(this.camera.ratio)]!) { const path = this.path(n); ctx.fillText(path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '').slice(0, 128), x(n) + s.nodeSize + 4, y(n)); }
  }
  private pointerDown = (e: PointerEvent) => { if (this.disposed || this.lost) return; this.flight = undefined; this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.canvas.setPointerCapture(e.pointerId); this.downX = e.clientX; this.downY = e.clientY; this.moved = this.pointers.size > 1; };
  private pointerMove = (e: PointerEvent) => {
    if (this.disposed || this.lost) return;
    const old = this.pointers.get(e.pointerId);
    if (old) {
      const dx = e.clientX - old.x, dy = e.clientY - old.y;
      if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 3) this.moved = true;
      if (this.pointers.size === 2) { for (const [id, other] of this.pointers) if (id !== e.pointerId) { const before = Math.hypot(old.x - other.x, old.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y); if (before > 0 && after > 0) this.setCamera(this.camera.x, this.camera.y, this.camera.ratio * before / after); } }
      else this.setCamera(this.camera.x - dx / this.scale / this.grid.width, this.camera.y - dy / this.scale / this.grid.height, this.camera.ratio);
      old.x = e.clientX; old.y = e.clientY; return;
    }
    const rect = this.canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    const hub = this.pickHub(x, y), node = hub >= 0 ? -1 : this.pick(x, y), edge = node < 0 && hub < 0 ? this.pickEdge(x, y) : -1;
    if (node === this.hovered && edge === this.hoveredEdge) return;
    this.hovered = node; this.hoveredEdge = edge; if (this.settings.visuals.hoverHighlight) this.setFocus(node);
    this.container.title = hub >= 0 ? `${this.view.groupLabels?.[hub] ?? ''} (collapsed) — click to expand` : node >= 0 ? this.path(node) : edge >= 0 ? `${this.path(this.projection.source[edge]!)} → ${this.path(this.projection.target[edge]!)} [${this.projection.types[this.projection.type[edge]!]!}]` : '';
    this.canvas.style.cursor = node >= 0 || hub >= 0 ? 'pointer' : 'grab'; this.refresh();
  };
  private pointerUp = (e: PointerEvent) => {
    if (this.disposed || this.lost) return;
    const had = this.pointers.delete(e.pointerId); if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (had && !this.moved) {
      const rect = this.canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top, hub = this.pickHub(x, y);
      if (hub >= 0) { this.onHub?.(hub); return; }
      const node = this.pick(x, y); if (node >= 0) { this.selected = node; this.refresh(); this.onNode(node); }
    }
  };
  private pointerCancel = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.moved = true; };
  private pointerLeave = () => { if (!this.pointers.size) { this.hovered = this.hoveredEdge = -1; this.setFocus(-1); this.container.title = ''; this.refresh(); } };
  private wheel = (e: WheelEvent) => {
    e.preventDefault(); if (this.disposed || this.lost) return; this.flight = undefined; const rect = this.canvas.getBoundingClientRect(), x = e.clientX - rect.left - this.width / 2, y = e.clientY - rect.top - this.height / 2, before = this.scale;
    this.camera.ratio = this.clampRatio(this.camera.ratio * Math.exp(Math.max(-1, Math.min(1, e.deltaY * .001))));
    this.camera.x += (x / before - x / this.scale) / this.grid.width; this.camera.y += (y / before - y / this.scale) / this.grid.height; this.refresh(); if (this.camera.ratio >= this.settings.lodZoomRatio) this.onZoomOut();
  };
  private contextLost = (e: Event) => {
    e.preventDefault(); if (this.disposed) return; this.lost = true; this.ready = false; this.pointers.clear(); this.container.title = ''; this.canvas.style.cursor = 'wait';
    cancelAnimationFrame(this.frameId); clearTimeout(this.frameTimer); this.frameTimer = undefined; this.frameId = 0; this.canvas.dataset.context = 'lost';
    clearTimeout(this.restoreTimer); this.restoreTimer = setTimeout(() => { if (!this.disposed && this.lost) { this.canvas.dataset.context = 'failed'; this.onUnavailable(); } }, this.settings.contextRestoreTimeoutMs);
  };
  private contextRestored = () => {
    if (this.disposed) return; clearTimeout(this.restoreTimer); this.restoreTimer = undefined; this.canvas.style.cursor = 'grab';
    this.lost = false; this.programs = []; this.vaos = []; this.buffers = []; this.textures = []; this.labelBuffers = []; this.labelVaos = []; this.discBuffers = [null, null];
    void this.initialize().then(() => { if (!this.disposed && !this.lost) this.canvas.dataset.context = 'restored'; }).catch(() => { if (!this.disposed) { this.canvas.dataset.context = 'failed'; this.onUnavailable(); } });
  };
  dispose() {
    if (this.disposed) return; this.disposed = true; this.labelsRevision++; clearTimeout(this.restoreTimer); this.restoreTimer = undefined; cancelAnimationFrame(this.frameId); clearTimeout(this.frameTimer); this.frameTimer = undefined; this.observer.disconnect(); this.media.removeEventListener('change', this.refreshTheme);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored); this.canvas.removeEventListener('pointerdown', this.pointerDown); this.canvas.removeEventListener('pointermove', this.pointerMove); this.canvas.removeEventListener('pointerup', this.pointerUp); this.canvas.removeEventListener('pointercancel', this.pointerCancel); this.canvas.removeEventListener('pointerleave', this.pointerLeave); this.canvas.removeEventListener('wheel', this.wheel);
    const gl = this.gl; if (gl && !this.lost) { for (const p of this.programs) gl.deleteProgram(p.handle); for (const b of [...this.buffers, ...this.labelBuffers, ...this.discBuffers]) if (b) gl.deleteBuffer(b); for (const v of [...this.vaos, ...this.labelVaos]) gl.deleteVertexArray(v); for (const t of this.textures) gl.deleteTexture(t); }
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.pointers.clear(); this.container.title = ''; this.canvas.remove(); this.overlay.remove();
  }
}
