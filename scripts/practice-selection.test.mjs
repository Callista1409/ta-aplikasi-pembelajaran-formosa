import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const signal = (initial) => {
  let value = initial;
  return Object.assign(() => value, { set: next => { value = next; } });
};
let random = 0;
const math = Object.create(Math);
math.random = () => random;
function load(file) {
  const source = readFileSync(new URL(`../src/app/${file}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports, Math: math, crypto: { randomUUID: () => 'practice-session' },
    require: id => id === '@angular/core' ? {
      Component: () => type => type, Injectable: () => type => type, HostListener: () => () => {},
    } : {},
  });
  return exports;
}
const lesson = load('features/student/student-lesson.component.ts').StudentLessonComponent.prototype;
const learning = load('features/student/student-learning.service.ts').StudentLearningService.prototype;

function fixture(categories = ['reading', 'listening', 'speaking', 'writing']) {
  const cards = Array.from({ length: 10 }, (_, i) => ({ id: `card-${i}`, unitId: 'unit', hanzi: `${i}` }));
  // Only the later five words have been learned; the first five are deliberately excluded.
  const learned = cards.slice(5);
  const questions = cards.flatMap(card => categories.map(category => ({
    id: `${card.id}-${category}`, flashcardId: card.id, category,
  })));
  const harness = {
    learnedCards: () => learned,
    data: { questions: () => questions, flashcards: () => cards },
    learning: { questionWeight: () => 1 },
    testPlan: signal([]),
    weightedQuestionPick: lesson.weightedQuestionPick,
    shuffle: lesson.shuffle,
    createTestPlan: lesson.createTestPlan,
  };
  return { harness, cards, learned, questions };
}

test('all ten practice slots use learned candidates without requiring the first five words', () => {
  const { harness, learned } = fixture();
  random = 0.999;
  harness.createTestPlan();
  const plan = harness.testPlan();
  assert.equal(plan.length, 10);
  assert.equal(new Set(plan.map(item => item.questionId)).size, 10);
  assert(plan.every(item => learned.some(card => card.id === item.card.id)));
  for (const [category, count] of Object.entries({ reading: 3, listening: 2, speaking: 3, writing: 2 })) {
    assert.equal(plan.filter(item => item.category === category).length, count);
    // Even the first eligible candidate is not forced into a category's allocation.
    assert(!plan.some(item => item.questionId === `card-5-${category}`));
  }
});

test('weighted selection retains unseen 3, wrong 2, correct 1 probabilities', () => {
  const statuses = ['unseen', 'wrong', 'correct'];
  const items = statuses.map(status => ({ id: status }));
  const progress = Object.fromEntries(statuses.map(status => [status, { status }]));
  const harness = { learning: { questionWeight: id => learning.questionWeight.call({ questionProgress: () => progress }, id) } };
  for (const [draw, expected] of [[0, 'unseen'], [0.49, 'unseen'], [0.5, 'wrong'], [0.82, 'wrong'], [0.84, 'correct'], [0.999, 'correct']]) {
    random = draw;
    assert.equal(lesson.weightedQuestionPick.call(harness, items).id, expected);
  }
});

test('category shortages are filled from remaining learned questions without duplicates', () => {
  const { harness, cards } = fixture(['reading']);
  harness.learnedCards = () => cards;
  random = 0.4;
  harness.createTestPlan();
  assert.equal(harness.testPlan().length, 10);
  assert.equal(new Set(harness.testPlan().map(item => item.questionId)).size, 10);
});

test('practice starts with the selected IDs only and refuses an incomplete ten-question plan', async () => {
  for (const enough of [true, false]) {
    const { harness } = fixture(enough ? undefined : ['reading']);
    let starts = 0, navigations = 0;
    Object.assign(harness, {
      posttestMode: false, canTest: () => true, selectedUnit: () => ({ id: 'unit', grade: 1 }),
      step: () => 'cards', practiceLoading: signal(false), practiceSavePending: () => false,
      practiceError: signal(''), destroyed: false, questionNumber: signal(0), score: signal(0),
      practiceAnswerLogError: signal(''), resetQuestionState: () => {},
      navigateStep: () => { navigations++; },
    });
    harness.data.loadPracticeQuestions = async () => {};
    harness.learning.loadQuestionProgress = async () => {};
    harness.learning.beginPracticeSession = async (unitId, grade, ids, sessionId) => {
      starts++;
      assert.equal(unitId, 'unit'); assert.equal(grade, 1);
      assert.equal(sessionId, 'practice-session'); assert.equal(ids.length, 10);
      assert.deepEqual(Array.from(ids), Array.from(harness.testPlan(), item => item.questionId));
      return { sessionId, sessionOrder: 1, sessionOfDay: 1, sessionKind: 'scheduled', plan: harness.testPlan() };
    };
    await lesson.startTest.call(harness);
    assert.equal(starts, enough ? 1 : 0);
    assert.equal(navigations, enough ? 1 : 0);
    assert.equal(harness.practiceLoading(), false);
    assert.equal(!!harness.practiceError(), !enough);
  }
});
