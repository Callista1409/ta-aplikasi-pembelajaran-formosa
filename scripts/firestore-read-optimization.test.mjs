import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(path, modules, globals = {}) {
  const source = readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: (id) => modules[id] ?? {}, console, Date, Error, ...globals });
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(initial = { uid: 'a', role: 'student' }, storage = new Map()) {
  let profile = initial;
  let revision = 0;
  const effects = [], microtasks = [], listeners = [], reads = [], allReads = [], writes = [];
  let handler = async (ref) => ({ docs: ref.name !== 'questions' ? [] : ref.filters[0][2].map((id) => ({
    id: `q-${id}`, data: () => ({ flashcardId: id, category: 'reading', correctAnswer: 'a' }),
  })) });
  const core = {
    Injectable: () => (type) => type, Component: () => (type) => type,
    inject: () => ({ profile: () => profile }), computed: (read) => read,
    signal: (value) => Object.assign(() => value, { set: (next) => { value = next; }, update: (fn) => { value = fn(value); } }),
    effect: (run) => effects.push({ run, cleanup: () => {} }),
  };
  const firestore = {
    collection: (_, name) => ({ name }), where: (...args) => args,
    orderBy: (...args) => ({ orderBy: args }), limit: (value) => ({ limit: value }),
    query: (ref, ...filters) => ({ ...ref, filters }), doc: (_, name, id) => ({ name, id }),
    getDocFromServer: async () => ({ data: () => ({ revision }) }),
    getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
    or: (...filters) => ({ or: filters }),
    increment: value => ({ increment: value }), serverTimestamp: () => 'server-time', deleteField: () => ({ deleteField: true }),
    writeBatch: () => {
      const operations = [];
      return { set: (ref, data, options) => operations.push({ ref, data, options }), delete: ref => operations.push({ ref, deleted: true }),
        commit: async () => { operations.forEach(item => { writes.push(item); if (item.ref.name === 'contentMetadata') revision++; }); } };
    },
    onSnapshot: (ref, next, error) => {
      const entry = { ref, next, error, stopped: false };
      listeners.push(entry); return () => { entry.stopped = true; };
    },
    getDocs: (ref) => { allReads.push(ref); if (ref.name === 'questions') reads.push(ref); return handler(ref); },
  };
  firestore.getDocsFromServer = firestore.getDocs;
  const cache = load('core/services/content-read-cache.ts', {}, { localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  } });
  const modules = { '@angular/core': core, 'firebase/firestore': firestore,
    '../firebase/firebase': { firestore: { app: { options: { projectId: 'test' } } } },
    './content-read-cache': cache,
    '../content/listening-question': { pretestListeningQuestion: (question) => question } };
  const globals = { queueMicrotask: (run) => microtasks.push(run) };
  const { ContentDataService } = load('core/services/content-data.service.ts', modules, globals);
  const service = new ContentDataService();
  const flush = () => {
    for (const entry of effects) { entry.cleanup(); entry.run((stop) => { entry.cleanup = stop; }); }
    while (microtasks.length) microtasks.shift()();
  };
  flush();
  return { service, effects, listeners, reads, allReads, writes, storage, flush, modules, globals,
    change: (next) => { profile = next; flush(); },
    handler: (next) => { handler = next; },
    edit: () => { revision++; service.contentCache.invalidate(); },
  };
}

test('signed-out startup has no content listeners; students never listen to the whole question bank', () => {
  const f = fixture(null);
  assert.equal(f.listeners.length, 0);
  f.change({ uid: 'a', role: 'student' });
  assert.equal(f.listeners.filter((entry) => entry.ref.name === 'questions').length, 0);
  assert.equal(f.listeners.filter((entry) => entry.ref.name === 'flashcards').length, 0);
  const count = f.listeners.length;
  f.flush();
  assert.equal(f.listeners.length, count);
  f.change({ uid: 't', role: 'teacher' });
  assert.equal(f.listeners.filter((entry) => entry.ref.name === 'questions' && !entry.stopped).length, 0);
});

test('one OR query loads both card schemas without separate legacy requests', async () => {
  const f = fixture();
  f.handler(async ref => ({ docs: ref.name === 'flashcards' ? [{ id: 'both', data: () => ({ unitId: 'unit-a', unitID: 'unit-a', meaning: 'Hello' }) }] : [] }));
  await Promise.all([f.service.loadUnitCards('unit-a'), f.service.loadUnitCards('unit-a')]);
  const reads = f.allReads.filter(ref => ref.name === 'flashcards');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].filters[0].or.length, 2);
  assert.equal(f.service.flashcards().length, 1);
});

test('a denied catalog version read exposes the content error and a retry restores units', async () => {
  const f = fixture(null);
  let denied = true;
  f.modules['firebase/firestore'].getDocFromServer = async () => {
    if (denied) throw Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' });
    return { data: () => ({ revision: 1 }) };
  };
  f.handler(async ref => ({ docs: ref.name === 'units' ? [{ id: 'unit-a', data: () => ({ grade: 4, name: 'Unit A' }) }] : [] }));
  f.change({ uid: 'a', role: 'student' });
  await assert.rejects(f.service.loadBasics(), /permissions/);
  assert.equal(f.service.contentLoaded(), false);
  assert.equal(f.service.contentLoading(), false);
  assert(f.service.contentError());
  denied = false;
  await f.service.loadBasics();
  assert.equal(f.service.units().length, 1);
  assert.equal(f.service.units()[0].grade, 4);
  assert.equal(f.service.contentLoaded(), true);
  assert.equal(f.service.contentError(), '');
});

test('a failed content load from an old account cannot restore an error after switching accounts', async () => {
  const f = fixture(null); let failOld;
  f.modules['firebase/firestore'].getDocFromServer = () => new Promise((resolve, reject) => { failOld = reject; });
  f.change({ uid: 'old', role: 'student' });
  const pending = f.service.loadBasics(); await tick();
  f.change(null);
  failOld(new Error('offline'));
  await assert.rejects(pending, /offline/);
  assert.equal(f.service.contentError(), '');
  assert.equal(f.service.contentLoading(), false);
  assert.equal(f.service.contentLoaded(), false);
});

test('question models survive a service reload and adding a card only fetches its questions', async () => {
  const first = fixture();
  await first.service.loadPracticeQuestions(['one']); first.service.ngOnDestroy();
  const second = fixture({ uid: 'b', role: 'student' }, first.storage);
  await second.service.loadPracticeQuestions(['one', 'two']);
  assert.deepEqual(plain(second.reads[0].filters[0][2]), ['two']);
  assert.equal(second.service.questions().length, 2);
  assert.equal(second.service.questions()[0].correctAnswer, 'a');
  assert([...first.storage.values()].every(raw => !raw.includes('studentProgress') && !raw.includes('studentQuestionProgress')));
});

test('saving and deleting content publishes a revision in the same write batch and refreshes questions', async () => {
  const f = fixture();
  await f.service.loadPracticeQuestions(['one']);
  f.change({ uid: 'teacher-a', role: 'teacher' });
  await f.service.saveQuestion({ id: 'q-one', flashcardId: 'one', category: 'reading', prompt: 'Updated', correctAnswer: 'new', createdBy: 'teacher-a' });
  assert.deepEqual(f.writes.slice(-2).map(item => item.ref.name), ['questions', 'contentMetadata']);
  assert.equal(f.writes.at(-1).data.revision.increment, 1);
  f.change({ uid: 'a', role: 'student' });
  f.handler(async ref => ({ docs: ref.name === 'questions' ? [{ id: 'q-one', data: () => ({ flashcardId: 'one', category: 'reading', correctAnswer: 'new' }) }] : [] }));
  await f.service.loadPracticeQuestions(['one']);
  assert.equal(f.service.questions()[0].correctAnswer, 'new');
  f.service.deleteQuestion('q-one'); await tick();
  assert.equal(f.writes.at(-2).deleted, true);
  assert.equal(f.writes.at(-1).ref.name, 'contentMetadata');
  f.handler(async () => ({ docs: [] }));
  await f.service.loadPracticeQuestions(['one']);
  assert.equal(f.service.questions().length, 0);
});

test('practice queries only learned cards, splits at 30, and reuses reads when adding a learned card', async () => {
  const f = fixture();
  const ids = Array.from({ length: 65 }, (_, index) => `card-${index}`);
  await f.service.loadPracticeQuestions(ids);
  assert.deepEqual(f.reads.map((ref) => ref.filters[0][2].length), [30, 30, 5]);
  assert.equal(f.service.questions().length, 65);
  assert(f.reads.every((ref) => ref.name === 'questions' && ref.filters[0][0] === 'flashcardId' && ref.filters[0][1] === 'in'));
  await f.service.loadPracticeQuestions([...ids].reverse());
  assert.equal(f.reads.length, 3);
  await f.service.loadPracticeQuestions([...ids, 'extra']);
  assert.equal(f.reads.length, 4);
  assert.deepEqual(plain(f.reads[3].filters[0][2]), ['extra']);
});

test('concurrent starts share a pending request; failed reads can be retried', async () => {
  const f = fixture(); let resolve;
  f.handler(() => new Promise((done) => { resolve = done; }));
  const first = f.service.loadPracticeQuestions(['one']);
  const second = f.service.loadPracticeQuestions(['one']);
  await tick();
  assert.equal(f.reads.length, 1);
  resolve({ docs: [] }); await Promise.all([first, second]);
  f.handler(async () => { throw new Error('offline'); });
  await assert.rejects(f.service.loadPracticeQuestions(['two']), /offline/);
  f.handler(async () => ({ docs: [] }));
  await f.service.loadPracticeQuestions(['two']);
  assert.equal(f.reads.length, 3);
});

test('logout clears displayed content and listeners; shared questions remain cached on relogin', async () => {
  const f = fixture();
  await f.service.loadPracticeQuestions(['one']);
  f.change(null);
  assert(f.listeners.every((entry) => entry.stopped));
  assert.equal(f.service.questions().length, 0);
  assert.equal(f.service.currentUserId(), '');
  assert.equal(f.service.flashcards().length, 0);
  f.change({ uid: 'a', role: 'student' });
  await f.service.loadPracticeQuestions(['one']);
  assert.equal(f.reads.length, 1);
  assert.equal(f.service.questions().length, 1);
});

test('an account change during a fetch rejects its result and does not fetch further batches', async () => {
  const f = fixture(); let resolve;
  f.handler(() => new Promise((done) => { resolve = done; }));
  const pending = f.service.loadPracticeQuestions(Array.from({ length: 35 }, (_, i) => `c-${i}`));
  await tick();
  f.change({ uid: 'b', role: 'student' });
  resolve({ docs: [{ id: 'stale', data: () => ({ flashcardId: 'c-0', category: 'reading' }) }] });
  await assert.rejects(pending, /Akun murid berubah/);
  assert.equal(f.reads.length, 1);
  assert.equal(f.service.questions().length, 0);
});

test('a catalog revision refreshes edits and removes deleted questions', async () => {
  const f = fixture();
  await f.service.loadPracticeQuestions(['one']);
  f.edit();
  f.handler(async () => ({ docs: [] }));
  await f.service.loadPracticeQuestions(['one']);
  assert.equal(f.reads.length, 2);
  assert.equal(f.service.questions().length, 0);
});

test('calendar query covers a full selected week across year and leap-day boundaries', () => {
  const f = fixture();
  const mod = load('core/services/activity-log-period.service.ts', f.modules);
  assert.deepEqual(plain(mod.activityCalendarRange('2025-12-29')), ['2025-12-29', '2026-01-04']);
  assert.deepEqual(plain(mod.activityCalendarRange('2026-12-28')), ['2026-12-28', '2027-01-03']);
  assert.deepEqual(plain(mod.activityCalendarRange('2028-02-28')), ['2028-02-28', '2028-03-05']);
  assert.deepEqual(plain(mod.activityPeriodQuery('2026-10-01', '2026-10-31').filters),
    [['dateId', '>=', '2026-10-01'], ['dateId', '<=', '2026-10-31']]);
});

test('historical year discovery reads only one log and stops for student accounts', () => {
  const f = fixture({ uid: 't', role: 'teacher' });
  const { ActivityLogPeriodService } = load('core/services/activity-log-period.service.ts', f.modules);
  const periods = new ActivityLogPeriodService(); f.flush();
  const entry = f.listeners.at(-1);
  assert.equal(entry.ref.name, 'studentActivityLogs');
  assert.deepEqual(plain(entry.ref.filters), [{ orderBy: ['dateId'] }, { limit: 1 }]);
  const year = new Date().getFullYear() - 3;
  entry.next({ docs: [{ data: () => ({ dateId: `${year}-01-01` }) }] });
  assert.equal(periods.yearOptions().at(-1).value, String(year));
  f.change({ uid: 's', role: 'student' });
  assert(entry.stopped);
  assert.equal(periods.yearOptions().length, 1);
});

test('staff activity detail replaces its period query and ignores callbacks from the previous period', () => {
  for (const [path, className, monthSignal, weekSignal] of [
    ['teacher/teacher-points.component.ts', 'TeacherPointsComponent', null, null],
  ]) {
    const f = fixture({ uid: 't', role: 'teacher' });
    const periodModule = load('core/services/activity-log-period.service.ts', f.modules);
    const Data = Symbol('data'), Auth = Symbol('auth'), Periods = Symbol('periods'), Route = Symbol('route');
    const instances = new Map([[Data, { students: () => [], loadDashboardCounts: async () => ({}), loadContentYears: async () => {}, loadContentProduction: async () => {} }], [Auth, { profile: () => ({ uid: 't' }) }],
      [Periods, { yearOptions: () => [], error: () => '' }], [Route, { snapshot: { data: {}, queryParamMap: { get: () => null } } }]]);
    const modules = { ...f.modules,
      '@angular/core': { ...f.modules['@angular/core'], inject: (token) => instances.get(token) ?? {} },
      '@angular/router': { ActivatedRoute: Route },
      '../../core/services/content-data.service': { ContentDataService: Data },
      '../../core/services/auth.service': { AuthService: Auth },
      '../../core/services/activity-log-period.service': { ...periodModule, ActivityLogPeriodService: Periods },
    };
    const Component = load(`features/${path}`, modules)[className];
    const component = new Component();
    if (monthSignal) { component[monthSignal].set('2026-12'); component[weekSignal].set('2026-12-28'); }
    else { component.startDateId.set('2026-12-01'); component.endDateId.set('2027-01-03'); }
    f.flush();
    const old = f.listeners.filter((entry) => entry.ref.name === 'studentActivityLogs').at(-1);
    assert.deepEqual(plain(old.ref.filters), [['dateId', '>=', '2026-12-01'], ['dateId', '<=', '2027-01-03']]);
    if (monthSignal) { component[monthSignal].set('2027-01'); component[weekSignal].set('2027-01-04'); }
    else { component.startDateId.set('2027-01-01'); component.endDateId.set('2027-01-31'); }
    f.flush();
    assert(old.stopped);
    const current = f.listeners.filter((entry) => entry.ref.name === 'studentActivityLogs').at(-1);
    assert.deepEqual(plain(current.ref.filters), [['dateId', '>=', '2027-01-01'], ['dateId', '<=', '2027-01-31']]);
    old.next({ docs: [{ id: 'old', data: () => ({ studentId: 'a', type: 'test_session', dateId: '2026-12-01' }) }] });
    assert.equal(component.activityLogs().length, 0);
    current.error(new Error('offline'));
    assert.match(component.dataWarning(), /offline/);
    current.next({ docs: [{ id: 'new', data: () => ({ studentId: 'a', type: 'test_session', dateId: '2027-01-01' }) }] });
    assert.equal(component.activityLogs().length, 1);
    assert.equal(component.dataWarning(), '');
  }
});

test('practice waits for questions, prevents duplicate starts, and aborts if the unit changes', async () => {
  const f = fixture();
  const core = { ...f.modules['@angular/core'], HostListener: () => () => {} };
  const { StudentLessonComponent } = load('features/student/student-lesson.component.ts', { ...f.modules, '@angular/core': core }, { crypto: { randomUUID: () => 'test-start' } });
  const start = StudentLessonComponent.prototype.startTest;
  let resolve, loads = 0, navigations = 0, unit = 'one';
  const harness = {
    posttestMode: false, canTest: () => true, practiceLoading: core.signal(false), practiceError: core.signal(''),
    practiceSavePending: core.signal(false), practiceAnswerLogError: core.signal(''), choosePracticeAnchorIds: () => ({}),
    selectedUnit: () => ({ id: unit, grade: 1 }), step: () => 'cards', learnedCards: () => [{ id: 'learned-card' }],
    data: { loadPracticeQuestions: (ids) => {
      loads++; assert.deepEqual(plain(ids), ['learned-card']);
      return new Promise((done) => { resolve = done; });
    }, questions: () => [] },
    learning: { loadQuestionProgress: async () => {}, beginPracticeSession: async () => ({ sessionId: 'test', sessionOrder: 1, sessionOfDay: 1, sessionKind: 'scheduled', anchorQuestionIds: {}, plan: Array.from({ length: 10 }, (_, index) => ({ questionId: `q-${index}` })) }) },
    testPlan: core.signal(Array.from({ length: 10 }, (_, index) => ({ questionId: `q-${index}` }))), createTestPlan: () => {},
    questionNumber: core.signal(0), score: core.signal(0), resetQuestionState: () => {},
    navigateStep: () => { navigations++; }, destroyed: false,
  };
  const pending = start.call(harness);
  await start.call(harness);
  assert.equal(loads, 1); assert.equal(navigations, 0);
  resolve(); await pending;
  assert.equal(navigations, 1); assert.equal(harness.practiceLoading(), false);
  const cancelled = start.call(harness); unit = 'two'; resolve(); await cancelled;
  assert.equal(navigations, 1);
  harness.data.loadPracticeQuestions = async () => { throw new Error('offline'); };
  await start.call(harness);
  assert.equal(navigations, 1); assert.equal(harness.practiceError(), 'offline');
});
