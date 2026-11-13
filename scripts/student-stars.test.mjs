import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture() {
  let profile = { role: 'student', uid: 'student-1' };
  const signal = initial => {
    let value = initial;
    const read = () => value;
    read.set = next => { value = next; };
    read.update = fn => { value = fn(value); };
    return read;
  };
  const api = { post: async () => { throw new Error("API stub missing"); } };
  const collection = (_, path) => ({ path });
  const doc = (_, name, id) => ({ name, id });
  const firestore = {
    collection, doc, query: (source, ...filters) => ({ ...source, filters }),
    where: (field, op, value) => ({ field, op, value }), getDocs: async () => ({ docs: [] }),
    onSnapshot: () => () => {},
    runTransaction: () => { throw new Error('Students must write through the API.'); },
    setDoc: () => { throw new Error('Students must write through the API.'); },
  };
  const core = { Injectable: () => target => target, Component: () => target => target,
    HostListener: () => () => {},
    inject: token => token === StudentApi ? api : ({ profile: () => profile }), signal, computed: fn => fn,
    effect: () => {}, untracked: fn => fn() };
  class StudentApi {}
  const modules = new Map();
  const load = file => {
    if (modules.has(file)) return modules.get(file);
    const source = readFileSync(new URL('../src/app/' + file, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
    const exports = {};
    runInNewContext(code, { exports, console, Date, Error, require: id => {
      if (id === '@angular/core') return core;
      if (id.endsWith('/student-api.service')) return { StudentApiService: StudentApi };
      if (id === 'firebase/firestore') return firestore;
      if (id.endsWith('/student-stars')) return load('core/models/student-stars.ts');
      if (id.endsWith('/practice-reward')) return load('core/models/practice-reward.ts');
      if (id.endsWith('/curriculum-vocabulary-order')) return load('core/content/curriculum-vocabulary-order.ts');
      return {};
    }});
    modules.set(file, exports);
    return exports;
  };
  const helper = load('core/models/student-stars.ts');
  const { StudentLearningService } = load('features/student/student-learning.service.ts');
  const service = new StudentLearningService();
  service.activeStudentId = 'student-1'; service.studentSession = 1; service.pointsLoaded.set(true);
  service.accessories.set([
    { id: 'hat', price: 350, name: 'Hat', owned: false, equipped: false },
    { id: 'glasses', price: 180, name: 'Glasses', owned: false, equipped: false },
  ]);
  return { api, service, helper,
    Lesson: load('features/student/student-lesson.component.ts').StudentLessonComponent,
    signal,
    switchAccount: () => { profile = { role: 'student', uid: 'student-2' }; service.activeStudentId = 'student-2'; service.studentSession++; } };
}

test('the service sends raw answers without authority fields and applies the saved progress', async () => {
  const f = fixture();
  const requests = [];
  f.api.post = async (action, body) => {
    requests.push({ action, body });
    return { awardedPoint: 2, correct: false, progress: { questionId: 'q', attempts: 1, status: 'wrong' } };
  };
  const result = await f.service.recordPracticeAnswer({ sessionId: 'session', questionId: 'q', questionOrder: 1,
    response: 'wrong', skipped: false, writingMistakes: 0, writingStrokes: 0,
    studentId: 'someone-else', correct: true, basePoint: 999, awardedPoint: 999 });
  assert.equal(result.awardedPoint, 2); assert.equal(result.correct, false);
  assert.equal(f.service.questionProgress()['q'].status, 'wrong');
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ action: 'practice-answer', body: {
    sessionId: 'session', questionOrder: 1, response: 'wrong', skipped: false, writingMistakes: 0, writingStrokes: 0,
  } }]);
});

test('finishing a session sends only its identity, never a browser-provided score', async () => {
  const f = fixture(); let request;
  f.api.post = async (action, body) => { request = { action, body }; return { points: 7, credited: true }; };
  f.service.loadActivityRange = async () => {};
  assert.equal(await f.service.addTestResult(999999, { sessionId: 'session', questionCount: 1000 }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { action: 'practice-finish', body: { sessionId: 'session' } });
});

test('failed API writes remain retryable and account switching does not publish old results', async () => {
  const f = fixture();
  f.api.post = async () => { throw new Error('offline'); };
  assert.equal(await f.service.addTestResult(7, { sessionId: 'session' }), false);
  assert.equal(f.service.starSaving(), false); assert.equal(f.service.starError(), 'offline');
  let finish;
  f.api.post = () => new Promise(resolve => { finish = resolve; });
  const pending = f.service.addTestResult(7, { sessionId: 'session' });
  f.switchAccount(); finish({ points: 7 });
  assert.equal(await pending, false);
});

test('negative or non-finite rewards and prices cannot corrupt the account', () => {
  const f = fixture(); const account = { totalStarsEarned: 600, starBalance: 200 };
  for (const invalid of [-1, NaN, Infinity]) {
    assert.throws(() => f.helper.creditStars(account, invalid));
    assert.throws(() => f.helper.spendStars(account, invalid));
  }
});

test('the result button waits for reward persistence and ignores duplicate clicks', async () => {
  const { Lesson, signal } = fixture();
  let finish, saves = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const routes = [];
  const state = {
    practiceSavePending: signal(false), practiceAnswerSaving: signal(false), practiceAnswerLogError: signal(''), answered: () => true, posttestMode: false,
    speech: { cancelSpeech() {} }, speakingCardId: { set() {} },
    questionNumber: () => 10, testLength: () => 10, score: () => 65,
    testCategorySummary: () => ({}), selectedUnitId: () => 'unit-1', practiceRewardId: 'stable-session',
    step: () => 'test', destroyed: false, feedback: signal(''),
    learning: { addTestResult: async () => { saves++; return pending; }, starError: () => '' },
    navigateStep: next => routes.push(next),
  };
  const first = Lesson.prototype.nextQuestion.call(state);
  await Lesson.prototype.nextQuestion.call(state);
  assert.equal(saves, 1); assert.equal(state.practiceSavePending(), true); assert.equal(routes.length, 0);
  finish(true); await first;
  assert.deepEqual(routes, ['result']); assert.equal(state.practiceSavePending(), false);
});

test('skipping practice records a zero-point answer once and preserves its base point', () => {
  const { Lesson, signal } = fixture();
  const attempts = [], answers = [];
  const state = {
    posttestMode: false, answered: signal(false), recognizingSpeech: signal(false), practiceAnswerSaving: signal(false),
    speech: { cancelSpeech() {} }, speakingCardId: signal(null), writingWriters: new Map(),
    testQuestion: () => ({ id: 'question-a' }), learning: { recordQuestionAttempt: (...args) => attempts.push(args) },
    practiceQuestionSkipped: signal(false), answerCorrect: signal(true), feedback: signal(''),
    testCategory: () => 'reading', data: { pointForCategory: () => 7 },
    queuePracticeAnswer: (...args) => { answers.push(args); state.pendingPracticeAnswer = {}; },
  };
  Lesson.prototype.skipPracticeQuestion.call(state);
  Lesson.prototype.skipPracticeQuestion.call(state);
  assert.deepEqual(attempts, []); // History is now saved atomically by the answer transaction.
  assert.deepEqual(answers, [[false, 7, 0, '', true]]);
  assert.equal(state.practiceQuestionSkipped(), true);
  assert.equal(state.answerCorrect(), false);
  assert.equal(state.advanceAfterPracticeAnswerSave, true);
});

test('dashboard and shop expose no gamification level or accessory level gate', () => {
  for (const name of ['student-dashboard', 'student-shop']) {
    const html = readFileSync(new URL(`../src/app/features/student/${name}.component.html`, import.meta.url), 'utf8');
    assert(!/level-ring|level-progress|requiredLevel|levelRewards/.test(html));
  }
});

test('the displayed score reconciles a stale preview to the saved reward', async () => {
  const { Lesson, signal } = fixture();
  const state = { pendingPracticeAnswer: { awardedPoint: 10 }, practiceAnswerSaving: signal(false), practiceAnswerLogError: signal(''),
    learning: { recordPracticeAnswer: async () => ({ awardedPoint: 7, correct: true }) }, score: signal(10), practiceAwardedPoint: signal(10), answerCorrect: signal(false), feedback: signal('') };
  await Lesson.prototype.persistPendingPracticeAnswer.call(state);
  assert.equal(state.score(), 7); assert.equal(state.practiceAwardedPoint(), 7);
  assert.equal(state.pendingPracticeAnswer, null); assert.match(state.feedback(), /7/);
});

test('Reading and Listening display and log reduced rewards', () => {
  const { Lesson, signal, service } = fixture();
  service.questionProgress.set({ 'q-a': { rewardCorrectAttemptsR3: 1 } });
  for (const [category, base, expected] of [['reading', 7, 5], ['listening', 3, 2]]) {
    const answers = [];
    const state = { answered: signal(false), selectedChoice: signal(null), correctChoice: () => 'A', posttestMode: false,
      testQuestion: () => ({ id: 'q-a' }), testCategory: () => category, data: { pointForCategory: () => base },
      learning: service, queuePracticeAnswer: (...args) => answers.push(args), playCorrectChime() {},
      score: signal(0), answerCorrect: signal(false), feedback: signal('') };
    Lesson.prototype.answer.call(state, 'A');
    assert.equal(state.score(), expected); assert.deepEqual(answers, [[true, base, expected, 'A']]);
  }
});

test('Speaking logs a reduced reward after recognition succeeds', async () => {
  const { Lesson, signal, service } = fixture(); const answers = [];
  service.questionProgress.set({ 'q-a': { rewardCorrectAttemptsR3: 1 } });
  const state = { answered: signal(false), recognizingSpeech: signal(false), enableCorrectSound() {},
    recognizedText: signal(''), recognitionConfidence: signal(null), speechError: signal(''), feedback: signal(''),
    speech: { recognizeMandarin: async () => ({ transcript: '\u4f60', alternatives: ['\u4f60'], confidence: 1 }),
      normalizeMandarin: value => value, matchesMandarin: (a, b) => a === b },
    testCard: () => ({ hanzi: '\u4f60' }), posttestMode: false, testQuestion: () => ({ id: 'q-a' }),
    playCorrectChime() {}, data: { pointForCategory: () => 6 }, learning: service,
    queuePracticeAnswer: (...args) => answers.push(args), score: signal(0), answerCorrect: signal(false) };
  await Lesson.prototype.recordSpeakingAnswer.call(state);
  assert.equal(state.score(), 4); assert.deepEqual(answers, [[true, 6, 4, '\u4f60']]);
});

test('Writing remains successful when a positive base score rounds to zero after reduction', () => {
  const { Lesson, signal, service } = fixture(); const answers = [];
  service.questionProgress.set({ 'q-a': { rewardCorrectAttemptsR3: 2 } });
  const state = { answered: signal(false), writingActiveCharacterMistakes: 0, writingMistakesBeforeCharacter: 0,
    writingMistakes: signal(0), writingCompleted: signal(new Set()), writingCharacters: () => ['X'], posttestMode: false,
    writingStrokeCounts: new Map([[0, 7]]), data: { writingScore: () => 1 }, testQuestion: () => ({ id: 'q-a' }), testCard: () => ({ hanzi: 'X' }),
    learning: service, queuePracticeAnswer: (...args) => answers.push(args), playCorrectChime() {}, score: signal(0),
    answerCorrect: signal(false), feedback: signal('') };
  Lesson.prototype.completeWritingCharacter.call(state, 0, 0);
  assert.deepEqual(answers, [[true, 1, 0, 'X']]); assert.equal(state.score(), 0); assert.equal(state.answerCorrect(), true);
});
