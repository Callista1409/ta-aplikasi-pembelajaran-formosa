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

if (!getApps().length) {
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const users = await db.collection('users').get();
let synced = 0;
let skipped = 0;

for (const user of users.docs) {
  const data = user.data();
  const username = String(data.username ?? '').trim().toLowerCase();
  const email = String(data.email ?? '').trim().toLowerCase();

  if (!username || !email || !email.includes('@')) {
    skipped += 1;
    continue;
  }

  await db.collection('loginUsernames').doc(username).set(
    {
      active: data.active !== false,
      displayName: String(data.displayName ?? username),
      email,
      role: String(data.role ?? ''),
      uid: user.id,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  synced += 1;
}

console.log(`loginUsernames disinkronkan: ${synced}`);
if (skipped) console.log(`Dilewati karena username/email belum lengkap: ${skipped}`);
