const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

const state = { subject: null, body: null };
const prisma = {
  systemSetting: {
    findUnique: async ({ where }) => {
      if (where.key.endsWith('_subject')) return state.subject === null ? null : { key: where.key, value: state.subject };
      return state.body === null ? null : { key: where.key, value: state.body };
    },
    update: async ({ where, data }) => {
      if (where.key.endsWith('_subject')) state.subject = data.value;
      return { key: where.key, value: data.value };
    },
  },
};

const filename = path.join(__dirname, '../src/modules/email-templates/email-templates.service.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, {
  module: mod,
  exports: mod.exports,
  require: (name) => {
    if (name === '../../db.js') return { prisma };
    throw new Error(`unexpected require: ${name}`);
  },
  console,
  Promise,
  Error,
  RegExp,
  Number,
  JSON,
});

const { getStoredTemplate, migrateLegacyEmailVerificationSubject, renderTemplate } = mod.exports;
const defaultSubject = 'Подтверждение регистрации — {{serviceName}}';

(async () => {
  assert.equal(renderTemplate('Код подтверждения GhostNet: {{code}}', {}), 'Код подтверждения GhostNet');
  assert.equal(renderTemplate('Подтверждение — {{serviceName}}', { serviceName: 'Example' }), 'Подтверждение — Example');
  assert.equal(renderTemplate('Код: {{code}}', { code: '123456' }), 'Код: 123456');

  state.subject = 'Код подтверждения GhostNet: {{code}}';
  const legacy = await getStoredTemplate('email_verification');
  assert.equal(legacy.subject, defaultSubject);

  state.subject = 'Код подтверждения GhostNet: {{code}}';
  assert.equal(await migrateLegacyEmailVerificationSubject(), true);
  assert.equal(state.subject, defaultSubject);
  assert.equal(await migrateLegacyEmailVerificationSubject(), false);

  state.subject = 'Своя тема — {{serviceName}}';
  const custom = await getStoredTemplate('email_verification');
  assert.equal(custom.subject, 'Своя тема — {{serviceName}}');

  console.log('PASS: legacy email verification subject migrated and code placeholder sanitized');
})();
