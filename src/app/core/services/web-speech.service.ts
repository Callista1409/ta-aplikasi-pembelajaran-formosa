import { Injectable } from '@angular/core';

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface BrowserSpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionEvent extends Event {
  readonly results: {
    readonly length: number;
    [index: number]: BrowserSpeechRecognitionResult;
  };
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export interface SpeechRecognitionOutcome {
  transcript: string;
  confidence: number;
  alternatives: string[];
}

@Injectable({ providedIn: 'root' })
export class WebSpeechService {
  private activeRecognition: BrowserSpeechRecognition | null = null;
  private speechRequestId = 0;

  readonly synthesisSupported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window;

  readonly recognitionSupported = this.recognitionConstructor !== null;

  cancelSpeech(): void {
    this.speechRequestId += 1;
    if (this.synthesisSupported) window.speechSynthesis.cancel();
  }

  async speakMandarin(text: string): Promise<void> {
    if (!this.synthesisSupported) {
      throw new Error('Browser ini belum mendukung suara otomatis.');
    }

    const requestId = ++this.speechRequestId;
    const available = window.speechSynthesis.getVoices();
    const mandarinVoice = available.length ? this.selectMandarinVoice(available) : await this.getMandarinVoice();
    if (requestId !== this.speechRequestId) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = mandarinVoice?.lang ?? 'zh-CN';
    utterance.rate = 0.82;
    utterance.pitch = 1;
    utterance.voice = mandarinVoice;

    return new Promise((resolve, reject) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => {
        if (requestId !== this.speechRequestId) resolve();
        else reject(new Error('Suara tidak dapat diputar. Coba lagi.'));
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  private async getMandarinVoice(): Promise<SpeechSynthesisVoice | null> {
    const synthesis = window.speechSynthesis;
    let voices = synthesis.getVoices();
    if (!voices.length) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          synthesis.removeEventListener('voiceschanged', finish);
          resolve();
        };
        const timeout = window.setTimeout(finish, 800);
        synthesis.addEventListener('voiceschanged', finish);
      });
      voices = synthesis.getVoices();
    }

    return this.selectMandarinVoice(voices);
  }

  private selectMandarinVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const isMandarin = (voice: SpeechSynthesisVoice) => /^(zh(?:[-_](?:cn|sg|tw|hans|hant))?|cmn(?:[-_](?:cn|tw|hans|hant))?)$/i.test(voice.lang);
    const candidates = voices.filter(isMandarin);
    if (!candidates.length) return null;
    // Re-evaluate each time: Safari can expose downloaded voices after the first playback.
    const isTingting = (voice: SpeechSynthesisVoice) =>
      /ting[\s_-]*ting|婷婷/i.test(`${voice.name ?? ''} ${voice.voiceURI ?? ''}`);
    candidates.sort((left, right) => {
      const rank = (voice: SpeechSynthesisVoice) => {
        const lang = voice.lang.toLowerCase().replace('_', '-');
        if (lang === 'zh-cn' || lang === 'cmn-cn') return 0;
        if (lang === 'zh-hans' || lang === 'zh-sg') return 1;
        return 2;
      };
      return Number(isTingting(right)) - Number(isTingting(left))
        || rank(left) - rank(right)
        || Number(Boolean(right.default)) - Number(Boolean(left.default))
        || (left.name ?? left.lang).localeCompare(right.name ?? right.lang);
    });
    return candidates[0];
  }

  recognizeMandarin(): Promise<SpeechRecognitionOutcome> {
    const Recognition = this.recognitionConstructor;
    if (!Recognition) {
      return Promise.reject(
        new Error('Pengenalan suara belum tersedia. Gunakan Chrome atau Edge terbaru.'),
      );
    }

    this.cancelRecognition();
    const recognition = new Recognition();
    this.activeRecognition = recognition;
    recognition.lang = 'zh-CN';
    // Keep listening through short pauses so multi-character vocabulary is not truncated.
    recognition.continuous = true;
    recognition.interimResults = true;
    // Chrome/Edge may still return fewer alternatives, but this allows the
    // browser to provide a wider candidate set when its speech service supports it.
    recognition.maxAlternatives = 10;

    return new Promise((resolve, reject) => {
      let settled = false;
      let latestTranscript = '';
      let latestAlternatives: string[] = [];
      let latestConfidence = 0;
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;
      let startupTimer: ReturnType<typeof setTimeout> | null = null;
      let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        if (startupTimer) clearTimeout(startupTimer);
        if (watchdogTimer) clearTimeout(watchdogTimer);
        if (this.activeRecognition === recognition) this.activeRecognition = null;
        callback();
      };

      recognition.onresult = (event) => {
        const resultAlternatives = Array.from({ length: event.results.length }, (_, index) => {
          const result = event.results[index];
          return Array.from({ length: result.length }, (_, alternativeIndex) => result[alternativeIndex])
            .map((alternative) => alternative.transcript.trim())
            .filter(Boolean)
            .slice(0, 10);
        }).filter((alternatives) => alternatives.length);
        const primaryResults = resultAlternatives.map((alternatives) => alternatives[0]);
        latestTranscript = primaryResults.join(' ');
        latestAlternatives = this.combineAlternatives(resultAlternatives);
        const finalIndex = Array.from({ length: event.results.length }, (_, index) => index)
          .filter((index) => event.results[index].isFinal)
          .at(-1);
        latestConfidence = finalIndex === undefined
          ? 0
          : event.results[finalIndex][0]?.confidence ?? 0;
        if (startupTimer) clearTimeout(startupTimer);
        if (silenceTimer) clearTimeout(silenceTimer);
        // Stop after a short silence so continuous recognition cannot remain active forever.
        silenceTimer = setTimeout(() => {
          try { recognition.stop(); } catch { /* The browser may already have ended the session. */ }
        }, 1800);
      };

      recognition.onerror = (event) => {
        finish(() => reject(new Error(this.recognitionErrorMessage(event.error))));
      };

      recognition.onend = () => {
        if (!latestTranscript) {
          finish(() => reject(new Error('Ucapan belum terdengar. Tekan mikrofon dan coba lagi.')));
          return;
        }
        finish(() => resolve({
          transcript: latestTranscript,
          confidence: latestConfidence,
          alternatives: latestAlternatives.length ? latestAlternatives : [latestTranscript],
        }));
      };

      try {
        recognition.start();
        startupTimer = setTimeout(() => {
          try { recognition.stop(); } catch { /* The hard timeout below will settle a stalled session. */ }
        }, 8000);
        watchdogTimer = setTimeout(() => {
          finish(() => reject(new Error('Waktu pengenalan habis. Periksa mikrofon dan koneksi, lalu coba lagi.')));
          try { recognition.abort(); } catch { /* The session may already be closed. */ }
        }, 15000);
      } catch {
        finish(() => reject(new Error('Mikrofon belum siap. Tunggu sebentar lalu coba lagi.')));
      }
    });
  }

  cancelRecognition(): void {
    this.activeRecognition?.abort();
    this.activeRecognition = null;
  }

  normalizeMandarin(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/[\s.,!?;:'"，。！？；：、]/g, '')
      .toLowerCase();
  }

  matchesMandarin(value: string, expected: string): boolean {
    const actual = this.normalizeMandarin(value);
    const target = this.normalizeMandarin(expected);
    if (!actual || !target) return false;
    if (actual === target) return true;

    // A one-character answer is too short for safe fuzzy matching.
    if (target.length < 2) return false;
    const distance = this.mandarinEditDistance(actual, target);
    const allowedDistance = target.length <= 3 ? 1 : Math.max(1, Math.floor(target.length * 0.25));
    return distance <= allowedDistance;
  }

  private combineAlternatives(resultAlternatives: string[][]): string[] {
    return resultAlternatives.reduce<string[]>(
      (combined, alternatives) => combined
        .flatMap((prefix) => alternatives.map((alternative) => `${prefix} ${alternative}`.trim()))
        .slice(0, 100),
      [''],
    ).filter(Boolean);
  }

  private mandarinEditDistance(value: string, target: string): number {
    const previous = Array.from({ length: target.length + 1 }, (_, index) => index);
    for (let row = 1; row <= value.length; row += 1) {
      const current = [row];
      for (let column = 1; column <= target.length; column += 1) {
        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + (value[row - 1] === target[column - 1] ? 0 : 1),
        );
      }
      for (let column = 0; column <= target.length; column += 1) previous[column] = current[column];
    }
    return previous[target.length];
  }

  private get recognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
    if (typeof window === 'undefined') return null;
    const browserWindow = window as typeof window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
  }

  private recognitionErrorMessage(error: string): string {
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      return 'Izin mikrofon ditolak. Izinkan mikrofon pada pengaturan browser.';
    }
    if (error === 'no-speech') return 'Ucapan belum terdengar. Coba bicara lebih dekat ke mikrofon.';
    if (error === 'audio-capture') return 'Mikrofon tidak ditemukan atau sedang dipakai aplikasi lain.';
    if (error === 'network') return 'Pengenalan suara membutuhkan koneksi internet.';
    return 'Ucapan belum dapat dikenali. Silakan coba lagi.';
  }
}
