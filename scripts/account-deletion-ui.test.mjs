import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function signal(value) {
  return Object.assign(() => value, { set: next => { value = next; }, update: run => { value = run(value); } });
}

function fixture(editable = true, role = 'student') {
  const user = { id: 'target', role, displayName: 'Target', username: 'target-name', active: true };
  const data = { currentUserId: () => 'admin', users: signal([user]) };
  const calls = [];
  let handler = async () => 'Akun berhasil dihapus permanen.';
  const Data = Symbol(), Api = Symbol(), Route = Symbol();
  const instances = new Map([[Data, data], [Api, { deleteUser: (...args) => { calls.push(args); return handler(...args); } }],
    [Route, { snapshot: { data: { editable, userRole: role } } }]]);
  const imports = {
    '@angular/core': { Component: () => value => value, inject: token => instances.get(token), computed: run => run, signal },
    '@angular/router': { ActivatedRoute: Route },
    '../../core/services/content-data.service': { ContentDataService: Data },
    '../../core/services/admin-api.service': { AdminApiService: Api },
  };
  const source = readFileSync(new URL('../src/app/features/users/user-management.component.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Error, require: key => imports[key] ?? {} });
  return { component: new exports.UserManagementComponent(), data, user, calls, handler: next => { handler = next; } };
}

test('admin confirmation sends exact UID, target role and confirmation and removes the row only on success', async () => {
  for (const role of ['student', 'teacher']) {
    const f = fixture(true, role);
    f.component.openPermanentDelete(f.user);
    await f.component.confirmPermanentDelete();
    assert.equal(f.calls.length, 0); assert.equal(f.data.users().length, 1);
    f.component.deleteConfirmText.set('HAPUS');
    await f.component.confirmPermanentDelete();
    assert.deepEqual(f.calls[0], ['target', role, 'HAPUS']);
    assert.equal(f.data.users().length, 0);
    assert(f.component.deleteSuccess());
    assert.equal(f.component.pendingPermanentDelete(), null);
  }
});

test('failure preserves the selected account and confirmation so admin can retry', async () => {
  const f = fixture(); f.component.openPermanentDelete(f.user); f.component.deleteConfirmText.set('HAPUS');
  f.handler(async () => { throw new Error('Penghapusan belum selesai. Coba lagi.'); });
  await f.component.confirmPermanentDelete();
  assert.equal(f.data.users().length, 1); assert.equal(f.component.pendingPermanentDelete().id, 'target');
  assert.equal(f.component.deletingPermanently(), false); assert.match(f.component.deleteError(), /Coba lagi/);
  f.handler(async () => 'Berhasil'); await f.component.confirmPermanentDelete();
  assert.equal(f.component.deleteSuccess(), 'Berhasil'); assert.equal(f.component.deleteError(), '');
});

test('an in-flight delete cannot be duplicated, cancelled, or switched to a different target', async () => {
  const f = fixture(); let finish;
  f.handler(() => new Promise(resolve => { finish = resolve; }));
  f.component.openPermanentDelete(f.user); f.component.deleteConfirmText.set('HAPUS');
  const pending = f.component.confirmPermanentDelete();
  await f.component.confirmPermanentDelete(); f.component.closePermanentDelete();
  f.component.openPermanentDelete({ ...f.user, id: 'other' });
  assert.equal(f.calls.length, 1); assert.equal(f.component.pendingPermanentDelete().id, 'target');
  finish('Berhasil'); await pending;
});

test('teacher read-only view, self and admin targets cannot invoke permanent deletion', async () => {
  const f = fixture(false); f.component.openPermanentDelete(f.user);
  assert.equal(f.component.pendingPermanentDelete(), null);
  f.component.pendingPermanentDelete.set(f.user); f.component.deleteConfirmText.set('HAPUS');
  await f.component.confirmPermanentDelete(); assert.equal(f.calls.length, 0);
  const admin = fixture();
  admin.component.openPermanentDelete({ ...admin.user, role: 'admin' });
  admin.component.openPermanentDelete({ ...admin.user, id: 'admin' });
  assert.equal(admin.component.pendingPermanentDelete(), null);
});

test('deletion-in-progress rows cannot be edited but can be selected for retry', () => {
  const f = fixture(); const user = { ...f.user, active: false, deletionStatus: 'failed' };
  f.component.openEdit(user); assert.equal(f.component.formOpen(), false);
  f.component.openPermanentDelete(user); assert.equal(f.component.pendingPermanentDelete().id, 'target');
});
