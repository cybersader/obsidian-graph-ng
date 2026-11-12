import type { Projection } from './core/projection';
import { encodeStrings, type Strings } from './core/columns';
/** Main-realm drawing/picking columns. Paths remain packed UTF-8, decoded only
 * for a bounded label candidate set, a hovered item or a visible member page. */
export type RenderProjection = Pick<Projection, 'offsets' | 'source' | 'target' | 'type' | 'types' | 'quarantined' | 'carrierNodes' | 'carrier'> & {
  nodeCount: number;
  paths: Strings;
  groups: { values: string[] }[];
};
const decoder = new TextDecoder('utf-8', { fatal: true });
export function renderPath(p: RenderProjection, node: number): string {
  if (!Number.isSafeInteger(node) || node < 0 || node >= p.nodeCount) throw new Error('RENDER_PATH_INDEX');
  return decoder.decode(p.paths.bytes.subarray(p.paths.offsets[node], p.paths.offsets[node + 1]));
}
export function renderProjection(p: Projection): RenderProjection {
  return { nodeCount: p.paths.length, paths: encodeStrings(p.paths), offsets: p.offsets, source: p.source, target: p.target,
    type: p.type, types: p.types, carrierNodes: p.carrierNodes, carrier: p.carrier, quarantined: p.quarantined, groups: p.groups.map(g => ({ values: g.values })) };
}
