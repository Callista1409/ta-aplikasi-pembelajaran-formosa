import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// Dry run by default. Keep the existing UID, username, password and admin role.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uid = 'DWyjnqO79KYrPzVTVCoxQI9zN0a2';
const email = 'adminformosamandarin@gmail.com';
const apply = process.argv.includes('--apply');
const accountPath = resolve(root, process.env.FIREBASE_SERVICE_ACCOUNT ?? 'firebase-service-account.json');
initializeApp({ credential: cert(JSON.parse(readFileSync(accountPath, 'utf8'))) });
const auth = getAuth();
const db = getFirestore();

try {
  const [user, snapshot] = await Promise.all([auth.getUser(uid), db.collection('users').doc(uid).get()]);
  const profile = snapshot.data();
  if (!snapshot.exists || profile.role !== 'admin') throw new Error('UID sasaran bukan profil admin yang valid.');
  if (user.disabled || profile.active === false) throw new Error('Akun admin tidak aktif.');
  const username = String(profile.username ?? '').trim().toLowerCase();
  if (!username) throw new Error('Username admin belum tersedia.');
  const mappingRef = db.collection('loginUsernames').doc(username);
  const mapping = await mappingRef.get();
  if (mapping.exists && mapping.data().uid !== uid) throw new Error('Username terhubung ke akun berbeda.');
  try {
    const owner = await auth.getUserByEmail(email);
    if (owner.uid !== uid) throw new Error('Email baru telah dipakai akun lain.');
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', uid, username, oldEmail: user.email, newEmail: email, role: profile.role }));
  if (apply) {
    const emailChanged = user.email !== email;
    if (emailChanged) await auth.updateUser(uid, { email, emailVerified: false });
    const batch = db.batch();
    batch.set(snapshot.ref, { email, ...(emailChanged ? { emailVerified: false } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(mappingRef, { uid, username, email, role: 'admin', active: true, displayName: profile.displayName ?? user.displayName ?? username, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    try {
      await batch.commit();
    } catch (error) {
      if (emailChanged) {
        try {
          await auth.updateUser(uid, { email: user.email, emailVerified: user.emailVerified });
        } catch {
          throw new Error('Sinkronisasi gagal dan pemulihan Auth gagal. Periksa email Auth dan Firestore sebelum mencoba lagi.');
        }
      }
      throw error;
    }
    const [updated, saved, indexed] = await Promise.all([auth.getUser(uid), snapshot.ref.get(), mappingRef.get()]);
    if (updated.email !== email || saved.data().email !== email || indexed.data().email !== email || saved.data().role !== 'admin' || saved.data().username !== username) {
      throw new Error('Verifikasi sinkronisasi akun gagal.');
    }
    // Validate password-reset support without sending email or exposing its token.
    const resetLink = new URL(await auth.generatePasswordResetLink(email));
    if (resetLink.searchParams.get('mode') !== 'resetPassword') throw new Error('Tautan reset tidak valid.');
    console.log('VERIFIED: Auth, profil admin, dan mapping username konsisten. Tautan reset dapat dibuat; email belum dikirim.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.terminate();
}
