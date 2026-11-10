import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { DEFAULT_DESIGN } from '../src/lib/cabinet-design.ts';
import { designCss } from '../src/lib/cabinet-design-style.ts';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = new URL('../', import.meta.url).pathname;
const bundle = await build({
  absWorkingDir: root, tsconfig: root + 'tsconfig.app.json', bundle: true, write: false, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'fixture-data', setup(build) {
    build.onLoad({ filter: /\/contexts\/client-auth\.tsx$/ }, () => ({ contents: `export const useClientAuth=()=>({state:{token:'fixture',client:{balance:25,telegramUsername:'fixture',preferredCurrency:'rub'}},refreshProfile:async()=>{}});`, loader: 'tsx' }));
    build.onLoad({ filter: /\/contexts\/cabinet-config\.tsx$/ }, () => ({ contents: `export const useCabinetConfig=()=>({rouletteEnabled:false,multiSubscriptionsEnabled:false});`, loader: 'tsx' }));
    build.onLoad({ filter: /\/lib\/api\.ts$/ }, () => ({ contents: `export const api=new Proxy({}, {get:(_,name)=>async()=>name==='clientAllSubscriptions'?{items:[{id:'fixture',type:'root',trialId:'trial',customName:'Пробная 1',subscriptionIndex:0,subscription:{status:'EXPIRED',expireAt:'2026-10-22T15:21:00Z',hwidDeviceLimit:3,trafficLimitBytes:5368709120,subscriptionUrl:'https://example.invalid/fixture'}}]}:{items:[]}});`, loader: 'ts' }));
  } }],
  stdin: { resolveDir: root, loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import './src/i18n/init';import {AuroraDashboard} from './src/pages/cabinet/aurora/aurora-dashboard';import {AuroraTabs} from './src/components/aurora/aurora-tabs';createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={["/cabinet/dashboard"]}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><div className="au-client" data-au-theme="dark"><main className="au-content"><AuroraDashboard/></main><AuroraTabs/></div></QueryClientProvider></MemoryRouter>);` },
});
const css = (await Promise.all((await readdir(root + 'dist/assets')).filter(f => f.endsWith('.css')).map(f => readFile(root + 'dist/assets/' + f, 'utf8')))).join('\n');
const browser = await chromium.launch();
try {
  for (const mode of ['dark', 'light']) {
    await test(`Aurora subscription, balance and active navigation honor ${mode} admin contrast`, async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const design = structuredClone(DEFAULT_DESIGN);
      design.dark.accent = '#eeece8';
      await page.route('http://aurora-fixture.invalid/', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${mode}" data-au-active="1"><meta charset="utf-8"><body data-cabinet-design="custom"><div id="root"></div></body></html>` }));
      await page.goto('http://aurora-fixture.invalid/');
      await page.addStyleTag({ content: css + '\n' + designCss(design, mode, 'body[data-cabinet-design="custom"]') });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByText('Пробная 1', { exact: true }).waitFor({ timeout: 10000 }).catch(error => { throw new Error(error.message + '\n' + errors.join('\n')); });
      const result = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const rgba = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v); };
        const composite = (over, under) => over.slice(0, 3).map((v, i) => v * over[3] + under[i] * (1 - over[3])).concat(1);
        const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
        const background = element => {
          if (!element) return [255, 255, 255, 1];
          const style = getComputedStyle(element);
          let color = rgba(style.backgroundColor);
          if (style.backgroundImage !== 'none') color = rgba(style.getPropertyValue('--au-from').trim());
          return composite(color, background(element.parentElement));
        };
        const hero = document.querySelector('.au-hero');
        const nodes = [...hero.querySelectorAll('*')].filter(el => [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()));
        nodes.push([...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Пополнить'));
        const activeTab = document.querySelector('.au-nav [aria-current=page]');
        const activeIcon = activeTab.querySelector('svg');
        const pill = activeIcon.previousElementSibling;
        const tabContrast = ratio(rgba(getComputedStyle(activeIcon).color), background(pill));
        return { tabContrast, activeTab: activeTab.getAttribute('href'), accent: getComputedStyle(hero).getPropertyValue('--au-from').trim(), nodes: nodes.map(el => ({ text: el.textContent.trim(), contrast: ratio(rgba(getComputedStyle(el).color), background(el)) })) };
      });
      assert.equal(result.accent, design[mode].accent);
      assert.equal(result.activeTab, '/cabinet/dashboard');
      assert.ok(result.tabContrast >= 4.5, `${mode}: active tab icon contrast ${result.tabContrast.toFixed(2)}`);
      assert.ok(result.nodes.some(node => node.text === 'Пополнить'));
      assert.ok(result.nodes.some(node => /Подключиться/.test(node.text)));
      assert.ok(result.nodes.some(node => /Продлить/.test(node.text)));
      assert.ok(result.nodes.length >= 10);
      for (const node of result.nodes) assert.ok(node.contrast >= 4.5, `${mode}: ${node.text} contrast ${node.contrast.toFixed(2)}`);
      assert.deepEqual(errors, []);
      await page.close();
    });
  }
} finally {
  await browser.close();
}
