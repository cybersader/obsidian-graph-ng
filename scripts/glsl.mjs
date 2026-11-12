import { readFile } from 'node:fs/promises';
/** Shader sources are tagged glsl`...`; strip comments and insignificant whitespace,
 * keeping the newline that terminates each preprocessor directive. Code is unchanged. */
export const minifyGlsl = source => source.replace(/glsl`([^`]*)`/g, (_, body) => 'glsl`' + body.split('\n').map(line => line.replace(/\/\/.*$/, '').trim()).filter(Boolean)
  .map(line => line.startsWith('#') ? line + '\n' : line.replace(/\s+/g, ' ').replace(/ ?([{}();,=+\-*\/<>?:!&|[\]]) ?/g, '$1')).join('') + '`');
export const glsl = { name: 'glsl', setup(b) { b.onLoad({ filter: /webgl-renderer\.ts$/ }, async a => ({ contents: minifyGlsl(await readFile(a.path, 'utf8')), loader: 'ts' })); } };
