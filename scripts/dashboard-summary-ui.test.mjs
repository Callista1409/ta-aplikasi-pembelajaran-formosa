import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise(resolve => setImmediate(resolve));
function load(path, modules) {
  const source = readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require: id => modules[id] ?? {}, console, Date, Error, Promise, queueMicrotask });
  return exports;
}

function dashboard(kind) {
  const effects = [], requests = [];
  const signal = initial => { let value = initial; return Object.assign(() => value, { set: next => { value = next; }, update: fn => { value = fn(value); } }); };
  const Data = class {}, Api = class {}, Auth = class {};
  const data = { users: () => [{ id: 's', displayName: 'Student profile', grade: 4 }], students: () => [{ id: 's', displayName: 'Student profile', grade: 4 }],
    units: () => [], production: signal({}), dashboardCounts: () => ({}), loadDashboardCounts: async () => ({}) };
  const api = { getAuthRoster: async () => ({ students: [{ id: 's', displayName: 'Auth fallback' }], teachers: [{ id: 't', displayName: 'Teacher' }] }),
    getDashboardReport: (type, start, end, ids, refresh, includeTotals) => new Promise((resolve, reject) => requests.push({ type, start, end, ids, refresh, includeTotals, resolve, reject })) };
  const services = new Map([[Data, data], [Api, api], [Auth, { profile: () => ({ uid: 'a' }) }]]);
  const core = { Component: () => type => type, inject: token => services.get(token) ?? {}, signal, computed: read => read, untracked: run => run(),
    effect: fn => { effects.push({ fn, cleanup: () => {} }); } };
  const modules = { '@angular/core': core, '@angular/router': { Router: class {} },
    '../../core/services/content-data.service': { ContentDataService: Data }, '../../core/services/admin-api.service': { AdminApiService: Api },
    '../../core/services/auth.service': { AuthService: Auth } };
  const name = kind === 'admin' ? 'AdminDashboardComponent' : 'TeacherDashboardComponent';
  const Component = load(`features/${kind}/${kind}-dashboard.component.ts`, modules)[name];
  const component = new Component();
  return { component, requests, run: () => effects.forEach(entry => { entry.cleanup(); entry.fn(cleanup => { entry.cleanup = cleanup; }); }) };
}

test('admin enriches Auth identities from existing profiles without another metadata request', async () => {
  const { component } = dashboard('admin'); await tick();
  assert.equal(component.authRoster().students[0].displayName, 'Student profile');
  assert.equal(component.authRoster().students[0].grade, 4);
});

test('both dashboards ignore stale responses and only explicit refresh bypasses caches', async () => {
  for (const kind of ['admin', 'teacher']) {
    const f = dashboard(kind); await tick(); f.run();
    const c = f.component, start = kind === 'admin' ? c.studentStartDateId : c.startDateId;
    const end = kind === 'admin' ? c.studentEndDateId : c.endDateId;
    const old = f.requests.find(r => r.type === 'activity');
    start.set('2026-11-01'); end.set('2026-11-03'); f.run();
    old.resolve({ rows: { s: { pointEarned: 999 } }, generatedAt: 1 }); await tick();
    assert.equal(kind === 'admin' ? c.activityLogs().length : Object.keys(c.reportRows()).length, 0);
    const current = f.requests.filter(r => r.type === 'activity').at(-1);
    current.resolve({ rows: { s: { pointEarned: 5, learnedCount: 2, questionCount: 10 } }, generatedAt: Date.now() }); await tick();
    assert.equal(kind === 'admin' ? c.activityLogs()[0].pointEarned : c.reportRows().s.pointEarned, 5);
    c.refreshReports(); await tick(); f.run();
    assert.equal(f.requests.filter(r => r.type === 'activity').at(-1).refresh, true);
    end.set('2026-11-04'); f.run();
    assert.equal(f.requests.filter(r => r.type === 'activity').at(-1).refresh, false);
    f.requests.filter(r => r.type === 'activity').at(-1).reject(Error('offline')); await tick();
    assert.match(c.dataWarning(), /belum dapat dimuat/);
  }
});

test('client cache shares concurrent loads, evicts failures, refreshes and clears on invalidation', async () => {
  const { DashboardRequestCache } = load('core/services/dashboard-report-cache.ts', {});
  const cache = new DashboardRequestCache(); let calls = 0;
  const read = () => { calls++; return Promise.resolve(calls); };
  assert.deepEqual(await Promise.all([cache.read('u:report', read), cache.read('u:report', read)]), [1, 1]);
  assert.equal(await cache.read('u:report', read), 1);
  assert.equal(await cache.read('u:report', read, true), 2);
  cache.clear(); assert.equal(await cache.read('u:report', read), 3);
  await assert.rejects(cache.read('failed', () => Promise.reject(Error('offline'))), /offline/);
  assert.equal(await cache.read('failed', read), 4);
});
