/** SPDX-License-Identifier: MIT */
import { FUNCTIONS, print, ref, validate } from './syntax';
/** Suggestions depend only on public projection keys and the inferred receiver type. */
export function suggestions(source: string, keys: readonly string[]): string[] {
  const result = [...new Set(keys)].sort().map(k => print(ref('note', k))).concat(['file.path', 'file.name', 'file.basename', 'file.folder', 'file.ext', 'file.inFolder(', 'file.hasProperty(', 'node.identity', 'node.degree']);
  const dot = source.lastIndexOf('.');
  if (dot >= 0) {
    const receiver = validate(source.slice(0, dot)), t = receiver.ok ? receiver.type : 'unknown';
    const names = Object.keys(FUNCTIONS).filter(name => { const scope = FUNCTIONS[name]![3]; return scope === 'any' || scope !== 'global' && scope.includes(t === 'unknown' ? 'string' : t); });
    result.push(...names.map(name => `${source.slice(0, dot)}.${name}${name === 'length' ? '' : '('}`));
  }
  return result;
}
