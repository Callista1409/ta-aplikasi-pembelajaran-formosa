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
const roleDomains = {
  admin: 'formosa.admin',
  teacher: 'formosa.teacher',
  student: 'formosa.student',
};

function usernameFrom(data, uid) {
  const raw = String(data.username || data.email || data.displayName || uid)
    .trim()
    .toLowerCase();
  const withoutDomain = raw.includes('@') ? raw.split('@')[0] : raw;
  return withoutDomain
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '')
    .replace(/^[-.]+|[-.]+$/g, '');
}

function emailFor(username, role) {
  return `${username}@${roleDomains[role]}`;
}

async function main() {
  const users = await db.collection('users').get();
  console.log(`Migrasi ${users.size} dokumen user ke login username...`);

  for (const item of users.docs) {
    const data = item.data();
    const role = data.role;
    if (!roleDomains[role]) {
      console.warn(`Lewati ${item.id}: role tidak dikenal`);
      continue;
    }

    const username = usernameFrom(data, item.id);
    if (!username) {
      console.warn(`Lewati ${item.id}: username kosong`);
      continue;
    }

    const email = emailFor(username, role);
    const active = data.active !== false;

    try {
      await auth.updateUser(item.id, {
        disabled: !active,
        displayName: String(data.displayName || username),
        email,
      });
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        console.warn(`Lewati Auth ${item.id}: UID tidak ditemukan di Authentication`);
        continue;
      }
      if (error.code === 'auth/email-already-exists') {
        const existing = await auth.getUserByEmail(email);
        if (existing.uid !== item.id) {
          console.warn(`Lewati ${item.id}: ${email} sudah dipakai UID ${existing.uid}`);
          continue;
        }
      } else {
        throw error;
      }
    }

    await item.ref.set(
      {
        active,
        email,
        username,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    console.log(`${username} -> ${email}`);
  }

  console.log('Selesai. Login sekarang memakai username, sementara Firebase Auth tetap menyimpan email internal.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
