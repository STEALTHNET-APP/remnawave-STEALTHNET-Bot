import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'grammy';
process.env.API_URL = 'https://api.invalid';
const { registerCloudPaymentsFlow, showCloudCheckout, clearCloudEmail } = await import('../dist/cloudpayments-flow.js');
const quote = { product: 'Личный', amount: 1, currency: 'RUB', recurring: true, requiredRecurring: true, terms: '1 ₽ сейчас, затем 300 ₽ каждые 30 дней', receiptRequired: true, revision: '1234567890abcdef' };
let id = 1;
const user = { id: 123, is_bot: false, first_name: 'Test' };
function update(text, data) {
 const message = { message_id: ++id, date: 1, chat: { id: 123, type: 'private' }, from: user, ...(text ? {text,entities:text.startsWith('/')?[{type:'bot_command',offset:0,length:text.length}]:[]} : {}) };
 return { update_id: id, ...(data ? { callback_query: { id:String(id),from:user,chat_instance:'test',data,message } } : {message}) };
}
test('bot collects receipt email after explicit consent and supports confirmed cancellation without the cabinet', async () => {
 const requests=[], replies=[]; const original=globalThis.fetch;
 globalThis.fetch = async (url, opts) => {
  const body=opts.body?JSON.parse(opts.body):null;requests.push({url:String(url),body});
  let result=quote;
  if(String(url).endsWith('/hosted'))result={payUrl:'https://orders.cloudpayments.ru/d/test'};
  if(String(url).endsWith('/subscriptions'))result={subscriptions:[{id:'agreement',state:'ACTIVE',amount:300,currency:'RUB',periodDays:30,trialEndsAt:'2030-01-01',nextChargeAt:'2030-01-01'}]};
  if(String(url).endsWith('/cancel'))result={ok:true};
  return new Response(JSON.stringify(result),{status:200});
 };
 const bot=new Bot('123:test',{botInfo:{id:456,is_bot:true,first_name:'Test',username:'test_bot',can_join_groups:false,can_read_all_group_messages:false,supports_inline_queries:false}});
 bot.api.config.use(async(_prev,method,payload)=>{if(method==='sendMessage')replies.push(payload);return {ok:true,result:method==='sendMessage'?{message_id:id,chat:{id:123,type:'private'},date:1,text:payload.text}:true};});
 registerCloudPaymentsFlow(bot,async()=> 'test-client');
 try {
  await showCloudCheckout({reply:async(text,opts)=>replies.push({text,...opts})},'test-client',{paymentId:'cm123456789012345678901234',payUrl:'https://local.invalid'},true);
  const button=replies.at(-1).reply_markup.inline_keyboard[0][0];
  assert(Buffer.byteLength(button.callback_data)<=64);assert.match(replies.at(-1).text,/300/);
  assert(!replies.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.url));
  await bot.handleUpdate(update(null,button.callback_data));
  assert.equal(requests.filter(r=>r.url.endsWith('/hosted')).length,0);
  await bot.handleUpdate(update('bad-email'));assert.match(replies.at(-1).text,/Проверьте email/);
  await bot.handleUpdate(update('buyer@example.org'));
  const created=requests.find(r=>r.url.endsWith('/hosted'));assert.equal(created.body.recurring,true);assert.equal(created.body.email,'buyer@example.org');
  assert.equal(replies.at(-1).reply_markup.inline_keyboard[0][0].url,'https://orders.cloudpayments.ru/d/test');
  await bot.handleUpdate(update('/autopay'));
  await bot.handleUpdate(update(null,'cp:cancel:agreement'));
  assert.match(replies.at(-1).text,/сразу/);assert.equal(requests.filter(r=>r.url.endsWith('/cancel')).length,0);
  await bot.handleUpdate(update(null,'cp:stop:agreement'));assert.equal(requests.filter(r=>r.url.endsWith('/cancel')).length,1);
  await bot.handleUpdate(update(null,button.callback_data));clearCloudEmail(user.id);
  const before=requests.length;await bot.handleUpdate(update('should-not-be-used@example.org'));assert.equal(requests.length,before);
 } finally {globalThis.fetch=original;clearCloudEmail(user.id);}
});
