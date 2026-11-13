import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture() {
  let profile = null;
  const effects = [];
  const listeners = [];
  const writes = [];
  const reads = [];
  let readHandler = async ref => ({ docs: [...documents].filter(([path,data]) => path.startsWith(ref.name+'/') && (ref.filters ?? []).every(([field,op,value]) => op === 'in' ? value.includes(data[field]) : data[field] === value)).map(([path,data]) => ({ id:path.split('/')[1], data:()=>data })) });
  const documents = new Map();
  const store = ({ref, data}) => {
    documents.set(`${ref.name}/${ref.id}`, { ...documents.get(`${ref.name}/${ref.id}`), ...data });
    if (ref.name === 'studentPoints') for (const entry of listeners) {
      if (!entry.stopped && entry.ref.name === ref.name && entry.ref.id === ref.id)
        entry.next({ exists: () => true, data: () => documents.get(`${ref.name}/${ref.id}`), metadata: { fromCache: false, hasPendingWrites: false } });
    }
  };
  const batches = { fail: false, sizes: [], beforeCommit: null };
  const signal = (initial) => {
    let value = initial;
    const read = () => value;
    read.set = (next) => { value = next; };
    read.update = (update) => { value = update(value); };
    return read;
  };
  class StudentApi {}
  const api = { post: async (action, body = {}) => {
    const uid = profile.uid;
    if (batches.beforeCommit) await batches.beforeCommit();
    if (batches.fail) throw new Error('offline');
    const pending = [];
    if (action === 'initialize' || action === 'practice-finish') {
      const previous = documents.get(`studentPoints/${uid}`) ?? {};
      const total = (previous.starBalance ?? previous.totalPoints ?? 0) + (action === 'practice-finish' ? 7 : 0);
      pending.push({ ref: { name: 'studentPoints', id: uid }, data: { studentId: uid, totalPoints: total, starBalance: total, totalStarsEarned: total } });
    }
    if (action === 'practice-answer') return { awardedPoint: 7, correct: true,
      progress: { questionId: 'one', status: 'correct', attempts: 1, correctAttempts: 1 } };
    const changed = [], progress = [];
    if (action === 'progress') for (const cardId of body.ids) {
      const ref = { name: 'studentProgress', id: `${uid}_${cardId}` }, previous = documents.get(`${ref.name}/${ref.id}`);
      if (body.source === 'bulk' && ((body.learned && previous?.learned) || (!body.learned && previous?.learnedSource !== 'bulk'))) {
        progress.push({ flashcardId: cardId, learned: previous?.learned === true, learnedSource: previous?.learnedSource ?? 'manual' }); continue;
      }
      pending.push({ ref, data: { studentId: uid, flashcardId: cardId, learned: body.learned, learnedSource: body.source } });
      if (body.learned && !previous?.learned) pending.push({ ref: { name: 'studentActivityLogs', id: `${uid}_${cardId}` }, data: { studentId: uid, pointEarned: 0 } });
      changed.push(cardId); progress.push({ flashcardId: cardId, learned: body.learned, learnedSource: body.source });
    }
    batches.sizes.push(pending.length); writes.push(...pending); pending.forEach(store);
    return { changed, progress };
  } };
  const imports = {
    '../../core/services/student-api.service': { StudentApiService: StudentApi },
    '@angular/core': {
      Injectable: () => (target) => target,
      inject: token => token === StudentApi ? api : ({ profile: () => profile }), signal,
      computed: (read) => read, untracked: (run) => run(),
      effect: (run) => { effects.push(run); },
    },
    'firebase/firestore': {
      collection: (_db, name) => ({ name }),
      doc: (_db, name, id) => ({ name, id }),
      where: (...args) => args,
      query: (ref, ...filters) => ({ ...ref, filters }),
      getDocs: (ref) => { reads.push(ref); return readHandler(ref); },
      getDocsFromServer: (ref) => { reads.push(ref); return readHandler(ref); },
      serverTimestamp: () => 'server-time',
      setDoc: () => { throw new Error('Students must write through the API.'); },
      writeBatch: () => { throw new Error('Students must write through the API.'); },
      runTransaction: () => { throw new Error('Students must write through the API.'); },

      onSnapshot: (ref, ...args) => {
        const offset = typeof args[0] === 'function' ? 0 : 1;
        const entry = { ref, next: args[offset], error: args[offset + 1], stopped: false };
        listeners.push(entry);
        return () => { entry.stopped = true; };
      },
    },
  };
  const source = readFileSync(new URL('../src/app/features/student/student-learning.service.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText;
  const exports = {};
  const microtasks = [];
  const starExports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/core/models/student-stars.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: starExports });
  imports['../../core/models/student-stars'] = starExports;
  runInNewContext(compiled, { exports, require: (id) => imports[id] ?? {},
    queueMicrotask: (run) => microtasks.push(run), console: { error() {} },
  });
  const service = new exports.StudentLearningService();
  const flush = () => {
    for (const run of effects) run(() => {});
    while (microtasks.length) microtasks.shift()();
  };
  const change = (uid, role = 'student', run = true) => {
    profile = uid ? { uid, role } : null;
    if (run) flush();
  };
  const latest = (name) => listeners.filter((entry) => entry.ref.name === name).at(-1);
  const points = (total, entry = latest('studentPoints'), metadata = {}) => {
    const data = { totalPoints: total, totalStarsEarned: total, starBalance: total };
    if (!metadata.fromCache) {
      if (total === null) documents.delete(`studentPoints/${entry.ref.id}`);
      else documents.set(`studentPoints/${entry.ref.id}`, data);
    }
    entry.next({ exists: () => total !== null, data: () => total === null ? undefined : data,
      metadata: { fromCache: false, hasPendingWrites: false, ...metadata } });
  };
  return { documents, batches, store, service, listeners, writes, reads, change, flush, latest, points, handler: (next) => { readHandler = next; } };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const progressReads = (f, name = 'studentProgress') => f.reads.filter(ref => ref.name === name);

test('65 card progress IDs use three ownership-scoped queries, including empty progress', async () => {
  const f = fixture(); f.change('student-a');
  const ids = Array.from({ length: 65 }, (_, index) => `card-${index}`);
  await f.service.loadProgressForCards(ids);
  const reads = progressReads(f);
  assert.deepEqual(reads.map(ref => ref.filters[1][2].length), [30, 30, 5]);
  assert(reads.every(ref => ref.filters[0][0] === 'studentId' && ref.filters[0][2] === 'student-a' && ref.filters[1][1] === 'in'));
  await f.service.loadProgressForCards(ids);
  assert.equal(progressReads(f).length, 3);
});

test('overlapping progress requests share pending IDs and preserve returned question history', async () => {
  const f = fixture(); f.change('student-a');
  f.handler(async ref => ({ docs: ref.name === 'studentQuestionProgress' ? ref.filters[1][2].map(id => ({
    data: () => ({ questionId: id, status: 'wrong', attempts: 3, wrongAttempts: 3 }),
  })) : [] }));
  await Promise.all([f.service.loadQuestionProgress(['one']), f.service.loadQuestionProgress(['one', 'two'])]);
  const ids = progressReads(f, 'studentQuestionProgress').flatMap(ref => ref.filters[1][2]);
  assert.deepEqual([...ids].sort(), ['one', 'two']);
  assert.equal(f.service.questionProgress().one.attempts, 3);
  assert.equal(f.service.questionWeight('two'), 2);
});

test('the most recently learned card is preserved across progress batches', async () => {
  const f = fixture(); f.change('student-a');
  f.handler(async ref => ({ docs: ref.name === 'studentProgress' ? ref.filters[1][2].map(id => ({
    data: () => ({ flashcardId: id, learned: true, updatedAt: { seconds: id === 'card-0' ? 1000 : 10 } }),
  })) : [] }));
  await f.service.loadProgressForCards(Array.from({ length: 65 }, (_, index) => `card-${index}`));
  assert.equal(f.service.learnedIds().size, 65);
  assert.equal(f.service.lastFlashcardId(), 'card-0');
});

test('failed progress batches can be retried without losing requested IDs', async () => {
  const f = fixture(); f.change('student-a');
  f.handler(async ref => { if (ref.name === 'studentProgress') throw new Error('offline'); return { docs: [] }; });
  await assert.rejects(f.service.loadProgressForCards(['one']), /offline/);
  f.handler(async () => ({ docs: [] }));
  await f.service.loadProgressForCards(['one']);
  assert.equal(progressReads(f).length, 2);
});

test('late progress from a prior account cannot populate the new account', async () => {
  const f = fixture(); f.change('student-a'); let resolve;
  f.handler(ref => ref.name === 'studentProgress' ? new Promise(done => { resolve = done; }) : Promise.resolve({ docs: [] }));
  const pending = f.service.loadProgressForCards(['one']); await tick();
  f.change('student-b');
  resolve({ docs: [{ data: () => ({ studentId: 'student-a', flashcardId: 'one', learned: true }) }] });
  await pending;
  assert.equal(f.service.learnedIds().size, 0);
  f.handler(async () => ({ docs: [] }));
  await f.service.loadProgressForCards(['one']);
  assert.equal(progressReads(f).at(-1).filters[0][2], 'student-b');
});

test('a progress response cannot overwrite an answer recorded while its read was pending', async () => {
  const f = fixture(); f.change('student-a'); let resolve;
  f.handler(ref => ref.name === 'studentQuestionProgress' ? new Promise(done => { resolve = done; }) : Promise.resolve({ docs: [] }));
  const pending = f.service.loadQuestionProgress(['one']); await tick();
  await f.service.recordPracticeAnswer({ questionId: 'one', sessionId: 'session', questionOrder: 1, response: 'answer', skipped: false, writingMistakes: 0, writingStrokes: 0 });
  resolve({ docs: [{ data: () => ({ questionId: 'one', status: 'wrong', attempts: 5 }) }] });
  await pending;
  assert.equal(f.service.questionProgress().one.status, 'correct');
});

test('overlapping activity requests share the same monthly query', async () => {
  const f = fixture(); f.change('student-a'); await tick();
  const month = '2025-02';
  await Promise.all([f.service.loadActivityRange(`${month}-01`, `${month}-10`), f.service.loadActivityRange(`${month}-05`, `${month}-20`)]);
  const reads = f.reads.filter(ref => ref.name === 'studentActivityLogs' && ref.filters[1][2] === month);
  assert.equal(reads.length, 1);
});

test('logout clears all student state and stops the previous subscriptions', async () => {
  const f = fixture();
  f.change('helen');
  f.points(161);
  f.service.learnedIds.set(new Set(['word-helen']));
  f.service.questionProgress.set({ 'question-helen': {} });
  f.service.activityLogs.set([{ pointEarned: 10 }]);
  f.service.previewAccessoryId.set('hat');
  const studentListeners = f.listeners.filter((entry) => entry.ref.name !== 'accessories');
  f.change(null);
  assert.equal(f.service.starBalance(), 0);
  assert.equal(f.service.learnedIds().size, 0);
  assert.equal(Object.keys(f.service.questionProgress()).length, 0);
  assert.equal(f.service.activityLogs().length, 0);
  assert.equal(f.service.previewAccessoryId(), null);
  assert(studentListeners.every((entry) => entry.stopped));
});

test('Helen to Katniss with no point document starts at zero, including a delayed old snapshot', async () => {
  const f = fixture();
  f.change('helen');
  const helen = f.latest('studentPoints');
  f.points(161);
  f.change('katniss');
  assert.equal(f.service.starBalance(), 0);
  f.points(161, helen);
  assert.equal(f.service.starBalance(), 0);
  f.points(null);
  await tick();
  assert.equal(f.service.starBalance(), 0);
  await f.service.addTestResult(7, { sessionId: 'verified-session' });
  assert.equal(f.service.starBalance(), 7);
  assert(f.writes.every((entry) => entry.data.studentId === 'katniss'));
});

test('returning to the same account starts a fresh subscription and rejects its earlier callbacks', async () => {
  const f = fixture();
  f.change('helen');
  const previous = f.latest('studentPoints');
  f.points(161);
  f.change(null);
  f.change('helen');
  const current = f.latest('studentPoints');
  assert.notEqual(current, previous);
  f.points(150, current);
  f.points(161, previous);
  assert.equal(f.service.starBalance(), 150);
});

test('mutations cannot use Helen while authentication has already switched to Katniss', async () => {
  const f = fixture();
  f.change('helen');
  f.points(161);
  f.change('katniss', 'student', false);
  f.service.addTestResult(10);
  f.service.toggleLearned('word-katniss');

  f.service.buyOrEquip('ribbon', 1);
  assert.equal(f.writes.length, 0);
  assert.equal(f.service.starBalance(), 161);
  assert.equal(f.service.learnedIds().size, 0);
});

test('point writes wait for the new account balance from the server', async () => {
  const f = fixture();
  f.change('helen');
  f.points(161);
  f.change('katniss');
  f.service.addTestResult(10);
  f.service.buyOrEquip('ribbon', 1);
  assert.equal(f.writes.length, 0);
  f.points(10, undefined, { fromCache: true });
  f.service.addTestResult(10);
  assert.equal(f.writes.length, 0);
  f.points(20);
  await f.service.addTestResult(7, { sessionId: 'verified-session' });
  assert.equal(f.service.starBalance(), 27);
  const saved = f.writes.find((entry) => entry.ref.name === 'studentPoints');
  assert.equal(saved.ref.id, 'katniss');
  assert.equal(saved.data.totalPoints, 27);
});

test('teacher or admin login cannot retain or mutate student points', async () => {
  for (const role of ['teacher', 'admin']) {
    const f = fixture();
    f.change('helen');
    f.points(161);
    f.change('staff', role);
    assert.equal(f.service.starBalance(), 0);
    f.service.addTestResult(10);
    f.service.toggleLearned('word');

    f.service.buyOrEquip('ribbon', 1);
    assert.equal(f.writes.length, 0);
  }
});

test('a point subscription error disables balance writes', async () => {
  const f = fixture();
  f.change('katniss');
  f.points(20);
  f.latest('studentPoints').error(new Error('quota exceeded'));
  await f.service.addTestResult(7, { sessionId: 'verified-session' });
  assert.equal(f.writes.length, 0);
});

test('marking all words is idempotent, keeps existing progress and never changes point balances', async () => {
  const f=fixture(); f.change('katniss'); f.points(75);
  f.service.learnedIds.set(new Set(['known']));
  f.documents.set('studentProgress/katniss_known', { studentId: 'katniss', flashcardId: 'known', learned: true, learnedSource: 'manual' });
  await f.service.markAllLearned(['known','new-a','new-b','new-a']);
  assert.equal(f.service.learnedIds().size,3);
  assert.equal(f.service.starBalance(),75);
  assert.equal(f.writes.length,4);
  assert(f.writes.every(write=>write.data.studentId==='katniss'));
  assert(f.writes.every(write=>write.ref.name!=='studentPoints'&&write.ref.name!=='testSessions'));
  assert(f.writes.filter(write=>write.ref.name==='studentActivityLogs').every(write=>write.data.pointEarned===0));
  await f.service.markAllLearned(['known','new-a','new-b']);
  assert.equal(f.writes.length,4);
});

test('mark-all splits large vocabularies below the Firestore batch limit', async () => {
  const f=fixture(); f.change('katniss');
  await f.service.markAllLearned(Array.from({length:201},(_,i)=>`word-${i}`));
  assert.deepEqual(f.batches.sizes,[200,200,2]);
  assert.equal(f.service.learnedIds().size,201);
});

test('failed mark-all is not shown as learned and can be retried', async () => {
  const f=fixture(); f.change('katniss'); f.batches.fail=true;
  await assert.rejects(()=>f.service.markAllLearned(['a','b']),/offline/);
  assert.equal(f.service.learnedIds().size,0);
  f.batches.fail=false; await f.service.markAllLearned(['a','b']);
  assert.equal(f.service.learnedIds().size,2);
});

test('switching accounts during mark-all cannot update the new account or continue further batches', async () => {
  const f=fixture(); f.change('helen');
  f.batches.beforeCommit=async()=>f.change('katniss');
  await assert.rejects(()=>f.service.markAllLearned(Array.from({length:201},(_,i)=>`word-${i}`)),/Akun murid berubah/);
  assert.equal(f.batches.sizes.length,1);
  assert.equal(f.service.learnedIds().size,0);
  assert(f.writes.every(write=>write.data.studentId==='helen'));
});

test('unchecking bulk marks removes only bulk additions and keeps manual and legacy marks', async () => {
  const f=fixture(); f.change('katniss'); f.points(75);
  const rows=[
    {data:()=>({flashcardId:'manual',learned:true,learnedSource:'manual'})},
    {data:()=>({flashcardId:'legacy',learned:true})},
  ];
  for(const item of rows){const data=item.data(); f.documents.set('studentProgress/katniss_'+data.flashcardId,{studentId:'katniss',...data});}
  await f.service.loadProgressForCards(rows.map(item=>item.data().flashcardId));
  await f.service.markAllLearned(['manual','legacy','auto']);
  assert.equal(f.documents.get('studentProgress/katniss_auto').learnedSource,'bulk');
  await f.service.unmarkAllLearned(['manual','legacy','auto']);
  assert.deepEqual(Array.from(f.service.learnedIds()).sort(),['legacy','manual']);
  assert.equal(f.documents.get('studentProgress/katniss_auto').learned,false);
  assert.equal(f.service.bulkLearnedIds().size,0); assert.equal(f.service.starBalance(),75);
  assert(f.writes.every(write=>write.ref.name!=='studentPoints'&&write.ref.name!=='testSessions'));
});
test('bulk source survives reload so unchecking remains safe after reopening the page', async () => {
  const f=fixture(); f.change('katniss');
  const saved={flashcardId:'auto',studentId:'katniss',learned:true,learnedSource:'bulk'};
  f.documents.set('studentProgress/katniss_auto',saved);
  const rows=[{data:()=>saved}];
  for(const item of rows){const data=item.data(); f.documents.set('studentProgress/katniss_'+data.flashcardId,{studentId:'katniss',...data});}
  await f.service.loadProgressForCards(rows.map(item=>item.data().flashcardId));
  assert(f.service.bulkLearnedIds().has('auto'));
  await f.service.unmarkAllLearned(['auto']);
  assert.equal(f.service.learnedIds().size,0);
});
test('manually rechecking a bulk word protects it from a later bulk undo', async () => {
  const f=fixture(); f.change('katniss'); await f.service.markAllLearned(['auto']);
  await f.service.toggleLearned('auto'); await f.service.toggleLearned('auto');
  await f.service.unmarkAllLearned(['auto']);
  assert(f.service.learnedIds().has('auto'));
  assert.equal(f.documents.get('studentProgress/katniss_auto').learnedSource,'manual');
});
test('bulk undo rechecks the saved source and keeps a word manually marked in another tab', async () => {
  const f=fixture(); f.change('katniss'); await f.service.markAllLearned(['auto']);
  f.documents.set('studentProgress/katniss_auto',{flashcardId:'auto',learned:true,learnedSource:'manual'});
  await f.service.unmarkAllLearned(['auto']);
  assert(f.service.learnedIds().has('auto')); assert.equal(f.service.bulkLearnedIds().size,0);
  assert.equal(f.documents.get('studentProgress/katniss_auto').learned,true);
});
test('failed bulk undo preserves progress and can be retried', async () => {
  const f=fixture(); f.change('katniss'); await f.service.markAllLearned(['auto']); f.batches.fail=true;
  await assert.rejects(()=>f.service.unmarkAllLearned(['auto']),/offline/);
  assert(f.service.learnedIds().has('auto')); assert(f.service.bulkLearnedIds().has('auto'));
  f.batches.fail=false; await f.service.unmarkAllLearned(['auto']); assert.equal(f.service.learnedIds().size,0);
});
test('bulk marking preserves manual progress not yet received by the local listener', async () => {
  const f=fixture(); f.change('katniss');
  f.documents.set('studentProgress/katniss_manual',{flashcardId:'manual',learned:true,learnedSource:'manual'});
  await f.service.markAllLearned(['manual','auto']);
  assert.equal(f.documents.get('studentProgress/katniss_manual').learnedSource,'manual');
  assert(!f.service.bulkLearnedIds().has('manual'));
  await f.service.unmarkAllLearned(['manual','auto']); assert(f.service.learnedIds().has('manual'));
});
