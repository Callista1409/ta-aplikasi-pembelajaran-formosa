import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const folder = new URL('../src/app/', import.meta.url);
function load(name, dependencies = {}) {
  const source = readFileSync(new URL(name, folder), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: (id) => dependencies[id] ?? {} });
  return exports;
}
const data = load('core/content/listening-scenarios.ts');
const { pretestListeningQuestion: adapt } = load('core/content/listening-question.ts', { './listening-scenarios': data });
const { StudentLessonComponent } = load('features/student/student-lesson.component.ts', {
  '@angular/core': { Component: () => (component) => component, HostListener: () => () => {} },
});
const question = { id: 'q-1', category: 'listening', flashcardId: 'fc-1', prompt: 'Pilih arti',
  correctAnswer: 'Kacang tanah', audioText: '花生', options: ['Kacang tanah', 'Air', 'Nasi', 'Apel'] };
const card = { id: 'fc-1', unitId: 'unit-1', hanzi: '花生', meaning: 'Kacang tanah' };

function validate(result) {
  assert.match(result.audioText, /[。！].+[？?]$/u);
  assert.equal(result.options.length, 4);
  assert.equal(new Set(result.options).size, 4);
  assert(result.options.every((option) => /[\u3400-\u9fff]/u.test(option)));
  assert.equal(result.options['ABCD'.indexOf(result.correctOption)], result.correctAnswer);
  assert.equal(result.id, question.id);
  assert.equal(result.flashcardId, question.flashcardId);
}

test('grade 5 asks about the story rather than identifying the spoken word', () => {
  const result = adapt(question, card, 5);
  validate(result);
  assert.equal(result.correctAnswer, '苹果');
  assert(result.audioText.includes('花生'));
  assert.equal(question.audioText, '花生');
});

test('grade 6 distinguishes the actual location from the assumed location', () => {
  const result = adapt(question, { ...card, hanzi: '后院' }, 6);
  validate(result);
  assert.equal(result.correctAnswer, '后院');
  assert(result.options.includes('郊外'));
});

test('every authored scenario and fallback has a stable, valid comprehension key', () => {
  for (const scenario of data.listeningScenarios) {
    assert.match(scenario.audioText, /[？?]$/u);
    assert.equal(new Set(scenario.answers).size, 4);
    for (const word of scenario.targets) {
      for (let seed = 0; seed < 4; seed += 1) {
        const input = { ...question, id: `q-${seed}` };
        const result = adapt(input, { ...card, hanzi: word }, scenario.grade);
        validate({ ...result, id: question.id });
        assert(result.audioText.includes(word));
        assert.equal(JSON.stringify(result), JSON.stringify(adapt(input, { ...card, hanzi: word }, scenario.grade)));
      }
    }
  }
  for (const grade of [5, 6]) {
    for (const hanzi of ['十万', '家务/家事', '取(名字)', '青/青色', '……前']) {
      validate(adapt(question, { ...card, hanzi }, grade));
    }
  }
});

test('lower grades and other question categories retain their existing behavior', () => {
  for (const grade of [1, 2, 3, 4, undefined]) assert.equal(adapt(question, card, grade), question);
  for (const category of ['reading', 'writing', 'speaking']) {
    const other = { ...question, category };
    assert.equal(adapt(other, card, 5), other);
    assert.equal(adapt(other, card, 6), other);
  }
});

test('complete teacher-authored stories are retained and their option letter is reconciled', () => {
  const custom = { ...question, audioText: '妈妈先去学校找老师，再去餐馆吃饭，最后回家休息。妈妈最后去哪里？',
    options: ['学校', '餐馆', '家', '办公室'], correctAnswer: '家', correctOption: 'A' };
  const result = adapt(custom, card, 5);
  assert.equal(result.audioText, custom.audioText);
  assert.equal(result.correctOption, 'C');
});

test('shared question data updates when cards arrive and serves the same story to management and students', () => {
  const signal = (initial) => {
    let value = initial;
    return Object.assign(() => value, { set: (next) => { value = next; } });
  };
  const { ContentDataService } = load('core/services/content-data.service.ts', {
    '@angular/core': { Injectable: () => (service) => service, inject: () => ({}),
      signal, computed: (read) => read, effect: () => {} },
    'firebase/firestore': { collection: () => ({}), onSnapshot: () => () => {} },
    '../firebase/firebase': { firestore: { app: { options: { projectId: 'test' } } } },
    './content-read-cache': { ContentReadCache: class {} },
    '../content/listening-question': { pretestListeningQuestion: adapt },
  });
  const service = new ContentDataService();
  service.sourceQuestions.set([question]);
  assert.equal(service.questions()[0], question);
  service.flashcards.set([card]);
  service.units.set([{ id: card.unitId, grade: 5 }]);
  const studentQuestion = service.questions()[0];
  const managementQuestion = service.questions()[0];
  assert.equal(studentQuestion.audioText, managementQuestion.audioText);
  assert.equal(studentQuestion.correctAnswer, '苹果');
  assert.equal(service.sourceQuestions()[0].audioText, '花生');
  service.units.set([{ id: card.unitId, grade: 4 }]);
  assert.equal(service.questions()[0], question);
});

function playbackHarness(upperGrade = true) {
  let playing = null;
  let error = '';
  let number = 1;
  const spoken = [];
  const harness = {
    testCard: () => card, testQuestion: () => ({ audioText: '完整的故事。问题？' }),
    questionNumber: () => number, step: () => 'test',
    speakingCardId: Object.assign(() => playing, { set: (value) => { playing = value; } }),
    speechError: { set: (value) => { error = value; } },
    usesPretestListening: () => upperGrade,
    speech: { speakMandarin: async (text) => { spoken.push(text); } },
  };
  return { harness, spoken, error: () => error, playing: () => playing, next: () => { number += 1; } };
}

test('upper-grade audio includes the story and question twice; lower grades play once', async () => {
  for (const upper of [true, false]) {
    const state = playbackHarness(upper);
    await StudentLessonComponent.prototype.playListeningAudio.call(state.harness);
    assert.equal(state.spoken.length, upper ? 2 : 1);
    assert(state.spoken.every((text) => text === '完整的故事。问题？'));
    assert.equal(state.playing(), null);
  }
});

test('playback stops repeating after changing questions and exposes audio failures', async () => {
  const changed = playbackHarness();
  changed.harness.speech.speakMandarin = async (text) => { changed.spoken.push(text); changed.next(); };
  await StudentLessonComponent.prototype.playListeningAudio.call(changed.harness);
  assert.equal(changed.spoken.length, 1);
  const failed = playbackHarness();
  failed.harness.speech.speakMandarin = async () => { throw new Error('Audio unavailable'); };
  await StudentLessonComponent.prototype.playListeningAudio.call(failed.harness);
  assert(failed.error());
  assert.equal(failed.playing(), null);
});
