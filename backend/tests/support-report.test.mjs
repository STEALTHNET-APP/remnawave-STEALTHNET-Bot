import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeDiagnosticLog, reportUpdateStatus} from '../dist/modules/diagnostics/support-report.js';

test('report keeps diagnostic codes and discards all original log content', () => {
  const summary = summarizeDiagnosticLog({ts: 0, level:'error', text:'[remna-sync] HTTP 503 ECONNREFUSED user=alice@example.com password=secret token=123:secret https://private.example/sub/id client=c123'});
  assert.deepEqual(summary, {at:'1970-01-01T00:00:00.000Z', level:'error', category:'remna-sync', httpStatus:503, errorCode:'ECONNREFUSED'});
  assert.deepEqual(summarizeDiagnosticLog({ts:0, level:'secret',text:'arbitrary secret message'}),{at:'1970-01-01T00:00:00.000Z',level:'log',category:'application'});
});
test('updater summary is an allowlist, never a copy of agent errors or paths', () => {
 const summary = reportUpdateStatus({status:{phase:'failed',message:'password=secret',backup:'/private/path',localChanges:['.env'],target:'a'.repeat(40),writesResumed:true,events:[{message:'secret'}]}});
 assert.deepEqual(summary,{connected:true,phase:'failed',recoveryRequired:false,rolledBack:false,writesResumed:true,available:false,target:'a'.repeat(40)});
 assert.equal(reportUpdateStatus({status:{phase:'secret',target:'secret'}}).phase,'unknown');
 assert.deepEqual(reportUpdateStatus({}),{connected:false});
});
