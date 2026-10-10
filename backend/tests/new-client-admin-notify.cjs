// Source guard: every prisma.client.create in client.routes.ts must be followed by exactly one
// notifyAdminsAboutNewClient(client.id) before the handler responds (issue #199).
const fs=require('node:fs'),assert=require('node:assert/strict');
const files=['src/modules/client/client.routes.ts','src/modules/api-keys/external-api.routes.ts'];
let creates=0;
for(const f of files){
 const src=fs.readFileSync(f,'utf8');
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
