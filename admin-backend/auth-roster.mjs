let cached;
let pending;
let generation = 0;
export function invalidateAuthRoster() { generation++; cached = undefined; pending = undefined; }

export async function authRoster(auth, db, { refresh = false, now = Date.now } = {}) {
  if (refresh) invalidateAuthRoster();
  if (cached?.expiresAt > now()) return cached.value;
  if (pending) return pending;
  const version = generation;
  const task = (async () => {
    const users = [];
    let pageToken;
    do { const page = await auth.listUsers(1000, pageToken); users.push(...page.users); pageToken = page.pageToken; } while (pageToken);
    const roles = new Map();
    const metadata = new Map();
    const unknown = [];
    for (const user of users) {
      const domain = user.email?.toLowerCase().match(/@formosa\.(student|teacher|admin)$/)?.[1];
      const role = domain ?? user.customClaims?.role;
      if (['student', 'teacher', 'admin'].includes(role)) roles.set(user.uid, role);
      else unknown.push(user);
    }
    // Normal Formosa identities require no profile/registration scans. Only unknown
    // legacy identities need targeted lookups to preserve their original role fallback.
    for (let offset = 0; offset < unknown.length; offset += 50) {
      const batch = unknown.slice(offset, offset + 50);
      const profiles = await db.getAll(...batch.map(user => db.collection('users').doc(user.uid)));
      const missing = [];
      profiles.forEach((snapshot, index) => {
        const data = snapshot.data() ?? {};
        metadata.set(batch[index].uid, data);
        const role = data.role;
        if (['student', 'teacher', 'admin'].includes(role)) roles.set(batch[index].uid, role);
        else missing.push(batch[index]);
      });
      if (missing.length) {
        const registrations = await db.getAll(...missing.map(user => db.collection('pendingRegistrations').doc(user.uid)));
        registrations.forEach((snapshot, index) => {
          const uid = missing[index].uid, data = snapshot.data() ?? {};
          roles.set(uid, data.role);
          metadata.set(uid, { ...data, ...metadata.get(uid) });
        });
      }
    }
    const value = { students: [], teachers: [] };
    users.forEach(user => {
      const role = roles.get(user.uid);
      if (!['student', 'teacher'].includes(role)) return;
      const details = metadata.get(user.uid) ?? {};
      value[`${role}s`].push({ id: user.uid,
        displayName: (typeof details.displayName === 'string' ? details.displayName.trim() : '') || user.displayName?.trim() || user.email?.split('@')[0] || user.uid,
        ...(role === 'student' && typeof details.grade === 'number' ? { grade: details.grade } : {}) });
    });
    if (generation === version) cached = { value, expiresAt: now() + 120_000 };
    return value;
  })().finally(() => { if (pending === task) pending = undefined; });
  pending = task;
  return task;
}
