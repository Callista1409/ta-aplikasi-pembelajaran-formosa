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

const defaultPassword = process.env.FORMOSA_DEFAULT_PASSWORD ?? 'Formosa@12345';

if (!existsSync(serviceAccountPath)) {
  console.error(`Service account tidak ditemukan: ${serviceAccountPath}`);
  console.error('Simpan file JSON dari Firebase Service Accounts ke path itu, lalu jalankan lagi.');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const auth = getAuth();
const db = getFirestore();

const authUsers = [
  {
    uid: 'DWyjnqO79KYrPzVTVCoxQI9zN0a2',
    email: 'adminformosa@formosa.admin',
    displayName: 'Miss Callista',
    role: 'admin',
    grade: null,
  },
  {
    uid: 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3',
    email: 'callista@formosa.teacher',
    displayName: 'Miss Callista',
    role: 'teacher',
    grade: null,
  },
  {
    uid: '082yGwETpjet0oxaKQqjkhLjYCw2',
    email: 'steven@formosa.teacher',
    displayName: 'Sir Steven',
    role: 'teacher',
    grade: null,
  },
  {
    uid: 'teacher-giovanni',
    email: 'giovanni@formosa.teacher',
    displayName: 'Miss Giovanni',
    role: 'teacher',
    grade: null,
  },
  {
    uid: 'tpgoyvAd9PbO9mDMovH2Y62bnyU2',
    email: 'clarista@formosa.teacher',
    displayName: 'Miss Clarista',
    role: 'teacher',
    grade: null,
  },
  {
    uid: 'xprqBZmPuuekvKfrRJoM7gerd1C2',
    email: 'fiedya@formosa.teacher',
    displayName: 'Miss Fiedya',
    role: 'teacher',
    grade: null,
  },
  {
    uid: 'RHsbfSpbJRUOilmaixcglsK2He43',
    email: 'emily2018@formosa.student',
    displayName: 'Emily',
    role: 'student',
    grade: 2,
  },
];

const units = [
  ['salutation', 1, 'Unit Salam', 'Salam dasar Mandarin', 1],
  ['introduction', 1, 'Unit Perkenalan Diri', 'Perkenalan diri sederhana', 2],
  ['family', 2, 'Unit Keluarga', 'Kosakata anggota keluarga', 1],
  ['numbers', 2, 'Unit Angka', 'Angka dasar Mandarin', 2],
  ['school', 3, 'Unit Sekolah', 'Kosakata sekolah', 1],
  ['food', 3, 'Unit Makanan', 'Makanan dan minuman', 2],
  ['time', 4, 'Unit Waktu', 'Hari dan waktu', 1],
  ['places', 5, 'Unit Tempat', 'Tempat umum', 1],
  ['conversation', 6, 'Unit Percakapan', 'Percakapan sehari-hari', 1],
].map(([id, grade, name, description, order]) => ({
  id,
  active: true,
  createdBy: 'DWyjnqO79KYrPzVTVCoxQI9zN0a2',
  description,
  grade,
  name,
  order,
}));

const flashcards = [
  ['fc-nihao', 'salutation', 1, '你好', 'nǐ hǎo', 'Halo', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'nihao.webp'],
  ['fc-xiexie', 'salutation', 1, '谢谢', 'xiè xie', 'Terima kasih', '082yGwETpjet0oxaKQqjkhLjYCw2', 'xiexie.webp'],
  ['fc-zaijian', 'salutation', 1, '再见', 'zài jiàn', 'Sampai jumpa', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'zaijian.webp'],
  ['fc-qingwen', 'salutation', 1, '请问', 'qǐng wèn', 'Permisi', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'qingwen.webp'],
  ['fc-zaoshanghao', 'salutation', 1, '早上好', 'zǎo shang hǎo', 'Selamat pagi', 'teacher-giovanni', 'zaoshanghao.webp'],
  ['fc-wojiao', 'introduction', 1, '我叫', 'wǒ jiào', 'Nama saya', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'wojiao.webp'],
  ['fc-mingzi', 'introduction', 1, '名字', 'míng zi', 'Nama', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'mingzi.webp'],
  ['fc-xuesheng', 'introduction', 1, '学生', 'xué sheng', 'Murid', '082yGwETpjet0oxaKQqjkhLjYCw2', 'xuesheng.webp'],
  ['fc-laoshi', 'introduction', 1, '老师', 'lǎo shī', 'Guru', 'teacher-giovanni', 'laoshi.webp'],
  ['fc-pengyou', 'introduction', 1, '朋友', 'péng you', 'Teman', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'pengyou.webp'],
  ['fc-jiaren', 'family', 2, '家人', 'jiā rén', 'Keluarga', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'jiaren.webp'],
  ['fc-mama', 'family', 2, '妈妈', 'mā ma', 'Ibu', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'mama.webp'],
  ['fc-baba', 'family', 2, '爸爸', 'bà ba', 'Ayah', '082yGwETpjet0oxaKQqjkhLjYCw2', 'baba.webp'],
  ['fc-gege', 'family', 2, '哥哥', 'gē ge', 'Kakak laki-laki', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'gege.webp'],
  ['fc-meimei', 'family', 2, '妹妹', 'mèi mei', 'Adik perempuan', 'teacher-giovanni', 'meimei.webp'],
  ['fc-keyi', 'conversation', 6, '可以', 'kě yǐ', 'Boleh', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'keyi.webp'],
  ['fc-bukeyi', 'conversation', 6, '不可以', 'bù kě yǐ', 'Tidak boleh', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'bukeyi.webp'],
  ['fc-duibuqi', 'conversation', 6, '对不起', 'duì bu qǐ', 'Maaf', '082yGwETpjet0oxaKQqjkhLjYCw2', 'duibuqi.webp'],
  ['fc-meiguanxi', 'conversation', 6, '没关系', 'méi guān xi', 'Tidak apa-apa', 'teacher-giovanni', 'meiguanxi.webp'],
  ['fc-qingzai', 'conversation', 6, '请再说一遍', 'qǐng zài shuō yí biàn', 'Tolong ulangi', 'vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'qingzai.webp'],
].map(([id, unitId, grade, hanzi, pinyin, meaning, createdBy, image]) => ({
  id,
  active: true,
  audioMode: 'tts',
  createdBy,
  grade,
  hanzi,
  imageUrl: `assets/flashcards/${image}`,
  meaning,
  pinyin,
  ttsText: hanzi,
  unitId,
}));

const optionsByMeaning = {
  Halo: ['Halo', 'Terima kasih', 'Sampai jumpa', 'Permisi'],
  'Terima kasih': ['Terima kasih', 'Halo', 'Sampai jumpa', 'Selamat pagi'],
  'Sampai jumpa': ['Sampai jumpa', 'Halo', 'Permisi', 'Terima kasih'],
  Permisi: ['Permisi', 'Selamat pagi', 'Halo', 'Sampai jumpa'],
  'Selamat pagi': ['Selamat pagi', 'Permisi', 'Terima kasih', 'Halo'],
  'Nama saya': ['Nama saya', 'Nama', 'Murid', 'Guru'],
  Nama: ['Nama', 'Nama saya', 'Teman', 'Guru'],
  Murid: ['Murid', 'Guru', 'Teman', 'Nama'],
  Guru: ['Guru', 'Murid', 'Nama', 'Teman'],
  Teman: ['Teman', 'Guru', 'Murid', 'Nama saya'],
  Keluarga: ['Keluarga', 'Ibu', 'Ayah', 'Teman'],
  Ibu: ['Ibu', 'Ayah', 'Keluarga', 'Adik perempuan'],
  Ayah: ['Ayah', 'Ibu', 'Keluarga', 'Kakak laki-laki'],
  'Kakak laki-laki': ['Kakak laki-laki', 'Adik perempuan', 'Ayah', 'Ibu'],
  'Adik perempuan': ['Adik perempuan', 'Kakak laki-laki', 'Ibu', 'Ayah'],
  Boleh: ['Boleh', 'Tidak boleh', 'Maaf', 'Tidak apa-apa'],
  'Tidak boleh': ['Tidak boleh', 'Boleh', 'Tolong ulangi', 'Maaf'],
  Maaf: ['Maaf', 'Tidak apa-apa', 'Boleh', 'Tolong ulangi'],
  'Tidak apa-apa': ['Tidak apa-apa', 'Maaf', 'Tidak boleh', 'Boleh'],
  'Tolong ulangi': ['Tolong ulangi', 'Maaf', 'Boleh', 'Tidak apa-apa'],
};

function buildQuestions(card) {
  const options = optionsByMeaning[card.meaning] ?? [card.meaning];
  return [
    {
      id: `q-${card.id.replace(/^fc-/, '')}-writing`,
      active: true,
      answerMode: 'strokeOrder',
      category: 'writing',
      correctAnswer: card.hanzi,
      createdBy: card.createdBy,
      flashcardId: card.id,
      prompt: 'Tulis karakter sesuai urutan goresan.',
      unitId: card.unitId,
    },
    {
      id: `q-${card.id.replace(/^fc-/, '')}-listening`,
      active: true,
      answerMode: 'multipleChoice',
      audioText: card.hanzi,
      category: 'listening',
      correctAnswer: card.meaning,
      createdBy: card.createdBy,
      flashcardId: card.id,
      options,
      prompt: 'Dengarkan audio, lalu pilih arti yang tepat.',
      unitId: card.unitId,
    },
    {
      id: `q-${card.id.replace(/^fc-/, '')}-speaking`,
      active: true,
      answerMode: 'speech',
      category: 'speaking',
      correctAnswer: card.hanzi,
      createdBy: card.createdBy,
      flashcardId: card.id,
      prompt: 'Ucapkan kosakata berikut.',
      unitId: card.unitId,
    },
    {
      id: `q-${card.id.replace(/^fc-/, '')}-reading`,
      active: true,
      answerMode: 'multipleChoice',
      category: 'reading',
      correctAnswer: card.meaning,
      createdBy: card.createdBy,
      flashcardId: card.id,
      options,
      passage: card.hanzi,
      prompt: 'Apa arti kosakata tersebut?',
      unitId: card.unitId,
    },
  ];
}

const questions = flashcards.flatMap(buildQuestions);

const pointRules = [
  {
    id: 'writing',
    active: true,
    category: 'writing',
    point: 10,
    minimumPoint: 0,
    penaltyPerMistake: 0,
    wrongPoint: 0,
    retryCanEarnPoint: false,
  },
  {
    id: 'listening',
    active: true,
    category: 'listening',
    point: 3,
    minimumPoint: 0,
    penaltyPerMistake: 0,
    wrongPoint: 0,
    retryCanEarnPoint: false,
  },
  {
    id: 'speaking',
    active: true,
    category: 'speaking',
    point: 6,
    minimumPoint: 0,
    penaltyPerMistake: 0,
    wrongPoint: 0,
    retryCanEarnPoint: false,
  },
  {
    id: 'reading',
    active: true,
    category: 'reading',
    point: 7,
    minimumPoint: 0,
    penaltyPerMistake: 0,
    wrongPoint: 0,
    retryCanEarnPoint: false,
  },
];

const accessories = [
  {
    id: 'ribbon',
    active: true,
    name: 'Pita Merah',
    price: 0,
    imageUrl: 'assets/accessories/ribbon.webp',
    slot: 'head',
    order: 1,
  },
  {
    id: 'hat',
    active: true,
    name: 'Topi Panda',
    price: 350,
    imageUrl: 'assets/accessories/hat.webp',
    slot: 'head',
    order: 2,
  },
  {
    id: 'glasses',
    active: true,
    name: 'Kacamata Bulat',
    price: 180,
    imageUrl: 'assets/accessories/glasses.webp',
    slot: 'face',
    order: 3,
  },
  {
    id: 'star',
    active: true,
    name: 'Bintang Level',
    price: 250,
    imageUrl: 'assets/accessories/star.webp',
    slot: 'body',
    order: 4,
  },
];

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

async function upsertActivityLog(id, data) {
  await db
    .collection('studentActivityLogs')
    .doc(id)
    .set(
      {
        ...data,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

async function upsertAuthUser(seedUser) {
  const payload = {
    email: seedUser.email,
    displayName: seedUser.displayName,
    disabled: !seedUser.active,
  };
  try {
    await auth.getUser(seedUser.uid);
    await auth.updateUser(seedUser.uid, payload);
    console.log(`Auth update: ${seedUser.email}`);
    return seedUser.uid;
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }

  try {
    await auth.createUser({
      uid: seedUser.uid,
      email: seedUser.email,
      password: defaultPassword,
      displayName: seedUser.displayName,
      disabled: !seedUser.active,
    });
    console.log(`Auth create: ${seedUser.email}`);
    return seedUser.uid;
  } catch (error) {
    if (error.code !== 'auth/email-already-exists') throw error;
    const existing = await auth.getUserByEmail(seedUser.email);
    await auth.updateUser(existing.uid, payload);
    console.warn(`Email sudah ada dengan UID berbeda: ${seedUser.email} -> ${existing.uid}`);
    return existing.uid;
  }
}

async function upsertDoc(collectionName, id, data) {
  const ref = db.collection(collectionName).doc(id);
  const snapshot = await ref.get();
  const timestamps = snapshot.exists
    ? { updatedAt: FieldValue.serverTimestamp() }
    : { createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
  const batch = db.batch();
  batch.set(ref, { ...data, ...timestamps }, { merge: true });
  if (['units', 'flashcards', 'questions', 'questionPointRules', 'levelRules'].includes(collectionName)) {
    batch.set(db.collection('contentMetadata').doc('catalog'), { revision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await batch.commit();
}

async function seedUsers() {
  for (const user of authUsers) {
    const uid = await upsertAuthUser({ ...user, active: true });
    const username = user.email.split('@')[0].toLowerCase();
    const profile = {
      active: true,
      displayName: user.displayName,
      email: user.email,
      grade: user.grade,
      role: user.role,
      username,
    };
    await upsertDoc('users', uid, profile);

  }
}

async function seedCollection(collectionName, items) {
  for (const item of items) {
    const { id, ...data } = item;
    await upsertDoc(collectionName, id, data);
  }
  console.log(`Seeded ${collectionName}: ${items.length} dokumen`);
}

async function seedStudentState() {
  await upsertDoc('studentPoints', emilyId, {
    studentId: emilyId,
    totalPoints: 200,
    weeklyPoints: 50,
    monthlyPoints: 200,
  });

  await upsertDoc('studentAccessories', `${emilyId}_ribbon`, {
    studentId: emilyId,
    accessoryId: 'ribbon',
    owned: true,
    equipped: false,
  });

  for (const card of flashcards.filter((card) => card.unitId === 'salutation').slice(0, 5)) {
    await upsertDoc('studentProgress', `${emilyId}_${card.id}`, {
      studentId: emilyId,
      flashcardId: card.id,
      unitId: card.unitId,
      learned: true,
      learnedAt: FieldValue.serverTimestamp(),
    });
  }

  await upsertDoc('activityLogs', `seed_${Date.now()}`, {
    actorId: 'DWyjnqO79KYrPzVTVCoxQI9zN0a2',
    actorName: 'Miss Callista',
    action: 'seedData',
    targetType: 'system',
    message: 'Data awal Formosa Mandarin dimasukkan otomatis.',
  });

  const currentWeekStart = startOfWeek(new Date(2026, 5, 22));
  const previousWeekStart = addDays(currentWeekStart, -7);
  const learnedCards = flashcards.filter((card) => card.unitId === 'salutation').slice(0, 5);

  for (const [index, card] of learnedCards.entries()) {
    const logDate = addDays(currentWeekStart, Math.min(index, 2));
    await upsertActivityLog(`seed_${emilyId}_${dateId(logDate)}_learn_${card.id}`, {
      categoryCounts: emptyCategoryCounts,
      createdAt: new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate(), 9, index),
      dateId: dateId(logDate),
      dayIndex: dayIndex(logDate),
      flashcardId: card.id,
      monthId: monthId(logDate),
      pointEarned: 0,
      questionCount: 0,
      studentId: emilyId,
      type: 'learn_flashcard',
      unitId: card.unitId,
      weekId: weekId(logDate),
    });
  }

  const weeklySessions = [
    { date: addDays(currentWeekStart, 0), points: 12, questions: 4, counts: { writing: 1, listening: 1, speaking: 1, reading: 1 } },
    { date: addDays(currentWeekStart, 1), points: 18, questions: 4, counts: { writing: 1, listening: 1, speaking: 1, reading: 1 } },
    { date: addDays(currentWeekStart, 2), points: 20, questions: 5, counts: { writing: 2, listening: 1, speaking: 1, reading: 1 } },
    { date: addDays(previousWeekStart, 0), points: 14, questions: 4, counts: { writing: 1, listening: 1, speaking: 1, reading: 1 } },
    { date: addDays(previousWeekStart, 2), points: 22, questions: 5, counts: { writing: 2, listening: 1, speaking: 1, reading: 1 } },
    { date: addDays(previousWeekStart, 4), points: 16, questions: 4, counts: { writing: 1, listening: 1, speaking: 1, reading: 1 } },
  ];

  for (const [index, session] of weeklySessions.entries()) {
    await upsertActivityLog(`seed_${emilyId}_${dateId(session.date)}_test_${index}`, {
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

  console.log('Seeded student state: points, ribbon, salutation progress, weekly/monthly logs');
}

async function main() {
  console.log('Mulai seed Firebase Formosa Mandarin...');
  console.log(`Password default akun baru: ${defaultPassword}`);
  await seedUsers();
  await seedCollection('units', units);
  await seedCollection('flashcards', flashcards);
  await seedCollection('questions', questions);
  await seedCollection('questionPointRules', pointRules);
  await seedCollection('accessories', accessories);
  await seedStudentState();

  console.log('Selesai. Cek Firebase Console untuk melihat data terbaru.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
