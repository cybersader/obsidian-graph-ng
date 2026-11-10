export type Scalar = string | number | boolean | null;
export type Predicate = { kind: 'eq'; key: string; value: Scalar } | { kind: 'folder'; prefix: string };
export type EdgeDeclaration =
  | { name: string; kind: 'reified'; sourceKey: string; targetKey: string; typeKey?: string; type?: string }
  | { name: string; kind: 'inline'; key: string; type: string }
  | { name: string; kind: 'producer'; producer: string; type: string };
export type GroupSource = { from: 'key'; key: string } | { from: 'folder'; depth: number };
export interface GraphDeclaration {
  version: 1;
  identity: { key: string }[];
  edges: EdgeDeclaration[];
  groups: GroupSource[];
  display: { reifiedAsNodes: boolean };
  columns: string[];
  carrierResolvers?: { kind: string; key: string }[];
  colors: { name: string; color: string; predicate: Predicate }[];
}
export const defaultDeclaration = (producer: string): GraphDeclaration => ({
  version: 1, identity: [], edges: [{ name: 'links', kind: 'producer', producer, type: 'link' }],
  groups: [{ from: 'folder', depth: 1 }], display: { reifiedAsNodes: false }, columns: [], colors: [], carrierResolvers: [{ kind: 'note-path', key: '$path' }],
});
function record(v: unknown): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected an object');
}
function text(v: unknown): asserts v is string {
  if (typeof v !== 'string' || !v.trim()) throw new Error('Expected a nonempty string');
}
function only(v: Record<string, unknown>, keys: string[]) {
  for (const k of Object.keys(v)) if (!keys.includes(k)) throw new Error(`Unknown field: ${k}`);
}
export function validatePredicate(v: unknown): asserts v is Predicate {
  record(v);
  if (v.kind === 'eq') {
    only(v, ['kind', 'key', 'value']); text(v.key);
    if (v.value !== null && !['string', 'number', 'boolean'].includes(typeof v.value)) throw new Error('Equality value must be scalar');
    if (typeof v.value === 'number' && !Number.isFinite(v.value)) throw new Error('Equality number must be finite');
  } else if (v.kind === 'folder') {
    only(v, ['kind', 'prefix']);
    if (typeof v.prefix !== 'string' || v.prefix.startsWith('/') || v.prefix.split('/').includes('..')) throw new Error('Expected relative folder prefix');
  } else throw new Error('Unknown predicate kind');
}
export function validateDeclaration(v: unknown): asserts v is GraphDeclaration {
  record(v); only(v, ['version', 'identity', 'edges', 'groups', 'display', 'columns', 'colors', 'carrierResolvers']);
  if (v.version !== 1) throw new Error('Declaration version must be 1');
  for (const k of ['identity', 'edges', 'groups', 'columns', 'colors']) if (!Array.isArray(v[k])) throw new Error(`${k} must be an array`);
  for (const i of v.identity as unknown[]) { record(i); only(i, ['key']); text(i.key); }
  const names = new Set<string>();
  for (const e of v.edges as unknown[]) {
    record(e); text(e.name); if (names.has(e.name)) throw new Error(`Duplicate edge declaration: ${e.name}`); names.add(e.name);
    if (e.kind === 'reified') {
      only(e, ['name', 'kind', 'sourceKey', 'targetKey', 'typeKey', 'type']); text(e.sourceKey); text(e.targetKey);
      if (e.typeKey !== undefined) text(e.typeKey); if (e.type !== undefined) text(e.type);
    } else if (e.kind === 'inline') { only(e, ['name', 'kind', 'key', 'type']); text(e.key); text(e.type); }
    else if (e.kind === 'producer') { only(e, ['name', 'kind', 'producer', 'type']); text(e.producer); text(e.type); }
    else throw new Error('Unknown edge kind');
  }
  for (const g of v.groups as unknown[]) {
    record(g);
    if (g.from === 'key') { only(g, ['from', 'key']); text(g.key); }
    else if (g.from === 'folder') { only(g, ['from', 'depth']); if (!Number.isSafeInteger(g.depth) || (g.depth as number) < 1) throw new Error('Folder depth must be a positive integer'); }
    else throw new Error('Slice 1 supports key and folder group sources');
  }
  record(v.display); only(v.display, ['reifiedAsNodes']); if (typeof v.display.reifiedAsNodes !== 'boolean') throw new Error('reifiedAsNodes must be boolean');
  for (const key of v.columns as unknown[]) text(key);
  if (v.carrierResolvers !== undefined) {
    if (!Array.isArray(v.carrierResolvers)) throw new Error('carrierResolvers must be an array');
    const kinds = new Set<string>();
    for (const resolver of v.carrierResolvers) { record(resolver); only(resolver, ['kind', 'key']); text(resolver.kind); text(resolver.key); if (kinds.has(resolver.kind)) throw new Error('Duplicate carrier resolver'); kinds.add(resolver.kind); }
  }
  for (const c of v.colors as unknown[]) { record(c); only(c, ['name', 'color', 'predicate']); text(c.name); if (typeof c.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(c.color)) throw new Error('Color must be #rrggbb'); validatePredicate(c.predicate); }
}
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
}
export async function digest(v: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(v));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
