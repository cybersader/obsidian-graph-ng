import { checked, expressionReferences, groupIdentity, predicateIdentity, print } from './expr/engine';
import { validateTransform, type DerivedTransform } from './derive';
export type Scalar = string | number | boolean | null;
export type FolderPath = string | string[];
export const folderPath = (path: FolderPath) => (Array.isArray(path) ? path.join('/') : path).replace(/\/+$/, '');
export type Predicate = { kind: 'expr'; expr: string } | { kind: 'eq'; key: string; value: Scalar } | { kind: 'in'; key: string; values: Scalar[] } | { kind: 'exists'; key: string } | { kind: 'folder'; prefix: FolderPath };
/** Property column a predicate reads, if any. Folder predicates read paths only. */
export const predicateColumn = (p: Predicate): string | string[] | undefined => p.kind === 'expr' ? expressionReferences(p.expr) : p.kind === 'folder' ? undefined : p.key;
/** Colors are presentation. Layout/cache identity excludes them, so a legend edit never reseeds or relayouts. */
export const layoutDeclaration = (d: GraphDeclaration): GraphDeclaration => ({ ...d, colors: [] });
export type EdgeDeclaration =
  | { name: string; kind: 'reified'; sourceProperty: string; targetProperty: string; typeProperty?: string; type?: string }
  | { name: string; kind: 'inline'; key: string; type: string }
  | { name: string; kind: 'producer'; producer: string; type: string };
export type GroupSource = { from: 'expr'; expr: string } | { from: 'key'; key: string } | { from: 'folder'; depth: number; prefix?: FolderPath } | { from: 'derived'; key: string; transform: DerivedTransform };
/** Property read by a group source; `$identity`/`$path` derive from built-in node text. */
export const groupColumn = (g: GroupSource): string | string[] | undefined => g.from === 'expr' ? expressionReferences(g.expr) : g.from === 'folder' || (g.from === 'derived' && g.key.startsWith('$')) ? undefined : g.key;
/** Recognized compiled shapes retain historical digest bytes across an upgrade. */
export const identityDeclaration = (d: GraphDeclaration) => ({ ...d, groups: d.groups.map(groupIdentity), colors: d.colors.map(c => ({ ...c, predicate: predicateIdentity(c.predicate) })) });
export interface GraphDeclaration {
  version: 2;
  identity: { key: string }[];
  edges: EdgeDeclaration[];
  groups: GroupSource[];
  display: { reifiedAsNodes: boolean };
  columns: string[];
  carrierResolvers?: { kind: string; key: string }[];
  colors: { name: string; color: string; predicate: Predicate }[];
}
export const defaultDeclaration = (producer: string): GraphDeclaration => ({
  version: 2, identity: [], edges: [{ name: 'links', kind: 'producer', producer, type: 'link' }],
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
  if (v.kind === 'expr') { only(v, ['kind', 'expr']); text(v.expr); checked(v.expr, 'filter'); } else if (v.kind === 'eq') {
    only(v, ['kind', 'key', 'value']); text(v.key);
    if (v.value !== null && !['string', 'number', 'boolean'].includes(typeof v.value)) throw new Error('Equality value must be scalar');
    if (typeof v.value === 'number' && !Number.isFinite(v.value)) throw new Error('Equality number must be finite');
  } else if (v.kind === 'in') {
    only(v, ['kind', 'key', 'values']); text(v.key);
    if (!Array.isArray(v.values) || v.values.length > 10000 || v.values.some(x => x !== null && !['string', 'number', 'boolean'].includes(typeof x) || (typeof x === 'number' && !Number.isFinite(x)))) throw new Error('Membership values must be at most 10,000 finite scalars');
  } else if (v.kind === 'exists') {
    only(v, ['kind', 'key']); text(v.key);
  } else if (v.kind === 'folder') {
    only(v, ['kind', 'prefix']);
    validateFolderPath(v.prefix);
  } else throw new Error('Unknown predicate kind');
}
export function validateDeclaration(v: unknown): asserts v is GraphDeclaration {
  record(v); only(v, ['version', 'identity', 'edges', 'groups', 'display', 'columns', 'colors', 'carrierResolvers']);
  if (v.version !== 2) throw new Error('Declaration version must be 2');
  for (const k of ['identity', 'edges', 'groups', 'columns', 'colors']) if (!Array.isArray(v[k])) throw new Error(`${k} must be an array`);
  for (const i of v.identity as unknown[]) { record(i); only(i, ['key']); text(i.key); }
  const names = new Set<string>();
  for (const e of v.edges as unknown[]) {
    record(e); text(e.name); if (names.has(e.name)) throw new Error(`Duplicate edge declaration: ${e.name}`); names.add(e.name);
    if (e.kind === 'reified') {
      only(e, ['name', 'kind', 'sourceProperty', 'targetProperty', 'typeProperty', 'type']); text(e.sourceProperty); text(e.targetProperty);
      if (e.typeProperty !== undefined) text(e.typeProperty); if (e.type !== undefined) text(e.type);
    } else if (e.kind === 'inline') { only(e, ['name', 'kind', 'key', 'type']); text(e.key); text(e.type); }
    else if (e.kind === 'producer') { only(e, ['name', 'kind', 'producer', 'type']); text(e.producer); text(e.type); }
    else throw new Error('Unknown edge kind');
  }
  for (const g of v.groups as unknown[]) {
    record(g);
    if (g.from === 'expr') { only(g, ['from', 'expr']); text(g.expr); checked(g.expr); } else if (g.from === 'key') { only(g, ['from', 'key']); text(g.key); }
    else if (g.from === 'folder') { only(g, ['from', 'depth', 'prefix']); if (g.prefix !== undefined) validateFolderPath(g.prefix); if (!Number.isSafeInteger(g.depth) || (g.depth as number) < 1) throw new Error('Folder depth must be a positive integer'); }
    else if (g.from === 'derived') validateDerivedGroup(g);
    else throw new Error('Group sources are key, folder or derived');
  }
  record(v.display); only(v.display, ['reifiedAsNodes']); if (typeof v.display.reifiedAsNodes !== 'boolean') throw new Error('reifiedAsNodes must be boolean');
  for (const key of v.columns as unknown[]) text(key);
  if (v.carrierResolvers !== undefined) {
    if (!Array.isArray(v.carrierResolvers)) throw new Error('carrierResolvers must be an array');
    const kinds = new Set<string>();
    for (const resolver of v.carrierResolvers) { record(resolver); only(resolver, ['kind', 'key']); text(resolver.kind); text(resolver.key); if (kinds.has(resolver.kind)) throw new Error('Duplicate carrier resolver'); kinds.add(resolver.kind); }
  }
  for (const c of v.colors as unknown[]) { record(c); only(c, ['name', 'color', 'predicate']); text(c.name); if (typeof c.color !== 'string' || !/^(?:#[0-9a-f]{6}(?:[0-9a-f]{2})?|var\(--[a-z0-9-]+\))$/i.test(c.color)) throw new Error('Color must be #rrggbb[aa] or var(--name)'); validatePredicate(c.predicate); }
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

function validateFolderPath(value: unknown): asserts value is FolderPath {
  if (Array.isArray(value)) {
    if (value.some(segment => typeof segment !== 'string' || !segment || segment.includes('/') || segment === '.' || segment === '..' || segment.includes('\\'))) throw new Error('Expected relative folder segments');
  } else if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\') || value.split('/').some(s => s === '..' || s === '.')) throw new Error('Expected relative folder prefix');
}
/** Input compatibility only. Persist and export version 2, never the legacy *Key fields. */
export function migrateDeclaration(value: unknown): GraphDeclaration {
  record(value); const d = structuredClone(value);
  if (d.version === 1) {
    if (!Array.isArray(d.edges)) throw new Error('edges must be an array');
    for (const edge of d.edges) {
      record(edge);
      for (const [old, current] of [['sourceKey', 'sourceProperty'], ['targetKey', 'targetProperty'], ['typeKey', 'typeProperty']]) {
        if (Object.hasOwn(edge, old!)) { if (Object.hasOwn(edge, current!)) throw new Error('Ambiguous legacy edge fields'); edge[current!] = edge[old!]; delete edge[old!]; }
      }
    }
    // Legacy prefixes used host-style separators and optional current-folder segments.
    // Normalize those only; parent traversal and absolute roots are never resolved.
    const legacyPrefix = (prefix: unknown) => {
      if (typeof prefix !== 'string') return prefix;
      const path = prefix.replace(/\\/g, '/');
      if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').includes('..')) throw new Error('Invalid legacy folder prefix');
      return path.split('/').filter(segment => segment && segment !== '.');
    };
    if (Array.isArray(d.colors)) for (const color of d.colors) if (color?.predicate?.kind === 'folder') color.predicate.prefix = legacyPrefix(color.predicate.prefix);
    if (Array.isArray(d.groups)) for (const group of d.groups) if (group?.from === 'folder' && group.prefix !== undefined) group.prefix = legacyPrefix(group.prefix);
    d.version = 2;
  }
  validateDeclaration(d);
  // Keep strings valid input, but persist folder paths as segments so ordinary long
  // multi-folder paths are not mistaken for credential-shaped opaque tokens.
  for (const color of d.colors) canonicalPredicate(color.predicate);
  for (const group of d.groups) if (group.from === 'expr') group.expr = print(checked(group.expr));
  for (const group of d.groups) if (group.from === 'folder' && typeof group.prefix === 'string') group.prefix = folderPath(group.prefix).split('/').filter(Boolean);
  return d;
}

/** Persist folder prefixes as segments, the settings-sharing-safe representation. */
export function canonicalPredicate(p: Predicate): Predicate {
  if (p.kind === 'expr') p.expr = print(checked(p.expr, 'filter'));
  if (p.kind === 'folder' && typeof p.prefix === 'string') p.prefix = folderPath(p.prefix).split('/').filter(Boolean);
  return p;
}

export function validateDerivedGroup(g: Record<string, unknown>) {
  only(g, ['from', 'key', 'transform']); text(g.key);
  if (g.key.startsWith('$') && g.key !== '$identity' && g.key !== '$path') throw new Error('Derived built-in sources are $identity and $path');
  validateTransform(g.transform);
}
