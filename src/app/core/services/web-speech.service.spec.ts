import { WebSpeechService } from './web-speech.service';

// These tests check playback settings; audio quality still depends on device voices.
describe('Mandarin playback', () => {
  let service: WebSpeechService;
  let voices: jasmine.Spy;
  let speak: jasmine.Spy;

  function voice(lang: string): SpeechSynthesisVoice {
    return { lang, name: lang, voiceURI: lang, default: false, localService: true };
  }

  beforeEach(() => {
    spyOn(window, 'SpeechSynthesisUtterance').and.returnValue({ text: '你好', voice: null } as SpeechSynthesisUtterance);
    voices = spyOn(window.speechSynthesis, 'getVoices');
    spyOn(window.speechSynthesis, 'cancel');
    speak = spyOn(window.speechSynthesis, 'speak').and.callFake((utterance) => {
      utterance.onend?.(new Event('end') as SpeechSynthesisEvent);
    });
    service = new WebSpeechService();
  });

  it('slows playback and prefers Mandarin over a Cantonese voice listed first', async () => {
    const mandarin = voice('zh-CN');
    voices.and.returnValue([voice('zh-HK'), voice('zh-TW'), mandarin]);
    await service.speakMandarin('你好');
    const utterance = speak.calls.mostRecent().args[0] as SpeechSynthesisUtterance;
    expect(utterance.rate).toBe(0.82);
    expect(utterance.pitch).toBe(1);
    expect(utterance.text).toBe('你好');
    expect(utterance.voice).toBe(mandarin);
    expect(utterance.lang).toBe('zh-CN');
  });

  it('uses Taiwan Mandarin when mainland Mandarin is unavailable', async () => {
    const mandarin = voice('zh-TW');
    voices.and.returnValue([voice('zh-HK'), mandarin]);
    await service.speakMandarin('你好');
    const utterance = speak.calls.mostRecent().args[0] as SpeechSynthesisUtterance;
    expect(utterance.voice).toBe(mandarin);
    expect(utterance.lang).toBe('zh-TW');
  });

  it('requests Mandarin from the browser when no Mandarin voice is listed', async () => {
    voices.and.returnValue([voice('zh-HK'), voice('en-US')]);
    await service.speakMandarin('你好');
    const utterance = speak.calls.mostRecent().args[0] as SpeechSynthesisUtterance;
    expect(utterance.voice).toBeNull();
    expect(utterance.lang).toBe('zh-CN');
  });
});