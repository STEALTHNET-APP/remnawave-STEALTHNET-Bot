import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {prisma} from '../dist/db.js';
import {cabinetDesignAdminRouter,cabinetDesignPublicRouter} from '../dist/modules/cabinet-design/routes.js';
import {DEFAULT_DESIGN} from '../dist/modules/cabinet-design/contract.js';
if (!(process.env.DATABASE_URL || '').includes('cabinet-design-test-db')) throw new Error('Isolated test DB required');
const admin=await prisma.admin.create({data:{email:'designer-admin@example.invalid',passwordHash:'unused',role:'ADMIN'}});
const manager=await prisma.admin.create({data:{email:'designer-manager@example.invalid',passwordHash:'unused',role:'MANAGER',allowedSections:'["settings"]'}});
const sign=id=>jwt.sign({adminId:id,type:'access'},process.env.JWT_SECRET,{expiresIn:'5m'});
const app=express();app.use(express.json());app.use('/admin',cabinetDesignAdminRouter);app.use('/public',cabinetDesignPublicRouter);
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
async function request(path,token,payload){const res=await fetch(base+path,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(payload?{body:JSON.stringify(payload)}:{})});return {status:res.status,data:await res.json()};}
try {
 assert.equal((await request('/admin')).status,401);
 assert.equal((await request('/admin',sign(manager.id))).status,403);
 const token=sign(admin.id);let result=await request('/admin',token);assert.equal(result.status,200);assert.equal(result.data.revision,0);
 assert.equal((await request('/admin/save',token,{revision:0,design:{...DEFAULT_DESIGN,dark:{...DEFAULT_DESIGN.dark,accent:'url(evil)'}}})).status,400);
 result=await request('/admin/save',token,{revision:0,design:DEFAULT_DESIGN});assert.equal(result.status,200);assert.equal(result.data.revision,1);
 let pub=await request('/public');assert.deepEqual(Object.keys(pub.data).sort(),['design','publishedAt']);assert.equal(pub.data.design,null);
 assert.equal((await request('/admin/publish',token,{revision:0,design:DEFAULT_DESIGN})).status,409);
 result=await request('/admin/publish',token,{revision:1,design:DEFAULT_DESIGN});assert.equal(result.status,200);
 pub=await request('/public');assert.equal(pub.data.design.name,'Графит');
 const writes=await Promise.all([request('/admin/save',token,{revision:2,design:{...DEFAULT_DESIGN,name:'A'}}),request('/admin/save',token,{revision:2,design:{...DEFAULT_DESIGN,name:'B'}})]);
 assert.deepEqual(writes.map(x=>x.status).sort(),[200,409]);
 const historyId=result.data.history[0].id;result=await request('/admin/restore',token,{revision:3,id:historyId});assert.equal(result.status,200);assert.equal(result.data.draft.enabled,false);assert.equal(result.data.published.name,'Графит');
 result=await request('/admin/publish',token,{revision:4,design:result.data.draft});assert.equal(result.status,200);assert.equal((await request('/public')).data.design.enabled,false);
 result=await request('/admin/discard',token,{revision:5});assert.equal(result.status,200);assert.equal(result.data.draft,null);
 console.log('PASS: real HTTP auth, manager denial, validation, persistence, draft isolation, public projection, concurrent writes, publish, history restore, disable, discard');
} finally {await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();}
