const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
let configured='',requests=[];const cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file);
 const m={exports:{}};cache.set(file,m.exports);
 const request=async(url,opts)=>{requests.push({url,body:opts.body});return{ok:false,status:400,statusText:'test',text:async()=>'{}',json:async()=>({})}};
 const req=id=>{
  if(id.includes('payment-description'))return load('src/modules/payment/payment-description.ts');
  if(id.includes('platega-request'))return load('src/modules/platega/platega-request.ts');
  if(id.endsWith('db.js'))return{prisma:{systemSetting:{findUnique:async()=>configured===null?null:{value:configured}}}};
  if(id.includes('get-proxy-url'))return{getProxyUrl:async()=>null};
  if(id.includes('proxy-fetch'))return{proxyFetch:request};
  return require(id);
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:m.exports,require:req,fetch:request,Buffer,URL,URLSearchParams,AbortController,AbortSignal,setTimeout,clearTimeout,console});return m.exports;
}
(async()=>{
 const helper=load('src/modules/payment/payment-description.ts');
 for(const blank of [null,'','  ']){configured=blank;assert.equal(await helper.paymentDescription('Тариф A'),'Тариф A')}
 configured='  Мой сервис  ';assert.equal(await helper.paymentDescription('Тариф A'),'Мой сервис');
 const yoo=load('src/modules/yookassa/yookassa.service.ts');
 const common={shopId:'test',secretKey:'test',amount:100,currency:'RUB',description:'Тариф A',metadata:{payment_id:'p1'},customerEmail:'test@example.com'};
 await yoo.createYookassaPayment({...common,returnUrl:'https://example.com'});
 let body=JSON.parse(requests.at(-1).body);assert.equal(body.description,'Мой сервис');assert.equal(body.receipt.items[0].description,'Тариф A');assert.equal(body.amount.value,'100.00');assert.equal(body.metadata.payment_id,'p1');
 await yoo.createYookassaAutopayment({...common,paymentMethodId:'method'});body=JSON.parse(requests.at(-1).body);assert.equal(body.description,'Мой сервис');assert.equal(body.receipt.items[0].description,'Тариф A');assert.equal(body.payment_method_id,'method');
 await load('src/modules/platega/platega.service.ts').createPlategaTransaction({merchantId:'a',secret:'b'},{amount:100,currency:'RUB',orderId:'p1',paymentMethod:2,description:'Тариф A',returnUrl:'https://example.com',failedUrl:'https://example.com'});body=JSON.parse(requests.at(-1).body);assert.equal(body.description,'Мой сервис');assert.equal(body.payload,'p1');
 await load('src/modules/cryptopay/cryptopay.service.ts').createCryptopayInvoice({config:{apiToken:'test'},amount:'100',description:'Тариф A',payload:'p1'});body=JSON.parse(requests.at(-1).body);assert.equal(body.description,'Мой сервис');assert.equal(body.payload,'p1');
 await load('src/modules/yoomoney/yoomoney.service.ts').requestPayment('test',{to:'wallet',amount_due:100,label:'p1',comment:'Тариф A'});body=new URLSearchParams(requests.at(-1).body);assert.equal(body.get('comment'),'Мой сервис');assert.equal(body.get('label'),'p1');
 await load('src/modules/overpay/overpay.service.ts').createOverpayPayformOrder({config:{apiUrl:'https://example.com',projectId:'test',login:'test',password:'test'},amount:100,currency:'RUB',orderId:'p1',description:'Тариф A'});body=JSON.parse(requests.at(-1).body);assert.equal(body.description,'Мой сервис');assert.equal(body.merchantTransactionId,'p1');
 await load('src/modules/paritypay/paritypay.service.ts').createParitypayPayment({config:{enabled:true,shopId:'test',apiKey:'test',signingSecret:'test'},amount:'100',currency:'RUB',orderId:'p1',description:'Тариф A'});body=JSON.parse(requests.at(-1).body);assert.equal(body.comment,'Мой сервис');assert.equal(body.order_id,'p1');
 console.log('PASS: six providers, recurring payment, fallback, preserved receipt, amounts and correlation IDs; network mocked');
})().catch(e=>{console.error(e);process.exitCode=1});
