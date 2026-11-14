import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {DEFAULT_DESIGN,parseDesign,emptyDocument} from '../dist/modules/cabinet-design/contract.js';
import {changeDesign} from '../dist/modules/cabinet-design/document.js';
test('frontend and backend validate the same contract',()=>{
 assert.equal(readFileSync(new URL('../src/modules/cabinet-design/contract.ts',import.meta.url),'utf8'),readFileSync(new URL('../../frontend/src/lib/cabinet-design.ts',import.meta.url),'utf8'));
});
test('rejects unsafe CSS and malformed dimensions',()=>{
 assert.deepEqual(parseDesign(DEFAULT_DESIGN),DEFAULT_DESIGN);
 for(const value of [null,[],{}, {...DEFAULT_DESIGN,version:2},{...DEFAULT_DESIGN,width:9000},{...DEFAULT_DESIGN,fontSize:NaN},{...DEFAULT_DESIGN,radius:1.5},{...DEFAULT_DESIGN,font:'url(evil)'},{...DEFAULT_DESIGN,name:' '},{...DEFAULT_DESIGN,dark:{...DEFAULT_DESIGN.dark,accent:'#fff; background:url(evil)'}}]) assert.equal(parseDesign(value),null);
 const clean=parseDesign({...DEFAULT_DESIGN,customCss:'body{display:none}',dark:{...DEFAULT_DESIGN.dark,unexpected:'evil'}});
 assert.equal(clean.customCss,undefined);assert.equal(clean.dark.unexpected,undefined);
});
test('saving draft cannot change published design',()=>{
 const original=emptyDocument();const next=changeDesign(original,0,{action:'save',design:DEFAULT_DESIGN});
 assert.equal(next.published,null);assert.deepEqual(next.draft,DEFAULT_DESIGN);assert.equal(original.revision,0);assert.equal(next.revision,1);
});
test('publish and restore preserve previous version',()=>{
 const first=changeDesign(emptyDocument(),0,{action:'publish',design:DEFAULT_DESIGN},'2026-10-29T00:00:00Z');
 assert.equal(first.history[0].design,null);assert.equal(first.draft,null);
 const next=changeDesign(first,1,{action:'publish',design:{...DEFAULT_DESIGN,name:'Новая'}});
 assert.equal(next.history[0].design.name,'Графит');assert.equal(next.published.name,'Новая');
 const restored=changeDesign(next,2,{action:'restore',id:next.history[0].id});
 assert.equal(restored.published.name,'Новая');assert.equal(restored.draft.name,'Графит');
 const baseline=changeDesign(restored,3,{action:'restore',id:next.history[1].id});assert.equal(baseline.draft.enabled,false);
});
test('stale revisions fail and history stays bounded',()=>{
 let doc=emptyDocument();for(let i=0;i<20;i++) doc=changeDesign(doc,doc.revision,{action:'publish',design:{...DEFAULT_DESIGN,name:String(i)}});
 assert.equal(doc.history.length,12);assert.throws(()=>changeDesign(doc,0,{action:'discard'}),/CONFLICT/);
 assert.throws(()=>changeDesign(doc,doc.revision,{action:'restore',id:'missing'}),/NOT_FOUND/);
 const next=changeDesign({...doc,draft:DEFAULT_DESIGN},doc.revision,{action:'discard'});assert.equal(next.draft,null);assert.equal(next.published.name,'19');
});
