import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const csvPath = process.env.VOCAB_CSV ?? 'C:/Users/User/Downloads/mandarin_vocab_kelas1-6.csv';
const serviceAccountPath = resolve(projectRoot, process.env.FIREBASE_SERVICE_ACCOUNT ?? 'firebase-service-account.json');
const excludedHanzi = new Set(['王', '小贵', '小明', '阿']);

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
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

if (!existsSync(csvPath) || !existsSync(serviceAccountPath)) throw new Error('CSV atau service account tidak ditemukan.');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const grouped = new Map();
rows.forEach((row) => {
  const grade = Number(String(row.Grade).match(/(\d+)/)?.[1] ?? 0);
  const lesson = Number(row.Lesson);
  const key = `${grade}-${lesson}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row);
});

const targets = [];
for (const [key, words] of grouped) {
  const [grade, lesson] = key.split('-').map(Number);
  words.forEach((word, index) => {
    if (!excludedHanzi.has(word.Chinese)) return;
    targets.push(`csv-fc-${grade}-${lesson}-${index + 1}`);
  });
}

for (let index = 0; index < targets.length; index += 100) {
  const batch = db.batch();
  targets.slice(index, index + 100).forEach((cardId) => {
    batch.set(db.collection('flashcards').doc(cardId), { active: false, archivedAt: FieldValue.serverTimestamp() }, { merge: true });
    for (const category of ['writing', 'listening', 'speaking', 'reading']) {
      batch.set(db.collection('questions').doc(`csv-q-${cardId}-${category}`), { active: false, archivedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
  batch.set(db.collection('contentMetadata').doc('catalog'), { revision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
}
console.log(`Diarsipkan ${targets.length} kosakata nama/marga: ${targets.join(', ')}`);
