import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { authorizeStudent, studentAction, assess } from './student-learning.mjs';
import { posttestRequirements } from './student-curriculum/content/posttest-curriculum.mjs';
import { handleAdminRequest } from './server.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^127\.0\.0\.1:\d+$/.test(host)) throw new Error('Only a local emulator is allowed.');
const app = host ? initializeApp({ projectId: 'demo-formosa-student-security' }, `learning-${randomUUID()}`) : null;
const db = app ? getFirestore(app) : null;
after(async () => { if (db) await db.terminate(); if (app) await deleteApp(app); });
const integration = (name, fn) => test(name, { skip: !host }, fn);
const value = async (name, key) => (await db.collection(name).doc(key).get()).data();

async function fixture(stars = 600) {
  const uid = `s-${randomUUID()}`, unitId = `unit-${uid}`;
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), { role: 'student', grade: 1, active: true });
  batch.set(db.doc(`studentPoints/${uid}`), { studentId: uid, starBalance: stars, totalStarsEarned: stars });
  batch.set(db.doc(`units/${unitId}`), { name: 'Pelajaran 1', grade: 1 });
  const categories = ['reading', 'listening', 'speaking', 'writing', 'reading', 'reading', 'listening', 'speaking', 'speaking', 'writing'];
  const questionIds = categories.map((category, index) => {
    const cardId = `card-${uid}-${index}`, questionId = `q-${uid}-${index}`;
    batch.set(db.doc(`flashcards/${cardId}`), { unitId, hanzi: '你好', meaning: 'halo', pinyin: 'ni hao' });
    batch.set(db.doc(`studentProgress/${uid}_${cardId}`), { studentId: uid, flashcardId: cardId, learned: true });
    batch.set(db.doc(`questions/${questionId}`), { flashcardId: cardId, category, correctAnswer: 'halo' });
    return questionId;
  });
  const accessoryId = `hat-${uid}`;
  batch.set(db.doc(`accessories/${accessoryId}`), { price: 350, active: true });
  await batch.commit();
  const call = (action, body = {}) => studentAction(db, uid, action, body, new Date('2026-11-06T05:00:00Z'));
  const startBody = { sessionId: randomUUID(), unitId, questionIds,
    anchorQuestionIds: Object.fromEntries(categories.slice(0, 4).map((c, i) => [c, questionIds[i]])) };
  return { uid, unitId, accessoryId, call, startBody, categories };
}

test('token verification requires a bearer token and checks revocation', async () => {
  await assert.rejects(authorizeStudent({}, { headers: {} }), { status: 401 });
  const auth = { verifyIdToken: async (token, revoked) => { assert.equal(token, 'id-token'); assert.equal(revoked, true); return { uid: 'student' }; } };
  assert.equal((await authorizeStudent(auth, { headers: { authorization: 'Bearer id-token' } })).uid, 'student');
  await assert.rejects(authorizeStudent({ verifyIdToken: async () => { throw Error(); } }, { headers: { authorization: 'Bearer expired' } }), { status: 401 });
});

test('the server evaluates answers and reports the limits of browser speech/writing evidence', () => {
  const item = { category: 'reading', question: { correctAnswer: 'halo' }, card: { hanzi: '你好' } };
  assert.equal(assess(item, { response: 'wrong', skipped: false, correct: true }, false).basePoint, 0);
  assert.equal(assess(item, { response: 'halo', skipped: false }, false).basePoint, 7);
  assert.equal(assess({ ...item, category: 'speaking' }, { response: '你好', skipped: false }, false).verification, 'client-speech-transcript');
  const writing = assess({ ...item, category: 'writing' }, { response: '你好', skipped: false, writingMistakes: 2, writingStrokes: 10 }, false);
  assert.equal(writing.basePoint, 8); assert.equal(writing.verification, 'client-writing-telemetry');
  assert.throws(() => assess(item, { response: 'halo', skipped: 'false' }, false), { status: 400 });
});

integration('the API rejects fabricated rewards, foreign ownership, inactive profiles and deletion receipts', async () => {
  const f = await fixture();
  for (const action of ['initialize', 'accessory', 'practice-finish']) await assert.rejects(f.call(action, { studentId: 'other', starBalance: 999999 }), { status: 400 });
  await db.doc(`users/${f.uid}`).update({ active: false });
  await assert.rejects(f.call('initialize'), { status: 403 });
  await db.doc(`users/${f.uid}`).update({ active: true, role: 'teacher' });
  await assert.rejects(f.call('initialize'), { status: 403 });
  await db.doc(`users/${f.uid}`).update({ role: 'student' });
  await db.doc(`accountDeletionJobs/${f.uid}`).set({ status: 'completed' });
  await assert.rejects(f.call('initialize'), { status: 403 });
});

integration('practice uses canonical questions, enforces order and credits only once under concurrency', async () => {
  const f = await fixture(0), session = await f.call('practice-start', f.startBody);
  assert.equal(session.sessionOrder, 1);
  assert.equal((await f.call('practice-start', f.startBody)).sessionOrder, 1);
  const request = { sessionId: session.sessionId, questionOrder: 1, response: 'halo', skipped: false, writingMistakes: 0, writingStrokes: 0 };
  await assert.rejects(f.call('practice-answer', { ...request, awardedPoint: 99999 }), { status: 400 });
  await assert.rejects(f.call('practice-answer', { ...request, questionOrder: 2 }), { status: 409 });
  await assert.rejects(f.call('practice-finish', { sessionId: session.sessionId }), { status: 409 });
  const results = await Promise.all([f.call('practice-answer', request), f.call('practice-answer', request)]);
  assert.deepEqual(results.map(r => r.awardedPoint), [7, 7]);
  assert.equal((await value('studentQuestionProgress', `${f.uid}_${session.plan[0].questionId}`)).attempts, 1);
  await assert.rejects(f.call('practice-answer', { ...request, response: 'different' }), { status: 409 });
  let expected = 7;
  for (let order = 2; order <= 10; order++) {
    const category = f.categories[order - 1];
    const answer = await f.call('practice-answer', { ...request, questionOrder: order,
      response: ['speaking', 'writing'].includes(category) ? '你好' : 'halo', writingStrokes: category === 'writing' ? 10 : 0 });
    expected += answer.awardedPoint;
  }
  const finishes = await Promise.all([f.call('practice-finish', { sessionId: session.sessionId }), f.call('practice-finish', { sessionId: session.sessionId })]);
  assert.equal(finishes.filter(result => result.credited).length, 1);
  assert.equal((await value('studentPoints', f.uid)).starBalance, expected);
  const other = await fixture();
  await assert.rejects(other.call('practice-finish', { sessionId: session.sessionId }), { status: 404 });
});

integration('R3 rewards decrease 10/7/3/0 across sessions and retries do not consume another reward', async () => {
  const f = await fixture();
  const rewards = [];
  // Put the writing question first without changing its canonical identity.
  const ids = [...f.startBody.questionIds]; [ids[0], ids[3]] = [ids[3], ids[0]];
  for (let index = 0; index < 4; index++) {
    const session = await f.call('practice-start', { ...f.startBody, sessionId: randomUUID(), questionIds: ids });
    const body = { sessionId: session.sessionId, questionOrder: 1, response: '你好', skipped: false, writingMistakes: 0, writingStrokes: 10 };
    rewards.push((await f.call('practice-answer', body)).awardedPoint);
    assert.equal((await f.call('practice-answer', body)).awardedPoint, rewards.at(-1));
  }
  assert.deepEqual(rewards, [10, 7, 3, 0]);
});

integration('purchases use the server price, cannot overspend concurrently, and retries do not charge twice', async () => {
  const f = await fixture(400);
  await assert.rejects(f.call('accessory', { accessoryId: f.accessoryId, equipped: true, price: 0 }), { status: 400 });
  const otherId = `other-${f.uid}`; await db.doc(`accessories/${otherId}`).set({ price: 350 });
  const attempts = await Promise.allSettled([f.call('accessory', { accessoryId: f.accessoryId, equipped: true }), f.call('accessory', { accessoryId: otherId, equipped: true })]);
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
  assert.equal((await value('studentPoints', f.uid)).starBalance, 50);
  assert.equal((await value('studentPoints', f.uid)).totalStarsEarned, 400);
  const ownedId = attempts[0].status === 'fulfilled' ? f.accessoryId : otherId;
  assert.equal((await f.call('accessory', { accessoryId: ownedId, equipped: true })).charged, 0);
  assert.equal((await value('studentPoints', f.uid)).starBalance, 50);
});

integration('new accounts initialize at zero and legacy migration runs on the server', async () => {
  const f = await fixture();
  await db.doc(`studentPoints/${f.uid}`).delete();
  await f.call('initialize'); assert.equal((await value('studentPoints', f.uid)).starBalance, 0);
  await db.doc(`studentPoints/${f.uid}`).set({ totalPoints: 20 });
  await db.doc(`studentActivityLogs/${randomUUID()}`).set({ studentId: f.uid, pointEarned: 100 });
  await f.call('initialize');
  const account = await value('studentPoints', f.uid);
  assert.equal(account.starBalance, 20); assert.equal(account.totalStarsEarned, 100);
});

integration('self-reported learning is grade-scoped, awards zero stars, and bulk undo preserves manual marks', async () => {
  const f = await fixture(), cardId = `card-${f.uid}-0`;
  await f.call('progress', { ids: [cardId], learned: true, source: 'manual' });
  assert.deepEqual((await f.call('progress', { ids: [cardId], learned: false, source: 'bulk' })).changed, []);
  const foreign = await fixture();
  await db.doc(`users/${foreign.uid}`).update({ grade: 2 });
  await assert.rejects(foreign.call('progress', { ids: [cardId], learned: true, source: 'manual' }), { status: 403 });
  assert.equal((await value('studentPoints', f.uid)).starBalance, 600);
  await db.doc(`users/${f.uid}`).update({ grade: 5 });
  const supportingUnit = `supporting-${f.uid}`, supportingCard = `supporting-card-${f.uid}`;
  await db.doc(`units/${supportingUnit}`).set({ grade: 1, name: 'Pelajaran 6' });
  await db.doc(`flashcards/${supportingCard}`).set({ unitID: supportingUnit, hanzi: '哥哥' });
  assert.deepEqual((await f.call('progress', { ids: [supportingCard], learned: true, source: 'bulk' })).changed, [supportingCard]);
});

integration('posttest plan and scores come from canonical server curriculum, answers are append-only', async () => {
  const f = await fixture();
  const batch = db.batch();
  for (const [index, requirement] of posttestRequirements(1).entries()) {
    const unitId = `curriculum-g1-chapter-${requirement.chapter}`;
    batch.set(db.doc(`units/${unitId}`), { name: `Pelajaran ${requirement.chapter}`, grade: 1 });
    batch.set(db.doc(`flashcards/curriculum-${index}`), { unitId, hanzi: requirement.word, meaning: requirement.word, pinyin: 'pinyin' });
  }
  await batch.commit();
  await assert.rejects(f.call('posttest-start', { plan: [] }), { status: 400 });
  const session = await f.call('posttest-start'); assert.equal(session.plan.length, 60);
  const first = session.plan[0];
  const body = { questionId: first.questionId, response: '', skipped: true, writingMistakes: 0, writingStrokes: 0 };
  await assert.rejects(f.call('posttest-answer', { ...body, score: 100 }), { status: 400 });
  const result = await f.call('posttest-answer', body);
  assert.equal(result.answers.length, 1); assert.equal(result.answers[0].score, 0);
  assert.equal((await f.call('posttest-answer', body)).answers.length, 1);
  await assert.rejects(f.call('posttest-answer', { ...body, response: 'changed' }), { status: 409 });
  // An old session's boolean/score fields are untrusted. Keep a backup and re-grade responses.
  await db.doc(`testSessions/${session.id}`).update({ protocolVersion: 0,
    answers: [{ ...body, correct: true, score: 999999 }], score: 999999 });
  const migrated = await f.call('posttest-start');
  assert.equal(migrated.protocolVersion, 1); assert.equal(migrated.answers[0].score, 0); assert.equal(migrated.score, 0);
  assert.equal((await value('studentAssessmentLegacy', session.id)).score, 999999);
  const snapshots = await Promise.all([f.call('posttest-start'), f.call('posttest-start')]);
  assert.deepEqual(snapshots.map(item => item.answers.length), [1, 1]);
});

integration('HTTP student routes authenticate the token, ignore no injected identity, and enforce payload limits', async () => {
  const f = await fixture();
  const invoke = async (body, authorization = 'Bearer valid') => {
    const response = { setHeader() {}, writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
    await handleAdminRequest({ method: 'POST', url: '/api/student/initialize', headers: { authorization }, body }, response, {
      db, auth: { verifyIdToken: async (token, revoked) => {
        assert.equal(revoked, true); if (token !== 'valid') throw Error(); return { uid: f.uid };
      } }, logger: { error() {} },
    });
    return response;
  };
  assert.equal((await invoke({})).status, 200);
  assert.equal((await invoke({}, '')).status, 401);
  assert.equal((await invoke({}, 'Bearer invalid')).status, 401);
  assert.equal((await invoke({ uid: 'someone-else' })).status, 400);
  assert.equal((await invoke({ data: 'a'.repeat(20001) })).status, 413);
});
