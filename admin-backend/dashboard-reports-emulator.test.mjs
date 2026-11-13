import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { buildReport, reportRequest } from './dashboard-reports.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw Error('Local emulator required.');
test('summaries preserve totals, legacy missing fields, timestamp deduplication and inactive filtering', { skip: !host }, async () => {
  const app = initializeApp({ projectId: 'demo-formosa-dashboard-reports' }, randomUUID());
  const db = getFirestore(app), id = randomUUID(), refs = [];
  const [hostname, port] = host.split(':');
  const environment = await initializeTestEnvironment({ projectId: 'demo-formosa-dashboard-reports', firestore: {
    host: hostname, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
  } });
  const set = async (name, key, data) => { const ref = db.collection(name).doc(key); refs.push(ref); await ref.set(data); };
  try {
    for (let i = 0; i < 12; i++) await set('studentActivityLogs', `${id}-${i}`, {
      studentId: id, dateId: '2026-11-02', type: 'test_session', pointEarned: 2, questionCount: 10,
      categoryCounts: { reading: 3, writing: 2, listening: 4, speaking: 1 },
    });
    await set('studentActivityLogs', `${id}-legacy`, { studentId: id, dateId: '2026-11-02', type: 'learn_flashcard', pointEarned: 0 });
    await set('studentActivityLogs', `${id}-outside`, { studentId: id, dateId: '2026-10-01', type: 'test_session', pointEarned: 999 });
    await set('studentPoints', id, { totalStarsEarned: 50, totalPoints: 4 });
    const rows = await buildReport(db, reportRequest({ kind: 'activity', start: '2026-11-01', end: '2026-11-03', ids: [id], includeTotals: true, includeCategories: true }));
    assert.equal(rows[id].pointEarned, 24); assert.equal(rows[id].questionCount, 120);
    assert.equal(rows[id].learnedCount, 1); assert.equal(rows[id].totalPoints, 50);
    assert.deepEqual(rows[id].categoryCounts, { writing: 24, listening: 48, speaking: 12, reading: 36 });
    const inside = Timestamp.fromDate(new Date('2026-11-02T00:00:00Z'));
    const outside = Timestamp.fromDate(new Date('2026-10-01T00:00:00Z'));
    for (const name of ['flashcards', 'questions']) {
      await set(name, `${id}-both`, { createdBy: id, createdAt: inside, updatedAt: inside });
      await set(name, `${id}-updated-only`, { createdBy: id, updatedAt: inside });
      await set(name, `${id}-inactive`, { createdBy: id, active: false, createdAt: inside, updatedAt: inside });
      await set(name, `${id}-outside`, { createdBy: id, createdAt: outside, updatedAt: outside });
    }
    const content = await buildReport(db, reportRequest({ kind: 'content', start: '2026-11-01', end: '2026-11-03', ids: [id] }));
    assert.deepEqual(content[id], { flashcards: 2, questions: 2 });
    await set('dashboardReportCache', id, { result: rows });
    for (const role of ['admin', 'teacher', 'student']) {
      const uid = `${id}-${role}`;
      await set('users', uid, { role, active: true });
      const client = environment.authenticatedContext(uid).firestore();
      await assertFails(getDoc(doc(client, 'dashboardReportCache', id)));
      await assertFails(setDoc(doc(client, 'dashboardReportCache', id), { result: {} }));
    }
  } finally {
    await environment.cleanup();
    const batch = db.batch(); refs.forEach(ref => batch.delete(ref)); await batch.commit();
    await db.terminate(); await deleteApp(app);
  }
});
