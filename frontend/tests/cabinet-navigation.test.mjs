import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cabinetSection, cabinetSubscriptionUnavailable } from '../src/lib/cabinet-navigation.ts';

test('nested support and connection pages keep their navigation section', () => {
  assert.equal(cabinetSection('/cabinet/tickets/abc'), '/cabinet/help');
  assert.equal(cabinetSection('/cabinet/documents/privacy'), '/cabinet/help');
  assert.equal(cabinetSection('/cabinet/subscribe'), '/cabinet/dashboard');
  assert.equal(cabinetSection('/cabinet/wallet/'), '/cabinet/wallet');
  assert.equal(cabinetSection('/cabinet/profile'), '/cabinet/profile');
});

test('new accounts stay empty, while failed requests are not presented as missing subscriptions', () => {
  assert.equal(cabinetSubscriptionUnavailable({requestFailed:false,subscription:null,message:'Подписка не привязана'}), false);
  assert.equal(cabinetSubscriptionUnavailable({requestFailed:false,subscription:null,message:'Remna connection failed'}), true);
  assert.equal(cabinetSubscriptionUnavailable({requestFailed:true,subscription:null}), true);
});

test('an offline snapshot cannot be presented as a verified active or expired subscription', () => {
  for (const status of ['ACTIVE','EXPIRED']) {
    assert.equal(cabinetSubscriptionUnavailable({requestFailed:false,subscription:{status},offlineSnapshot:true}), true);
    assert.equal(cabinetSubscriptionUnavailable({requestFailed:false,subscription:{status},offlineSnapshot:false}), false);
  }
});
