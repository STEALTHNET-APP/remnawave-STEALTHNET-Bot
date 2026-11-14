const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/admin-navigation.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });
const { canAccessSection, isNavActive, getManagerRedirect } = exportsObject;
const items = [
  { to: '/admin', section: 'dashboard' },
  { to: '/admin/clients', section: 'clients' },
  { to: '/admin/business-analytics', section: 'analytics' },
  { to: '/admin/balance-sales', section: 'balance-sales-virtual', requiredAction: 'view_balance_sales' },
  { to: '/admin/remna-nodes', section: 'infra-nodes' },
  { to: '/admin/bot-messages', section: 'settings' },
  { to: '/admin/admins', section: 'admins' },
];
const manager = (allowedSections) => ({ role: 'MANAGER', allowedSections });
for (const [path, permission] of [
  ['/admin/business-analytics', 'analytics'],
  ['/admin/remna-nodes', 'infra-nodes'],
  ['/admin/bot-messages', 'settings'],
  ['/admin/balance-sales', 'action:view_balance_sales'],
  ['/admin/clients/client-id', 'clients'],
]) assert.equal(getManagerRedirect(manager([permission]), path, items), undefined, path);
assert.equal(getManagerRedirect(manager(['action:edit_client', 'clients']), '/admin/admins', items), '/admin/clients');
assert.equal(getManagerRedirect(manager(['clients']), '/admin/business-analytics', items), '/admin/clients');
assert.equal(getManagerRedirect(manager(['dashboard', 'admins']), '/admin/admins', items), '/admin');
assert.equal(getManagerRedirect(manager(['clients']), '/admin/change-password', items), undefined);
assert.equal(getManagerRedirect(manager(['api-keys']), '/admin/api-docs', items), undefined);
assert.equal(getManagerRedirect({role:'ADMIN'}, '/admin/admins', items), undefined);
assert.equal(canAccessSection('MANAGER', undefined, 'settings'), false);
assert.equal(canAccessSection('MANAGER', ['balance-sales-virtual'], 'balance-sales-virtual', 'view_balance_sales'), false);
assert.equal(isNavActive('/admin/promo-codes', '/admin/promo'), false);
assert.equal(isNavActive('/admin/clients', '/admin'), false);
assert.equal(isNavActive('/admin/clients/abc', '/admin/clients'), true);
console.log('PASS: manager section aliases, action permissions, nested routes, safe fallback and utility pages');
