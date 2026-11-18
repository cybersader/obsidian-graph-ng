import { devicePerformance, deviceTier } from './performance';
import { namedViewState, stateChip, type ViewState } from './view-state';
import { plural } from './graph-information';
import { carrierPairs, carrierThrough, carrierFocus, carrierAdmitted } from './carrier-lines';
import { renderPath, type RenderProjection } from './render-projection';
import type { Settings } from './settings';
import { adaptiveRadius, PickGrid, positionTexture, incidentEdges, focusTiers, tintedEdge, edgeBucket, tierNode, tierEdge, tierLabel, segmentDistance, shownTier, shownEdgeTier, tierCounts, tierLift, liftRadius, strongEdge, focusAlpha, offscreenPips, TIERS, ALL_TIERS, PIP_DIRECTIONS, canvasDetailEdges, CanvasLimit, resizeDrawingBuffer, LABEL_RATIOS, PATH_EDGE, pathStroke } from './render-data';
import { readTheme, type GraphTheme } from './render-theme';
import { baseRadius, sizedRadius, sizingSettings, type NodeSizingValues } from './node-sizing';
import { buildLabels, rankFocus, type LabelAtlas } from './render-labels';
import { anchoredLabels, ANCHORED_LABELS, ANCHORED_CANDIDATES, DIRECT_LABELS, LABEL_CHARS, middleTruncate, radialLabels, stickyLevel, tierFont, tierType, type LabelSlot, type LabelItem, labelInView, insetLabel } from './label-layout';
import { carrierCoverage, carrierColors, categorical, degreeSizes, densityScale, edgeAlpha, edgeInk, overdraw, inkShare, edgeRanks, fadeLength, lineAdmitted, type EdgeInk, effectPolicy, prominenceKeep, zoomFade, neutralizeGroups, easeInOut, hoverPulse, groupHalos, isDark, labelFade, nodeColors, type EffectPolicy, type Halo, type RGB } from './render-effects';
import { yieldTask } from './core/scheduler';
import { generationCurrent } from './physics-controls';
import { ConnectionCard, connectionGroups, isolationBar, dockCard, sheetCard, reach, neighbourhood, button, closeButton, el, type CardAction, type CardHost } from './connection-card';
import { interestScorer, byInterest, type Scorer } from './interest';
import { lensConnections, lensLayout, lensAmount, lensCoordinate, pickLens, type LensConnection, type LensPoint } from './lens-layout';
import { Interaction, type RendererControls } from './interaction';
import type { MenuPresenter } from './context-menu';
import { invalidateSearch, disposeSearch } from './search';
import { highlightOverlay, paintLegend } from './overlays';
import { discloseTiers, overlapsBox } from './hub-disclosure';
import { findPath, alternatePath, hopRows, pathNotes, OUTCOME, MAX_ALTERNATES, MAX_HOPS, type Hop } from './path-finder';
import { Minimap, MINIMAP_H, MINIMAP_W, MINIMAP_MIN_CANVAS } from './minimap';
import { Breadcrumb, trimHistory } from './breadcrumb';
import { zoomStep, zoomChip, ZOOM_OUT_LIMIT } from './zoom-limit';
/** Narrowest view left of the graph tools panel that still docks the card beside it (CSS px). */
const TOOLS_MIN_ROOM = 240;
/** Hard DOM bound for graduated focus labels, under `labelsMaxPerViewport`. */
const FOCUS_LABELS = 64;
/** Selection ripple length (ms), and the inset of off-screen pips from the view border (CSS px). */
const RIPPLE_MS = 250, PIP_INSET = 56;
let descriptionId = 0;
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
uniform sampler2D lensPositions;
uniform float lensBlend;
uniform int lensAnchor;
uniform int positionWidth;
uniform vec2 center;
uniform vec2 viewport;
uniform float scale;
uniform float nodeSize;
uniform float pixelRatio;
uniform int hovered;
uniform int edgeNote;
uniform vec2 pulse;
uniform int selected;
uniform int focusNode;
uniform float focus;
uniform float dim;
uniform float carrierAlpha;
uniform float carrierFold;
uniform float carrierSize;
uniform float inkShare;
uniform float focusOnly;
uniform int layer;
uniform int tierMask;
uniform float minSize;
uniform float emphasis;
uniform float rings;
uniform float strong;
ivec2 cell(int id) { return ivec2(id % positionWidth, id / positionWidth); }
vec2 point(int id) {
 vec2 base = texelFetch(positions, cell(id), 0).xy;
 if (lensAnchor >= 0) {
  vec4 lens = texelFetch(lensPositions, cell(id), 0);
  if (lens.z > .5) base += (texelFetch(positions, cell(lensAnchor), 0).xy + lens.xy / scale - base) * lensBlend;
 }
 return (base - center) * scale;
}
vec4 color(int id) { return texelFetch(palette, ivec2(id % 256, id / 256), 0); }
vec4 nodeColor(int id) { return texelFetch(nodeColors, cell(id), 0); }
vec4 state(int id) { return texelFetch(nodeState, cell(id), 0); }
vec4 clip(vec2 p) { return vec4(p / viewport * vec2(2., -2.), 0., 1.); }
const vec2 corners[6] = vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
const vec4 offscreen = vec4(2.,2.,0.,1.);
// Legend toggles: a tier switched off draws as context (shownTier/shownEdgeTier).
float shownTier(float g, bool ego) { int b = int(g * 255. + .5); return ego || b == 255 && (tierMask & 1) != 0 || b == 192 && (tierMask & 2) != 0 || b == 128 && (tierMask & 4) != 0 || b == 64 && (tierMask & 8) != 0 || b != 255 && b != 192 && b != 128 && b != 64 ? g : 0.; }
`;
const nodeVertex = common + glsl`
layout(location=0) in float size;
layout(location=1) in uint carrierRank;
uniform float glow;
out vec2 local;
out vec4 tint;
out float spread;
out float ring;
out vec2 bands;
out vec3 ink;
void main() {
 int id = layer == 2 ? selected : gl_InstanceID; vec4 st = state(id);
 bool retained = carrierRank != 4294967295u && (carrierRank & 33554432u) != 0u;
 st.g = shownTier(st.g, retained || id == focusNode || focusNode < 0 && st.g > .9);
 bool pinned = carrierRank != 4294967295u && (carrierRank & 67108864u) != 0u;
 bool hot = id == hovered || id == selected, note = st.a > .5;
 // Edge notes (state alpha) draw in their own pass beneath the other nodes.
 // A highlighted edge note keeps its highlight but folds with the level of detail.
 float k = note ? (hot ? min(1., carrierAlpha * 2.) : carrierAlpha) : 1.;
 if (note && (carrierRank == 4294967295u || retained && !pinned && float((carrierRank & 16777215u) + 1u) > inkShare * 16777216. || carrierFold < .5 && !retained || focusOnly > 0. && !pinned && (st.g == 0. || focus <= 0.) || !retained && !hot && id != edgeNote && !(st.g > 0. && focus > 0.) && float((carrierRank & 16777215u) + 1u) > inkShare * 16777216.)) k = 0.;
 float radius = nodeSize * size * (note ? carrierSize : 1.) + (hot ? 2. : 0.);
 spread = glow > 0. ? 2.3 : 1.;
 // Graduated tiers: the focus grows 60% with an outer ring, direct notes grow 25%.
 bool ego = id == focusNode; ring = id == selected ? 1. : ego ? focus : 0.; if (ego) spread = max(spread, rings > 0. ? 1.72 : 1.4);
 if (emphasis > 0.) {
  float target = ego ? max(7., minSize) : minSize * (.55 + .45 * emphasis) * (st.g > .9 ? 1. : st.g > .7 ? .75 : st.g > .4 ? .57 : 0.);
  if (!note || ego) radius += max(0., target - radius) * focus;
  float hover = id == hovered ? (pulse.x - 1.) / .6 : 0.;
  radius = max(radius, max(5., minSize) * hover) + hover;
 } else {
 radius *= 1. + focus * (ego ? .6 : st.g > .9 ? .25 : 0.); // ego
 // Screen-space floor per tier: lift (tierLift/liftRadius); contrast ring bands; edge notes are exempt.
 float lift = note ? 0. : minSize * focus * (ego || st.g > .9 ? 1. : st.g > .7 ? .75 : st.g > .4 ? .57 : 0.);
 if (lift > 0. && radius < 2. * lift) radius = lift + radius * radius / (4. * lift);
 // Hover pulse: only the hovered note grows (to at least the tier floor) and rings.
 if (id == hovered) radius = max(radius * pulse.x, minSize * (pulse.x - 1.) / .6);
 }
 if (id == selected) { radius = max(radius, 5.); spread = max(spread, 1.4); }
 if (id == hovered) { ring = max(ring, pulse.y); spread = max(spread, 1.4); }
 bands = note ? vec2(0.) : focus * vec2(rings > .9 && !ego && st.g > .9 ? 1. : 0., rings > 0. && ego ? 1. : 0.); if (bands.x > 0.) spread = max(spread, 1.32);
 // A physical-pixel radius keeps a core sample at every subpixel pan phase (no MSAA).
 radius = max(radius, 1. / pixelRatio);
 if (note) radius = max(radius, 2.);
 ink = color(3).rgb;
 local = corners[int[4](0,1,2,5)[gl_VertexID]] * spread;
 gl_Position = st.r < .5 || st.b > .5 || (layer != 2 && id == selected) || (layer != 2 && note != (layer == 0)) || k < .004 ? offscreen : clip(point(id) + local * radius);
 vec4 c = hot ? color(4) : nodeColor(id);
 tint = vec4(c.rgb, c.a * k * (hot ? 1. : mix(1., dim, focus * (1. - st.g))));
 if ((note || pinned) && k > 0.) tint.a = max(.25, tint.a);
}`;
const nodeFragment = glsl`#version 300 es
precision highp float;
uniform float glow;
in vec2 local; in vec4 tint; in float spread; in float ring; in vec2 bands; in vec3 ink; out vec4 outputColor;
void main() {
 float d = length(local); if (d > spread) discard;
 float core = 1. - smoothstep(.82, 1., d);
 float halo = glow > 0. ? glow * .4 * exp(-3.4 * max(0., d - .9)) * (1. - smoothstep(spread * .75, spread, d)) * (1. - core) : 0.;
 float rim = max(halo, ring * (smoothstep(1.1, 1.16, d) - smoothstep(1.28, 1.34, d)));
 vec3 shade = tint.rgb * (1. - .14 * smoothstep(.5, 1., d));
 outputColor = vec4((shade * core + tint.rgb * rim) * tint.a, (core + rim) * tint.a);
 // Contrast ring bands in the ink (text) colour, source-over inside the fragment: never toward white.
 float o = tint.a * min(1., bands.x * (smoothstep(1.04, 1.1, d) - smoothstep(1.22, 1.28, d)) + bands.y * (smoothstep(1.46, 1.52, d) - smoothstep(1.62, 1.68, d)));
 if (o > 0.) outputColor = mix(outputColor, vec4(ink, 1.), o);
}`;
const edgeVertex = common + glsl`
layout(location=0) in uint source;
layout(location=1) in uint target;
layout(location=2) in uint typeOn;
layout(location=3) in uint tierByte;
layout(location=4) in uint lineRank;
layout(location=5) in uint foldEnd;
uniform float edgeSize;
uniform int edgeHovered;
uniform int segments;
uniform float curvature;
uniform float edgeAlpha;
uniform float direction;
uniform float colorMix;
uniform float fadeLength;
out vec4 tint;
flat out uint seed;
void main() {
 int s = int(source), t = int(target); seed = uint(gl_InstanceID);
 if (lineRank >= 16777216u) seed = lineRank; // Faint carrier legs also round as one relationship.
 bool retained = (lineRank & 33554432u) != 0u;
 int owner = foldEnd == 0u ? (retained ? (state(s).a > .5 ? s : t) : -1) : (foldEnd >= 2147483648u ? s : t);
 bool pinned = foldEnd != 0u && (owner == selected || owner == hovered);
 bool through = owner >= 0 && (retained || carrierFold > .5);
 if (through && carrierAlpha <= 0. || retained && !pinned && float((lineRank & 16777215u) + 1u) > inkShare * 16777216.) { gl_Position = offscreen; return; }
 uint tier = pinned || tierByte == 253u ? 255u : tierByte > 200u ? ((tierMask & 1) != 0 ? tierByte : 0u) : tierByte > 0u && (tierMask & 4) != 0 ? tierByte : 0u;
 if (owner >= 0 && tierByte != 253u && !pinned) tier = uint(shownTier(state(owner).g, retained || owner == focusNode || focusNode < 0 && state(owner).g > .9) * 255. + .5);
 bool hot = gl_InstanceID == edgeHovered || owner >= 0 && (owner == selected || owner == hovered || owner == edgeNote);
 if (foldEnd != 0u && !through) { if (foldEnd >= 2147483648u) { gl_Position = offscreen; return; } t = int(foldEnd) - 1; }
 tint = vec4(0.);
 // Density pass 2 takes only context; pass 3 preserves all protected strokes verbatim.
 if (layer > 1 && (layer == 2) == (tier > 0u && focus > 0. || hot)) { gl_Position = offscreen; return; }
 // The length fade can only reduce this upper bound. Skip texture fetches for most overview rows.
 if (!retained && float((lineRank & 16777215u) + 1u) > inkShare * 16777216. && (tier == 0u || focus <= 0.) && !hot) { gl_Position = offscreen; return; }
 vec4 sa = state(s), sb = state(t);
 if (edgeAlpha <= 0. || typeOn == 0u || sa.r < .5 || sb.r < .5 || focusOnly > 0. && !pinned && tier == 0u) { gl_Position = offscreen; return; }
 // Adjacent triangles share both endpoints; retain the original u arithmetic.
 int segment = gl_VertexID / 2; vec2 c = vec2(-1., (gl_VertexID % 2) == 0 ? -1. : 1.);
 float u = (float(segment) + (c.x + 1.) * .5) / float(segments);
 vec2 a = point(s), b = point(t), delta = b - a; float len = length(delta);
 // Ink budget: inkShare of the context lines, kept while their stable rank is under inkShare × the long-line fade
 // (fadeLength, CSS px), draw whole; zooming in only adds lines. Dropped (quiet 0) lines are not rasterized.
 // Carrier legs share a rank and cannot be length-faded independently.
 float share = inkShare * (lineRank >= 16777216u ? 1. : min(1., fadeLength / max(len, 1.)));
 float quiet = retained || hot || share * 16777216. >= float((lineRank & 16777215u) + 1u) ? 1. : 0.;
 if (!retained && quiet < .5 && (tier == 0u || focus <= 0.) && !hot) { gl_Position = offscreen; return; }
 vec2 normal = len > 0. ? vec2(-delta.y, delta.x) / len : vec2(0., 1.);
 vec2 q = (a + b) * .5 + normal * len * curvature;
 vec2 tangent = mix(q - a, b - q, u); float tl = length(tangent);
 vec2 side = tl > 0. ? vec2(-tangent.y, tangent.x) / tl : normal;
 float wide = max(.5, edgeSize) * (1. + focus * (tier > 200u ? .6 : 0.));
 if (strong > 0.) wide *= 1. + focus * (tier > 200u ? .6 : 0.);
 gl_Position = clip(mix(mix(a, q, u), mix(q, b, u), u) + side * c.y * wide);
 vec3 rgb = mix(color(1).rgb, mix(nodeColor(s).rgb, nodeColor(t).rgb, u), colorMix);
 float alpha = edgeAlpha * (direction > .5 ? mix(.12, 1., u) : 1.);
 alpha *= (tier > 0u ? mix(quiet, 1., focus) : quiet) * (focusOnly > 0. && !pinned ? focus : 1.);
 if (focus > 0.) alpha = mix(alpha, tier > 200u ? min(1., alpha * 3.) : tier > 0u ? alpha : alpha * dim * .6, focus);
 // Strong focus edges (strongEdge): degree-scaled direct fan, the rest fades further.
 if (strong > 0.) alpha = tier > 200u ? alpha + ((alpha > 0. ? strong : 0.) - alpha) * focus : alpha * (1. - focus * (tier > 0u ? .5 : .65));
 if (tier == 254u || tier == 127u) rgb = mix(rgb, color(4).rgb, focus * .5);
 if (tierByte == 253u) { rgb = mix(rgb, color(4).rgb, focus); alpha += (1. - alpha) * focus; wide *= 1. + 1.5 * focus; gl_Position = clip(mix(mix(a, q, u), mix(q, b, u), u) + side * c.y * wide); }
 if (gl_InstanceID == edgeHovered) { rgb = color(4).rgb; alpha = min(1., max(alpha, edgeAlpha) * 3.); }
 if (through && alpha > 0.) alpha = max(.25, alpha);
 tint = vec4(rgb * alpha, alpha);
 if (layer == 2) tint *= .25;
}`;
// One rounding threshold per edge, shared across its segments and premultiplied RGBA.
// Screen-pixel noise broke faint strokes and shimmered on pan. Zero stays zero; RGB <= alpha.
const solidFragment = glsl`#version 300 es
precision highp float; precision highp int; in vec4 tint; flat in uint seed; out vec4 outputColor;
void main() {
 uint h = seed * 26699u; h = (h ^ (h >> 16)) * 73244475u; h ^= h >> 16;
 outputColor = floor(tint * 255. + (float(h & 1023u) + .5) / 1024.) / 255.;
}`;
// One bounded RGBA8 target: quarter-scaled premultiplied ink, independent of float extensions.
// A power shoulder suppresses faint overlap without erasing isolated strokes. Saturated
// RGBA8 density uses the configured edge colour rather than clipped RGB (which turns white).
const densityVertex = common + glsl`
out vec2 uv;
void main() { vec2 q = corners[gl_VertexID]; uv = (q + 1.) * .5; gl_Position = vec4(q, 0., 1.); }`;
const densityFragment = glsl`#version 300 es
precision highp float; uniform sampler2D atlas; uniform vec3 outline; in vec2 uv; out vec4 outputColor;
void main() {
 vec4 c = texture(atlas, uv); float d = c.a * 4.;
 float a = min(.9, .2 * d + .8 * d * d / (1. + d * d));
 vec3 rgb = c.a < .99 ? c.rgb / max(c.a, .00001) : outline;
 outputColor = vec4(rgb * a, a);
}`;
const labelVertex = common + glsl`
layout(location=0) in vec4 a;
layout(location=1) in vec4 b;
layout(location=2) in vec3 extra;
layout(location=3) in vec2 bounds;
uniform float labelAlpha;
uniform float labelCut;
out vec2 uv;
out vec4 tint;
void main() { vec2 q = (corners[gl_VertexID] + 1.) * .5; int id = int(a.x); vec4 st = state(id);
 float alpha = labelAlpha * smoothstep(labelCut, labelCut + .15, extra.y);
 alpha = mix(alpha, st.g > .1 ? 0. : alpha * dim * .5, focus);
 vec2 origin = point(id) + vec2(extra.z * nodeSize, 0.), box = origin + vec2(bounds.x, a.z) + viewport * .5;
 bool inside = all(greaterThanEqual(box, vec2(b.x))) && all(lessThanEqual(box + vec2(bounds.y, b.x), viewport - b.x));
 gl_Position = st.r < .5 || st.b > .5 || alpha <= .004 || !inside ? offscreen : clip(origin + a.yz + q * vec2(a.w, b.x));
 uv = b.yz + q * vec2(b.w, extra.x); tint = vec4(color(3).rgb, alpha);
}`;
const labelFragment = glsl`#version 300 es
precision highp float; uniform sampler2D atlas; uniform vec3 outline; uniform float plates;
in vec2 uv; in vec4 tint; out vec4 outputColor;
void main() {
 // Plates come only from each label's own plate quad (uv (0, 2) clamps to a padding texel); glyph quads draw ink alone.
 float a = texture(atlas, uv).a, alpha = (uv.y > 1.5 ? plates : a) * tint.a;
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
const UNIFORMS = ['lensPositions', 'lensBlend', 'lensAnchor', 'positions', 'palette', 'nodeColors', 'nodeState', 'positionWidth', 'center', 'viewport', 'scale', 'nodeSize', 'pixelRatio', 'hovered', 'edgeNote', 'pulse', 'selected', 'focusNode', 'focus', 'dim', 'glow', 'edgeSize', 'edgeHovered', 'segments', 'curvature', 'edgeAlpha', 'direction', 'colorMix', 'inkShare', 'fadeLength', 'focusOnly', 'labelAlpha', 'labelCut', 'atlas', 'outline', 'plates', 'discAlpha', 'hub', 'carrierAlpha', 'carrierFold', 'carrierSize', 'layer', 'tierMask', 'minSize', 'emphasis', 'rings', 'strong'];
interface Program { handle: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> }
interface Camera { x: number; y: number; ratio: number }
/** Runtime view masks from the worker's explore result; colors stay worker-computed. */
export interface RenderView { loading?: boolean; groupCodes?: Uint32Array; groupLabels?: readonly string[]; collapsed?: Uint8Array; typeHidden?: Uint8Array; colors?: Uint32Array }
interface Hub { group: number; x: number; y: number; count: number; radius: number }

/** Draw directly from projection columns. Camera frames touch uniforms only. */
export class DetailRenderer {
  readonly canvas: HTMLCanvasElement;
  /** Fixed camera frame for the lifetime of this renderer. */
  grid: PickGrid;
  private cameraFrame: Pick<PickGrid, 'minX' | 'minY' | 'width' | 'height'>;
  private coordinateRevision = 0;
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
  /** Host seams for the connection card: open in a reused, new-tab or split leaf, and copy a wikilink. */
  openNote?: (path: string, mode: 'reuse' | 'tab' | 'split') => void;
  copyLink?: (path: string) => void;
  /** Public-cache presentation title. Never changes paths, identity or projection columns. */
  noteTitle?: (path: string) => string;
  /** Host seam for the context menu (src/context-menu.ts `obsidianMenu`). */
  showMenu?: MenuPresenter;
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
  /** Overlay panels labels must avoid (Recent/legend stack, minimap) and their cached [x, y, w, h]
   * rects: measured on resize and from their own ResizeObserver, never per frame. */
  private panels: HTMLElement[] = [];
  private panelRects: number[][] = [];
  private panelObserver?: ResizeObserver;
  /** The hover label's [key, width, height], measured once per caption/font change. */
  private hoverBox: [string, number, number] = ['', 0, 0];
  private moreSize = [0, 0];
  /** Direct connections the label layout ranked (the "+N more" total before shown labels). */
  private moreTotal = 0;
  private media = matchMedia('(prefers-color-scheme: dark)');
  private motionMedia = matchMedia('(prefers-reduced-motion: reduce)');
  private still() { return devicePerformance.fast(this.settings.performance) || this.settings.visuals.motion !== 'full' || this.motionMedia.matches; }
  private motionChanged = () => this.refresh();
  private programs: Program[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  private buffers: WebGLBuffer[] = [];
  private textures: WebGLTexture[] = [];
  private densityBuffer: WebGLFramebuffer | null = null;
  private densitySize = [0, 0];
  private densityReady = false;
  private labelBuffers: WebGLBuffer[] = [];
  private atlasWidth = 0;
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
  private isolationEdges?: Set<number>;
  private lineRanks: Uint32Array = new Uint32Array(0);
  /** Per-edge focus tier bytes (255 direct, 128 context, 0 rest), uploaded as edge attribute 3. */
  private edgeTier: Uint8Array;
  private tierEdges: number[] = [];
  private tierPartial = 0;
  private visibleEdges = 0;
  private visibleNodes = 0;
  /** Edge notes (reified edges drawn as nodes): total and render-visible. */
  readonly carrierCount: number;
  private carrierGeometry!: ReturnType<typeof carrierPairs>;
  private visibleCarriers = 0;
  private near: number[] = [];
  private focusNode = -1;
  private lensAnchor = -1;
  private lensWanted = -1;
  private lensBlend = 0;
  private lensMotion?: { from: number; to: number; start: number };
  private lensPoints = new Map<number, LensPoint>();
  private lensRows: LensConnection[] = [];
  private interestMemo?: { key: unknown[]; score: Scorer };
  private lensBytes = new Float32Array();
  private lensRadius = 0;
  private lensLabelWidth = 0;
  private lensRevision = 0;
  onLensChange?: () => void;
  onViewStateChange?: () => void;
  tuneViewState?: (state: ViewState) => void;
  showViewGroups?: () => void;
  private stateStrip?: HTMLElement;
  private stateStamp = '';
  get namedViewState(): ViewState { return namedViewState(false, !!this.pathView, this.lensWanted >= 0, !!this.isolation, this.selected >= 0 && !!this.filterVisible[this.selected]); }
  leaveViewState(state: ViewState) {
    if (state === 'Only connections') this.isolate(-1);
    else if (state === 'Connection rings') this.setLens(-1);
    else this.selectNote(-1, false, true);
    this.canvas.focus();
  }
  private switchViewState(state: ViewState) {
    const n = this.lensWanted >= 0 ? this.lensWanted : this.pathView?.from ?? this.isolation?.node ?? this.selected;
    if (state === 'Groups') return this.showViewGroups?.();
    if (state === 'Notes') { this.setLens(-1); this.selectNote(-1); this.isolate(-1); }
    else if (n >= 0 && this.visible[n]) {
      this.setLens(-1); this.selectNote(n, true);
      if (state === 'Only connections') this.isolate(n);
      else if (state === 'Connection rings') this.setLens(n);
      else this.isolate(-1);
    }
    this.canvas.focus();
  }
  private syncViewState() {
    if (!this.stateStrip) return;
    const state = this.namedViewState, n = this.lensWanted >= 0 ? this.lensWanted : this.pathView?.from ?? this.isolation?.node ?? this.selected;
    const available = n >= 0 && !!this.visible[n];
    const stamp = `${state}|${n}|${this.pathView?.to}|${this.isolation?.node}|${available}`;
    if (stamp === this.stateStamp) return;
    this.stateStamp = stamp; this.stateStrip.textContent = '';
    const tune = (s: ViewState) => this.tuneViewState?.(s);
    stateChip(this.stateStrip, state, state !== 'Notes' && n >= 0 ? this.name(n) + (state === 'Path between notes' ? ' → ' + this.name(this.pathView!.to) : '') : '', () => this.leaveViewState(state), tune, s => this.switchViewState(s), available);
    if (this.isolation && state !== 'Only connections') stateChip(this.stateStrip, 'Only connections', '', () => this.leaveViewState('Only connections'), tune);
    if (this.isolation) this.stateStrip.createSpan({ cls: 'graph-ng-screen-reader', text: `Only connections of ${this.name(this.isolation.node)}`, attr: { role: 'status' } });
    this.onViewStateChange?.();
  }
  private tierSource: number | number[] = -1;
  private focusLevel = 0;
  private focusTarget = 0;
  private focusAt = 0;
  private focusFrom = 0;
  private flight?: { from: Camera; to: Camera; start: number; ms: number };
  private halos: Halo[] = [];
  private hubs: Hub[] = [];
  private discData: Float32Array[] = [new Float32Array(), new Float32Array()];
  private overlay: HTMLElement;
  private hoverLabel: HTMLElement;
  /** Selection card root: the connection navigator for a note, or the relationship card for a line. */
  private noteCard: HTMLElement;
  private card: ConnectionCard;
  /** Connection-list row under the pointer or keyboard focus: drawn as a ring and a leader line. */
  private cue = -1;
  private cueRing: HTMLElement;
  private cueLine: HTMLElement;
  private cardRect = [0, 0, 0, 0];
  /** Host measure of the graph tools panel's overlap with the view's right edge (CSS px). */
  measureTools?: () => number;
  private toolsInset = 0;
  /** Neighbourhood: a temporary mask over the host's filter, recomputed when the host view changes. */
  private baseVisible: Uint8Array;
  private isolation?: { node: number; hops: number; expanded: Set<number>; shown: number[] };
  private frontier = new Map<number, number>();
  private frontierBadges: { node: number; el: HTMLElement; width: number }[] = [];
  private neighbourhoodPartial = false;
  private isolationBar: HTMLElement;
  private hubLabels: HTMLElement[] = [];
  /** Graduated focus labels: placed slots (radial offsets, optional leader), their DOM text and leader lines, and the key they were placed at. */
  private rankedLabels: LabelSlot[] = [];
  private tierLabels: HTMLElement[] = [];
  private tierLeaders: HTMLElement[] = [];
  private anchorPool: HTMLElement[] = [];
  private anchorKey: unknown[] = [];
  private anchorNames: { node: number; rank: number; tier: number; text: string; w: number }[] = [];
  private anchorPrevious = new Map<number, number>();
  /** Direct connections without a label fold into one "+N more" button beside the focus. */
  private moreButton?: HTMLButtonElement;
  private moreAt?: { dx: number; dy: number };
  /** The card's open hub sections, lit alone on the graph (see `discloseTiers`). */
  private disclosed?: { node: number; direct: Set<number>; second: Set<number> };
  /** Label level of detail with hysteresis (see `stickyLevel`). */
  private labelLevel = -1;
  /** Host seam: "+N more" beside the focus asks the host to list all connections. No-op by default. */
  onMoreConnections: (focus: number) => void = () => {};
  private rankedKey: unknown[] = [];
  private measure?: CanvasRenderingContext2D;
  /** Legend emphasis switches (bit per TIERS row), per-tier counts and the cached direct list (O(degree) per frame). */
  private tierMask = ALL_TIERS;
  private tierTotals = [0, 0, 0, 0];
  private directs: number[] = [];
  private pipXY = new Float64Array();
  private pipTargets: number[] = [];
  private pipEls!: HTMLElement[];
  private legend!: HTMLElement;
  private legendRows!: HTMLElement[];
  private legendCounts!: HTMLElement[];
  private pipParts!: [HTMLElement, HTMLElement][];
  private rippleEl!: HTMLElement;
  /** Pointer, wheel and key input (src/interaction.ts). The handler fields are the input seams tests and the card call. */
  private input: Interaction;
  private pointerDown: (e: PointerEvent) => void;
  private pointerMove: (e: PointerEvent) => void;
  private pointerUp: (e: PointerEvent) => void;
  private pointerLeave: (e?: PointerEvent) => void;
  private keyDown: (e: KeyboardEvent) => void;
  private ripple?: { start: number; reach: number };
  /** The previewed note (the hover, or the one easing back), when it changed, whether it is leaving; the current [scale, ring]. */
  private carrierPins: number[] = [];
  private carrierPinKey: unknown[] = [];
  private hoverFx = { n: -1, at: 0, out: false }; private fx = [1, 0];
  /** "How are these connected?": endpoints, paths found so far (shown: `hops`), its rows and the outcome note. */
  private pathView?: { from: number; to: number; found: Hop[][]; hops: Hop[]; edges: number[]; note: string };
  /** Two endpoint rings, then numbered hop badges (at most MAX_HOPS). */
  private pathMarks: HTMLElement[] = [];
  /** Orientation overlays: corner minimap, visited-notes trail and the zoom-out clamp chip. */
  private miniMap: Minimap;
  private crumbTrail: Breadcrumb;
  private limitChip: ReturnType<typeof zoomChip>;
  static async create(container: HTMLElement, p: RenderProjection, positions: Float32Array, visible: Uint8Array, settings: Settings, onNode: (i: number) => void, onZoomOut: () => void, colors: Uint32Array, current = () => true, software = false, onUnavailable = onZoomOut, view: RenderView = {}) {
    await yieldTask(); if (!current()) throw new Error('Renderer superseded');
    let renderer: DetailRenderer | undefined;
    try {
      renderer = new DetailRenderer(container, p, positions, visible, settings, onNode, onZoomOut, colors, software, onUnavailable, view);
      renderer.canvas.style.visibility = 'hidden';
      await renderer.initialize();
      if (!current()) throw new Error('Renderer superseded');
      await renderer.prepareLabels(current);
      if (!current()) throw new Error('Renderer superseded');
      renderer.draw(); renderer.canvas.style.visibility = ''; return renderer;
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
    this.filterVisible = this.baseVisible = visible; this.visible = visible; this.picker = this.grid; this.display = positions; this.colors = colors;
    this.carrierCount = projection.carrierNodes.reduce((n, v) => n + +!!v, 0);
    this.labelCarrierSize = settings.visuals.carrierSize;
    this.keep = 1; this.sizes = degreeSizes(projection.offsets, settings.visuals.degreeSizing, settings.visuals.degreeCurve); this.edgeOn = new Uint8Array(projection.source.length).fill(1); this.edgeTier = new Uint8Array(projection.source.length);
    this.timings.grid = performance.now() - started; started = performance.now();
    this.theme = readTheme(container, settings);
    this.timings.theme = performance.now() - started; started = performance.now();
    this.canvas = document.createElement('canvas'); this.canvas.className = 'graph-ng-detail'; this.canvas.tabIndex = 0; this.canvas.style.touchAction = 'none'; container.append(this.canvas);
    this.overlay = container.createDiv ? container.createDiv({ cls: 'graph-ng-overlay' }) : container.appendChild(el('div', '', 'graph-ng-overlay'));
    const help = this.overlay.appendChild(el('span', 'Graph notes. Arrows select, Enter opens, R cycles relationships, L toggles connection rings, Shift+F10 opens the menu, Alt+Left goes back, Escape clears.', 'graph-ng-screen-reader'));
    help.id = `graph-ng-help-${++descriptionId}`; this.canvas.setAttribute('aria-describedby', help.id);
    this.hoverLabel = this.overlay.appendChild(el('div', '', 'graph-ng-hover-label'));
    const div = (className: string) => this.overlay.appendChild(el('div', '', className));
    this.cueLine = div('graph-ng-cue-line'); this.cueRing = div('graph-ng-cue'); this.cueLine.hidden = this.cueRing.hidden = true;
    this.isolationBar = el('div', '', 'graph-ng-isolation');
    this.miniMap = new Minimap(this.overlay, this.cameraFrame, (x, y) => { this.followLayout = false; this.setCamera(x, y, this.camera.ratio); }, () => this.fitAll(), () => this.refresh()); this.limitChip = zoomChip(this.overlay, () => this.onZoomOut());
    this.noteCard = div('graph-ng-card'); this.card = new ConnectionCard(this.noteCard, this.cardHost());
    const input = this.input = new Interaction(this.controls());
    ({ pointerDown: this.pointerDown, pointerMove: this.pointerMove, pointerUp: this.pointerUp, pointerLeave: this.pointerLeave, keyDown: this.keyDown } = input);
    this.noteCard.onkeydown = input.cardKeyDown;
    let stack: HTMLElement;
    ({ ripple: this.rippleEl, stack, legend: this.legend, rows: this.legendRows, counts: this.legendCounts, pips: this.pipEls, parts: this.pipParts } = highlightOverlay(this.overlay, i => { this.tierMask ^= 1 << i; this.updateLegend(); this.rankedKey = []; this.anchorKey = []; this.refresh(); }, i => this.panTo(this.pipTargets[i] ?? -1)));
    this.stateStrip = stack.createDiv({ cls: 'graph-ng-state-strip' });
    stack.appendChild(this.isolationBar);
    this.crumbTrail = new Breadcrumb(stack, n => this.path(n).split('/').pop()!.replace(/\.md$/, ''), by => this.card.step(by), () => { this.clearTrail(); this.canvas.focus(); }, (index, newer) => {
      const h = this.card.history;
      if (newer && h.at > index) this.card.step(index - h.at);
      else if (!newer && h.at === index) this.card.step(index ? -1 : 1);
      trimHistory(h, index, newer); if (this.card.node >= 0) this.card.render(); this.refresh();
      if (h.items.length < 2) this.canvas.focus();
    });
    this.panels = [stack, this.miniMap.root];
    this.resize();
    this.gl = software ? null : this.canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    this.timings.context = performance.now() - started;
    this.gpu = Boolean(this.gl);
    if (!this.gl) {
      try { this.canvasEdges = canvasDetailEdges(projection, visible, settings.canvasMaxDetailNodes, settings.canvasMaxDetailEdges); } catch (e) { this.canvas.remove(); this.overlay.remove(); throw e; }
      this.ctx = this.canvas.getContext('2d'); if (!this.ctx) { this.canvas.remove(); this.overlay.remove(); throw new Error('CANVAS_UNAVAILABLE'); }
    }
    this.packState(); this.setView(visible, view, false); if (!view.loading) this.fitAll(0);
    this.overlay.hidden = !!view.loading;
    this.canvas.addEventListener('webglcontextlost', this.contextLost); this.canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.layoutActive = !!view.loading; input.attach(this.container);
    this.media.addEventListener('change', this.refreshTheme);
    this.motionMedia.addEventListener('change', this.motionChanged);
    this.observer = new ResizeObserver(() => { const changed = this.resize(); this.syncTools(); if (changed && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {}); }); this.observer.observe(container);
    this.panelObserver = new ResizeObserver(() => { if (this.measurePanels()) this.refresh(); }); for (const el of this.panels) this.panelObserver.observe(el);
  }
  /** Cache overlay panel rects in overlay coordinates; true when any changed. */
  private measurePanels() {
    const next = (this.panels ?? []).map(el => [el.offsetLeft || 0, el.offsetTop || 0, el.offsetWidth || 0, el.offsetHeight || 0]), old = this.panelRects ?? [];
    this.panelRects = next; return next.some((r, i) => r.some((v, j) => v !== old[i]?.[j]));
  }
  private packState() {
    const packed = positionTexture(this.positions); this.positionWidth = packed.width; this.positionHeight = packed.height;
    const cells = packed.width * packed.height * 4; this.stateBytes = new Uint8Array(cells); this.colorBytes = new Uint8Array(cells); this.lensBytes = new Float32Array(cells);
  }
  /** Apply worker view masks without rebuilding the renderer. O(n + m), no worker calls. An active
   * neighbourhood mask is re-applied over the new host filter. */
  setView(filterVisible: Uint8Array, view: RenderView, upload = true) {
    this.baseVisible = filterVisible; this.applyView(this.isolationMask(filterVisible, view), view, upload); this.showIsolation();
  }
  /** Clear the visit history; an open card stays as its only entry and drops its stale Back/Forward. */
  clearTrail() { const n = this.card.node; this.card.history.clear(); if (n >= 0) { this.card.history.visit(n); this.card.render(); } this.refresh(); }
  private applyView(filterVisible: Uint8Array, view: RenderView, upload = true) {
    const started = performance.now(), n = filterVisible.length, p = this.projection;
    // Software detail stays inside both refusal budgets: refuse before any state changes, never truncate.
    const canvasEdges = !this.gl && this.ctx ? canvasDetailEdges(p, filterVisible, this.settings.canvasMaxDetailNodes, this.settings.canvasMaxDetailEdges) : undefined;
    invalidateSearch(this.canvas); this.input?.gestures.cancel();
    const visibleChanged = filterVisible !== this.filterVisible || view.collapsed !== this.view.collapsed || view.groupCodes !== this.view.groupCodes;
    this.filterVisible = filterVisible; this.view = view; this.groupCount = view.groupLabels?.length ?? 0; if (view.colors && view.colors.length === filterVisible.length) this.colors = view.colors;
    Object.assign(this, this.coordinateState(this.positions, filterVisible, view));
    const render = this.visible;
    const hiddenTypes = view.typeHidden; this.visibleEdges = 0;
    for (let e = 0; e < p.source.length; e++) { const on = hiddenTypes?.[p.type[e]!] || this.isolationEdges && !this.isolationEdges.has(e) ? 0 : 1; this.edgeOn[e] = on; if (on && filterVisible[p.source[e]!] && filterVisible[p.target[e]!]) this.visibleEdges++; }
    this.visibleNodes = this.visibleCarriers = 0; const notes = p.carrierNodes;
    for (let i = 0; i < n; i++) { const o = i * 4; this.stateBytes[o] = filterVisible[i] ? 255 : 0; this.stateBytes[o + 2] = filterVisible[i] && !render[i] ? 255 : 0; this.stateBytes[o + 3] = notes[i] ? 255 : 0; if (render[i]) { this.visibleNodes++; if (notes[i]) this.visibleCarriers++; } }
    if (canvasEdges) this.canvasEdges = canvasEdges;
    const card = this.card;
    card?.history.retain(n => !!this.baseVisible[n]);
    const path = this.pathView;
    if (path ? !render[path.from] || !render[path.to] || !path.edges.every(e => this.edgeDrawn(e) && render[p.source[e]!] && render[p.target[e]!]) : this.selectedEdges?.length ? !this.selectedEdges.every(this.edgeDrawn) : !filterVisible[this.selected]) { this.pathView = undefined; this.selectedEdges = []; this.edgeToken++; card?.hide(); }
    else if (card && card.node >= 0 && card.node === this.selected) card.render();
    this.lineRanks = edgeRanks(p.source, p.target, p.offsets, view.groupCodes, p.interest, this.edgeDrawn, p.carrier, p.carrierNodes);
    this.carrierGeometry = carrierPairs(p, this.edgeOn, filterVisible, this.lineRanks); this.pinCarriers(true);
    if (this.near.length || this.selected >= 0 && this.ready) this.emphasize(true);
    this.recolor(); this.choosePolicy(); this.ink = undefined;
    if (this.lensAnchor >= 0) { if (!render[this.lensAnchor]) this.setLens(-1); this.rebuildLens(); }
    this.updateSizingRange();
    this.input?.replayHover();
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
  private layoutActive = false;
  private followLayout = true;
  private labelsPending = false;
  /** A preview and its replacement have different normalized frames. Preserve world center/scale,
   * including gestures made while the replacement was preparing, and keep follow cancelled. */
  adoptCamera(previous: DetailRenderer) {
    this.followLayout = previous.followLayout;
    if (this.followLayout) return false;
    const f = this.cameraFrame;
    this.setCamera((previous.centerX - f.minX) / f.width, (previous.centerY - f.minY) / f.height, previous.camera.ratio * this.fit / previous.fit);
    return true;
  }
  /** Keep pan/zoom and the last layout, suppress stale labels and picking until adoption.
   * Failed/superseded applies restore CPU geometry without rolling back the user's camera. */
  beginLayout() {
    const { positions, display, grid, picker, visible, hubs, halos, discData } = this;
    const previous = { positions, display, grid, picker, visible, hubs, halos, discData }, view = this.view, filter = this.filterVisible;
    this.followLayout = true; this.layoutActive = true; this.labelsRevision++; this.overlay.hidden = true; this.refresh();
    return (committed: boolean) => {
      this.layoutActive = false;
      if (this.disposed) return;
      try {
        if (!committed) {
          const changed = this.positions !== positions; Object.assign(this, previous);
          if (view !== this.view || filter !== this.filterVisible) { Object.assign(this, this.coordinateState(positions, this.filterVisible, this.view)); this.discData = this.discs(this.halos, this.hubs); }
          if (changed && this.gl && this.usable) this.uploadCoordinates();
        }
      } catch (e) { throw new Error(`Last-good CPU coordinates retained; GPU recovery uncertain: ${e}`); }
      finally {
        if (committed) { this.labelsPending = false; if (this.followLayout) this.fitAll(); }
        else if (this.labelsPending) void this.prepareLabels(() => !this.disposed).catch(() => {});
        this.anchorKey = []; this.rankedKey = []; this.overlay.hidden = !!this.view.loading; this.refresh();
      }
    };
  }
  /** Progressed frames retain the camera frame. Live Apply keeps input attached. */
  streamPositions(next: Float32Array, paint = false) {
    if (!(this.view.loading || this.layoutActive) || !this.usable || next.length !== this.positions.length || !next.every(Number.isFinite)) throw new Error('Layout preview unavailable');
    const previous = this.positions;
    const geometry = this.coordinateState(next, this.filterVisible, this.view);
    this.positions = next;
    Object.assign(this, geometry); this.discData = this.discs(geometry.halos, geometry.hubs);
    if (this.gl) this.uploadCoordinates();
    this.followExtent(); if (paint) this.draw(); else this.refresh(); return previous;
  }
  /** Only zoom outward while streaming; a gesture permanently releases this run. */
  private followExtent() {
    if (!this.followLayout) return;
    const g = this.grid, ratio = Math.max(Math.abs(g.minX - this.centerX), Math.abs(g.minX + g.width - this.centerX)) * 2.2 * this.fit / this.width;
    const needed = Math.max(ratio, Math.max(Math.abs(g.minY - this.centerY), Math.abs(g.minY + g.height - this.centerY)) * 2.2 * this.fit / this.height);
    if (needed > (this.flight?.to.ratio ?? this.camera.ratio) * 1.02) this.flyTo(this.camera.x, this.camera.y, needed);
  }
  async preparePositions(next: Float32Array, current: () => boolean): Promise<CoordinateToken> {
    const revision = ++this.coordinateRevision; ++this.labelsRevision;
    const same = generationCurrent(() => [this.coordinateRevision, this.labelsRevision, this.positions, this.view, this.filterVisible, this.theme, this.width, this.height, this.settings.nodeSize, this.settings.labelSize, this.settings.labelDensity, this.settings.labelGridCellSize, this.settings.labelsMaxPerViewport, this.settings.labelCandidateMultiplier, this.settings.visuals.labelTierScale, this.settings.visuals.hubsMaxGroups, this.settings.visuals.halosMaxGroups]);
    const valid = () => current() && this.usable && same();
    const check = () => { if (!valid()) throw new Error('Coordinate generation changed or renderer unavailable'); };
    check(); if (next.length !== this.projection.nodeCount * 2) throw new Error('RENDER_POSITION_COUNT');
    const started = performance.now();
    for (let i = 0; i < next.length; i++) {
      if (!Number.isFinite(next[i])) throw new Error('RENDER_NONFINITE_POSITION');
      if (i % 8192 === 0) { await yieldTask(); check(); }
    }
    let prepared: (ReturnType<DetailRenderer['coordinateState']> & { positions: Float32Array; atlas: LabelAtlas; discData: Float32Array[]; homeRatio: number }) | undefined;
    const geometry = this.coordinateState(next, this.filterVisible, this.view);
    await yieldTask(); check();
    const atlas = await buildLabels(this.projection, { ...this.cameraFrame, positions: next, visible: geometry.visible }, this.sizingSettings(), this.width, this.height, this.theme.font, valid);
    check();
    prepared = { ...geometry, positions: next, atlas, discData: this.discs(geometry.halos, geometry.hubs), homeRatio: this.layoutRatio(geometry.grid) };
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
          Object.assign(this, prepared); this.anchorKey = []; this.rankedKey = []; upload(); committed = true;
          this.input.replayHover();
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
    while (this.hubLabels.length < Math.min(64, this.hubs.length)) this.hubLabels.push(this.overlay.appendChild(el('div', '', 'graph-ng-hub-label')));
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
  /** Shared GL setup; callers retain upload order, formats and ownership. */
  private arrayData(buffer: WebGLBuffer, data: ArrayBufferView, usage: number = this.gl!.STATIC_DRAW) {
    const gl = this.gl!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  }
  private textureUnit(unit: number) {
    const gl = this.gl!; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]!); return gl;
  }
  private textureFilter(filter: number) {
    const gl = this.gl!; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  }
  private floatAttribute(location: number, size: number, stride: number, offset: number) {
    const gl = this.gl!; gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset); gl.vertexAttribDivisor(location, 1);
  }
  private buffer(data: ArrayBufferView, usage = this.gl!.STATIC_DRAW) { const gl = this.gl!, b = gl.createBuffer()!; this.buffers.push(b); this.arrayData(b, data, usage); return b; }
  private integer(location: number, data: Uint32Array | Uint8Array) { const gl = this.gl!, b = this.buffer(data); gl.enableVertexAttribArray(location); gl.vertexAttribIPointer(location, 1, data instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(location, 1); return b; }
  private texture(unit: number) { const gl = this.gl!, t = gl.createTexture()!; this.textures[unit] = t; this.textureUnit(unit); this.textureFilter(gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
  private bytes(unit: number, data: Uint8Array) { const gl = this.textureUnit(unit); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.positionWidth, this.positionHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); }
  private async initialize() {
    if (this.disposed || this.lost) return;
    const gl = this.gl;
    if (!gl) { this.ready = true; this.refresh(); return; }
    for (const [v, f] of [[edgeVertex, solidFragment], [nodeVertex, nodeFragment], [labelVertex, labelFragment], [discVertex, discFragment], [densityVertex, densityFragment]]) {
      const started = performance.now(); this.programs.push(await this.program(v!, f!)); this.timings[`program${this.programs.length}`] = performance.now() - started; await yieldTask(); if (this.disposed || this.lost) return;
    }
    // ResizeObserver may fire while parallel shader compilation is pending.
    // Resizing that drawing buffer synchronously waits on the driver; apply its
    // latest CSS size only after all program completion polls have finished.
    await this.waitForResize(); this.resize(true);
    const uploadStart = performance.now(), max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (this.positionWidth > max || this.positionHeight > max || this.theme.palette.length / 1024 > max) throw new Error('GL_TEXTURE_LIMIT');
    for (let unit = 0; unit < 6; unit++) this.texture(unit);
    this.uploadPalette(); this.uploadLens();
    for (let i = 0; i < 2; i++) { const vao = gl.createVertexArray()!; this.vaos.push(vao); gl.bindVertexArray(vao);
      if (i === 0) { this.integer(0, this.projection.source); this.integer(1, this.projection.target); this.integer(2, this.carrierGeometry.enabled); this.integer(3, this.edgeTier); }
      else { this.buffer(this.sizes); this.floatAttribute(0, 1, 0, 0); }
      await yieldTask(); if (this.disposed || this.lost) return;
    }
    gl.bindVertexArray(this.vaos[0]!); this.integer(4, this.lineRanks); this.integer(5, this.carrierGeometry.ends);
    gl.bindVertexArray(this.vaos[1]!); this.integer(1, this.carrierGeometry.nodes);
    for (let i = 0; i < 2; i++) { const vao = gl.createVertexArray()!, b = gl.createBuffer()!; this.vaos.push(vao); this.discBuffers[i] = b; gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      for (let a = 0; a < 2; a++) this.floatAttribute(a, 4, 32, a * 16); }
    // Append after the fixed-index instance buffers used by uploads. Element bindings
    // belong to their VAOs; labels, discs and the fullscreen density quad stay unindexed.
    // 32 segments is the validated settings ceiling (straight edges use the first six).
    for (let v = 0; v < 2; v++) {
      gl.bindVertexArray(this.vaos[v]!); const b = gl.createBuffer()!; this.buffers.push(b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
      const indices: number[] = [];
      if (v === 0) for (let s = 0; s < 32; s++) indices.push(2 * s, 2 * s + 2, 2 * s + 1, 2 * s + 1, 2 * s + 2, 2 * s + 3);
      else indices.push(0, 1, 2, 2, 1, 3);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    }
    gl.bindVertexArray(null); this.uploadView();
    this.timings.upload = performance.now() - uploadStart;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    await this.waitForResize(); this.resize(true); this.ready = true; if (this.gl && deviceTier(undefined, undefined, this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE), /swiftshader|llvmpipe|software/i.test(String(this.gl.getParameter(this.gl.RENDERER)))) === 'low') devicePerformance.tier = 'low'; if (this.atlas) this.uploadLabels(); this.refresh();
  }
  /** Lazy, at most 2048² RGBA8 pixels (16 MiB). CSS resolution avoids multiplying
   * memory by DPR². Reallocate once per size; failed sizes use Blend until resize/restore. */
  private densityTarget() {
    const gl = this.gl!, k = Math.min(1, 2048 / Math.max(this.width, this.height));
    const w = Math.max(1, Math.ceil(this.width * k)), h = Math.max(1, Math.ceil(this.height * k));
    if (w !== this.densitySize[0] || h !== this.densitySize[1]) {
      this.densitySize = [w, h];
      if (!this.textures[6]) this.texture(6);
      this.densityBuffer ??= gl.createFramebuffer();
      this.textureUnit(6);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      // Linear upscale: NEAREST gives uneven line weight at fractional scaling and on capped (>2048 px) panes.
      this.textureFilter(gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.densityBuffer);
      if (this.densityBuffer) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[6]!, 0);
      this.densityReady = !!this.densityBuffer && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return this.densityReady;
  }
  /** View/hover changes re-upload compact per-node textures and one per-edge byte column. */
  private uploadView() {
    this.updateSizingRange();
    this.uploadCoordinates(true);
    this.bytes(3, this.colorBytes); this.uploadTiers(true);
    this.arrayData(this.buffers[2]!, this.carrierGeometry.enabled);
    this.arrayData(this.buffers[6]!, this.carrierGeometry.ends);
  }
  private uploadTiers(view = false) { this.bytes(4, this.stateBytes); this.arrayData(this.buffers[3]!, this.edgeTier); if (view || this.carrierGeometry.groups.length) { this.arrayData(this.buffers[5]!, this.lineRanks); this.arrayData(this.buffers[7]!, this.carrierGeometry.nodes); } }
  private uploadCoordinates(allocate = false) {
    const gl = this.gl!, packed = positionTexture(this.display, this.positionWidth);
    if (packed.width !== this.positionWidth || packed.height !== this.positionHeight) throw new Error('Coordinate texture size changed');
    this.textureUnit(0);
    if (allocate) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, packed.width, packed.height, 0, gl.RG, gl.FLOAT, packed.data);
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, packed.width, packed.height, gl.RG, gl.FLOAT, packed.data);
    this.uploadDiscs();
  }
  private uploadDiscs() {
    const gl = this.gl!;
    for (let i = 0; i < 2; i++) { this.arrayData(this.discBuffers[i]!, this.discData[i]!, gl.DYNAMIC_DRAW); }
  }
  private uploadPalette() { const gl = this.textureUnit(1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, this.theme.palette.length / 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.theme.palette); this.paletteUploads++; }
  private async prepareLabels(current: () => boolean) {
    this.labelsPending = true;
    if (this.view.loading || this.layoutActive) return;
    const revision = ++this.labelsRevision, w = this.width, h = this.height;
    const valid = () => !this.disposed && revision === this.labelsRevision && current();
    const started = performance.now();
    const atlas = await buildLabels(this.projection, { ...this.cameraFrame, positions: this.positions, visible: this.visible }, this.sizingSettings(), w, h, this.theme.font, valid);
    this.timings.labels = performance.now() - started;
    if (!valid()) return; this.labelsPending = false; this.atlas = atlas; if (this.gl && this.ready && !this.lost) this.uploadLabels(); this.refresh();
  }
  private uploadLabels() {
    const started = performance.now(), gl = this.gl!;
    const reuse = this.labelBuffers.length > 0 && this.atlasWidth === this.atlas!.canvas.width; this.atlasWidth = this.atlas!.canvas.width;
    this.textureUnit(2); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); if (reuse) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas!.canvas); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas!.canvas);
    this.textureFilter(gl.LINEAR);
    for (let level = 0; level < this.atlas!.levels.length; level++) {
      const data = this.atlas!.levels[level]!, vao = this.labelVaos[level] ?? gl.createVertexArray()!, b = this.labelBuffers[level] ?? gl.createBuffer()!; this.labelVaos[level] = vao; this.labelBuffers[level] = b; gl.bindVertexArray(vao); this.arrayData(b, data);
      for (let i = 0; i < 4; i++) this.floatAttribute(i, [4, 4, 3, 2][i]!, 52, [0, 16, 32, 44][i]!);
    }
    gl.bindVertexArray(null); this.timings.labelUpload = performance.now() - started;
  }
  refreshTheme = () => {
    if (this.disposed) return;
    const font = this.theme.font; this.theme = readTheme(this.container, this.settings);
    this.recolor(); this.choosePolicy(); this.updateSizingRange();
    if (this.gl && this.ready && !this.lost) { this.uploadPalette(); this.bytes(3, this.colorBytes); this.uploadDiscs(); }
    if (font !== this.theme.font && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {});
    if (this.lensAnchor >= 0) this.rebuildLens();
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
    this.labelsRevision++; this.labelsPending = true; this.atlas = undefined;
    clearTimeout(this.sizingTimer);
    this.sizingTimer = setTimeout(() => { this.sizingTimer = undefined; if (!this.disposed) void this.prepareLabels(() => !this.disposed).catch(() => {}); }, 160);
  }
  private baseNodeRadius() {
    const s = this.sizingSettings();
    const base = baseRadius(s, this.width, this.height, this.visibleNodes, this.camera.ratio / this.homeRatio, !this.gl && !s.visuals.zoomAdapt);
    return s.visuals.zoomAdapt && s.nodeSizing.policy === 'legacy' ? Math.max(Math.min(s.nodeSize, 1.2), base) : base;
  }
  private nodeRadius(node: number, hot = false, base = this.baseNodeRadius()) { return sizedRadius(base, this.sizes[node]!, this.projection.carrierNodes[node] ? this.settings.visuals.carrierSize : 1, hot); }
  private sizingRange: [number, number] = [0, 0];
  private updateSizingRange() {
    let max = 0, hi = 0;
    for (let i = 0; i < this.visible.length; i++) {
      max = Math.max(max, this.projection.offsets[i + 1]! - this.projection.offsets[i]!);
      if (this.visible[i] && !this.projection.carrierNodes[i]) hi = Math.max(hi, this.sizes[i]!);
    }
    this.sizingRange = [max, hi];
  }
  sizingReadout() {
    const [max, hi] = this.sizingRange, b = this.baseNodeRadius(), v = this.sizingSettings().visuals;
    const one = max ? degreeSizes(new Uint32Array([0, 1, max + 1]), v.degreeSizing * this.keep, v.degreeCurve)[0]! : 1;
    const px = (m: number) => Math.max(1 / this.dpr, b * m).toFixed(2);
    return hi ? `Radius at this zoom: leaf ${px(one)} px; largest visible hub ${px(hi)} px` : 'No ordinary nodes shown';
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
    this.uploadSizes(); this.recolor(); this.choosePolicy(); if (this.ready) { this.emphasize(true); this.input.replayHover(); }
    if (this.lensAnchor >= 0) this.rebuildLens();
    if (this.gl && this.ready && !this.lost) this.uploadView();
    if (labels && !rebuildCarrier && this.ready) void this.prepareLabels(() => !this.disposed).catch(() => {});
    this.refresh();
  }
  /** Cached degree sizes at the current "Adapt to zoom" prominence step; drawing, picking and
   * label offsets all read these. O(n) only when the step or sizing changes, never per frame. */
  private keep = 1;
  private uploadSizes() {
    const sv = this.sizingSettings().visuals; this.sizes = degreeSizes(this.projection.offsets, sv.degreeSizing * this.keep, sv.degreeCurve, this.sizes); this.updateSizingRange();
    if (this.gl && this.ready && !this.lost) this.arrayData(this.buffers[4]!, this.sizes);
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
  private renderScale() { return Math.min(window.devicePixelRatio || 1, devicePerformance.fast(this.settings.performance) ? 1 : Infinity); }
  private resize(allowGpuResize = false) {
    const changed = this.width !== Math.max(1, this.container.clientWidth) || this.height !== Math.max(1, this.container.clientHeight) || this.dpr !== this.renderScale();
    if (!changed && this.canvas.width === Math.round(this.width * this.dpr) && this.canvas.height === Math.round(this.height * this.dpr)) return false;
    this.width = Math.max(1, this.container.clientWidth); this.height = Math.max(1, this.container.clientHeight); this.dpr = this.renderScale();
    if (this.card) this.card.size = undefined;
    const started = performance.now(), width = Math.round(this.width * this.dpr), height = Math.round(this.height * this.dpr);
    // Even assigning the existing size resets the drawing buffer and can wait on
    // the GPU. A height-only panel change must not reset an unchanged width.
    if (!this.gl || this.ready || allowGpuResize) resizeDrawingBuffer(this.canvas, width, height);
    this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`;
    this.timings.maxResize = Math.max(this.timings.maxResize || 0, performance.now() - started);
    this.fit = Math.min(this.width / (this.cameraFrame.width * 1.1), this.height / (this.cameraFrame.height * 1.1)); this.measurePanels(); this.refresh(); return changed;
  }
  private get scale() { return this.fit / this.camera.ratio; }
  private get centerX() { return this.cameraFrame.minX + this.camera.x * this.cameraFrame.width; }
  private get centerY() { return this.cameraFrame.minY + this.camera.y * this.cameraFrame.height; }
  private layoutRatio(grid = this.grid) { return Math.max(1, grid.width * this.fit / this.width, grid.height * this.fit / this.height); }
  private clampRatio(ratio: number) { return Math.max(this.settings.cameraMinRatio, Math.min(this.settings.cameraMaxRatio * this.layoutRatio(), ratio)); }
  setCamera(x: number, y: number, ratio: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(ratio)) throw new Error('CAMERA_NONFINITE');
    this.flight = undefined; this.camera.x = x; this.camera.y = y; this.camera.ratio = this.clampRatio(ratio); this.refresh();
  }
  private panBy(dx: number, dy: number) { this.followLayout = false; this.setCamera(this.camera.x - dx / this.scale / this.cameraFrame.width, this.camera.y - dy / this.scale / this.cameraFrame.height, this.camera.ratio); }
  /** Eased camera transition; honors reduced motion and the configured duration. */
  flyTo(x: number, y: number, ratio: number, ms = this.settings.visuals.cameraAnimationMs) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(ratio)) throw new Error('CAMERA_NONFINITE');
    if (ms <= 0 || this.still()) { this.setCamera(x, y, ratio); return; }
    this.flight = { from: { ...this.camera }, to: { x, y, ratio: this.clampRatio(ratio) }, start: performance.now(), ms }; this.refresh();
  }
  /** Frame a world-space box (nodes, a group or everything) with margin, inside the view less a
   * right and bottom inset (the docked card or bottom sheet). */
  frame(minX: number, minY: number, maxX: number, maxY: number, ms?: number, right = 0, bottom = 0): number {
    const w = Math.max(maxX - minX, this.cameraFrame.width * .02), h = Math.max(maxY - minY, this.cameraFrame.height * .02);
    const ratio = Math.max(w * 1.25 * this.fit / Math.max(1, this.width - right), h * 1.25 * this.fit / Math.max(1, this.height - bottom));
    this.centreOn((minX + maxX) / 2, (minY + maxY) / 2, ratio, ms, right, bottom);
    return ratio;
  }
  /** Fly so world point (x, y) sits mid-view in the room left of a `right` and above a `bottom` inset
   * (the docked card, bottom sheet or tools panel). The shift uses the ratio the camera will reach. */
  private centreOn(x: number, y: number, ratio: number, ms?: number, right = 0, bottom = 0) {
    const f = this.cameraFrame, shift = this.clampRatio(ratio) / this.fit / 2;
    this.flyTo((x + right * shift - f.minX) / f.width, (y + bottom * shift - f.minY) / f.height, ratio, ms);
  }
  frameGroup(group: number, ms?: number) {
    const codes = this.view.groupCodes; if (!codes) return;
    let x = Infinity, y = Infinity, xx = -Infinity, yy = -Infinity;
    for (let i = 0; i < codes.length; i++) if (codes[i] === group && this.filterVisible[i]) { const a = this.positions[i * 2]!, b = this.positions[i * 2 + 1]!; x = Math.min(x, a); y = Math.min(y, b); xx = Math.max(xx, a); yy = Math.max(yy, b); }
    if (x !== Infinity) { const [right, bottom] = this.cardInset(); this.frame(x, y, xx, yy, ms, right, bottom); }
  }
  /** Frame the 1st–99th percentile of visible nodes so a few isolated outliers do not shrink the web;
   * fewer than 8 nodes are framed exactly. Only an empty view falls back to the preserved frame. */
  fitAll(ms?: number) {
    // Frame connected notes when there are enough: unconnected ones settle on a far ring that would shrink the web.
    const xs: number[] = [], ys: number[] = [], connected = new Uint8Array(this.visible.length), p = this.projection;
    for (let e = 0; e < p.source.length; e++) if (this.edgeDrawn(e)) connected[p.source[e]!] = connected[p.target[e]!] = 1;
    // Count before sampling: hidden endpoints/types are not connections, and sparse filters must
    // not miss the eight-note threshold or be mistaken for an empty view.
    let all = 0, linked = 0, seen = 0;
    for (let i = 0; i < this.visible.length; i++) if (this.visible[i]) { all++; linked += connected[i]!; }
    const only = linked >= 8, step = Math.max(1, Math.ceil((only ? linked : all) / 8192));
    for (let i = 0; i < this.visible.length; i++) if (this.visible[i] && (!only || connected[i]) && seen++ % step === 0) { xs.push(this.display[i * 2]!); ys.push(this.display[i * 2 + 1]!); }
    for (const h of this.hubs) { xs.push(h.x); ys.push(h.y); }
    if (!xs.length) { this.homeRatio = 1; this.flyTo(.5, .5, 1, ms); return; }
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(a.length * f))]!, t = xs.length < 8 ? 0 : .01;
    this.homeRatio = this.clampRatio(this.frame(q(xs, t), q(ys, t), q(xs, 1 - t), q(ys, 1 - t), ms, ...this.cardInset()));
  }
  /** Test/host seam; not a second graph or renderer object model. */
  path(id: number) { return renderPath(this.projection, id); }
  private name(n: number) { const path = this.path(n); return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '').slice(0, 128); }
  /** Temporary view state, deliberately not saved to named views or physics/layout state. */
  get lensNode() { return this.lensWanted; }
  private lensChanged() { this.syncViewState(); this.card.syncLens(); this.onLensChange?.(); }
  /** Host seam for "+N more": open the declared-group navigator and focus its filter, without moving the camera. */
  showConnections(n: number) {
    if (!(n >= 0 && n < this.visible.length && this.filterVisible[n])) return;
    if (this.selected !== n || this.card.node !== n) this.selectNote(n, true);
    this.card.showAll();
  }
  toggleLens() { this.setLens(this.lensWanted >= 0 ? -1 : this.selected >= 0 ? this.selected : this.hovered); }
  setLens(node: number) {
    if (this.disposed) return;
    if (!Number.isInteger(node) || node < -1 || node >= this.visible.length) throw new Error('LENS_NODE_INDEX');
    if (!this.visible[node]) node = -1;
    if (node === this.lensWanted) return;
    const now = performance.now();
    if (this.lensMotion) this.lensBlend = lensAmount(this.lensMotion.from, this.lensMotion.to, now - this.lensMotion.start, 220, this.still());
    this.lensWanted = node;
    // A different target first returns the old ring, then opens the new one. Rapid toggles
    // reverse from the current amount rather than snapping or leaking old overrides.
    if (node !== this.lensAnchor && this.lensBlend > 0) this.lensMotion = { from: this.lensBlend, to: 0, start: now };
    else {
      if (node !== this.lensAnchor) { this.lensAnchor = node; this.rebuildLens(); }
      this.lensMotion = { from: this.lensBlend, to: node >= 0 ? 1 : 0, start: now };
    }
    this.animateLens(now); this.emphasize(); this.lensChanged(); this.refresh();
  }
  private animateLens(now: number): boolean {
    const motion = this.lensMotion; if (!motion) return false;
    this.lensBlend = lensAmount(motion.from, motion.to, now - motion.start, 220, this.still());
    if (this.lensBlend !== motion.to) return true;
    this.lensMotion = undefined;
    if (!motion.to) {
      this.lensAnchor = this.visible[this.lensWanted] ? this.lensWanted : -1;
      this.lensWanted = this.lensAnchor; this.rebuildLens(); this.emphasize(); this.lensChanged();
      if (this.lensAnchor >= 0) {
        this.lensMotion = { from: 0, to: 1, start: now };
        return this.still() ? this.animateLens(now) : true;
      }
    }
    return false;
  }
  /** Collect/sort once per explicit target or view change. Neither hover nor frames traverse edges. */
  private rebuildLens() {
    this.lensRows = lensConnections(this.lensAnchor, this.projection, this.edges, this.edgeOn, this.filterVisible, this.visible, n => this.name(n), this.interestOf(this.lensAnchor));
    this.lensLabelWidth = 0;
    if (this.lensRows.length) {
      const m = this.measure ??= document.createElement('canvas').getContext('2d')!;
      m.font = tierFont(1, this.settings.labelSize, this.settings.visuals.labelTierScale, this.theme.font);
      for (const row of this.lensRows) this.lensLabelWidth = Math.max(this.lensLabelWidth, m.measureText(row.name).width);
    }
    this.layoutLens(true);
  }
  /** CSS-pixel rings survive zoom. Reflow only at a conservative radius bucket change,
   * not every zoom frame; sorting and text measurement remain cached. */
  private layoutLens(force = false) {
    if (!(this.lensAnchor >= 0) && !force) return;
    const s = this.sizingSettings(), r = this.lensAnchor >= 0 ? 2 ** Math.ceil(Math.log2(Math.max(1, (this.baseNodeRadius() * (1 + s.visuals.degreeSizing) * Math.max(1, s.visuals.carrierSize) + 2) * 1.6))) : 0;
    if (!force && r === this.lensRadius) return;
    this.lensRadius = r;
    const previous = this.lensPoints;
    this.lensPoints = lensLayout(this.lensRows, Math.max(40, Math.hypot(this.lensLabelWidth + 2 * r + 12, Math.max(2 * r, s.labelSize * 1.5 + 4))), Math.max(80, 2 * r + 20));
    const changed = new Set([...previous.keys(), ...this.lensPoints.keys()]);
    for (const n of changed) { const point = this.lensPoints.get(n), k = n * 4; this.lensBytes[k] = point?.x ?? 0; this.lensBytes[k + 1] = point?.y ?? 0; this.lensBytes[k + 2] = point ? 1 : 0; }
    this.lensRevision++;
    if (this.gl && this.ready && !this.lost) this.uploadLens(changed);
  }
  private uploadLens(changed?: Iterable<number>) {
    const gl = this.textureUnit(5);
    if (!changed) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.positionWidth, this.positionHeight, 0, gl.RGBA, gl.FLOAT, this.lensBytes);
    else {
      // One span per touched texture row, not one driver call per displaced note.
      const rows = new Map<number, [number, number]>(), width = this.positionWidth;
      for (const n of changed) {
        const row = Math.floor(n / width), x = n % width, span = rows.get(row);
        if (span) { span[0] = Math.min(span[0], x); span[1] = Math.max(span[1], x); } else rows.set(row, [x, x]);
      }
      for (const [row, [lo, hi]] of rows) gl.texSubImage2D(gl.TEXTURE_2D, 0, lo, row, hi - lo + 1, 1, gl.RGBA, gl.FLOAT, this.lensBytes.subarray((row * width + lo) * 4, (row * width + hi + 1) * 4));
    }
  }
  /** Effective render coordinate; never writes worker/layout or collapsed-view positions. */
  private renderCoordinate(id: number, axis: 0 | 1, amount = this.lensBlend) {
    const base = this.display[id * 2 + axis]!, point = this.lensPoints?.get(id);
    return point && this.lensAnchor >= 0 ? lensCoordinate(base, this.display[this.lensAnchor * 2 + axis]!, axis ? point.y : point.x, this.scale, amount) : base;
  }
  screenPoint(id: number) { return { x: (this.renderCoordinate(id, 0) - this.centerX) * this.scale + this.width / 2, y: (this.renderCoordinate(id, 1) - this.centerY) * this.scale + this.height / 2 }; }
  private worldPoint(x: number, y: number) { return { x: (x - this.width / 2) / this.scale + this.centerX, y: (y - this.height / 2) / this.scale + this.centerY }; }
  /** Edge-note level of detail at this zoom: LOD visibility and the drawn alpha. */
  carrierLevel(zoom = this.camera.ratio / this.homeRatio, radius = this.baseNodeRadius()) { const v = this.settings.visuals; const visibility = +(v.carrierOpacity > 0 && carrierThrough(v.carrierLines, radius * v.carrierSize)); return { visibility, alpha: +(v.carrierOpacity > 0) * Math.max(.35, carrierCoverage(v, this.visibleCarriers, zoom)) }; }
  /** Shared CPU admission for picking and Canvas; WebGL mirrors it in the vertex shader. */
  private carrierShown(n: number, ink: number, focus: number, through = this.carrierLevel().visibility) {
    if (!this.projection.carrierNodes[n]) return true;
    const v = this.settings.visuals, rank = this.carrierGeometry.nodes[n]!, retained = !!(rank & 0x2000000), pinned = !!(rank & 0x4000000), tier = this.carrierTier(n);
    return rank !== 0xffffffff && (!retained || pinned || carrierAdmitted(rank, ink)) && (retained || !!through) && v.carrierOpacity > 0 && v.edgeOpacity > 0 && v.edgeMode !== 'off' && (v.edgeMode !== 'focus' || pinned || tier > 0 && focus > 0) && (retained || n === this.selected || n === this.hoverFx.n || n === this.lineOwner(this.hoveredEdge) || tier > 0 && focus > 0 || lineAdmitted(rank, ink, 0, Infinity));
  }
  /** Explicit interaction protects only owned legs and their carrier endpoints, never a component.
   * Recomputed on selection/hover/view changes over incident CSR rows, not on camera frames. */
  private pinCarriers(force = false) {
    const g = this.carrierGeometry; if (!this.carrierCount) return;
    const h = this.hoverFx.n, key = this.carrierPinKey;
    if (!force && key[0] === g && key[1] === this.selected && key[2] === h) return;
    this.carrierPinKey = [g, this.selected, h];
    const hadPins = this.carrierPins.length;
    for (const n of this.carrierPins) if (g.nodes[n] !== 0xffffffff) g.nodes[n] = this.projection.carrierNodes[n] ? g.nodes[n]! & ~0x4000000 : 0xffffffff;
    this.carrierPins = [];
    for (const n of [this.selected, h]) if (n >= 0 && this.projection.carrierNodes[n] && g.nodes[n] !== 0xffffffff) {
      for (let j = this.edges.offsets[n]!; j < this.edges.offsets[n + 1]!; j++) {
        const e = this.edges.edges[j]!; if (!g.enabled[e] || !g.ends[e] || this.lineOwner(e) !== n) continue;
        for (const endpoint of [this.projection.source[e]!, this.projection.target[e]!]) {
          if (!this.projection.carrierNodes[endpoint] && g.nodes[endpoint] === 0xffffffff) g.nodes[endpoint] = 0;
          if (g.nodes[endpoint] !== 0xffffffff && !(g.nodes[endpoint]! & 0x4000000)) { g.nodes[endpoint]! |= 0x4000000; this.carrierPins.push(endpoint); }
        }
      }
    }
    if ((hadPins || this.carrierPins.length) && this.gl && this.ready && !this.lost) this.arrayData(this.buffers[7]!, g.nodes);
  }
  private carrierPinned(e: number) { const owner = this.lineOwner(e); return !!this.carrierGeometry.ends[e] && owner >= 0 && (owner === this.selected || owner === this.hoverFx.n); }
  private carrierLineShown(e: number, ink: number) { return carrierAdmitted(this.lineRanks[e]!, ink) || this.carrierPinned(e); }
  private carrierTier(n: number) { const tier = this.stateBytes[n * 4 + 1]!; return shownTier(tier, this.tierMask, !!(this.carrierGeometry.nodes[n]! & 0x2000000) || n === this.focusNode || this.focusNode < 0 && tier === 255); }
  private lineOwner(e: number) { const p = this.projection, end = this.carrierGeometry.ends[e]!; return e < 0 ? -1 : end ? end >= 0x80000000 ? p.source[e]! : p.target[e]! : this.lineRanks[e]! & 0x2000000 ? p.carrierNodes[p.source[e]!] ? p.source[e]! : p.target[e]! : -1; }
  /** No allocations or sizing work per visited edge. A folded outgoing row has no target. */
  private lineTarget(e: number, through: number) { const end = this.carrierGeometry.ends[e]!; return !(through || this.lineRanks[e]! & 0x2000000) && end ? end >= 0x80000000 ? -1 : end - 1 : this.projection.target[e]!; }
  /** Edge notes folded away by the level of detail are not pickable. */
  pick(x: number, y: number) {
    const w = this.worldPoint(x, y), s = this.sizingSettings(), ink = this.edgeQuiet(2 * Math.max(.5, this.edgeWidth()))[0], adaptive = s.visuals.emphasis === 'adaptive';
    // The graduated focus grows 60% (direct notes 25%): hit targets follow the drawn size.
    const f = s.visuals.hoverHighlight ? this.focusLevel : 0, grow = (n: number) => tierNode(this.stateBytes[n * 4 + 1]! / 255, true, n === this.focusNode, f, 0)[1];
    const lifted = this.pickTiered(x, y, w, f); if (lifted >= 0) return lifted;
    if (this.lensPoints?.size) {
      const legacy = s.nodeSizing.policy === 'legacy' && !adaptive, radius = (legacy ? s.nodeSize * (1 + s.visuals.degreeSizing) * (1 + .6 * f) + 4 : this.baseNodeRadius() * (1 + s.visuals.degreeSizing) * Math.max(1, s.visuals.carrierSize) * (1 + .6 * f) + 6 + (adaptive ? Math.max(7, s.visuals.tierMinSize) : 0)) / this.scale;
      return pickLens(this.picker, this.lensPoints, w.x, w.y, radius, n => ({ x: this.renderCoordinate(n, 0), y: this.renderCoordinate(n, 1) }), n => legacy ? radius : (this.drawnRadius(n, n === this.selected || n === (adaptive ? this.hoverFx.n : this.hovered), f) + 4) / this.scale, n => !!this.visible[n] && this.carrierShown(n, ink, f));
    }
    if (!this.carrierCount && s.nodeSizing.policy === 'legacy' && !adaptive) return this.picker.pick(w.x, w.y, (s.nodeSize * (1 + s.visuals.degreeSizing) * (1 + .6 * f) + 4) / this.scale);
    const base = this.baseNodeRadius(), max = (base * (1 + s.visuals.degreeSizing) * Math.max(1, s.visuals.carrierSize) * (1 + .6 * f) * 1.6 + 6 + (adaptive ? Math.max(7, s.visuals.tierMinSize) : s.visuals.tierMinSize)) / this.scale;
    let picked = -1, distance = Infinity;
    this.picker.visit(w.x, w.y, max, node => {
      if (!this.visible[node] || !this.carrierShown(node, ink, f)) return;
      const p = this.screenPoint(node), d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d <= ((adaptive ? this.drawnRadius(node, node === this.selected || node === this.hoverFx.n, f) : this.grown(node, this.nodeRadius(node, node === this.selected || node === this.hovered) * grow(node))) + 4) ** 2 && d < distance) { picked = node; distance = d; }
    }); return picked;
  }
  /** Cached tier lengths only: no new traversal, texture or projection-wide CPU work on WebGL frames. */
  /** Held while a deselect eases out, so context dim does not jump before the fade. */
  private heldBudget = 1;
  private emphasisBudget() {
    if (this.settings.visuals.emphasis !== 'adaptive') return 0;
    if (this.focusTarget > 0 || this.focusLevel <= 0) this.heldBudget = 1 / Math.sqrt(1 + Math.max(this.directs.length, this.near.length / 4) / 12);
    return this.heldBudget;
  }
  private emphasisDim() { return this.isolation ? 1 : this.settings.visuals.dimOpacity * Math.max(.3, this.emphasisBudget() || 1); }
  /** One CPU radius authority for drawing, picking and overlays; mirrors the node shader. */
  private drawnRadius(n: number, hot: boolean, focus: number, base = this.baseNodeRadius(), budget = this.emphasisBudget()) {
    const ego = n === this.focusNode, g = (this.projection.carrierNodes[n] ? this.carrierTier(n) : shownTier(this.stateBytes[n * 4 + 1]!, this.tierMask, ego)) / 255, radius = this.nodeRadius(n, hot, base);
    const r = radius * tierNode(g, true, ego, focus, 0)[1];
    return Math.max(n === this.selected ? 5 : this.projection.carrierNodes[n] ? 2 : 1 / this.dpr, budget ? adaptiveRadius(radius, g, ego, this.projection.carrierNodes[n] && !ego ? 0 : focus, this.settings.visuals.tierMinSize, budget, n === this.hoverFx.n ? (this.fx[0]! - 1) / .6 : 0) : this.grown(n, this.projection.carrierNodes[n] ? r : liftRadius(r, tierLift(g, ego, focus, this.settings.visuals.tierMinSize))));
  }
  /** The hover preview's size (the node shader's pulse term). */
  private grown(n: number, r: number) { const s = this.fx[0]!; return n === this.hoverFx.n ? Math.max(r * s, this.settings.visuals.tierMinSize * (s - 1) / .6) : r; }
  /** Tiered notes lifted to their screen-space floor win the pick wherever their enlarged disc covers the point. */
  private pickTiered(x: number, y: number, w: { x: number; y: number }, focus: number) {
    const px = this.settings.visuals.tierMinSize; if (!focus || !px || !this.near.length) return -1;
    let picked = -1, distance = Infinity;
    const test = (node: number) => {
      if (!this.visible[node] || this.projection.carrierNodes[node]) return;
      const ego = node === this.focusNode; if (!tierLift(shownTier(this.stateBytes[node * 4 + 1]!, this.tierMask, ego) / 255, ego, focus, px)) return;
      const p = this.screenPoint(node), d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d <= (this.drawnRadius(node, node === this.selected || node === (this.settings.visuals.emphasis === 'adaptive' ? this.hoverFx.n : this.hovered), focus) + 4) ** 2 && d < distance) { picked = node; distance = d; }
    };
    // Lens-displaced notes leave their grid cells: skip them there and test their drawn positions (O(direct connections)).
    const moved = this.lensAnchor >= 0 ? this.lensPoints : undefined;
    this.picker.visit(w.x, w.y, (2 * px + 4) / this.scale, node => { if (!moved?.has(node)) test(node); });
    if (moved) for (const node of moved.keys()) test(node);
    return picked;
  }
  pickHub(x: number, y: number) {
    for (let i = this.hubs.length - 1; i >= 0; i--) { const h = this.hubs[i]!, sx = (h.x - this.centerX) * this.scale + this.width / 2, sy = (h.y - this.centerY) * this.scale + this.height / 2; if (Math.hypot(sx - x, sy - y) <= h.radius + 3) return h.group; }
    return -1;
  }
  private pickEdge(x: number, y: number) {
    const w = this.worldPoint(x, y), radius = this.grid.cell, p = this.projection, v = this.settings.visuals, mode = v.edgeMode, focus = v.hoverHighlight ? this.focusLevel : 0;
    let best = -1, distance = this.settings.groupEdgeHitRadius / this.scale, budget = 32768;
    // Lines hidden by Edges mode or the shared ink budget are not pickable.
    if (mode === 'off' || !v.edgeOpacity || mode === 'focus' && !focus) return -1;
    const [ink, reach] = this.edgeQuiet(2 * Math.max(.5, this.edgeWidth())), through = this.carrierLevel().visibility, hoveredOwner = this.lineOwner(this.hoveredEdge);
    // Deliberately budgeted incident-edge picking, not an O(m) all-segment scan or GPU readback.
    const visit = (node: number) => {
      for (let j = this.edges.offsets[node]!; j < this.edges.offsets[node + 1]! && budget-- > 0; j++) {
        let e = this.edges.edges[j]!, b = this.lineTarget(e, through); if (b < 0) { e--; b = this.lineTarget(e, through); } const a = p.source[e]!, owner = this.lineOwner(e), retained = !!(this.lineRanks[e]! & 0x2000000), tier = this.edgeTier[e] === PATH_EDGE || (owner < 0 ? shownEdgeTier(this.edgeTier[e]!, this.tierMask) : this.carrierTier(owner));
        if (!this.carrierGeometry.enabled[e] || !this.edgeDrawn(e) || retained && (!v.carrierOpacity || !this.carrierLineShown(e, ink)) || mode === 'focus' && !tier && !this.carrierPinned(e)) continue;
        const ax = this.renderCoordinate(a, 0), ay = this.renderCoordinate(a, 1), bx = this.renderCoordinate(b, 0), by = this.renderCoordinate(b, 1);
        if (!retained && !(owner < 0 ? e === this.hoveredEdge : owner === this.selected || owner === this.hoverFx.n || owner === hoveredOwner) && !(tier && focus)) {
          // Same packed rank and whole-relationship threshold as edgeVertex; hovered/focus/path lines stay admitted.
          if (!lineAdmitted(this.lineRanks[e]!, ink!, Math.hypot(bx - ax, by - ay) * this.scale, Math.min(reach!, 1e9))) continue;
        }
        const d = segmentDistance(w.x, w.y, ax, ay, bx, by); if (d < distance) { best = e; distance = d; }
      }
    };
    // Nearby unchanged edges must get their existing budget before a distant lens cloud.
    this.picker.visit(w.x, w.y, radius, node => { if (!this.lensPoints?.has(node)) visit(node); });
    // Include moved endpoints outside the original grid with the remaining incident budget.
    if (this.lensAnchor >= 0 && budget > 0) visit(this.lensAnchor);
    for (const node of this.lensPoints?.keys() ?? []) { if (budget <= 0) break; visit(node); }
    return best;
  }
  /** Sampled web geometry for the ink budget; recomputed when positions or the view change, not per frame. */
  private ink?: EdgeInk & { display: Float32Array };
  /** Same CSS-pixel width for WebGL, Canvas and line picking. */
  private edgeWidth(zoom = this.camera.ratio / this.homeRatio) { return this.settings.edgeSize * zoomFade(this.settings.visuals, this.visibleEdges, zoom, this.width, this.height); }
  /** Shared context-line admission: [line share, long-line fade length in CSS px]. */
  private edgeQuiet(width: number) {
    const v = this.settings.visuals, edges = this.visibleEdges;
    if (!v.zoomAdapt || !v.edgeOpacity || v.edgeMode === 'off') return [1, Infinity] as const;
    if (this.ink?.display !== this.display) this.ink = { ...edgeInk(this.display, this.projection.source, this.projection.target, this.edgeDrawn, 4096, this.carrierCount > 0), display: this.display };
    const layers = overdraw(this.ink, edges, width, this.scale);
    // Bounded overview allowance; home/8 and closer use the original share. Retained alpha has no zoom boost.
    const overview = Math.max(1, Math.min(8, this.camera.ratio / this.homeRatio * 8));
    return [Math.min(1, inkShare(v, layers) * overview), fadeLength(v, this.ink, this.scale, layers)] as const;
  }
  private edgeDrawn = (e: number) => !!this.edgeOn[e] && !!this.filterVisible[this.projection.source[e]!] && !!this.filterVisible[this.projection.target[e]!];
  /** Drawn rows between the picked edge's endpoints, either direction, picked edge first (bounded). */
  private edgeParallels(e: number) {
    const a = this.projection.source[e]!, through = this.carrierLevel().visibility, b = this.lineTarget(e, through), out = [e];
    for (let j = this.edges.offsets[a]!; j < this.edges.offsets[a + 1]! && out.length < 32; j++) { const f = this.edges.edges[j]!, target = this.lineTarget(f, through); if (target >= 0 && (this.projection.source[f] === a ? target : this.projection.source[f]) === b && this.edgeDrawn(f) && !out.includes(f)) out.push(f); }
    return out;
  }
  /** Graduated tiers from one CPU authority for WebGL and Canvas, recomputed only when the focus
   * source changes, never per frame. Old bytes are cleared by touched lists, not rescanned. */
  private setFocus(node: number, immediate = false, edges?: number[]) {
    const s = this.stateBytes, t = this.edgeTier, key = edges ?? node;
    if (key !== this.tierSource || immediate) {
      for (const i of this.near) s[i * 4 + 1] = 0;
      for (const e of this.tierEdges) t[e] = 0;
      this.near = []; this.tierEdges = []; this.tierSource = key; this.focusNode = edges ? -1 : node; this.rankedKey = []; this.anchorKey = []; this.tierPartial = 0;
      // A selected relationship lights its rows and both endpoints as direct tiers, without a focus ring.
      if (edges) for (const e of edges) { t[e] = edges === this.pathView?.edges ? PATH_EDGE : 255; this.tierEdges.push(e); for (const n of [this.projection.source[e]!, this.projection.target[e]!]) if (!s[n * 4 + 1]) { s[n * 4 + 1] = 255; this.near.push(n); } }
      else this.tierPartial = focusTiers(node, this.edges, this.projection, this.edgeOn, this.filterVisible, s, t, this.near, this.tierEdges, 65536, this.settings.declaration.groupContext ? this.view.groupCodes : undefined);
      // Cleared bytes leave the touched lists, so labels, counts, pips and the next reset see only lit notes.
      const d = this.disclosed;
      if (!edges && d && d.node === node && this.lensAnchor < 0) { discloseTiers(node, d.direct, d.second, this.projection, this.edges, s, t, this.near, this.tierEdges); this.near = this.near.filter(n => s[n * 4 + 1]); this.tierEdges = this.tierEdges.filter(e => t[e]); }
      if (this.carrierGeometry) { carrierFocus(this.carrierGeometry, this.lineRanks, s, this.near); this.pinCarriers(true); }
      if (this.gl && this.ready && !this.lost) this.uploadTiers();
      const notes = this.projection.carrierNodes; this.tierTotals = tierCounts(this.focusNode, this.near, s, notes);
      if (edges) this.tierTotals[0] = this.near.filter(n => !notes[n]).length;
      this.directs = this.near.filter(n => n !== this.focusNode && s[n * 4 + 1] === 255 && !notes[n]); this.updateLegend();
    }
    this.focusFrom = this.focusLevel; this.focusTarget = this.near.length ? 1 : 0; this.focusAt = performance.now();
    if (immediate || this.still()) this.focusLevel = this.focusTarget;
  }
  private noteCaption(n: number) { return this.path(n).split('/').pop()!.replace(/\.md$/, '') + (n === this.focusNode ? (this.tierPartial & 1 ? ' (neighbours of neighbours truncated)' : '') + (this.tierPartial & 2 ? ' (same group truncated)' : '') : ''); }
  /** Selection drives the persistent focus. Touch and keyboard selections show the card; only its
   * explicit Open button (or Enter on the canvas) opens the note. */
  private selectNote(node: number, card?: boolean, keepLens = false, framing = true) {
    if (node < 0 && this.lensAnchor >= 0 && !keepLens) this.setLens(-1);
    if (node < 0) { this.input?.clearHover(); this.hoverFx.n = -1; this.fx = [1, 0]; }
    this.selected = node;
    if (node >= 0 && this.lensWanted >= 0 && !keepLens) this.setLens(node);
    if (node >= 0 && !card) this.card.history.visit(node);
    this.selectedEdges = []; this.pathView = undefined; this.edgeAnchor = -1; this.edgeToken++; this.cue = -1; if (card || node < 0) this.hovered = -1; this.emphasize(); this.pinCarriers(); this.startRipple(node); this.refresh();
    if (card && node >= 0) { this.card.show(node); this.placeCard(); if (framing) this.frameSelection(this.settings.visuals.clickFraming); } else this.card.hide();
  }
  /** The navigator's view of the graph: every lookup is O(degree) over the incident-edge CSR. Rows
   * list connections under the host filter, so a neighbourhood mask never hides them. */
  private cardHost(): CardHost {
    const p = this.projection, on = (e: number) => !this.view.typeHidden?.[p.type[e]!];
    return {
      name: n => this.name(n),
      title: n => this.noteTitle?.(this.path(n)) ?? '',
      relationship: n => {
        const owner = p.carrierNodes[n]; if (!owner) return;
        const source = new Set<string>(), target = new Set<string>(), types = new Set<string>();
        for (let j = this.edges.offsets[n]!; j < this.edges.offsets[n + 1]!; j++) {
          const e = this.edges.edges[j]!; if (p.carrier[e]! + 1 !== owner) continue;
          const out = p.source[e] === n, other = out ? p.target[e]! : p.source[e]!;
          (out ? target : source).add(this.noteTitle?.(this.path(other)) || this.name(other)); types.add(p.types[p.type[e]!]!);
        }
        if (source.size && target.size) return { name: [...source].join(', ') + ' → ' + [...target].join(', '), type: [...types].join(', ') };
      },
      group: n => { const key = this.view.groupCodes?.[n] ?? -1; return { key, label: this.view.groupLabels?.[key] ?? 'Ungrouped' }; },
      color: n => { const c = this.colorBytes, k = n * 4; return `rgb(${c[k]},${c[k + 1]},${c[k + 2]})`; },
      groups: n => { const names = new Map<number, string>(), name = (m: number) => names.get(m) ?? names.set(m, this.name(m)).get(m)!; return connectionGroups(n, this.edges, p, on, this.baseVisible, byInterest(this.interestOf(n), (a, b) => name(a).localeCompare(name(b)))); },
      isolated: () => !!this.isolation,
      frontier: n => this.frontier.get(n) ?? 0,
      canTravel: () => !this.layoutActive && !this.view.loading,
      lensed: n => this.lensWanted >= 0 && this.lensWanted === n,
      act: (a, n) => this.cardAction(a, n),
      travel: n => { if (!this.layoutActive) this.travel(n); },
      cue: n => { this.cue = n; this.refresh(); },
      disclose: (n, open, second) => {
        const d = this.disclosed, same = (a: Set<number>, b: number[]) => a.size === new Set(b).size && b.every(x => a.has(x));
        if (!open ? !d : d && d.node === n && same(d.direct, open) && same(d.second, second)) return;
        this.disclosed = open ? { node: n, direct: new Set(open), second: new Set(second) } : undefined;
        if ((open ? n : d!.node) === this.focusNode) { this.emphasize(true); this.refresh(); }
      },
      close: () => { this.selectNote(-1, false, true); this.canvas.focus(); },
    };
  }
  /** Degree-of-interest scorer for a focus, rebuilt only when the focus, trail, grouping or setting changes. */
  private interestOf(focus: number): Scorer {
    const h = this.card.history, trail = h.items.slice(0, h.at + 1), bridges = this.settings.visuals.bridgesFirst, key = [focus, this.projection, this.view.groupCodes, bridges, ...trail], m = this.interestMemo;
    if (m && m.key.length === key.length && m.key.every((x, i) => x === key[i])) return m.score;
    const score = interestScorer(focus, { offsets: this.projection.offsets, groups: this.view.groupCodes, declared: this.projection.interest, trail, bridges });
    this.interestMemo = { key, score }; return score;
  }
  private cardAction(action: CardAction, n: number) {
    if (this.layoutActive) return;
    const path = this.path(n);
    if (action === 'lens') this.setLens(this.lensWanted === n ? -1 : n);
    else if (action === 'focus') this.frameNodes(reach(n, this.edges, this.projection, e => !!this.edgeOn[e], this.filterVisible, 1).nodes);
    else if (action === 'isolate') this.isolate(this.isolation ? -1 : n, 1, false);
    else if (action === 'expand') this.expandNeighbourhood(n);
    else if (action === 'copy') { if (this.copyLink) this.copyLink(path); else void navigator.clipboard?.writeText(`[[${this.name(n)}]]`).catch(() => {}); }
    else if (this.openNote) this.openNote(path, action === 'open' ? 'reuse' : action);
    else this.onNode(n);
  }
  /** Fly to fit a node set (bounded by the caller: a focus and its connections). */
  private frameNodes(nodes: Iterable<number>) {
    let x = Infinity, y = Infinity, xx = -Infinity, yy = -Infinity;
    for (const n of nodes) { const a = this.renderCoordinate(n, 0), b = this.renderCoordinate(n, 1); x = Math.min(x, a); y = Math.min(y, b); xx = Math.max(xx, a); yy = Math.max(yy, b); }
    if (x !== Infinity) { const [right, bottom] = this.cardInset(); this.frame(x, y, xx, yy, undefined, right, bottom); }
  }
  /** Keep the selection clear of measured chrome. Off only makes the smallest safety pan;
   * experimental modes move only when their note set is not comfortably visible. No idle work. */
  private frameSelection(mode: Settings['visuals']['clickFraming'] = 'off') {
    if (this.view.loading || this.layoutActive) return;
    const n = this.card.node; if (n < 0) return;
    const [right, bottom] = this.cardInset(), w = this.width - right, h = this.height - bottom;
    const x = Math.min(48, w / 4), y = Math.min(96, h / 4);
    const comfortable = (node: number) => { const q = this.screenPoint(node); return q.x >= x && q.x <= w - x && q.y >= y && q.y <= h - x; };
    if (mode === 'fit-neighbours') {
      const nodes = reach(n, this.edges, this.projection, e => !!this.edgeOn[e], this.filterVisible, 1).nodes;
      if (![...nodes].every(comfortable)) this.frameNodes(nodes);
    } else if (!comfortable(n)) {
      const q = this.screenPoint(n);
      if (mode === 'center') this.panTo(n);
      else this.panBy(Math.max(x, Math.min(w - x, q.x)) - q.x, Math.max(y, Math.min(h - x, q.y)) - q.y);
    }
  }
  /** Measure before framing, including a just-opened sheet, instead of guessing its height. */
  private cardInset(): [number, number] {
    const t = this.toolsInset;
    if (this.card.node < 0 && !this.selectedEdges.length && !this.pathView) return [t, 0];
    if (!this.card.size) this.placeCard();
    const [w, h] = this.card.size!;
    return sheetCard(this.width, t, this.settings.visuals.cardPlacement) ? [t, h + 8] : [t + w + 16, 0];
  }
  /** Re-measure the graph tools panel over the view's right edge (via `measureTools`); the card docks
   * left of it and framing and off-screen arrows keep clear of it. Ignored when it leaves no room
   * for even a narrow card (the panel then covers the graph). */
  syncTools() {
    const px = Math.round(this.measureTools?.() ?? 0), inset = px > 0 && this.width - px >= TOOLS_MIN_ROOM ? px : 0;
    if (inset === this.toolsInset || this.disposed) return;
    this.toolsInset = inset; this.card.size = undefined; this.refresh();
  }
  /** Travel from a Connections row or history: the note becomes focus and selection, the camera flies
   * to it (zooming in when far out) and an active neighbourhood keeps its anchor. */
  private travel(n: number) {
    if (this.layoutActive) return;
    if (!this.baseVisible[n]) return;
    // Travelling reveals only a hidden target that touches the region (never the traveller's other neighbours) and never moves the anchor.
    const s = this.isolation;
    if (s && !this.filterVisible[n]) this.isolate(s.node, s.hops, false, s.expanded, s.shown.includes(n) ? s.shown : [...s.shown, n]);
    if (!this.filterVisible[n]) this.isolate(-1, 1, false); // A history jump outside this region exits it.
    if (!this.filterVisible[n]) return;
    const lensed = this.lensWanted >= 0;
    this.selectNote(n, true, false, false);
    // Isolation may close the old lens while changing masks; preserve the travel intent.
    if (lensed && this.lensWanted !== n) this.setLens(n);
    this.panTo(n, Math.min(this.camera.ratio, this.homeRatio * .5));
  }
  /** Temporary neighbourhood, intersected with the host filter. Reach changes reset expansion. */
  isolate(node: number, hops = 1, fit = true, expanded = new Set<number>(), shown: number[] = []) {
    const previous = this.isolation, frontier = this.frontier, partial = this.neighbourhoodPartial, edges = this.isolationEdges;
    this.isolation = node >= 0 && this.baseVisible[node] ? { node, hops: Math.max(0, Math.min(3, hops)), expanded, shown } : undefined;
    try { this.applyView(this.isolationMask(this.baseVisible, this.view), this.view); }
    catch (error) {
      if (!(error instanceof CanvasLimit)) throw error;
      this.isolation = previous; this.isolationEdges = edges; this.frontier = frontier; this.neighbourhoodPartial = partial; this.showIsolation(); this.isolationBar.append(el('small', 'Too many notes to draw')); return;
    }
    if (this.isolation && !this.filterVisible[this.selected]) this.selectNote(node, true);
    this.showIsolation();
    if (this.isolation && (!previous || fit)) this.frameNodes(Array.from(this.filterVisible.keys()).filter(n => !!this.filterVisible[n]));
    else this.frameSelection();
  }
  private expandNeighbourhood(n: number) {
    const s = this.isolation; if (!s || !this.frontier.has(n)) return;
    this.isolate(s.node, s.hops, false, new Set([...s.expanded, n]), s.shown);
    this.canvas.focus();
  }
  private isolationMask(base: Uint8Array, view: RenderView) {
    const s = this.isolation, p = this.projection; this.isolationEdges = undefined; this.frontier = new Map(); this.neighbourhoodPartial = false;
    if (!s || !base[s.node]) { this.isolation = undefined; return base; }
    const result = neighbourhood(s.node, s.hops, s.expanded, this.edges, p, e => !view.typeHidden?.[p.type[e]!], base, s.shown);
    this.isolationEdges = result.edges; this.frontier = result.frontier; this.neighbourhoodPartial = result.partial; return result.mask;
  }
  private showIsolation() {
    if (!this.isolationBar) return;
    this.syncViewState();
    const s = this.isolation; this.isolationBar.dataset.motion = this.still() ? 'off' : 'full';
    isolationBar(this.isolationBar, s ? this.name(s.node) : '', s?.hops ?? 1, this.filterVisible.reduce((a, b) => a + b, 0), s ? s.expanded.size + s.shown.length : 0, this.neighbourhoodPartial, this.frontier.size, h => { this.isolate(s!.node, h); this.isolationBar.querySelectorAll('button')[h + 1]?.focus(); }, () => { this.isolate(-1); this.canvas.focus(); });
    this.isolationBar.querySelector('.graph-ng-card-head')?.remove();
    for (const b of this.frontierBadges) b.el.remove(); this.frontierBadges = [];
    // Most hidden neighbours first (ties to the lower id); badges precede the minimap and card in Tab order.
    for (const node of s ? [...this.frontier.keys()].sort((a, b) => this.frontier.get(b)! - this.frontier.get(a)! || a - b).slice(0, 6) : []) {
      const count = this.frontier.get(node)!, b = button(`+${count}`, `Expand ${this.name(node)}: ${count} hidden neighbours`, () => this.expandNeighbourhood(node), 'graph-ng-frontier graph-ng-count');
      b.title = b.getAttribute('aria-label')!;
      const width = Math.max(32, 16 + String(count).length * 7); b.style.width = `${width}px`;
      this.miniMap.root.before(b); this.frontierBadges.push({ node, el: b, width });
    }
    if (this.frontier.size > 6) this.isolationBar.append(el('small', `${this.frontier.size - 6} more expandable notes. Select a note to expand.`));
  }
  /** The requested lens, else the selection, is the focus, even while the old ring returns.
   * Hover never moves it (hover is only a ring and a name).
   * The graduated-highlight switch turns it off. */
  private emphasize(immediate?: boolean) { this.syncViewState(); const v = this.lensWanted >= 0 ? this.lensWanted : this.selected, on = this.settings.visuals.hoverHighlight, path = this.lensWanted < 0 ? this.pathView?.edges : undefined; this.setFocus(on && !path ? v : -1, immediate, on ? path ?? (v < 0 && this.selectedEdges?.length ? this.selectedEdges : undefined) : undefined); }
  /** Path mode from `from` to `to`: the shortest path over drawn notes and relationships becomes its
   * own top tier, the camera frames it and the card lists its hops. Bounded by MAX_HOPS and MAX_SCAN. */
  private findPath(from: number, to: number) {
    if (from === to || !this.visible[from] || !this.visible[to]) return;
    this.selectNote(-1); this.tierMask = ALL_TIERS; this.updateLegend();
    this.pathView = { from, to, found: [], hops: [], edges: [], note: '' }; this.nextPath();
  }
  /** First the shortest path, then each "Another path": up to MAX_ALTERNATES node-disjoint alternates. */
  private nextPath() {
    const t = this.pathView!, p = this.projection, r = t.found.length ? alternatePath(t.from, t.to, this.edges, p, this.edgeOn, this.visible, t.found) : findPath(t.from, t.to, this.edges, p, this.edgeOn, this.visible);
    if ('hops' in r) { t.found.push(t.hops = r.hops); t.edges = r.hops.flatMap(h => h.edges); this.frameNodes(pathNotes(r.hops)); }
    else t.note = r.reason === 'none' && t.found.length ? `No other path within ${MAX_HOPS} steps` : OUTCOME[r.reason];
    this.emphasize(); this.showPath(); this.refresh();
  }
  /** The Path section: each hop as note, relationship type, next note; Open on every note and relationship note. Text only. */
  private showPath() {
    const t = this.pathView!, c = this.noteCard, p = this.projection;
    const open = (n: number) => button(this.name(n), 'Open ' + this.name(n), () => this.cardAction('open', n));
    this.card.hide(); c.setAttribute('role', 'region'); c.setAttribute('aria-label', 'Path');
    const box = c.appendChild(el('div', '', 'graph-ng-path-card')), head = box.appendChild(el('div', '', 'graph-ng-card-head'));
    head.append(el('strong', `Path: ${this.name(t.from)} → ${this.name(t.to)}`, 'graph-ng-card-title'), closeButton(() => { this.selectNote(-1); this.canvas.focus(); }));
    if (t.hops.length) box.append(el('small', `${t.hops.length} step${t.hops.length === 1 ? '' : 's'}${t.found.length > 1 ? ` (path ${t.found.length})` : ''}`));
    if (t.hops.length) box.append(open(t.from));
    const list = box.appendChild(el('ol', '', 'graph-ng-path')); list.setAttribute('aria-label', 'Path');
    for (const h of hopRows(t.hops, p)) {
      const row = list.appendChild(el('li', '', 'graph-ng-relationship')), type = h.type + (h.reverse ? ' (reverse)' : '');
      row.append(h.carrier >= 0 ? button(type, 'Open relationship note ' + this.name(h.carrier), () => this.cardAction('open', h.carrier)) : el('span', type), open(h.to));
    }
    const note = box.appendChild(el('div', t.note, 'graph-ng-explore-note')); note.setAttribute('aria-live', 'polite');
    if (t.hops.length && !t.note && t.found.length <= MAX_ALTERNATES) box.append(button('Another path', 'Find another path that shares no notes', () => this.nextPath()));
  }
  /** Per frame, O(path): ring both endpoints and number each later note by its hop. Decorative; the card holds the text. */
  private placePath(radius: (n: number) => number, focus: number) {
    const notes = this.pathView && focus ? pathNotes(this.pathView.hops) : [], k = notes.length, marks = this.pathMarks;
    while (k && marks.length < k + 1) { const m = this.overlay.appendChild(el('div', '', marks.length < 2 ? 'graph-ng-path-end' : 'graph-ng-path-badge')); m.setAttribute('aria-hidden', 'true'); marks.push(m); }
    marks.forEach((m, i) => {
      m.hidden = !k || i > k; if (m.hidden) return;
      const n = i < 2 ? notes[i ? k - 1 : 0]! : notes[i - 1]!, q = this.screenPoint(n), r = radius(n), d = i < 2 ? 0 : r * .75 + 6;
      if (i < 2) m.style.width = m.style.height = `${Math.round(2 * r + 12)}px`; else if (m.textContent !== String(i - 1)) m.textContent = String(i - 1);
      if (i >= 2) m.hidden = !labelInView(q.x + d - 12, q.y - d - 12, 24, 24, this.width, this.height);
      m.style.opacity = String(focus); m.style.transform = `translate(${Math.round(q.x + d)}px, ${Math.round(q.y - d)}px) translate(-50%, -50%)`;
    });
  }
  /** Select a relationship (never opens). The card lists every drawn parallel row between the pair;
   * rule names and relationship-note paths arrive from the worker and fill in when resolved. */
  private selectEdge(edge: number, anchor = -1) {
    const through = this.carrierLevel().visibility; if (this.lineTarget(edge, through) < 0) edge--;
    const p = this.projection, c = this.noteCard, token = ++this.edgeToken;
    this.card.hide(); this.selected = this.hovered = -1; this.pathView = undefined; this.cue = -1; this.edgeAnchor = anchor; this.selectedEdges = this.edgeParallels(edge); this.emphasize(); this.refresh();
    const a = p.source[edge]!, b = this.lineTarget(edge, through), box = el('div', '', 'graph-ng-relationships'), na = this.name(a), nb = this.name(b);
    box.append(el('strong', `${na} → ${nb}`));
    const rows = this.selectedEdges.map(e => { const row = el('div', '', 'graph-ng-relationship'); row.append(el('span', p.types[p.type[e]!]! + (p.source[e] !== a ? ' (reverse)' : ''))); box.append(row); return row; });
    const ends = el('div', '', 'graph-ng-relationship'); ends.append(button('Open source', 'Open source ' + na, () => this.onNode(a)), button('Open target', 'Open target ' + nb, () => this.onNode(b))); box.append(ends);
    const go = el('div', '', 'graph-ng-relationship'); go.append(button('Go to source', `Go to ${na}: show its connections`, () => this.travel(a)), button('Go to target', `Go to ${nb}: show its connections`, () => this.travel(b))); box.append(go); c.append(box);
    this.describeEdges?.(this.selectedEdges).then(info => {
      if (token !== this.edgeToken || this.disposed) return;
      info.forEach((d, i) => { const row = rows[i]; if (!row) return; if (d.rule) row.append(el('small', 'Rule: ' + d.rule)); if (d.carrier) { const path = d.carrier; row.append(button('Open relationship note', 'Open relationship note ' + path, () => this.openPath?.(path))); if (this.openNote) row.append(button('Right', `Open relationship note ${path} to the right`, () => this.openNote?.(path, 'split'))); } });
      this.card.size = undefined; this.refresh();
    }, () => { if (token === this.edgeToken && !this.disposed) { box.append(el('small', 'Details unavailable')); this.card.size = undefined; this.refresh(); } });
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
    let more = this.animateLens(now);
    if (this.flight) {
      const f = this.flight, t = this.still() ? 1 : Math.min(1, (now - f.start) / f.ms), e = easeInOut(t);
      this.camera.x = f.from.x + (f.to.x - f.from.x) * e; this.camera.y = f.from.y + (f.to.y - f.from.y) * e;
      this.camera.ratio = Math.exp(Math.log(f.from.ratio) + (Math.log(f.to.ratio) - Math.log(f.from.ratio)) * e);
      if (t >= 1) { Object.assign(this.camera, f.to); this.flight = undefined; } else more = true;
    }
    if (this.ripple) { if (this.still() || now - this.ripple.start >= RIPPLE_MS) this.ripple = undefined; else more = true; }
    // O(1) per frame; frames are requested only while the preview moves.
    const h = this.hovered, x = this.hoverFx;
    if (h >= 0 ? h !== x.n || x.out : x.n >= 0 && !x.out) Object.assign(x, h >= 0 ? { n: h, out: false } : { out: true }, { at: now });
    const [grow, ring, next] = x.n < 0 ? [1, 0, false] : hoverPulse(now - x.at, x.out, this.still()); this.fx = [grow, ring];
    if (x.out && !next) x.n = -1; more ||= next;
    if (this.focusLevel !== this.focusTarget) {
      const t = this.still() ? 1 : Math.min(1, Math.max(0, (now - this.focusAt) / 220));
      this.focusLevel = this.focusFrom + (this.focusTarget - this.focusFrom) * easeInOut(t);
      more ||= this.focusLevel !== this.focusTarget;
    }
    this.pinCarriers();
    return more;
  }
  private draw = () => {
    cancelAnimationFrame(this.frameId); clearTimeout(this.frameTimer); this.frameTimer = undefined;
    this.frameId = 0; if (this.disposed || this.lost || !this.ready) return;
    // DPR can change without a CSS-size observer notification; reconcile on the next paint.
    if (this.dpr !== this.renderScale()) this.resize();
    const drawStart = performance.now(), more = this.animate(drawStart);
    const gl = this.gl, p = this.theme.palette, zoom = this.camera.ratio / this.homeRatio, v = this.settings.visuals;
    this.adaptSizes(zoom); this.layoutLens();
    if (!gl) { this.drawCanvas(); this.placeOverlay(); devicePerformance.frame(performance.now() - drawStart); if (more) this.refresh(); return; }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(p[8]! / 255, p[9]! / 255, p[10]! / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const lod = this.lodLevel(), policy = this.policy, fade = labelFade(this.settings.nodeSize, this.settings.labelRenderedSizeThreshold, this.camera.ratio, LABEL_RATIOS, v.labelFade && v.namePriority !== 'all', lod);
    const notes = this.carrierLevel(zoom), edgeWidth = this.edgeWidth(zoom), alpha = edgeAlpha(v, v.zoomAdapt ? 0 : this.visibleEdges, v.zoomAdapt ? 1 : zoom, policy.dark);
    const nodeSize = this.baseNodeRadius();
    const focus = v.hoverHighlight ? this.focusLevel : 0, haloAlpha = v.haloOpacity * Math.min(1, Math.max(0, (this.camera.ratio - .06) / .25));
    // Halos (under), edges, edge notes, other nodes, collapsed hubs, labels.
    const passes: [number, number, number, number?][] = [];
    if (policy.halos && haloAlpha > .002 && this.discData[0]!.length) passes.push([3, 2, 0]);
    const edgesOnTop = !!this.isolation && focus > 0, edgePass = v.edgeOpacity > 0 && v.edgeMode !== 'off';
    if (edgePass && !edgesOnTop) passes.push([0, 0, 0]);
    const density = edgePass && v.edgeMode === 'all' && v.edgeCompositing === 'density' && this.densityTarget();
    const [ink, reach] = this.edgeQuiet(2 * Math.max(.5, edgeWidth));
    if (this.visibleCarriers) passes.push([1, 1, 0, 0]);
    passes.push([1, 1, 0, 1]);
    if (edgePass && edgesOnTop) passes.push([0, 0, 0]);
    if (this.selected >= 0) passes.push([1, 1, 0, 2]);
    if (this.discData[1]!.length) passes.push([3, 3, 1]);
    if (!this.view.loading && !this.layoutActive && v.labelStyle === 'ranked' && v.namePriority !== 'selection' && this.atlas && fade.alpha > .004) passes.push([2, -1, 0]);
    const f = (location: WebGLUniformLocation | null, value: number) => gl.uniform1f(location, value), integer = (location: WebGLUniformLocation | null, value: number) => gl.uniform1i(location, value);
    for (const [i, vaoIndex, hub, layer = 1] of passes) {
      const program = this.programs[i]!, u = program.uniforms;
      gl.useProgram(program.handle); integer(u.lensPositions!, 5); f(u.lensBlend!, this.lensBlend); integer(u.lensAnchor!, this.lensAnchor); integer(u.positions!, 0); integer(u.palette!, 1); integer(u.atlas!, 2); integer(u.nodeColors!, 3); integer(u.nodeState!, 4); integer(u.positionWidth!, this.positionWidth);
      gl.uniform2f(u.center!, this.centerX, this.centerY); gl.uniform2f(u.viewport!, this.width, this.height); f(u.scale!, this.scale); f(u.nodeSize!, nodeSize); f(u.pixelRatio!, this.dpr); f(u.edgeSize!, edgeWidth); integer(u.hovered!, this.hoverFx.n); gl.uniform2f(u.pulse!, this.fx[0]!, this.fx[1]!); integer(u.selected!, this.selected); integer(u.focusNode!, this.focusNode); integer(u.edgeHovered!, this.hoveredEdge); integer(u.edgeNote!, this.lineOwner(this.hoveredEdge));
      f(u.focus!, focus); f(u.dim!, this.emphasisDim()); f(u.emphasis!, this.emphasisBudget()); f(u.glow!, layer ? policy.glow : 0);
      f(u.carrierAlpha!, edgePass ? notes.alpha : 0); f(u.carrierFold!, notes.visibility); f(u.carrierSize!, v.carrierSize); integer(u.layer!, layer);
      integer(u.tierMask!, this.tierMask); f(u.minSize!, v.tierMinSize); f(u.rings!, v.tierRings ? (this.directs.length > DIRECT_LABELS ? .5 : 1) : 0); f(u.strong!, v.focusEdges ? focusAlpha(this.directs.length) : 0);
      integer(u.segments!, policy.segments); f(u.curvature!, policy.curves ? v.curvature : 0); f(u.edgeAlpha!, alpha); f(u.direction!, v.edgeDirection ? 1 : 0); f(u.colorMix!, v.edgeColorMix); f(u.inkShare!, ink); f(u.fadeLength!, Math.min(reach, 1e9)); f(u.focusOnly!, v.edgeMode === 'focus' ? 1 : 0);
      f(u.labelAlpha!, fade.alpha); f(u.labelCut!, fade.cut); gl.uniform3f(u.outline!, p[8]! / 255, p[9]! / 255, p[10]! / 255); f(u.plates!, v.labelPlates ? .92 : 0); f(u.discAlpha!, hub ? 1 : haloAlpha); f(u.hub!, hub);
      gl.bindVertexArray(vaoIndex < 0 ? this.labelVaos[lod]! : this.vaos[vaoIndex]!);
      if (i === 0) {
        if (density) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.densityBuffer); gl.viewport(0, 0, this.densitySize[0]!, this.densitySize[1]!);
          gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.blendFunc(gl.ONE, gl.ONE);
          gl.uniform1i(u.layer!, 2); gl.drawElementsInstanced(gl.TRIANGLES, 6 * policy.segments, gl.UNSIGNED_SHORT, 0, this.projection.source.length);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          const tone = this.programs[4]!; gl.useProgram(tone.handle); gl.uniform1i(tone.uniforms.atlas!, 6); gl.uniform3f(tone.uniforms.outline!, p[4]! / 255, p[5]! / 255, p[6]! / 255);
          gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 6);
          gl.useProgram(program.handle); gl.bindVertexArray(this.vaos[0]!); gl.uniform1i(u.layer!, 3);
        }
        gl.drawElementsInstanced(gl.TRIANGLES, 6 * policy.segments, gl.UNSIGNED_SHORT, 0, this.projection.source.length);
      }
      else if (i === 1) {
        if (layer === 2) { gl.disableVertexAttribArray(0); gl.vertexAttrib1f(0, this.sizes[this.selected]!); gl.disableVertexAttribArray(1); gl.vertexAttribI4ui(1, this.carrierGeometry.nodes[this.selected]!, 0, 0, 0); }
        gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, layer === 2 ? 1 : this.visible.length);
        if (layer === 2) { gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); }
      }
      else if (i === 2) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.atlas!.levels[lod]!.length / 13);
      else gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.discData[hub]!.length / 8);
    }
    gl.bindVertexArray(null); this.placeOverlay(); const cost = performance.now() - drawStart; this.timings.maxDraw = Math.max(this.timings.maxDraw || 0, cost); devicePerformance.frame(cost);
    if (more) this.refresh();
  };
  /** Current label level with hysteresis; idempotent for an unchanged camera ratio. */
  private lodLevel() { return this.labelLevel = stickyLevel(this.labelLevel, this.camera.ratio, LABEL_RATIOS); }
  /** DOM text for the hovered note and collapsed groups only: bounded, text-only. */
  private placeOverlay() {
    if (this.view.loading || this.layoutActive) return;
    this.onSizingChange?.();
    const v = this.settings.visuals, focus = v.hoverHighlight ? this.focusLevel : 0, ego = this.focusNode, node = this.hovered < 0 && focus ? ego : this.hovered;
    const radius = (n: number) => this.drawnRadius(n, true, focus);
    if (this.placeCard()) { if (this.flight) this.panTo(this.card.node, this.flight.to.ratio); else this.frameSelection(); }
    this.placeHighlights(focus);
    // Overlay text never runs under the card or an overlay panel: each label's whole rectangle is
    // tested against their cached rects (the opaque stack and card also sit above as a backstop).
    const badgeBoxes: number[][] = [];
    const under = (x: number, y: number, w = 1, h = 1) => !labelInView(x, y, w, h, this.width - this.toolsInset, this.height) || badgeBoxes.some(r => overlapsBox(x, y, w, h, r)) || overlapsBox(x, y, w, h, this.cardRect) || this.panelRects.some(r => overlapsBox(x, y, w, h, r));
    for (const { node: n, el: b, width } of this.frontierBadges) {
      const p = this.screenPoint(n), x = p.x + radius(n) + 2, y = p.y - 16;
      b.hidden = !this.visible[n] || under(x, y, width, 32);
      if (!b.hidden) { b.style.transform = `translate(${x}px, ${y}px)`; badgeBoxes.push([x, y, width, 32]); }
    }
    const lod = this.lodLevel(), s = this.settings, tier = v.labelTierScale, hover = this.hoverLabel, ink = this.carrierCount ? this.edgeQuiet(2 * Math.max(.5, this.edgeWidth()))[0] : 1;
    let taken: number[][] = [];
    if (v.labelStyle === 'anchored' || v.namePriority === 'selection' && (ego !== this.selected || focus <= .5)) {
      hover.hidden = true;
      for (const el of [...this.tierLabels, ...this.tierLeaders]) el.hidden = true;
      taken = this.placeAnchored(node, focus, radius, under);
    } else {
    for (const p of this.anchorPool) p.hidden = true;
    if (node >= 0) {
      const text = this.noteCaption(node), cls = 'graph-ng-hover-label' + (node === ego && focus ? ' graph-ng-focus' : ''), font = node === ego && focus ? tierFont(0, s.labelSize, tier, this.theme.font) : '', key = text + '\n' + cls + '\n' + font;
      if (this.hoverBox[0] !== key) {
        hover.textContent = text; hover.className = cls; hover.style.font = font; hover.hidden = false;
        const m = this.measure ??= document.createElement('canvas').getContext('2d')!; m.font = font || `13px ${this.theme.font}`;
        this.hoverBox = [key, hover.offsetWidth || m.measureText(text).width + 12, hover.offsetHeight || 22];
      }
    } else { hover.textContent = ''; this.hoverBox[0] = ''; }
    // The previewed name fades in with the node's growth.
    hover.style.opacity = node === this.hoverFx.n && node !== ego ? String((this.fx[0]! - 1) / .6) : '';
    // Graduated labels: placed once per focus or LOD change, translated per frame (bounded DOM).
    if (!this.near.length) { this.rankedLabels = []; this.moreAt = undefined; }
    else if ([lod, this.display, this.fit, this.width, this.height, this.lensRevision].some((x, i) => x !== this.rankedKey[i])) {
      // Placement measures each bounded candidate once with the font and text the DOM label then uses, at the radius offset it is shown with.
      const k = this.scale * this.camera.ratio / LABEL_RATIOS[lod]!, budget = Math.max(1, Math.min(s.labelsMaxPerViewport, FOCUS_LABELS, Math.floor(this.width * this.height / s.labelGridCellSize ** 2 * s.labelDensity))), m = this.measure ??= document.createElement('canvas').getContext('2d')!;
      const pad = v.labelPlates ? 16 : 4, text = (n: number, rank: number) => n === ego ? this.noteCaption(n) : middleTruncate(this.name(n), LABEL_CHARS[rank]!);
      const { list, direct } = rankFocus(ego, this.near, this.stateBytes, this.visible, this.projection.offsets, budget * s.labelCandidateMultiplier, this.projection.carrierNodes, ego >= 0 ? this.interestOf(ego) : undefined, DIRECT_LABELS);
      const items = list.map(([n, rank]) => { m.font = tierFont(rank, s.labelSize, tier, this.theme.font); const h = tierType(rank, s.labelSize, tier).size * 1.5 + 4; return { node: n, rank, x: this.renderCoordinate(n, 0, 1) * k, y: this.renderCoordinate(n, 1, 1) * k, r: radius(n), w: m.measureText(text(n, rank)).width + pad, h }; });
      m.font = tierFont(1, s.labelSize, tier, this.theme.font); this.moreSize = [m.measureText(`+${direct} more`).width + 24, 32]; this.moreTotal = direct;
      const layout = radialLabels(items, budget, direct > DIRECT_LABELS ? 6 : DIRECT_LABELS, ego >= 0 ? direct : 0, this.moreSize[0]!, 32);
      this.rankedLabels = layout.slots.filter(x => x.node !== ego); this.moreAt = layout.more;
      this.rankedKey = [lod, this.display, this.fit, this.width, this.height, this.lensRevision];
      this.overlay.className = 'graph-ng-overlay' + (v.labelPlates ? ' graph-ng-plates' : '');
      const pool = (list: HTMLElement[], count: number, cls: string) => { while (list.length > count) list.pop()!.remove(); while (list.length < count) list.push(this.overlay.appendChild(el('div', '', cls))); };
      pool(this.tierLabels, this.rankedLabels.length, ''); pool(this.tierLeaders, this.rankedLabels.filter(x => x.leader).length, 'graph-ng-leader');
      let j = 0;
      this.rankedLabels.forEach(({ node: n, rank, leader }, i) => {
        const el = this.tierLabels[i]!, full = this.name(n); el.className = 'graph-ng-focus-label graph-ng-tier-' + rank; el.style.font = tierFont(rank, s.labelSize, tier, this.theme.font); el.textContent = text(n, rank);
        // Text-only labels must not trigger native or host aria-label tooltips.
        el.removeAttribute('title'); el.removeAttribute('aria-label'); el.setAttribute('aria-description', full);
        if (leader) this.tierLeaders[j++]!.style.width = `${Math.round(Math.hypot(leader[2] - leader[0], leader[3] - leader[1]))}px`;
      });
      if (layout.more) {
        const b = this.moreControl();
        b.style.font = tierFont(1, s.labelSize, tier, this.theme.font);
      }
    }
    if (!this.rankedLabels.length) { while (this.tierLabels.length) this.tierLabels.pop()!.remove(); while (this.tierLeaders.length) this.tierLeaders.pop()!.remove(); }
    let j = 0, shown = 0;
    this.rankedLabels.forEach(({ node: n, rank, dx, dy, w, h, leader }, i) => {
      const el = this.tierLabels[i]!, p = this.screenPoint(n), x = leader ? p.x + dx : p.x + radius(n) + 4, y = leader ? p.y + dy : p.y; el.hidden = !!this.carrierCount && !this.carrierShown(n, ink, focus) || under(x, y - h / 2, w, h) || under(p.x, p.y); if (!el.hidden) { taken.push([x, y - h / 2, w, h]); shown += +(rank === 1); } el.style.opacity = String(focus); el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translateY(-50%)`;
      if (leader) { const line = this.tierLeaders[j++]!; line.hidden = el.hidden; line.style.opacity = String(focus); line.style.transform = `translate(${Math.round(p.x + leader[0])}px, ${Math.round(p.y + leader[1])}px) rotate(${Math.atan2(leader[3] - leader[1], leader[2] - leader[0])}rad)`; }
    });
    if (this.moreButton) {
      // "+N more" counts the direct connections without a label actually shown this frame.
      const b = this.moreButton, rest = this.moreTotal - shown, text = `+${rest} more`;
      if (b.textContent !== text) { b.textContent = text; b.setAttribute('aria-label', `Show ${rest} more direct connections of ${ego >= 0 ? this.name(ego) : ''}`); }
      const at = this.moreAt, p = ego >= 0 ? this.screenPoint(ego) : { x: 0, y: 0 }, [mw, mh] = this.moreSize, [mx, my] = insetLabel(p.x + (at?.dx ?? 0), p.y + (at?.dy ?? 0) - mh! / 2, mw!, mh!, this.width - this.toolsInset, this.height), show = rest > 0 && !!at && ego >= 0 && focus > 0 && !under(mx!, my!, mw, mh); b.hidden = !show;
      if (show) { taken.push([mx!, my!, mw!, mh!]); b.style.opacity = String(focus); b.style.transform = `translate(${Math.round(mx!)}px, ${Math.round(my! + mh! / 2)}px) translateY(-50%)`; }
    }
    if (node >= 0) {
      // Right, left, above, then below the dot (centred, nudged into view). Never under the card or a
      // panel; prefer a spot inside the view and clear of the labels and "+N more" already placed.
      const p = this.screenPoint(node), [, w, h] = this.hoverBox, gap = radius(node) + 6, mid = p.x - w / 2;
      const spots = [[p.x + gap, p.y - 10], [p.x - gap - w, p.y - 10], [mid, p.y - gap - h], [mid, p.y + gap]].map(([x, y]) => insetLabel(x!, y!, w, h, this.width - this.toolsInset, this.height)).filter(([x, y]) => !under(x!, y!, w, h));
      const at = spots.find(([x, y]) => !taken.some(b => overlapsBox(x!, y!, w, h, b))) ?? spots[0];
      hover.hidden = !at || !!this.carrierCount && !this.carrierShown(node, ink, focus); if (at) taken.push([at[0]!, at[1]!, w, h]); if (at) hover.style.transform = `translate(${Math.round(at[0]!)}px, ${Math.round(at[1]!)}px)`;
    }
    }
    this.placePath(radius, focus);
    this.crumbTrail.update(v.breadcrumb, this.card.history, this.selected, this.width);
    this.miniMap.update({ on: v.minimap && this.width >= MINIMAP_MIN_CANVAS, positions: this.display, visible: this.visible, layoutFrame: this.grid, cx: this.camera.x, cy: this.camera.y, worldW: this.width / this.scale, worldH: this.height / this.scale, focus: this.visible[this.focusNode] ? this.focusNode : -1, directs: this.directs, ink: this.theme.text, accent: this.theme.accent });
    // Greedy vertical nudge keeps coincident hub labels legible (hubs are bounded).
    const placed: [number, number, number][] = [];
    this.hubLabels.forEach((el, i) => {
      const h = this.hubs[i]!, x = (h.x - this.centerX) * this.scale + this.width / 2, half = el.offsetWidth / 2 || 40, line = el.offsetHeight || 18;
      let y = (h.y - this.centerY) * this.scale + this.height / 2 + h.radius + 4;
      for (let k = 0; k < placed.length; k++) { const [px, py, ph] = placed[k]!; if (Math.abs(px - x) < half + ph && Math.abs(py - y) < line) { y = py + line + 2; k = -1; } }
      // Placed labels, "+N more" and the hover label above keep their place: a hub label never lands on them.
      // Visibility, not `hidden`: a covered label keeps its measured size, so it cannot flicker.
      el.style.visibility = under(x - half, y, 2 * half, line) || taken.some(b => overlapsBox(x - half, y, 2 * half, line, b)) ? 'hidden' : ''; placed.push([x, y, half]); el.style.transform = `translate(-50%, 0) translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    });
  }
  /** Shared by WebGL and Canvas: <=64 pooled names with CSS ring/leader marks; no per-frame measurement.
   * Candidate captions are measured only when focus, settings or atlas change. Collision uses actual
   * screen positions (including animated lens/radii), not a conservative atlas LOD approximation. */
  private placeAnchored(node: number, focus: number, radius: (n: number) => number, under: (x: number, y: number, w: number, h: number) => boolean) {
    const s = this.settings, ego = s.visuals.namePriority === 'selection' ? this.selected : focus > .5 ? this.focusNode : -1, size = s.labelSize, h = Math.ceil(size * 1.5) + 4, lod = this.lodLevel();
    const key = [this.atlas, ego, node, size, this.theme, this.tierMask, this.visible, lod, s.visuals.namePriority];
    if (key.some((v, i) => v !== this.anchorKey[i])) {
      const m = this.measure ??= document.createElement('canvas').getContext('2d')!;
      m.font = `${size}px ${this.theme.font}`;
      const overview = s.visuals.namePriority === 'all' ? [...this.atlas?.widths.keys() ?? []] : Array.from(this.atlas?.nodes[lod] ?? []);
      // Naming follows selection even when highlight focus is off or held on a different lens.
      let near = this.near, state = this.stateBytes;
      if (ego >= 0 && ego !== this.focusNode) {
        near = []; state = new Uint8Array(state.length);
        focusTiers(ego, this.edges, this.projection, this.edgeOn, this.filterVisible, state, new Uint8Array(this.edgeTier.length), near, [], 65536, this.settings.declaration.groupContext ? this.view.groupCodes : undefined);
      }
      const ranked = ego < 0 ? { list: [] as (readonly [number, number])[], direct: 0 } : rankFocus(ego, near, state, this.visible, this.projection.offsets, ANCHORED_CANDIDATES, this.projection.carrierNodes, this.interestOf(ego), DIRECT_LABELS);
      if (s.visuals.namePriority !== 'selection') { const seen = new Set(ranked.list.map(([n]) => n)); for (const n of overview) if (!seen.has(n) && (ego < 0 || ranked.list.length < ANCHORED_CANDIDATES)) ranked.list.push([n, 5]); }
      this.moreTotal = ranked.direct; this.moreSize = [m.measureText(plural(ranked.direct, 'more connection')).width + 32, Math.max(32, h + 4)];
      const list = node >= 0 ? [[node, 0] as const, ...ranked.list.filter(([n]) => n !== node)] : ranked.list;
      this.anchorNames = list.map(([n, rank]) => { const text = middleTruncate(n === node ? this.noteCaption(n) : this.name(n), n === node ? 48 : 32); return { node: n, rank, tier: state[n * 4 + 1]!, text, w: Math.ceil(m.measureText(text).width) + 12 }; });
      this.anchorKey = key;
    }
    // Fewer overview names; a sticky LOD and spatial clearance prevent threshold chatter.
    const budget = Math.max(1, Math.min(ANCHORED_LABELS, s.labelsMaxPerViewport, Math.floor(this.width * this.height / Math.max(160, s.labelGridCellSize) ** 2 * s.labelDensity / Math.max(1, lod - 1))));
    // Reuse the ranked grid's bounded LOD placements. Cull offscreen notes BEFORE the collision cap.
    const names: (LabelItem & { text: string; tier: number })[] = [], ink = this.carrierCount ? this.edgeQuiet(2 * Math.max(.5, this.edgeWidth()))[0] : 1;
    for (const it of this.anchorNames) {
      if (!this.visible[it.node] || this.carrierCount && !this.carrierShown(it.node, ink, focus) || it.rank < 5 && ego >= 0 && it.node !== ego && it.node !== node && !shownTier(it.tier, this.tierMask)) continue;
      const p = this.screenPoint(it.node); if (under(p.x, p.y, 0, 0)) continue;
      names.push({ ...it, ...p, r: radius(it.node), h }); if (names.length >= ANCHORED_CANDIDATES) break;
    }
    const slots = anchoredLabels(names, budget, this.anchorPrevious, under, this.moreTotal > DIRECT_LABELS ? 6 : DIRECT_LABELS);
    this.anchorPrevious = new Map(slots.map(it => [it.node, it.side]));
    while (this.anchorPool.length < slots.length) this.anchorPool.push(this.overlay.appendChild(el('span', '', 'graph-ng-anchor-text')));
    this.anchorPool.forEach((p, i) => {
      const it = slots[i]; p.hidden = !it; if (!it) return;
      const text = names.find(n => n.node === it.node)!.text; if (p.textContent !== text) p.textContent = text; p.setAttribute('aria-description', this.name(it.node));
      p.style.font = `${size}px ${this.theme.font}`; p.style.lineHeight = `${h - 4}px`; p.style.background = s.visuals.labelPlates ? this.theme.background : 'transparent';
      p.style.transform = `translate(${it.left}px, ${it.top}px)`;
      const values = [it.x - it.left, it.y - it.top, Math.max(3, it.r + 2), [0, 180, -90, 90][it.side]!];
      ['x', 'y', 'radius', 'angle'].forEach((key, i) => p.style.setProperty(`--anchor-${key}`, `${values[i]}${i === 3 ? 'deg' : 'px'}`));
    });
    const taken = slots.map(it => it.box);
    if (this.moreButton) this.moreButton.hidden = true;
    const rest = this.moreTotal - slots.filter(it => it.node !== ego && names.find(n => n.node === it.node)?.tier === 255).length, anchor = slots.find(it => it.node === ego);
    if (ego >= 0 && rest > 0 && anchor) {
      const b = this.moreControl();
      const x = anchor.left, y = anchor.top + h + 4, [w, bh] = this.moreSize;
      b.hidden = under(x, y, w!, bh!) || taken.some(box => overlapsBox(x, y, w!, bh!, box));
      b.textContent = plural(rest, 'more connection'); b.removeAttribute('aria-label'); b.style.font = `${size}px ${this.theme.font}`; b.style.transform = `translate(${x}px, ${y}px)`;
      if (!b.hidden) taken.push([x, y, w!, bh!]);
    }
    return taken;
  }
  /** Where Groups leads back to: the selection (or lens), its group and the camera. */
  returnPoint() {
    const n = this.lensWanted >= 0 ? this.lensWanted : this.selected;
    return n < 0 ? undefined : { node: n, name: this.name(n), group: this.view.groupCodes?.[n], lens: this.lensWanted === n, camera: { ...this.camera } };
  }
  /** Select a note and show its card, optionally with the lens (Back from Groups). */
  focusNote(n: number, lens = false) {
    if (!(n >= 0 && n < this.visible.length && this.filterVisible[n])) return;
    this.selectNote(n, true); if (lens) this.setLens(n);
  }
  private moreControl() { return this.moreButton ??= this.overlay.appendChild(Object.assign(document.createElement('button'), { className: 'graph-ng-more', onclick: () => { const n = this.settings.visuals.namePriority === 'selection' ? this.selected : this.focusNode; if (n >= 0) this.onMoreConnections(n); } })); }
  private updateLegend() { paintLegend(this.legendRows, this.legendCounts, this.tierMask, this.tierTotals); }
  /** Centre the note in measured free space, keeping zoom unless travel supplies a target. */
  private panTo(n: number, ratio = this.camera.ratio) {
    if (n < 0 || !this.filterVisible[n]) return;
    this.centreOn(this.renderCoordinate(n, 0), this.renderCoordinate(n, 1), ratio, undefined, ...this.cardInset());
  }
  /** One expanding ring from the focus to its farthest direct connection (world reach, O(degree)). */
  private startRipple(n: number) {
    const v = this.settings.visuals; this.ripple = undefined;
    if (n < 0 || n !== this.focusNode || !v.focusRipple || !v.hoverHighlight || !this.directs.length || this.still()) return;
    let reach = 0; const fx = this.renderCoordinate(n, 0), fy = this.renderCoordinate(n, 1);
    for (const d of this.directs) reach = Math.max(reach, Math.hypot(this.renderCoordinate(d, 0) - fx, this.renderCoordinate(d, 1) - fy));
    this.ripple = { start: performance.now(), reach };
  }
  /** Per frame: O(direct connections) pip projection, legend visibility and the ripple ring. */
  private placeHighlights(focus: number) {
    const v = this.settings.visuals, on = v.hoverHighlight && this.focusTarget > 0;
    this.legend.hidden = !(on && v.tierLegend && this.tierTotals.some(Boolean)) || !!this.pathView;
    const ids = on && focus > 0 && v.offscreenPips && this.tierMask & 1 ? this.directs : [];
    if (this.pipXY.length < ids.length * 2) this.pipXY = new Float64Array(ids.length * 2);
    const xy = this.pipXY;
    for (let i = 0; i < ids.length; i++) { const p = this.screenPoint(ids[i]!); xy[i * 2] = p.x; xy[i * 2 + 1] = p.y; }
    const [right, bottom] = this.cardInset(), pips = ids.length ? offscreenPips(ids, this.pipXY, this.width - right, this.height - bottom, PIP_INSET) : [];
    this.pipEls.forEach((el, i) => {
      const pip = pips[i]; el.hidden = !pip || !labelInView(pip.x - 16, pip.y - 16, 32, 32, this.width - right, this.height - bottom); if (el.hidden || !pip) return;
      this.pipTargets[i] = pip.node; el.style.transform = `translate(${Math.round(pip.x - 16)}px, ${Math.round(pip.y - 16)}px)`; el.style.opacity = String(focus);
      const [arrow, count] = this.pipParts[i]!; arrow.style.transform = `rotate(${pip.sector * 45}deg)`;
      const text = pip.count > 999 ? '999+' : String(pip.count), label = `${pip.count.toLocaleString()} direct connection${pip.count === 1 ? '' : 's'} ${PIP_DIRECTIONS[pip.sector]}. Go to the nearest.`;
      if (count.textContent !== text) count.textContent = text;
      if (el.getAttribute('aria-label') !== label) { el.setAttribute('aria-label', label); el.title = label; }
    });
    const r = this.ripple, ego = this.focusNode;
    this.rippleEl.hidden = !r || ego < 0;
    if (r && ego >= 0) {
      const t = Math.min(1, (performance.now() - r.start) / RIPPLE_MS), e = 1 - (1 - t) ** 3, p = this.screenPoint(ego), from = this.drawnRadius(ego, true, focus);
      const size = from + (Math.min(Math.hypot(this.width, this.height) / 2, r.reach * this.scale) - from) * e;
      Object.assign(this.rippleEl.style, { width: `${2 * size}px`, height: `${2 * size}px`, transform: `translate(${Math.round(p.x - size)}px, ${Math.round(p.y - size)}px)`, opacity: String(.9 * (1 - t)) });
    }
  }
  /** Dock the card to the view's right edge (a fixed side panel the camera never moves), or a bottom
   * sheet on narrow views. It stops above the minimap. The leader line runs from the card edge to the
   * cued row's note. O(1) per frame. */
  private placeCard() {
    const c = this.noteCard, w = this.width, h = this.height;
    if (this.card.node < 0 && !this.selectedEdges.length && !this.pathView) { this.cardRect = [0, 0, 0, 0]; this.cueRing.hidden = this.cueLine.hidden = true; return; }
    // The card stops above the minimap unless the tools panel already covers the minimap's column.
    const t = this.toolsInset, sheet = sheetCard(w, t, this.settings.visuals.cardPlacement), cls = 'graph-ng-card' + (sheet ? ' graph-ng-sheet' : ''), mini = this.settings.visuals.minimap && w >= MINIMAP_MIN_CANVAS && t < MINIMAP_W + 8;
    const compact = String(sheet && t > 0 && this.card.node >= 0);
    if (c.dataset.compact !== compact) { c.dataset.compact = compact; c.dataset.folded = compact; c.querySelector('.graph-ng-card-fold')?.setAttribute('aria-expanded', String(compact !== 'true')); this.card.size = undefined; }
    const room = `${Math.max(120, h - 16 - (mini ? (this.miniMap.folded ? 32 : MINIMAP_H) + 8 : 0))}px`, across = `${sheet ? w - t : Math.min(320, Math.max(264, (w - t) * .34))}px`;
    if (c.className !== cls || !sheet && c.style.maxHeight !== room || c.style.width !== across) { c.className = cls; c.style.maxHeight = sheet ? '' : room; c.style.width = across; this.card.size = undefined; }
    const changed = !this.card.size;
    const [cw, ch] = this.card.size ??= [c.offsetWidth || 320, c.offsetHeight || 240], rect = this.cardRect = dockCard(w, h, cw, ch, 8, t, this.settings.visuals.cardPlacement);
    c.style.transform = sheet ? '' : `translate(${rect[0]}px, ${rect[1]}px)`;
    const n = this.cue, ring = this.cueRing, line = this.cueLine;
    if (n < 0 || !this.filterVisible[n]) { ring.hidden = line.hidden = true; return changed; }
    const q = this.screenPoint(n), x = Math.max(8, Math.min(w - 8, q.x)), y = Math.max(8, Math.min(h - 8, q.y)), [rx, ry, rw, rh] = this.cardRect;
    const ax = Math.max(rx!, Math.min(rx! + rw!, x)), ay = Math.max(ry!, Math.min(ry! + rh!, y)), length = Math.hypot(x - ax, y - ay);
    ring.hidden = false; ring.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    line.hidden = length < 4; line.style.width = `${Math.round(length)}px`; line.style.transform = `translate(${Math.round(ax)}px, ${Math.round(ay)}px) rotate(${Math.atan2(y - ay, x - ax)}rad)`;
    return changed;
  }
  private drawCanvas() {
    const ctx = this.ctx!, s = this.settings, c = this.colorBytes, focus = s.visuals.hoverHighlight ? this.focusLevel : 0, dim = this.emphasisDim(), budget = this.emphasisBudget(), g = this.stateBytes;
    // Frame invariants, not per endpoint/node work (including an unsaved sizing preview).
    const cx = this.centerX, cy = this.centerY, scale = this.scale, hw = this.width / 2, hh = this.height / 2, radius = this.baseNodeRadius();
    const x = (n: number) => (this.renderCoordinate(n, 0) - cx) * scale + hw, y = (n: number) => (this.renderCoordinate(n, 1) - cy) * scale + hh;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.fillStyle = this.theme.background; ctx.fillRect(0, 0, this.width, this.height); ctx.strokeStyle = this.theme.edge; ctx.lineWidth = s.edgeSize;
    // The edge shader's tier weights: rest, neighbours of neighbours, then direct strokes on top.
    const zoom = this.camera.ratio / this.homeRatio, base = edgeAlpha(s.visuals, s.visuals.zoomAdapt ? 0 : this.visibleEdges, s.visuals.zoomAdapt ? 1 : zoom, this.policy.dark), width = 2 * Math.max(.5, this.edgeWidth(zoom));
    const level = this.carrierLevel(zoom, radius), hoveredOwner = this.lineOwner(this.hoveredEdge), mask = this.tierMask, strong = s.visuals.focusEdges ? focusAlpha(this.directs.length) : 0, mode = s.visuals.edgeMode, [ink, reach] = this.edgeQuiet(width);
    // The same quantile admission and long-line threshold as the shader; focus tiers are never sampled.
    const drawEdges = () => { for (const tier of mode === 'off' ? [] : focus ? mode === 'focus' ? [128, 255] : [0, 128, 255] : [-1]) {
      let [alpha, wide] = tierEdge(tier, base * (mode === 'focus' ? focus : 1), tier < 0 ? 0 : focus, dim);
      if (strong && tier >= 0) { const [a2, w2] = strongEdge(tier, alpha, focus, strong); alpha = a2; wide *= w2; }
      ctx.lineWidth = width * wide; const lines: number[] = [], legs: number[] = [], hue: number[] = [], line = (e: number) => { const a = this.projection.source[e]!, b = this.lineTarget(e, level.visibility); if (b < 0 || this.carrierGeometry.enabled[e] === 0 || this.lineRanks[e]! & 0x2000000 && (!level.alpha || !this.carrierLineShown(e, ink))) return; ctx.moveTo(x(a), y(a)); ctx.lineTo(x(b), y(b)); };
      for (const e of this.canvasEdges) { const a = this.projection.source[e]!, b = this.lineTarget(e, level.visibility); if (b < 0 || this.carrierGeometry.enabled[e] === 0) continue; const owner = this.lineOwner(e), retained = !!(this.lineRanks[e]! & 0x2000000), t = this.carrierPinned(e) || this.edgeTier[e] === PATH_EDGE ? 255 : owner < 0 ? shownEdgeTier(this.edgeTier[e]!, mask) : this.carrierTier(owner), hot = e === this.hoveredEdge || owner >= 0 && (owner === this.selected || owner === this.hoverFx.n || owner === hoveredOwner); if (!this.edgeDrawn(e) || mode === 'focus' && (!t || !focus) && !this.carrierPinned(e) || retained && (!level.alpha || !this.carrierLineShown(e, ink)) || tier >= 0 && edgeBucket(t) !== tier) continue; if (!retained && !(t && focus) && !hot && !lineAdmitted(this.lineRanks[e]!, ink, Math.hypot(x(b) - x(a), y(b) - y(a)), Math.min(reach, 1e9))) continue; if (tier >= 0 && tintedEdge(t)) hue.push(e); (owner >= 0 && (retained || level.visibility) ? legs : lines).push(e); }
      ctx.globalAlpha = alpha; if (s.visuals.edgeOpacity > 0 && lines.length) { ctx.beginPath(); lines.forEach(line); ctx.stroke(); }
      if (s.visuals.edgeOpacity > 0 && legs.length) { ctx.globalAlpha = Math.max(.25, alpha); ctx.beginPath(); legs.forEach(line); ctx.stroke(); }
      // Tinted relationship layer: the shader mixes the accent by focus / 2 at the same weight.
      if (s.visuals.edgeOpacity > 0 && hue.length) { ctx.strokeStyle = this.theme.accent; ctx.globalAlpha = alpha * focus * .5; ctx.beginPath(); hue.forEach(line); ctx.stroke(); ctx.strokeStyle = this.theme.edge; }
      // Path tier on top, as the shader's 253 branch: accent, pathStroke alpha and width.
      if (tier === 255 && this.pathView && s.visuals.edgeOpacity > 0) { const [pa, pw] = pathStroke(alpha, focus); ctx.strokeStyle = this.theme.accent; ctx.globalAlpha = pa; ctx.lineWidth = width * wide * pw; ctx.beginPath(); for (const e of this.pathView.edges) if (this.edgeTier[e] === PATH_EDGE) line(e); ctx.stroke(); ctx.strokeStyle = this.theme.edge; }
    }
    };
    const edgesOnTop = !!this.isolation && focus > 0; if (!edgesOnTop) drawEdges();
    const notes = this.projection.carrierNodes;
    // Edge notes first (beneath), then the other nodes.
    for (const layer of [1, 0, 2]) {
    if (layer === 2 && edgesOnTop) drawEdges();
    for (let n = layer === 2 ? this.selected : 0; n >= 0 && n < (layer === 2 ? this.selected + 1 : this.visible.length); n++) if (this.visible[n] && (layer === 2 || n !== this.selected && +!!notes[n] === layer)) {
      if (!this.carrierShown(n, ink, focus, level.visibility)) continue;
      const hot = n === this.selected || n === this.hoverFx.n, k = n * 4, p = this.theme.palette, coverage = notes[n] ? level.alpha : 1;
      const a = coverage * (hot ? p[19]! : c[k + 3]!) / 255;
      if (coverage < .004 || a <= 0) continue;
      const ego = n === this.focusNode, shown = (notes[n] ? this.carrierTier(n) : shownTier(g[k + 1]!, this.tierMask, ego)) / 255, [fade, , tr] = tierNode(shown, hot, ego, focus, dim), r = this.drawnRadius(n, hot, focus, radius, budget);
      const ring = Math.max(n === this.selected ? 1 : tr, n === this.hoverFx.n ? this.fx[1]! : 0);
      ctx.globalAlpha = notes[n] || this.carrierGeometry.nodes[n] !== 0xffffffff && this.carrierGeometry.nodes[n]! & 0x4000000 ? Math.max(.25, a * fade) : a * fade; ctx.fillStyle = ctx.strokeStyle = hot ? `rgb(${p[16]},${p[17]},${p[18]})` : `rgb(${c[k]},${c[k + 1]},${c[k + 2]})`; ctx.beginPath(); ctx.arc(x(n), y(n), r, 0, Math.PI * 2); ctx.fill();
      // The shader's outer ring band (1.1–1.34 radii) as one stroke.
      if (ring) { ctx.globalAlpha = a * ring; ctx.lineWidth = r * .2; ctx.beginPath(); ctx.arc(x(n), y(n), r * 1.22, 0, Math.PI * 2); ctx.stroke(); }
      // Contrast rings in the text colour: direct band 1.07–1.25, focus outer band 1.49–1.65 radii.
      const band = !notes[n] && s.visuals.tierRings && focus ? (ego ? 1.57 : shown > .9 && this.directs.length <= DIRECT_LABELS ? 1.16 : 0) : 0;
      if (band) { ctx.globalAlpha = a * fade * focus; ctx.strokeStyle = this.theme.text; ctx.lineWidth = r * (ego ? .16 : .18); ctx.beginPath(); ctx.arc(x(n), y(n), r * band, 0, Math.PI * 2); ctx.stroke(); }
    }
    }
    ctx.globalAlpha = 1;
    for (const h of this.hubs) { ctx.fillStyle = this.groupColor(h.group); ctx.beginPath(); ctx.arc((h.x - this.centerX) * this.scale + this.width / 2, (h.y - this.centerY) * this.scale + this.height / 2, h.radius, 0, Math.PI * 2); ctx.fill(); }
    // The label shader's terms: zoom alpha, importance cut (degree rank), degree-weighted size, background outline.
    const lod = this.lodLevel(), fade = labelFade(s.nodeSize, s.labelRenderedSizeThreshold, this.camera.ratio, LABEL_RATIOS, s.visuals.labelFade && s.visuals.namePriority !== 'all', lod), nodes = this.atlas?.nodes[lod], scales = this.atlas?.scales[lod];
    ctx.textBaseline = 'top';
    if (!this.view.loading && !this.layoutActive && s.visuals.labelStyle === 'ranked' && s.visuals.namePriority !== 'selection' && nodes && scales && fade.alpha > .004) nodes.forEach((n, i) => {
      const cut = Math.min(1, Math.max(0, (1 - i / nodes.length - fade.cut) / .15)); ctx.globalAlpha = tierLabel(g[n * 4 + 1]! / 255, fade.alpha * cut * cut * (3 - 2 * cut), focus, dim);
      if (ctx.globalAlpha <= .004) return; ctx.font = `${s.labelSize * scales[i]!}px ${this.theme.font}`;
      const name = this.name(n), lx = x(n) + this.nodeRadius(n, false, radius) + 4, ly = y(n) - s.labelSize * scales[i]! / 2;
      if (!labelInView(lx - 2, ly - 2, this.atlas!.widths.get(n)! * scales[i]! + 4, s.labelSize * scales[i]! * 1.5 + 4, this.width, this.height)) return;
      if (s.visuals.labelPlates) { ctx.fillStyle = this.theme.background; ctx.fillRect(lx - 2, ly - 2, this.atlas!.widths.get(n)! * scales[i]! + 4, s.labelSize * scales[i]! * 1.5 + 4); }
      ctx.fillStyle = this.theme.text; ctx.fillText(name, lx, ly);
    });
  }
  /** The explicit renderer surface src/interaction.ts drives (and future input streams extend). */
  private controls(): RendererControls {
    const r = this, p = this.projection;
    return {
      canvas: this.canvas, camera: this.camera,
      get live() { return !r.disposed && !r.lost; },
      get settings() { return r.settings; },
      get width() { return r.width; },
      get height() { return r.height; },
      get visible() { return r.visible; },
      get selected() { return r.selected; },
      get hovered() { return r.hovered; },
      get hoveredEdge() { return r.hoveredEdge; },
      get focusNode() { return r.focusNode; },
      get lensNode() { return r.lensWanted; },
      get cardNode() { return r.card.node; },
      get edgeCard() { return r.selectedEdges.length > 0 || !!r.pathView; },
      get isolated() { return !!r.isolation; },
      pick: (x, y) => this.layoutActive ? -1 : this.pick(x, y),
      pickHub: (x, y) => this.layoutActive ? -1 : this.pickHub(x, y),
      pickEdge: (x, y) => this.layoutActive ? -1 : this.pickEdge(x, y),
      screenPoint: n => this.screenPoint(n),
      owns: t => t === this.canvas || this.overlay.contains(t as Node),
      selectNote: (n, card, keepLens) => this.selectNote(n, card, keepLens),
      selectEdge: e => this.selectEdge(e),
      cycleEdge: step => this.cycleEdge(step),
      setHover: (node, edge) => { this.hovered = node; this.hoveredEdge = edge; this.refresh(); },
      hint: (hub, node, edge, cursor) => {
        this.container.removeAttribute('title');
        if (cursor) this.canvas.style.cursor = node >= 0 || hub >= 0 || edge >= 0 ? 'pointer' : 'grab';
      },
      groupLabel: n => this.view.groupLabels?.[this.view.groupCodes?.[n] ?? -1] ?? 'Ungrouped',
      openable: n => !this.layoutActive && !!this.filterVisible[n],
      open: n => { if (!this.layoutActive) this.onNode(n); },
      openHub: g => { if (!this.layoutActive) this.onHub?.(g); },
      stopFlight: () => { this.followLayout = false; this.flight = undefined; },
      setCamera: (x, y, ratio) => { this.followLayout = false; this.setCamera(x, y, ratio); },
      flyTo: (x, y, ratio, ms) => this.flyTo(x, y, ratio, ms),
      panBy: (dx, dy) => this.panBy(dx, dy),
      zoomAt: (factor, x, y) => {
        // Zooming out clamps a little past the whole graph (and Fit all); it never switches views.
        this.followLayout = false; this.flight = undefined; const before = this.scale, step = zoomStep(this.camera.ratio, factor, this.settings.cameraMinRatio, this.clampRatio(Math.max(this.homeRatio, this.layoutRatio()) * ZOOM_OUT_LIMIT));
        this.camera.ratio = step.ratio; if (step.clamped) this.limitChip.hit(performance.now());
        this.camera.x += (x / before - x / this.scale) / this.cameraFrame.width; this.camera.y += (y / before - y / this.scale) / this.cameraFrame.height; this.refresh();
      },
      setLens: n => this.setLens(n),
      toggleLens: () => this.toggleLens(),
      cardKey: e => this.card.key(e),
      cardStep: step => this.card.step(step),
      isolate: n => this.isolate(n),
      focusCanvas: () => this.canvas.focus(),
      flyToNote: n => { if (!this.layoutActive) this.travel(n); },
      act: (a, n) => this.cardAction(a, n),
      travel: n => { if (!this.layoutActive) this.travel(n); },
      fitAll: () => this.fitAll(),
      relationship: async e => { const carrier = p.carrier[e] === 0xffffffff ? undefined : (await this.describeEdges?.([e]).catch(() => []))?.[0]?.carrier; return { source: p.source[e]!, target: p.target[e]!, note: carrier ? () => this.openPath?.(carrier) : undefined }; },
      showMenu: (entries, x, y, n) => { if (!this.layoutActive) this.showMenu?.(entries, x, y, n >= 0 ? this.path(n) : undefined); },
      findPath: (from, to) => this.findPath(from, to),
    };
  }
  private contextLost = (e: Event) => {
    e.preventDefault(); if (this.disposed) return; this.lost = true; this.ready = false; this.input.release(); invalidateSearch(this.canvas); this.container.title = ''; this.canvas.style.cursor = 'wait';
    cancelAnimationFrame(this.frameId); clearTimeout(this.frameTimer); this.frameTimer = undefined; this.frameId = 0; this.canvas.dataset.context = 'lost';
    clearTimeout(this.restoreTimer); this.restoreTimer = setTimeout(() => { if (!this.disposed && this.lost) { this.canvas.dataset.context = 'failed'; this.onUnavailable(); } }, this.settings.contextRestoreTimeoutMs);
  };
  private contextRestored = () => {
    if (this.disposed) return; clearTimeout(this.restoreTimer); this.restoreTimer = undefined; this.canvas.style.cursor = 'grab';
    this.lost = false; this.densityBuffer = null; this.densitySize = [0, 0]; this.densityReady = false; this.programs = []; this.vaos = []; this.buffers = []; this.textures = []; this.labelBuffers = []; this.labelVaos = []; this.discBuffers = [null, null];
    void this.initialize().then(() => { if (!this.disposed && !this.lost) this.canvas.dataset.context = 'restored'; }).catch(() => { if (!this.disposed) { this.canvas.dataset.context = 'failed'; this.onUnavailable(); } });
  };
  dispose() { clearTimeout(this.sizingTimer);
    if (this.disposed) return; this.disposed = true; this.labelsRevision++; clearTimeout(this.restoreTimer); this.restoreTimer = undefined; cancelAnimationFrame(this.frameId); clearTimeout(this.frameTimer); this.frameTimer = undefined; this.observer.disconnect(); this.panelObserver?.disconnect(); this.media.removeEventListener('change', this.refreshTheme); this.motionMedia.removeEventListener('change', this.motionChanged);
    this.input.detach(this.container); this.limitChip.stop(); disposeSearch(this.canvas); this.miniMap.dispose();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    const gl = this.gl; if (gl && !this.lost) { gl.deleteFramebuffer(this.densityBuffer); for (const p of this.programs) gl.deleteProgram(p.handle); for (const b of [...this.buffers, ...this.labelBuffers, ...this.discBuffers]) if (b) gl.deleteBuffer(b); for (const v of [...this.vaos, ...this.labelVaos]) gl.deleteVertexArray(v); for (const t of this.textures) gl.deleteTexture(t); }
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.container.title = ''; this.canvas.remove(); this.overlay.remove();
  }
}
