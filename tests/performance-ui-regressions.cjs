// Exercise production controls and the real persistence queue with an inert host.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('main.js', 'utf8'), mangle = JSON.parse(fs.readFileSync('.workspace/evidence/main-mangle-cache.json', 'utf8'));
const marker = source.indexOf('"Local performance log"');
const controls = [...source.slice(0, marker).matchAll(/function ([\w$]+)\([^)]*\)\{/g)].at(-1)[1];
const modalName = source.slice(marker).match(/function ([\w$]+)\([^)]*\)\{[^]*?new [\w$]+\.Modal/)[1];
const settingsName = source.match(/([\w$]+)=class extends [\w$]+\.PluginSettingTab/)[1];
class Element {
  constructor(tag='div', options={}) { this.tagName=tag.toUpperCase(); this.children=[]; this.options=options; this.style={}; this.textContent=options.text||''; }
  createEl(tag, options={}) { const e=new Element(tag,options); this.children.push(e); return e; }
  createSpan(o) { return this.createEl('span',o); } createDiv(o) { return this.createEl('div',o); }
  empty(){this.children=[];}
  all() { return this.children.flatMap(c=>[c,...c.all()]); }
  querySelector(tag) { return this.all().find(c=>c.tagName===tag.toUpperCase()); }
}
const modals=[], settings=[];
class Setting {
  constructor(host) { this.host=host; this.nameEl=host.createSpan(); this.buttons=[]; this.toggles=[]; settings.push(this); }
  setHeading(){return this;}
  setName(name) { this.name=name; return this; }
  addToggle(callback) { const t={setDisabled(v){this.disabled=v;return this;},setValue(v){this.value=v;return this;},onChange(f){this.change=f;return this;}};this.toggles.push(t);callback(t);return this; }
  addButton(callback) { const b={setButtonText(v){this.text=v;return this;},onClick(f){this.click=f;return this;},setCta(){return this;},setDisabled(v){this.disabled=v;return this;}};this.buttons.push(b);callback(b);return this; }
}
class Modal { constructor(){this.contentEl=new Element();modals.push(this);}setTitle(t){this.title=t;}open(){this.opened=true;}close(){this.opened=false;this.onClose?.();} }
class Plugin { async saveData(data){this.disk=structuredClone(data);} }
const mod={exports:{}};
const obsidian={Modal,Setting,Plugin,ItemView:class{},PluginSettingTab:class{},Notice:class{},TFile:class{},Menu:class{},apiVersion:'synthetic'};
vm.runInNewContext(source+`\nmodule.exports.__controls=${controls};module.exports.__modal=${modalName};module.exports.__settings=${settingsName};`,{module:mod,exports:mod.exports,require:()=>obsidian,console,structuredClone,setTimeout,clearTimeout,performance,TextEncoder,TextDecoder,MessageChannel});
function plugin(){const p=new mod.exports.default();p.settings=JSON.parse(fs.readFileSync('examples/default-settings.json','utf8'));p.adapter={configure(){}};p[mangle.resetStore]=()=>{};p.app={workspace:{getLeavesOfType:()=>[]}};return p;}
function button(modal,label){return settings.filter(s=>s.host===modal.contentEl).flatMap(s=>s.buttons).find(b=>b.text===label);}
function control(host,label){return host.all().find(e=>e.options.attr?.['aria-label']===label);}
(async()=>{
  const p=plugin();p.settings.performanceDiagnostics=true;p.settings.performanceSuggestions=false;
  const host=new Element();let redraws=0;mod.exports.__controls(host,p,()=>redraws++);
  host.all().find(e=>e.textContent==='Make lighter').onclick();await button(modals.at(-1),'Apply').click();assert.equal(redraws,1);
  // Another validated settings apply can replace the object without rebuilding these controls.
  p.settings=structuredClone(p.settings);
  const log=control(host,'Local performance log');log.checked=false;log.onchange();await p.save();
  p.recordPerformance({notes:1});await p.save();assert.equal(p.settings.performanceDiagnostics,false);assert.equal(p.disk.performanceLog,undefined);
  const mode=control(host,'Performance');mode.value='quality';mode.onchange();await p.save();assert.equal(p.settings.performance,'quality');
  console.log('PASS event-time controls, diagnostics OFF, and modal redraw');
  const q=plugin();q.notify=async()=>q.recordPerformance({notes:20000});mod.exports.__modal(q);const manual=modals.at(-1);
  const motion=control(manual.contentEl,'Turn off motion');motion.checked=false;motion.onchange();const before=modals.length;
  await button(manual,'Apply').click();assert.equal(modals.length,before);assert.equal(q.settings.visuals.motion,'full');
  console.log('PASS manual Apply prevents automatic modal re-entry');
  for(const dismiss of ['Not now','X']){
    const r=plugin();r.recordPerformance({notes:20000});const first=modals.at(-1);
    if(dismiss==='X')first.close();else await button(first,'Not now').click();await r.save();
    const reloaded=plugin();reloaded.settings=structuredClone(r.disk.settings);const count=modals.length;reloaded.recordPerformance({notes:20000});assert.equal(modals.length,count);
    mod.exports.__modal(reloaded);assert.equal(modals.length,count+1);modals.at(-1).close();await reloaded.save();
  }
  console.log('PASS dismissal persists across reload; manual reopening remains available');
  const failed=plugin();failed.settings.performanceSuggestions=false;mod.exports.__modal(failed);await failed.save();
  failed.saveData=async()=>{throw new Error('synthetic disk rejection');};const original=structuredClone(failed.settings),rejected=modals.at(-1);
  await button(rejected,'Apply').click();assert.equal(rejected.opened,true);assert.deepEqual(failed.settings,original);
  assert.match(rejected.contentEl.all().find(e=>e.options.attr?.role==='status').textContent,/Could not apply/);
  console.log('PASS rejected Apply keeps live settings unchanged');
  const delayed=plugin();delayed.settings.performanceSuggestions=false;mod.exports.__modal(delayed);const pendingModal=modals.at(-1);await delayed.save();
  let enter,release;const entered=new Promise(r=>enter=r),pending=new Promise(r=>release=r);
  delayed.saveData=async data=>{const snapshot=structuredClone(data);enter();await pending;delayed.disk=snapshot;};
  const committing=button(pendingModal,'Apply').click();await entered;
  const pendingMotion=control(pendingModal.contentEl,'Turn off motion');assert.equal(pendingMotion.disabled,true);assert.equal(button(pendingModal,'Not now').disabled,true);
  pendingMotion.checked=false;pendingMotion.onchange();release();await committing;
  assert.equal(delayed.settings.visuals.motion,'off');assert.equal(delayed.disk.settings.visuals.motion,'off');
  console.log('PASS pending Apply freezes choices and disables controls');
  const draftPlugin=plugin();draftPlugin.settings.performanceSuggestions=false;const tab=new mod.exports.__settings(draftPlugin);tab.containerEl=new Element();tab.display();
  const draft=control(tab.containerEl,'Graph declaration JSON'),knobs=control(tab.containerEl,'Tuning settings JSON');draft.value='{"syntheticDraft":true}';knobs.value='{"syntheticTuningDraft":true}';
  tab.containerEl.all().find(e=>e.textContent==='Make lighter').onclick();await button(modals.at(-1),'Apply').click();
  assert.equal(control(tab.containerEl,'Graph declaration JSON'),draft);assert.equal(draft.value,'{"syntheticDraft":true}');assert.equal(control(tab.containerEl,'Tuning settings JSON'),knobs);assert.equal(knobs.value,'{"syntheticTuningDraft":true}');
  console.log('PASS performance-only redraw preserves both JSON drafts');
  const quiet=plugin();let rebuilds=0;quiet.notify=async()=>{rebuilds++;};quiet.adapter.configure=()=>{rebuilds++;};
  await quiet.commitPerformance(new Set(),true,()=>true);assert.equal(rebuilds,0);assert.equal(quiet.disk.settings.performanceSuggestions,false);
  console.log('PASS suppression-only save does not rebuild the graph');

})().catch(e=>{console.error(e);process.exitCode=1;});
