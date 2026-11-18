// Under the shared browser lock: node scripts/light-preview-bench.mjs <source-root> <receipt.json> <notes>
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { glsl } from './glsl.mjs';
import { wgsl } from './wgsl.mjs';
const [root,output,size,action]=process.argv.slice(2), n=Number(size), stop=action==='stop';
if (![20000,49000].includes(n)) throw Error('Expected 20000 or 49000');
const available=Number(execFileSync('free',['-g'],{encoding:'utf8'}).split('\n').find(l=>l.startsWith('Mem:')).trim().split(/\s+/).at(-1));
if (!(available>=8)) throw Error('Less than 8 GB available');
const bundle=async contents=>(await build({stdin:{contents,resolveDir:path.resolve(root,'scripts')},plugins:[wgsl,glsl,{name:"host",setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:"host",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"export class Menu {} export function setIcon() {}"}));}}],bundle:true,platform:'browser',write:false})).outputFiles[0].text;
const pageJs=await bundle(await fs.readFile(new URL('./light-preview-bench-page.mjs',import.meta.url),'utf8'));
const workerJs=await bundle(`import '../src/layout-worker'; import { LayoutSolver } from '../src/core/layout'; import { LayoutEngineSession } from '../src/layout-engine';
let produced=0, steps=0; const step=LayoutSolver.prototype.stepResponsive, run=LayoutEngineSession.prototype.run;
LayoutSolver.prototype.stepResponsive=async function(...args){const done=await step.apply(this,args); if(done) steps++; return done;};
LayoutEngineSession.prototype.run=function(input,options,config){const buffer=config.buffer; return run.call(this,input,options,{...config,buffer:n=>{produced++;return buffer(n)}})};
const post=self.postMessage.bind(self);self.postMessage=(m,...args)=>{if(m.result?.positions && 'milliseconds' in m.result){m.result.benchProduced=produced;m.result.benchSteps=steps}return post(m,...args)};`);
const css=await fs.readFile('styles.css','utf8');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,chromiumSandbox:true,args:['--enable-gpu','--use-gl=angle','--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:800,height:600}});page.on('pageerror',e=>console.error(String(e)));
  await page.route('http://localhost/**',route=>{const file=new URL(route.request().url()).pathname;return route.fulfill(file==='/'?{contentType:'text/html',body:`<!doctype html><style>${css}\nbody{margin:0}#stage{width:640px;height:480px;position:relative}</style><div id="stage" class="graph-ng-stage"></div><script src="/page.js"></script>`}:{contentType:'application/javascript',body:file==='/page.js'?pageJs:workerJs});});
  await page.goto('http://localhost/');
  let done=false;const running=page.evaluate(job=>window.run(job),{n,stop}).finally(()=>{done=true;}); running.catch(()=>{});
  await Promise.race([page.waitForFunction(()=>window.panReady,null,{timeout:240000}),running]);
  if(!stop){
  await page.mouse.move(180,180);await page.mouse.down();let i=0;
  while(!done && !await page.evaluate(()=>window.solvingDone)){await page.mouse.move(180+((++i%80)<40?i%40:40-i%40)*4,180);await new Promise(r=>setTimeout(r,10));}
  await page.mouse.up();
  }
  const row=await running;
  await fs.writeFile(output,JSON.stringify({...row,browser:browser.version(),available},null,2));
  if(row.produced!==row.received || row.pick!==0 || (stop ? row.settled!==false || row.steps>=80 : row.steps!==80 || row.panStart===row.panEnd || row.inputMs.length<20)) throw Error('Incomplete measurement');
  console.log(n,row.produced,row.received,row.painted,row.steps,row.pick,row.inputMs.length);
} finally { await browser.close(); }
