import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { deleteManagedAccount } from './account-deletion.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('This test requires a local Firestore emulator.');

test('real emulator transactions remove multiple pages and finalize a minimal receipt', { skip: !host }, async () => {
  // Explicit demo project + local emulator, with an in-memory Auth stub: never production accounts.
  const id = `delete-test-${randomUUID()}`;
  const app = initializeApp({ projectId: 'demo-formosa-stage2' }, id);
  const db = getFirestore(app);
  const refs = [];
  const add = (name, key, data, batch) => { const ref = db.collection(name).doc(key); refs.push(ref); batch.set(ref, data); };
  try {
    const batch = db.batch();
    add('users', id, { role: 'student', active: true, username: id }, batch);
    add('studentPoints', id, { totalPoints: 10 }, batch);
    add('pendingRegistrations', id, { uid: id }, batch);
    add('loginUsernames', id, { uid: id }, batch);
    add('testSessions', id, { studentId: id }, batch);
    add('studentQuestionProgress', id, { studentId: id }, batch);
    add('studentComments', id, { studentId: id }, batch);
    add('studentPracticeSessions', id, { studentId: id }, batch);
    add('studentPracticeAnswerEvents', id, { studentId: id }, batch);
    add('studentAssessmentLegacy', id, { studentId: id }, batch);
    add('dashboardReportCache', id, { subjectIds: [id], result: {} }, batch);
    add('flashcards', id, { createdBy: id, unitId: 'preserved' }, batch);
    for (let i = 0; i < 205; i++) add('studentProgress', `${id}-${i}`, { studentId: id }, batch);
    await batch.commit();
    let deleted = false;
    const auth = {
      getUser: async () => ({ uid: id }), updateUser: async () => {}, revokeRefreshTokens: async () => {},
      deleteUser: async () => { deleted = true; },
    };
    const result = await deleteManagedAccount({ auth, db }, { uid: id, expectedRole: 'student', confirmation: 'HAPUS', actorUid: 'test-admin' });
    assert.equal(result.uid, id); assert.equal(deleted, true);
    assert.equal((await db.collection('users').doc(id).get()).exists, false);
    assert.equal((await db.collection('studentProgress').where('studentId', '==', id).get()).size, 0);
    assert.equal((await db.collection('studentQuestionProgress').doc(id).get()).exists, false);
    assert.equal((await db.collection('testSessions').doc(id).get()).exists, false);
    for (const name of ['studentPracticeSessions', 'studentPracticeAnswerEvents', 'studentAssessmentLegacy', 'dashboardReportCache']) {
      assert.equal((await db.collection(name).doc(id).get()).exists, false);
    }
    assert.equal((await db.collection('flashcards').doc(id).get()).exists, true);
    const receipt = db.collection('accountDeletionJobs').doc(id); refs.push(receipt);
    assert.equal((await receipt.get()).data().status, 'completed');
  } finally {
    const cleanup = db.batch(); refs.forEach(ref => cleanup.delete(ref)); await cleanup.commit();
    await db.terminate(); await deleteApp(app);
  }
});
