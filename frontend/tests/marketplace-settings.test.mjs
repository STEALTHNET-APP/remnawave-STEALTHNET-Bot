import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = new URL('../', import.meta.url).pathname;
const bundle = await build({absWorkingDir:root,tsconfig:root+'tsconfig.app.json',bundle:true,write:false,jsx:'automatic',
 stdin:{resolveDir:root,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {MarketplaceSettingsCard} from './src/pages/marketplace/marketplace-settings-card';createRoot(document.getElementById('root')).render(<MemoryRouter><form onSubmit={e=>{e.preventDefault();window.outerSubmits=(window.outerSubmits||0)+1}}><MarketplaceSettingsCard/></form></MemoryRouter>);`},
 define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/^@\/contexts\/auth$/},()=>({path:'auth',namespace:'fixture'}));
 b.onResolve({filter:/^react-i18next$/},()=>({path:'i18n',namespace:'fixture'}));
 b.onResolve({filter:/^@\/lib\/api$/},()=>({path:'api',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='auth'?`export const useAuth=()=>({state:{accessToken:'fixture'}});`:path==='i18n'?`export const useTranslation=()=>({t:key=>key});`:`export const api={marketplaceStatus:async()=>{if(location.search.includes('offline'))throw new Error('offline');return {enabled:localStorage.getItem('enabled')!=='false',role:'client'}},marketplaceUpdateSettings:async(_,s)=>localStorage.setItem('enabled',String(s.enabled))};`}));
 }}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();
try {
 await test('marketplace stays disabled on reload, can be reenabled and never submits the parent form',async()=>{
  const page=await browser.newPage(),url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const toggle=page.getByRole('switch'),save=page.getByRole('button',{name:'admin.marketplace.settings.save',exact:true});
  await toggle.click();await save.click();
  await page.waitForFunction(()=>localStorage.getItem('enabled')==='false');
  assert.equal(await page.evaluate(()=>window.outerSubmits||0),0);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('[role="switch"]')?.disabled===false);
  assert.equal(await toggle.getAttribute('aria-checked'),'false');
  assert.equal(await page.getByRole('button',{name:'admin.marketplace.settings.connect_now',exact:true}).isDisabled(),true);
  await toggle.click();await save.click();
  await page.waitForFunction(()=>localStorage.getItem('enabled')==='true');
  await page.goto(url+'?offline');await page.getByText('offline',{exact:true}).waitFor();
  assert.equal(await toggle.isDisabled(),true);assert.equal(await save.isDisabled(),true);
  await page.close();
 });
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
