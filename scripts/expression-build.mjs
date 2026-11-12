/** SPDX-License-Identifier: MIT
 * Pure modules shared by the host and Blob worker are packaged once. A static,
 * self-contained factory supplies identical functions to both realms without
 * eval, Function, dynamic imports, runtime fetches or external dependencies.
 * Only exports actually used by either bundle survive the discovery build.
 */
import { build } from 'esbuild';
import path from 'node:path';
const modules = ['core/expr/syntax', 'core/expr/engine', 'core/declaration', 'core/columns', 'core/layout-options', 'core/binary-layout', 'gpu-probe', 'core/explore', 'core/group-projection', 'render-projection', 'core/derive', 'core/projection'];
export async function expressionBuild(root = process.cwd()) {
  const registry = new Map(); let next = 0;
  for (const name of modules) {
    const file = path.resolve(root, `src/${name}.ts`);
    const inventory = await build({ absWorkingDir: root, entryPoints: [file], bundle: false, format: 'esm', write: false, metafile: true });
    registry.set(file, Object.values(inventory.metafile.outputs)[0].exports.map(name => ({ name, key: `x${next++}` })));
  }
  let core, factory;
  async function compile(needed) {
    const selected = [...registry].map(([file, names]) => [file, names.filter(n => !needed || needed.has(n.key))]).filter(([, names]) => names.length);
    const contents = selected.map(([file, names]) => `import {${names.map(n => `${n.name} as ${n.key}`).join(',')}} from ${JSON.stringify(file)};`).join('\n') + `\nexport default () => ({${selected.flatMap(([, names]) => names.map(n => n.key)).join(',')}});`;
    core = await build({ absWorkingDir: root, stdin: { contents, resolveDir: root }, bundle: true, minify: true, format: 'iife', globalName: 'core', platform: 'browser', write: false, target: 'es2022', charset: 'utf8', legalComments: 'none', metafile: true });
    factory = `function(){${core.outputFiles[0].text};return core.default()}`;
  }
  await compile();
  const plugin = worker => ({ name: 'shared-expression-core', setup(b) {
    b.onResolve({ filter: /expression-prelude(?:\.ts)?$/ }, () => ({ path: 'prelude', namespace: 'expression-core' }));
    b.onResolve({ filter: /^\./ }, args => {
      if (args.namespace !== 'file') return;
      const file = path.resolve(path.dirname(args.importer), args.path.replace(/\.ts$/, '') + '.ts');
      return registry.has(file) ? { path: file, namespace: 'expression-core' } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: 'expression-core' }, args => {
      if (args.path === 'prelude') return { contents: `const factory=${factory}; export const syntax = factory(); export const expressionPrelude=()=> 'const __GRAPH_EXPR__ = (' + factory.toString() + ')();\\n';`, loader: 'js' };
      const source = worker ? '__GRAPH_EXPR__' : 'syntax';
      return { contents: `${worker ? '' : "import {syntax} from 'expression-prelude';"}\n${registry.get(args.path).map(n => `export const ${n.name}=/* @__PURE__ */(()=>${source}.${n.key})();`).join('\n')}`, loader: 'js' };
    });
  }});
  return { plugin, get core() { return core; }, workerSource: () => `const __GRAPH_EXPR__ = (${factory})();\n`, async trim(outputs) {
    const needed = new Set(outputs.flatMap(source => [...source.matchAll(/\.(x\d+)\b/g)].map(m => m[1])));
    if (!needed.size) throw new Error('Missing shared-core inventory');
    await compile(needed);
  }};
}
