import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/modules/cryptopay/cryptopay.service.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
async function run(response) {
 const context = vm.createContext({ AbortController, setTimeout, clearTimeout, console });
 let calls = 0;
 const dependencies = {
  '../payment/payment-description.js': { paymentDescription: async text => text },
  crypto,
  '../proxy-util/get-proxy-url.js': { getProxyUrl: async () => null },
  '../proxy-util/proxy-fetch.js': { proxyFetch: async () => { calls++; return response; } },
 };
 const module = new vm.SourceTextModule(source, { context });
 await module.link(async specifier => {
  const exports = dependencies[specifier];
  const stub = new vm.SyntheticModule(Object.keys(exports), function () { for (const [key,value] of Object.entries(exports)) this.setExport(key,value); }, { context });
  await stub.link(() => {}); await stub.evaluate(); return stub;
 });
 await module.evaluate();
 const result = await module.namespace.createCryptopayInvoice({ config:{apiToken:'fixture-secret'},amount:'100',currencyType:'fiat',fiat:'RUB',description:'Test',payload:'fixture-payment' });
 assert.equal(calls,1);
 return result;
}
test('METHOD_BLOCKED keeps safe diagnostic name and gives a useful client message', async () => {
 const result=await run(Response.json({ok:false,error:{code:423,name:'METHOD_BLOCKED'}},{status:423}));
 assert.equal(result.ok,false);assert.equal(result.status,423);assert.equal(result.providerCode,423);assert.equal(result.providerError,'METHOD_BLOCKED');
 assert.match(result.error,/Выберите другой способ/);assert.doesNotMatch(result.error,/423|METHOD_BLOCKED/);
});
test('unknown provider codes and non-JSON replies do not leak raw provider text',async()=>{
 for(const response of [Response.json({ok:false,error:{code:400,name:'PARAM_AMOUNT_TOO_SMALL'}},{status:400}),Response.json({ok:false,error:{code:'fixture-secret',name:'private details: fixture-secret'}},{status:400}),new Response('private details',{status:502}),Response.json(null,{status:502})]) {
  const result=await run(response);assert.equal(result.ok,false);assert.match(result.error,/Не удалось создать счёт/);assert.doesNotMatch(JSON.stringify(result),/fixture-secret|private details/);
 }
});
test('successful invoice responses retain payment URLs',async()=>{
 const result=await run(Response.json({ok:true,result:{invoice_id:123,bot_invoice_url:'https://t.me/CryptoBot?start=fixture'}}));
 assert.equal(result.ok,true);assert.equal(result.invoiceId,123);assert.equal(result.payUrl,'https://t.me/CryptoBot?start=fixture');
});
