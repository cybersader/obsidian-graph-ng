import { groupColumn, predicateColumn, type GraphDeclaration } from './declaration';
import type { FactRow } from './projection';
export interface Strings { bytes: Uint8Array; offsets: Uint32Array }
export interface RowColumns {
  paths: Strings;
  keys: string[];
  values: Strings[];
  producers: string[];
  links: { paths: Strings; offsets: Uint32Array; targets: Uint32Array }[];
}
export function declaredKeys(d: GraphDeclaration): string[] {
  return [...new Set([...d.identity.map(i => i.key), ...d.columns,
    ...d.groups.flatMap(g => groupColumn(g) ?? []),
    ...d.colors.flatMap(c => predicateColumn(c.predicate) ?? []),
    ...d.edges.flatMap(e => e.kind === 'reified' ? [e.sourceProperty, e.targetProperty, ...(e.typeProperty ? [e.typeProperty] : [])] : e.kind === 'inline' ? [e.key] : []),
    ...(d.carrierResolvers ?? []).flatMap(r => r.key === '$path' ? [] : [r.key])])].sort();
}
export function encodeStrings(strings: readonly string[]): Strings {
  const encoder = new TextEncoder(), offsets = new Uint32Array(strings.length + 1);
  // One encode call for ASCII columns, rather than one native crossing per cell.
  // Fall back as a whole for Unicode: joining isolated surrogate halves across
  // cell boundaries would otherwise change their independently encoded bytes.
  let ascii = true, length = 0;
  for (let i = 0; i < strings.length; i++) {
    if (!/^[\x00-\x7f]*$/.test(strings[i]!)) { ascii = false; break; }
    length += strings[i]!.length; offsets[i + 1] = length;
  }
  if (ascii) return { bytes: encoder.encode(strings.join('')), offsets };
  // UTF-8 needs at most three bytes per UTF-16 unit. One scratch allocation avoids
  // one backing allocation per cell while keeping transferred dictionaries exact.
  const scratch = new Uint8Array(strings.reduce((n, s) => n + s.length * 3, 0));
  let used = 0;
  for (let i = 0; i < strings.length; i++) { used += encoder.encodeInto(strings[i]!, scratch.subarray(used)).written; offsets[i + 1] = used; }
  return { bytes: scratch.slice(0, used), offsets };
}
export function decodeStrings(s: Strings): string[] {
  if (!s.offsets.length || s.offsets[0] !== 0 || s.offsets.at(-1) !== s.bytes.length) throw new Error('Invalid dictionary length');
  const decoder = new TextDecoder('utf-8', { fatal: true }), result: string[] = [];
  const whole = decoder.decode(s.bytes), ascii = whole.length === s.bytes.length;
  for (let i = 0; i < s.offsets.length - 1; i++) {
    if (s.offsets[i + 1]! < s.offsets[i]!) throw new Error('Invalid dictionary offsets');
    result.push(ascii ? whole.slice(s.offsets[i], s.offsets[i + 1]) : decoder.decode(s.bytes.subarray(s.offsets[i], s.offsets[i + 1])));
  }
  return result;
}
export function packRows(rows: readonly FactRow[], d: GraphDeclaration): RowColumns {
  const keys = declaredKeys(d), producers = [...new Set(d.edges.flatMap(e => e.kind === 'producer' ? [e.producer] : []))].sort();
  return { paths: encodeStrings(rows.map(r => r.path)), keys,
    // JSON is cell-local and preserves declared scalar/list types, never a whole-vault stringify.
    values: keys.map(k => encodeStrings(rows.map(r => JSON.stringify(r.properties[k]) ?? ''))), producers,
    links: producers.map(producer => {
      const paths: string[] = [], offsets = new Uint32Array(rows.length + 1), targets: number[] = [], dictionary = new Map<string, number>();
      rows.forEach((r, i) => { for (const path of r.links?.[producer] ?? []) { let index = dictionary.get(path); if (index === undefined) { index = paths.length; paths.push(path); dictionary.set(path, index); } targets.push(index); } offsets[i + 1] = targets.length; });
      return { paths: encodeStrings(paths), offsets, targets: Uint32Array.from(targets) };
    }) };
}
export function unpackRows(c: RowColumns): FactRow[] {
  if (c.keys.length !== c.values.length || c.producers.length !== c.links.length) throw new Error('Invalid row columns');
  const rows = decodeStrings(c.paths).map(path => ({ path, properties: Object.create(null), links: Object.create(null) } as FactRow));
  c.keys.forEach((key, i) => { const values = decodeStrings(c.values[i]!); if (values.length !== rows.length) throw new Error('Column length mismatch'); values.forEach((v, n) => { if (v) rows[n]!.properties[key] = JSON.parse(v); }); });
  c.producers.forEach((producer, i) => {
    const links = c.links[i]!, paths = decodeStrings(links.paths);
    if (links.offsets.length !== rows.length + 1 || links.offsets[0] !== 0 || links.offsets.at(-1) !== links.targets.length) throw new Error('Invalid link CSR');
    rows.forEach((r, n) => {
      if (links.offsets[n + 1]! < links.offsets[n]!) throw new Error('Invalid link offsets');
      r.links![producer] = Array.from(links.targets.subarray(links.offsets[n], links.offsets[n + 1]), t => { if (t >= paths.length) throw new Error('Invalid link target'); return paths[t]!; });
    });
  });
  return rows;
}
/** Transfer all distinct buffers; structured-clone never copies numeric columns. */
export function transferables(value: unknown, found = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (value instanceof ArrayBuffer) found.add(value);
  else if (ArrayBuffer.isView(value)) { if (value.buffer instanceof ArrayBuffer) found.add(value.buffer); }
  else if (value instanceof Map) for (const v of value.values()) transferables(v, found);
  else if (Array.isArray(value)) for (const v of value) transferables(v, found);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) transferables(v, found);
  return [...found];
}
