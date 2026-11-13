import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const csvPath = process.env.VOCAB_CSV ?? 'C:/Users/User/Downloads/mandarin_vocab_kelas1-6.csv';
const serviceAccountPath = resolve(projectRoot, process.env.FIREBASE_SERVICE_ACCOUNT ?? 'firebase-service-account.json');
if (!existsSync(csvPath)) throw new Error(`CSV tidak ditemukan: ${csvPath}`);
if (!existsSync(serviceAccountPath)) throw new Error(`Service account tidak ditemukan: ${serviceAccountPath}`);

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

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

function gradeNumber(value) { return Number(String(value).match(/(\d+)/)?.[1] ?? 0); }
function cardId(grade, lesson, index) { return `csv-fc-${grade}-${lesson}-${index + 1}`; }
function questionId(card, category) { return `csv-q-${card}-${category}`; }

async function translate(value) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=id&dt=t&q=${encodeURIComponent(value)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Terjemahan gagal (${response.status}) untuk: ${value}`);
  const data = await response.json();
  return data[0].map((part) => part[0]).join('').trim() || value;
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
  lesson: Number(row.Lesson),
  hanzi: row.Chinese,
  pinyin: row.Pinyin,
  meaning: row.English,
})).filter((row) => row.grade >= 1 && row.grade <= 6 && row.lesson >= 1 && row.lesson <= 10 && row.hanzi);

const uniqueMeanings = [...new Set(rows.map((row) => row.meaning))];
const translations = new Map();
for (let index = 0; index < uniqueMeanings.length; index += 1) {
  const source = uniqueMeanings[index];
  translations.set(source, await translate(source));
  if ((index + 1) % 50 === 0) console.log(`Menerjemahkan ${index + 1}/${uniqueMeanings.length} arti...`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 45));
}

const grouped = new Map();
rows.forEach((row) => {
  const key = `${row.grade}-${row.lesson}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row);
});

const cards = [];
for (const [key, words] of grouped) {
  const [grade, lesson] = key.split('-').map(Number);
  words.forEach((word, index) => cards.push({ ...word, id: cardId(grade, lesson, index), unitId: `csv-grade-${grade}-lesson-${lesson}` }));
}

const operations = [];
for (const card of cards) {
  const meaning = translations.get(card.meaning) ?? card.meaning;
  const lessonCards = cards.filter((item) => item.unitId === card.unitId);
  const options = [meaning, ...lessonCards.filter((item) => item.id !== card.id).slice(0, 3).map((item) => translations.get(item.meaning) ?? item.meaning)];
  operations.push((batch) => batch.set(db.collection('flashcards').doc(card.id), {
    meaning,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }));
  operations.push((batch) => batch.set(db.collection('questions').doc(questionId(card.id, 'writing')), { correctAnswer: card.hanzi, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
  operations.push((batch) => batch.set(db.collection('questions').doc(questionId(card.id, 'listening')), { correctAnswer: meaning, options, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
  operations.push((batch) => batch.set(db.collection('questions').doc(questionId(card.id, 'speaking')), { correctAnswer: card.hanzi, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
  operations.push((batch) => batch.set(db.collection('questions').doc(questionId(card.id, 'reading')), { correctAnswer: meaning, options, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
}

await commitInChunks(operations);
console.log(`Selesai: ${cards.length} flashcard dan ${cards.length * 2} set jawaban soal diperbarui ke bahasa Indonesia.`);
