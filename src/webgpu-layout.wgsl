struct Cell { bounds:vec4f, moment:vec4f, links:vec4i }
struct Params { n:u32, cells:u32, scaling:f32, theta2:f32, maxRadius:f32, adjust:u32, gravity:f32, slowdown:f32, strong:u32, linlog:u32, groups:u32, mode:u32, threshold:f32, moved:f32, pad:vec2f }
// --- module ---
@group(0) @binding(0) var<storage,read> nodes:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> keys:array<vec2u>;
@group(0) @binding(2) var<storage,read_write> cells:array<Cell>;
@group(0) @binding(3) var<storage,read_write> parents:array<i32>;
@group(0) @binding(4) var<storage,read_write> ropes:array<i32>;
@group(0) @binding(5) var<storage,read_write> bounds:array<vec4f>;
@group(0) @binding(6) var<uniform> p:Params;
var<workgroup> bs:array<vec4f,256>;var<workgroup> ms:array<vec4f,64>;
@compute @workgroup_size(256) fn boundPart(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) group:vec3u){
 var a=vec4f(1e30,1e30,-1e30,-1e30);if(gid.x<p.n){let v=nodes[gid.x].xy;a=vec4f(v,v);}bs[lid.x]=a;workgroupBarrier();for(var s=128u;s>0;s/=2){if(lid.x<s){let b=bs[lid.x+s];bs[lid.x]=vec4f(min(bs[lid.x].xy,b.xy),max(bs[lid.x].zw,b.zw));}workgroupBarrier();}if(lid.x==0){bounds[group.x]=bs[0];}}
@compute @workgroup_size(256) fn boundFinal(@builtin(local_invocation_id) lid:vec3u){var a=vec4f(1e30,1e30,-1e30,-1e30);for(var i=lid.x;i<p.groups;i+=256){let b=bounds[i];a=vec4f(min(a.xy,b.xy),max(a.zw,b.zw));}bs[lid.x]=a;workgroupBarrier();for(var s=128u;s>0;s/=2){if(lid.x<s){let b=bs[lid.x+s];bs[lid.x]=vec4f(min(bs[lid.x].xy,b.xy),max(bs[lid.x].zw,b.zw));}workgroupBarrier();}if(lid.x==0){bounds[p.groups]=bs[0];}}
fn spread(v:u32)->u32{var x=v&65535u;x=(x|(x<<8))&0x00ff00ffu;x=(x|(x<<4))&0x0f0f0f0fu;x=(x|(x<<2))&0x33333333u;return (x|(x<<1))&0x55555555u;}
// Quantize in the same square as the Processor quadtree. Independent axis scaling
// changes quadrants on elongated graphs.
@compute @workgroup_size(256) fn makeKeys(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=p.n){return;}let b=bounds[p.groups];let side=max(max(b.z-b.x,b.w-b.y),1e-6);let normalized=(nodes[i].xy-(b.xy+b.zw)*.5)/side+.5;let xy=vec2u(clamp(normalized*65536.,vec2f(0),vec2f(65535)));keys[i]=vec2u(spread(xy.x)|(spread(xy.y)<<1),i);}
fn delta(i:i32,j:i32)->i32{if(j<0||j>=i32(p.n)){return -1;}let x=keys[i].x^keys[j].x;if(x==0){return 32+i32(countLeadingZeros(u32(i)^u32(j)));}return i32(countLeadingZeros(x));}
@compute @workgroup_size(256) fn leaves(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=p.n){return;}let n=nodes[keys[i].y];cells[p.n-1+i]=Cell(vec4f(n.xy,n.xy),vec4f(n.xy,n.z,1),vec4i(-1,-1,i32(i),i32(i)));}
@compute @workgroup_size(256) fn topology(@builtin(global_invocation_id) gid:vec3u){let i=i32(gid.x);if(i>=i32(p.n)-1){return;}if(i==0){parents[0]=-1;}let direction=select(-1,1,delta(i,i+1)>delta(i,i-1));let minimum=delta(i,i-direction);var maximum=2;for(var b=0;b<32;b++){if(delta(i,i+maximum*direction)<=minimum){break;}maximum*=2;}var length=0;var t=maximum/2;loop{if(t<1){break;}if(delta(i,i+(length+t)*direction)>minimum){length+=t;}t/=2;}let j=i+length*direction;let prefixLength=delta(i,j);var split=0;t=(length+1)/2;loop{if(delta(i,i+(split+t)*direction)>prefixLength){split+=t;}if(t<=1){break;}t=(t+1)/2;}let middle=i+split*direction+min(direction,0);let first=min(i,j);let last=max(i,j);let left=select(middle,i32(p.n)-1+middle,first==middle);let right=select(middle+1,i32(p.n)+middle,last==middle+1);cells[i].links=vec4i(left,right,first,last);parents[left]=i;parents[right]=i;}
// Two Morton prefix bits define one square quadtree level. Odd-length prefixes
// are binary half-cells: open them instead of approximating their occupied AABB.
@compute @workgroup_size(64) fn aggregate(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lid:vec3u){let c=group.x;if(c>=p.n-1){return;}let range=cells[c].links.zw;var m=vec4f(0);for(var q=u32(range.x)+lid.x;q<=u32(range.y);q+=64){let v=nodes[keys[q].y];m+=vec4f(v.xy*v.z,v.z,0);}ms[lid.x]=m;workgroupBarrier();for(var s=32u;s>0;s/=2){if(lid.x<s){ms[lid.x]+=ms[lid.x+s];}workgroupBarrier();}if(lid.x==0){let b0=bounds[p.groups];let side=max(max(b0.z-b0.x,b0.w-b0.y),1e-6);let bits=countLeadingZeros(keys[range.x].x^keys[range.y].x);cells[c].bounds.x=select(side/f32(1u<<(bits/2)),1e30,(bits&1u)!=0u);cells[c].moment=vec4f(ms[0].xy/ms[0].z,ms[0].z,select(0.,1.,keys[range.x].x==keys[range.y].x));}}
@compute @workgroup_size(256) fn thread(@builtin(global_invocation_id) gid:vec3u){let start=i32(gid.x);if(start>=i32(2*p.n-1)){return;}var c=start;var escape=-1;for(var depth=0;depth<66;depth++){let parent=parents[c];if(parent<0){break;}let link=cells[parent].links;if(link.x==c){escape=link.y;break;}c=parent;}ropes[start]=escape;}
// --- module ---
override SHIFT:u32=0u;
@group(0) @binding(0) var<storage,read> inputKeys:array<vec2u>;
@group(0) @binding(1) var<storage,read_write> outputKeys:array<vec2u>;
@group(0) @binding(2) var<storage,read_write> histogram:array<u32>;
@group(0) @binding(3) var<storage,read_write> prefix:array<u32>;
@group(0) @binding(4) var<uniform> p:Params;
var<workgroup> counts:array<atomic<u32>,16>;var<workgroup> digit:array<u32,256>;
@compute @workgroup_size(256) fn hist(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) group:vec3u){if(lid.x<16){atomicStore(&counts[lid.x],0);}workgroupBarrier();if(gid.x<p.n){atomicAdd(&counts[(inputKeys[gid.x].x>>SHIFT)&15u],1);}workgroupBarrier();if(lid.x<16){histogram[group.x*16+lid.x]=atomicLoad(&counts[lid.x]);}}
@compute @workgroup_size(16) fn scan(@builtin(local_invocation_id) lid:vec3u){let bin=lid.x;var base=0u;for(var previous=0u;previous<bin;previous++){for(var group=0u;group<p.groups;group++){base+=histogram[group*16+previous];}}for(var group=0u;group<p.groups;group++){prefix[group*16+bin]=base;base+=histogram[group*16+bin];}}
@compute @workgroup_size(256) fn scatter(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) group:vec3u){var key=vec2u(0);if(gid.x<p.n){key=inputKeys[gid.x];}let bin=(key.x>>SHIFT)&15u;digit[lid.x]=bin;workgroupBarrier();if(gid.x>=p.n){return;}var rank=0u;for(var i=0u;i<lid.x;i++){rank+=select(0u,1u,digit[i]==bin);}outputKeys[prefix[group.x*16+bin]+rank]=key;}
// --- module ---
@group(0) @binding(0) var<storage,read> nodes:array<vec4f>;
@group(0) @binding(1) var<storage,read> cells:array<Cell>;
@group(0) @binding(2) var<storage,read> keys:array<vec2u>;
@group(0) @binding(3) var<storage,read> ropes:array<i32>;
@group(0) @binding(4) var<storage,read_write> forces:array<vec2f>;
@group(0) @binding(5) var<uniform> p:Params;
@compute @workgroup_size(64) fn force(@builtin(global_invocation_id) gid:vec3u){let q=gid.x;if(q>=p.n){return;}let i=keys[q].y;let node=nodes[i];var c=0;var f=vec2f(0);for(var visits=0u;visits<p.cells&&c>=0;visits++){let cell=cells[c];var mass=cell.moment.z;if(mass<=0){c=ropes[c];continue;}let leaf=cell.links.x<0||cell.moment.w>0.;var center=cell.moment.xy;var radius=p.maxRadius;
 if(leaf&&cell.links.z==cell.links.w){radius=nodes[keys[cell.links.z].y].w;}
 var delta=node.xy-center;var d2=dot(delta,delta);if(p.adjust!=0u){let d=sqrt(d2);let gap=max(d*.5,d-node.w-radius);d2=gap*gap;}
 let contains=i32(q)>=cell.links.z&&i32(q)<=cell.links.w;
 let width=cell.bounds.x;if(!leaf&&(contains||width*width>=p.theta2*d2)){c=cell.links.x;continue;}
 if(leaf&&contains){let other=mass-node.z;if(other<=0){c=ropes[c];continue;}center=(center*mass-node.xy*node.z)/other;delta=node.xy-center;mass=other;d2=dot(delta,delta);if(p.adjust!=0u){let d=sqrt(d2);let gap=max(d*.5,d-node.w-p.maxRadius);d2=gap*gap;}}
 if(d2>0){f+=delta*(p.scaling*node.z*mass/d2);}c=ropes[c];}forces[i]=f;}
// --- module ---
struct Neighbor { other:u32, coefficient:f32, hub:f32, linear:u32 }
@group(0) @binding(0) var<storage,read> nodes:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> next:array<vec4f>;
@group(0) @binding(2) var<storage,read> forces:array<vec2f>;
@group(0) @binding(3) var<storage,read_write> history:array<vec4f>;
@group(0) @binding(4) var<storage,read> offsets:array<u32>;
@group(0) @binding(5) var<storage,read> neighbours:array<Neighbor>;
@group(0) @binding(6) var<uniform> p:Params;
@group(0) @binding(7) var<storage,read> movable:array<u32>;
@compute @workgroup_size(128) fn integrate(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=p.n){return;}let node=nodes[i];if(movable[i]==0u){next[i]=node;history[i].w=0.;return;}var force=forces[i];let r=length(node.xy);if(r>0){force-=node.xy*(p.gravity*node.z/select(r,1.,p.strong!=0u));}
 for(var j=offsets[i];j<offsets[i+1];j++){let e=neighbours[j];let v=nodes[e.other];let delta=node.xy-v.xy;var distance=length(delta);if(p.adjust!=0u){distance-=node.w+v.w;}if(!((p.adjust!=0u||p.linlog!=0u)&&distance<=0)){var factor=e.coefficient;if(p.linlog!=0u&&e.linear==0u){factor*=log(1.+distance)/distance;}force+=delta*factor;}force-=delta*e.hub;}
 let old=history[i];let swing=node.z*length(old.xy-force);let traction=length(old.xy+force)*.5;let root=sqrt(swing);var convergence=old.z;if(p.adjust!=0u&&convergence==0){convergence=1.;}var speed=convergence*log(1.+traction)/(1.+root);let nextConvergence=min(1.,sqrt(speed*dot(force,force)/(1.+root)));if(p.adjust!=0u){speed*=.3;}let position=node.xy+force*speed/p.slowdown;next[i]=vec4f(position,node.zw);history[i]=vec4f(force,nextConvergence,dot(position-node.xy,position-node.xy));}
// --- module ---
@group(0) @binding(0) var<storage,read> nodes:array<vec4f>;
@group(0) @binding(1) var<storage,read> history:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> reductions:array<vec2f>;
@group(0) @binding(3) var<storage,read_write> status:array<vec4f>;
@group(0) @binding(4) var<uniform> p:Params;
var<workgroup> sums:array<vec2f,256>;
@compute @workgroup_size(256) fn part(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) group:vec3u){var v=vec2f(0);if(gid.x<p.n){v=vec2f(history[gid.x].w,dot(nodes[gid.x].xy,nodes[gid.x].xy));}sums[lid.x]=v;workgroupBarrier();for(var s=128u;s>0;s/=2){if(lid.x<s){sums[lid.x]+=sums[lid.x+s];}workgroupBarrier();}if(lid.x==0){reductions[group.x]=sums[0];}}
@compute @workgroup_size(256) fn reduceStatus(@builtin(local_invocation_id) lid:vec3u){var v=vec2f(0);for(var i=lid.x;i<p.groups;i+=256){v+=reductions[i];}sums[lid.x]=v;workgroupBarrier();for(var s=128u;s>0;s/=2){if(lid.x<s){sums[lid.x]+=sums[lid.x+s];}workgroupBarrier();}if(lid.x==0){let movement=sqrt(sums[0].x/max(1.,p.moved));let extent=sqrt(sums[0].y/f32(p.n));let quiet=select(movement*p.slowdown/select(1.,.3,p.adjust!=0u)<=.002*extent,movement<=p.threshold,p.threshold>0.);status[0]=vec4f(status[0].x+1,select(0.,status[0].y+1,quiet),movement,extent);}}
