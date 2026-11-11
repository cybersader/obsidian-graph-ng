import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { glsl } from './scripts/glsl.mjs';
const worker = await build({ metafile: true, entryPoints: ['src/layout-worker.ts'], bundle: true, minify: true, format: 'iife', platform: 'browser', write: false, target: 'es2022' });
const main = await build({ metafile: true, plugins: [glsl], entryPoints: ['src/main.ts'], outfile: 'main.js', bundle: true, minify: true, format: 'cjs', platform: 'browser', external: ['obsidian'], target: 'es2022', define: { __LAYOUT_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) }, legalComments: 'eof' });
const dest = 'test-vault/.obsidian/plugins/graph-ng';
await mkdir(dest, { recursive: true });
for (const f of ['main.js', 'styles.css', 'manifest.json', 'NOTICE', 'THIRD_PARTY_NOTICES.txt']) await copyFile(f, `${dest}/${f}`);

for (const result of [worker, main]) if (Object.keys(result.metafile.inputs).some(p => p.includes('node_modules/'))) throw new Error('RUNTIME_DEPENDENCY_BUNDLED');
await mkdir('.workspace/evidence', { recursive: true });
await writeFile('.workspace/evidence/bundle-inputs.json', JSON.stringify({ worker: Object.keys(worker.metafile.inputs), main: Object.keys(main.metafile.inputs), external: ['obsidian'], runtimePackages: 0 }, null, 2) + '\n');
