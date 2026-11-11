/** Public GPU capability check shared by worker and unsupported-worker fallback.
 * Initial driver startup can block; prefer an OffscreenCanvas in the worker. */
export function probeGpu(canvas: HTMLCanvasElement | OffscreenCanvas): { available: boolean; reason: string } {
  const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) as WebGL2RenderingContext | null;
  if (!gl) return { available: false, reason: 'WebGL2 unavailable or major performance caveat' };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const software = /swiftshader|llvmpipe|softpipe|software|swrast/i.test(name);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { available: !software, reason: software ? `Software renderer (${name})` : name };
}
