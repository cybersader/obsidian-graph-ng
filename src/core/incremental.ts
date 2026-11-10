import type { Projection } from './projection';
import { initialPositions, type LayoutInput, type LayoutOptions } from './layout';
export function incrementalLayout(previous: Projection, oldPositions: Float32Array, current: Projection, seed: number, options: LayoutOptions): LayoutInput {
  const old = new Map(previous.identities.map((id, i) => [id, i]));
  const positions = initialPositions(current.paths.length, seed ^ options.seed, options.initialRadius), movable = new Uint8Array(current.paths.length);
  const oldEdges = new Set<string>();
  for (let i = 0; i < previous.source.length; i++) oldEdges.add(JSON.stringify([previous.identities[previous.source[i]!], previous.identities[previous.target[i]!], previous.types[previous.type[i]!], previous.carrierPaths[previous.carrier[i]!]]));
  for (let i = 0; i < current.paths.length; i++) {
    const from = old.get(current.identities[i]!);
    if (from !== undefined) { positions[i * 2] = oldPositions[from * 2]!; positions[i * 2 + 1] = oldPositions[from * 2 + 1]!; }
    else {
      movable[i] = 1; let x = 0, y = 0, count = 0;
      for (let j = current.offsets[i]!; j < current.offsets[i + 1]!; j++) { const n = old.get(current.identities[current.targets[j]!]!); if (n !== undefined) { x += oldPositions[n * 2]!; y += oldPositions[n * 2 + 1]!; count++; } }
      if (count) { positions[i * 2] = x / count; positions[i * 2 + 1] = y / count; }
    }
  }
  for (let i = 0; i < current.source.length; i++) {
    const a = current.source[i]!, b = current.target[i]!;
    if (!oldEdges.has(JSON.stringify([current.identities[a], current.identities[b], current.types[current.type[i]!], current.carrierPaths[current.carrier[i]!]]))) { movable[a] = 1; movable[b] = 1; }
  }
  const endpoints = movable.slice();
  for (let i = 0; i < endpoints.length; i++) if (endpoints[i]) for (let j = current.offsets[i]!; j < current.offsets[i + 1]!; j++) movable[current.targets[j]!] = 1;
  return { count: current.paths.length, source: current.source, target: current.target, initial: positions, movable, seed };
}
