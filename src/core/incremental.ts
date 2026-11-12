import type { Projection } from './projection';
import { initialPositions, type LayoutInput, type LayoutOptions } from './layout';
export interface SavedLayout { identities: string[]; positions: ArrayLike<number>; edgeKeys?: string[] }
export function edgeKeys(p: Projection): string[] {
  return Array.from(p.source, (source, i) => JSON.stringify([p.identities[source], p.identities[p.target[i]!], p.types[p.type[i]!], p.carrierPaths[p.carrier[i]!]]));
}
export function validSavedLayout(saved: SavedLayout): boolean {
  return Array.isArray(saved.identities) && saved.identities.every(id => typeof id === 'string') && new Set(saved.identities).size === saved.identities.length
    && saved.positions != null && saved.positions.length === saved.identities.length * 2 && Array.from(saved.positions).every(Number.isFinite)
    && (saved.edgeKeys === undefined || (Array.isArray(saved.edgeKeys) && saved.edgeKeys.every(key => typeof key === 'string')));
}
/** Works with either an in-memory graph or a persisted generation after process restart. */
export function warmLayout(saved: SavedLayout, current: Projection, seed: number, options: LayoutOptions): LayoutInput {
  const old = new Map(saved.identities.map((id, i) => [id, i]));
  const positions = initialPositions(current.paths.length, seed ^ options.seed, options.initialRadius), movable = new Uint8Array(current.paths.length);
  const oldEdges = saved.edgeKeys ? new Set(saved.edgeKeys) : undefined;
  for (let i = 0; i < current.paths.length; i++) {
    const from = old.get(current.identities[i]!);
    if (from !== undefined) { positions[i * 2] = saved.positions[from * 2]!; positions[i * 2 + 1] = saved.positions[from * 2 + 1]!; }
    else {
      movable[i] = 1; let x = 0, y = 0, count = 0;
      for (let j = current.offsets[i]!; j < current.offsets[i + 1]!; j++) { const n = old.get(current.identities[current.targets[j]!]!); if (n !== undefined) { x += saved.positions[n * 2]!; y += saved.positions[n * 2 + 1]!; count++; } }
      if (count) { positions[i * 2] = x / count; positions[i * 2 + 1] = y / count; }
    }
  }
  if (oldEdges) edgeKeys(current).forEach((key, i) => { if (!oldEdges.has(key)) { movable[current.source[i]!] = 1; movable[current.target[i]!] = 1; } });
  const endpoints = movable.slice();
  for (let i = 0; i < endpoints.length; i++) if (endpoints[i]) for (let j = current.offsets[i]!; j < current.offsets[i + 1]!; j++) movable[current.targets[j]!] = 1;
  return { count: current.paths.length, source: current.source, target: current.target, offsets: current.offsets, targets: current.targets, initial: positions, movable, seed };
}
export function incrementalLayout(previous: Projection, oldPositions: Float32Array, current: Projection, seed: number, options: LayoutOptions): LayoutInput {
  return warmLayout({ identities: previous.identities, positions: oldPositions, edgeKeys: edgeKeys(previous) }, current, seed, options);
}
