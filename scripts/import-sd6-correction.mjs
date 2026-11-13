import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const csvPath = resolve(scriptDir, 'data/sd6-correction-vocabulary.csv');
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm-project='))?.split('=')[1];
const importTag = 'sd6-correction-20261030';
const ownerId = process.env.IMPORT_OWNER_ID;
const pointValues = { writing: 10, listening: 3, speaking: 6, reading: 7 };

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
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])));
}

const words = parseCsv(readFileSync(csvPath, 'utf8')).map((row) => ({
  grade: Number(row.Grade),
  lesson: Number(row.Lesson),
  hanzi: row.Chinese,
  pinyin: row.Pinyin,
  meaning: row.English,
}));
const errors = [];
if (words.length !== 55) errors.push(`Diharapkan 55 kosakata, ditemukan ${words.length}.`);
if (new Set(words.map((word) => `${word.lesson}:${word.hanzi}`)).size !== words.length) errors.push('Ada karakter duplikat dalam bab yang sama.');
for (const word of words) {
  if (word.grade !== 6 || ![1, 2, 3].includes(word.lesson) || !word.hanzi || !word.pinyin || !word.meaning) errors.push(`Data tidak lengkap: ${JSON.stringify(word)}`);
}
if (errors.length) throw new Error(errors.join('\n'));

const units = [1, 2, 3].map((lesson) => ({
  id: `${importTag}-bab-${lesson}`,
  grade: 6,
  name: `Pelajaran ${lesson}: SD 6 Bab ${lesson} (Sementara)`,
  description: `Kumpulan koreksi sementara SD 6 Bab ${lesson}`,
  order: lesson,
}));
const cards = words.map((word, index) => ({
  ...word,
  id: `${importTag}-fc-${word.lesson}-${String(index + 1).padStart(2, '0')}`,
  unitId: `${importTag}-bab-${word.lesson}`,
}));
const cardsByUnit = new Map(units.map((unit) => [unit.id, cards.filter((card) => card.unitId === unit.id)]));
const questions = cards.flatMap((card) => {
  const distractors = cardsByUnit.get(card.unitId)
    .filter((other) => other.id !== card.id && other.meaning !== card.meaning)
    .slice(0, 3)
    .map((other) => other.meaning);
  const options = [card.meaning, ...distractors];
  const questionBase = `${importTag}-q-${card.id}`;
  return [
    { id: `${questionBase}-writing`, category: 'writing', prompt: 'Tulis karakter sesuai urutan goresan.', correctAnswer: card.hanzi },
    { id: `${questionBase}-listening`, category: 'listening', prompt: 'Dengarkan kosakata, lalu pilih artinya.', correctAnswer: card.meaning, audioText: card.hanzi, options },
    { id: `${questionBase}-speaking`, category: 'speaking', prompt: 'Ucapkan kosakata Mandarin berikut.', correctAnswer: card.hanzi },
    { id: `${questionBase}-reading`, category: 'reading', prompt: 'Apa arti kosakata Mandarin ini?', correctAnswer: card.meaning, passage: card.hanzi, options },
  ].map((question) => ({ ...question, flashcardId: card.id, unitId: card.unitId, createdBy: ownerId ?? 'local-staging', active: true }));
});

const writeCount = units.length + cards.length + questions.length + 1;
console.log(`Mode: ${apply ? 'APPLY DIMINTA' : 'DRY RUN (default)'}`);
console.log(`Unit baru: ${units.length}; flashcard: ${cards.length}; soal: ${questions.length}; metadata katalog: 1.`);
console.log(`Perkiraan penulisan Firestore: ${writeCount} dokumen.`);
console.log('Tidak ada arsip, penghapusan, atau perubahan dokumen tingkat lain dalam paket ini.');
if (writeCount >= 5000) console.warn('PERINGATAN: rencana impor mencapai ambang 5.000 penulisan.');
if (!apply) process.exit(0);

const serviceAccountPath = resolve(projectRoot, process.env.FIREBASE_SERVICE_ACCOUNT ?? 'firebase-service-account.json');
if (!existsSync(serviceAccountPath)) throw new Error('Service account tidak ditemukan; tidak ada data yang ditulis.');
if (confirmation !== 'formosa-mandarin') throw new Error('Impor dibatalkan. Untuk menulis, perlu --confirm-project=formosa-mandarin.');
if (!ownerId) throw new Error('Set IMPORT_OWNER_ID ke UID admin/guru sebelum impor.');

const { cert, getApps, initializeApp } = await import('firebase-admin/app');
const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
if (serviceAccount.project_id !== 'formosa-mandarin') throw new Error('Service account bukan untuk proyek formosa-mandarin.');
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const operations = [
  ...units.map((unit) => (batch) => batch.set(db.collection('units').doc(unit.id), {
    active: true, createdBy: ownerId, description: unit.description, grade: unit.grade,
    name: unit.name, order: unit.order, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })),
  ...cards.map((card) => (batch) => batch.set(db.collection('flashcards').doc(card.id), {
    active: true, audioMode: 'tts', createdBy: ownerId, grade: 6, hanzi: card.hanzi,
    meaning: card.meaning, pinyin: card.pinyin, ttsText: card.hanzi, unitId: card.unitId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })),
  ...questions.map((question) => (batch) => batch.set(db.collection('questions').doc(question.id), {
    ...question,
    answerMode: question.category === 'writing' ? 'strokeOrder' : question.category === 'speaking' ? 'speech' : 'multipleChoice',
    correctOption: question.options ? 'A' : null,
    maximumPoint: pointValues[question.category],
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })),
];
for (let index = 0; index < operations.length; index += 450) {
  const batch = db.batch();
  operations.slice(index, index + 450).forEach((operation) => operation(batch));
  batch.set(db.collection('contentMetadata').doc('catalog'), {
    revision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
}
console.log(`Selesai. ${writeCount} dokumen ditulis ke proyek formosa-mandarin.`);
