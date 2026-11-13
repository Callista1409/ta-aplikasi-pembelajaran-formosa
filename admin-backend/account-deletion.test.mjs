import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteManagedAccount } from './account-deletion.mjs';
import { handleAdminRequest } from './server.mjs';

function fixture(role = 'student', uid = 'target') {
  const documents = new Map([
    ['users/admin', { role: 'admin', active: true }],
    [`users/${uid}`, { role, active: true, username: 'target-name', email: 'target@example.test', displayName: 'Target' }],
    ['loginUsernames/target-name', { uid, email: 'target@example.test' }],
    [`pendingRegistrations/${uid}`, { uid, role }],
  ]);
  const accounts = new Map([[uid, { uid, email: 'target@example.test', disabled: false }]]);
  const events = [], queries = [], transactionSizes = [];
  const state = { time: 1000, failQuery: '', failAuthDelete: false, failFinalize: false, queryHook: null, maxDeleteSize: Infinity };
  const snapshot = path => ({ exists: documents.has(path), data: () => structuredClone(documents.get(path)), ref: ref(path) });
  const ref = path => ({ path, get: async () => snapshot(path) });
  let queue = Promise.resolve();
  const db = {
    collection: name => ({
      doc: id => ref(`${name}/${id}`),
      where: (field, op, value) => ({ limit: maximum => ({ get: async () => {
        queries.push({ name, field, op, value, maximum });
        await state.queryHook?.(name);
        if (state.failQuery === name) throw new Error('simulated query outage');
        const docs = [...documents].filter(([path, data]) => path.startsWith(`${name}/`) && (op === 'array-contains' ? Array.isArray(data[field]) && data[field].includes(value) : data[field] === value))
          .slice(0, maximum).map(([path]) => snapshot(path));
        return { docs, empty: !docs.length };
      } }) }),
    }),
    runTransaction: run => {
      const pending = queue.then(async () => {
        const writes = [];
        let writing = false;
        const result = await run({
          get: async reference => { assert.equal(writing, false, 'Firestore transactions must read before writing'); return snapshot(reference.path); },
          set: (reference, data, options) => { writing = true; writes.push({ kind: 'set', path: reference.path, data: structuredClone(data), merge: options?.merge }); },
          delete: reference => { writing = true; writes.push({ kind: 'delete', path: reference.path }); },
        });
        if (state.failFinalize && writes.some(write => write.data?.status === 'completed')) throw new Error('simulated finalization outage');
        if (writes.filter(write => write.kind === 'delete').length > state.maxDeleteSize) throw new Error('Transaction too big. Decrease transaction size.');
        transactionSizes.push(writes.length);
        for (const write of writes) {
          if (write.kind === 'delete') documents.delete(write.path);
          else documents.set(write.path, write.merge ? { ...documents.get(write.path), ...write.data } : write.data);
          events.push(write);
        }
        return result;
      });
      queue = pending.catch(() => undefined);
      return pending;
    },
  };
  const missing = () => Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
  const auth = {
    verifyIdToken: async (token, revoked) => { assert.equal(revoked, true); if (token !== 'admin-token') throw new Error('invalid'); return { uid: 'admin' }; },
    getUser: async id => { if (!accounts.has(id)) throw missing(); return structuredClone(accounts.get(id)); },
    updateUser: async (id, changes) => { if (!accounts.has(id)) throw missing(); accounts.set(id, { ...accounts.get(id), ...changes }); events.push({ kind: 'disable', id }); },
    revokeRefreshTokens: async id => { if (!accounts.has(id)) throw missing(); events.push({ kind: 'revoke', id }); },
    deleteUser: async id => { if (state.failAuthDelete) throw new Error('Auth outage'); if (!accounts.has(id)) throw missing(); accounts.delete(id); events.push({ kind: 'deleteAuth', id }); },
  };
  const services = { auth, db, now: () => state.time, timestamp: () => 'server-time' };
  const request = { uid, expectedRole: role, confirmation: 'HAPUS', actorUid: 'admin' };
  return { services, request, state, documents, accounts, events, queries, transactionSizes,
    remove: changes => deleteManagedAccount(services, { ...request, ...changes }) };
}

test('student deletion removes every scoped record in bounded pages and keeps unrelated users/content', async () => {
  const f = fixture();
  const names = ['studentProgress', 'studentQuestionProgress', 'studentAccessories', 'studentActivityLogs', 'studentComments', 'testSessions', 'testAnswers', 'studentBulkProgress', 'studentPoints'];
  for (const name of names) {
    f.documents.set(`${name}/own`, { studentId: 'target' });
    f.documents.set(`${name}/other`, { studentId: 'other' });
  }
  for (let i = 0; i < 405; i++) f.documents.set(`studentProgress/p-${i}`, { studentId: 'target' });
  f.documents.set('studentPoints/target', { totalPoints: 100 });
  f.documents.set('flashcards/keep', { createdBy: 'target' });
  f.documents.set('loginUsernames/old-alias', { uid: 'target' });
  const result = await f.remove();
  assert.equal(result.uid, 'target');
  assert.equal(f.accounts.has('target'), false);
  assert.equal(f.documents.has('users/target'), false);
  assert.equal(f.documents.has('pendingRegistrations/target'), false);
  assert.equal(f.documents.has('loginUsernames/old-alias'), false);
  for (const name of names) { assert.equal(f.documents.has(`${name}/own`), false); assert(f.documents.has(`${name}/other`)); }
  assert(f.documents.has('flashcards/keep'));
  assert(f.queries.every(query => query.maximum === 50 && query.value === 'target' && (query.op === '==' || query.name === 'dashboardReportCache' && query.op === 'array-contains')));
  assert(Math.max(...f.transactionSizes) <= 201);
  const authDelete = f.events.findIndex(event => event.kind === 'deleteAuth');
  assert(authDelete > f.events.findIndex(event => event.kind === 'delete' && event.path === 'testAnswers/own'));
  const receipt = f.documents.get('accountDeletionJobs/target');
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.email, undefined); assert.equal(receipt.username, undefined); assert.equal(receipt.displayName, undefined);
});

test('new practice history and report caches are removed before Auth and cache failures can resume', async () => {
  const f = fixture();
  for (const name of ['studentPracticeSessions', 'studentPracticeAnswerEvents']) {
    f.documents.set(`${name}/own`, { studentId: 'target' });
    f.documents.set(`${name}/other`, { studentId: 'other' });
  }
  f.documents.set('dashboardReportCache/own', { subjectIds: ['target', 'other'] });
  f.documents.set('dashboardReportCache/other', { subjectIds: ['other'] });
  f.state.failQuery = 'dashboardReportCache';
  await assert.rejects(f.remove(), error => error.status === 503 && error.retryable);
  assert(f.accounts.has('target')); assert.equal(f.accounts.get('target').disabled, true);
  assert.equal(f.documents.get('users/target').deletionStatus, 'failed');
  f.state.failQuery = ''; await f.remove();
  for (const name of ['studentPracticeSessions', 'studentPracticeAnswerEvents', 'dashboardReportCache']) {
    assert.equal(f.documents.has(`${name}/own`), false); assert(f.documents.has(`${name}/other`));
  }
  assert(f.events.findIndex(e => e.kind === 'deleteAuth') > f.events.findIndex(e => e.path === 'dashboardReportCache/own' && e.kind === 'delete'));
});

test('teacher deletion retains teaching content and comments while removing login/profile/registration', async () => {
  const f = fixture('teacher');
  for (const name of ['units', 'flashcards', 'questions']) f.documents.set(`${name}/keep`, { createdBy: 'target' });
  f.documents.set('studentComments/keep', { teacherId: 'target', studentId: 'student-a' });
  f.documents.set('testSessions/keep', { studentId: 'student-a' });
  await f.remove();
  for (const name of ['units', 'flashcards', 'questions', 'studentComments', 'testSessions']) assert(f.documents.has(`${name}/keep`));
  assert.equal(f.documents.has('users/target'), false);
  assert.equal(f.documents.has('loginUsernames/target-name'), false);
});

test('large document transactions split into smaller groups without claiming partial success', async () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) f.documents.set(`testSessions/${i}`, { studentId: 'target' });
  f.state.maxDeleteSize = 3;
  await f.remove();
  assert.equal([...f.documents].filter(([path]) => path.startsWith('testSessions/')).length, 0);
  assert.equal(f.documents.get('accountDeletionJobs/target').status, 'completed');
});

test('an unknown profile is rejected, but a server-recorded partial deletion can resume without it', async () => {
  const f = fixture(); f.documents.delete('users/target');
  await assert.rejects(f.remove(), error => error.status === 404);
  assert.equal(f.events.length, 0);
  f.documents.set('accountDeletionJobs/target', { uid: 'target', role: 'student', status: 'failed', username: 'target-name' });
  await f.remove();
  assert.equal(f.accounts.has('target'), false);
});

test('confirmation, role mismatch, invalid UID and self/admin targets fail before account mutations', async () => {
  for (const change of [{ confirmation: '' }, { expectedRole: 'admin' }, { expectedRole: 'teacher' }, { actorUid: 'target' }, { uid: 'a/b' }]) {
    const f = fixture(); await assert.rejects(f.remove(change), error => [400, 403, 409].includes(error.status));
    assert.equal(f.events.length, 0);
    assert.equal(f.accounts.get('target').disabled, false);
  }
  const f = fixture('admin');
  await assert.rejects(f.remove({ expectedRole: 'student' }), error => error.status === 403);
  assert.equal(f.events.length, 0);
});

test('partial cleanup remains disabled, reports failure, and resumes instead of losing the target', async () => {
  const f = fixture();
  f.documents.set('studentProgress/old', { studentId: 'target' });
  f.documents.set('testSessions/old', { studentId: 'target' });
  f.state.failQuery = 'testSessions';
  await assert.rejects(f.remove(), error => error.status === 503 && error.retryable);
  assert.equal(f.documents.has('studentProgress/old'), false);
  assert.equal(f.documents.has('testSessions/old'), true);
  assert.equal(f.documents.get('users/target').deletionStatus, 'failed');
  assert.equal(f.documents.get('users/target').active, false);
  assert.equal(f.accounts.get('target').disabled, true);
  assert.equal(f.events.some(event => event.kind === 'deleteAuth'), false);
  f.state.failQuery = ''; await f.remove();
  assert.equal(f.documents.has('testSessions/old'), false);
  assert.equal(f.documents.get('accountDeletionJobs/target').status, 'completed');
});

test('missing Auth accounts from an older partial deletion still have their data cleaned up', async () => {
  const f = fixture(); f.accounts.delete('target');
  f.documents.set('studentQuestionProgress/old', { studentId: 'target' });
  await f.remove();
  assert.equal(f.documents.has('studentQuestionProgress/old'), false);
  assert.equal(f.documents.has('users/target'), false);
  await f.remove(); // A duplicate response/retry is idempotent.
});

test('failure after Auth deletion is recoverable and a reused completed UID is never deleted', async () => {
  const f = fixture(); f.state.failFinalize = true;
  await assert.rejects(f.remove(), error => error.status === 503);
  assert.equal(f.accounts.has('target'), false);
  assert(f.documents.has('users/target'));
  f.state.failFinalize = false; await f.remove();
  f.accounts.set('target', { uid: 'target' });
  await assert.rejects(f.remove(), error => error.status === 409);
  assert(f.accounts.has('target'));
});

test('Auth deletion failure never produces success and preserves the retryable profile', async () => {
  const f = fixture(); f.state.failAuthDelete = true;
  await assert.rejects(f.remove(), error => error.status === 503);
  assert.equal(f.documents.get('users/target').deletionStatus, 'failed');
  f.state.failAuthDelete = false; await f.remove();
  assert.equal(f.accounts.has('target'), false);
});

test('concurrent attempts are rejected while the durable deletion lease is held', async () => {
  const f = fixture(); let entered, resume;
  const gate = new Promise(resolve => { entered = resolve; });
  f.state.queryHook = async name => { if (name === 'studentProgress') { entered(); await new Promise(resolve => { resume = resolve; }); } };
  const first = f.remove(); await gate;
  await assert.rejects(f.remove(), error => error.status === 409);
  f.state.queryHook = null; resume(); await first;
  assert.equal(f.events.filter(event => event.kind === 'deleteAuth').length, 1);
});

test('expired workers cannot overwrite a replacement worker completion receipt', async () => {
  const f = fixture(); let entered, resume;
  const gate = new Promise(resolve => { entered = resolve; });
  f.state.queryHook = async name => { if (name === 'studentProgress') { entered(); await new Promise(resolve => { resume = resolve; }); } };
  const old = f.remove(); await gate;
  f.state.time += 4 * 60_000; f.state.queryHook = null;
  await f.remove(); resume();
  await assert.rejects(old, error => error.status === 409);
  assert.equal(f.documents.get('accountDeletionJobs/target').status, 'completed');
});

test('a reassigned username is preserved while legacy mappings owned by the target are removed', async () => {
  const f = fixture();
  f.documents.set('loginUsernames/target-name', { uid: 'someone-else', email: 'target@example.test' });
  await f.remove(); assert.equal(f.documents.get('loginUsernames/target-name').uid, 'someone-else');
  const legacy = fixture(); legacy.documents.set('loginUsernames/target-name', { email: 'target@example.test' });
  await legacy.remove(); assert.equal(legacy.documents.has('loginUsernames/target-name'), false);
});

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
}

test('HTTP boundary rejects missing/invalid/revoked tokens and inactive or non-admin profiles', async () => {
  for (const scenario of ['missing', 'invalid', 'inactive', 'teacher']) {
    const f = fixture(), res = response();
    if (scenario === 'inactive') f.documents.set('users/admin', { role: 'admin', active: false });
    if (scenario === 'teacher') f.documents.set('users/admin', { role: 'teacher', active: true });
    await handleAdminRequest({ method: 'POST', url: '/admin/delete-user', headers: {
      authorization: scenario === 'missing' ? '' : `Bearer ${scenario === 'invalid' ? 'bad' : 'admin-token'}`,
    }, body: { uid: 'target', role: 'student', confirmation: 'HAPUS' } }, res, f.services);
    assert.equal(res.status, ['missing', 'invalid'].includes(scenario) ? 401 : 403);
    assert.equal(f.events.length, 0);
  }
});

test('Vercel API route enforces authentication and completes the same deletion flow', async () => {
  const f = fixture(), denied = response();
  await handleAdminRequest({ method: 'POST', url: '/api/admin/delete-user', headers: {}, body: {} }, denied, f.services);
  assert.equal(denied.status, 401); assert.equal(f.events.length, 0);
  const completed = response();
  await handleAdminRequest({ method: 'POST', url: '/api/admin/delete-user', headers: { authorization: 'Bearer admin-token' },
    body: { uid: 'target', role: 'student', confirmation: 'HAPUS' } }, completed, f.services);
  assert.equal(completed.status, 200); assert.equal(completed.body.uid, 'target');
});

test('HTTP response reports only completed deletion and rejects old/invalid request shapes', async () => {
  const f = fixture(), res = response();
  await handleAdminRequest({ method: 'POST', url: '/admin/delete-user', headers: { authorization: 'Bearer admin-token' },
    body: { uid: 'target', role: 'student', confirmation: 'HAPUS' } }, res, f.services);
  assert.equal(res.status, 200); assert.equal(res.body.uid, 'target'); assert.equal(res.headers['Cache-Control'], 'no-store');
  for (const body of [null, [], { identifier: 'target' }, { uid: 'target', role: 'student' }]) {
    const other = fixture(), responseValue = response();
    await handleAdminRequest({ method: 'POST', url: '/admin/delete-user', headers: { authorization: 'Bearer admin-token' }, body }, responseValue, other.services);
    assert.equal(responseValue.status, 400); assert.equal(other.events.length, 0);
  }
});

test('an exhausted Firestore quota during admin verification returns a clear 503 before deletion', async () => {
  const f = fixture(), res = response(), logs = [];
  const quota = Object.assign(new Error('SDK detail that should not be sent or logged: private-key token-value'), { code: 8 });
  const db = { collection: () => ({ doc: () => ({ get: async () => { throw quota; } }) }) };
  await handleAdminRequest({ method: 'POST', url: '/admin/delete-user', headers: { authorization: 'Bearer admin-token' },
    body: { uid: 'target', role: 'student', confirmation: 'HAPUS' } }, res,
  { ...f.services, db, logger: { error: (...args) => logs.push(args) } });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'firestore-quota-exceeded');
  assert.match(res.body.message, /Kuota Firestore/);
  assert.equal(f.events.length, 0);
  assert.equal(f.accounts.get('target').disabled, false);
  assert.equal(logs[0][1].stage, 'authorize-admin');
  assert.equal(logs[0][1].code, 8);
  assert.equal(JSON.stringify([logs, res.body]).includes('token-value'), false);
});

test('quota failure during partial cleanup keeps its quota code and safe retry state', async () => {
  const f = fixture(), res = response(), logs = [];
  f.state.queryHook = async name => { if (name === 'testSessions') throw Object.assign(new Error('quota'), { code: 8 }); };
  await handleAdminRequest({ method: 'POST', url: '/admin/delete-user', headers: { authorization: 'Bearer admin-token' },
    body: { uid: 'target', role: 'student', confirmation: 'HAPUS' } }, res,
  { ...f.services, logger: { error: (...args) => logs.push(args) } });
  assert.equal(res.status, 503); assert.equal(res.body.code, 'firestore-quota-exceeded');
  assert.equal(f.documents.get('users/target').deletionStatus, 'failed');
  assert.equal(f.accounts.get('target').disabled, true);
  assert.equal(logs[0][1].stage, 'delete-account');
});
