export async function authorizeStaff(auth, db, request, roles = ['admin']) {
  const denied = (status, message) => Object.assign(new Error(message), { status });
  const header = request.headers.authorization ?? '';
  if (!header.startsWith('Bearer ') || !header.slice(7)) throw denied(401, 'Token akun tidak ditemukan.');
  let identity;
  try { identity = await auth.verifyIdToken(header.slice(7), true); }
  catch { throw denied(401, 'Token akun tidak valid.'); }
  const profile = await db.collection('users').doc(identity.uid).get();
  if (!profile.exists || !roles.includes(profile.data()?.role) || profile.data()?.active !== true) {
    throw denied(403, 'Akun aktif dengan izin yang sesuai diperlukan.');
  }
  return identity;
}
