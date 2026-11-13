import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { firestore } from '../../core/firebase/firebase';
import { AuthService } from '../../core/services/auth.service';
import { ContentDataService } from '../../core/services/content-data.service';
import { posttestVocabulary } from '../../core/content/posttest-curriculum';
import { buildPosttestPlan, POSTTEST_VERSION, PosttestAnswer, PosttestItem, PosttestSession, posttestSummary } from '../../core/content/posttest-plan';
import { StudentApiService } from '../../core/services/student-api.service';
import { StudentLearningService } from './student-learning.service';

@Injectable({ providedIn: 'root' })
export class StudentPosttestService {
  private readonly auth = inject(AuthService);
  private readonly api = inject(StudentApiService);
  private readonly data = inject(ContentDataService);
  private readonly learning = inject(StudentLearningService);
  private unsubscribe: (() => void) | null = null;
  private accountGeneration = 0;
  readonly grade = computed(() => this.auth.profile()?.role === 'student' ? Number(this.auth.profile()?.grade ?? 0) : 0);
  readonly vocabulary = computed(() => posttestVocabulary(this.grade(), this.data.units(), this.data.flashcards(), new Set()));
  readonly studyCards = computed(() => this.vocabulary().flatMap((row) => row.cards.slice(0, 1)));
  readonly missing = computed(() => this.vocabulary().filter((row) => !row.cards.length));
  readonly learned = computed(() => this.vocabulary().filter(row => row.cards.some(card => this.learning.learnedIds().has(card.id))).length);
  readonly plan = computed(() => buildPosttestPlan(this.grade(), this.vocabulary()));
  readonly ready = computed(() => this.plan().length > 0);
  readonly loaded = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly session = signal<PosttestSession | null>(null);
  readonly summary = computed(() => posttestSummary(this.session()?.answers ?? [], this.session()?.plan ?? this.plan()));

  constructor() {
    effect((onCleanup) => {
      this.accountGeneration++;
      const profile = this.auth.profile();
      const grade = this.grade();
      this.unsubscribe?.();
      this.session.set(null);
      this.loaded.set(false);
      this.error.set('');
      if (!profile || !grade) return;
      // The persisted id field keeps this an ownership-scoped query even when the session
      // does not exist. A documentId equality can be evaluated as a missing-document get.
      const source = query(collection(firestore, 'testSessions'), where('studentId', '==', profile.uid),
        where('id', '==', this.sessionId(profile.uid, grade)));
      this.unsubscribe = onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
        if (this.auth.profile()?.uid !== profile.uid || this.grade() !== grade) return;
        // Do not start over from an empty local cache or accept uncommitted answers.
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        const entry = snapshot.docs.find((item) => item.id === this.sessionId(profile.uid, grade));
        const value = entry?.data();
        if (value?.['mode'] === 'posttest' && value['version'] === POSTTEST_VERSION && Array.isArray(value['plan']) && value['plan'].length > 0) {
          this.session.set({ id: entry!.id, grade, version: POSTTEST_VERSION, plan: value['plan'], answers: value['answers'] ?? [], status: value['status'] });
        } else {
          this.session.set(null);
        }
        this.loaded.set(true);
      }, () => {
        this.error.set('Riwayat posttest belum dapat dimuat. Periksa koneksi lalu muat ulang halaman.');
        this.loaded.set(false);
      });
      onCleanup(() => this.unsubscribe?.());
    });
  }

  async begin(plan: PosttestItem[]): Promise<PosttestSession> {
    if (!this.ready() || !this.loaded()) throw new Error('Materi posttest belum lengkap atau riwayat belum selesai dimuat.');
    const profile = this.auth.profile();
    if (!profile || profile.role !== 'student' || !plan.length) throw new Error('Belum ada soal posttest dengan flashcard yang tersedia.');
    return this.persist('posttest-start', {});
  }

  async saveAnswer(answer: PosttestAnswer): Promise<void> {
    const profile = this.auth.profile(), session = this.session();
    if (!profile || profile.role !== 'student' || !session || session.id !== this.sessionId(profile.uid, this.grade())) {
      throw new Error('Akun murid berubah. Muat ulang posttest.');
    }
    await this.persist('posttest-answer', {
      questionId: answer.questionId, response: answer.response, skipped: answer.skipped,
      writingMistakes: answer.writingMistakes, writingStrokes: answer.writingTotalStrokes ?? answer.writingStrokes ?? 0,
    });
  }

  private async persist(action: string, payload: unknown): Promise<PosttestSession> {
    const uid = this.auth.profile()?.uid;
    const generation = this.accountGeneration;
    this.saving.set(true); this.error.set('');
    try {
      const session = await this.api.post<PosttestSession>(action, payload);
      if (uid !== this.auth.profile()?.uid || generation !== this.accountGeneration) throw new Error('Akun berubah. Muat ulang halaman.');
      if (this.session()?.id !== session.id || (this.session()?.answers.length ?? 0) <= session.answers.length) this.session.set(session);
      return session;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Jawaban belum tersimpan. Coba lagi.');
      throw error;
    } finally { this.saving.set(false); }
  }

  private sessionId(studentId: string, grade: number): string {
    return `posttest-v${POSTTEST_VERSION}-${studentId}-g${grade}`;
  }
}
