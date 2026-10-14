import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {gzipSync} from 'node:zlib';
import {rm} from 'node:fs/promises';
import {runPgRestore} from '../dist/modules/backup/backup-restore.js';
import {saveCompressedBackup} from '../dist/modules/backup/backup-archive.js';
const url=process.env.TEST_DATABASE_URL;
if(!url || !new URL(url).pathname.startsWith('/issue210_test_restore')) throw Error('Use a disposable issue210_test_restore database');
const u=new URL(url),db={host:u.hostname,port:Number(u.port||5432),user:u.username,password:u.password,database:u.pathname.slice(1)};
const prisma=new PrismaClient({datasources:{db:{url}}});
let archive;
try{
 await prisma.$executeRawUnsafe('CREATE TABLE backup_probe (id integer primary key, value text)');
 await prisma.$executeRawUnsafe("INSERT INTO backup_probe VALUES (1, 'проверка 🐈')");
 const broken=gzipSync('CREATE TABLE broken_probe (id integer); SELECT * FROM missing_restore_table;');
 await assert.rejects(runPgRestore(db,broken,'broken.sql.gz'));
 assert.equal((await prisma.$queryRawUnsafe('SELECT value FROM backup_probe WHERE id=1'))[0].value,'проверка 🐈');
 assert.equal((await prisma.$queryRawUnsafe("SELECT to_regclass('public.broken_probe')::text AS name"))[0].name,null);
 console.log('PASS: SQL failure rolls schema cleanup and partial import back');
 archive=await saveCompressedBackup(db,'bot');
 await prisma.$executeRawUnsafe("UPDATE backup_probe SET value='changed'");
 await runPgRestore(db,archive.fullPath,archive.filename);
 assert.equal((await prisma.$queryRawUnsafe('SELECT value FROM backup_probe WHERE id=1'))[0].value,'проверка 🐈');
 console.log('PASS: actual pg_dump → gzip → psql restores data including Unicode');
 await assert.rejects(runPgRestore(db,gzipSync('SELECT 1;').subarray(0,5),'bad.sql.gz'));
 assert.equal((await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM backup_probe'))[0].n,1);
 console.log('PASS: truncated archive leaves existing database intact');
}finally{
 await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS backup_probe');
 await prisma.$disconnect();if(archive)await rm(archive.fullPath,{force:true});
}
