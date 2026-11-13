import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(file, imports = {}) {
  const source = readFileSync(new URL(`../src/app/${file}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: (id) => imports[id] ?? {}, console });
  return exports;
}
const vocabulary = load('core/content/vocabulary-search.ts');
const card = { id: 'hello', unitId: 'greeting', hanzi: '你好', pinyin: 'nǐ hǎo', meaning: 'Halo', createdBy: 'teacher' };

test('search accepts characters, meaning, and pinyin regardless of tones, case, or spaces', () => {
  for (const query of ['你好', 'HALO', 'nǐ hǎo', 'ni hao', 'nihao', '  NI  HAO ', 'ni\u030c ha\u030co', '']) {
    assert.equal(vocabulary.matchesVocabulary(card, query), true, query);
  }
  assert.equal(vocabulary.matchesVocabulary(card, 'sekolah'), false);
});

function signal(initial) {
  let value = initial;
  const read = () => value;
  read.set = (next) => { value = next; };
  read.update = (fn) => { value = fn(value); };
  return read;
}

for (const [file, className] of [
  ['question-management', 'QuestionManagementComponent'],
  ['flashcard-management', 'FlashcardManagementComponent'],
]) {
  test(`${file}: search reveals matching units, respects filters, and restores collapsed state`, () => {
    const data = {
      units: signal([{ id: 'greeting', grade: 1, name: 'Salam' }, { id: 'school', grade: 2, name: 'Sekolah' }]),
      flashcards: signal([card, { ...card, id: 'school-card', unitId: 'school', hanzi: '学校', pinyin: 'xué xiào', meaning: 'sekolah' }]),
      questions: signal([{ id: 'q1', flashcardId: 'hello', category: 'reading', createdBy: 'teacher', correctAnswer: '你好' }]),
      teachers: () => [], currentUserId: () => 'teacher', pointForCategory: () => 1,
      loadAllFlashcards: async () => {}, loadAllQuestions: async () => {},
    };
    class ActivatedRoute {}
    const component = load(`features/content/${file}.component.ts`, {
      '@angular/core': { Component: () => (target) => target, signal, computed: (fn) => fn,
        inject: (token) => token === ActivatedRoute ? { snapshot: { data: { adminMode: true } } } : data },
      '@angular/router': { ActivatedRoute },
      '../../core/content/vocabulary-search': vocabulary,
    });
    const page = new component[className]();
    assert.equal(page.isUnitOpen('greeting'), false);
    page.search.set('nihao');
    assert.equal(page.visibleUnits().length, 1);
    assert.equal(page.visibleUnits()[0].id, 'greeting');
    assert.equal(page.isUnitOpen('greeting'), true);
    assert.equal(page.totalFiltered(), 1);
    page.grade.set('2');
    assert.equal(page.visibleUnits().length, 0);
    page.grade.set('all');
    page.unitId.set('school');
    assert.equal(page.visibleUnits().length, 0);
    page.unitId.set('all');
    page.ownerId.set('another-teacher');
    assert.equal(page.totalFiltered(), 0);
    page.ownerId.set('all');
    if (page.category) {
      page.category.set('writing');
      assert.equal(page.totalFiltered(), 0);
      page.category.set('all');
    }
    page.search.set('tidak ditemukan');
    assert.equal(page.visibleUnits().length, 0);
    page.search.set('');
    assert.equal(page.visibleUnits().length, 2);
    assert.equal(page.isUnitOpen('greeting'), false);
    if (page.searchFlashcards) {
      page.openCreate();
      const originalSelection = page.form.flashcardId;
      page.flashcardSearchInput.set('xuexiao');
      assert.equal(page.flashcardOptions().length, 2, 'typing waits for the search button');
      page.searchFlashcards();
      assert.equal(page.flashcardOptions().length, 1);
      assert.equal(page.flashcardOptions()[0].value, 'school-card');
      assert.equal(page.form.flashcardId, originalSelection, 'search does not change the selected answer');
      page.changeFlashcard('school-card');
      assert.equal(page.form.correctAnswer, '学校');
      page.flashcardSearchInput.set('tidak ditemukan');
      page.searchFlashcards();
      assert.equal(page.flashcardOptions().length, 0);
      assert.equal(page.form.flashcardId, 'school-card');
      page.openEdit(data.questions()[0]);
      assert.equal(page.flashcardSearch(), '');
      assert.equal(page.flashcardSearchInput(), '');
      assert.equal(page.form.flashcardId, 'hello');
      page.openCreate();
      assert.equal(page.flashcardOptions().length, 2);
    }
    if (page.changeFormGrade) {
      page.openCreate();
      assert.equal(page.formGrade(), '1');
      assert.equal(page.formUnitOptions().length, 1);
      assert.equal(page.formUnitOptions()[0].label, 'Salam');
      page.changeFormGrade('2');
      assert.equal(page.form.unitId, 'school');
      assert.equal(page.formUnitOptions()[0].value, 'school');
      page.changeFormUnit('greeting');
      assert.equal(page.form.unitId, 'school', 'a chapter from another class cannot be selected');
      assert.equal(page.grade(), 'all', 'form selection does not change the page filter');
      page.changeFormGrade('6');
      assert.equal(page.form.unitId, '');
      assert.equal(page.formUnitOptions().length, 0);
      page.grade.set('2');
      page.openEdit(card);
      assert.equal(page.formGrade(), '1', 'editing uses the flashcard class instead of the page filter');
      assert.equal(page.form.unitId, 'greeting');
      page.openCreate();
      assert.equal(page.formGrade(), '2');
      assert.equal(page.form.unitId, 'school');
    }
  });
}
