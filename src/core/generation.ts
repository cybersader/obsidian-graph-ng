import { digest, type GraphDeclaration } from './declaration';
import type { FactRow } from './projection';
import type { LayoutOptions } from './layout';
/** Only declared columns/producers participate; unrelated metadata cannot reseed the layout. */
export function declaredFacts(rows: readonly FactRow[], d: GraphDeclaration): FactRow[] {
  const keys = new Set([...d.identity.map(i => i.key), ...d.columns,
    ...d.groups.flatMap(g => g.from === 'key' ? [g.key] : []),
    ...d.colors.flatMap(c => c.predicate.kind === 'eq' ? [c.predicate.key] : []),
    ...d.edges.flatMap(e => e.kind === 'reified' ? [e.sourceKey, e.targetKey, ...(e.typeKey ? [e.typeKey] : [])] : e.kind === 'inline' ? [e.key] : [])]);
  const producers = [...new Set(d.edges.flatMap(e => e.kind === 'producer' ? [e.producer] : []))].sort();
  return rows.map(row => {
    const properties: Record<string, unknown> = Object.create(null);
    for (const key of keys) if (Object.hasOwn(row.properties, key)) properties[key] = row.properties[key];
    const links: Record<string, string[]> = Object.create(null);
    for (const producer of producers) links[producer] = [...(row.links?.[producer] ?? [])].sort();
    return { path: row.path, properties, ...(producers.length ? { links } : {}) };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export async function generationKey(rows: readonly FactRow[], declaration: GraphDeclaration, layout: LayoutOptions, producer: string): Promise<string> {
  return digest({ declaration, layout, producer, rows: declaredFacts(rows, declaration) });
}
