import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  or,
  query,
  runTransaction,
  setDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  where,
} from 'firebase/firestore';

const projectId = 'demo-formosa-stage2';
let environment;

before(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8182';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Local emulator required.');
  const [hostname, port] = host.split(':');
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: hostname,
      port: Number(port),
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });

  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, role] of [
      ['admin-1', 'admin'],
      ['teacher-1', 'teacher'],
      ['student-1', 'student'],
      ['student-2', 'student'],
    ]) {
      await setDoc(doc(db, 'users', uid), { role });
    }

    await Promise.all([
      setDoc(doc(db, 'flashcards', 'card-1'), { unitId: 'unit-1', hanzi: '你好' }),
      setDoc(doc(db, 'questions', 'question-1'), { flashcardId: 'card-1' }),
      setDoc(doc(db, 'studentProgress', 'progress-student-1'), { studentId: 'student-1', flashcardId: 'card-1' }),
      setDoc(doc(db, 'studentProgress', 'progress-student-2'), { studentId: 'student-2', flashcardId: 'card-1' }),
      setDoc(doc(db, 'studentQuestionProgress', 'question-progress-student-1'), { studentId: 'student-1', questionId: 'question-1' }),
      setDoc(doc(db, 'studentActivityLogs', 'log-student-1'), { studentId: 'student-1', dateId: '2026-10-15' }),
      setDoc(doc(db, 'studentActivityLogs', 'log-student-2'), { studentId: 'student-2', dateId: '2026-10-15' }),
    ]);
  });
});

after(async () => {
  await environment?.cleanup();
});

test('signed-in student can query content needed for a unit and its test', async () => {
  const db = environment.authenticatedContext('student-1', { email: 'student@example.test' }).firestore();
  const cards = await assertSucceeds(getDocs(query(collection(db, 'flashcards'), where('unitId', '==', 'unit-1'))));
  const questions = await assertSucceeds(getDocs(query(collection(db, 'questions'), where('flashcardId', 'in', ['card-1']))));
  assert.equal(cards.size, 1);
  assert.equal(questions.size, 1);
});

test('student can read only their own scoped card and question progress', async () => {
  const db = environment.authenticatedContext('student-1').firestore();
  const ownProgress = await assertSucceeds(getDocs(query(collection(db, 'studentProgress'), where('studentId', '==', 'student-1'))));
  const ownQuestionProgress = await assertSucceeds(getDocs(query(collection(db, 'studentQuestionProgress'), where('studentId', '==', 'student-1'))));
  assert.equal(ownProgress.size, 1);
  assert.equal(ownQuestionProgress.size, 1);

  await assertFails(getDocs(query(collection(db, 'studentProgress'), where('studentId', '==', 'student-2'))));
  await assertFails(getDocs(collection(db, 'studentProgress')));
});

test('student can query only their own activity within a selected date range', async () => {
  const db = environment.authenticatedContext('student-1').firestore();
  const ownLogs = await assertSucceeds(getDocs(query(
    collection(db, 'studentActivityLogs'),
    where('studentId', '==', 'student-1'),
    where('dateId', '>=', '2026-10-01'),
    where('dateId', '<=', '2026-10-31'),
  )));
  assert.equal(ownLogs.size, 1);

  await assertFails(getDocs(query(collection(db, 'studentActivityLogs'), where('studentId', '==', 'student-2'))));
  await assertFails(getDocs(collection(db, 'studentActivityLogs')));
});

test('teacher and admin can read scoped report data across students', async () => {
  for (const uid of ['teacher-1', 'admin-1']) {
    const db = environment.authenticatedContext(uid).firestore();
    const progress = await assertSucceeds(getDocs(collection(db, 'studentProgress')));
    const logs = await assertSucceeds(getDocs(collection(db, 'studentActivityLogs')));
    assert.equal(progress.size, 2);
    assert.equal(logs.size, 2);
  }
});

test('unit OR query deduplicates canonical/legacy matches and includes legacy cards', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'flashcards', 'both-fields'), { unitId: 'unit-or', unitID: 'unit-or' });
    await setDoc(doc(context.firestore(), 'flashcards', 'legacy-only'), { unitID: 'unit-or' });
  });
  const db = environment.authenticatedContext('student-1').firestore();
  const cards = await assertSucceeds(getDocs(query(collection(db, 'flashcards'), or(where('unitId', '==', 'unit-or'), where('unitID', '==', 'unit-or')))));
  assert.equal(cards.size, 2);
});

test('batched progress reads retain ownership protection and allow empty/new-student results', async () => {
  const db = environment.authenticatedContext('student-1').firestore();
  const cards = await assertSucceeds(getDocs(query(collection(db, 'studentProgress'), where('studentId', '==', 'student-1'), where('flashcardId', 'in', ['card-1', 'missing']))));
  const questions = await assertSucceeds(getDocs(query(collection(db, 'studentQuestionProgress'), where('studentId', '==', 'student-1'), where('questionId', 'in', ['question-1', 'missing']))));
  assert.equal(cards.size, 1); assert.equal(questions.size, 1);
  const empty = await assertSucceeds(getDocs(query(collection(db, 'studentQuestionProgress'), where('studentId', '==', 'student-1'), where('questionId', 'in', ['missing']))));
  assert.equal(empty.size, 0);
  await assertFails(getDocs(query(collection(db, 'studentProgress'), where('studentId', '==', 'student-2'), where('flashcardId', 'in', ['card-1']))));
});

test('posttest session query returns only the current session and permits an absent session', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'testSessions', 'current'), { id: 'current', studentId: 'student-1' });
    await setDoc(doc(db, 'testSessions', 'historical'), { id: 'historical', studentId: 'student-1' });
    await setDoc(doc(db, 'testSessions', 'other-student'), { id: 'other-student', studentId: 'student-2' });
  });
  const db = environment.authenticatedContext('student-1').firestore();
  const source = id => query(collection(db, 'testSessions'), where('studentId', '==', 'student-1'), where('id', '==', id));
  assert.equal((await assertSucceeds(getDocs(source('current')))).size, 1);
  assert.equal((await assertSucceeds(getDocs(source('missing')))).size, 0);
  assert.equal((await assertSucceeds(getDocs(source('other-student')))).size, 0);
  await assertFails(getDocs(query(collection(db, 'testSessions'), where('studentId', '==', 'student-2'), where('id', '==', 'other-student'))));
});

test('only staff can publish monotonic catalog revisions; students can read even before initialization', async () => {
  const student = environment.authenticatedContext('student-1').firestore();
  const teacher = environment.authenticatedContext('teacher-1').firestore();
  const admin = environment.authenticatedContext('admin-1').firestore();
  const catalog = db => doc(db, 'contentMetadata', 'catalog');
  await environment.withSecurityRulesDisabled(async context => {
    const { deleteDoc } = await import('firebase/firestore');
    await deleteDoc(catalog(context.firestore()));
  });
  assert.equal((await assertSucceeds(getDoc(catalog(student)))).exists(), false);
  await assertFails(setDoc(catalog(student), { revision: 1, updatedAt: serverTimestamp() }));
  const batch = writeBatch(teacher);
  batch.set(doc(teacher, 'flashcards', 'revision-card'), { unitId: 'unit-revision', active: true });
  batch.set(catalog(teacher), { revision: increment(1), updatedAt: serverTimestamp() }, { merge: true });
  await assertSucceeds(batch.commit());
  await assertSucceeds(setDoc(catalog(admin), { revision: increment(1), updatedAt: serverTimestamp() }, { merge: true }));
  assert.equal((await getDoc(catalog(student))).data().revision, 2);
  await assertFails(setDoc(catalog(teacher), { revision: 99, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(catalog(teacher), { revision: increment(1), unexpected: true, updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(getDocs(collection(student, 'contentMetadata')));
  await assertFails(getDoc(catalog(environment.unauthenticatedContext().firestore())));
});
// Student operations now pass through the Student API. Direct SDK requests must fail.
test('students cannot create, overwrite, update, delete or claim economic and assessment documents', async () => {
  const { deleteDoc } = await import('firebase/firestore');
  const names = ['studentProgress', 'studentQuestionProgress', 'studentPracticeSessions',
    'studentPracticeAnswerEvents', 'studentAccessories', 'testSessions', 'testAnswers', 'studentActivityLogs'];
  const student = environment.authenticatedContext('student-1').firestore();
  for (const name of names) {
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), name, 'security-existing'), { studentId: 'student-2', score: 1 });
      await setDoc(doc(context.firestore(), name, 'security-own'), { studentId: 'student-1', score: 1 });
    });
    await assertFails(setDoc(doc(student, name, 'security-new'), { studentId: 'student-1', score: 999999 }));
    await assertFails(setDoc(doc(student, name, 'security-existing'), { studentId: 'student-1', score: 999999 }));
    await assertFails(updateDoc(doc(student, name, 'security-own'), { score: 999999 }));
    await assertFails(deleteDoc(doc(student, name, 'security-own')));
  }
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'studentPoints', 'student-1'),
    { studentId: 'student-1', starBalance: 10, totalStarsEarned: 10 }));
  await assertFails(updateDoc(doc(student, 'studentPoints', 'student-1'), { starBalance: 999999 }));
  await assertFails(setDoc(doc(student, 'studentPoints', 'student-2'), { starBalance: 999999 }));
  await assertFails(deleteDoc(doc(student, 'studentPoints', 'student-1')));
  await assertSucceeds(getDoc(doc(student, 'studentPoints', 'student-1')));
  await assertFails(getDoc(doc(student, 'studentPoints', 'student-2')));
});

test('students cannot edit roles, teaching content, accessory prices or global logs', async () => {
  const student = environment.authenticatedContext('student-1').firestore();
  for (const name of ['users', 'units', 'questions', 'flashcards', 'accessories', 'questionPointRules', 'levelRules', 'activityLogs']) {
    await assertFails(setDoc(doc(student, name, name === 'users' ? 'student-1' : 'security-write'), { role: 'admin', price: 0 }));
  }
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(anonymous, 'studentPoints', 'student-1'), { starBalance: 999999 }));
  const teacher = environment.authenticatedContext('teacher-1').firestore();
  await assertFails(setDoc(doc(teacher, 'studentPoints', 'student-1'), { starBalance: 999999 }));
  const admin = environment.authenticatedContext('admin-1').firestore();
  await assertSucceeds(updateDoc(doc(admin, 'studentPoints', 'student-1'), { starBalance: 10 }));
});

test('registration remains possible without permission to self-approve or assign admin', async () => {
  const applicant = environment.authenticatedContext('applicant', { email: 'applicant@example.test' }).firestore();
  const registration = { email: 'applicant@example.test', role: 'student', grade: 1, status: 'pending' };
  await assertSucceeds(setDoc(doc(applicant, 'pendingRegistrations', 'applicant'), registration));
  await assertSucceeds(updateDoc(doc(applicant, 'pendingRegistrations', 'applicant'), { emailVerified: true, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(applicant, 'pendingRegistrations', 'applicant'), { status: 'approved' }));
  await assertFails(updateDoc(doc(applicant, 'pendingRegistrations', 'applicant'), { role: 'admin' }));
  await assertFails(setDoc(doc(applicant, 'users', 'applicant'), { role: 'admin' }));
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'accountDeletionJobs', 'deleted-applicant'), { status: 'completed' }));
  const deleted = environment.authenticatedContext('deleted-applicant', { email: registration.email }).firestore();
  await assertFails(setDoc(doc(deleted, 'pendingRegistrations', 'deleted-applicant'), registration));
});
