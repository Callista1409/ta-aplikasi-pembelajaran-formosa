import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { handleAdminRequest } from './server.mjs';

test('local and Vercel report/roster routes require a token before any Firestore lookup', async () => {
  // Explicit demo project, no credentials or production identity; missing tokens fail
  // before the Firestore client makes a request.
  const app = initializeApp({ projectId: 'demo-dashboard-http' });
  try {
    for (const prefix of ['', '/api']) for (const [method, path] of [
      ['GET', '/admin/auth-roster?refresh=1'], ['POST', '/admin/report-summary'], ['POST', '/admin/delete-user'],
    ]) {
      const response = { setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
      await handleAdminRequest({ method, url: prefix + path, headers: {}, body: {} }, response);
      assert.equal(response.status, 401);
    }
  } finally { await getFirestore(app).terminate(); await deleteApp(app); }
});

test('merged backend keeps teacher report access and restricts roster to active admins', async () => {
  for (const role of ['admin', 'teacher', 'student']) {
    const services = {
      auth: { verifyIdToken: async () => ({ uid: 'actor' }), listUsers: async () => ({ users: [{ uid: 's', email: 's@formosa.student' }] }) },
      db: { projectId: `merged-${role}`, collection: name => ({ doc: () => ({ get: async () => name === 'users'
        ? { exists: true, data: () => ({ role, active: true }) }
        : { data: () => ({ version: 1, expiresAt: Date.now() + 120000, result: { rows: { s: { pointEarned: 3 } }, generatedAt: Date.now() } }) } }) }) },
    };
    for (const [method, url, expected] of [
      ['POST', '/api/admin/report-summary', role === 'student' ? 403 : 200],
      ['GET', '/api/admin/auth-roster?refresh=1', role === 'admin' ? 200 : 403],
    ]) {
      const response = { setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
      await handleAdminRequest({ method, url, headers: { authorization: 'Bearer token' },
        body: { kind: 'activity', start: '2026-11-01', end: '2026-11-03', ids: ['s'] } }, response, services);
      assert.equal(response.status, expected);
      if (method === 'POST' && expected === 200) assert.equal(response.body.rows.s.pointEarned, 3);
      if (method === 'GET' && expected === 200) assert.equal(response.body.students[0].id, 's');
    }
  }
});
