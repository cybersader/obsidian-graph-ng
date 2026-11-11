import { renderPath, type RenderProjection } from './render-projection';
import type { Settings } from './settings';
import { PickGrid, positionTexture, incidentEdges, segmentDistance, labelLOD, canvasDetailEdges, resizeDrawingBuffer } from './render-data';
import { readTheme, type GraphTheme } from './render-theme';
import { buildLabels, type LabelAtlas } from './render-labels';
import { yieldTask } from './core/scheduler';

// All shaders are constant source strings. Note text is only rasterized on Canvas2D.
const common = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D positions;
uniform sampler2D palette;
uniform int positionWidth;
uniform vec2 center;
uniform vec2 viewport;
uniform float scale;
uniform float nodeSize;
uniform int hovered;
uniform int selected;
vec2 point(int id) { return (texelFetch(positions, ivec2(id % positionWidth, id / positionWidth), 0).xy - center) * scale; }
vec4 color(int id) { return texelFetch(palette, ivec2(id % 256, id / 256), 0); }
vec4 clip(vec2 p) { return vec4(p / viewport * vec2(2., -2.), 0., 1.); }
const vec2 corners[6] = vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
`;
const nodeVertex = common + `
layout(location=0) in uint colorId;
layout(location=1) in uint visible;
out vec2 local;
out vec4 tint;
void main() {
 int id = gl_InstanceID;
 float radius = nodeSize + ((id == hovered || id == selected) ? 2. : 0.);
 local = corners[gl_VertexID];
 gl_Position = visible == 0u ? vec4(2.,2.,0.,1.) : clip(point(id) + local * radius);
 tint = color(id == hovered || id == selected ? 4 : int(colorId));
}`;
const nodeFragment = `#version 300 es
precision highp float;
in vec2 local; in vec4 tint; out vec4 outputColor;
void main() { float d = length(local); if (d > 1.) discard; outputColor = vec4(tint.rgb, tint.a * (1. - smoothstep(.85, 1., d))); }`;
const edgeVertex = common + `
layout(location=0) in uint source;
layout(location=1) in uint target;
layout(location=2) in uint sourceVisible;
layout(location=3) in uint targetVisible;
uniform float edgeSize;
uniform int edgeHovered;
out vec4 tint;
void main() {
 vec2 a = point(int(source)), b = point(int(target));
 vec2 delta = b - a; float len = length(delta);
 vec2 normal = len > 0. ? vec2(-delta.y, delta.x) / len : vec2(0.,1.);
 vec2 c = corners[gl_VertexID];
 gl_Position = sourceVisible == 0u || targetVisible == 0u ? vec4(2.,2.,0.,1.) : clip(mix(a,b,(c.x+1.)*.5) + normal * c.y * max(.5, edgeSize));
 tint = color(gl_InstanceID == edgeHovered ? 4 : 1);
}`;
const solidFragment = `#version 300 es
precision highp float; in vec4 tint; out vec4 outputColor;
void main() { outputColor = tint; }`;
const labelVertex = common + `
layout(location=0) in vec4 a;
layout(location=1) in vec4 b;
layout(location=2) in float vHeight;
out vec2 uv;
out vec4 tint;
void main() { vec2 q = (corners[gl_VertexID] + 1.) * .5;
 gl_Position = clip(point(int(a.x)) + a.yz + q * vec2(a.w, b.x));
 uv = b.yz + q * vec2(b.w, vHeight); tint = color(3);
}`;
const labelFragment = `#version 300 es
precision highp float; uniform sampler2D atlas;
in vec2 uv; in vec4 tint; out vec4 outputColor;
void main() { outputColor = vec4(tint.rgb, tint.a * texture(atlas,uv).a); }`;
interface Program { handle: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> }
interface Camera { x: number; y: number; ratio: number }

/** Draw directly from projection columns. Camera frames touch uniforms only. */
export class DetailRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly grid: PickGrid;
  readonly camera: Camera = { x: .5, y: .5, ratio: 1 };
  readonly gpu: boolean;
  hovered = -1;
  selected = -1;
  hoveredEdge = -1;
  paletteUploads = 0;
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
  private atlas?: LabelAtlas;
  private labelsRevision = 0;
  private frame = 0;
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
  private edges: ReturnType<typeof incidentEdges>;
  private colorIds: Uint32Array;
  private pointers = new Map<number, { x: number; y: number }>();
  private moved = false;
  private downX = 0;
  private downY = 0;
  private positionWidth = 1;
  static async create(container: HTMLElement, p: RenderProjection, positions: Float32Array, visible: Uint8Array, settings: Settings, onNode: (i: number) => void, onZoomOut: () => void, colors: Uint32Array, current = () => true, software = false, onUnavailable = onZoomOut) {
    await yieldTask(); if (!current()) throw new Error('Renderer superseded');
    const renderer = new DetailRenderer(container, p, positions, visible, settings, onNode, onZoomOut, colors, software, onUnavailable);
    try {
      await renderer.initialize();
      if (!current()) throw new Error('Renderer superseded');
      await renderer.prepareLabels(current);
      if (!current()) throw new Error('Renderer superseded');
      renderer.refresh(); return renderer;
    } catch (error) { renderer.dispose(); throw error; }
  }
  constructor(private container: HTMLElement, readonly projection: RenderProjection, readonly positions: Float32Array, readonly visible: Uint8Array, private settings: Settings, private onNode: (i: number) => void, private onZoomOut: () => void, colors: Uint32Array, software = false, private onUnavailable = onZoomOut) {
    let started = performance.now();
    this.grid = new PickGrid(positions, visible); this.edges = incidentEdges(projection);
    this.timings.grid = performance.now() - started; started = performance.now();
    this.colorIds = Uint32Array.from(colors, c => c < settings.declaration.colors.length ? c + 5 : 0);
    this.theme = readTheme(container, settings);
    this.timings.theme = performance.now() - started; started = performance.now();
    this.canvas = document.createElement('canvas'); this.canvas.className = 'graph-ng-detail'; this.canvas.setAttribute('aria-label', 'Individual graph notes'); this.canvas.style.touchAction = 'none'; container.append(this.canvas);
    this.resize();
    this.gl = software ? null : this.canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    this.timings.context = performance.now() - started;
    this.gpu = Boolean(this.gl);
    if (!this.gl) {
      try { this.canvasEdges = canvasDetailEdges(projection, visible, settings.canvasMaxDetailNodes, settings.canvasMaxDetailEdges); } catch (e) { this.canvas.remove(); throw e; }
      this.ctx = this.canvas.getContext('2d'); if (!this.ctx) { this.canvas.remove(); throw new Error('CANVAS_UNAVAILABLE'); }
    }
    this.canvas.addEventListener('webglcontextlost', this.contextLost); this.canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.canvas.addEventListener('pointerdown', this.pointerDown); this.canvas.addEventListener('pointermove', this.pointerMove); this.canvas.addEventListener('pointerup', this.pointerUp); this.canvas.addEventListener('pointercancel', this.pointerCancel); this.canvas.addEventListener('pointerleave', this.pointerLeave); this.canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.media.addEventListener('change', this.refreshTheme);
    this.observer = new ResizeObserver(() => { const changed = this.resize(); if (changed && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {}); }); this.observer.observe(container);
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
      for (const name of ['positions', 'palette', 'positionWidth', 'center', 'viewport', 'scale', 'nodeSize', 'hovered', 'selected', 'edgeSize', 'edgeHovered', 'atlas']) uniforms[name] = gl.getUniformLocation(handle, name);
      return { handle, uniforms };
    } catch (e) { gl.deleteProgram(handle); throw e; } finally { for (const shader of shaders) gl.deleteShader(shader); }
  }
  private buffer(data: ArrayBufferView) { const gl = this.gl!, b = gl.createBuffer()!; this.buffers.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }
  private integer(location: number, data: Uint32Array | Uint8Array) { const gl = this.gl!; this.buffer(data); gl.enableVertexAttribArray(location); gl.vertexAttribIPointer(location, 1, data instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(location, 1); }
  private texture(unit: number) { const gl = this.gl!, t = gl.createTexture()!; this.textures[unit] = t; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
  private async initialize() {
    if (this.disposed || this.lost) return;
    const gl = this.gl;
    if (!gl) { this.ready = true; this.refresh(); return; }
    for (const [v, f] of [[edgeVertex, solidFragment], [nodeVertex, nodeFragment], [labelVertex, labelFragment]]) {
      const started = performance.now(); this.programs.push(await this.program(v!, f!)); this.timings[`program${this.programs.length}`] = performance.now() - started; await yieldTask(); if (this.disposed || this.lost) return;
    }
    // ResizeObserver may fire while parallel shader compilation is pending.
    // Resizing that drawing buffer synchronously waits on the driver; apply its
    // latest CSS size only after all program completion polls have finished.
    await this.waitForResize(); this.resize(true);
    const uploadStart = performance.now();
    const packed = positionTexture(this.positions, Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE)));
    if (packed.height > gl.getParameter(gl.MAX_TEXTURE_SIZE) || this.theme.palette.length / 1024 > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('GL_TEXTURE_LIMIT');
    this.positionWidth = packed.width;
    this.texture(0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, packed.width, packed.height, 0, gl.RG, gl.FLOAT, packed.data);
    this.texture(1); this.uploadPalette(); this.texture(2);
    for (let i = 0; i < 2; i++) { const vao = gl.createVertexArray()!; this.vaos.push(vao); gl.bindVertexArray(vao);
      if (i === 0) {
        this.integer(0, this.projection.source); this.integer(1, this.projection.target);
        this.integer(2, Uint8Array.from(this.projection.source, n => this.visible[n]!)); this.integer(3, Uint8Array.from(this.projection.target, n => this.visible[n]!));
      } else { this.integer(0, this.colorIds); this.integer(1, this.visible); }
      await yieldTask(); if (this.disposed || this.lost) return;
    }
    this.timings.upload = performance.now() - uploadStart;
    gl.bindVertexArray(null); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    await this.waitForResize(); this.resize(true); this.ready = true; if (this.atlas) this.uploadLabels(); this.refresh();
  }
  private uploadPalette() { const gl = this.gl!; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.textures[1]!); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, this.theme.palette.length / 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.theme.palette); this.paletteUploads++; }
  private async prepareLabels(current: () => boolean) {
    const revision = ++this.labelsRevision, w = this.width, h = this.height;
    const valid = () => !this.disposed && revision === this.labelsRevision && current();
    const started = performance.now();
    const atlas = await buildLabels(this.projection, this.grid, this.settings, w, h, this.theme.font, valid);
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
      for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, i === 2 ? 1 : 4, gl.FLOAT, false, 36, i * 16); gl.vertexAttribDivisor(i, 1); }
    }
    gl.bindVertexArray(null); this.timings.labelUpload = performance.now() - started;
  }
  refreshTheme = () => {
    if (this.disposed) return;
    const font = this.theme.font; this.theme = readTheme(this.container, this.settings);
    if (this.gl && this.ready && !this.lost) this.uploadPalette();
    if (font !== this.theme.font && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {});
    this.refresh();
  };
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
  setCamera(x: number, y: number, ratio: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(ratio)) throw new Error('CAMERA_NONFINITE');
    this.camera.x = x; this.camera.y = y; this.camera.ratio = Math.max(this.settings.cameraMinRatio, Math.min(this.settings.cameraMaxRatio, ratio)); this.refresh();
  }
  /** Test/host seam; not a second graph or renderer object model. */
  path(id: number) { return renderPath(this.projection, id); }
  screenPoint(id: number) { return { x: (this.positions[id * 2]! - this.centerX) * this.scale + this.width / 2, y: (this.positions[id * 2 + 1]! - this.centerY) * this.scale + this.height / 2 }; }
  pick(x: number, y: number) { return this.grid.pick((x - this.width / 2) / this.scale + this.centerX, (y - this.height / 2) / this.scale + this.centerY, (this.settings.nodeSize + 4) / this.scale); }
  private pickEdge(x: number, y: number) {
    const wx = (x - this.width / 2) / this.scale + this.centerX, wy = (y - this.height / 2) / this.scale + this.centerY, radius = this.grid.cell;
    let best = -1, distance = this.settings.groupEdgeHitRadius / this.scale;
    // Deliberately incident-edge hover, not an O(m) all-segment scan or GPU readback.
    this.grid.visit(wx, wy, radius, node => {
      for (let j = this.edges.offsets[node]!; j < this.edges.offsets[node + 1]!; j++) { const e = this.edges.edges[j]!, a = this.projection.source[e]!, b = this.projection.target[e]!; if (!this.visible[a] || !this.visible[b]) continue;
        const d = segmentDistance(wx, wy, this.positions[a * 2]!, this.positions[a * 2 + 1]!, this.positions[b * 2]!, this.positions[b * 2 + 1]!); if (d < distance) { best = e; distance = d; }
      }
    }); return best;
  }
  refresh() {
    if (this.disposed || this.lost || this.frame || this.frameTimer !== undefined) return;
    this.frame = requestAnimationFrame(this.draw);
    // Embedded/occluded Electron windows can withhold rAF indefinitely. One bounded
    // backstop paints on demand; it is not a perpetual background animation loop.
    this.frameTimer = setTimeout(this.draw, this.settings.frameBackstopMs);
  }
  private draw = () => {
    cancelAnimationFrame(this.frame); clearTimeout(this.frameTimer); this.frameTimer = undefined;
    this.frame = 0; if (this.disposed || this.lost || !this.ready) return;
    const drawStart = performance.now();
    const gl = this.gl, p = this.theme.palette;
    if (!gl) { this.drawCanvas(); return; }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(p[8]! / 255, p[9]! / 255, p[10]! / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const lod = labelLOD(this.camera.ratio);
    for (let i = 0; i < this.programs.length; i++) {
      if (i === 2 && (!this.atlas || this.settings.nodeSize < this.settings.labelRenderedSizeThreshold * Math.sqrt(this.camera.ratio))) continue;
      const program = this.programs[i]!, u = program.uniforms;
      gl.useProgram(program.handle); gl.uniform1i(u.positions!, 0); gl.uniform1i(u.palette!, 1); gl.uniform1i(u.atlas!, 2); gl.uniform1i(u.positionWidth!, this.positionWidth);
      gl.uniform2f(u.center!, this.centerX, this.centerY); gl.uniform2f(u.viewport!, this.width, this.height); gl.uniform1f(u.scale!, this.scale); gl.uniform1f(u.nodeSize!, this.settings.nodeSize); gl.uniform1f(u.edgeSize!, this.settings.edgeSize); gl.uniform1i(u.hovered!, this.hovered); gl.uniform1i(u.selected!, this.selected); gl.uniform1i(u.edgeHovered!, this.hoveredEdge);
      gl.bindVertexArray(i === 2 ? this.labelVaos[lod]! : this.vaos[i]!); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, i === 0 ? this.projection.source.length : i === 1 ? this.visible.length : this.atlas!.levels[lod]!.length / 9);
    }
    gl.bindVertexArray(null); this.timings.maxDraw = Math.max(this.timings.maxDraw || 0, performance.now() - drawStart);
  };
  private drawCanvas() {
    const ctx = this.ctx!, s = this.settings; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.fillStyle = this.theme.background; ctx.fillRect(0, 0, this.width, this.height); ctx.strokeStyle = this.theme.edge; ctx.lineWidth = s.edgeSize;
    ctx.beginPath();
    for (const e of this.canvasEdges) { const a = this.projection.source[e]!, b = this.projection.target[e]!; ctx.moveTo((this.positions[a * 2]! - this.centerX) * this.scale + this.width / 2, (this.positions[a * 2 + 1]! - this.centerY) * this.scale + this.height / 2); ctx.lineTo((this.positions[b * 2]! - this.centerX) * this.scale + this.width / 2, (this.positions[b * 2 + 1]! - this.centerY) * this.scale + this.height / 2); } ctx.stroke();
    for (let n = 0; n < this.visible.length; n++) if (this.visible[n]) { const id = n === this.selected || n === this.hovered ? 4 : this.colorIds[n]!, p = this.theme.palette, k = id * 4; ctx.fillStyle = `rgba(${p[k]},${p[k + 1]},${p[k + 2]},${p[k + 3]! / 255})`; ctx.beginPath(); ctx.arc((this.positions[n * 2]! - this.centerX) * this.scale + this.width / 2, (this.positions[n * 2 + 1]! - this.centerY) * this.scale + this.height / 2, s.nodeSize + (id === 4 ? 2 : 0), 0, Math.PI * 2); ctx.fill(); }
    ctx.font = `${s.labelSize}px ${this.theme.font}`; ctx.fillStyle = this.theme.text;
    if (this.atlas && s.nodeSize >= s.labelRenderedSizeThreshold * Math.sqrt(this.camera.ratio)) for (const n of this.atlas.nodes[labelLOD(this.camera.ratio)]!) { const path = this.path(n); ctx.fillText(path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '').slice(0, 128), (this.positions[n * 2]! - this.centerX) * this.scale + this.width / 2 + s.nodeSize + 4, (this.positions[n * 2 + 1]! - this.centerY) * this.scale + this.height / 2); }
  }
  private pointerDown = (e: PointerEvent) => { if (this.disposed || this.lost) return; this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.canvas.setPointerCapture(e.pointerId); this.downX = e.clientX; this.downY = e.clientY; this.moved = this.pointers.size > 1; };
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
    const node = this.pick(x, y), edge = node < 0 ? this.pickEdge(x, y) : -1;
    if (node === this.hovered && edge === this.hoveredEdge) return;
    this.hovered = node; this.hoveredEdge = edge; this.container.title = node >= 0 ? this.path(node) : edge >= 0 ? `${this.path(this.projection.source[edge]!)} → ${this.path(this.projection.target[edge]!)} [${this.projection.types[this.projection.type[edge]!]!}]` : ''; this.canvas.style.cursor = node >= 0 ? 'pointer' : 'grab'; this.refresh();
  };
  private pointerUp = (e: PointerEvent) => {
    if (this.disposed || this.lost) return;
    const had = this.pointers.delete(e.pointerId); if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (had && !this.moved) { const rect = this.canvas.getBoundingClientRect(), node = this.pick(e.clientX - rect.left, e.clientY - rect.top); if (node >= 0) { this.selected = node; this.refresh(); this.onNode(node); } }
  };
  private pointerCancel = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.moved = true; };
  private pointerLeave = () => { if (!this.pointers.size) { this.hovered = this.hoveredEdge = -1; this.container.title = ''; this.refresh(); } };
  private wheel = (e: WheelEvent) => {
    e.preventDefault(); if (this.disposed || this.lost) return; const rect = this.canvas.getBoundingClientRect(), x = e.clientX - rect.left - this.width / 2, y = e.clientY - rect.top - this.height / 2, before = this.scale;
    this.camera.ratio = Math.max(this.settings.cameraMinRatio, Math.min(this.settings.cameraMaxRatio, this.camera.ratio * Math.exp(Math.max(-1, Math.min(1, e.deltaY * .001)))));
    this.camera.x += (x / before - x / this.scale) / this.grid.width; this.camera.y += (y / before - y / this.scale) / this.grid.height; this.refresh(); if (this.camera.ratio >= this.settings.lodZoomRatio) this.onZoomOut();
  };
  private contextLost = (e: Event) => {
    e.preventDefault(); if (this.disposed) return; this.lost = true; this.ready = false; this.pointers.clear(); this.container.title = ''; this.canvas.style.cursor = 'wait';
    cancelAnimationFrame(this.frame); clearTimeout(this.frameTimer); this.frameTimer = undefined; this.frame = 0; this.canvas.dataset.context = 'lost';
    clearTimeout(this.restoreTimer); this.restoreTimer = setTimeout(() => { if (!this.disposed && this.lost) { this.canvas.dataset.context = 'failed'; this.onUnavailable(); } }, this.settings.contextRestoreTimeoutMs);
  };
  private contextRestored = () => {
    if (this.disposed) return; clearTimeout(this.restoreTimer); this.restoreTimer = undefined; this.canvas.style.cursor = 'grab';
    this.lost = false; this.programs = []; this.vaos = []; this.buffers = []; this.textures = []; this.labelBuffers = []; this.labelVaos = [];
    void this.initialize().then(() => { if (!this.disposed && !this.lost) this.canvas.dataset.context = 'restored'; }).catch(() => { if (!this.disposed) { this.canvas.dataset.context = 'failed'; this.onUnavailable(); } });
  };
  dispose() {
    if (this.disposed) return; this.disposed = true; this.labelsRevision++; clearTimeout(this.restoreTimer); this.restoreTimer = undefined; cancelAnimationFrame(this.frame); clearTimeout(this.frameTimer); this.frameTimer = undefined; this.observer.disconnect(); this.media.removeEventListener('change', this.refreshTheme);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored); this.canvas.removeEventListener('pointerdown', this.pointerDown); this.canvas.removeEventListener('pointermove', this.pointerMove); this.canvas.removeEventListener('pointerup', this.pointerUp); this.canvas.removeEventListener('pointercancel', this.pointerCancel); this.canvas.removeEventListener('pointerleave', this.pointerLeave); this.canvas.removeEventListener('wheel', this.wheel);
    const gl = this.gl; if (gl && !this.lost) { for (const p of this.programs) gl.deleteProgram(p.handle); for (const b of this.buffers) gl.deleteBuffer(b); for (const b of this.labelBuffers) gl.deleteBuffer(b); for (const v of this.vaos) gl.deleteVertexArray(v); for (const v of this.labelVaos) gl.deleteVertexArray(v); for (const t of this.textures) gl.deleteTexture(t); }
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.pointers.clear(); this.container.title = ''; this.canvas.remove();
  }
}
