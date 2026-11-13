import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { authRoster, invalidateAuthRoster } from './auth-roster.mjs';
import { dashboardReport } from './dashboard-reports.mjs';
import { authorizeStaff } from './staff-access.mjs';
import { deleteManagedAccount } from './account-deletion.mjs';
import { authorizeStudent, studentAction } from './student-learning.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5055);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:4200,http://localhost:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export default handleAdminRequest;

export async function handleAdminRequest(request, response, injectedServices) {
  const origin = request.headers.origin ?? '';
  // Vercel service routing preserves /api; direct local requests omit it.
  const path = new URL(request.url, 'http://localhost').pathname.replace(/^\/api(?=\/)/, '');
  setCorsHeaders(response, origin);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  let stage = 'initialize';
  try {
    let services = injectedServices;
    if (!services) { initializeFirebaseAdmin(); services = { auth: getAuth(), db: getFirestore() }; }
    const { auth, db } = services;
    if (request.method === 'GET' && path === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && path.startsWith('/student/')) {
      stage = 'student-operation';
      const identity = await authorizeStudent(auth, request);
      const result = await studentAction(db, identity.uid, path.slice('/student/'.length), await readJsonBody(request));
      sendJson(response, 200, result);
      return;
    }

    if (request.method === 'GET' && path === '/admin/auth-roster') {
      await requireAdmin(request, auth, db);
      const refresh = new URL(request.url, 'http://localhost').searchParams.get('refresh') === '1';
      sendJson(response, 200, await authRoster(auth, db, { refresh }));
      return;
    }

    if (request.method === 'POST' && path === '/admin/report-summary') {
      await requireAdmin(request, auth, db, ['admin', 'teacher']);
      sendJson(response, 200, await dashboardReport(db, await readJsonBody(request)));
      return;
    }

    if (request.method === 'POST' && path === '/admin/delete-user') {
      stage = 'authorize-admin';
      const adminUser = await requireAdmin(request, auth, db);
      stage = 'parse-request';
      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Format permintaan tidak valid.');
      stage = 'delete-account';
      try {
        const result = await deleteManagedAccount(services, {
          uid: body.uid, expectedRole: body.role, confirmation: body.confirmation, actorUid: adminUser.uid,
        });
        sendJson(response, 200, result);
      } finally { invalidateAuthRoster(); }
      return;
    }

    throw httpError(404, 'Endpoint tidak ditemukan.');
  } catch (error) {
    const code = error.sourceCode ?? error.code;
    const quotaExceeded = [8, '8', 'resource-exhausted', 'RESOURCE_EXHAUSTED', 'firestore/resource-exhausted'].includes(code);
    const suppliedStatus = Number(error.status);
    const status = quotaExceeded ? 503 : Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599 ? suppliedStatus : 500;
    if (status >= 500) (injectedServices?.logger ?? console).error('Formosa Admin API failure', { stage, status, code: code ?? 'internal' });
    sendJson(response, status, {
      message: quotaExceeded ? 'Kuota Firestore telah habis. Periksa kuota Firebase sebelum mencoba lagi.'
        : error.retryable ? error.message : status >= 500 ? 'Terjadi kesalahan pada backend admin.' : error.message,
      ...(quotaExceeded ? { code: 'firestore-quota-exceeded', retryable: true } : {}),
      ...(error.retryable ? { retryable: true, uid: error.uid } : {}),
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer(handleAdminRequest).listen(port, process.env.VERCEL ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`Formosa Admin API berjalan di http://127.0.0.1:${port}`);
  });
}

function initializeFirebaseAdmin() {
  if (getApps().length) return;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
    });
    return;
  }

  if (process.env.VERCEL) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be configured on Vercel.');
  }

  const serviceAccountPath = resolve(
    __dirname,
    process.env.FIREBASE_SERVICE_ACCOUNT ??
      process.env.GOOGLE_APPLICATION_CREDENTIALS ??
      '../firebase-service-account.json',
  );

  if (!existsSync(serviceAccountPath)) {
    throw new Error(
      `Service account tidak ditemukan: ${serviceAccountPath}. Isi FIREBASE_SERVICE_ACCOUNT_JSON atau FIREBASE_SERVICE_ACCOUNT.`,
    );
  }

  initializeApp({
    credential: cert(JSON.parse(readFileSync(serviceAccountPath, 'utf8'))),
  });
}

function setCorsHeaders(response, origin) {
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? '*';
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function sendJson(response, status, payload) {
  response.setHeader('Cache-Control', 'no-store');
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  if (request.body !== undefined) {
    try {
      if (Buffer.byteLength(typeof request.body === 'string' ? request.body : JSON.stringify(request.body)) > 20_000) {
        return Promise.reject(httpError(413, 'Request terlalu besar.'));
      }
      return Promise.resolve(typeof request.body === 'string' ? JSON.parse(request.body) : request.body);
    } catch {
      return Promise.reject(httpError(400, 'Format JSON tidak valid.'));
    }
  }
  return new Promise((resolveBody, rejectBody) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 20_000) {
        rejectBody(httpError(413, 'Request terlalu besar.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        rejectBody(httpError(400, 'Format JSON tidak valid.'));
      }
    });
    request.on('error', rejectBody);
  });
}

async function requireAdmin(request, auth, db, roles = ['admin']) {
  return authorizeStaff(auth, db, request, roles);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
