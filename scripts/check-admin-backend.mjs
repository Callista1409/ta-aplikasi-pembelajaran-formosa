// Read-only diagnosis: no token minting, account updates, deletion requests or data writes.
import { readFileSync } from 'node:fs';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const account = JSON.parse(readFileSync(new URL('../firebase-service-account.json', import.meta.url), 'utf8'));
const app = initializeApp({ credential: cert(account) }, 'admin-read-only-diagnostics');
const db = getFirestore(app);
const adminUid = 'DWyjnqO79KYrPzVTVCoxQI9zN0a2';
const results = [];
try {
  for (const [stage, run] of [
    ['auth-admin-lookup', async () => { const user = await getAuth(app).getUser(adminUid); return { exists: true, disabled: user.disabled }; }],
    ['firestore-admin-profile', async () => { const snapshot = await db.collection('users').doc(adminUid).get(); return { exists: snapshot.exists, role: snapshot.data()?.role, active: snapshot.data()?.active }; }],
  ]) {
    try { results.push({ stage, ok: true, ...await run() }); }
    catch (error) { results.push({ stage, ok: false, code: error.code ?? 'unknown',
      quotaExceeded: /quota|resource.exhausted/i.test(error.message ?? ''),
      permissionDenied: /permission.denied|insufficient.permission/i.test(error.message ?? '') }); }
  }
  console.log(JSON.stringify({ project: account.project_id, results }, null, 2));
} finally { await db.terminate(); await deleteApp(app); }
