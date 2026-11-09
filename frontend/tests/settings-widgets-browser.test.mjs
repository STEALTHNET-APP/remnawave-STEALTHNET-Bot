import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
const playwright=await import(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const root=new URL('../',import.meta.url).pathname;
const fixture=JSON.parse(await readFile(process.env.SETTINGS_FIXTURE_PATH,'utf8'));
const bundle=await build({absWorkingDir:root,tsconfig:root+'tsconfig.app.json',stdin:{resolveDir:root,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import './src/i18n/init';import {AuthProvider} from './src/contexts/auth';import {SettingsPage} from './src/pages/settings';localStorage.setItem('stealthnet_access_token','fixture');localStorage.setItem('stealthnet_admin',JSON.stringify({id:'fixture',email:'review@example.invalid',role:'ADMIN'}));createRoot(document.getElementById('root')).render(<BrowserRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><SettingsPage/></AuthProvider></QueryClientProvider></BrowserRouter>);`},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const cssFiles=(await readdir(root+'dist/assets')).filter(f=>f.endsWith('.css'));
const css=(await Promise.all(cssFiles.map(f=>readFile(root+'dist/assets/'+f,'utf8')))).join('\n');
let saved;
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.url.includes('/settings')){
   if(req.method==='PATCH'||req.method==='PUT'){let data='';for await(const part of req)data+=part;saved=JSON.parse(data);for(const key of ["cispayEnabled","cispayApiKey","cispayShopId","cispaySandbox","botHtmlBubblesTest"])if(key in saved)fixture[key]=saved[key];}
   return res.end(JSON.stringify(fixture));
  }
  if(req.url.includes('/languages'))return res.end(JSON.stringify({ok:true,languages:[{code:'ru',name:'Русский'}]}));
  if(req.url.includes('auto-renew'))return res.end(JSON.stringify({enabled:0,disabled:0,retriesInProgress:0,renewalsLast7Days:0,renewalsLast30Days:0,amountLast30Days:0}));
  if(req.url.includes('/ssh'))return res.end(JSON.stringify({host:'',port:22,username:''}));
  return res.end(JSON.stringify({configured:false,items:[],response:{internalSquads:[]}}));
 }
 res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/styles.css'?'text/css':'text/html');
 res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:req.url==='/styles.css'?css:'<!doctype html><html lang="ru" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body data-admin-ui="modern"><main style="padding:24px;max-width:1600px;margin:auto"><div id="root"></div></main><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await playwright.chromium.launch();

const base=`http://127.0.0.1:${server.address().port}`;
const output=process.env.UI_OUTPUT_DIR;
if(output)await mkdir(output,{recursive:true});
try{
 await test('desktop settings navigation, search and CisPay save preserve form fields',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/admin/settings?tab=payments');
  await page.getByLabel('ID магазина',{exact:true}).fill('00000000-0000-4000-8000-000000000002');
  await page.getByLabel('Секретный API-ключ',{exact:true}).fill('cis_sec_fixture');
  await page.getByRole('switch',{name:'Включить CisPay',exact:true}).click();

  await page.getByLabel('Секретный API-ключ',{exact:true}).press('Enter');
  await page.waitForFunction(()=>document.body.innerText.includes('сохран')||document.body.innerText.includes('Сохран'));
  await page.waitForTimeout(500);
  assert.equal(saved?.cispayEnabled,true);assert.equal(saved?.cispayApiKey,'cis_sec_fixture');assert.equal(saved?.cispayShopId,'00000000-0000-4000-8000-000000000002');
  const search=page.getByRole('searchbox');await search.fill('бот');
  await page.getByRole('navigation').getByRole('button',{name:'Telegram-бот',exact:true}).click();
  await page.getByRole('tab',{name:/Поведение/}).click();
  await page.getByText('htmlbubbles test',{exact:true}).waitFor();
  await search.fill('плат');await page.getByRole('navigation').getByRole('button',{name:'Платёжные системы',exact:true}).click();
  assert.equal(await page.getByLabel('ID магазина',{exact:true}).inputValue(),'00000000-0000-4000-8000-000000000002');
  await page.getByRole('heading',{name:'CisPay',exact:true}).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(output)await page.screenshot({path:output+'/settings-desktop.png'});
  assert.deepEqual(errors,[]);await page.close();
 });
 await test('mobile section chooser and payment fields fit narrow viewport',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/admin/settings?tab=general');
  const select=page.locator('section select').first();await select.selectOption('payments');
  await page.getByLabel('ID магазина',{exact:true}).waitFor();await page.getByRole('heading',{name:'CisPay',exact:true}).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(output)await page.screenshot({path:output+'/settings-mobile.png'});
  await select.selectOption('bot');assert.equal(new URL(page.url()).searchParams.get('tab'),'bot');assert.deepEqual(errors,[]);await page.close();
 });
 await test('widget markup pages actions and sends an opaque query without overflow',async()=>{
  const {buildWidget}=await import('../../bot/dist/widgets.js');
  const widget=buildWidget('Ваша подписка активна. Осталось 23 дня.\nУстройства: 1 из 3.\nБаланс: 260 ₽.',[[{text:'Подключиться',callback_data:'connect:fixture'},{text:'Продлить подписку',callback_data:'renew:fixture'},{text:'Пополнить баланс',callback_data:'topup:fixture'},{text:'Помощь',callback_data:'help:fixture'}]],'STEALTHNET');
  const page=await browser.newPage({viewport:{width:320,height:560}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{window.queries=[];window.TelegramWidget={request:async(token)=>{window.queries.push(token);return {result:'Готово'};},openLink:()=>{},openTelegramLink:()=>{},copyText:()=>{}};});
  await page.setContent(widget.html);
  await page.addStyleTag({content:':root{--tg-theme-text-color:#ededed;--tg-theme-hint-color:#999;--tg-theme-secondary-bg-color:#282828;--tg-theme-button-color:#ff165d;--tg-theme-button-text-color:#fff}body{background:#161616}'});
  await page.getByRole('button',{name:'Подключиться',exact:true}).click();
  const tokens=await page.evaluate(()=>window.queries);assert.equal(widget.actions.get(tokens[0]),'connect:fixture');
  await page.locator('#next').click();await page.getByRole('button',{name:'Помощь',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.body.scrollHeight<=560),true);
  if(output)await page.screenshot({path:output+'/telegram-widget-browser-preview.png'});
  assert.deepEqual(errors,[]);await page.close();
 });
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
