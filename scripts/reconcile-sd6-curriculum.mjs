import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(projectRoot, '..');
const dataPath = resolve(scriptDir, 'data/sd6-curriculum-revised.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find(value => value.startsWith('--confirm-project='))?.split('=')[1];
const importTag = 'sd6-workbook-20261101';
const topics = {
  1: 'Perayaan Tahun Baru Imlek',
  2: 'Sifat dan Hubungan Sosial',
  3: 'Fotografi dan Penghargaan',
  4: 'Idola dan Tokoh Terkenal',
  5: 'Tetangga dan Lingkungan',
  6: 'Kecelakaan dan Tren Busana',
  7: 'Orang Tua dan Keselamatan Jalan',
  8: 'Benua dan Negara',
};
const pointValues = { writing: 10, listening: 3, speaking: 6, reading: 7 };
const categories = ['reading', 'listening', 'speaking', 'writing'];

function assertSource() {
  if (data.grade !== 6 || data.lessons.length !== 8) throw new Error('Sumber harus berisi delapan pelajaran kelas 6.');
  for (const lesson of data.lessons) {
    if (!topics[lesson.lesson] || !lesson.words.length) throw new Error(`Pelajaran tidak valid: ${lesson.lesson}`);
    if (new Set(lesson.words.map(word => word.hanzi)).size !== lesson.words.length) {
      throw new Error(`Ada Hanzi duplikat pada pelajaran ${lesson.lesson}.`);
    }
    if (lesson.words.some(word => !word.hanzi || !word.pinyin || !word.meaning)) {
      throw new Error(`Ada kolom kosakata kosong pada pelajaran ${lesson.lesson}.`);
    }
    if (new Set(lesson.words.map(word => word.meaning)).size < 4) {
      throw new Error(`Distraktor belum cukup pada pelajaran ${lesson.lesson}.`);
    }
  }
}

function hanziForms(value) {
  return String(value ?? '').split(/[\/／]/u)
    .map(word => word.replace(/[（(].*?[）)]/gu, '').replace(/[\s…]/gu, '').trim()).filter(Boolean);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function digestPosttests(documents) {
  const sessions = documents.map(document => {
    const value = document.data;
    return {
      id: document.id,
      mode: value.mode,
      version: value.version,
      status: value.status,
      plan: value.plan,
      answers: value.answers,
      score: value.score,
      earnedScore: value.earnedScore,
    };
  }).sort((first, second) => first.id.localeCompare(second.id));
  return createHash('sha256').update(JSON.stringify(stable(sessions))).digest('hex');
}

function optionsFor(words, targetIndex) {
  const correct = words[targetIndex].meaning;
  const distractors = [];
  for (let offset = 1; offset < words.length && distractors.length < 3; offset += 1) {
    const option = words[(targetIndex + offset) % words.length].meaning;
    if (option !== correct && !distractors.includes(option)) distractors.push(option);
  }
  if (distractors.length !== 3) throw new Error(`Distraktor tidak cukup untuk ${words[targetIndex].hanzi}.`);
  return [correct, ...distractors];
}

function questionFields(category, card, options) {
  const writingForm = hanziForms(card.hanzi)[0] ?? card.hanzi;
  const speakingPrompt = `Ucapkan kosakata Mandarin berikut: ${card.hanzi}`;
  const common = {
    active: true,
    category,
    correctAnswer: category === 'reading' || category === 'listening' ? card.meaning
      : category === 'writing' ? writingForm : card.hanzi,
    createdBy: card.createdBy,
    flashcardId: card.id,
    maximumPoint: pointValues[category],
    unitId: card.unitId,
    updatedAt: null,
  };
  if (category === 'reading') return {
    ...common, answerMode: 'multipleChoice', correctOption: 'A', options,
    passage: card.hanzi, prompt: 'Apa arti kosakata Mandarin ini?',
  };
  if (category === 'listening') return {
    ...common, answerMode: 'multipleChoice', audioText: hanziForms(card.hanzi)[0] ?? card.hanzi, correctOption: 'A', options,
    prompt: 'Dengarkan kosakata, lalu pilih artinya.',
  };
  if (category === 'speaking') return {
    ...common, answerMode: 'speech', prompt: speakingPrompt,
  };
  return { ...common, answerMode: 'strokeOrder', prompt: 'Tulis karakter sesuai urutan goresan.' };
}

async function main() {
  assertSource();
  const serviceAccountPath = resolve(projectRoot, process.env.FIREBASE_SERVICE_ACCOUNT ?? 'firebase-service-account.json');
  if (!existsSync(serviceAccountPath)) throw new Error('Service account tidak ditemukan; tidak ada data yang ditulis.');
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  if (serviceAccount.project_id !== 'formosa-mandarin') throw new Error('Service account bukan untuk proyek formosa-mandarin.');
  if (apply && confirmation !== 'formosa-mandarin') throw new Error('Untuk menulis, perlu --confirm-project=formosa-mandarin.');

  const { cert, getApps, initializeApp } = await import('firebase-admin/app');
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  const oldUnits = [];
  const correctedUnits = [];
  const correctionCards = new Map();
  const originalCorrectionCards = new Map();
  const correctionQuestions = new Map();
  const originalCorrectionQuestions = new Map();
  const newCards = [];
  const newQuestions = [];
  const expectedSessionsSnapshot = await db.collection('testSessions').where('grade', '==', 6).get();
  const savedPosttests = expectedSessionsSnapshot.docs
    .filter(document => document.data().mode === 'posttest')
    .map(document => ({ id: document.id, data: document.data() }));
  if (savedPosttests.some(session => !Array.isArray(session.data.plan) || !Array.isArray(session.data.answers))) {
    throw new Error('Ada sesi posttest kelas 6 tanpa plan/jawaban tersimpan; migrasi dihentikan untuk melindungi riwayat.');
  }
  const posttestDigestBefore = digestPosttests(savedPosttests);

  for (const lesson of data.lessons) {
    const oldUnitId = `csv-grade-6-lesson-${lesson.lesson}`;
    const oldUnit = await db.collection('units').doc(oldUnitId).get();
    if (!oldUnit.exists) throw new Error(`Unit lama tidak ditemukan: ${oldUnitId}`);
    oldUnits.push({ id: oldUnitId, data: oldUnit.data() });

    const words = lesson.words;
    let unitId;
    let createdBy = 'local-staging';
    if (lesson.lesson <= 3) {
      unitId = `sd6-correction-20261030-bab-${lesson.lesson}`;
      const unitSnapshot = await db.collection('units').doc(unitId).get();
      if (!unitSnapshot.exists || unitSnapshot.data().active === false) {
        throw new Error(`Unit koreksi bab ${lesson.lesson} tidak tersedia/aktif.`);
      }
      correctedUnits.push({ id: unitId, data: unitSnapshot.data() });
      const cardSnapshot = await db.collection('flashcards').where('unitId', '==', unitId).get();
      const cardList = cardSnapshot.docs.filter(card => card.data().active !== false)
        .map(card => ({ id: card.id, ...card.data() }));
      for (const word of words) {
        const wordForms = hanziForms(word.hanzi);
        const matches = cardList.filter(item => hanziForms(item.hanzi).some(form => wordForms.includes(form)));
        const card = matches.length === 1 ? matches[0] : undefined;
        if (!card) throw new Error(`Kartu ${word.hanzi} tidak ditemukan di unit koreksi bab ${lesson.lesson}.`);
        if (!originalCorrectionCards.has(card.id)) originalCorrectionCards.set(card.id, { ...card });
        card.meaning = word.meaning;
        const existingForms = hanziForms(card.hanzi);
        const formIndex = wordForms.indexOf(existingForms[0] ?? card.hanzi);
        const pinyinForms = String(word.pinyin).split(/[\/／]/u);
        card.pinyin = existingForms.length > 1 || pinyinForms.length !== wordForms.length
          ? word.pinyin : pinyinForms[formIndex];
        card.unitId = unitId;
        card.createdBy ||= createdBy;
        correctionCards.set(card.id, card);
      }
      if (cardList.length !== words.length) throw new Error(`Jumlah kartu koreksi bab ${lesson.lesson} berbeda dari workbook.`);
      const questionSnapshot = await db.collection('questions').where('flashcardId', 'in', cardList.map(card => card.id)).get();
      const byCardAndCategory = new Map();
      for (const question of questionSnapshot.docs.filter(question => question.data().active !== false)) {
        const value = question.data();
        byCardAndCategory.set(`${value.flashcardId}:${value.category}`, { id: question.id, ...value });
      }
      for (const card of cardList) {
        const wordIndex = words.findIndex(word => hanziForms(word.hanzi).some(form => hanziForms(card.hanzi).includes(form)));
        if (wordIndex < 0) throw new Error(`Kartu ${card.hanzi} tidak cocok dengan workbook bab ${lesson.lesson}.`);
        for (const category of categories) {
          const question = byCardAndCategory.get(`${card.id}:${category}`);
          if (!question) throw new Error(`Soal ${category} untuk ${card.hanzi} tidak ditemukan.`);
          if (!originalCorrectionQuestions.has(question.id)) originalCorrectionQuestions.set(question.id, { ...question });
          questionFields(category, card, optionsFor(words, wordIndex));
          correctionQuestions.set(question.id, { ...question, ...questionFields(category, card, optionsFor(words, wordIndex)) });
        }
      }
      if (byCardAndCategory.size !== words.length * categories.length) {
        throw new Error(`Jumlah soal koreksi bab ${lesson.lesson} bukan empat soal per kosakata.`);
      }
    } else {
      unitId = `${importTag}-bab-${lesson.lesson}`;
      const unitCardList = words.map((word, index) => ({
        id: `${importTag}-fc-${lesson.lesson}-${String(index + 1).padStart(2, '0')}`,
        grade: 6,
        hanzi: word.hanzi,
        pinyin: word.pinyin,
        meaning: word.meaning,
        unitId,
        createdBy,
      }));
      newCards.push(...unitCardList);
      unitCardList.forEach((card, index) => {
        for (const category of categories) {
          const questionId = `${importTag}-q-${card.id}-${category}`;
          newQuestions.push({
            id: questionId,
            ...questionFields(category, card, optionsFor(words, index)),
            ...(category === 'listening' ? { audioText: card.hanzi } : {}),
          });
        }
      });
    }
  }

  const writes = [];
  for (const unit of oldUnits) {
    writes.push({ ref: db.collection('units').doc(unit.id), data: { active: false, archivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, merge: true });
  }
  for (const [index, unit] of correctedUnits.entries()) {
    const lesson = index + 1;
    writes.push({ ref: db.collection('units').doc(unit.id), data: {
      active: true,
      description: `Kumpulan kosakata kelas 6 pelajaran ${lesson} sesuai workbook revisi Indonesia.`,
      name: `Pelajaran ${lesson}: ${topics[lesson]}`,
      order: lesson,
      updatedAt: FieldValue.serverTimestamp(),
    }, merge: true });
  }
  for (const lesson of data.lessons.filter(value => value.lesson >= 4)) {
    const unitId = `${importTag}-bab-${lesson.lesson}`;
    writes.push({ ref: db.collection('units').doc(unitId), data: {
      active: true,
      createdBy: 'local-staging',
      description: `Kumpulan kosakata kelas 6 pelajaran ${lesson.lesson} sesuai workbook revisi Indonesia.`,
      grade: 6,
      name: `Pelajaran ${lesson.lesson}: ${topics[lesson.lesson]}`,
      order: lesson.lesson,
      updatedAt: FieldValue.serverTimestamp(),
    }, merge: true });
  }
  for (const card of correctionCards.values()) {
    writes.push({ ref: db.collection('flashcards').doc(card.id), data: {
      active: true, audioMode: 'tts', createdBy: card.createdBy, grade: 6, hanzi: card.hanzi,
      meaning: card.meaning, pinyin: card.pinyin, ttsText: card.hanzi, unitId: card.unitId,
      updatedAt: FieldValue.serverTimestamp(),
    }, merge: true });
  }
  for (const question of correctionQuestions.values()) {
    const { id, ...fields } = question;
    const { updatedAt, ...dataFields } = fields;
    writes.push({ ref: db.collection('questions').doc(id), data: { ...dataFields, updatedAt: FieldValue.serverTimestamp() }, merge: true });
  }
  for (const card of newCards) {
    writes.push({ ref: db.collection('flashcards').doc(card.id), data: {
      active: true, audioMode: 'tts', createdBy: card.createdBy, grade: 6, hanzi: card.hanzi,
      meaning: card.meaning, pinyin: card.pinyin, ttsText: card.hanzi, unitId: card.unitId,
      updatedAt: FieldValue.serverTimestamp(),
    }, merge: true });
  }
  for (const question of newQuestions) {
    const { id, ...fields } = question;
    const { updatedAt, ...dataFields } = fields;
    writes.push({ ref: db.collection('questions').doc(id), data: { ...dataFields, updatedAt: FieldValue.serverTimestamp() }, merge: true });
  }

  const expectedCardCount = data.lessons.reduce((sum, lesson) => sum + lesson.words.length, 0);
  const posttestSummary = {
    sessions: savedPosttests.length,
    completed: savedPosttests.filter(session => session.data.status === 'completed').length,
    inProgress: savedPosttests.filter(session => session.data.status === 'in_progress').length,
    plansAndAnswersSaved: savedPosttests.every(session => Array.isArray(session.data.plan) && Array.isArray(session.data.answers)),
  };
  console.log(`Mode: ${apply ? 'APPLY DIMINTA' : 'DRY RUN (default)'}`);
  console.log(`Materi sumber: ${expectedCardCount} kosakata untuk 8 pelajaran kelas 6.`);
  console.log(`Unit lama akan dinonaktifkan: ${oldUnits.length}; kartu/soal lama tidak dihapus.`);
  console.log(`Unit koreksi yang dipakai ulang: ${correctedUnits.length}; kartu diperbarui: ${correctionCards.size}; soal diperbarui: ${correctionQuestions.size}.`);
  console.log(`Unit baru: ${data.lessons.filter(lesson => lesson.lesson >= 4).length}; kartu baru: ${newCards.length}; soal baru: ${newQuestions.length}.`);
  console.log(`Total rencana penulisan: ${writes.length + 1} dokumen termasuk revisi katalog.`);
  console.log(`Sesi posttest kelas 6: ${posttestSummary.sessions} (${posttestSummary.completed} selesai, ${posttestSummary.inProgress} berlangsung); seluruh plan/jawaban tersimpan: ${posttestSummary.plansAndAnswersSaved}.`);
  console.log('Dokumen testSessions, studentProgress, dan studentActivityLogs tidak termasuk dalam rencana penulisan.');
  if (!apply) {
    await Promise.all(getApps().map(app => app.delete()));
    return;
  }

  const backupDir = resolve(workspaceRoot, 'tmp');
  mkdirSync(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, `sd6-curriculum-backup-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
  const backup = {
    projectId: serviceAccount.project_id,
    units: oldUnits.concat(correctedUnits).map(item => ({ id: item.id, data: item.data })),
    flashcards: [...originalCorrectionCards.values()].map(card => ({ id: card.id, data: card })),
    questions: [...originalCorrectionQuestions.values()].map(question => ({ id: question.id, data: question })),
  };
  writeFileSync(backupPath, JSON.stringify(stable(backup), null, 2), 'utf8');

  writes.push({ ref: db.collection('contentMetadata').doc('catalog'), data: {
    revision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(),
  }, merge: true });
  for (let offset = 0; offset < writes.length; offset += 450) {
    const batch = db.batch();
    writes.slice(offset, offset + 450).forEach(write => batch.set(write.ref, write.data, { merge: write.merge }));
    await batch.commit();
  }

  const sessionsAfterSnapshot = await db.collection('testSessions').where('grade', '==', 6).get();
  const sessionsAfter = sessionsAfterSnapshot.docs.filter(document => document.data().mode === 'posttest')
    .map(document => ({ id: document.id, data: document.data() }));
  if (digestPosttests(sessionsAfter) !== posttestDigestBefore) {
    throw new Error('Sidik jari sesi posttest berubah; hentikan dan periksa backup serta riwayat.');
  }
  console.log(`Revisi selesai. Backup konten tersimpan di ${backupPath}. Snapshot posttest tetap identik.`);
  await Promise.all(getApps().map(app => app.delete()));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
