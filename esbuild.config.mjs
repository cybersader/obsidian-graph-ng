import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const worker = await build({ entryPoints: ['src/layout-worker.ts'], bundle: true, minify: true, format: 'iife', platform: 'browser', write: false, target: 'es2022' });
await build({ entryPoints: ['src/main.ts'], outfile: 'main.js', bundle: true, minify: true, format: 'cjs', platform: 'browser', external: ['obsidian'], target: 'es2022', define: { __LAYOUT_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) }, legalComments: 'eof' });
const dest = 'test-vault/.obsidian/plugins/graph-ng';
await mkdir(dest, { recursive: true });
for (const f of ['main.js', 'styles.css', 'manifest.json', 'NOTICE', 'THIRD_PARTY_NOTICES.txt']) await copyFile(f, `${dest}/${f}`);
