import { readFile } from 'node:fs/promises';
/** Explicit shader-private identifiers only. One map spans every stage, so varyings link.
 * Uniforms and vertex attributes retain their JS-facing names. Uppercase destinations
 * cannot alias swizzles; fail the build rather than silently capture a future identifier. */
export const shaderNames = Object.fromEntries([
  'outputColor', 'alpha', 'tint', 'spread', 'radius', 'offscreen', 'rgb', 'tier',
  'local', 'corners', 'nodeColor', 'color', 'ring', 'bands', 'tangent', 'ego',
  'note', 'point', 'state', 'cell', 'clip', 'core', 'delta', 'quiet', 'shownTier',
  'normal', 'wide', 'lift', 'origin', 'segment', 'hover', 'base', 'seed', 'hot',
  'inside', 'lens', 'side', 'shade', 'share', 'halo', 'rim', 'ink', 'len', 'box',
].map((name, i) => [name, i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26)]));
const token = /\b[A-Za-z_]\w*\b/g;
const uncomment = body => body.split('\n').map(line => line.replace(/\/\/.*$/, '').trim()).filter(Boolean);
/** Shader sources are tagged glsl`...`; keep directive newlines and every arithmetic
 * token. Only the reviewed private names and insignificant whitespace change. */
export function minifyGlsl(source) {
  const bodies = [...source.matchAll(/glsl`([^`]*)`/g)].map(m => uncomment(m[1]).join('\n'));
  const identifiers = new Set(bodies.flatMap(body => body.match(token) ?? []));
  if (Object.values(shaderNames).some(name => identifiers.has(name))) throw new Error('GLSL_PRIVATE_NAME_COLLISION');
  for (const body of bodies) for (const declaration of body.matchAll(/\b(?:uniform|layout\([^)]*\)\s*in)\s+\w+\s+([^;]+);/g)) {
    if ((declaration[1].match(token) ?? []).some(name => Object.hasOwn(shaderNames, name))) throw new Error('GLSL_PUBLIC_NAME_RENAME');
  }
  return source.replace(/glsl`([^`]*)`/g, (_, body) => 'glsl`' + uncomment(body).map(line => {
    const renamed = line.replace(token, (name, offset) => line.slice(0, offset).trimEnd().endsWith('.') || !Object.hasOwn(shaderNames, name) ? name : shaderNames[name]);
    return renamed.startsWith('#') ? renamed + '\n' : renamed.replace(/\s+/g, ' ').replace(/ ?([{}();,=+\-*\/<>?:!&|[\]]) ?/g, '$1');
  }).join('').replace(/(^|[;{}\n])(uniform|in|out) (\w+) (\w+);((?:\2 \3 \w+;)+)/g, (_, prefix, qualifier, type, first, rest) => {
    // Consecutive declarations with identical storage/type have no initializers or
    // layout qualifiers: grouping them does not reorder bindings or expressions.
    const names = rest.replace(new RegExp(`${qualifier} ${type} `, 'g'), '').slice(0, -1).replace(/;/g, ',');
    return `${prefix}${qualifier} ${type} ${first},${names};`;
  }) + '`');
}
export const glsl = { name: 'glsl', setup(b) { b.onLoad({ filter: /webgl-renderer\.ts$/ }, async a => ({ contents: minifyGlsl(await readFile(a.path, 'utf8')), loader: 'ts' })); } };
