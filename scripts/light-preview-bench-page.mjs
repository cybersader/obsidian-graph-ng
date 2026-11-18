// Bundled for a synthetic browser page, with src resolved against the measured revision.
import { DetailRenderer } from '../src/webgl-renderer';
import { defaults } from '../src/settings';
import { random } from '../src/core/layout';
import { WorkerPipeline } from '../src/pipeline';
import { packRows } from '../src/core/columns';
import { LayoutPreview } from '../src/layout-preview';

HTMLElement.prototype.createEl = function(tag, {cls='', text='', attr={}}={}) { const el=this.appendChild(document.createElement(tag)); el.className=cls; el.textContent=text; for(const [k,v] of Object.entries(attr)) el.setAttribute(k,v); return el; };
HTMLElement.prototype.createDiv = function(o) { return this.createEl('div',o); };
HTMLElement.prototype.createSpan = function(o) { return this.createEl('span',o); };
const bounds = g => [g.minX,g.minY,g.width,g.height];
window.run = async ({n,stop}) => {
  const settings = defaults('fixture@1'), steps = 80, every = 2, groupsUntil = 20;
  const name = i => `Synthetic/n${String(i).padStart(5, '0')}.md`, rng = random(17);
  const rows = Array.from({ length: n }, (_, i) => {
    const base = i & ~127, size = Math.min(128,n-base);
    const targets = [base+(i-base+1)%size,base+Math.floor(rng()*size),base]; if (!(i%32)) targets.push((i+128)%n);
    return { path: name(i), properties: {}, links: { 'fixture@1': [...new Set(targets.filter(j => i !== j))].map(name) } };
  });
  const worker = new Worker('/worker.js'), pipe = new WorkerPipeline(worker, () => 240000);
  const ask = r => pipe.request(1,r), stage = document.getElementById('stage');
  let renderer, notes = false, received = 0, bytes = 0, progress = 0, panStart, panEnd, iterations = [], queuedInputs = [], failed;
  const painted = new Set(), frameStep = new WeakMap(), frameBounds = {}, uploads = [], inputMs = [];
  await ask({ kind: 'configure', config: { declaration: settings.declaration, layout: { ...settings.layout, iterations: steps, convergenceThreshold: 0 }, layoutEngine: 'processor', groupLevel: 0, source: 'synthetic', streamEveryIterations: every } });
  for (let i=0; i<n; i+=2000) await ask({ kind: 'rows', reset: !i, columns: packRows(rows.slice(i,i+2000), settings.declaration) });
  const project = await ask({ kind: 'project' }), detail = await ask({ kind: 'detail' });
  const create = (p,loading,current) => DetailRenderer.create(stage,detail.projection,p,detail.visible,settings,()=>{},()=>{},detail.colors,current,false,()=>{}, {loading});
  const preview = new LayoutPreview(async (p,current) => {
    const r = renderer = await create(p,true,current); if (!r.gpu) throw Error('WebGL2 required');
    const mark = () => { const step=frameStep.get(r.positions); painted.add(step); frameBounds[step]=bounds(r.grid); };
    mark(); const draw = r.draw; r.draw = () => {
      draw(); mark();
      // A task posted inside rAF runs after the browser's rendering opportunity. Not physical scan-out.
      if (queuedInputs.length) { const inputs=queuedInputs; queuedInputs=[]; setTimeout(() => { const end=performance.now(); for (const t of inputs) inputMs.push(end-t); },0); }
    };
    const original = r.streamPositions; r.streamPositions = function(next) { const t=performance.now(); const prev=original.call(this,next); uploads.push(performance.now()-t); return prev; };
    stage.addEventListener('pointermove', e => { if (e.buttons===1) { queuedInputs.push(e.timeStamp); panStart ??= r.camera.x; } },true);
    window.panReady=true; if(stop) pipe.stopLayout(1); return r;
  }, p => pipe.recycle(p.buffer), () => notes, e => { failed=String(e); });
  const advance = i => { iterations.push(i); if (!notes && i>=groupsUntil) { notes=true; pipe.previewWanted?.(1,true); } };
  pipe.onProgress=(i)=>{ progress++; advance(i); };
  pipe.onPositions=e=>{ ++received; bytes+=e.positions.byteLength; frameStep.set(e.positions,e.iteration); const show=notes; advance(e.iteration); if (show) return preview.push(e.positions); pipe.recycle(e.positions.buffer); };
  const result=await ask({kind:'layout',preview:{from:every*2,wanted:false}}); window.solvingDone=true; panEnd=renderer?.camera.x;
  await preview.finish(true); if (failed || !renderer) throw Error(failed || 'No preview');
  const final=await create(result.positions,false,()=>true); final.adoptCamera(renderer);
  const first=final.screenPoint(0), pick=final.pick(first.x,first.y);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',result.positions)), b=>b.toString(16).padStart(2,'0')).join('');
  await new Promise(resolve=>setTimeout(resolve,40));
  const gl=final.canvas.getContext('webgl2'), rendererInfo=gl.getExtension('WEBGL_debug_renderer_info');
  const row={n,cacheKey:project.meta.key,settled:result.settled,initialBounds:bounds(renderer.cameraFrame),backend:rendererInfo && gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL),edges:project.edges,cadence:every,groupsUntil,produced:result.benchProduced,received,painted:painted.size,bytes,progress,steps:result.benchSteps,hash,pick,panStart,panEnd,finalBounds:bounds(final.grid),frameBounds,iterations,uploads,inputMs};
  await preview.finish(); final.dispose(); pipe.dispose(); return row;
};
