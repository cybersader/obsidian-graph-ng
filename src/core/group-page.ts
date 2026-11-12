import type { GroupProjection } from './group-projection';
export function page<T>(items: readonly T[], index: number, size: number): readonly T[] {
  return items.slice(Math.max(0, index) * size, (Math.max(0, index) + 1) * size);
}
/** Build once per projection, never once per edge. Canvas work is bounded independently of list size. */
export function groupPages(projection: GroupProjection, canvasSize: number) {
  const labels = new Map(projection.groups.map(g => [g.id, g.label]));
  return { labels, canvas(index: number): GroupProjection {
    const groups = [...page(projection.groups, index, canvasSize)], ids = new Set(groups.map(g => g.id));
    return { groups, groupEdges: projection.groupEdges.filter(e => ids.has(e.a) && ids.has(e.b)) };
  } };
}
