import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
// Only the repository-owned static shader asset is compressed. Missing browser support
// rejects GPU setup and follows the normal Processor fallback. No generated JS is evaluated.
export const wgsl = { name: 'layout-wgsl', setup(build) {
  build.onLoad({ filter: /webgpu-layout-shaders\.ts$/ }, async () => {
    const asset = new URL('../src/webgpu-layout.wgsl', import.meta.url);
    const encoded = gzipSync(await readFile(asset), { level: 9 }).toString('base64');
    return { contents: `export async function shaderSource(){const bytes=Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0));return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()}`, watchFiles: [asset.pathname] };
  });
} };
