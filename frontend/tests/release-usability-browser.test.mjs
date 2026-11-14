import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = new URL('../', import.meta.url).pathname;
const output = process.env.UI_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const bundle = await build({ absWorkingDir: root, tsconfig: root+'tsconfig.app.json', stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {BrowserRouter,useLocation} from 'react-router-dom'; import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from './src/contexts/auth'; import {ClientAuthProvider} from './src/contexts/client-auth';
import {BotMenuPreview} from './src/components/admin/bot-menu-preview'; import {PanelUpdates} from './src/components/admin/panel-updates';
import {AdminDiagnosticsPage} from './src/pages/admin-diagnostics'; import {useCabinetTariffPurchase} from './src/pages/cabinet/use-cabinet-tariff-purchase';
localStorage.setItem('stealthnet_access_token','fixture');localStorage.setItem('stealthnet_admin',JSON.stringify({id:'fixture',email:'admin@example.invalid',role:'ADMIN'}));
localStorage.setItem('stealthnet_client_token','fixture.'+btoa(JSON.stringify({exp:4102444800}))+'.fixture');localStorage.setItem('stealthnet_client_profile',JSON.stringify({id:'fixture',balance:1000}));
function Purchase(){const p=useCabinetTariffPurchase({autoSelectFirst:true,autoSelectExtended:'tariffOnly',requirePreview:true});const loc=useLocation();return <><p>{loc.search}</p><button disabled={p.loading||!p.previewReady||p.paying} onClick={()=>p.doPay({method:{kind:'balance',label:'Баланс'}})}>Оплатить тест</button>{p.payError&&<p role="alert">{p.payError}</p>}{p.purchaseChoiceDialog}</>}
function Preview(){const [s,setS]=useState({serviceName:'TEST',defaultCurrency:'RUB',publicAppUrl:'https://example.invalid',botButtonsPerRow:2,trialDays:3,trialSquadUuid:'squad',botMenuTexts:{welcomeGreeting:'Привет! ',balancePrefix:'Баланс: ',tariffPrefix:'Тариф: ',subscriptionPrefix:'Подписка: '},botButtons:[{id:'tariffs',label:'Тарифы',visible:true,order:0},{id:'vpn',label:'Подключиться',visible:true,order:1,onePerRow:true},{id:'renew',label:'Продлить',visible:true,order:2},{id:'trial',label:'Попробовать',visible:true,order:3},{id:'gift',label:'Подарки',visible:true,order:4},{id:'roulette',label:'Рулетка',visible:true,order:5}]});return <><label>Название кнопки<input value={s.botButtons[0].label} onChange={e=>setS({...s,botButtons:s.botButtons.map((b,i)=>i===0?{...b,label:e.target.value}:b)})}/></label><BotMenuPreview settings={s}/></>}
function App(){const path=location.pathname;return path.includes('preview')?<Preview/>:path.includes('updates')?<PanelUpdates token="fixture"/>:path.includes('diagnostics')?<AdminDiagnosticsPage/>:<Purchase/>}
createRoot(document.getElementById('root')).render(<BrowserRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><ClientAuthProvider><App/></ClientAuthProvider></AuthProvider></QueryClientProvider></BrowserRouter>);
` }, bundle: true, write: false, jsx: 'automatic', define: {'process.env.NODE_ENV':'"production"'} });
const css=(await Promise.all((await readdir(root+'dist/assets')).filter(f=>f.endsWith('.css')).map(f=>readFile(root+'dist/assets/'+f,'utf8')))).join('\n');
let warn=true, multi=true, failSubs=false, convert=false, trial=false, single=false, payment=[];
const existing=()=>({type:'root',id:'owned',subscriptionIndex:0,tariffId:'plan',tariffDisplayName:'Моя подписка',remnawaveUuid:'uuid',trialId:trial?'trial':null,subscription:{expireAt:'2026-12-31T12:00:00Z'}});
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/public/config')return res.end(JSON.stringify({multiSubscriptionsEnabled:multi,warnBeforeAdditionalSubscription:warn,serviceName:'TEST',defaultCurrency:'RUB'}));
  if(req.url==='/api/public/tariffs')return res.end(JSON.stringify({items:[{id:'category',name:'Категория',singleSubscriptionMode:single,tariffs:[{id:'plan',name:'Стандарт',price:100,currency:'RUB',durationDays:30,priceOptions:[{id:'option',durationDays:30,price:100}]}]}]}));
  if(req.url.includes('/subscription/all')){if(failSubs){res.statusCode=503;return res.end('{"message":"Не удалось проверить подписки"}');}return res.end(JSON.stringify({items:[existing()]}));}
  if(req.url.includes('/tariff-conversion-preview'))return res.end(JSON.stringify({willConvert:convert,mode:convert?'extend':undefined,subscription:convert?{id:'owned'}:undefined}));
  if(req.url.includes('/payments/balance')){let body='';for await(const chunk of req)body+=chunk;payment.push(JSON.parse(body));return res.end('{"message":"Оплачено","paymentId":"test","newBalance":900}');}
  if(req.url==='/api/admin/updates')return res.end(JSON.stringify({connected:true,installed:{version:'7.0.0',commit:'a'.repeat(40)},settings:{enabled:false,channel:'stable',hourUtc:3,backupRetentionDays:3},status:{phase:'failed',message:'Не удалось получить исходники',available:true,version:'7.0.1',operationStartedAt:'2026-11-15T00:00:00Z',operationFinishedAt:'2026-11-15T00:02:30Z',checks:[{name:'Docker и Compose',ok:false,detail:'Docker недоступен'}],events:[{at:'2026-11-15T00:00:00Z',phase:'checking',message:'Проверяем GitHub'},{at:'2026-11-15T00:02:30Z',phase:'failed',message:'Не удалось получить исходники'}]}}));
  if(req.url.includes('/diagnostics/health'))return res.end('{"overallStatus":"ok","checks":[]}');
  if(req.url.includes('/diagnostics/report')){res.setHeader('Content-Type','application/gzip');res.setHeader('Content-Disposition','attachment; filename="stealthnet-diagnostics.json.gz"');return res.end('fixture archive');}
  if(req.url.includes('/client/me'))return res.end('{"id":"fixture","balance":1000}');
  return res.end('{"items":[],"configured":false}');
 }
 res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/styles.css'?'text/css':'text/html');
 res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:req.url==='/styles.css'?css:'<!doctype html><html lang="ru" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main style="padding:20px;max-width:900px;margin:auto"><div id="root"></div></main><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();const base=`http://127.0.0.1:${server.address().port}`;
try {
 await test('menu preview updates draft, respects state and disabled features on mobile',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(base+'/preview');
  const preview=page.getByRole('complementary');await preview.getByRole('button',{name:'Подключиться',exact:true}).waitFor();
  assert.equal(await preview.getByRole('button',{name:'Подарки',exact:true}).count(),0);
  await page.getByLabel('Состояние клиента').selectOption('new');await preview.getByRole('button',{name:'Попробовать',exact:true}).waitFor();
  assert.equal(await preview.getByRole('button',{name:'Подключиться',exact:true}).count(),0);
  await page.getByLabel('Состояние клиента').selectOption('trial-used');assert.equal(await preview.getByRole('button',{name:'Попробовать',exact:true}).count(),0);
  await page.getByLabel('Название кнопки').fill('Выбрать тариф');await preview.getByRole('button',{name:'Выбрать тариф',exact:true}).waitFor();
  await page.getByLabel('Вид меню').selectOption('widget');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(output)await page.screenshot({path:output+'/bot-preview-mobile.png',fullPage:true});await page.close();
 });
 await test('existing subscription requires choice before a payment and new means asAdditional',async()=>{
  const page=await browser.newPage();await page.goto(base+'/cabinet/tariffs');await page.getByRole('button',{name:'Оплатить тест'}).click();
  await page.getByRole('dialog').waitFor();assert.equal(payment.length,0);
  if(output)await page.screenshot({path:output+'/purchase-choice.png'});
  await page.getByRole('button',{name:'Создать отдельную подписку',exact:true}).click();await page.waitForURL('**/cabinet/dashboard?paid=balance');
  assert.equal(payment.length,1);assert.equal(payment[0].asAdditional,true);assert.equal(payment[0].extendsSecondarySubId,undefined);await page.close();
 });
 await test('renew choice targets existing subscription and does not create a parallel one',async()=>{
  payment=[];const page=await browser.newPage();await page.goto(base+'/cabinet/tariffs');await page.getByRole('button',{name:'Оплатить тест'}).click();await page.getByRole('button',{name:'Продлить',exact:true}).click();
  await page.waitForURL('**/cabinet/tariffs?extend=owned');await page.getByRole('button',{name:'Оплатить тест'}).click();await page.waitForURL('**/cabinet/dashboard?paid=balance');assert.equal(payment[0].extendsSecondarySubId,'owned');assert.notEqual(payment[0].asAdditional,true);await page.close();
 });
 await test('disabled warning, single subscription and trial conversion do not show duplicate dialog',async()=>{
  for(const kind of ['disabled','single','trial']){
   payment=[];warn=kind!=='disabled';multi=kind!=='single';trial=kind==='trial';convert=kind==='trial';
   const page=await browser.newPage();await page.goto(base+'/cabinet/tariffs');await page.getByRole('button',{name:'Оплатить тест'}).click();await page.waitForURL('**/cabinet/dashboard?paid=balance');assert.equal(payment.length,1);assert.equal(await page.getByRole('dialog').count(),0);await page.close();
  }
  warn=true;multi=true;trial=false;convert=false;
 });
 await test('subscription lookup failure creates no payment',async()=>{
  payment=[];failSubs=true;const page=await browser.newPage();await page.goto(base+'/cabinet/tariffs');await page.getByRole('button',{name:'Оплатить тест'}).click();await page.getByRole('alert').waitFor();assert.equal(payment.length,0);failSubs=false;await page.close();
 });
 await test('update panel shows checks, elapsed time, safe failure and event journal',async()=>{
  const page=await browser.newPage({viewport:{width:1200,height:900}});await page.goto(base+'/updates');await page.getByText('Время операции: 2 мин 30 сек').waitFor();await page.getByText('Установка не началась. Текущая версия продолжает работать.').waitFor();assert.equal(await page.getByRole('button',{name:'Обновить сейчас',exact:true}).isDisabled(),true);await page.getByText('Журнал этапов (2)').click();await page.getByText('Проверяем GitHub', {exact:true}).waitFor();if(output)await page.screenshot({path:output+'/updates.png',fullPage:true});await page.close();
 });
 await test('diagnostic download needs an explicit click after composition preview',async()=>{
  const page=await browser.newPage();await page.goto(base+'/diagnostics');await page.getByRole('button',{name:'Скачать отчёт для поддержки'}).click();await page.getByRole('dialog').waitFor();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать архив',exact:true}).click();assert.equal((await download).suggestedFilename(),'stealthnet-diagnostics.json.gz');await page.close();
 });
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
