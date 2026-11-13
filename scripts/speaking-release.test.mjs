import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture() {
  const spoken = [];
  let active;
  let recognition;
  const voices = [{ lang: 'zh-HK' }, { lang: 'zh-TW' }, { lang: 'zh-CN' }];
  class Utterance { constructor(text) { this.text = text; this.voice = null; } }
  class Recognition {
    constructor() { recognition = this; }
    start() {}
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  const window = { SpeechSynthesisUtterance: Utterance, SpeechRecognition: Recognition,
    speechSynthesis: {
      getVoices: () => voices,
      cancel: () => { const previous = active; active = null; previous?.onerror?.({ error: 'canceled' }); },
      speak: (value) => { active = value; spoken.push(value); },
    },
  };
  const core = { Injectable: () => target => target, Component: () => target => target, HostListener: () => () => {} };
  const modules = {};
  const load = file => {
    const source = readFileSync(new URL('../src/app/' + file, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
    const exports = {};
    runInNewContext(code, { exports, require: id => id === '@angular/core' ? core : modules[id] ?? {},
      window, SpeechSynthesisUtterance: Utterance, setTimeout, clearTimeout });
    return exports;
  };
  modules['../../core/content/curriculum-vocabulary-order'] = load('core/content/curriculum-vocabulary-order.ts');
  const { WebSpeechService } = load('core/services/web-speech.service.ts');
  const { StudentLessonComponent } = load('features/student/student-lesson.component.ts');
  return { service: new WebSpeechService(), Lesson: StudentLessonComponent, spoken, voices,
    recognition: () => recognition };
}

test('playback uses rate 0.82 and a Mandarin voice even with Cantonese listed first', async () => {
  const f = fixture();
  const done = f.service.speakMandarin('你好');
  assert.equal(f.spoken[0].rate, 0.82);
  assert.equal(f.spoken[0].text, '你好');
  assert.equal(f.spoken[0].voice.lang, 'zh-CN');
  f.spoken[0].onend(); await done;
});

test('Taiwan Mandarin is preferred over Cantonese when mainland voice is unavailable', async () => {
  const f = fixture(); f.voices.pop();
  const done = f.service.speakMandarin('你好');
  assert.equal(f.spoken[0].voice.lang, 'zh-TW');
  f.spoken[0].onend(); await done;
});

test('Tingting wins over another mainland Mandarin voice regardless of name order or default', async () => {
  const f = fixture();
  const tingting = { name: 'Tingting', lang: 'zh-CN' };
  f.voices.splice(0, f.voices.length,
    { name: 'Li-mu', lang: 'zh-CN', default: true }, tingting);
  const done = f.service.speakMandarin('你好');
  assert.equal(f.spoken[0].voice, tingting);
  assert.equal(f.spoken[0].lang, 'zh-CN');
  f.spoken[0].onend(); await done;
});

test('newly available Tingting replaces the voice used for previous playback', async () => {
  const f = fixture();
  const previous = f.service.speakMandarin('你好');
  f.spoken[0].onend(); await previous;
  const tingting = { name: '婷婷', voiceURI: 'com.apple.voice.compact.zh-CN.Ting-Ting', lang: 'zh_CN' };
  f.voices.push(tingting);
  const done = f.service.speakMandarin('谢谢');
  assert.equal(f.spoken[1].voice, tingting);
  f.spoken[1].onend(); await done;
});

test('without Tingting the default voice within the preferred Mandarin locale wins', async () => {
  const f = fixture();
  const preferred = { name: 'Z Mandarin', lang: 'zh-CN', default: true };
  f.voices.splice(0, f.voices.length, { name: 'A Mandarin', lang: 'zh-CN' }, preferred,
    { name: 'Tingting', lang: 'zh-HK' });
  const done = f.service.speakMandarin('你好');
  assert.equal(f.spoken[0].voice, preferred);
  f.spoken[0].onend(); await done;
});

test('stopping playback resolves cancellation rather than displaying an audio failure', async () => {
  const f = fixture(); const done = f.service.speakMandarin('你好');
  f.service.cancelSpeech(); await done;
});

test('starting another utterance safely cancels the old one even with a synchronous cancellation event', async () => {
  const f = fixture(); const previous = f.service.speakMandarin('你好');
  const current = f.service.speakMandarin('谢谢');
  await previous; f.spoken[1].onend(); await current;
});

test('actual playback errors remain visible', async () => {
  const f = fixture(); const done = f.service.speakMandarin('你好');
  f.spoken[0].onerror({ error: 'synthesis-failed' });
  await assert.rejects(done, /Suara tidak dapat diputar/);
});

test('speaking accepts minor multi-character recognition variation but rejects unrelated and single-character answers', () => {
  const { service } = fixture();
  assert.equal(service.matchesMandarin(' 你好！ ', '你好'), true);
  assert.equal(service.matchesMandarin('你号', '你好'), true);
  assert.equal(service.matchesMandarin('再见', '你好'), false);
  assert.equal(service.matchesMandarin('号', '好'), false);
  assert.equal(service.matchesMandarin('', '你好'), false);
  assert.equal(service.matchesMandarin('我喜欢学习中问', '我喜欢学习中文'), true);
  assert.equal(service.matchesMandarin('完全不同的答案', '我喜欢学习中文'), false);
});

test('recognition requests and retains more than five alternatives', async () => {
  const f = fixture(); const done = f.service.recognizeMandarin();
  const recognition = f.recognition();
  assert.equal(recognition.maxAlternatives, 10);
  const alternatives = Array.from({ length: 8 }, (_, i) => ({ transcript: `词语${i}`, confidence: 0.8 }));
  alternatives.isFinal = true;
  recognition.onresult({ results: [alternatives] }); recognition.onend();
  assert.equal((await done).alternatives.length, 8);
});

test('advancing a question cancels its audio and clears the playing indicator', async () => {
  const { Lesson } = fixture(); const actions = [];
  let number = 1;
  await Lesson.prototype.nextQuestion.call({ answered: () => true, posttestMode: false, practiceSavePending: () => false,
    practiceAnswerSaving: () => false, practiceAnswerLogError: () => '',
    speech: { cancelSpeech: () => actions.push('cancel') }, speakingCardId: { set: v => actions.push(v) },
    questionNumber: Object.assign(() => number, { update: run => { number = run(number); } }), testLength: () => 10,
    resetQuestionState: () => actions.push('reset'), prepareQuestionAfterRender: () => actions.push('prepare') });
  assert.equal(number, 2); assert.deepEqual(actions, ['cancel', null, 'reset', 'prepare']);
});

test('posttest speaking uses the same tolerance without adding practice points', async () => {
  const { service, Lesson } = fixture(); const recorded = [];
  service.recognizeMandarin = async () => ({ transcript: '你号', confidence: 0.7, alternatives: ['你号'] });
  const state = () => ({ set() {} });
  await Lesson.prototype.recordSpeakingAnswer.call({ answered: () => false,
    recognizingSpeech: Object.assign(() => false, { set() {} }), enableCorrectSound() {},
    recognizedText: state(), recognitionConfidence: state(), speechError: state(), feedback: state(),
    testCard: () => ({ hanzi: '你好' }), speech: service, posttestMode: true,
    recordPosttestAnswer: async (correct, response) => recorded.push({ correct, response }),
    learning: { addTestResult() { throw new Error('Practice points must not change.'); } } });
  assert.deepEqual(recorded, [{ correct: true, response: '你号' }]);
});

test('the transcript submitted for server grading retains a matching recognition alternative', async () => {
  const { service, Lesson } = fixture(); const recorded = [];
  service.recognizeMandarin = async () => ({ transcript: '完全不同', confidence: .5, alternatives: ['完全不同', '你好'] });
  const state = () => ({ set() {} });
  await Lesson.prototype.recordSpeakingAnswer.call({ answered: () => false,
    recognizingSpeech: Object.assign(() => false, { set() {} }), enableCorrectSound() {},
    recognizedText: state(), recognitionConfidence: state(), speechError: state(), feedback: state(),
    testCard: () => ({ hanzi: '你好' }), speech: service, posttestMode: true,
    recordPosttestAnswer: async (correct, response) => recorded.push({ correct, response }) });
  assert.deepEqual(recorded, [{ correct: true, response: '你好' }]);
});
