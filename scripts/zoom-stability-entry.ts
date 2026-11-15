// Synthetic fixed coordinates; imports the actual renderer, never a layout worker.
import { DetailRenderer } from '../src/webgl-renderer';
import { defaults } from '../src/settings';
import { encodeStrings } from '../src/core/columns';
import { cssRoi, type ContextFacts } from './zoom-stability-support';
declare const __ZOOM_SOURCE_SHA__: string;
const w = window as any;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function main() {
  const n = 256, positions = new Float32Array(n * 2), source: number[] = [], target: number[] = [], carrier: number[] = [], type: number[] = [], carrierNodes = new Uint32Array(n), codes = new Uint32Array(n);
  const edge = (s: number, t: number, c = 0, k = 0) => { source.push(s); target.push(t); carrier.push(c); type.push(k); };
  for (let i = 0; i < 240; i++) { const side = i < 120 ? -1 : 1, j = i % 120; positions[i * 2] = side * 40 + (j % 12 - 5.5) * 2; positions[i * 2 + 1] = (Math.floor(j / 12) - 4.5) * 2; codes[i] = i % 5; edge(i, (i + 1) % 240); }
  for (let j = 0; j < 16; j++) { const c = 240 + j; positions[c * 2] = (j - 7.5) * 2; positions[c * 2 + 1] = (j % 3 - 1) * 4; carrierNodes[c] = j + 1; codes[c] = j % 5; edge(j, c, j, 1); edge(c, j + 120, j, 1); }
  const offsets = new Uint32Array(n + 1); source.forEach((s, e) => { offsets[s + 1]!++; offsets[target[e]! + 1]!++; }); for (let i = 1; i <= n; i++) offsets[i]! += offsets[i - 1]!;
  const projection: any = { nodeCount: n, paths: encodeStrings(Array.from({ length: n }, (_, i) => `Synthetic/${i}.md`)), source: Uint32Array.from(source), target: Uint32Array.from(target), carrier: Uint32Array.from(carrier), type: Uint32Array.from(type), types: ['next', 'bridge'], carrierNodes, offsets, groups: [], quarantined: [] };
  const settings = defaults('synthetic@1'), software = new URLSearchParams(location.search).get('renderer') === 'canvas';
  // Native defaults and categorical palette are retained. No user data/settings are loaded.
  const visible = new Uint8Array(n).fill(1), colorRules = new Uint32Array(n), groupLabels = ['A', 'B', 'C', 'D', 'E'];
  const r = await DetailRenderer.create(document.getElementById('graph')!, projection, positions, visible, settings, () => {}, () => {}, colorRules, () => true, software, () => { throw new Error('Renderer unavailable'); }, { groupCodes: codes, groupLabels });
  const sceneInputs = () => JSON.stringify({ coordinates: Array.from(positions), grouping: Array.from(codes), ruleInputs: Array.from(colorRules), source: Array.from(projection.source), target: Array.from(projection.target), carrier: Array.from(projection.carrier), type: Array.from(projection.type), carrierNodes: Array.from(carrierNodes), groupLabels, settings });
  const originalInputs = sceneInputs(), originalVisible = visible.slice(), positionObject = r.positions, canvas = r.canvas, legend = groupLabels.map((_, i) => r.groupColor(i));
  // Standard canvas APIs retrieve the established context, never an inferred requested backend.
  const gl = canvas.getContext('webgl2'), ctx = gl ? null : canvas.getContext('2d');
  function capture(ratio: number) {
    if (r.positions !== positionObject || r.canvas !== canvas || sceneInputs() !== originalInputs || !originalVisible.every((v, i) => v === r.visible[i]) || JSON.stringify(groupLabels.map((_, i) => r.groupColor(i))) !== JSON.stringify(legend)) throw new Error('ZOOM_CHANGED_OWNED_INPUT_OR_PUBLIC_VIEW');
    const rect = canvas.getBoundingClientRect(), buffer = gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : [canvas.width, canvas.height];
    const roi = cssRoi(rect.width, rect.height, buffer[0]!, buffer[1]!), pixels = new Uint8Array(roi.samples * 4);
    if (gl) gl.readPixels(roi.x, roi.glY, roi.width, roi.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    else if (ctx) pixels.set(ctx.getImageData(roi.x, roi.y, roi.width, roi.height).data);
    else throw new Error('NO_DRAWING_CONTEXT');
    const channels = [0, 0, 0]; let white = 0, red = 0, green = 0;
    for (let i = 0; i < pixels.length; i += 4) { for (let k = 0; k < 3; k++) channels[k]! += pixels[i + k]!; white += +(pixels[i]! > 249 && pixels[i + 1]! > 249 && pixels[i + 2]! > 249); red += +(pixels[i]! > pixels[i + 1]! + 16); green += +(pixels[i + 1]! > pixels[i]! + 16); }
    // The owned scene has a nonblack background. A cleared readback is not pixel evidence.
    if (!channels.some(v => v > 0)) throw new Error('FRAMEBUFFER_READBACK_EMPTY');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const facts: ContextFacts = { actualBackend: gl ? 'webgl2' : ctx ? 'canvas2d' : 'unavailable', contextIsWebGL2: Boolean(gl && gl instanceof WebGL2RenderingContext), contextIsCanvas2D: Boolean(ctx && ctx instanceof CanvasRenderingContext2D), gpuFlag: r.gpu, lostContext: gl?.isContextLost() ?? false, contextAttributes: gl?.getContextAttributes() ? { ...gl.getContextAttributes() } : null, drawingBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null, maskedRenderer: gl ? String(gl.getParameter(gl.RENDERER)) : null, unmaskedRenderer: gl && debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null, glVersion: gl ? String(gl.getParameter(gl.VERSION)) : null };
    return { sourceSha: __ZOOM_SOURCE_SHA__, requestedRatio: ratio, camera: { ...r.camera }, devicePixelRatio, css: [rect.width, rect.height], backing: [canvas.width, canvas.height], ...facts, glError: gl ? gl.getError() : null, syntheticInputsUnchanged: true, stablePublicLegend: true, internalDerivedColorsVerified: false, positionsUnchanged: true, fixedLayout: true, workersCreated: w.workersCreated, legendTints: legend, settings: { edgeOpacity: settings.visuals.edgeOpacity, nodeSize: settings.nodeSize, glow: settings.visuals.glow, edgeSize: settings.edgeSize }, roi: { ...roi, meanRGB: channels.map(v => v / roi.samples), white, red, green, whiteFraction: white / roi.samples, redFraction: red / roi.samples, greenFraction: green / roi.samples } };
  }
  w.zoomCapture = async (ratio: number) => {
    r.setCamera(.5, .5, ratio); await frame(); await frame();
    // Queue capture after the renderer's requested frame. No private drawing entry point.
    return new Promise((resolve, reject) => { r.refresh(); requestAnimationFrame(() => { try { resolve(capture(ratio)); } catch (error) { reject(error); } }); });
  };
  w.zoomDispose = () => r.dispose(); w.zoomReady = true;
}
main().catch(e => { w.zoomFailure = String(e); });
