import source from './webgpu-layout.wgsl' with { type: 'text' };
// The production build replaces only this static asset reader with its compressed equivalent.
export async function shaderSource(): Promise<string> { return source; }
