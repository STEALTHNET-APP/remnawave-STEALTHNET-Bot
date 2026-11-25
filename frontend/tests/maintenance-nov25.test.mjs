import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = new URL('../', import.meta.url).pathname;
const cssNames = (await readdir(root+'dist/assets')).filter(n=>n.endsWith('.css'));
const css = (await Promise.all(cssNames.map(n=>readFile(root+'dist/assets/'+n,'utf8')))).join('\n');
const compiled = await build({absWorkingDir:root,tsconfig:root+'tsconfig.app.json',bundle:true,write:false,jsx:'automatic',loader:{'.css':'empty'},
 stdin:{resolveDir:root,loader:'tsx',contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {RivarapaySettings} from './src/components/admin/rivarapay-settings';import {ChatSwitcher} from './src/components/floating-chat';import {checkoutMethods} from './src/lib/checkout-methods';import {paymentLabelHasIcon} from './src/lib/payment-label';function App(){const [settings,setSettings]=useState({publicAppUrl:'https://fixture.invalid/'});const [chat,setChat]=useState('ai');window.paymentLabelHasIcon=paymentLabelHasIcon;window.checkoutMethods=checkoutMethods;return <main style={{maxWidth:760,margin:'20px auto',padding:16}}><form onSubmit={e=>{e.preventDefault();window.saved=settings;window.submits=(window.submits||0)+1}}><RivarapaySettings settings={settings} onChange={patch=>setSettings(s=>({...s,...patch}))} saving={false}/></form><div className="cabinet-floating-chat" style={{marginTop:24,padding:16}}><ChatSwitcher activeChat={chat} setActiveChat={setChat} aiUnread={0} supportUnread={0}/></div><div className="cabinet-chat-toolbar"><div data-tour="floating-chat-button"><button data-fab-icon aria-label="Открыть чат"><svg width="20" height="20"><path d="M2 2h16v12H2z" fill="none" stroke="currentColor"/></svg></button></div></div></main>};createRoot(document.getElementById('root')).render(<App/>);`},
 define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'chat-export',setup(b){b.onLoad({filter:/floating-chat\.tsx$/},async({path})=>({contents:await readFile(path,'utf8')+'\nexport {ChatSwitcher};',loader:'tsx'}));}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?compiled.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body data-cabinet-ui="minimal"><div id="root"></div><script src="/bundle.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const base=`http://127.0.0.1:${server.address().port}`;
try {
 await test('RivaraPay form keeps promo actions separate from saving; mode, keys and franchise reach the form',async()=>{
  const page=await browser.newPage({viewport:{width:1100,height:1050}});await page.goto(base);
  await page.getByText('Ищете платёжную систему?').waitFor();
  assert.equal(await page.getByRole('link',{name:'Хочу подключиться!'}).getAttribute('href'),'https://rivarapay.io');
  await page.getByRole('button',{name:'Скопировать код'}).click();assert.equal(await page.evaluate(()=>window.submits||0),0);
  await page.getByRole('switch',{name:'Включить RivaraPay'}).click();await page.getByRole('switch',{name:'Тестовый режим RivaraPay'}).click();
  await page.getByLabel('API-ключ магазина').fill('test_fixture');await page.getByLabel('Секрет уведомлений').fill('fixture-secret');
  await page.getByText('Данные франшизного магазина',{exact:true}).click();await page.getByLabel('Тип филиала',{exact:true}).fill('telegram');await page.getByLabel('Адрес филиала',{exact:true}).fill('@fixture_bot');await page.getByLabel('Telegram ID владельца',{exact:true}).fill('9000111222');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.saved),{publicAppUrl:'https://fixture.invalid/',rivarapayEnabled:true,rivarapaySandbox:true,rivarapayApiKey:'test_fixture',rivarapayWebhookSecret:'fixture-secret',rivarapayFranchiseType:'telegram',rivarapayFranchiseAddress:'@fixture_bot',rivarapayFranchiseOwnerId:'9000111222'});
  assert.equal(await page.getByLabel('API-ключ магазина').getAttribute('type'),'password');
  await page.close();
 });
 await test('payment labels avoid duplicate icons; RivaraPay respects enable flag, currency and custom label',async()=>{
  const page=await browser.newPage();await page.goto(base);await page.getByText('Ищете платёжную систему?').waitFor();
  assert.deepEqual(await page.evaluate(()=>['₿ Крипта','💳 Карта','СБП'].map(window.paymentLabelHasIcon)),[true,true,false]);
  const lists=await page.evaluate(()=>[window.checkoutMethods({rivarapayEnabled:true,paymentProviders:[{id:'rivarapay',label:'Моя касса'}]},'RUB'),window.checkoutMethods({rivarapayEnabled:true},'USD'),window.checkoutMethods({rivarapayEnabled:false},'RUB')]);
  assert.deepEqual(lists[0].filter(m=>m.id==='rivarapay').map(m=>m.label),['Моя касса']);assert.ok(lists.slice(1).every(a=>!a.some(m=>m.id==='rivarapay')));await page.close();
 });
 await test('light and dark chat tabs select exactly one item and render distinct backgrounds, including mobile',async()=>{
  const page=await browser.newPage();await page.goto(base);await page.getByRole('button',{name:'AI Чат',exact:true}).waitFor();
  for(const dark of [false,true])for(const width of [390,1100]){
   await page.setViewportSize({width,height:1050});await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);
   for(const name of ['Поддержка','AI Чат']){
    await page.getByRole('button',{name,exact:true}).click();
    assert.equal(await page.locator('.cabinet-chat-tabs button[aria-pressed="true"]').count(),1);
    assert.equal(await page.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
    const styles=await page.locator('.cabinet-chat-tabs button').evaluateAll(buttons=>buttons.map(b=>({color:getComputedStyle(b).color,bg:getComputedStyle(b).backgroundColor})));
    assert.notEqual(styles[0].bg,styles[1].bg);assert.notEqual(styles[0].color,styles[1].color);
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.QA_SCREENSHOT_DIR){await mkdir(process.env.QA_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.QA_SCREENSHOT_DIR+'/rivarapay-'+(dark?'dark':'light')+'-'+width+'.png',fullPage:true});}
  }
  await page.close();
 });
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
