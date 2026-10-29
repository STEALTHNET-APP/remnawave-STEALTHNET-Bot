import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const settings = new Map();
mock.module('../dist/db.js', {namedExports:{prisma:{
  systemSetting:{
    findMany:async ({where})=>[...settings].filter(([key])=>where.key.in.includes(key)).map(([key,value])=>({key,value})),
    upsert:async ({where,create,update})=>settings.set(where.key,settings.has(where.key)?update.value:create.value),
  },
  proxyTariff:{count:async()=>0},
  singboxTariff:{count:async()=>0},
}}});
mock.module('../dist/config/index.js',{namedExports:{env:{}}});
mock.module('../dist/modules/remna/remna.client.js',{namedExports:{setRemnaRuntimeConfig:()=>{},remnaGetUser:async()=>({}),remnaUpdateUser:async()=>({})}});
mock.module('../dist/modules/bot/bot.service.js',{namedExports:{applyMarkup:value=>value}});
const {getPublicConfig,invalidateSystemConfigCache}=await import('../dist/modules/client/client.service.js');
const {updateRouletteSettings}=await import('../dist/modules/roulette/roulette.service.js');

test('public cabinet config honors a disabled roulette and refreshes after administrator changes',async()=>{
  settings.clear();
  invalidateSystemConfigCache();
  assert.equal((await getPublicConfig()).rouletteEnabled,true);
  await updateRouletteSettings({enabled:false});
  assert.equal((await getPublicConfig()).rouletteEnabled,false);
  await updateRouletteSettings({enabled:true});
  assert.equal((await getPublicConfig()).rouletteEnabled,true);
});

test('Mini App appearance exposes the administrator selection and browser opt-in', async () => {
  for (const design of ['classic', 'modern', 'stealth', 'aurora']) {
    settings.set('cabinet_design', design);
    settings.set('cabinet_design_apply_in_browser', 'false');
    invalidateSystemConfigCache();
    assert.equal((await getPublicConfig()).cabinetDesign, design);
    assert.equal((await getPublicConfig()).cabinetDesignApplyInBrowser, false);
  }
  settings.set('cabinet_design', 'modern');
  settings.set('cabinet_design_apply_in_browser', 'true');
  invalidateSystemConfigCache();
  assert.equal((await getPublicConfig()).cabinetDesignApplyInBrowser, true);
  settings.set('cabinet_design', 'unsupported');
  invalidateSystemConfigCache();
  assert.equal((await getPublicConfig()).cabinetDesign, 'classic');
});
