import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

const PAGE_SIZE = 50;
const LEASE_MS = 3 * 60_000;
const studentCollections = [
  'studentProgress', 'studentQuestionProgress', 'studentAccessories', 'studentActivityLogs',
  'studentComments', 'testSessions', 'testAnswers', 'studentBulkProgress', 'studentPoints',
  'studentPracticeSessions', 'studentPracticeAnswerEvents', 'studentAssessmentLegacy',
];

export function deletionError(status, message, details = {}) {
  return Object.assign(new Error(message), { status, ...details });
}

/** The HTTP boundary authenticates the active admin; this operation only accepts exact UIDs. */
export async function deleteManagedAccount({ auth, db, now = Date.now, timestamp = () => FieldValue.serverTimestamp() }, {
  uid, expectedRole, confirmation, actorUid,
}) {
  if (typeof uid !== 'string' || !uid.trim() || uid !== uid.trim() || uid.length > 128 || uid.includes('/')) {
    throw deletionError(400, 'UID akun tidak valid.');
  }
  if (!['student', 'teacher'].includes(expectedRole)) throw deletionError(400, 'Pilih akun siswa atau guru.');
  if (typeof confirmation !== 'string' || confirmation.trim().toUpperCase() !== 'HAPUS') {
    throw deletionError(400, 'Ketik HAPUS untuk mengonfirmasi penghapusan.');
  }
  if (!actorUid || actorUid === uid) throw deletionError(403, 'Akun admin tidak boleh dihapus melalui fitur ini.');

  const profileRef = db.collection('users').doc(uid);
  const jobRef = db.collection('accountDeletionJobs').doc(uid);
  const owner = randomUUID();
  let authUser;
  try { authUser = await auth.getUser(uid); }
  catch (error) { if (error.code !== 'auth/user-not-found') throw error; }

  const job = await db.runTransaction(async transaction => {
    const [profile, savedJob] = await Promise.all([transaction.get(profileRef), transaction.get(jobRef)]);
    const data = profile.data();
    const previous = savedJob.data();
    if (previous?.status === 'completed') {
      if (profile.exists || authUser) throw deletionError(409, 'UID ini telah digunakan kembali. Penghapusan perlu diperiksa pengelola.');
      if (previous.role !== expectedRole) throw deletionError(409, 'Role akun berbeda. Muat ulang daftar akun.');
      return previous;
    }
    const role = data?.role ?? previous?.role;
    if (!['student', 'teacher'].includes(role)) {
      throw deletionError(profile.exists ? 403 : 404, profile.exists ? 'Hanya akun siswa dan guru yang dapat dihapus.' : 'Profil akun tidak ditemukan.');
    }
    if (role !== expectedRole || (previous && previous.role !== role)) throw deletionError(409, 'Role akun berubah. Muat ulang daftar akun.');
    if (previous?.status === 'deleting' && previous.leaseUntil > now()) {
      throw deletionError(409, 'Penghapusan akun sedang diproses. Tunggu sebentar sebelum mencoba lagi.');
    }
    const value = {
      uid, role, status: 'deleting', requestedBy: actorUid,
      displayName: previous?.displayName ?? data?.displayName ?? authUser?.displayName ?? 'pengguna',
      username: previous?.username ?? (typeof data?.username === 'string' ? data.username.trim().toLowerCase() : ''),
      email: previous?.email ?? authUser?.email ?? data?.email ?? '',
      leaseOwner: owner, leaseUntil: now() + LEASE_MS, updatedAt: timestamp(),
    };
    transaction.set(jobRef, value);
    if (profile.exists) transaction.set(profileRef, { active: false, deletionStatus: 'deleting', updatedAt: timestamp() }, { merge: true });
    return value;
  });

  if (job.status === 'completed') return { uid, message: 'Akun sudah dihapus permanen.' };

  // Every data batch is fenced by the durable lease, including workers that outlive a timeout.
  async function mutate(write, references = []) {
    return db.runTransaction(async transaction => {
      const [saved, profile] = await Promise.all([transaction.get(jobRef), transaction.get(profileRef)]);
      if (saved.data()?.leaseOwner !== owner || saved.data()?.status !== 'deleting') {
        throw deletionError(409, 'Penghapusan dilanjutkan oleh proses lain. Muat ulang daftar akun.');
      }
      if (profile.exists && profile.data().role !== job.role) throw deletionError(409, 'Role akun berubah. Hubungi pengelola.');
      const current = await Promise.all(references.map(reference => transaction.get(reference)));
      transaction.set(jobRef, { leaseUntil: now() + LEASE_MS, updatedAt: timestamp() }, { merge: true });
      return write(transaction, current);
    });
  }

  async function removePage(documents, field) {
    try {
      // Recheck ownership inside the write transaction, including reassigned username aliases.
      await mutate((transaction, current) => current.forEach(item => {
        const value = item.data()?.[field];
        if (item.exists && (field === 'subjectIds' ? Array.isArray(value) && value.includes(uid) : value === uid)) transaction.delete(item.ref);
      }), documents.map(item => item.ref));
    } catch (error) {
      // Saved posttest plans can be large. Reduce the batch if Firestore's byte limit is hit.
      if (documents.length <= 1 || !/too (large|big)|exceeds.*(size|bytes)|maximum.*(size|bytes)/i.test(error.message ?? '')) throw error;
      const middle = Math.ceil(documents.length / 2);
      await removePage(documents.slice(0, middle), field);
      await removePage(documents.slice(middle), field);
    }
  }

  async function removeMatching(collectionName, field, operator = '==') {
    while (true) {
      const snapshot = await db.collection(collectionName).where(field, operator, uid).limit(PAGE_SIZE).get();
      if (snapshot.empty) return;
      await removePage(snapshot.docs, field);
    }
  }

  async function authOperation(operation) {
    try { await operation(); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  }

  try {
    await authOperation(() => auth.updateUser(uid, { disabled: true }));
    await authOperation(() => auth.revokeRefreshTokens(uid));

    if (job.role === 'student') {
      for (const name of studentCollections) await removeMatching(name, 'studentId');
      await mutate(transaction => transaction.delete(db.collection('studentPoints').doc(uid)));
    }
    // Teacher-authored lessons, questions and comments deliberately remain available.
    await removeMatching('loginUsernames', 'uid');
    if (job.username && !job.username.includes('/') && typeof job.email === 'string' && job.email.includes('@')) {
      const mapping = db.collection('loginUsernames').doc(job.username);
      const legacy = await mapping.get();
      const value = legacy.data();
      if (legacy.exists && value?.uid === undefined && typeof value?.email === 'string'
        && value.email.toLowerCase() === String(job.email).toLowerCase()) {
        await db.runTransaction(async transaction => {
          const [saved, current] = await Promise.all([transaction.get(jobRef), transaction.get(mapping)]);
          if (saved.data()?.leaseOwner !== owner || saved.data()?.status !== 'deleting') throw deletionError(409, 'Penghapusan sedang diproses ulang.');
          const data = current.data();
          if (current.exists && data?.uid === undefined && typeof data?.email === 'string' && data.email.toLowerCase() === String(job.email).toLowerCase()) transaction.delete(mapping);
          transaction.set(jobRef, { leaseUntil: now() + LEASE_MS, updatedAt: timestamp() }, { merge: true });
        });
      }
    }
    await removeMatching('pendingRegistrations', 'uid');
    await mutate(transaction => transaction.delete(db.collection('pendingRegistrations').doc(uid)));
    await removeMatching('dashboardReportCache', 'subjectIds', 'array-contains');
    await mutate(() => undefined);
    // Auth goes last; a missing Auth user is valid when resuming a partial/legacy deletion.
    await authOperation(() => auth.deleteUser(uid));
    await mutate(transaction => {
      transaction.delete(profileRef);
      // Retain only the minimal completion receipt; discard temporary name/email/username fields.
      transaction.set(jobRef, { uid, role: job.role, requestedBy: actorUid, status: 'completed', completedAt: timestamp() });
    });
    return { uid, message: `Akun ${job.displayName} berhasil dihapus permanen.` };
  } catch (error) {
    // Keep a disabled profile so the account stays visible to admins for a later retry.
    try {
      await db.runTransaction(async transaction => {
        const [saved, profile] = await Promise.all([transaction.get(jobRef), transaction.get(profileRef)]);
        if (saved.data()?.leaseOwner !== owner || saved.data()?.status !== 'deleting') return;
        transaction.set(jobRef, { status: 'failed', leaseUntil: 0, updatedAt: timestamp() }, { merge: true });
        if (profile.exists && profile.data().role === job.role) transaction.set(profileRef, { active: false, deletionStatus: 'failed', updatedAt: timestamp() }, { merge: true });
      });
    } catch { /* An expired lease can be claimed after a backend outage. */ }
    if (error.status === 409) throw error;
    throw deletionError(503, 'Penghapusan akun belum selesai. Coba lagi untuk melanjutkan penghapusan.', {
      retryable: true, uid, sourceCode: error.code,
    });
  }
}
