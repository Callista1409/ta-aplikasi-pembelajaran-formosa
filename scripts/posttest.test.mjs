import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = new URL('../src/app/', import.meta.url);
function load(file, imports = {}) {
  const source = readFileSync(new URL(file, root), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: (id) => imports[id] ?? {} });
  return exports;
}
const curriculum = load('core/content/posttest-curriculum.ts');
const readings = load('core/content/posttest-reading.ts');
const scenarios = load('core/content/listening-scenarios.ts');
const plans = load('core/content/posttest-plan.ts', {
  './posttest-curriculum': curriculum, './posttest-reading': readings, './listening-scenarios': scenarios,
});
const { StudentLessonComponent } = load('features/student/student-lesson.component.ts', {
  '@angular/core': { Component: () => (component) => component, HostListener: () => () => {} },
  '../../core/content/posttest-plan': plans,
});
function fixture(grade) {
  const requirements = curriculum.posttestRequirements(grade);
  const units = [];
  const cards = requirements.map((row, index) => {
    const unitId = `csv-grade-${row.grade}-lesson-${row.chapter}`;
    if (!units.some((unit) => unit.id === unitId)) units.push({ id: unitId, grade: row.grade, name: `Pelajaran ${row.chapter}: Materi` });
    return { id: `fc-${index}`, unitId, hanzi: row.word, pinyin: 'pinyin', meaning: `Arti ${row.word}`, createdBy: 'teacher' };
  });
  const learned = new Set(cards.map((card) => card.id));
  return { requirements, units, cards, learned, vocabulary: curriculum.posttestVocabulary(grade, units, cards, learned) };
}

test('all six grades require every specified word and 60 unique questions mixed across four balanced categories', () => {
  for (let grade = 1; grade <= 6; grade += 1) {
    const f = fixture(grade);
    const plan = plans.buildPosttestPlan(grade, f.vocabulary);
    assert.equal(plan.length, 60);
    assert.equal(new Set(plan.map((item) => item.questionId)).size, 60);
    for (const category of ['reading', 'listening', 'speaking', 'writing']) {
      const section = plan.filter((item) => item.category === category);
      assert.equal(section.length, 15);
      if (category === 'listening') assert.equal(new Set(section.map((item) => item.question.audioText)).size, 15);
    }
    for (let offset = 0; offset < plan.length; offset += 15) {
      assert(new Set(plan.slice(offset, offset + 15).map((item) => item.category)).size > 1);
    }
    for (const item of plan) {
      assert(f.cards.some((card) => card.id === item.card.id));
      assert.equal(item.question.maximumPoint, 1);
      if (item.question.options) {
        assert.equal(item.question.options.length, 4);
        assert.equal(new Set(item.question.options).size, 4);
        assert.equal(item.question.options['ABCD'.indexOf(item.question.correctOption)], item.question.correctAnswer);
      }
      if (item.category === 'reading') assert(item.question.passage);
      if (item.category === 'listening' && grade >= 5) assert.match(item.question.audioText, /[。！].+[？?]$/u);
    }
  }
});

test('available vocabulary and valid grades can produce an exam without per-card learned progress', () => {
  assert.equal(plans.buildPosttestPlan(1, []).length, 0);
  assert.equal(plans.buildPosttestPlan(7, fixture(1).vocabulary).length, 0);
  const f = fixture(2);
  f.learned.delete(f.cards[0].id);
  assert.equal(plans.buildPosttestPlan(2, curriculum.posttestVocabulary(2, f.units, f.cards, f.learned)).length, 60);
  const incomplete = plans.buildPosttestPlan(2, curriculum.posttestVocabulary(2, f.units, f.cards.slice(1), f.learned));
  assert(incomplete.length < 60);
});

test('supporting vocabulary and source chapters determine availability, not individual learned state', () => {
  assert(curriculum.posttestRequirements(2).some((row) => row.word === '听' && row.chapter === 4));
  assert(curriculum.posttestRequirements(5).some((row) => row.word === '哥' && row.grade === 1 && row.chapter === 6));
  assert(curriculum.posttestRequirements(6).some((row) => row.word === '生活' && row.grade === 6 && row.chapter === 4));
  const f = fixture(6);
  const cat = f.cards.find((card) => card.hanzi === '猫');
  f.learned.delete(cat.id);
  assert.equal(plans.buildPosttestPlan(6, curriculum.posttestVocabulary(6, f.units, f.cards, f.learned)).length, 60);
});

test('slash variants, explanatory parentheses, and repeated family words map without substring matches', () => {
  const f = fixture(5);
  f.cards.find((card) => card.hanzi === '记住').hanzi = '记/记住';
  f.cards.find((card) => card.hanzi === '取').hanzi = '取(名字)';
  f.cards.find((card) => card.hanzi === '哥').hanzi = '哥哥';
  let vocabulary = curriculum.posttestVocabulary(5, f.units, f.cards, f.learned);
  assert(vocabulary.every((row) => row.learned));
  f.cards.find((card) => card.hanzi === '中学生').hanzi = '学生';
  vocabulary = curriculum.posttestVocabulary(5, f.units, f.cards, f.learned);
  assert.equal(vocabulary.find((row) => row.word === '中学生').cards.length, 0);
  const g6 = fixture(6);
  const recording = g6.cards.find((card) => card.hanzi === '记录');
  recording.hanzi = '记/记录';
  assert(curriculum.posttestVocabulary(6, g6.units, g6.cards, g6.learned).every((row) => row.learned));
});

test('same word in a wrong grade/chapter cannot unlock the prerequisite', () => {
  const f = fixture(2);
  const listen = f.cards.find((card) => card.hanzi === '听');
  listen.unitId = f.cards[0].unitId;
  const row = curriculum.posttestVocabulary(2, f.units, f.cards, f.learned).find((entry) => entry.word === '听');
  assert.equal(row.cards.length, 0);
  assert.equal(row.learned, false);
});

test('writing prompts use the pinyin of the selected vocabulary variant', () => {
  const f = fixture(5);
  const card = f.cards.find((item) => item.hanzi === '记住');
  card.hanzi = '记/记住'; card.pinyin = 'jì/jì zhù';
  const plan = plans.buildPosttestPlan(5, f.vocabulary);
  const item = plan.find((item) => item.category === 'writing' && item.card.hanzi === '记住');
  assert.equal(item.card.pinyin, 'jì zhù');
  assert(item.question.prompt.includes('(jì zhù)'));
});

test('scores use the available question count as denominator', () => {
  const plan = plans.buildPosttestPlan(1, fixture(1).vocabulary);
  const answers = plan.map((item, index) => ({ questionId: item.questionId, category: item.category, correct: index % 2 === 0 }));
  const summary = plans.posttestSummary(answers, plan);
  assert.equal(summary.correct, 30);
  assert.equal(summary.percentage, 50);
  assert(summary.categories.every((category) => category.total === 15));
});

test('posttest writing awards proportional credit and reports strokes and mistakes', () => {
  const plan = plans.buildPosttestPlan(1, fixture(1).vocabulary);
  const writing = plan.find((item) => item.category === 'writing');
  const answers = [{ questionId: writing.questionId, category: 'writing', correct: false, skipped: false,
    response: writing.card.hanzi, writingMistakes: 5, writingTotalStrokes: 15, earnedScore: 1 - 5 / 15 }];
  const summary = plans.posttestSummary(answers, plan);
  assert.equal(answers[0].writingTotalStrokes, 15);
  assert.equal(answers[0].writingMistakes, 5);
  assert.equal(summary.earned, 0.67);
  assert.equal(summary.percentage, 1.11);
  assert(Math.abs(summary.categories.find((row) => row.category === 'writing').earned - 2 / 3) < 0.0001);
});

function serviceFixture() {
  const f = fixture(5);
  const state = { profile: { uid: 'student-a', role: 'student', grade: 5 }, fail: false, writes: [], snapshot: null };
  const signal = (initial) => {
    let value = initial;
    return Object.assign(() => value, { set: (next) => { value = next; } });
  };
  const Api = Symbol('Api'); const Auth = Symbol('Auth'); const Data = Symbol('Data'); const Learning = Symbol('Learning');
  state.requests = [];
  state.result = { id: 'posttest-v1-student-a-g5', version: 1, grade: 5, plan: plans.buildPosttestPlan(5, f.vocabulary), answers: [], status: 'in_progress' };
  const api = { post: async (action, body) => {
    state.requests.push({ action, body });
    if (state.fail) throw new Error('offline');
    if (state.wait) await state.wait;
    return state.result;
  } };
  const instances = new Map([
    [Api, api],
    [Auth, { profile: () => state.profile }],
    [Data, { units: () => f.units, flashcards: () => f.cards }],
    [Learning, { learnedIds: () => f.learned }],
  ]);
  const module = load('features/student/student-posttest.service.ts', {
    '@angular/core': { Injectable: () => (service) => service, inject: (token) => instances.get(token), signal,
      computed: (read) => read, effect: (run) => run(() => {}) },
    'firebase/firestore': { collection: () => ({}), doc: (_, collection, id) => ({ collection, id }), where: (...args) => args, query: (ref, ...filters) => { state.filters = filters; return { ref, filters }; },
      onSnapshot: (_, options, next) => { state.snapshot = (value) => next({ metadata: { fromCache: false, hasPendingWrites: false }, ...value }); return () => {}; }, serverTimestamp: () => 'server-time',
      setDoc: async (path, payload) => { if (state.fail) throw new Error('offline'); state.writes.push({ path, payload }); } },
    '../../core/services/student-api.service': { StudentApiService: Api },
    '../../core/services/auth.service': { AuthService: Auth }, '../../core/services/content-data.service': { ContentDataService: Data },
    './student-learning.service': { StudentLearningService: Learning },
    '../../core/content/posttest-curriculum': curriculum, '../../core/content/posttest-plan': plans,
  });
  const service = new module.StudentPosttestService();
  assert.equal(state.filters.length, 2);
  assert.equal(state.filters[0][0], 'studentId');
  assert.equal(state.filters[0][2], state.profile.uid);
  assert.equal(state.filters[1][0], 'id');
  assert.match(state.filters[1][2], /^posttest-v.*-student-a-g5$/);
  state.snapshot({ docs: [] });
  return { f, state, service };
}

test('an empty cached history cannot unlock a new attempt before the server responds', () => {
  const { service, state } = serviceFixture();
  service.loaded.set(false);
  state.snapshot({ metadata: { fromCache: true, hasPendingWrites: false }, docs: [] });
  assert.equal(service.loaded(), false);
  state.snapshot({ docs: [] });
  assert.equal(service.loaded(), true);
});

test('posttest flashcards include all available required and supporting words without reading per-card progress', () => {
  const { f, service } = serviceFixture();
  assert.equal(service.studyCards().length, f.requirements.length);
  assert(service.studyCards().some((card) => card.hanzi === '哥'));
  assert(service.studyCards().some((card) => card.hanzi === '教室'));
  f.learned.delete(f.cards[0].id);
  assert.equal(service.studyCards().length, f.requirements.length);
  assert.equal(service.ready(), true);
  f.learned.add(f.cards[0].id);
  assert.equal(service.ready(), true);
  assert.equal(service.studyCards().length, f.requirements.length);
});

test('posttest uses an available vocabulary variant and skips unavailable prerequisites', () => {
  const { f, service } = serviceFixture();
  const original = f.cards.find((card) => card.hanzi === '哥');
  const alternative = { ...original, id: 'alt-brother', hanzi: '哥哥' };
  f.cards.push(alternative);
  f.learned.delete(original.id);
  f.learned.add(alternative.id);
  const selectedBrotherCard = service.studyCards().find((card) => curriculum.wordForms(card.hanzi).includes('哥'));
  assert(selectedBrotherCard);
  assert(['哥', '哥哥'].includes(selectedBrotherCard.hanzi));
  f.cards.splice(f.cards.findIndex((card) => card.hanzi === '台湾'), 1);
  assert(service.missing().some((row) => row.word === '台湾'));
  assert.equal(service.ready(), true);
  assert(service.plan().length < 60);
});

test('the posttest flashcard footer opens only the dedicated assessment when unlocked', () => {
  let started = 0;
  const harness = { posttestMode: true, canTest: () => false, startPosttest: () => { started += 1; },
    createTestPlan: () => { throw new Error('Must not create a practice quiz'); } };
  StudentLessonComponent.prototype.startTest.call(harness);
  assert.equal(started, 0);
  harness.canTest = () => true;
  StudentLessonComponent.prototype.startTest.call(harness);
  assert.equal(started, 1);
});

test('posttest choice answers bypass the practice points and progress systems', () => {
  const recorded = [];
  const harness = { answered: () => false, selectedChoice: { set: () => {} }, correctChoice: () => '台湾', posttestMode: true,
    recordPosttestAnswer: (correct, response) => recorded.push({ correct, response }),
    learning: { recordQuestionAttempt: () => { throw new Error('Practice history must not change'); } } };
  StudentLessonComponent.prototype.answer.call(harness, '台湾');
  StudentLessonComponent.prototype.answer.call(harness, '日本');
  assert.deepEqual(recorded, [{ correct: true, response: '台湾' }, { correct: false, response: '日本' }]);
});

test('posttest handwriting awards proportional credit based on stroke errors', () => {
  for (const mistakes of [0, 1, 5]) {
    const recorded = [];
    let mistakeCount = 0;
    const harness = { answered: () => false, writingActiveCharacterMistakes: 0, writingMistakesBeforeCharacter: 0,
      writingMistakes: Object.assign(() => mistakeCount, { set: (value) => { mistakeCount = value; } }),
      writingStrokeCounts: new Map([[0, 15]]), writingStrokeTotal: () => 15,
      writingCompleted: { update: (run) => run(new Set()) }, writingCharacters: () => ['你'], posttestMode: true,
      testCard: () => ({ hanzi: '你' }), recordPosttestAnswer: (correct, response, skipped, earnedScore) => recorded.push({ correct, response, skipped, earnedScore }) };
    StudentLessonComponent.prototype.completeWritingCharacter.call(harness, 0, mistakes);
    assert.deepEqual(recorded, [{ correct: mistakes === 0, response: '你', skipped: false, earnedScore: 1 - mistakes / 15 }]);
  }
});

test('cancelled handwriting callbacks cannot affect the next question', () => {
  let callbacks;
  const values = [];
  const harness = { answered: () => false, step: () => 'test', testCategory: () => 'writing', writingGeneration: 1,
    writingWriters: new Map([[0, { quiz: (options) => { callbacks = options; return Promise.resolve(); } }]]),
    writingActiveIndex: { set: () => {} }, writingStatus: { set: () => {} }, posttestMode: true,
    writingMistakes: { set: (value) => values.push(value) },
    completeWritingCharacter: () => { throw new Error('Stale completion'); } };
  StudentLessonComponent.prototype.startWritingCharacter.call(harness, 0);
  assert.equal(callbacks.showHintAfterMisses, 2);
  harness.writingGeneration = 2;
  callbacks.onMistake({ totalMistakes: 3 });
  callbacks.onCorrectStroke({ strokeNum: 0 });
  callbacks.onComplete({ totalMistakes: 0 });
  assert.equal(values.length, 0);
});

const archiveModel = load('core/content/posttest-archive.ts', { './posttest-plan': plans });
function archiveFixture(role = 'student') {
  const profile = { uid: 'student-a', role };
  const state = { filter: null, next: null };
  const Auth = Symbol('ArchiveAuth');
  const signal = (initial) => {
    let value = initial;
    return Object.assign(() => value, { set: (next) => { value = next; } });
  };
  const module = load('core/services/posttest-archive.service.ts', {
    '@angular/core': { Injectable: () => (service) => service, inject: () => ({ profile: () => profile }), signal,
      effect: (run) => run(() => {}) },
    'firebase/firestore': { collection: () => ({}), where: (field, operator, value) => ({ field, operator, value }),
      query: (_, filter) => { state.filter = filter; return {}; },
      onSnapshot: (_, next) => { state.next = next; return () => {}; } },
    './auth.service': { AuthService: Auth }, '../content/posttest-archive': archiveModel,
  });
  return { state, service: new module.PosttestArchiveService() };
}
function archivedDocument(studentId, status = 'completed') {
  const plan = plans.buildPosttestPlan(5, fixture(5).vocabulary);
  return { id: `archive-${studentId}`, data: () => ({ mode: 'posttest', studentId, status, grade: 5, version: 1, plan,
    answers: plan.map((item) => ({ questionId: item.questionId, category: item.category, correct: true, response: '', skipped: false })),
    completedAt: { seconds: 1000 } }) };
}
test('archive does not subscribe to assessment history for student accounts', () => {
  const { state, service } = archiveFixture();
  assert.equal(state.filter, null);
  assert.equal(state.next, null);
  assert.equal(service.entries().length, 0);
  assert.equal(service.loaded(), true);
});
test('archive links appear only in the teacher navigation, while student assessments remain available', () => {
  const { STUDENT_ROUTES } = load('features/student/student.routes.ts');
  const { TEACHER_ROUTES } = load('features/teacher/teacher.routes.ts');
  assert(!STUDENT_ROUTES[0].data.navigation.some((item) => item.path === 'posttest-archive'));
  assert(TEACHER_ROUTES[0].data.navigation.some((item) => item.path === 'posttest-archive'));
  const oldLink = STUDENT_ROUTES[0].children.find((route) => route.path === 'posttest-archive');
  assert.equal(oldLink.redirectTo, 'posttest');
  assert(STUDENT_ROUTES[0].children.some((route) => route.path === 'posttest' && route.loadComponent));
  const template = readFileSync(new URL('features/student/student-lesson.component.html', root), 'utf8');
  assert(!template.includes('routerLink="../posttest-archive"'));
});
test('teacher archive reads completed posttests separately from the practice point collection', () => {
  const { state, service } = archiveFixture('teacher');
  assert.equal(state.filter.field, 'mode');
  assert.equal(state.filter.value, 'posttest');
  state.next({ docs: [archivedDocument('student-a'), archivedDocument('student-b'), archivedDocument('student-c', 'in_progress')] });
  assert.equal(service.entries().length, 2);
  assert(service.entries().every((entry) => entry.status === 'completed'));
});
test('posttest never requires vocabulary deliberately excluded by import and archival policy', () => {
  const excludedSets = ['import-vocabulary-csv.mjs', 'archive-vocabulary-entries.mjs'].map((file) => {
    const script = readFileSync(new URL(file, import.meta.url), 'utf8');
    const match = script.match(/const excludedHanzi = new Set\(\[([^\]]+)\]\)/);
    assert(match, `${file} must declare its excluded vocabulary`);
    return [...match[1].matchAll(/'([^']+)'/g)].map((word) => word[1]);
  });
  for (let grade = 1; grade <= 6; grade += 1) {
    const words = curriculum.posttestRequirements(grade).map((row) => row.word);
    for (const excluded of excludedSets.flat()) assert(!words.includes(excluded), `Grade ${grade} requires excluded word ${excluded}`);
  }
  const f = fixture(5);
  assert.equal(f.vocabulary.length, 55);
  assert(!f.vocabulary.some((row) => row.word === '阿'));
  assert.equal(plans.buildPosttestPlan(5, f.vocabulary).length, 60);
});

test('posttest writing uses quiz rounding before normalizing credit and clamps at zero', () => {
  for (const [mistakes, strokes, expected] of [[0,10,1],[2,10,0.8],[1,3,0.7],[5,10,0.5],[10,10,0],[20,10,0],[0,0,0],[-1,10,1]]) {
    assert.equal(plans.posttestWritingScore(mistakes, strokes), expected);
  }
});

test('fractional writing credit contributes to the final score, category score and teacher archive', () => {
  const plan = plans.buildPosttestPlan(1, fixture(1).vocabulary);
  const writingIndex = plan.findIndex(item => item.category === 'writing');
  const answers = plan.map(item => ({ questionId: item.questionId, category: item.category, correct: true, skipped: false, writingMistakes: 0 }));
  answers[writingIndex] = { ...answers[writingIndex], correct: false, score: 0.8, writingMistakes: 2, writingStrokes: 10 };
  const result = plans.posttestSummary(answers);
  assert.equal(result.correct, 59);
  assert.equal(result.score, 59.8);
  assert.equal(result.percentage, 99.67);
  assert.equal(result.categories.find(row => row.category === 'writing').score, 14.8);
  const archive = load('core/content/posttest-archive.ts', { './posttest-plan': plans });
  const entry = archive.posttestArchiveEntry('session', { mode: 'posttest', status: 'completed', studentId: 'student-a', grade: 1, plan, answers });
  assert.equal(entry.summary.score, 59.8);
  assert.equal(entry.summary.percentage, 99.67);
});

test('skipped writing scores zero and binary historical answers keep their saved scores', () => {
  assert.equal(plans.posttestAnswerScore({ category: 'writing', correct: false, writingMistakes: 1 }), 0);
  assert.equal(plans.posttestAnswerScore({ category: 'writing', correct: true }), 1);
  assert.equal(plans.posttestAnswerScore({ category: 'writing', correct: true, skipped: true, score: 0.8 }), 0);
  assert.equal(plans.posttestAnswerScore({ category: 'writing', score: -1 }), 0);
  assert.equal(plans.posttestAnswerScore({ category: 'writing', score: 4 }), 1);
  assert.equal(plans.posttestAnswerScore({ category: 'reading', correct: false, score: 0.9 }), 0);
});

test('the actual answer recorder saves partial writing credit together with errors and stroke count', async () => {
  let saved;
  const state = { set() {} };
  const harness = { answered: Object.assign(() => false, state), testQuestion: () => ({id:'writing-1'}), testCategory: () => 'writing',
    writingMistakes: () => 2, writingStrokeTotal: () => 10, answerCorrect: state, posttestSavePending: state,
    async retryPosttestSave() { saved = this.pendingPosttestAnswer; } };
  await StudentLessonComponent.prototype.recordPosttestAnswer.call(harness, false, '你好');
  assert.equal(saved.score, 0.8); assert.equal(saved.writingMistakes, 2); assert.equal(saved.writingStrokes, 10);
  assert.equal(saved.correct, false);
});

test('mark-all can mark available words even with a missing prerequisite and resets after a failed save', async () => {
  let calls=0, busy=false, error=''; const control={checked:true};
  const harness={posttestMode:true, markingAllLearned:Object.assign(()=>busy,{set:v=>{busy=v;}}),
    markAllLearnedError:{set:v=>{error=v;}}, allAvailablePosttestLearned:()=>false, bulkPosttestChecked:()=>false, bulkMarkRequested:{set(){}}, posttest:{missing:()=>['missing-word'],ready:()=>false}, cards:()=>[{id:'a'}],
    learning:{markAllLearned:async(ids)=>{calls++;assert.deepEqual(Array.from(ids),['a']);throw new Error('offline');}}};
  await StudentLessonComponent.prototype.markAllPosttestLearned.call(harness,control);
  assert.equal(calls,1); assert.equal(busy,false); assert.equal(control.checked,false); assert(error === 'offline' || error.includes('Coba lagi'));
  harness.posttestMode=false;
  await StudentLessonComponent.prototype.markAllPosttestLearned.call(harness,control);
  assert.equal(calls,1);
});


test('retry completion updates the component with fractional score rather than full-correct count', async () => {
  let score=-1;
  const harness={pendingPosttestAnswer:{questionId:'w'}, posttest:{saving:()=>false, saveAnswer:async()=>{}, summary:()=>({correct:0,score:0.8})},
    posttestSavePending:{set(){}},score:{set:value=>{score=value;}},feedback:{set(){}}};
  await StudentLessonComponent.prototype.retryPosttestSave.call(harness);
  assert.equal(score,0.8); assert.equal(harness.pendingPosttestAnswer,null);
});

test('clearing the mark-all checkbox calls bulk undo rather than marking every word again', async () => {
  let undone=false,checked=true;
  const harness={posttestMode:true,markingAllLearned:Object.assign(()=>false,{set(){}}),markAllLearnedError:{set(){}},
    cards:()=>[{id:'a'}],bulkMarkRequested:{set(value){checked=value;}},bulkPosttestChecked:()=>checked,
    learning:{unmarkAllLearned:async(ids)=>{assert.deepEqual(Array.from(ids),['a']);undone=true;},markAllLearned:()=>{throw new Error('wrong action');}}};
  const control={checked:false}; await StudentLessonComponent.prototype.markAllPosttestLearned.call(harness,control);
  assert(undone); assert.equal(control.checked,false);
});

test('the API supplies the posttest plan and receives raw responses without scores or client answer keys', async () => {
  const { state, service } = serviceFixture();
  const session = await service.begin([{ forged: true }]);
  assert.equal(session.plan.length, 60);
  assert.deepEqual(JSON.parse(JSON.stringify(state.requests[0])), { action: 'posttest-start', body: {} });
  state.result = { ...session, answers: [{ questionId: 'server-question', category: 'writing', score: .8, correct: false }], status: 'in_progress' };
  await service.saveAnswer({ questionId: 'server-question', response: '字', skipped: false, writingMistakes: 2, writingStrokes: 10, correct: true, score: 999 });
  assert.equal(service.summary().score, .8);
  assert.deepEqual(JSON.parse(JSON.stringify(state.requests[1])), { action: 'posttest-answer', body: {
    questionId: 'server-question', response: '字', skipped: false, writingMistakes: 2, writingStrokes: 10,
  } });
  assert.equal(state.writes.length, 0);
});

test('API failure preserves the saved posttest and can be retried', async () => {
  const { state, service } = serviceFixture();
  const session = await service.begin(state.result.plan);
  state.fail = true;
  const answer = { questionId: session.plan[0].questionId, response: '', skipped: true, writingMistakes: 0 };
  await assert.rejects(service.saveAnswer(answer), /offline/);
  assert.equal(service.session().answers.length, 0); assert.equal(service.saving(), false);
  state.fail = false; state.result = { ...session, answers: [{ ...answer, correct: false, score: 0 }] };
  await service.saveAnswer(answer); assert.equal(service.session().answers.length, 1);
});

test('an API response for an old account cannot replace the new account posttest', async () => {
  const { state, service } = serviceFixture();
  let finish; state.wait = new Promise(resolve => { finish = resolve; });
  const pending = service.begin(state.result.plan);
  state.profile = { ...state.profile, uid: 'student-b' }; finish();
  await assert.rejects(pending, /Akun berubah/); assert.equal(service.session(), null);
});
