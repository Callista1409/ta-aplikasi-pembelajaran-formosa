import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
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

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const emilyId = 'RHsbfSpbJRUOilmaixcglsK2He43';
const emptyCategoryCounts = { writing: 0, listening: 0, speaking: 0, reading: 0 };

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

async function setDoc(collectionName, id, data) {
  await db.collection(collectionName).doc(id).set(
    {
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function seedPointRules() {
  const rules = [
    { id: 'writing', category: 'writing', point: 10, minimumPoint: 0, penaltyPerMistake: 0 },
    { id: 'listening', category: 'listening', point: 3, minimumPoint: 0, penaltyPerMistake: 0 },
    { id: 'speaking', category: 'speaking', point: 6, minimumPoint: 0, penaltyPerMistake: 0 },
    { id: 'reading', category: 'reading', point: 7, minimumPoint: 0, penaltyPerMistake: 0 },
  ];

  for (const rule of rules) {
    const { id, ...data } = rule;
    await setDoc('questionPointRules', id, {
      ...data,
      active: true,
      retryCanEarnPoint: false,
      wrongPoint: 0,
    });
  }
}

async function seedAccessories() {
  const accessories = [
    { id: 'ribbon', name: 'Pita Merah', price: 0, icon: 'R', slot: 'head', order: 1 },
    { id: 'hat', name: 'Topi Panda', price: 350, icon: 'H', slot: 'head', order: 2 },
    { id: 'glasses', name: 'Kacamata Bulat', price: 180, icon: 'G', slot: 'face', order: 3 },
    { id: 'star', name: 'Bintang Level', price: 250, icon: 'S', slot: 'body', order: 4 },
  ];

  for (const accessory of accessories) {
    const { id, ...data } = accessory;
    await setDoc('accessories', id, { ...data, active: true });
  }
}

async function seedStudentState() {
  await setDoc('studentPoints', emilyId, {
    monthlyPoints: 200,
    studentId: emilyId,
    totalPoints: 200,
    weeklyPoints: 50,
  });

  await setDoc('studentAccessories', `${emilyId}_ribbon`, {
    accessoryId: 'ribbon',
    equipped: false,
    owned: true,
    studentId: emilyId,
  });

  const salutationCards = ['fc-nihao', 'fc-xiexie', 'fc-zaijian', 'fc-qingwen', 'fc-zaoshanghao'];
  for (const cardId of salutationCards) {
    await setDoc('studentProgress', `${emilyId}_${cardId}`, {
      flashcardId: cardId,
      learned: true,
      learnedAt: FieldValue.serverTimestamp(),
      studentId: emilyId,
      unitId: 'salutation',
    });
  }

  const currentWeekStart = startOfWeek(new Date(2026, 5, 22));
  const previousWeekStart = addDays(currentWeekStart, -7);

  for (const [index, cardId] of salutationCards.entries()) {
    const logDate = addDays(currentWeekStart, Math.min(index, 2));
    await setDoc('studentActivityLogs', `seed_${emilyId}_${dateId(logDate)}_learn_${cardId}`, {
      categoryCounts: emptyCategoryCounts,
      createdAt: new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate(), 9, index),
      dateId: dateId(logDate),
      dayIndex: dayIndex(logDate),
      flashcardId: cardId,
      monthId: monthId(logDate),
      pointEarned: 0,
      questionCount: 0,
      studentId: emilyId,
      type: 'learn_flashcard',
      unitId: 'salutation',
      weekId: weekId(logDate),
    });
  }

  const sessions = [
    { date: addDays(currentWeekStart, 0), points: 12, questions: 4, counts: { writing: 1, listening: 1, speaking: 1, reading: 1 } },
    { date: addDays(currentWeekStart, 1), points: 18, questions: 4, counts: { writing: 1, listening: 1, speaking: 1, reading: 1 } },
    { date: addDays(currentWeekStart, 2), points: 20, questions: 5, counts: { writing: 2, listening: 1, speaking: 1, reading: 1 } },
    { date: addDays(previousWeekStart, 0), points: 14, questions: 4, counts: { writing: 1, listening: 1, speaking: 1, reading: 1 } },
    { date: addDays(previousWeekStart, 2), points: 22, questions: 5, counts: { writing: 2, listening: 1, speaking: 1, reading: 1 } },
    { date: addDays(previousWeekStart, 4), points: 16, questions: 4, counts: { writing: 1, listening: 1, speaking: 1, reading: 1 } },
  ];

  for (const [index, session] of sessions.entries()) {
    await setDoc('studentActivityLogs', `seed_${emilyId}_${dateId(session.date)}_test_${index}`, {
      categoryCounts: { ...emptyCategoryCounts, ...session.counts },
      createdAt: new Date(session.date.getFullYear(), session.date.getMonth(), session.date.getDate(), 16, index),
      dateId: dateId(session.date),
      dayIndex: dayIndex(session.date),
      flashcardId: null,
      monthId: monthId(session.date),
      pointEarned: session.points,
      questionCount: session.questions,
      studentId: emilyId,
      type: 'test_session',
      unitId: 'salutation',
      weekId: weekId(session.date),
    });
  }
}

async function main() {
  console.log('Melengkapi data demo murid...');
  await seedPointRules();
  await seedAccessories();
  await seedStudentState();
  console.log('Selesai melengkapi: questionPointRules, accessories, studentPoints, studentProgress, studentAccessories, studentActivityLogs.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
