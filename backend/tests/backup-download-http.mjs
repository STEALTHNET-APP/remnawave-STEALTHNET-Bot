import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {gzipSync} from 'node:zlib';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'backup-download-'));
process.env.BACKUPS_DIR=root;
process.env.DATABASE_URL??='postgresql://test:test@localhost:1/backup_test_unused';
process.env.JWT_SECRET??='test-only-backup-download-secret-32-characters';
const {registerBackupRoutes}=await import('../dist/modules/backup/backup.routes.js');
const {asyncHandler}=await import('../dist/lib/async-handler.js');
const app=express(),router=express.Router();
registerBackupRoutes(router,asyncHandler);app.use(router);app.get('/health',(_q,r)=>r.json({ok:true}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
try{
 await fs.mkdir(path.join(root,'2026/10/19'),{recursive:true});
 const data=Buffer.from('SELECT 1;\n'),gz=gzipSync(data);
 await fs.writeFile(path.join(root,'2026/10/19/test.sql'),data);await fs.writeFile(path.join(root,'test.sql.gz'),gz);await fs.mkdir(path.join(root,'directory.sql'));
 for(const [name,expected] of [['2026/10/19/test.sql',data],['test.sql.gz',gz]]){const r=await fetch(base+'/backup/download?path='+encodeURIComponent(name));assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),expected);assert.ok(r.headers.get('content-disposition').includes('attachment'));}
 for(const name of ['missing.sql','../../.env','../test.sql.gz','/etc/passwd','.env','directory.sql','..\\test.sql']){const r=await fetch(base+'/backup/download?path='+encodeURIComponent(name));assert.equal(r.status,404,name);assert.equal((await fetch(base+'/health')).status,200);}
 console.log('PASS: SQL and gzip downloads, missing file and traversal return 404, API remains alive');
}finally{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
