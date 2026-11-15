import { renderPath, type RenderProjection } from './render-projection';
import type { Settings } from './settings';
import { PickGrid, positionTexture, incidentEdges, focusTiers, tintedEdge, edgeBucket, tierNode, tierEdge, tierLabel, segmentDistance, labelLOD, canvasDetailEdges, resizeDrawingBuffer, LABEL_RATIOS } from './render-data';
import { readTheme, type GraphTheme } from './render-theme';
import { baseRadius, sizedRadius, sizingSettings, type NodeSizingValues } from './node-sizing';
import { buildLabels, focusLabels, type LabelAtlas } from './render-labels';
import { carrierAlpha, carrierColors, carrierVisibility, categorical, degreeSizes, densityScale, edgeAlpha, effectPolicy, prominenceKeep, zoomFade, neutralizeGroups, easeInOut, groupHalos, isDark, labelFade, nodeColors, type EffectPolicy, type Halo, type RGB } from './render-effects';
import { yieldTask } from './core/scheduler';
import { generationCurrent } from './physics-controls';
/** Hard DOM bound for graduated focus labels, under `labelsMaxPerViewport`. */
const FOCUS_LABELS = 64;
export interface CoordinateToken { current(): boolean; commit(): void; rollback(): void; discard(): void }

/** Identity tag; the production build strips GLSL whitespace/comments at load time. */
const glsl = (s: TemplateStringsArray) => s[0]!;
// All shaders are constant source strings. Note text is only rasterized on Canvas2D.
// Coverage-preserving premultiplied source-over on both themes. Every emitted RGB
// contribution carries its alpha: local overdraw cannot add colors toward white.
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
uniform int focusNode;
uniform float focus;
uniform float dim;
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
out float ring;
void main() {
 int id = gl_InstanceID; vec4 st = state(id);
 bool hot = id == hovered || id == selected, note = st.a > .5;
 // Edge notes (state alpha) draw in their own pass beneath the other nodes.
 // A highlighted edge note keeps its highlight but folds with the level of detail.
 float k = note ? (hot ? carrierFold : carrierAlpha) : 1.;
 float radius = nodeSize * size * (note ? carrierSize : 1.) + (hot ? 2. : 0.);
 spread = glow > 0. ? 2.3 : 1.;
 // Graduated tiers: the focus grows 60% with an outer ring, direct notes grow 25%.
 bool ego = id == focusNode; ring = ego ? focus : 0.; if (ego) spread = max(spread, 1.4);
 radius *= 1. + focus * (ego ? .6 : st.g > .9 ? .25 : 0.); // ego
 local = corners[gl_VertexID] * spread;
 gl_Position = st.r < .5 || st.b > .5 || note != (layer == 0) || k < .004 ? offscreen : clip(point(id) + local * radius);
 vec4 c = hot ? color(4) : nodeColor(id);
 tint = vec4(c.rgb, c.a * k * (hot ? 1. : mix(1., dim, focus * (1. - st.g))));
}`;
const nodeFragment = glsl`#version 300 es
precision highp float;
uniform float glow;
in vec2 local; in vec4 tint; in float spread; in float ring; out vec4 outputColor;
void main() {
 float d = length(local); if (d > spread) discard;
 float core = 1. - smoothstep(.82, 1., d);
 float halo = glow > 0. ? glow * .4 * exp(-3.4 * max(0., d - .9)) * (1. - smoothstep(spread * .75, spread, d)) * (1. - core) : 0.;
 float rim = max(halo, ring * (smoothstep(1.1, 1.16, d) - smoothstep(1.28, 1.34, d)));
 vec3 shade = tint.rgb * (1. - .14 * smoothstep(.5, 1., d));
 outputColor = vec4((shade * core + tint.rgb * rim) * tint.a, (core + rim) * tint.a);
}`;
const edgeVertex = common + glsl`
layout(location=0) in uint source;
layout(location=1) in uint target;
layout(location=2) in uint typeOn;
layout(location=3) in uint tier;
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
 if (edgeAlpha <= 0. || typeOn == 0u || sa.r < .5 || sb.r < .5) { gl_Position = offscreen; return; }
 int segment = gl_VertexID / 6; vec2 c = corners[gl_VertexID % 6];
 float u = (float(segment) + (c.x + 1.) * .5) / float(segments);
 vec2 a = point(s), b = point(t), delta = b - a; float len = length(delta);
 vec2 normal = len > 0. ? vec2(-delta.y, delta.x) / len : vec2(0., 1.);
 vec2 q = (a + b) * .5 + normal * len * curvature;
 vec2 tangent = mix(q - a, b - q, u); float tl = length(tangent);
 vec2 side = tl > 0. ? vec2(-tangent.y, tangent.x) / tl : normal;
 float wide = max(.5, edgeSize) * (1. + focus * (tier > 200u ? .6 : 0.));
 gl_Position = clip(mix(mix(a, q, u), mix(q, b, u), u) + side * c.y * wide);
 vec3 rgb = mix(color(1).rgb, mix(nodeColor(s).rgb, nodeColor(t).rgb, u), colorMix);
 float alpha = edgeAlpha * (direction > .5 ? mix(.12, 1., u) : 1.);
 if (focus > 0.) alpha = mix(alpha, tier > 200u ? min(1., alpha * 3.) : tier > 0u ? alpha : alpha * dim * .6, focus);
 if (tier == 254u || tier == 127u) rgb = mix(rgb, color(4).rgb, focus * .5);
 if (gl_InstanceID == edgeHovered) { rgb = color(4).rgb; alpha = min(1., alpha * 3.); }
 tint = vec4(rgb * alpha, alpha);
}`;
const solidFragment = glsl`#version 300 es
precision highp float; in vec4 tint; out vec4 outputColor;
void main() { outputColor = tint; }`;
const labelVertex = common + glsl`
layout(location=0) in vec4 a;
layout(location=1) in vec4 b;
layout(location=2) in vec3 extra;
uniform float labelAlpha;
uniform float labelCut;
out vec2 uv;
out vec4 tint;
void main() { vec2 q = (corners[gl_VertexID] + 1.) * .5; int id = int(a.x); vec4 st = state(id);
 float alpha = labelAlpha * smoothstep(labelCut, labelCut + .15, extra.y);
 alpha = mix(alpha, st.g > .1 ? 0. : alpha * dim * .5, focus);
 gl_Position = st.r < .5 || st.b > .5 || alpha <= .004 ? offscreen : clip(point(id) + a.yz + vec2(extra.z * nodeSize, 0.) + q * vec2(a.w, b.x));
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
const UNIFORMS = ['positions', 'palette', 'nodeColors', 'nodeState', 'positionWidth', 'center', 'viewport', 'scale', 'nodeSize', 'hovered', 'selected', 'focusNode', 'focus', 'dim', 'glow', 'edgeSize', 'edgeHovered', 'segments', 'curvature', 'edgeAlpha', 'direction', 'colorMix', 'labelAlpha', 'labelCut', 'atlas', 'outline', 'texel', 'discAlpha', 'hub', 'carrierAlpha', 'carrierFold', 'carrierSize', 'layer'];
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
  grid: PickGrid;
  private cameraFrame: Pick<PickGrid, 'minX' | 'minY' | 'width' | 'height'>;
  private coordinateRevision = 0;
  private lastPointer?: { clientX: number; clientY: number };
  readonly camera: Camera = { x: .5, y: .5, ratio: 1 };
  readonly gpu: boolean;
  hovered = -1;
  selected = -1;
  hoveredEdge = -1;
  /** Selected relationship rows: the picked edge first, then parallels between the same pair. */
  selectedEdges: number[] = [];
  /** Host seams: worker-side rule names and relationship-note paths, and opening a path. */
  describeEdges?: (edges: number[]) => Promise<{ rule?: string; carrier?: string }[]>;
  openPath?: (path: string) => void;
  private edgeAnchor = -1;
  private edgeToken = 0;
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
  /** Per-edge focus tier bytes (255 direct, 128 context, 0 rest), uploaded as edge attribute 3. */
  private edgeTier: Uint8Array;
  private tierEdges: number[] = [];
  private tierPartial = 0;
  private visibleEdges = 0;
  private visibleNodes = 0;
  /** Edge notes (reified edges drawn as nodes): total and render-visible. */
  readonly carrierCount: number;
  private visibleCarriers = 0;
  private near: number[] = [];
  private focusNode = -1;
  private tierSource: number | number[] = -1;
  private focusLevel = 0;
  private focusTarget = 0;
  private focusAt = 0;
  private flight?: { from: Camera; to: Camera; start: number; ms: number };
  private halos: Halo[] = [];
  private hubs: Hub[] = [];
  private discData: Float32Array[] = [new Float32Array(), new Float32Array()];
  private overlay: HTMLElement;
  private hoverLabel: HTMLElement;
  /** Touch/keyboard selection card: text-only note name and an explicit Open button. */
  private noteCard: HTMLElement;
  private hubLabels: HTMLElement[] = [];
  /** Graduated focus labels: placed [node, rank] pairs, their DOM text and the LOD they were placed at. */
  private ranked: (readonly [number, number])[] = [];
  private tierLabels: HTMLElement[] = [];
  private rankedLod = -1;
  static async create(container: HTMLElement, p: RenderProjection, positions: Float32Array, visible: Uint8Array, settings: Settings, onNode: (i: number) => void, onZoomOut: () => void, colors: Uint32Array, current = () => true, software = false, onUnavailable = onZoomOut, view: RenderView = {}) {
    await yieldTask(); if (!current()) throw new Error('Renderer superseded');
    let renderer: DetailRenderer | undefined;
    try {
      renderer = new DetailRenderer(container, p, positions, visible, settings, onNode, onZoomOut, colors, software, onUnavailable, view);
      await renderer.initialize();
      if (!current()) throw new Error('Renderer superseded');
      await renderer.prepareLabels(current);
      if (!current()) throw new Error('Renderer superseded');
      renderer.refresh(); return renderer;
    } catch (error) {
      if (renderer) renderer.dispose();
      else for (const canvas of container.querySelectorAll('canvas')) { canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); canvas.remove(); }
      throw error;
    }
  }
  constructor(private container: HTMLElement, readonly projection: RenderProjection, public positions: Float32Array, visible: Uint8Array, private settings: Settings, private onNode: (i: number) => void, private onZoomOut: () => void, colors: Uint32Array, software = false, private onUnavailable = onZoomOut, view: RenderView = {}) {
    let started = performance.now();
    this.grid = new PickGrid(positions, visible);
    const { minX, minY, width, height } = this.grid; this.cameraFrame = { minX, minY, width, height };
    this.edges = incidentEdges(projection);
    this.filterVisible = visible; this.visible = visible; this.picker = this.grid; this.display = positions; this.colors = colors;
    this.carrierCount = projection.carrierNodes.reduce((n, v) => n + +!!v, 0);
    this.labelCarrierSize = settings.visuals.carrierSize;
    this.keep = 1; this.sizes = degreeSizes(projection.offsets, settings.visuals.degreeSizing, settings.visuals.degreeCurve); this.edgeOn = new Uint8Array(projection.source.length).fill(1); this.edgeTier = new Uint8Array(projection.source.length);
    this.timings.grid = performance.now() - started; started = performance.now();
    this.theme = readTheme(container, settings);
    this.timings.theme = performance.now() - started; started = performance.now();
    this.canvas = document.createElement('canvas'); this.canvas.className = 'graph-ng-detail'; this.canvas.setAttribute('aria-label', 'Graph notes. Arrows select, Enter opens, R cycles relationships, Escape clears.'); this.canvas.tabIndex = 0; this.canvas.style.touchAction = 'none'; container.append(this.canvas);
    this.overlay = container.createDiv ? container.createDiv({ cls: 'graph-ng-overlay' }) : container.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-overlay' }));
    this.hoverLabel = this.overlay.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-hover-label' }));
    this.noteCard = this.overlay.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-card', onkeydown: this.keyDown, ariaLive: 'polite' }));
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
    this.canvas.addEventListener('pointerdown', this.pointerDown); this.canvas.addEventListener('pointermove', this.pointerMove); this.canvas.addEventListener('pointerup', this.pointerUp); this.canvas.addEventListener('pointercancel', this.pointerCancel); this.canvas.addEventListener('pointerleave', this.pointerLeave); this.canvas.addEventListener('keydown', this.keyDown); this.canvas.addEventListener('wheel', this.wheel, { passive: false });
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
    // Software detail stays inside both refusal budgets: refuse before any state changes, never truncate.
    const canvasEdges = !this.gl && this.ctx ? canvasDetailEdges(p, filterVisible, this.settings.canvasMaxDetailNodes, this.settings.canvasMaxDetailEdges) : undefined;
    const visibleChanged = filterVisible !== this.filterVisible || view.collapsed !== this.view.collapsed || view.groupCodes !== this.view.groupCodes;
    this.filterVisible = filterVisible; this.view = view; this.groupCount = view.groupLabels?.length ?? 0; if (view.colors && view.colors.length === filterVisible.length) this.colors = view.colors;
    Object.assign(this, this.coordinateState(this.positions, filterVisible, view));
    const render = this.visible;
    const hiddenTypes = view.typeHidden; this.visibleEdges = 0;
    for (let e = 0; e < p.source.length; e++) { const on = hiddenTypes?.[p.type[e]!] ? 0 : 1; this.edgeOn[e] = on; if (on && filterVisible[p.source[e]!] && filterVisible[p.target[e]!]) this.visibleEdges++; }
    this.visibleNodes = this.visibleCarriers = 0; const notes = p.carrierNodes;
    for (let i = 0; i < n; i++) { const o = i * 4; this.stateBytes[o] = filterVisible[i] ? 255 : 0; this.stateBytes[o + 2] = filterVisible[i] && !render[i] ? 255 : 0; this.stateBytes[o + 3] = notes[i] ? 255 : 0; if (render[i]) { this.visibleNodes++; if (notes[i]) this.visibleCarriers++; } }
    if (canvasEdges) this.canvasEdges = canvasEdges;
    if (this.selectedEdges?.length ? !this.selectedEdges.every(this.edgeDrawn) : !filterVisible[this.selected]) { this.selectedEdges = []; this.edgeToken++; this.noteCard.textContent = ''; }
    if (this.near.length || this.selected >= 0 && this.ready) this.emphasize(true);
    this.recolor(); this.choosePolicy();
    this.updateSizingRange();
    this.timings.view = performance.now() - started;
    if (!upload) return;
    if (this.gl && this.ready && !this.lost) this.uploadView();
    if (visibleChanged && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {});
    this.refresh();
  }
  /** Pure coordinate derivation shared by ordinary view updates and transactional preparation. */
  private coordinateState(positions: Float32Array, filterVisible: Uint8Array, view: RenderView) {
    const n = filterVisible.length, count = view.groupLabels?.length ?? 0;
    const grid = positions === this.positions && filterVisible === this.grid.visible ? this.grid : new PickGrid(positions, filterVisible);
    const codes = view.groupCodes, collapsed = view.collapsed && codes && view.collapsed.some(Boolean) ? view.collapsed : undefined;
    // Collapsed members draw no node; their edges converge on the group centroid.
    const all = codes ? groupHalos(positions, filterVisible, codes, count, count) : [];
    const hubs = collapsed ? all.filter(h => collapsed[h.group]).slice(0, this.settings.visuals.hubsMaxGroups).map(h => ({ ...h, radius: this.settings.nodeSize * Math.min(12, 2.4 + 1.1 * Math.log2(1 + h.count)) })) : [];
    const hubOf = new Int32Array(count).fill(-1); hubs.forEach((h, i) => { hubOf[h.group] = i; });
    let display = positions; const render = collapsed ? new Uint8Array(n) : filterVisible;
    if (collapsed) {
      display = positions.slice();
      for (let i = 0; i < n; i++) {
        const hub = filterVisible[i] && collapsed[codes![i]!] ? hubOf[codes![i]!]! : -1;
        if (hub >= 0) { display[i * 2] = hubs[hub]!.x; display[i * 2 + 1] = hubs[hub]!.y; } else render[i] = filterVisible[i]!;
      }
    }
    const coherent = Math.max(grid.width, grid.height) * .22;
    const halos = all.filter(h => !collapsed?.[h.group] && h.radius < coherent);
    return { grid, display, visible: render, hubs, halos, picker: render === grid.visible ? grid : new PickGrid(positions, render) };

  }
  async preparePositions(next: Float32Array, current: () => boolean): Promise<CoordinateToken> {
    const revision = ++this.coordinateRevision; ++this.labelsRevision;
    const same = generationCurrent(() => [this.coordinateRevision, this.labelsRevision, this.positions, this.view, this.filterVisible, this.theme, this.width, this.height, this.settings.nodeSize, this.settings.labelSize, this.settings.labelDensity, this.settings.labelGridCellSize, this.settings.labelsMaxPerViewport, this.settings.labelCandidateMultiplier, this.settings.visuals.hubsMaxGroups, this.settings.visuals.halosMaxGroups]);
    const valid = () => current() && this.usable && same();
    const check = () => { if (!valid()) throw new Error('Coordinate generation changed or renderer unavailable'); };
    check(); if (next.length !== this.projection.nodeCount * 2) throw new Error('RENDER_POSITION_COUNT');
    const started = performance.now();
    for (let i = 0; i < next.length; i++) {
      if (!Number.isFinite(next[i])) throw new Error('RENDER_NONFINITE_POSITION');
      if (i % 8192 === 0) { await yieldTask(); check(); }
    }
    let prepared: (ReturnType<DetailRenderer['coordinateState']> & { positions: Float32Array; atlas: LabelAtlas; discData: Float32Array[] }) | undefined;
    const geometry = this.coordinateState(next, this.filterVisible, this.view);
    await yieldTask(); check();
    const atlas = await buildLabels(this.projection, { ...this.cameraFrame, positions: next, visible: geometry.visible }, this.sizingSettings(), this.width, this.height, this.theme.font, valid);
    check();
    prepared = { ...geometry, positions: next, atlas, discData: this.discs(geometry.halos, geometry.hubs) };
    this.timings.coordinates = performance.now() - started;
    let previous: typeof prepared | undefined, committed = false;
    const upload = () => { if (this.gl) { if (!this.usable) throw new Error('GPU context unavailable'); this.uploadCoordinates(); this.uploadLabels(); if (this.gl.isContextLost() || this.gl.getError() !== this.gl.NO_ERROR) throw new Error('GPU coordinate upload failed'); } };
    const rollback = () => {
      if (!previous || revision !== this.coordinateRevision || this.disposed || (committed && this.positions !== next)) throw new Error('Coordinate rollback owner changed; recovery uncertain');
      Object.assign(this, previous); committed = false;
      try { upload(); this.refresh(); }
      catch (error) { throw new Error(`Last-good CPU coordinates retained; GPU recovery uncertain: ${error}`); }
    };
    return {
      current: () => !!prepared && !committed && valid(),
      commit: () => {
        if (!prepared || committed) throw new Error('Coordinate token already consumed'); check();
        previous = Object.fromEntries(Object.keys(prepared).map(key => [key, (this as unknown as Record<string, unknown>)[key]])) as typeof prepared;
        try {
          Object.assign(this, prepared); upload(); committed = true;
          if (this.lastPointer) this.pointerMove({ ...this.lastPointer, pointerId: -1 } as PointerEvent);
          this.refresh();
        } catch (error) {
          try { rollback(); } catch (restore) { throw new Error(`${error}; ${restore}`); }
          throw error;
        }
      },
      rollback,
      discard: () => { prepared = previous = undefined; }
    };
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
  private discs(halos: Halo[], hubs: Hub[]) {
    const fill = (h: { group: number }) => [...this.groupRgb(h.group).map(v => v / 255), 1];
    return [new Float32Array(halos.slice(0, this.settings.visuals.halosMaxGroups).flatMap(h => [h.x, h.y, h.radius * 1.7, 0, ...fill(h)])), new Float32Array(hubs.flatMap(h => [h.x, h.y, 0, h.radius, ...fill(h)]))];
  }
  private packDiscs() {
    this.discData = this.discs(this.halos, this.hubs);
    while (this.hubLabels.length > Math.min(64, this.hubs.length)) this.hubLabels.pop()!.remove();
    while (this.hubLabels.length < Math.min(64, this.hubs.length)) this.hubLabels.push(this.overlay.appendChild(Object.assign(document.createElement('div'), { className: 'graph-ng-hub-label' })));
    this.hubLabels.forEach((el, i) => { const h = this.hubs[i]!; el.textContent = `${this.view.groupLabels?.[h.group] ?? ''} (${h.count.toLocaleString()})`; });
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
      if (i === 0) { this.integer(0, this.projection.source); this.integer(1, this.projection.target); this.integer(2, this.edgeOn); this.integer(3, this.edgeTier); }
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
    this.updateSizingRange();
    const gl = this.gl!; this.uploadCoordinates(true);
    this.bytes(3, this.colorBytes); this.uploadTiers();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[2]!); gl.bufferData(gl.ARRAY_BUFFER, this.edgeOn, gl.STATIC_DRAW);
  }
  private uploadTiers() { const gl = this.gl!; this.bytes(4, this.stateBytes); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[3]!); gl.bufferData(gl.ARRAY_BUFFER, this.edgeTier, gl.STATIC_DRAW); }
  private uploadCoordinates(allocate = false) {
    const gl = this.gl!, packed = positionTexture(this.display, this.positionWidth);
    if (packed.width !== this.positionWidth || packed.height !== this.positionHeight) throw new Error('Coordinate texture size changed');
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures[0]!);
    if (allocate) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, packed.width, packed.height, 0, gl.RG, gl.FLOAT, packed.data);
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, packed.width, packed.height, gl.RG, gl.FLOAT, packed.data);
    this.uploadDiscs();
  }
  private uploadDiscs() {
    const gl = this.gl!;
    for (let i = 0; i < 2; i++) { gl.bindBuffer(gl.ARRAY_BUFFER, this.discBuffers[i]!); gl.bufferData(gl.ARRAY_BUFFER, this.discData[i]!, gl.DYNAMIC_DRAW); }
  }
  private uploadPalette() { const gl = this.gl!; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.textures[1]!); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, this.theme.palette.length / 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.theme.palette); this.paletteUploads++; }
  private async prepareLabels(current: () => boolean) {
    const revision = ++this.labelsRevision, w = this.width, h = this.height;
    const valid = () => !this.disposed && revision === this.labelsRevision && current();
    const started = performance.now();
    const atlas = await buildLabels(this.projection, { ...this.cameraFrame, positions: this.positions, visible: this.visible }, this.sizingSettings(), w, h, this.theme.font, valid);
    this.timings.labels = performance.now() - started;
    if (!valid()) return; this.atlas = atlas; if (this.gl && this.ready && !this.lost) this.uploadLabels(); this.refresh();
  }
  private uploadLabels() {
    const started = performance.now(), gl = this.gl!;
    const reuse = this.labelBuffers.length > 0;
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.textures[2]!); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); if (reuse) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas!.canvas); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas!.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (let level = 0; level < this.atlas!.levels.length; level++) {
      const data = this.atlas!.levels[level]!, vao = this.labelVaos[level] ?? gl.createVertexArray()!, b = this.labelBuffers[level] ?? gl.createBuffer()!; this.labelVaos[level] = vao; this.labelBuffers[level] = b; gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, i === 2 ? 3 : 4, gl.FLOAT, false, 44, i * 16); gl.vertexAttribDivisor(i, 1); }
    }
    gl.bindVertexArray(null); this.timings.labelUpload = performance.now() - started;
  }
  refreshTheme = () => {
    if (this.disposed) return;
    const font = this.theme.font; this.theme = readTheme(this.container, this.settings);
    this.recolor(); this.choosePolicy(); this.updateSizingRange();
    if (this.gl && this.ready && !this.lost) { this.uploadPalette(); this.bytes(3, this.colorBytes); this.uploadDiscs(); }
    if (font !== this.theme.font && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {});
    this.refresh();
  };
  /** Live display knobs: degree sizes may change; everything else is a uniform. */
  private nodePreview?: NodeSizingValues;
  private sizingTimer?: ReturnType<typeof setTimeout>;
  private labelCarrierSize = 0;
  onSizingChange?: () => void;
  private sizingSettings() { return this.nodePreview ? { ...this.settings, nodeSize: this.nodePreview.radius, visuals: { ...this.settings.visuals, degreeSizing: this.nodePreview.prominence - 1, degreeCurve: this.nodePreview.curve }, nodeSizing: { policy: 'predictable' as const, compensation: this.nodePreview.compensation, floor: this.nodePreview.floor } } : this.settings; }
  previewSizing(values: NodeSizingValues | null, force = false) {
    if (this.disposed || (!force && !values && !this.nodePreview)) return;
    if (values) sizingSettings(this.settings, values);
    this.nodePreview = values ?? undefined; this.refreshVisuals(false); this.queueSizingLabels();
    this.onSizingChange?.();
  }
  private queueSizingLabels() {
    this.labelsRevision++; this.atlas = undefined;
    clearTimeout(this.sizingTimer);
    this.sizingTimer = setTimeout(() => { this.sizingTimer = undefined; if (!this.disposed) void this.prepareLabels(() => !this.disposed).catch(() => {}); }, 160);
  }
  private baseNodeRadius() {
    const notes = this.carrierLevel(), s = this.sizingSettings();
    return baseRadius(s, this.width, this.height, this.visibleNodes - this.visibleCarriers * (1 - notes.visibility), this.camera.ratio / this.homeRatio, !this.gl);
  }
  private nodeRadius(node: number, hot = false) { return sizedRadius(this.baseNodeRadius(), this.sizes[node]!, this.projection.carrierNodes[node] ? this.settings.visuals.carrierSize : 1, hot); }
  private sizingRange: [number, number] = [0, 0];
  private updateSizingRange() {
    let lo = Infinity, hi = 0;
    for (let i = 0; i < this.visible.length; i++) if (this.visible[i] && !this.projection.carrierNodes[i]) { lo = Math.min(lo, this.sizes[i]!); hi = Math.max(hi, this.sizes[i]!); }
    this.sizingRange = [lo, hi];
  }
  sizingReadout() {
    const [lo, hi] = this.sizingRange, b = this.baseNodeRadius();
    return hi ? `Ordinary unhighlighted radius: ${(b * lo).toFixed(2)}–${(b * hi).toFixed(2)} CSS px at this zoom${this.nodePreview ? ' (preview, unsaved)' : ''}` : 'No ordinary nodes shown';
  }
  private savedSettings?: Settings;
  /** Unsaved whole-settings candidate (suggestions); null restores the live settings object and
   * redraws from it. */
  previewSettings(next: Settings | null) {
    this.savedSettings ??= this.settings; this.settings = next ?? this.savedSettings;
    if (!next) this.savedSettings = undefined;
    this.refreshVisuals(true);
  }
  refreshVisuals(labels = false) {
    if (this.disposed) return;
    const carrierChanged = this.labelCarrierSize !== this.settings.visuals.carrierSize;
    this.labelCarrierSize = this.settings.visuals.carrierSize;
    const rebuildCarrier = carrierChanged && this.sizingSettings().nodeSizing?.policy === 'predictable';
    if (rebuildCarrier) this.queueSizingLabels();
    this.uploadSizes(); this.recolor(); this.choosePolicy(); if (this.ready) this.emphasize(true);
    if (this.gl && this.ready && !this.lost) this.uploadView();
    if (labels && !rebuildCarrier && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {});
    this.refresh();
  }
  /** Cached degree sizes at the current "Adapt to zoom" prominence step; drawing, picking and
   * label offsets all read these. O(n) only when the step or sizing changes, never per frame. */
  private keep = 1;
  private uploadSizes() {
    const sv = this.sizingSettings().visuals; this.sizes = degreeSizes(this.projection.offsets, sv.degreeSizing * this.keep, sv.degreeCurve, this.sizes); this.updateSizingRange();
    if (this.gl && this.ready && !this.lost) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[4]!); gl.bufferData(gl.ARRAY_BUFFER, this.sizes, gl.STATIC_DRAW); }
  }
  private adaptSizes(zoom: number) {
    const s = this.sizingSettings(), keep = prominenceKeep(zoom, s.visuals.zoomAdapt && densityScale(this.width, this.height, this.visibleNodes, zoom, s.nodeSize, 0) < 1);
    if (keep !== this.keep) { this.keep = keep; this.uploadSizes(); }
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
    this.fit = Math.min(this.width / (this.cameraFrame.width * 1.1), this.height / (this.cameraFrame.height * 1.1)); this.refresh(); return changed;
  }
  private get scale() { return this.fit / this.camera.ratio; }
  private get centerX() { return this.cameraFrame.minX + this.camera.x * this.cameraFrame.width; }
  private get centerY() { return this.cameraFrame.minY + this.camera.y * this.cameraFrame.height; }
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
    const w = Math.max(maxX - minX, this.cameraFrame.width * .02), h = Math.max(maxY - minY, this.cameraFrame.height * .02);
    const ratio = Math.max(w * 1.25 * this.fit / this.width, h * 1.25 * this.fit / this.height);
    this.flyTo(((minX + maxX) / 2 - this.cameraFrame.minX) / this.cameraFrame.width, ((minY + maxY) / 2 - this.cameraFrame.minY) / this.cameraFrame.height, ratio, ms);
    return ratio;
  }
  frameGroup(group: number, ms?: number) {
    const codes = this.view.groupCodes; if (!codes) return;
    let x = Infinity, y = Infinity, xx = -Infinity, yy = -Infinity;
    for (let i = 0; i < codes.length; i++) if (codes[i] === group && this.filterVisible[i]) { const a = this.positions[i * 2]!, b = this.positions[i * 2 + 1]!; x = Math.min(x, a); y = Math.min(y, b); xx = Math.max(xx, a); yy = Math.max(yy, b); }
    if (x !== Infinity) this.frame(x, y, xx, yy, ms);
  }
  /** Frame the 1st–99th percentile of visible nodes so a few isolated outliers do not shrink the web;
   * fewer than 8 nodes are framed exactly. Only an empty view falls back to the preserved frame. */
  fitAll(ms?: number) {
    const xs: number[] = [], ys: number[] = [], step = Math.max(1, Math.floor(this.visible.length / 8192));
    for (let i = 0; i < this.visible.length; i += step) if (this.visible[i]) { xs.push(this.display[i * 2]!); ys.push(this.display[i * 2 + 1]!); }
    for (const h of this.hubs) { xs.push(h.x); ys.push(h.y); }
    if (!xs.length) { this.homeRatio = 1; this.flyTo(.5, .5, 1, ms); return; }
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(a.length * f))]!, t = xs.length < 8 ? 0 : .01;
    this.homeRatio = this.clampRatio(this.frame(q(xs, t), q(ys, t), q(xs, 1 - t), q(ys, 1 - t), ms));
  }
  /** Test/host seam; not a second graph or renderer object model. */
  path(id: number) { return renderPath(this.projection, id); }
  private name(n: number) { const path = this.path(n); return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '').slice(0, 128); }
  screenPoint(id: number) { return { x: (this.display[id * 2]! - this.centerX) * this.scale + this.width / 2, y: (this.display[id * 2 + 1]! - this.centerY) * this.scale + this.height / 2 }; }
  private worldPoint(x: number, y: number) { return { x: (x - this.width / 2) / this.scale + this.centerX, y: (y - this.height / 2) / this.scale + this.centerY }; }
  /** Edge-note level of detail at this zoom: LOD visibility and the drawn alpha. */
  carrierLevel(zoom = this.camera.ratio / this.homeRatio) { const v = this.settings.visuals; return { visibility: carrierVisibility(zoom, v.carrierLodNear, v.carrierLodFar, v.carrierLod), alpha: carrierAlpha(v, this.visibleCarriers, zoom) }; }
  /** Edge notes folded away by the level of detail are not pickable. */
  pick(x: number, y: number) {
    const w = this.worldPoint(x, y), s = this.sizingSettings();
    // The graduated focus grows 60% (direct notes 25%): hit targets follow the drawn size.
    const f = s.visuals.hoverHighlight ? this.focusLevel : 0, grow = (n: number) => tierNode(this.stateBytes[n * 4 + 1]! / 255, true, n === this.focusNode, f, 0)[1];
    if (s.nodeSizing.policy === 'legacy') return this.picker.pick(w.x, w.y, (s.nodeSize * (1 + s.visuals.degreeSizing) * (1 + .6 * f) + 4) / this.scale, this.carrierCount && this.carrierLevel().visibility < .25 ? this.projection.carrierNodes : undefined);
    const base = this.baseNodeRadius(), max = (base * (1 + s.visuals.degreeSizing) * Math.max(1, s.visuals.carrierSize) * (1 + .6 * f) + 6) / this.scale;
    let picked = -1, distance = Infinity;
    this.picker.visit(w.x, w.y, max, node => {
      if (!this.visible[node] || (this.projection.carrierNodes[node] && this.carrierLevel().visibility < .25)) return;
      const p = this.screenPoint(node), d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d <= (this.nodeRadius(node, node === this.selected || node === this.hovered) * grow(node) + 4) ** 2 && d < distance) { picked = node; distance = d; }
    }); return picked;
  }
  pickHub(x: number, y: number) {
    for (let i = this.hubs.length - 1; i >= 0; i--) { const h = this.hubs[i]!, sx = (h.x - this.centerX) * this.scale + this.width / 2, sy = (h.y - this.centerY) * this.scale + this.height / 2; if (Math.hypot(sx - x, sy - y) <= h.radius + 3) return h.group; }
    return -1;
  }
  private pickEdge(x: number, y: number) {
    const w = this.worldPoint(x, y), radius = this.grid.cell, p = this.projection;
    let best = -1, distance = this.settings.groupEdgeHitRadius / this.scale, budget = 32768;
    // Deliberately budgeted incident-edge picking, not an O(m) all-segment scan or GPU readback.
    this.picker.visit(w.x, w.y, radius, node => {
      for (let j = this.edges.offsets[node]!; j < this.edges.offsets[node + 1]! && budget-- > 0; j++) { const e = this.edges.edges[j]!, a = p.source[e]!, b = p.target[e]!; if (!this.edgeDrawn(e)) continue;
        const d = segmentDistance(w.x, w.y, this.display[a * 2]!, this.display[a * 2 + 1]!, this.display[b * 2]!, this.display[b * 2 + 1]!); if (d < distance) { best = e; distance = d; }
      }
    }); return best;
  }
  private edgeDrawn = (e: number) => !!this.edgeOn[e] && !!this.filterVisible[this.projection.source[e]!] && !!this.filterVisible[this.projection.target[e]!];
  /** Drawn rows between the picked edge's endpoints, either direction, picked edge first (bounded). */
  private edgeParallels(e: number) {
    const p = this.projection, a = p.source[e]!, b = p.target[e]!, out = [e];
    for (let j = this.edges.offsets[a]!; j < this.edges.offsets[a + 1]! && out.length < 32; j++) { const f = this.edges.edges[j]!; if ((p.source[f] === a ? p.target[f] : p.source[f]) === b && this.edgeDrawn(f) && !out.includes(f)) out.push(f); }
    return out;
  }
  /** Graduated tiers from one CPU authority for WebGL and Canvas, recomputed only when the focus
   * source changes, never per frame. Old bytes are cleared by touched lists, not rescanned. */
  private setFocus(node: number, immediate = false, edges?: number[]) {
    const s = this.stateBytes, t = this.edgeTier, key = edges ?? node;
    if (key !== this.tierSource || immediate) {
      for (const i of this.near) s[i * 4 + 1] = 0;
      for (const e of this.tierEdges) t[e] = 0;
      this.near = []; this.tierEdges = []; this.tierSource = key; this.focusNode = edges ? -1 : node; this.rankedLod = -1; this.tierPartial = 0;
      // A selected relationship lights its rows and both endpoints as direct tiers, without a focus ring.
      if (edges) for (const e of edges) { t[e] = 255; this.tierEdges.push(e); for (const n of [this.projection.source[e]!, this.projection.target[e]!]) if (!s[n * 4 + 1]) { s[n * 4 + 1] = 255; this.near.push(n); } }
      else this.tierPartial = focusTiers(node, this.edges, this.projection, this.edgeOn, this.filterVisible, s, t, this.near, this.tierEdges, 65536, this.settings.declaration.groupContext ? this.view.groupCodes : undefined);
      if (this.gl && this.ready && !this.lost) this.uploadTiers();
    }
    this.focusTarget = this.near.length ? 1 : 0; this.focusAt = performance.now();
    if (immediate) this.focusLevel = this.focusTarget;
  }
  private noteCaption(n: number) { return this.path(n).split('/').pop()!.replace(/\.md$/, '') + (n === this.focusNode ? (this.tierPartial & 1 ? ' (2-hop context truncated)' : '') + (this.tierPartial & 2 ? ' (group context truncated)' : '') : ''); }
  /** Selection drives the persistent focus. Touch and keyboard selections show the card; only its
   * explicit Open button (or Enter on the canvas) opens the note. */
  private selectNote(node: number, card?: boolean) {
    const c = this.noteCard; this.selected = node; this.selectedEdges = []; this.edgeAnchor = -1; this.edgeToken++; if (card) this.hovered = -1; this.emphasize(); this.refresh(); c.textContent = '';
    if (card && node >= 0) { const b = document.createElement('button'), name = this.noteCaption(node); c.textContent = name; b.textContent = 'Open'; b.setAttribute('aria-label', 'Open ' + name); b.onclick = () => this.onNode(node); c.append(b); }
  }
  /** Hover outranks the persistent selection; the hover-highlight switch turns both off. */
  private emphasize(immediate?: boolean) { const v = this.hovered < 0 ? this.selected : this.hovered, on = this.settings.visuals.hoverHighlight; this.setFocus(on ? v : -1, immediate, on && v < 0 && this.selectedEdges?.length ? this.selectedEdges : undefined); }
  /** Select a relationship (never opens). The card lists every drawn parallel row between the pair;
   * rule names and relationship-note paths arrive from the worker and fill in when resolved. */
  private selectEdge(edge: number, anchor = -1) {
    const p = this.projection, c = this.noteCard, token = ++this.edgeToken;
    this.selected = this.hovered = -1; this.edgeAnchor = anchor; this.selectedEdges = this.edgeParallels(edge); this.emphasize(); this.refresh(); c.textContent = '';
    const el = (tag: string, text = '', cls = '') => Object.assign(document.createElement(tag), { textContent: text, className: cls });
    const button = (text: string, label: string, run: () => void) => { const b = el('button', text); b.setAttribute('aria-label', label); b.onclick = run; return b; };
    const a = p.source[edge]!, b = p.target[edge]!, box = el('div', '', 'graph-ng-relationships'), na = this.name(a), nb = this.name(b);
    box.append(el('strong', `${na} → ${nb}`));
    const rows = this.selectedEdges.map(e => { const row = el('div', '', 'graph-ng-relationship'); row.append(el('span', p.types[p.type[e]!]! + (p.source[e] !== a ? ' (reverse)' : ''))); box.append(row); return row; });
    const ends = el('div', '', 'graph-ng-relationship'); ends.append(button('Open source', 'Open source ' + na, () => this.onNode(a)), button('Open target', 'Open target ' + nb, () => this.onNode(b))); box.append(ends); c.append(box);
    this.describeEdges?.(this.selectedEdges).then(info => {
      if (token !== this.edgeToken || this.disposed) return;
      info.forEach((d, i) => { const row = rows[i]; if (!row) return; if (d.rule) row.append(el('small', 'Rule: ' + d.rule)); if (d.carrier) { const path = d.carrier; row.append(button('Open relationship note', 'Open relationship note ' + path, () => this.openPath?.(path))); } });
    }, () => { if (token === this.edgeToken && !this.disposed) box.append(el('small', 'Details unavailable')); });
  }
  /** Keyboard: step through the anchor note's drawn relationships, one stop per neighbour. O(degree). */
  private cycleEdge(step: number) {
    const anchor = this.selected >= 0 ? this.selected : this.edgeAnchor, p = this.projection; if (anchor < 0) return false;
    const stops = new Map<number, number>(), other = (e: number) => p.source[e] === anchor ? p.target[e]! : p.source[e]!;
    for (let j = this.edges.offsets[anchor]!; j < this.edges.offsets[anchor + 1]!; j++) { const e = this.edges.edges[j]!; if (this.edgeDrawn(e) && !stops.has(other(e))) stops.set(other(e), e); }
    const list = [...stops.values()]; if (!list.length) return false;
    const at = this.edgeAnchor === anchor && this.selectedEdges.length ? [...stops.keys()].indexOf(other(this.selectedEdges[0]!)) : -1;
    this.selectEdge(list[at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length]!, anchor); return true;
  }
  get usable() { return this.ready && !this.disposed && !this.lost && !this.gl?.isContextLost(); }
  /** A prepared renderer allocates under existing limits but schedules no drawing. */
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
      more ||= this.focusLevel !== this.focusTarget;
    }
    return more;
  }
  private draw = () => {
    cancelAnimationFrame(this.frameId); clearTimeout(this.frameTimer); this.frameTimer = undefined;
    this.frameId = 0; if (this.disposed || this.lost || !this.ready) return;
    // DPR can change without a CSS-size observer notification; reconcile on the next paint.
    if (this.dpr !== (window.devicePixelRatio || 1)) this.resize();
    const drawStart = performance.now(), more = this.animate(drawStart);
    const gl = this.gl, p = this.theme.palette, zoom = this.camera.ratio / this.homeRatio, v = this.settings.visuals;
    this.adaptSizes(zoom);
    if (!gl) { this.drawCanvas(); this.placeOverlay(); if (more) this.refresh(); return; }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(p[8]! / 255, p[9]! / 255, p[10]! / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const lod = labelLOD(this.camera.ratio), policy = this.policy, fade = labelFade(this.settings.nodeSize, this.settings.labelRenderedSizeThreshold, this.camera.ratio, LABEL_RATIOS, v.labelFade);
    const notes = this.carrierLevel(zoom), edgeWidth = this.settings.edgeSize * zoomFade(v, this.visibleEdges, zoom, this.width, this.height), alpha = edgeAlpha(v, this.visibleEdges, zoom, policy.dark, this.width, this.height);
    const nodeSize = this.baseNodeRadius();
    const focus = v.hoverHighlight ? this.focusLevel : 0, haloAlpha = v.haloOpacity * Math.min(1, Math.max(0, (this.camera.ratio - .06) / .25));
    // Halos (under), edges, edge notes, other nodes, collapsed hubs, labels.
    const passes: [number, number, number, number?][] = [];
    if (policy.halos && haloAlpha > .002 && this.discData[0]!.length) passes.push([3, 2, 0]);
    if (v.edgeOpacity > 0) passes.push([0, 0, 0]);
    if (this.visibleCarriers) passes.push([1, 1, 0, 0]);
    passes.push([1, 1, 0, 1]);
    if (this.discData[1]!.length) passes.push([3, 3, 1]);
    if (this.atlas && fade.alpha > .004) passes.push([2, -1, 0]);
    for (const [i, vaoIndex, hub, layer = 1] of passes) {
      const program = this.programs[i]!, u = program.uniforms;
      gl.useProgram(program.handle); gl.uniform1i(u.positions!, 0); gl.uniform1i(u.palette!, 1); gl.uniform1i(u.atlas!, 2); gl.uniform1i(u.nodeColors!, 3); gl.uniform1i(u.nodeState!, 4); gl.uniform1i(u.positionWidth!, this.positionWidth);
      gl.uniform2f(u.center!, this.centerX, this.centerY); gl.uniform2f(u.viewport!, this.width, this.height); gl.uniform1f(u.scale!, this.scale); gl.uniform1f(u.nodeSize!, nodeSize); gl.uniform1f(u.edgeSize!, edgeWidth); gl.uniform1i(u.hovered!, this.hovered); gl.uniform1i(u.selected!, this.selected); gl.uniform1i(u.focusNode!, this.focusNode); gl.uniform1i(u.edgeHovered!, this.hoveredEdge);
      gl.uniform1f(u.focus!, focus); gl.uniform1f(u.dim!, v.dimOpacity); gl.uniform1f(u.glow!, layer ? policy.glow : 0);
      gl.uniform1f(u.carrierAlpha!, notes.alpha); gl.uniform1f(u.carrierFold!, notes.visibility); gl.uniform1f(u.carrierSize!, v.carrierSize); gl.uniform1i(u.layer!, layer);
      gl.uniform1i(u.segments!, policy.segments); gl.uniform1f(u.curvature!, policy.curves ? v.curvature : 0); gl.uniform1f(u.edgeAlpha!, alpha); gl.uniform1f(u.direction!, v.edgeDirection ? 1 : 0); gl.uniform1f(u.colorMix!, v.edgeColorMix);
      gl.uniform1f(u.labelAlpha!, fade.alpha); gl.uniform1f(u.labelCut!, fade.cut); gl.uniform3f(u.outline!, p[8]! / 255, p[9]! / 255, p[10]! / 255); gl.uniform2f(u.texel!, 1 / 2048, 1 / 2048); gl.uniform1f(u.discAlpha!, hub ? 1 : haloAlpha); gl.uniform1f(u.hub!, hub);
      gl.bindVertexArray(vaoIndex < 0 ? this.labelVaos[lod]! : this.vaos[vaoIndex]!);
      if (i === 0) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6 * policy.segments, this.projection.source.length);
      else if (i === 1) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.visible.length);
      else if (i === 2) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.atlas!.levels[lod]!.length / 11);
      else gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.discData[hub]!.length / 8);
    }
    gl.bindVertexArray(null); this.placeOverlay(); this.timings.maxDraw = Math.max(this.timings.maxDraw || 0, performance.now() - drawStart);
    if (more) this.refresh();
  };
  /** DOM text for the hovered note and collapsed groups only: bounded, text-only. */
  private placeOverlay() {
    this.onSizingChange?.();
    const v = this.settings.visuals, focus = v.hoverHighlight ? this.focusLevel : 0, ego = this.focusNode, node = this.hovered < 0 && focus ? ego : this.hovered;
    const radius = (n: number) => this.nodeRadius(n, true) * tierNode(this.stateBytes[n * 4 + 1]! / 255, true, n === ego, focus, 0)[1];
    if (node >= 0) { const s = this.screenPoint(node); this.hoverLabel.textContent = this.noteCaption(node); this.hoverLabel.className = 'graph-ng-hover-label' + (node === ego && focus ? ' graph-ng-focus' : ''); this.hoverLabel.style.transform = `translate(${Math.round(s.x + radius(node) + 6)}px, ${Math.round(s.y - 10)}px)`; }
    else this.hoverLabel.textContent = '';
    // Graduated labels: placed once per focus or LOD change, translated per frame (bounded DOM).
    const lod = labelLOD(this.camera.ratio);
    if (!this.near.length) this.ranked = [];
    else if (lod !== this.rankedLod) {
      const s = this.settings, k = this.scale * this.camera.ratio / LABEL_RATIOS[lod]!, budget = Math.max(1, Math.min(s.labelsMaxPerViewport, FOCUS_LABELS, Math.floor(this.width * this.height / s.labelGridCellSize ** 2 * s.labelDensity)));
      this.ranked = focusLabels(ego, this.near, this.stateBytes, this.visible, this.projection.offsets, (n, rank) => { const z = s.labelSize * (rank ? 1 : 1.25); return { node: n, x: this.display[n * 2]! * k + this.nodeRadius(n) + 4, y: this.display[n * 2 + 1]! * k - z / 2, w: this.name(n).length * z * .6 + 4, h: z * 1.5 + 4 }; }, s.labelGridCellSize, budget, budget * s.labelCandidateMultiplier).filter(([n]) => n !== ego);
      this.rankedLod = lod;
      while (this.tierLabels.length > this.ranked.length) this.tierLabels.pop()!.remove();
      while (this.tierLabels.length < this.ranked.length) this.tierLabels.push(this.overlay.appendChild(document.createElement('div')));
      this.ranked.forEach(([n, rank], i) => { const el = this.tierLabels[i]!; el.className = 'graph-ng-focus-label graph-ng-tier-' + rank; el.textContent = this.name(n); });
    }
    if (!this.ranked.length) while (this.tierLabels.length) this.tierLabels.pop()!.remove();
    this.ranked.forEach(([n], i) => { const el = this.tierLabels[i]!, p = this.screenPoint(n); el.style.opacity = String(focus); el.style.transform = `translate(${Math.round(p.x + radius(n) + 4)}px, ${Math.round(p.y)}px) translateY(-50%)`; });
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
    const ctx = this.ctx!, s = this.settings, c = this.colorBytes, focus = s.visuals.hoverHighlight ? this.focusLevel : 0, dim = s.visuals.dimOpacity, g = this.stateBytes;
    const x = (n: number) => (this.display[n * 2]! - this.centerX) * this.scale + this.width / 2, y = (n: number) => (this.display[n * 2 + 1]! - this.centerY) * this.scale + this.height / 2;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.fillStyle = this.theme.background; ctx.fillRect(0, 0, this.width, this.height); ctx.strokeStyle = this.theme.edge; ctx.lineWidth = s.edgeSize;
    // The edge shader's tier weights: rest, neighbours of neighbours, then direct strokes on top.
    const zoom = this.camera.ratio / this.homeRatio, base = edgeAlpha(s.visuals, this.visibleEdges, zoom, false, this.width, this.height), width = s.edgeSize * zoomFade(s.visuals, this.visibleEdges, zoom, this.width, this.height);
    for (const tier of focus ? [0, 128, 255] : [-1]) {
      const [alpha, wide] = tierEdge(tier, base, tier < 0 ? 0 : focus, dim); ctx.globalAlpha = alpha; ctx.lineWidth = width * wide; ctx.beginPath(); let any = 0; const hue: number[] = [], line = (e: number) => { const a = this.projection.source[e]!, b = this.projection.target[e]!; ctx.moveTo(x(a), y(a)); ctx.lineTo(x(b), y(b)); };
      for (const e of this.canvasEdges) { const a = this.projection.source[e]!, b = this.projection.target[e]!, t = this.edgeTier[e]!; if (!this.edgeOn[e] || !this.filterVisible[a] || !this.filterVisible[b] || tier >= 0 && edgeBucket(t) !== tier) continue; line(e); any = 1; if (tier >= 0 && tintedEdge(t)) hue.push(e); }
      if (s.visuals.edgeOpacity > 0 && any) ctx.stroke();
      // Tinted relationship layer: the shader mixes the accent by focus / 2 at the same weight.
      if (s.visuals.edgeOpacity > 0 && hue.length) { ctx.strokeStyle = this.theme.accent; ctx.globalAlpha = alpha * focus * .5; ctx.beginPath(); hue.forEach(line); ctx.stroke(); ctx.strokeStyle = this.theme.edge; }
    }
    const notes = this.projection.carrierNodes, level = this.carrierLevel();
    // Edge notes first (beneath), then the other nodes.
    for (const layer of [1, 0]) for (let n = 0; n < this.visible.length; n++) if (this.visible[n] && +!!notes[n] === layer) {
      const hot = n === this.selected || n === this.hovered, k = n * 4, p = this.theme.palette, coverage = layer ? (hot ? level.visibility : level.alpha) : 1;
      const a = coverage * (hot ? p[19]! : c[k + 3]!) / 255;
      if (coverage < .004 || a <= 0) continue;
      const [fade, grow, ring] = tierNode(g[k + 1]! / 255, hot, n === this.focusNode, focus, dim), r = this.nodeRadius(n, hot) * grow;
      ctx.globalAlpha = a * fade; ctx.fillStyle = ctx.strokeStyle = hot ? `rgb(${p[16]},${p[17]},${p[18]})` : `rgb(${c[k]},${c[k + 1]},${c[k + 2]})`; ctx.beginPath(); ctx.arc(x(n), y(n), r, 0, Math.PI * 2); ctx.fill();
      // The shader's outer ring band (1.1–1.34 radii) as one stroke.
      if (ring) { ctx.globalAlpha = a * ring; ctx.lineWidth = r * .2; ctx.beginPath(); ctx.arc(x(n), y(n), r * 1.22, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    for (const h of this.hubs) { ctx.fillStyle = this.groupColor(h.group); ctx.beginPath(); ctx.arc((h.x - this.centerX) * this.scale + this.width / 2, (h.y - this.centerY) * this.scale + this.height / 2, h.radius, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = `${s.labelSize}px ${this.theme.font}`; ctx.fillStyle = this.theme.text;
    if (this.atlas && s.nodeSize >= s.labelRenderedSizeThreshold * Math.sqrt(this.camera.ratio)) for (const n of this.atlas.nodes[labelLOD(this.camera.ratio)]!) { ctx.globalAlpha = tierLabel(g[n * 4 + 1]! / 255, 1, focus, dim); if (ctx.globalAlpha > .004) ctx.fillText(this.name(n), x(n) + this.nodeRadius(n) + 4, y(n)); }
  }
  private pointerDown = (e: PointerEvent) => { if (this.disposed || this.lost || e.button > 0) return; this.flight = undefined; this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.canvas.setPointerCapture(e.pointerId); this.downX = e.clientX; this.downY = e.clientY; this.moved = this.pointers.size > 1; };
  private pointerMove = (e: PointerEvent) => {
    if (this.disposed || this.lost) return;
    this.lastPointer = { clientX: e.clientX, clientY: e.clientY };
    const old = this.pointers.get(e.pointerId);
    if (old) {
      const dx = e.clientX - old.x, dy = e.clientY - old.y;
      if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 3) this.moved = true;
      if (this.pointers.size === 2) { for (const [id, other] of this.pointers) if (id !== e.pointerId) { const before = Math.hypot(old.x - other.x, old.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y); if (before > 0 && after > 0) this.setCamera(this.camera.x, this.camera.y, this.camera.ratio * before / after); } }
      else this.setCamera(this.camera.x - dx / this.scale / this.cameraFrame.width, this.camera.y - dy / this.scale / this.cameraFrame.height, this.camera.ratio);
      old.x = e.clientX; old.y = e.clientY; return;
    }
    const rect = this.canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    const hub = this.pickHub(x, y), node = hub >= 0 ? -1 : this.pick(x, y), edge = node < 0 && hub < 0 ? this.pickEdge(x, y) : -1;
    if (node === this.hovered && edge === this.hoveredEdge) return;
    this.hovered = node; this.hoveredEdge = edge; this.emphasize();
    this.container.title = hub >= 0 ? `${this.view.groupLabels?.[hub] ?? ''} (collapsed) — click to expand` : node >= 0 ? this.path(node) : edge >= 0 ? `${this.path(this.projection.source[edge]!)} → ${this.path(this.projection.target[edge]!)} [${this.projection.types[this.projection.type[edge]!]!}]` : '';
    this.canvas.style.cursor = node >= 0 || hub >= 0 || edge >= 0 ? 'pointer' : 'grab'; this.refresh();
  };
  private pointerUp = (e: PointerEvent) => {
    if (this.disposed || this.lost) return;
    const had = this.pointers.delete(e.pointerId); if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (had && !this.moved) {
      const rect = this.canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top, hub = this.pickHub(x, y);
      if (hub >= 0) { this.onHub?.(hub); return; }
      // A touch tap only selects (precise taps on dense graphs misfire); mouse/pen clicks still open.
      // A tap or click on empty canvas clears the selection.
      // Notes outrank lines. A line click or tap selects its relationship and never opens anything.
      const node = this.pick(x, y), touch = e.pointerType === 'touch', edge = node < 0 ? this.pickEdge(x, y) : -1;
      if (edge >= 0) { this.selectEdge(edge); return; }
      this.selectNote(node, touch); if (node >= 0 && !touch) this.onNode(node);
    }
  };
  /** Keyboard path: arrows select the nearest note in that screen direction, Enter opens, Escape clears. */
  private keyDown = (e: KeyboardEvent) => {
    const d = ['Right', 'Down', 'Left', 'Up'].indexOf(e.key.slice(5));
    if (e.key === 'Escape' && (this.selected >= 0 || this.selectedEdges.length)) { this.selectNote(-1); this.canvas.focus(); }
    else if ((e.key === 'r' || e.key === 'R') && this.cycleEdge(e.shiftKey ? -1 : 1)) { /* handled */ }
    else if (e.target !== this.canvas) return;
    else if (e.key === 'Enter' && this.filterVisible[this.selected]) this.onNode(this.selected);
    else if (d >= 0 && e.key.startsWith('Arrow')) {
      // Unit direction for Right, Down, Left, Up.
      const from = this.selected < 0 ? { x: this.width / 2, y: this.height / 2 } : this.screenPoint(this.selected), ux = (1 - d) % 2, uy = (2 - d) % 2;
      let best = -1, score = Infinity;
      for (let i = 0; i < this.visible.length; i++) if (this.visible[i]) { const q = this.screenPoint(i), x = q.x - from.x, y = q.y - from.y, a = x * ux + y * uy, t = a + 2 * Math.abs(x * uy - y * ux); if (a > 0 && t < score) { best = i; score = t; } }
      if (best >= 0) this.selectNote(best, true);
    } else return;
    e.preventDefault();
  };
  private pointerCancel = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.moved = true; };
  private pointerLeave = () => { this.lastPointer = undefined; if (!this.pointers.size) { this.hovered = this.hoveredEdge = -1; this.emphasize(); this.container.title = ''; this.refresh(); } };
  private wheel = (e: WheelEvent) => {
    e.preventDefault(); if (this.disposed || this.lost) return; this.flight = undefined; const rect = this.canvas.getBoundingClientRect(), x = e.clientX - rect.left - this.width / 2, y = e.clientY - rect.top - this.height / 2, before = this.scale;
    this.camera.ratio = this.clampRatio(this.camera.ratio * Math.exp(Math.max(-1, Math.min(1, e.deltaY * .001))));
    this.camera.x += (x / before - x / this.scale) / this.cameraFrame.width; this.camera.y += (y / before - y / this.scale) / this.cameraFrame.height; this.refresh(); if (this.camera.ratio >= this.settings.lodZoomRatio) this.onZoomOut();
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
  dispose() { clearTimeout(this.sizingTimer);
    if (this.disposed) return; this.disposed = true; this.labelsRevision++; clearTimeout(this.restoreTimer); this.restoreTimer = undefined; cancelAnimationFrame(this.frameId); clearTimeout(this.frameTimer); this.frameTimer = undefined; this.observer.disconnect(); this.media.removeEventListener('change', this.refreshTheme);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored); this.canvas.removeEventListener('pointerdown', this.pointerDown); this.canvas.removeEventListener('pointermove', this.pointerMove); this.canvas.removeEventListener('pointerup', this.pointerUp); this.canvas.removeEventListener('pointercancel', this.pointerCancel); this.canvas.removeEventListener('pointerleave', this.pointerLeave); this.canvas.removeEventListener('keydown', this.keyDown); this.canvas.removeEventListener('wheel', this.wheel);
    const gl = this.gl; if (gl && !this.lost) { for (const p of this.programs) gl.deleteProgram(p.handle); for (const b of [...this.buffers, ...this.labelBuffers, ...this.discBuffers]) if (b) gl.deleteBuffer(b); for (const v of [...this.vaos, ...this.labelVaos]) gl.deleteVertexArray(v); for (const t of this.textures) gl.deleteTexture(t); }
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.pointers.clear(); this.container.title = ''; this.canvas.remove(); this.overlay.remove();
  }
}
