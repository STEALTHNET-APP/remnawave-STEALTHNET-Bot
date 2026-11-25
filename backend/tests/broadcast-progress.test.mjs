import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createProgressWriter } from '../dist/modules/broadcast/progress-writer.js';
test('progress is visible during a small broadcast and queued writes cannot overwrite completion',async()=>{
 const writes=[];let active=0;
 const writer=createProgressWriter(async p=>{assert.equal(active++,0);await delay(8);writes.push(p.sent);active--;},5);
 const p={sent:1};writer.report(p);p.sent=99;
 await delay(7);writer.report({sent:2});writer.report({sent:3});await delay(20);
 assert.ok(writes.includes(1));assert.ok(writes.includes(3));
 writer.report({sent:4});await writer.finish();writes.push('completed');await delay(15);
 assert.deepEqual(writes,[1,3,4,'completed']);writer.report({sent:0});await delay(10);assert.equal(writes.at(-1),'completed');
});
