import { mock } from 'node:test';
import express from 'express';
import multer from 'multer';
if (process.env.RELEASE682_TEST_DATABASE !== '1' || !new URL(process.env.DATABASE_URL).pathname.includes('updaterqa')) throw Error('Isolated test database required');
const upload = multer({ storage: multer.memoryStorage() });
mock.module('../dist/lib/upload.js', { namedExports: {
  uploadMascotImage: upload, uploadVideo: upload, uploadTicketAttachment: upload,
  removeUploadedFile() {}, mascotUrl: name => name, videoUploadUrl: name => name, ticketAttachmentUrl: name => name,
} });
const { prisma } = await import('../dist/db.js');
await prisma.admin.upsert({where:{email:'review@example.invalid'},update:{},create:{email:'review@example.invalid',passwordHash:'unusable-test-fixture',mustChangePassword:false}});
const { adminRouter } = await import('../dist/modules/admin/admin.routes.js');
const { clientRouter } = await import('../dist/modules/client/client.routes.js');
const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);
app.use('/api/client', clientRouter);
app.use((error, req, res, next) => { console.error(error); res.status(500).json({message:error.message}); });
const server = app.listen(55001, '127.0.0.1', () => console.log('Ticket review API ready on 55001'));
process.on('SIGTERM',()=>server.close(async()=>{await prisma.$disconnect();process.exit(0);}));
