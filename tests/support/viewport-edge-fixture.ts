import { encodeStrings } from '../../src/core/columns';

/** Fixed settled geometry; no host metadata, solver, cache or random input. */
export function viewportEdgeFixture(allCrossing = false) {
  const n = 80_000, m = 120_000, source = new Uint32Array(m), target = new Uint32Array(m), offsets = new Uint32Array(n + 1);
  const positions = new Float32Array(n * 2), visible = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    positions[2*i] = allCrossing ? (i < n/2 ? -1 : 1)*19000 : 6000 + (i%320)*100;
    positions[2*i+1] = allCrossing ? (i%19-9)*15 : (Math.floor(i/320)-125)*100;
  }
  for (let e = 0; e < m; e++) {
    const a = e % (n-4), b = (a % 320 === 319 ? a-1 : a+1) % (n-4);
    source[e] = allCrossing ? e % (n/2) : a;
    target[e] = allCrossing ? n/2 + e % (n/2) : b;
  }
  const crossing = m-2, miss = m-1;
  if (!allCrossing) {
    // Both endpoints offscreen at world center (0, 0). The second segment's
    // endpoint rectangle overlaps the screen, but the segment itself misses it.
    positions.set([-900,15,900,15,-1600,150,200,3800], 2*(n-4));
    source[crossing] = n-4; target[crossing] = n-3;
    source[miss] = n-2; target[miss] = n-1;
  }
  for (let e = 0; e < m; e++) { offsets[source[e]!+1]!++; offsets[target[e]!+1]!++; }
  for (let i = 1; i <= n; i++) offsets[i]! += offsets[i-1]!;
  return { positions, visible, crossing, miss, projection: { nodeCount: n, paths: encodeStrings(Array.from({length:n}, (_, i) => `Example ${i}.md`)), offsets, source, target,
    type: new Uint32Array(m), types: ['example'], quarantined: [], carrierNodes: new Uint32Array(n), carrier: new Uint32Array(m).fill(0xffffffff), groups: [] } };
}

export function viewportEdgeCamera(r: any, k: (s: string) => string, x: number, y: number, ratio: number) {
  const f = r[k('cameraFrame')]; r.setCamera((x-f.minX)/f.width, (y-f.minY)/f.height, ratio);
}
