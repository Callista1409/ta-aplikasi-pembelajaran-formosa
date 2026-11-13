import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const serviceAccountPath = resolve(
  projectRoot,
  process.env.FIREBASE_SERVICE_ACCOUNT ?? 'firebase-service-account.json',
);

if (!existsSync(serviceAccountPath)) {
  console.error(`Service account tidak ditemukan: ${serviceAccountPath}`);
  process.exit(1);
}

if (!getApps().length) {
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  initializeApp({ credential: cert(serviceAccount) });
}

const auth = getAuth();
const db = getFirestore();
const password = process.env.FORMOSA_STUDENT_PASSWORD ?? 'formosa123';
const emptyCategoryCounts = { writing: 0, listening: 0, speaking: 0, reading: 0 };

const students = [
  {
    displayName: 'Alicia Wong',
    username: 'alicia2017',
    email: 'alicia2017@formosa.student',
    grade: 2,
    totalPoints: 165,
    weeklyPoints: 38,
    monthlyPoints: 86,
    learnedCards: ['fc-nihao', 'fc-xiexie', 'fc-zaijian'],
  },
  {
    displayName: 'Jason Lim',
    username: 'jason2018',
    email: 'jason2018@formosa.student',
    grade: 2,
    totalPoints: 140,
    weeklyPoints: 24,
    monthlyPoints: 72,
    learnedCards: ['fc-nihao', 'fc-xiexie'],
  },
  {
    displayName: 'Michelle Tan',
    username: 'michelle2017',
    email: 'michelle2017@formosa.student',
    grade: 3,
    totalPoints: 210,
    weeklyPoints: 56,
    monthlyPoints: 118,
    learnedCards: ['fc-nihao', 'fc-xiexie', 'fc-zaijian', 'fc-qingwen'],
  },
  {
    displayName: 'Kevin Zhang',
    username: 'kevin2016',
    email: 'kevin2016@formosa.student',
    grade: 4,
    totalPoints: 120,
    weeklyPoints: 18,
    monthlyPoints: 50,
    learnedCards: ['fc-nihao'],
  },
  {
    displayName: 'Sophia Lee',
    username: 'sophia2018',
    email: 'sophia2018@formosa.student',
    grade: 2,
    totalPoints: 188,
    weeklyPoints: 42,
    monthlyPoints: 96,
    learnedCards: ['fc-nihao', 'fc-xiexie', 'fc-zaijian', 'fc-qingwen', 'fc-zaoshanghao'],
  },
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateId(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthId(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function dayIndex(date) {
  return (date.getDay() + 6) % 7;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - dayIndex(start));
  return start;
}

function weekId(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${pad(week)}`;
}

async function upsertUser(student) {
  let user;
  try {
    user = await auth.getUserByEmail(student.email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    user = await auth.createUser({
      disabled: false,
      displayName: student.displayName,
      email: student.email,
      password,
    });
  }

  await db.collection('users').doc(user.uid).set(
    {
      active: true,
      displayName: student.displayName,
      email: student.email,
      grade: student.grade,
      role: 'student',
      username: student.username,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return user.uid;
}

async function seedProgress(student, uid, index) {
  await db.collection('studentPoints').doc(uid).set(
    {
      monthlyPoints: student.monthlyPoints,
      studentId: uid,
      totalPoints: student.totalPoints,
      weeklyPoints: student.weeklyPoints,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const currentWeekStart = startOfWeek(new Date(2026, 5, 22));
  const learnDate = addDays(currentWeekStart, index % 5);
  const testDate = addDays(currentWeekStart, Math.min(index + 1, 6));

  for (const [cardIndex, cardId] of student.learnedCards.entries()) {
    await db.collection('studentProgress').doc(`${uid}_${cardId}`).set(
      {
        flashcardId: cardId,
        learned: true,
        learnedAt: FieldValue.serverTimestamp(),
        studentId: uid,
        unitId: 'salutation',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const logDate = addDays(learnDate, cardIndex % 2);
    await db.collection('studentActivityLogs').doc(`seed_${uid}_${dateId(logDate)}_learn_${cardId}`).set(
      {
        categoryCounts: emptyCategoryCounts,
        createdAt: new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate(), 9, cardIndex),
        dateId: dateId(logDate),
        dayIndex: dayIndex(logDate),
        flashcardId: cardId,
        monthId: monthId(logDate),
        pointEarned: 0,
        questionCount: 0,
        studentId: uid,
        type: 'learn_flashcard',
        unitId: 'salutation',
        updatedAt: FieldValue.serverTimestamp(),
        weekId: weekId(logDate),
      },
      { merge: true },
    );
  }

  await db.collection('studentActivityLogs').doc(`seed_${uid}_${dateId(testDate)}_test`).set(
    {
      categoryCounts: { writing: 3, listening: 2, speaking: 2, reading: 3 },
      createdAt: new Date(testDate.getFullYear(), testDate.getMonth(), testDate.getDate(), 16, index),
      dateId: dateId(testDate),
      dayIndex: dayIndex(testDate),
      flashcardId: null,
      monthId: monthId(testDate),
      pointEarned: student.weeklyPoints,
      questionCount: 10,
      studentId: uid,
      type: 'test_session',
      unitId: 'salutation',
      updatedAt: FieldValue.serverTimestamp(),
      weekId: weekId(testDate),
    },
    { merge: true },
  );
}

async function main() {
  console.log('Menambahkan 5 akun murid demo...');
  for (const [index, student] of students.entries()) {
    const uid = await upsertUser(student);
    await seedProgress(student, uid, index);
    console.log(`${student.displayName} | ${student.email} | UID: ${uid} | password: ${password}`);
  }
  console.log('Selesai. Akun Auth, users, studentPoints, studentProgress, dan studentActivityLogs sudah diperbarui.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
