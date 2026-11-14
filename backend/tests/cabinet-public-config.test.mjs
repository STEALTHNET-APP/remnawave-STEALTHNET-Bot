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
const {updateRouletteSettings,getRouletteSettings}=await import('../dist/modules/roulette/roulette.service.js');

test('daily roulette defaults to Moscow timezone and keeps explicit zones',async()=>{
  settings.clear();
  await updateRouletteSettings({resetMode:'daily'});
  assert.equal((await getRouletteSettings()).timeZone,'Europe/Moscow');
  settings.set('roulette_time_zone','Invalid/Zone');
  assert.equal((await getRouletteSettings()).timeZone,'Europe/Moscow');
  settings.set('roulette_time_zone','Europe/Berlin');
  assert.equal((await getRouletteSettings()).timeZone,'Europe/Berlin');
});

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

test('CloudPayments public settings expose availability without terminal credentials', async () => {
  settings.set('cloudpayments_enabled', 'true');
  settings.set('cloudpayments_public_id', 'test-terminal');
  settings.set('cloudpayments_api_secret', 'private-test-secret');
  settings.set('cloudpayments_trial_days', '3');
  invalidateSystemConfigCache();
  const config = await getPublicConfig();
  assert.equal(config.cloudpaymentsEnabled, true);
  assert.equal(config.cloudpaymentsTrialDays, 3);
  assert.equal(config.cloudpaymentsApiSecret, undefined);
  assert.equal(config.cloudpaymentsPublicId, undefined);
  assert.equal(JSON.stringify(config).includes('private-test-secret'), false);
});


test('webhook secret stays private and saved false overrides environment default', async () => {
  process.env.BOT_WEBHOOK_ENABLED = 'true';
  settings.set('bot_webhook_enabled', 'false');
  settings.set('bot_webhook_secret', 'private-webhook-fixture');
  invalidateSystemConfigCache();
  const config = await getPublicConfig();
  assert.equal(config.botWebhookEnabled, false);
  assert.equal(JSON.stringify(config).includes('private-webhook-fixture'), false);
  delete process.env.BOT_WEBHOOK_ENABLED;
});

test('legal document links and titles can be cleared back to null', async () => {
  settings.clear();
  settings.set('agreement_link', 'https://example.com/terms');
  settings.set('offer_link', 'https://example.com/offer');
  settings.set('refund_link', 'https://example.com/refund');
  settings.set('agreement_title', 'Terms of use');
  settings.set('offer_title', 'Public offer');
  settings.set('refund_title', 'Refund policy');
  settings.set('referral_instructions_url', 'https://example.com/referrals');
  invalidateSystemConfigCache();

  let config = await getPublicConfig();
  assert.equal(config.agreementLink, 'https://example.com/terms');
  assert.equal(config.offerLink, 'https://example.com/offer');
  assert.equal(config.refundLink, 'https://example.com/refund');
  assert.equal(config.agreementTitle, 'Terms of use');
  assert.equal(config.offerTitle, 'Public offer');
  assert.equal(config.refundTitle, 'Refund policy');
  assert.equal(config.referralInstructionsUrl, 'https://example.com/referrals');

  for (const key of [
    'agreement_link', 'offer_link', 'refund_link',
    'agreement_title', 'offer_title', 'refund_title',
    'referral_instructions_url',
  ]) settings.set(key, '');
  invalidateSystemConfigCache();

  config = await getPublicConfig();
  assert.equal(config.agreementLink, null);
  assert.equal(config.offerLink, null);
  assert.equal(config.refundLink, null);
  assert.equal(config.agreementTitle, null);
  assert.equal(config.offerTitle, null);
  assert.equal(config.refundTitle, null);
  assert.equal(config.referralInstructionsUrl, null);
});

