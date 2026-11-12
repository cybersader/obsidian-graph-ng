import type { Projection } from './projection';
/** Two independently seeded 32-bit FNV lanes. Layout hints only, not an authenticity proof. */
export function hashEdge(key: string): [number, number] {
  let a = 2166136261, b = 3339675911;
  for (let i = 0; i < key.length; i++) { const c = key.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822519); }
  return [a >>> 0, b >>> 0];
}
export function edgeHashes(p: Projection): Uint32Array {
  const result = new Uint32Array(p.source.length * 2);
  for (let i = 0; i < p.source.length; i++) result.set(hashEdge(JSON.stringify([p.identities[p.source[i]!], p.identities[p.target[i]!], p.types[p.type[i]!], p.carrierPaths[p.carrier[i]!]])), i * 2);
  return result;
}
export const edgeHashSet = (keys: Uint32Array): Set<string> => { const set = new Set<string>(); for (let i = 0; i < keys.length; i += 2) set.add(`${keys[i]}:${keys[i + 1]}`); return set; };
