import { random, type LayoutInput } from '../../src/core/layout';
/** Deterministic, synthetic 16-group fixture, about 3.1 edges per node. No I/O. */
export function kernelFixture(n: number): LayoutInput {
  const rng = random(7), base = Math.floor(n * .262 / 16) * 16, size = base / 16;
  const source: number[] = [], target: number[] = [];
  const edge = (a: number, b: number) => { if (a !== b) { source.push(a); target.push(b); } };
  for (let i = 0; i < base; i++) {
    const g = Math.floor(i / size);
    if (i % size >= size * .95) continue;
    edge(i, g * size);
    for (let j = 0; j < 5; j++) edge(i, g * size + Math.floor(rng() * size * .95));
  }
  for (let i = base; i < n; i++) {
    const g = Math.floor(rng() * 16), a = g * size + Math.floor(rng() * size * .95);
    const b = (rng() < .01 ? Math.floor(rng() * 16) : g) * size + Math.floor(rng() * size * .95);
    edge(a, i); edge(i, b);
  }
  return { count: n, source: Uint32Array.from(source), target: Uint32Array.from(target), seed: 7 };
}
export function exactPositions(a: Float32Array, b: Float32Array): boolean {
  const aa = new Uint32Array(a.buffer, a.byteOffset, a.length), bb = new Uint32Array(b.buffer, b.byteOffset, b.length);
  return aa.length === bb.length && aa.every((v, i) => v === bb[i]);
}
