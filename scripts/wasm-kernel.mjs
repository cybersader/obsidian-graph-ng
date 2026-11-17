// Original dependency-free byte emitter for two bounded numeric kernels.
// No external compiler, downloaded binary, imports, relaxed SIMD, or fast-math.
const U=n=>{const a=[];do{let b=n&127;n>>>=7;if(n)b|=128;a.push(b);}while(n);return a;};
const S=n=>{const a=[];for(;;){let b=n&127;n>>=7;const end=(n===0&&!(b&64))||(n===-1&&(b&64));a.push(b|(end?0:128));if(end)return a;}};
const bytes=s=>[...new TextEncoder().encode(s)];
const str=s=>[...U(bytes(s).length),...bytes(s)];
const vec=a=>[...U(a.length),...a.flat()];
const types={i32:0x7f,f32:0x7d,f64:0x7c};
const op={add:0x6a,sub:0x6b,mul:0x6c,eq:0x46,ne:0x47,lt:0x48,gt:0x4a,le:0x4c,ge:0x4e,and:0x71,or:0x72,shl:0x74,
 da:0xa0,ds:0xa1,dm:0xa2,dd:0xa3,deq:0x61,dgt:0x64,dlt:0x63,dle:0x65,dge:0x66,dmax:0xa5};
const bin=(name,a,b)=>[...a,...b,op[name]];
const I=n=>[0x41,...S(n)],D=n=>{const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,n,true);return [0x44,...b];};
class Fn {
 constructor(params,locals){this.params=params;this.locals=locals;this.names=[...params,...locals].map(x=>x[0]);this.code=[];}
 get(n){return [0x20,...U(this.names.indexOf(n))];}
 set(n,e){this.code.push(...e,0x21,...U(this.names.indexOf(n)));}
 emit(...a){this.code.push(...a.flat());}
 iff(test,yes,no){this.emit(test,[0x04,0x40]);yes();if(no){this.emit([0x05]);no();}this.emit([0x0b]);}
 loop(test,body){this.emit([0x02,0x40,0x03,0x40],test,[0x45,0x0d,1]);body();this.emit([0x0c,0,0x0b,0x0b]);}
 body(){const b=[...vec(this.locals.map(([,t])=>[1,types[t]])),...this.code,0x0b];return [...U(b.length),...b];}
}
const addr=(base,index,size=4)=>bin('add',base,bin('mul',index,I(size)));
const load=(t,a)=>[...a,{i32:0x28,f32:0x2a,f64:0x2b}[t],t==='f64'?3:2,0,...(t==='f32'?[0xbb]:[])];
const store=(t,a,v)=>[...a,...v,...(t==='f32'?[0xb6]:[]),{i32:0x36,f32:0x38,f64:0x39}[t],t==='f64'?3:2,0];
const sqrt=e=>[...e,0x9f],abs=e=>[...e,0x99];
function repulse(){
 const ps=['p','w','f','owner','child','head','next','cx','cy','half','mass','mx','my','order','radii','mask','n','begin','end'].map(n=>[n,'i32']);ps.push(['scale','f64'],['theta','f64'],['maxRadius','f64']);
 const fn=new Fn(ps,[...['q','i','c','ch','hd'].map(n=>[n,'i32']),...['x','y','m','mm','dx','dy','d2','h','other','d','gap','r','factor','fx','fy','theta2'].map(n=>[n,'f64'])]);
 const g=n=>fn.get(n),set=(n,e)=>fn.set(n,e),B=(o,a,b)=>bin(o,a,b);
 const at=(name,idx,t='f64')=>load(t,addr(g(name),idx,t==='f64'?8:4));
 const position=(lane)=>load('f32',addr(g('p'),B('add',B('mul',g('i'),I(2)),I(lane))));
 const distance=()=>B('da',B('dm',g('dx'),g('dx')),B('dm',g('dy'),g('dy')));
 const soften=(radius)=>{set('d',sqrt(g('d2')));set('gap',B('dmax',B('dm',g('d'),D(.5)),B('ds',B('ds',g('d'),g('r')),radius)));set('d2',B('dm',g('gap'),g('gap')));};
 set('theta2',B('dm',g('theta'),g('theta')));set('q',g('begin'));
 fn.loop(B('lt',g('q'),g('end')),()=>{
  set('i',g('q'));fn.iff(g('order'),()=>set('i',at('order',g('q'),'i32')));
  // Skipping uses an if, so traversal continues have stable loop depth.
  const active=B('or',B('eq',g('mask'),I(0)),[...addr(g('mask'),g('i'),1),0x2d,0,0]);
  fn.iff(active,()=>{
   set('x',position(0));set('y',position(1));set('m',at('w',g('i'),'f32'));set('r',D(0));fn.iff(g('radii'),()=>set('r',at('radii',g('i'),'f32')));
   set('c',I(0));set('fx',D(0));set('fy',D(0));
   fn.loop(B('ge',g('c'),I(0)),()=>{
    set('mm',at('mass',g('c')));
    fn.iff(B('deq',g('mm'),D(0)),()=>{set('c',at('next',g('c'),'i32'));fn.emit([0x0c,1]);});
    set('ch',at('child',g('c'),'i32'));set('hd',at('head',g('c'),'i32'));
    set('dx',B('ds',g('x'),at('mx',g('c'))));set('dy',B('ds',g('y'),at('my',g('c'))));set('d2',distance());
    fn.iff(g('radii'),()=>{set('other',g('maxRadius'));fn.iff(B('and',B('lt',g('ch'),I(0)),B('ge',g('hd'),I(0))),()=>set('other',at('radii',g('hd'),'f32')));soften(g('other'));});
    set('h',at('half',g('c')));
    const contains=B('and',B('dle',abs(B('ds',g('x'),at('cx',g('c')))),g('h')),B('dle',abs(B('ds',g('y'),at('cy',g('c')))),g('h')));
    const opening=B('dge',B('dm',B('dm',D(4),g('h')),g('h')),B('dm',g('theta2'),g('d2')));
    fn.iff(B('and',B('ge',g('ch'),I(0)),B('or',contains,opening)),()=>{set('c',g('ch'));fn.emit([0x0c,1]);});
    fn.iff(B('and',B('lt',g('ch'),I(0)),B('eq',at('owner',g('i'),'i32'),g('c'))),()=>{
      set('other',B('ds',g('mm'),g('m')));
      fn.iff(B('dle',g('other'),D(0)),()=>{set('c',at('next',g('c'),'i32'));fn.emit([0x0c,2]);});
      set('dx',B('dd',B('dm',g('dx'),g('mm')),g('other')));set('dy',B('dd',B('dm',g('dy'),g('mm')),g('other')));set('mm',g('other'));set('d2',distance());fn.iff(g('radii'),()=>soften(g('maxRadius')));
    });
    fn.iff(B('dgt',g('d2'),D(0)),()=>{
     set('factor',B('dd',B('dm',B('dm',g('scale'),g('m')),g('mm')),g('d2')));
     {set('fx',B('da',g('fx'),B('dm',g('dx'),g('factor'))));set('fy',B('da',g('fy'),B('dm',g('dy'),g('factor'))));}
    });set('c',at('next',g('c'),'i32'));
   });
   for(let lane=0;lane<2;lane++)fn.emit(store('f32',addr(g('f'),B('add',B('mul',g('i'),I(2)),I(lane))),g(lane?'fy':'fx')));
  });set('q',B('add',g('q'),I(1)));
 });return fn;
}
// Linear attraction only. LinLog remains JS (Math.log1p has no WASM opcode).
// Every multiply and Float32 read/store follows layout.ts, including self edges.
function attract(){
 const fn=new Fn([...["p","f","s","t","n","w","radii","outbound"].map(n=>[n,"i32"]),["compensation","f64"]],
  [...["e","a","b","aa","bb"].map(n=>[n,"i32"]),...["x","y","distance","factor"].map(n=>[n,"f64"])]);
 const g=n=>fn.get(n),B=(o,a,b)=>bin(o,a,b),set=(n,e)=>fn.set(n,e);
 set('e',I(0));fn.loop(B('lt',g('e'),g('n')),()=>{
  set('a',load('i32',addr(g('s'),g('e'))));set('b',load('i32',addr(g('t'),g('e'))));
  set('aa',B('mul',g('a'),I(8)));set('bb',B('mul',g('b'),I(8)));
  for(let l=0;l<2;l++)set(l?'y':'x',B('ds',load('f32',B('add',g('p'),B('add',g('aa'),I(l*4)))),load('f32',B('add',g('p'),B('add',g('bb'),I(l*4))))));
  set('distance',D(1));
  fn.iff(g('radii'),()=>set('distance',B('ds',sqrt(B('da',B('dm',g('x'),g('x')),B('dm',g('y'),g('y')))),B('da',load('f32',addr(g('radii'),g('a'))),load('f32',addr(g('radii'),g('b')))))));
  fn.iff(B('dgt',g('distance'),D(0)),()=>{
   set('factor',[...g('compensation'),0x9a]);
   fn.iff(g('outbound'),()=>set('factor',B('dd',g('factor'),load('f32',addr(g('w'),g('a'))))));
   for(const side of ['aa','bb'])for(let l=0;l<2;l++){
    const a=B('add',g('f'),B('add',g(side),I(l*4)));
    fn.emit(store('f32',a,B(side==='aa'?'da':'ds',load('f32',a),B('dm',g(l?'y':'x'),g('factor')))));
   }
  });set('e',B('add',g('e'),I(1)));
 });return fn;
}
export function makeWasm(){
 const funcs=[repulse(),attract()];
 const section=(id,body)=>[id,...U(body.length),...body];
 return new Uint8Array([0,97,115,109,1,0,0,0,
 ...section(1,vec(funcs.map(f=>[0x60,...vec(f.params.map(([,t])=>[types[t]])),0]))),
 ...section(3,vec(funcs.map((_,i)=>U(i)))),
 // One initial page, hard maximum 4096 pages (256 MiB). Host sizes once per layout.
 ...section(5,[1,1,...U(1),...U(4096)]),
 ...section(7,vec([ [...str('memory'),2,0], [...str('repulse'),0,0], [...str('attract'),0,1] ])),
 ...section(10,vec(funcs.map(f=>f.body()))) ]);
}

export function generatedSource() {
 const encoded=Buffer.from(makeWasm()).toString('base64');
 return '// Generated by scripts/wasm-kernel.mjs. Do not edit bytes by hand.\nexport const scalarKernelBytes = Uint8Array.from(atob(\''+encoded+'\'), c => c.charCodeAt(0));\n';
}
// No install hooks or binary compiler. node scripts/wasm-kernel.mjs [--check].
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
 const {readFileSync,writeFileSync}=await import('node:fs');
 const file=new URL('../src/core/wasm-kernel-bytes.ts',import.meta.url),source=generatedSource();
 if(process.argv.includes('--check')) {if(readFileSync(file,'utf8')!==source)throw Error('Scalar WASM bytes need regeneration');}
 else writeFileSync(file,source);
}
