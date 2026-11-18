// Exercise production controls and the real persistence queue with an inert host.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('main.js', 'utf8'), mangle = JSON.parse(fs.readFileSync('.workspace/evidence/main-mangle-cache.json', 'utf8'));
for (const name of ['propertyFacts', 'get', 'load', 'roomFor', 'rooms', 'cacheIdentity', 'generation', 'verifiedComplete', 'verified', 'frontmatter', 'parseError', 'truncated', 'signal', 'abort', 'aborted', 'isDeferred', 'work', 'next', 'draining', 'jobs']) assert.equal(mangle[name], undefined, `public propertyFacts member renamed: ${name}`);
const marker = source.indexOf('"Local performance log"');
const controls = [...source.slice(0, marker).matchAll(/function ([\w$]+)\([^)]*\)\{/g)].at(-1)[1];
const modalName = source.slice(marker).match(/function ([\w$]+)\([^)]*\)\{[^]*?new [\w$]+\.Modal/)[1];
const settingsName = source.match(/([\w$]+)=class extends [\w$]+\.PluginSettingTab/)[1];
class Element {
  constructor(tag='div', options={}) { this.tagName=tag.toUpperCase(); this.children=[]; this.options=options; this.style={}; this.textContent=options.text||''; }
  createEl(tag, options={}) { const e=new Element(tag,options); this.children.push(e); return e; }
  createSpan(o) { return this.createEl('span',o); } createDiv(o) { return this.createEl('div',o); }
  addClass(){}
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
  addButton(callback) { const b={buttonEl:{focus(){this.focused=true;}},setButtonText(v){this.text=v;return this;},onClick(f){this.click=f;return this;},setCta(){return this;},setDisabled(v){this.disabled=v;return this;}};this.buttons.push(b);callback(b);return this; }
}
class Modal { constructor(){this.contentEl=new Element();modals.push(this);}setTitle(t){this.title=t;}open(){this.opened=true;}close(){this.opened=false;this.onClose?.();} }
class Plugin { async saveData(data){if(this.rejectShared)throw Error('synthetic host rejection');this.disk=structuredClone(data);} }
const mod={exports:{}};
const context={module:mod,exports:mod.exports,require:()=>obsidian,console,structuredClone,setTimeout,clearTimeout,performance,TextEncoder,TextDecoder,MessageChannel,crypto:require('node:crypto').webcrypto};
const obsidian={setIcon(){},Modal,Setting,Plugin,ItemView:class{},PluginSettingTab:class{},Notice:class{},TFile:class{},Menu:class{},apiVersion:'synthetic'};
vm.runInNewContext(source+`\nmodule.exports.__controls=${controls};module.exports.__modal=${modalName};module.exports.__settings=${settingsName};`,context);
function storage(){const rows=new Map();return {rows,getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};}
let nextNamespace=1;
async function plugin(data,localStorage=storage()){
  const p=new mod.exports.default();p.settings={...JSON.parse(fs.readFileSync('examples/default-settings.json','utf8')),...data?.settings};
  p.adapter={configure(){}};p[mangle.resetStore]=()=>{};p.app={workspace:{getLeavesOfType:()=>[]}};p.manifest={id:'graph-ng'};
  p.localStorage=localStorage;context.localStorage=localStorage;
  await p.loadDevicePerformance(data ? data.deviceNamespace : (nextNamespace++).toString(16).padStart(32,'0'));return p;
}
function local(p){return JSON.parse(p.localStorage.getItem(`graph-ng:graph-ng:${p.deviceNamespace}:performance:v1`));}
function sharedOnly(p){for(const key of ['performance','performanceDiagnostics','performanceSuggestions','performancePrompted'])assert.equal(p.disk.settings[key],undefined);assert.equal(p.disk.performanceLog,undefined);}

function button(modal,label){return settings.filter(s=>s.host===modal.contentEl).flatMap(s=>s.buttons).find(b=>b.text===label);}
function control(host,label){return host.all().find(e=>e.options.attr?.['aria-label']===label);}
(async()=>{
  const all=await plugin();all.settings.performance='quality';all.settings.visuals.labelStyle='ranked';all.settings.visuals.curvedEdges=true;all.settings.declaration.display.reifiedAsNodes=true;
  all.recordPerformance({notes:20000});const offer=modals.at(-1);
  assert.equal(offer.title,'This graph is large');assert.ok(offer.contentEl.all().some(e=>e.textContent==='20,000 notes in this graph'));
  assert.equal(button(offer,'Speed up').buttonEl.focused,true);
  const choices=offer.contentEl.querySelector('details');assert.ok(choices);assert.ok(!choices.open);assert.ok(choices.all().some(e=>e.textContent==='Choose changes'));
  assert.equal(choices.all().filter(e=>e.tagName==='INPUT'&&e.checked).length,5);
  await button(offer,'Speed up').click();
  assert.equal(all.settings.performance,'fast');assert.equal(local(all).settings.performance,'fast');
  assert.equal(all.settings.visuals.labelStyle,'anchored');assert.equal(all.settings.visuals.curvedEdges,false);assert.equal(all.settings.visuals.motion,'off');assert.equal(all.settings.declaration.display.reifiedAsNodes,false);
  assert.deepEqual(all.disk.settings.visuals,all.settings.visuals);assert.equal(offer.opened,false);
  console.log('PASS actual trigger title/reason, collapsed choices and one-click apply all');
  mod.exports.__modal(all);const empty=modals.at(-1);assert.equal(empty.contentEl.querySelector('details'),undefined);assert.equal(button(empty,'Speed up'),undefined);await button(empty,'Not now').click();
  console.log('PASS no empty disclosure or no-op primary when settings are already simplified');
  const custom=await plugin();custom.settings.performance='quality';mod.exports.__modal(custom);const customModal=modals.at(-1);
  const fastChoice=control(customModal.contentEl,'Use Fast mode');fastChoice.checked=false;fastChoice.onchange();await button(customModal,'Speed up').click();assert.equal(custom.settings.performance,'quality');assert.equal(local(custom).settings.performance,'quality');
  console.log('PASS opting out of Fast preserves Performance mode');
  const manualOnly=await plugin();mod.exports.__modal(manualOnly);assert.equal(modals.at(-1).title,'Speed up graph');modals.at(-1).close();
  const p=await plugin();p.settings.performanceDiagnostics=true;p.settings.performanceSuggestions=false;
  const host=new Element();let redraws=0;mod.exports.__controls(host,p,()=>redraws++);
  host.all().find(e=>e.textContent==='Speed up graph').onclick();await button(modals.at(-1),'Speed up').click();assert.equal(redraws,1);
  // Another validated settings apply can replace the object without rebuilding these controls.
  p.settings=structuredClone(p.settings);
  const log=control(host,'Local performance log');log.checked=false;log.onchange();await p.save();
  p.recordPerformance({notes:1});await p.save();assert.equal(p.settings.performanceDiagnostics,false);assert.equal(p.disk.performanceLog,undefined);
  const mode=control(host,'Performance');mode.value='quality';mode.onchange();await p.save();assert.equal(p.settings.performance,'quality');
  console.log('PASS event-time controls, diagnostics OFF, and modal redraw');
  const q=await plugin();q.notify=async()=>q.recordPerformance({notes:20000});mod.exports.__modal(q);const manual=modals.at(-1);
  const motion=control(manual.contentEl,'Turn off motion');motion.checked=false;motion.onchange();const before=modals.length;
  await button(manual,'Speed up').click();assert.equal(modals.length,before);assert.equal(q.settings.visuals.motion,'full');
  console.log('PASS manual Apply prevents automatic modal re-entry');
  for(const dismiss of ['Not now','X']){
    const r=await plugin();r.recordPerformance({notes:20000});const first=modals.at(-1);
    if(dismiss==='X')first.close();else await button(first,'Not now').click();await r.save();
    const reloaded=await plugin(r.disk,r.localStorage);const count=modals.length;reloaded.recordPerformance({notes:20000});assert.equal(modals.length,count);
    mod.exports.__modal(reloaded);assert.equal(modals.length,count+1);modals.at(-1).close();await reloaded.save();
  }
  console.log('PASS dismissal persists across reload; manual reopening remains available');
  const failed=await plugin();failed.settings.performanceSuggestions=false;mod.exports.__modal(failed);await failed.save();
  failed.rejectShared=true;const original=structuredClone(failed.settings),originalLocal=local(failed),rejected=modals.at(-1);
  await button(rejected,'Speed up').click();assert.equal(rejected.opened,true);assert.deepEqual(failed.settings,original);assert.deepEqual(local(failed),originalLocal);
  assert.match(rejected.contentEl.all().find(e=>e.options.attr?.role==='status').textContent,/Could not apply/);
  console.log('PASS rejected Apply keeps live settings unchanged');
  const delayed=await plugin();delayed.settings.performanceSuggestions=false;mod.exports.__modal(delayed);const pendingModal=modals.at(-1);await delayed.save();
  let enter,release;const entered=new Promise(r=>enter=r),pending=new Promise(r=>release=r);
  const delayedSave=delayed.saveData.bind(delayed);delayed.saveData=async data=>{const snapshot=structuredClone(data);enter();await pending;await delayedSave(snapshot);};
  const committing=button(pendingModal,'Speed up').click();await entered;
  assert.equal(delayed.settings.performance,'auto');assert.equal(local(delayed).settings.performance,'auto');
  const pendingMotion=control(pendingModal.contentEl,'Turn off motion');assert.equal(pendingMotion.disabled,true);assert.equal(button(pendingModal,'Not now').disabled,true);assert.equal(button(pendingModal,'Speed up').disabled,true);assert.equal(control(pendingModal.contentEl,"Don't ask again").disabled,true);
  pendingMotion.checked=false;pendingMotion.onchange();release();await committing;
  assert.equal(delayed.settings.visuals.motion,'off');assert.equal(delayed.disk.settings.visuals.motion,'off');
  console.log('PASS pending Apply freezes choices and disables controls');
  const draftPlugin=await plugin();draftPlugin.settings.performanceSuggestions=false;const tab=new mod.exports.__settings(draftPlugin);tab.containerEl=new Element();tab.display();
  const draft=control(tab.containerEl,'Graph declaration JSON'),knobs=control(tab.containerEl,'Tuning settings JSON');draft.value='{"syntheticDraft":true}';knobs.value='{"syntheticTuningDraft":true}';
  tab.containerEl.all().find(e=>e.textContent==='Speed up graph').onclick();await button(modals.at(-1),'Speed up').click();
  assert.equal(control(tab.containerEl,'Graph declaration JSON'),draft);assert.equal(draft.value,'{"syntheticDraft":true}');assert.equal(control(tab.containerEl,'Tuning settings JSON'),knobs);assert.equal(knobs.value,'{"syntheticTuningDraft":true}');
  console.log('PASS performance-only redraw preserves both JSON drafts');
  const quiet=await plugin();let rebuilds=0;quiet.notify=async()=>{rebuilds++;};quiet.adapter.configure=()=>{rebuilds++;};
  await quiet.commitPerformance(new Set(),true,()=>true);assert.equal(rebuilds,0);assert.equal(local(quiet).settings.performanceSuggestions,false);
  console.log('PASS suppression-only save does not rebuild the graph');
  mod.exports.__modal(quiet);const quietModal=modals.at(-1);
  for(const input of quietModal.contentEl.querySelector('details').all().filter(e=>e.tagName==='INPUT')){input.checked=false;input.onchange();}
  const suppression=control(quietModal.contentEl,"Don't ask again");suppression.checked=true;suppression.onchange();await button(quietModal,'Speed up').click();
  assert.equal(rebuilds,0);assert.equal(local(quiet).settings.performanceSuggestions,false);
  console.log('PASS deselecting every change saves suppression without rebuilding');

  for(const instance of [all,custom,p,q,quiet,delayed])sharedOnly(instance);
  console.log('PASS every actual shared save excludes device preferences and samples');
  const legacy={settings:{...all.settings,performance:'quality',performanceDiagnostics:true,performanceSuggestions:false,performancePrompted:true},performanceLog:[{tier:'low',mode:'fast',notes:999}],deviceNamespace:'a'.repeat(32)};
  const migrated=await plugin(legacy);assert.equal(migrated.settings.performance,'quality');assert.equal(local(migrated).settings.performancePrompted,true);assert.equal(migrated.performanceLog.length,0);assert.deepEqual(local(migrated).performanceLog,[]);
  assert.equal(legacy.performanceLog.length,1);await migrated.save();sharedOnly(migrated);assert.deepEqual(migrated.disk.settings.visuals,legacy.settings.visuals);
  migrated.settings.performance='fast';await migrated.save();const again=await plugin(legacy,migrated.localStorage);assert.equal(again.settings.performance,'fast');
  console.log('PASS one-time migration preserves settings, clears foreign samples, and removes shared device fields');
  const memberA=await plugin(migrated.disk),memberB=await plugin(migrated.disk);
  memberA.settings.performance='fast';memberA.settings.performanceSuggestions=false;memberA.settings.performancePrompted=true;memberA.settings.performanceDiagnostics=true;memberA.recordPerformance({notes:12});await memberA.save();
  memberB.settings.performance='quality';memberB.settings.performanceSuggestions=true;memberB.settings.performancePrompted=false;memberB.settings.performanceDiagnostics=true;memberB.recordPerformance({notes:23});await memberB.save();
  const reloadA=await plugin(memberB.disk,memberA.localStorage),reloadB=await plugin(memberA.disk,memberB.localStorage);
  assert.equal(reloadA.settings.performance,'fast');assert.equal(reloadB.settings.performance,'quality');assert.equal(reloadA.settings.performanceSuggestions,false);assert.equal(reloadB.settings.performanceSuggestions,true);assert.equal(reloadA.settings.performancePrompted,true);assert.equal(reloadB.settings.performancePrompted,false);assert.equal(reloadA.performanceLog[0].notes,12);assert.equal(reloadB.performanceLog[0].notes,23);sharedOnly(memberA);sharedOnly(memberB);
  console.log('PASS two members share one data.json but keep independent modes, flags and logs');
  const absent=await plugin(migrated.disk,undefined);context.localStorage=undefined;await absent.loadDevicePerformance(absent.deviceNamespace);absent.settings.performance='quality';await absent.commitPerformance(new Set(['fast']),true,()=>true);assert.equal(absent.settings.performance,'fast');sharedOnly(absent);
  const throwing=await plugin(migrated.disk,{getItem(){throw Error('disabled');},setItem(){throw Error('quota');}});throwing.settings.performanceDiagnostics=true;throwing.recordPerformance({notes:3});await throwing.save();assert.equal(throwing.performanceLog[0].notes,3);sharedOnly(throwing);
  console.log('PASS unavailable storage stays in memory without rejecting mode or log operations');
  const fresh=await plugin({settings:legacy.settings});assert.match(fresh.deviceNamespace,/^[0-9a-f]{32}$/);assert.equal(fresh.disk.deviceNamespace,fresh.deviceNamespace);sharedOnly(fresh);
  const unsaved=await plugin();unsaved.deviceNamespace=undefined;unsaved.saveData=async()=>{throw Error('namespace write rejected');};assert.equal(await unsaved.ensureDeviceNamespace(),undefined);assert.equal(unsaved.deviceNamespace,undefined);
  console.log('PASS namespace is acknowledged before durable local use; failed creation stays memory-only');
  const concurrent=await plugin();concurrent.deviceNamespace=undefined;
  let acknowledge;const namespaceGate=new Promise(resolve=>acknowledge=resolve),realSave=concurrent.saveData.bind(concurrent);
  concurrent.saveData=async data=>{await namespaceGate;await realSave(data);};
  let resolved=0;const firstNamespace=concurrent.ensureDeviceNamespace().then(id=>{resolved++;return id;}),secondNamespace=concurrent.ensureDeviceNamespace().then(id=>{resolved++;return id;});
  await Promise.resolve();assert.equal(resolved,0);acknowledge();assert.equal(await firstNamespace,await secondNamespace);assert.equal(resolved,2);
  const noCrypto=await plugin(),crypto=context.crypto;context.crypto=undefined;context.localStorage=storage();await noCrypto.loadDevicePerformance(undefined);assert.equal(noCrypto.deviceNamespace,undefined);assert.equal(context.localStorage.rows.size,0);context.crypto=crypto;
  const invalid=await plugin();invalid.deviceNamespace=undefined;invalid.settings.nodeSize=-1;assert.equal(await invalid.ensureDeviceNamespace(),undefined);assert.equal(invalid.deviceNamespace,undefined);
  console.log('PASS concurrent namespace callers await acknowledgement; unavailable randomness and invalid settings never use durable storage');
  const stale=await plugin();stale.settings.performance='quality';await stale.save();const oldLocal=local(stale);let checks=0;
  await assert.rejects(stale.commitPerformance(new Set(['fast']),true,()=>++checks===1));assert.equal(stale.settings.performance,'quality');assert.deepEqual(local(stale),oldLocal);sharedOnly(stale);
  console.log('PASS stale candidate restores both shared and device-local state');

})().catch(e=>{console.error(e);process.exitCode=1;});
