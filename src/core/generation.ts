import { identityDeclaration, digest, groupColumn, layoutDeclaration, predicateColumn, type GraphDeclaration } from './declaration';
import type { FactRow } from './projection';
import type { LayoutOptions } from './layout';
/** Only declared columns/producers participate; unrelated metadata cannot reseed the layout. */
export function declaredFacts(rows: readonly FactRow[], d: GraphDeclaration): FactRow[] {
  const keys = new Set([...d.identity.map(i => i.key), ...d.columns,
    ...d.groups.flatMap(g => groupColumn(g) ?? []),
    ...d.colors.flatMap(c => predicateColumn(c.predicate) ?? []),
    ...d.edges.flatMap(e => e.kind === 'reified' ? [e.sourceProperty, e.targetProperty, ...(e.typeProperty ? [e.typeProperty] : [])] : e.kind === 'inline' ? [e.key] : [])]);
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
  declaration = layoutDeclaration(declaration);
  return digest({ declaration: identityDeclaration(declaration), layout, producer, rows: declaredFacts(rows, declaration) });
}
