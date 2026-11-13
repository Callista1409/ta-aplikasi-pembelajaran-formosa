import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const csvPath = process.env.VOCAB_CSV ?? 'C:/Users/User/Downloads/mandarin_vocab_kelas1-6.csv';
const serviceAccountPath = resolve(
  projectRoot,
  process.env.FIREBASE_SERVICE_ACCOUNT ?? 'firebase-service-account.json',
);
const ownerId = process.env.IMPORT_OWNER_ID ?? 'DWyjnqO79KYrPzVTVCoxQI9zN0a2';
const dryRun = process.argv.includes('--dry-run');
const excludedHanzi = new Set(['王', '小贵', '小明', '阿']);

if (!existsSync(csvPath)) throw new Error(`CSV tidak ditemukan: ${csvPath}`);
if (!existsSync(serviceAccountPath)) throw new Error(`Service account tidak ditemukan: ${serviceAccountPath}`);

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const lessonTitles = {
  1: ['Angka dan Bilangan', 'Salam dan Sapaan', 'Ungkapan Sopan', 'Nama dan Marga', 'Hari, Tanggal, dan Tahun', 'Anggota Keluarga', 'Uang dan Belanja', 'Waktu dalam Sehari', 'Telepon dan Janji', 'Belajar Bahasa Mandarin'],
  2: ['Berpakaian dan Berangkat Sekolah', 'Alat Tulis dan Bertanya di Kelas', 'Bentuk, Ukuran, dan Penampilan', 'Anggota Tubuh dan Aktivitas', 'Makanan dan Minuman', 'Kendaraan dan Lalu Lintas', 'Warna, Cuaca, dan Olahraga', 'Musim dan Tanaman', 'Pekerjaan Rumah dan Rutinitas', 'Jadwal Kerja dan Sekolah'],
  3: ['Keluarga Besar', 'Kegiatan Ekstrakurikuler', 'Ujian dan Tugas Sekolah', 'Kesehatan dan Penyakit', 'Tempat dan Petunjuk Arah', 'Perasaan dan Konflik', 'Cabang Olahraga', 'Hobi dan Kegiatan Luang', 'Televisi dan Hiburan', 'Cuaca'],
  4: ['Ruang dan Fasilitas Sekolah', 'Mata Pelajaran', 'Ulang Tahun dan Ucapan', 'Hewan dan Perawatannya', 'Liburan dan Perjalanan', 'Ruangan di Rumah', 'Peralatan Makan dan Masakan', 'Kendaraan dan Transportasi', 'Kebersihan, Kerapian, dan Keamanan', 'Profesi dan Pekerjaan'],
  5: ['Keluarga dan Identitas', 'Negara dan Jenjang Sekolah', 'Kepribadian dan Pertemanan', 'Buku dan Cerita', 'Makanan dan Keluarga', 'Pekerjaan Rumah dan Keluarga', 'Kegiatan di Dapur', 'Kegiatan di Sekolah', 'Perayaan Tahun Baru Imlek', 'Sifat dan Perasaan'],
  6: ['Perayaan Tahun Baru Imlek', 'Sifat dan Hubungan Sosial', 'Fotografi dan Penghargaan', 'Idola dan Tokoh Terkenal', 'Tetangga dan Lingkungan', 'Kecelakaan dan Tren Busana', 'Orang Tua dan Keselamatan Jalan', 'Benua dan Negara'],
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])));
}

function gradeNumber(value) {
  const match = String(value).match(/(\d+)/);
  return Number(match?.[1] ?? 0);
}

function lessonNumber(value) { return Number(value); }
function unitId(grade, lesson) { return `csv-grade-${grade}-lesson-${lesson}`; }
function cardId(grade, lesson, index) { return `csv-fc-${grade}-${lesson}-${index + 1}`; }
function questionId(card, category) { return `csv-q-${card}-${category}`; }

function optionsFor(card, cards) {
  const alternatives = cards.filter((item) => item.meaning !== card.meaning).slice(0, 3).map((item) => item.meaning);
  return [card.meaning, ...alternatives];
}

async function commitInChunks(operations) {
  for (let index = 0; index < operations.length; index += 450) {
    const batch = db.batch();
    operations.slice(index, index + 450).forEach((operation) => operation(batch));
    batch.set(db.collection('contentMetadata').doc('catalog'), { revision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
  }
}

const rows = parseCsv(readFileSync(csvPath, 'utf8')).map((row) => ({
  grade: gradeNumber(row.Grade),
  lesson: lessonNumber(row.Lesson),
  hanzi: row.Chinese,
  pinyin: row.Pinyin,
  meaning: row.English,
})).filter((row) => row.grade >= 1 && row.grade <= 6 && row.lesson >= 1 && row.lesson <= 10 && row.hanzi && !excludedHanzi.has(row.hanzi));

const grouped = new Map();
rows.forEach((row) => {
  const key = `${row.grade}-${row.lesson}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row);
});

const units = [];
const cards = [];
for (const [key, words] of grouped) {
  const [grade, lesson] = key.split('-').map(Number);
  const id = unitId(grade, lesson);
  units.push({
    id,
    grade,
    name: `Pelajaran ${lesson}: ${lessonTitles[grade]?.[lesson - 1] ?? `Bab ${lesson}`}`,
    description: `Kelas ${grade} · ${words.length} kosakata Mandarin`,
    order: lesson,
  });
  words.forEach((word, index) => cards.push({ ...word, id: cardId(grade, lesson, index), unitId: id }));
}

const questions = cards.flatMap((card) => {
  const lessonCards = cards.filter((item) => item.unitId === card.unitId);
  const options = optionsFor(card, lessonCards);
  return [
    { id: questionId(card.id, 'writing'), category: 'writing', prompt: 'Tulis karakter sesuai urutan goresan.', correctAnswer: card.hanzi },
    { id: questionId(card.id, 'listening'), category: 'listening', prompt: 'Dengarkan audio, lalu pilih arti yang tepat.', correctAnswer: card.meaning, audioText: card.hanzi, options },
    { id: questionId(card.id, 'speaking'), category: 'speaking', prompt: 'Ucapkan kosakata berikut.', correctAnswer: card.hanzi },
    { id: questionId(card.id, 'reading'), category: 'reading', prompt: 'Apa arti kosakata tersebut?', correctAnswer: card.meaning, passage: card.hanzi, options },
  ].map((question) => ({ ...question, flashcardId: card.id, unitId: card.unitId, createdBy: ownerId, active: true }));
});

console.log(`CSV terbaca: ${rows.length} kosakata, ${units.length} lesson, ${questions.length} soal.`);
if (dryRun) process.exit(0);

const [oldUnits, oldCards, oldQuestions] = await Promise.all([
  db.collection('units').get(),
  db.collection('flashcards').get(),
  db.collection('questions').get(),
]);
const archiveOperations = [
  ...oldUnits.docs.map((item) => (batch) => batch.set(item.ref, { active: false, archivedAt: FieldValue.serverTimestamp() }, { merge: true })),
  ...oldCards.docs.map((item) => (batch) => batch.set(item.ref, { active: false, archivedAt: FieldValue.serverTimestamp() }, { merge: true })),
  ...oldQuestions.docs.map((item) => (batch) => batch.set(item.ref, { active: false, archivedAt: FieldValue.serverTimestamp() }, { merge: true })),
];
await commitInChunks(archiveOperations);

const writeOperations = [
  ...units.map((unit) => (batch) => batch.set(db.collection('units').doc(unit.id), {
    active: true,
    createdBy: ownerId,
    description: unit.description,
    grade: unit.grade,
    name: unit.name,
    order: unit.order,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })),
  ...cards.map((card) => (batch) => batch.set(db.collection('flashcards').doc(card.id), {
    active: true,
    audioMode: 'tts',
    createdBy: ownerId,
    grade: card.grade,
    hanzi: card.hanzi,
    imageUrl: null,
    meaning: card.meaning,
    pinyin: card.pinyin,
    ttsText: card.hanzi,
    unitId: card.unitId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })),
  ...questions.map((question) => (batch) => batch.set(db.collection('questions').doc(question.id), {
    ...question,
    maximumPoint: question.category === 'writing' ? 10 : question.category === 'speaking' ? 6 : question.category === 'reading' ? 7 : 3,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })),
];
await commitInChunks(writeOperations);
console.log(`Import selesai: ${units.length} unit, ${cards.length} flashcard, ${questions.length} soal.`);
