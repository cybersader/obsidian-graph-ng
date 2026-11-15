// Pure probe calculations only; never imported by the product renderer.
export interface ContextFacts {
  actualBackend: 'webgl2' | 'canvas2d' | 'unavailable';
  contextIsWebGL2: boolean; contextIsCanvas2D: boolean; gpuFlag: boolean; lostContext: boolean;
  contextAttributes: Record<string, unknown> | null;
  drawingBuffer: [number, number] | null;
  maskedRenderer: string | null; unmaskedRenderer: string | null; glVersion: string | null;
}
export function classifyContext(facts: ContextFacts) {
  if (facts.actualBackend === 'canvas2d' && facts.contextIsCanvas2D && !facts.contextIsWebGL2 && !facts.gpuFlag) return 'canvas2d';
  if (facts.actualBackend !== 'webgl2' || !facts.contextIsWebGL2 || !facts.gpuFlag || facts.lostContext || !facts.contextAttributes || !facts.drawingBuffer?.every(n => Number.isFinite(n) && n > 0) || !/^WebGL 2\b/.test(facts.glVersion ?? '')) return 'unavailable';
  const identity = `${facts.maskedRenderer ?? ''} ${facts.unmaskedRenderer ?? ''}`;
  if (/swiftshader|llvmpipe|softpipe|lavapipe|software|basic render driver/i.test(identity)) return 'software-webgl';
  // Conservative API-identity classification, not physical-device attestation.
  if (facts.unmaskedRenderer && /\b(NVIDIA|GeForce|Quadro|RTX|AMD|Radeon|Intel|Iris|Apple|Adreno|Mali|PowerVR)\b/i.test(facts.unmaskedRenderer)) return 'hardware-webgl';
  return 'unverified-webgl';
}
export function backendAccepted(requested: string, facts: ContextFacts) {
  const actual = classifyContext(facts);
  return requested === 'webgl' ? actual === 'hardware-webgl' : requested === 'canvas' && actual === 'canvas2d';
}
export function cssRoi(cssWidth: number, cssHeight: number, backingWidth: number, backingHeight: number, cssSize = 128) {
  if (![cssWidth, cssHeight, backingWidth, backingHeight, cssSize].every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(backingWidth) || !Number.isInteger(backingHeight) || cssSize > Math.min(cssWidth, cssHeight)) throw new Error('ROI_DIMENSIONS');
  const scaleX = backingWidth / cssWidth, scaleY = backingHeight / cssHeight, cssX = (cssWidth - cssSize) / 2, cssY = (cssHeight - cssSize) / 2;
  const x = Math.round(cssX * scaleX), y = Math.round(cssY * scaleY), width = Math.round((cssX + cssSize) * scaleX) - x, height = Math.round((cssY + cssSize) * scaleY) - y;
  if (width < 1 || height < 1) throw new Error('ROI_EMPTY');
  return { x, y, width, height, glY: backingHeight - y - height, samples: width * height, scaleX, scaleY, requestedCSS: { x: cssX, y: cssY, width: cssSize, height: cssSize }, actualCSS: { x: x / scaleX, y: y / scaleY, width: width / scaleX, height: height / scaleY } };
}


/** Structured harness result: a valid observed defect is not infrastructure success. */
export function probeOutcome(run: { executed: boolean; errors: unknown[]; captures: any[] }) {
  const reasons: string[] = [], names = ['far', 'far-step', 'mid', 'near'];
  const expected = new Set(['webgl', 'canvas'].flatMap(backend => [1, 2].flatMap(dpr => names.map(name => `${backend}/${dpr}/${name}`))));
  const keys = run.captures.map(c => `${c.backend}/${c.intendedDpr}/${c.name}`);
  if (!run.executed || run.captures.length !== 16 || new Set(keys).size !== 16 || keys.some(k => !expected.has(k))) reasons.push('INCOMPLETE_MATRIX');
  if (run.errors.length) reasons.push('PAGE_ERRORS');
  if (run.captures.some(c => c.devicePixelRatio !== c.intendedDpr || ![c.beforePixels, c.beforeScreenshot, c.afterScreenshot].every(m => m?.devicePixelRatio === c.intendedDpr && m.viewport?.[0] === 1024 && m.viewport?.[1] === 768))) reasons.push('DPR_OR_VIEWPORT_CONTROL_DRIFT');
  if (reasons.length) return { schema: 'zoom-probe-outcome.v1', status: 'infrastructure-failure', matrixValid: false, reasons };
  if (run.captures.some(c => c.backendAccepted !== true)) reasons.push('HARDWARE_OR_BACKEND_UNPROVEN');
  if (run.captures.some(c => c.resolutionMatches !== true)) reasons.push('BACKING_RESOLUTION_MISMATCH');
  return { schema: 'zoom-probe-outcome.v1', status: reasons.length ? 'acceptance-rejected' : 'accepted', matrixValid: true, reasons };
}
