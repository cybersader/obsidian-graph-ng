/** SPDX-License-Identifier: MIT
 * Synthetic-only expression receipts. No vault or renderer access. */
import { build } from 'esbuild';
import { expressionBuild } from './expression-build.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { expressionFixture } from './fixture';
import { packRows } from '../src/core/columns';
import { DEFAULT_LAYOUT } from '../src/core/layout-options';
const shared = await expressionBuild();
const normalOptions = { plugins: [shared.plugin(true)], entryPoints: ['src/layout-worker.ts'], bundle: true, minify: true, format: 'iife' as const, platform: 'browser' as const, write: false, target: 'es2022', charset: 'utf8' as const };
let normal = await build(normalOptions);
await shared.trim([normal.outputFiles![0]!.text, await readFile('main.js', 'utf8')]);
normal = await build(normalOptions);
const timed = `const originalPost = self.postMessage.bind(self); let started = 0; self.postMessage = (message, options) => { if (message.kind === 'started') started = performance.now(); originalPost(message.kind ? message : {...message, milliseconds: performance.now() - started}, options); };\n${shared.workerSource()}${normal.outputFiles![0]!.text}`;
const urls = new Map<Worker, string>();
function worker(source: string) { const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); const w = new Worker(url); urls.set(w, url); return w; }
function close(w: Worker) { w.terminate(); const url = urls.get(w); if (url) URL.revokeObjectURL(url); urls.delete(w); }
let next = 0;
async function request(w: Worker, data: any): Promise<any> {
  const id = ++next;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { close(w); reject(new Error('Benchmark worker deadline: 180 seconds')); }, 180000);
    w.onmessage = e => { if (e.data.id !== id || e.data.kind) return; clearTimeout(timer); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data); };
    w.onerror = e => { clearTimeout(timer); reject(new Error(e.message)); };
    w.postMessage({ id, revision: 1, ...data });
  });
}
const { rows, declaration } = expressionFixture();
const w = worker(timed), d = { ...declaration, display: { reifiedAsNodes: true } };
const expr = 'file.inFolder("Concepts") && note.category == "Category 1" && node.degree > 1';
const receipt: Record<string, any> = { fixture: 'uniform seed 17, literal display, 60600 notes', worker: 'minified production layout-worker IIFE in a Blob worker (Bun runtime)', expressions: { normal: expr }, repetitions: 7, warmup: 2, normalMs: [] };
try {
  await request(w, { kind: 'configure', config: { declaration: d, layout: DEFAULT_LAYOUT, source: 'synthetic/expr', groupLevel: 0, streamEveryIterations: 5 } });
  await request(w, { kind: 'rows', columns: packRows(rows, d), reset: true }); await request(w, { kind: 'project' });
  for (let i = 0; i < 9; i++) { const r = await request(w, { kind: 'expression-count', expr, context: 'filter' }); if (i >= 2) receipt.normalMs.push(r.milliseconds); receipt.matched = r.result.matched; receipt.total = r.result.total; }
  receipt.staleRevision = await request(w, { revision: 2, kind: 'expression-count', expr: 'true', context: 'filter' }).catch(String);
} finally { close(w); }
const worst = `coalesce(${Array.from({ length: 16 }, (_, i) => 'note.k' + ['.lower()', '.upper()', '.trim()'].join('').repeat(4) + ['.lower()', '.upper()', '.trim()'].slice(0, i === 15 ? 2 : 3).join('')).join(', ')})`;
receipt.expressions.worst = worst;
const worstBuild = await build({ stdin: { contents: `import {checked,check,parse} from './src/core/expr/syntax'; import {expressionFilter} from './src/core/expr/engine'; self.onmessage=e=>{const {n,expr}=e.data;try{const ast=checked(expr);const prefix='A'.repeat(4080);const p={paths:Array.from({length:n},(_,i)=>'N/'+i+'.md'),columns:{k:{values:Array.from({length:n},(_,i)=>JSON.stringify(prefix+String(i).padStart(16,'0'))),codes:Uint32Array.from({length:n},(_,i)=>i)}}};expressionFilter({...p,paths:p.paths.slice(0,1000),columns:{k:{values:p.columns.k.values.slice(0,1000),codes:p.columns.k.codes.slice(0,1000)}}},ast);const start=performance.now();const bits=expressionFilter(p,ast);self.postMessage({milliseconds:performance.now()-start,n,text:expr.length,matched:bits.reduce((a,b)=>a+b,0),distinct:n});}catch(e){self.postMessage({error:String(e)})}}`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, minify: true, format: 'iife', platform: 'browser', write: false, target: 'es2022' });
receipt.worst = [];
// Exactly six isolated samples; each worker has a 180-second deadline and is terminated.
for (const n of [50000, 100000]) for (let sample = 0; sample < 3; sample++) {
  const bw = worker(worstBuild.outputFiles[0]!.text);
  try {
    const r = await new Promise<any>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Worst-case deadline: 180 seconds')), 180000); bw.onmessage = e => { clearTimeout(timeout); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data); }; bw.onerror = e => { clearTimeout(timeout); reject(new Error(e.message)); }; bw.postMessage({ n, expr: worst }); });
    receipt.worst.push(r); console.log(JSON.stringify({ sample, ...r }));
  } finally { close(bw); }
}
const median = (a: number[]) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)]!;
receipt.normalP95 = [...receipt.normalMs].sort((a: number, b: number) => a - b)[Math.ceil(receipt.normalMs.length * .95) - 1];
receipt.ratio = median(receipt.worst.filter((r: any) => r.n === 100000).map((r: any) => r.milliseconds)) / median(receipt.worst.filter((r: any) => r.n === 50000).map((r: any) => r.milliseconds));
receipt.passes = { normal20ms: receipt.normalP95 <= 20, linearRatio: receipt.ratio >= 1.5 && receipt.ratio <= 2.5, worstUnder20seconds: receipt.worst.every((r: any) => r.milliseconds < 20000) };
await mkdir('.workspace/evidence', { recursive: true }); await writeFile('.workspace/evidence/expressions-benchmark.json', JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt, null, 2));
if (Object.values(receipt.passes).some(value => !value)) process.exitCode = 1;
