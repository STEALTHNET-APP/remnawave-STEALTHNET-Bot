// Source guard: every prisma.client.create in client.routes.ts must be followed by exactly one
// notifyAdminsAboutNewClient(client.id) before the handler responds (issue #199).
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
// This source guard follows successful creation. Responses inside catch blocks
// handle a failed create (for example a duplicate email), which must not notify.
function successfulPathSource(src,file){
 const tree=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true);
 const catches=[];
 function visit(node){
  if(ts.isCatchClause(node)){
   catches.push([node.getStart(tree),node.end]);
   return;
  }
  ts.forEachChild(node,visit);
 }
 visit(tree);
 for(const [start,end] of catches.reverse()){
  src=src.slice(0,start)+src.slice(start,end).replace(/[^\n]/g,' ')+src.slice(end);
 }
 return src;
}
const files=['src/modules/client/client.routes.ts','src/modules/api-keys/external-api.routes.ts'];
let creates=0;
for(const f of files){
 const src=successfulPathSource(fs.readFileSync(f,'utf8'),f);
 const parts=src.split(/prisma\.client\.create\(/).slice(1);
 parts.forEach((rest,i)=>{
  creates++;
  const end=rest.search(/return res\.(status\(\d+\)\.)?json/);
  assert.ok(end>0,`${f} create #${i}: no response found`);
  const n=(rest.slice(0,end).match(/notifyAdminsAboutNewClient\(client\.id\)/g)||[]).length;
  assert.equal(n,1,`${f} create #${i}: expected 1 notify, got ${n}`);
 });
}
assert.equal(creates,8);
console.log('PASS: all',creates,'client creation paths notify admins exactly once');
