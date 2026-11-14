import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const playwright = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = new URL('../', import.meta.url).pathname;
const bundle = await build({
  absWorkingDir: root, tsconfig: root + 'tsconfig.app.json', bundle: true, write: false, jsx: 'automatic',
  stdin: { resolveDir: root, loader: 'tsx', contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {AuroraPaymentSheet} from './src/components/aurora/aurora-payment-sheet';function App(){const [open,setOpen]=useState(true);return <><div data-testid="state">{open?'open':'closed'}</div><AuroraPaymentSheet open={open} onClose={()=>setOpen(false)} title="Payment" product={{kind:'tariff',tariffId:'t',amount:100,currency:'RUB'}} methods={[{id:'balance',kind:'balance',label:'Balance'}]} payLabel="Pay"/></>};createRoot(document.getElementById('root')).render(<MemoryRouter><App/></MemoryRouter>);` },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'payment-fixtures', setup(b) {
    b.onResolve({ filter: /^@\/contexts\/client-auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    b.onResolve({ filter: /^@\/lib\/cabinet-checkout$/ }, () => ({ path: 'checkout', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'auth'
      ? `export const useClientAuth=()=>({state:{token:'fixture'},refreshProfile:async()=>{}});`
      : `export async function startCheckout(){window.checkoutCalls=(window.checkoutCalls||0)+1;return {balanceApplied:true,message:'Paid'};}` }));
  } }],
});
const server = createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await playwright.chromium.launch();
try {
  await test('balance checkout closes the payment sheet after one successful purchase', async()=>{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button',{name:'Pay',exact:true}).click();
    await page.getByTestId('state').filter({hasText:'closed'}).waitFor();
    assert.equal(await page.evaluate(()=>window.checkoutCalls),1);
    assert.deepEqual(errors,[]);
    await page.close();
  });
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
