const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
async function test(){
 for(const owner of [true,false])for(const fails of [false,true]){
  let handler,files=0,deleted=0,error;
  const source=fs.readFileSync(require('node:path').join(__dirname,'../src/modules/client/client-tickets.routes.ts'),'utf8');
  const start=source.indexOf('clientTicketsRouter.delete("/tickets/:id"');const block=source.slice(start,source.indexOf('\n});',start)+4);
  vm.runInNewContext(ts.transpileModule(block,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
   clientTicketsRouter:{delete:(_p,h)=>{handler=h;}},ensureTicketsEnabled:async()=>true,
   deleteTickets:async where=>{assert.equal(where.clientId,'client');assert.equal(where.id,'ticket');if(!owner)return 0;if(fails)throw Error('DB failure');deleted++;files++;return 1;},
  });
  let status=200;const res={status(n){status=n;return this;},json(x){return x;}};
  await handler({params:{id:'ticket'},client:{id:'client'}},res,e=>{error=e;});
  assert.equal(status,403);assert.equal(deleted,0);assert.equal(files,0);assert.equal(error,undefined);
 }
 console.log('PASS: clients cannot delete ticket history or attachments');
}
test().catch(e=>{console.error(e);process.exitCode=1;});
