import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authRoster, invalidateAuthRoster } from './auth-roster.mjs';
import { dashboardReport, purgeReportCache, reportRequest } from './dashboard-reports.mjs';
import { authorizeStaff } from './staff-access.mjs';

test('normal Auth roster is cached and never scans Firestore users/registrations', async () => {
  invalidateAuthRoster(); let calls = 0;
  const auth = { listUsers: async () => { calls++; return { users: [
    { uid: 's', email: 's@formosa.student' }, { uid: 't', email: 't@formosa.teacher' }, { uid: 'a', email: 'a@formosa.admin' },
  ] }; } };
  const db = { collection: () => { throw new Error('A full scan is forbidden'); } };
  const one = await authRoster(auth, db, { now: () => 1000 });
  assert.deepEqual(one.students.map(row => row.id), ['s']); assert.deepEqual(one.teachers.map(row => row.id), ['t']);
  await authRoster(auth, db, { now: () => 2000 }); assert.equal(calls, 1);
  await authRoster(auth, db, { now: () => 122000 }); assert.equal(calls, 2);
  await authRoster(auth, db, { refresh: true }); assert.equal(calls, 3);
});

test('legacy identities use only targeted profile/registration lookups, with Auth paging', async () => {
  invalidateAuthRoster(); const reads = [];
  const auth = { listUsers: async (limit, token) => token
    ? { users: [{ uid: 'pending', email: 'pending@example.test' }] }
    : { users: [{ uid: 'legacy', email: 'legacy@example.test' }], pageToken: 'next' } };
  const db = { collection: name => ({ doc: id => ({ name, id }) }), getAll: async (...refs) => refs.map(ref => {
    reads.push(`${ref.name}/${ref.id}`);
    return { data: () => ref.id === 'legacy' ? { role: 'teacher' } : ref.name === 'pendingRegistrations' ? { role: 'student' } : undefined };
  }) };
  const value = await authRoster(auth, db);
  assert.equal(value.teachers[0].id, 'legacy'); assert.equal(value.students[0].id, 'pending');
  assert.deepEqual(reads, ['users/legacy', 'users/pending', 'pendingRegistrations/pending']);
});

test('staff authorization checks revoked tokens and an active profile before cached reports', async () => {
  let profileReads = 0;
  const auth = { verifyIdToken: async (token, revoked) => { assert.equal(revoked, true); if (token === 'bad') throw Error(); return { uid: 'u' }; } };
  for (const role of ['admin', 'teacher', 'student']) {
    const db = { collection: () => ({ doc: () => ({ get: async () => { profileReads++; return { exists: true, data: () => ({ role, active: true }) }; } }) }) };
    const run = () => authorizeStaff(auth, db, { headers: { authorization: 'Bearer good' } }, ['admin', 'teacher']);
    if (role === 'student') await assert.rejects(run(), e => e.status === 403); else await run();
    await assert.rejects(authorizeStaff(auth, db, { headers: {} }), e => e.status === 401);
    await assert.rejects(authorizeStaff(auth, db, { headers: { authorization: 'Bearer bad' } }), e => e.status === 401);
  }
  assert.equal(profileReads, 3);
  const disabled = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ role: 'admin', active: false }) }) }) }) };
  await assert.rejects(authorizeStaff(auth, disabled, { headers: { authorization: 'Bearer good' } }), e => e.status === 403);
});

test('report validates dates, account count, kind and timezone before reading anything', () => {
  const valid = { kind: 'activity', start: '2026-11-01', end: '2026-11-03', ids: ['b', 'a', 'a'] };
  assert.deepEqual(reportRequest(valid).ids, ['a', 'b']);
  for (const patch of [{ kind: 'all' }, { start: '2026-02-30' }, { end: '2025-01-01' }, { ids: ['../bad'] },
    { ids: Array(51).fill('x') }, { offsetMinutes: 900 }, { end: '2028-01-01' }]) {
    assert.throws(() => reportRequest({ ...valid, ...patch }), e => e.status === 400);
  }
});

test('account deletion clears only its derived report caches in bounded pages', async () => {
  const records = new Map(Array.from({ length: 205 }, (_, i) => [`own-${i}`, ['student']]));
  records.set('other', ['other']); let pages = 0;
  const db = {
    collection: name => { assert.equal(name, 'dashboardReportCache'); return {
      where: (field, op, id) => { assert.equal(field, 'subjectIds'); assert.equal(op, 'array-contains'); return {
        limit: size => { assert.equal(size, 100); return { get: async () => {
          pages++; const docs = [...records].filter(([, ids]) => ids.includes(id)).slice(0, size).map(([ref]) => ({ ref }));
          return { docs, empty: docs.length === 0 };
        } }; },
      }; },
    }; },
    batch: () => { const ids = []; return { delete: id => ids.push(id), commit: async () => ids.forEach(id => records.delete(id)) }; },
  };
  await purgeReportCache(db, 'student');
  assert.equal(pages, 4); assert.deepEqual([...records.keys()], ['other']);
});

test('persistent summary cache shares concurrent builds, expires, refreshes and retries failures', async () => {
  const records = new Map(); let builds = 0, writes = 0, clock = 100;
  const db = { projectId: 'cache-test', collection: () => ({ doc: id => ({ get: async () => ({ data: () => records.get(id) }), set: async value => { writes++; records.set(id, value); } }) }) };
  const input = { kind: 'activity', start: '2026-11-01', end: '2026-11-03', ids: ['s'] };
  const options = { now: () => clock, build: async () => { builds++; return { s: { pointEarned: builds } }; } };
  const [a, b] = await Promise.all([dashboardReport(db, input, options), dashboardReport(db, input, options)]);
  assert.deepEqual(a, b); assert.equal(builds, 1); assert.equal(writes, 1);
  await dashboardReport(db, input, options); assert.equal(builds, 1);
  clock += 120001; await dashboardReport(db, input, options); assert.equal(builds, 2);
  await dashboardReport(db, { ...input, refresh: true }, options); assert.equal(builds, 3);
  await assert.rejects(dashboardReport(db, { ...input, ids: ['other'] }, { ...options, build: async () => { throw Error('offline'); } }), /offline/);
  await dashboardReport(db, { ...input, ids: ['other'] }, options); assert.equal(builds, 4);
  await dashboardReport(db, { ...input, includeTotals: true }, options); assert.equal(builds, 5);
});
