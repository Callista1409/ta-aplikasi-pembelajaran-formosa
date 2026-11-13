// Read-only audit against the same active vocabulary used by the web app.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/core/content/posttest-curriculum.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
runInNewContext(compiled, { exports });
const account = JSON.parse(readFileSync(new URL('../firebase-service-account.json', import.meta.url), 'utf8'));
const app = initializeApp({ credential: cert(account) });
try {
  const db = getFirestore(app);
  const [unitSnapshot, cardSnapshot] = await Promise.all([db.collection('units').get(), db.collection('flashcards').get()]);
  const units = unitSnapshot.docs.filter((item) => item.data().active !== false).map((item) => ({ id: item.id, ...item.data() }));
  const cards = cardSnapshot.docs.filter((item) => item.data().active !== false).map((item) => ({ id: item.id, ...item.data() }));
  for (let grade = 1; grade <= 6; grade += 1) {
    const rows = exports.posttestVocabulary(grade, units, cards, new Set());
    console.log(JSON.stringify({ grade, required: rows.length, available: rows.filter((row) => row.cards.length).length,
      missing: rows.filter((row) => !row.cards.length).map(({ word, grade: sourceGrade, chapter }) => ({ word, sourceGrade, chapter })) }));
  }
} catch (error) {
  console.error(error.code === 8 ? 'Audit belum dapat dilanjutkan: kuota Firestore habis.' : 'Audit belum dapat dilanjutkan: ' + error.message);
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
