import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore';
import { firestore } from '../../core/firebase/firebase';
import { AuthService } from '../../core/services/auth.service';
import { QuestionCategory } from '../../core/models/content.models';
import { hasStarAccount, readStarAccount } from '../../core/models/student-stars';
import { StudentApiService } from '../../core/services/student-api.service';
import { Flashcard, Question } from '../../core/models/content.models';
import { practiceReward } from '../../core/models/practice-reward';

export interface AccessoryItem {
  id: string;
  name: string;
  price: number;
  icon: string;
  owned: boolean;
  equipped: boolean;
  previewUrl?: string;
  previewPublicId?: string;
  accessoryUrl?: string;
  accessoryPublicId?: string;
  category?: string;
  layer?: string;
  sortOrder?: number;
}

type AccessoryCatalogItem = Omit<AccessoryItem, 'owned' | 'equipped'>;
type CategoryCounts = Record<QuestionCategory, number>;

export interface WeeklyPoint {
  label: string;
  dateLabel: string;
  points: number;
  height: number;
}

export interface StudentMonthlyReport {
  vocabulary: number;
  questions: number;
  earnedPoints: number;
  categories: { name: string; total: number }[];
}

export interface TestResultDetail {
  rewardId?: string;
  sessionId?: string;
  sessionOrder?: number;
  sessionOfDay?: number;
  sessionKind?: 'scheduled' | 'additional';
  unitId?: string;
  questionCount?: number;
  categoryCounts?: Partial<CategoryCounts>;
  anchorQuestionIds?: Partial<Record<QuestionCategory, string>>;
}

export interface PracticeAnswerEventInput {
  sessionId: string;
  sessionOrder: number;
  questionOrder: number;
  questionId: string;
  flashcardId: string;
  unitId: string;
  category: QuestionCategory;
  isAnchor: boolean;
  response: string;
  skipped: boolean;
  writingMistakes: number;
  writingStrokes: number;
  correct: boolean;
  basePoint: number;
  awardedPoint: number;
}

export interface PracticeSessionAllocation {
  plan: Array<{ card: Flashcard; question: Question; questionId: string; category: QuestionCategory }>;
  sessionId: string;
  sessionOrder: number;
  sessionOfDay: number;
  sessionKind: 'scheduled' | 'additional';
  anchorQuestionIds: Record<QuestionCategory, string>;
}

export type QuestionAttemptStatus = 'unseen' | 'wrong' | 'correct';

export interface StudentQuestionProgress {
  questionId: string;
  status: QuestionAttemptStatus;
  attempts: number;
  correctAttempts: number;
  rewardCorrectAttemptsR3?: number;
  wrongAttempts: number;
  lastAnsweredAtSeconds: number;
}

interface StudentActivityLog {
  id: string;
  studentId: string;
  type: 'learn_flashcard' | 'test_session';
  dateId: string;
  weekId: string;
  monthId: string;
  dayIndex: number;
  pointEarned: number;
  questionCount: number;
  categoryCounts: CategoryCounts;
  flashcardId?: string;
  unitId?: string;
  createdAtSeconds: number;
}

@Injectable({ providedIn: 'root' })
export class StudentLearningService {
  private readonly auth = inject(AuthService);
  private readonly api = inject(StudentApiService);
  private readonly catalog = signal<AccessoryCatalogItem[]>([]);
  private catalogLoaded = false;
  private readonly ownedAccessories = signal<Record<string, { owned: boolean; equipped: boolean }>>({});
  private accessoryCatalogUnsubscribe: (() => void) | null = null;
  private studentAccessoryUnsubscribe: (() => void) | null = null;
  private pointsUnsubscribe: (() => void) | null = null;
  private activeStudentId = '';
  private studentSession = 0;
  private lastLearnedAtSeconds = -1;
  private readonly loadedProgressCards = new Set<string>();
  private readonly loadedProgressQuestions = new Set<string>();
  private readonly progressRequests = new Map<string, Promise<void>>();
  private readonly progressMutations = new Map<string, number>();
  private readonly activityRequests = new Map<string, Promise<QuerySnapshot<DocumentData>>>();
  private readonly activityCache = new Map<string, StudentActivityLog[]>();
  private readonly localAccessoryCatalog: AccessoryCatalogItem[] = [
    { id: 'ribbon', name: 'Pita Merah', price: 0, icon: 'R' },
    { id: 'hat', name: 'Topi Panda', price: 350, icon: 'H' },
    { id: 'glasses', name: 'Kacamata Hitam', price: 180, icon: 'G' },
    { id: 'leaf', name: 'Daun', price: 120, icon: 'L' },
    { id: 'mask', name: 'Masker', price: 220, icon: 'M' },
    { id: 'crown', name: 'Mahkota', price: 400, icon: 'C' },
    { id: 'starclip', name: 'Jepit Bintang', price: 250, icon: 'S' },
  ];

  readonly learnedIds = signal<Set<string>>(new Set());
  readonly bulkLearnedIds = signal<Set<string>>(new Set());
  readonly questionProgress = signal<Record<string, StudentQuestionProgress>>({});
  readonly lastFlashcardId = signal<string | null>(null);
  readonly totalStarsEarned = signal(0);
  readonly starBalance = signal(0);
  readonly starSaving = signal(false);
  readonly starError = signal('');
  private starMigrationSession = -1;
  readonly pointsLoaded = signal(false);
  readonly completedQuestions = signal(0);
  readonly activityLogs = signal<StudentActivityLog[]>([]);
  readonly activityError = signal('');
  readonly currentYearId = signal(String(new Date().getFullYear()));
  readonly currentMonthId = signal(this.monthId(new Date()));
  readonly currentWeekId = signal(this.weekId(new Date()));
  readonly currentWeekStartId = signal(this.weekStartId(new Date()));
  readonly learnedCount = computed(() => this.learnedIds().size);
  readonly previewAccessoryId = signal<string | null>(null);
  readonly weeklyTrack = computed<WeeklyPoint[]>(() => this.weeklyTrackFor(this.currentWeekStartId()));
  readonly weeklyTotal = computed(() => this.weeklyTotalFor(this.currentWeekStartId()));
  readonly yearOptions = computed(() => {
    const currentYear = Number(this.currentYearId());
    const ids = new Set(this.activityLogs().map((log) => log.monthId.slice(0, 4)).filter(Boolean));
    for (let year = currentYear - 5; year <= currentYear + 5; year += 1) ids.add(String(year));
    return [...ids].sort().reverse().map((id) => ({ label: id, value: id }));
  });
  readonly monthOptions = computed(() => {
    const ids = new Set(this.activityLogs().map((log) => log.monthId));
    ids.add(this.currentMonthId());
    return [...ids].sort().reverse().map((id) => ({ label: this.monthLabel(id), value: id }));
  });
  readonly accessories = signal<AccessoryItem[]>([
    { id: 'ribbon', name: 'Pita Merah', price: 0, icon: 'R', owned: true, equipped: false },
    { id: 'hat', name: 'Topi Panda', price: 350, icon: 'H', owned: false, equipped: false },
    { id: 'glasses', name: 'Kacamata Bulat', price: 180, icon: 'G', owned: false, equipped: false },
    { id: 'star', name: 'Bintang Level', price: 250, icon: 'S', owned: false, equipped: false },
  ]);

  weeklyTrackFor(weekStartId: string): WeeklyPoint[] {
    const labels = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const dates = this.weekDatesFromStartId(weekStartId);
    const totals = labels.map((label, index) => ({
      dateId: this.dateId(dates[index]),
      dateLabel: `${dates[index].getDate()}/${dates[index].getMonth() + 1}`,
      label,
      points: 0,
      height: 0,
    }));
    this.activityLogs()
      .filter((log) => totals.some((day) => day.dateId === log.dateId))
      .forEach((log) => {
        const day = totals.find((item) => item.dateId === log.dateId);
        if (day) day.points += log.pointEarned;
      });
    const max = Math.max(...totals.map((day) => day.points), 1);
    return totals.map(({ dateId, ...day }) => ({ ...day, height: day.points ? Math.max(10, Math.round((day.points / max) * 100)) : 0 }));
  }

  weeklyTotalFor(weekStartId: string): number {
    return this.weeklyTrackFor(weekStartId).reduce((sum, day) => sum + day.points, 0);
  }

  weekOptionsForMonth(monthId: string): { label: string; value: string }[] {
    return this.calendarWeeksForMonth(monthId).map((week, index) => ({
      label: `Minggu ke-${index + 1}`,
      value: this.dateId(week),
    }));
  }

  monthOptionsForYear(yearId: string): { label: string; value: string }[] {
    return Array.from({ length: 12 }, (_, index) => {
      const monthId = `${yearId}-${this.pad(index + 1)}`;
      return { label: this.monthName(index), value: monthId };
    });
  }

  constructor() {
    this.watchAccessoryCatalog();
    effect(() => {
      const profile = this.auth.profile();
      // Also clear the root service on logout or when switching to a staff account.
      untracked(() => this.watchStudent(profile?.role === 'student' ? profile.uid : ''));
    });
  }

  async toggleLearned(id: string): Promise<void> {
    if (!this.isCurrentStudent()) return;
    const learned = !this.learnedIds().has(id);
    await this.saveLearned([id], learned, 'manual').catch(error => {
      this.starError.set(error instanceof Error ? error.message : 'Progres belum tersimpan.');
    });
  }

  async markAllLearned(ids: string[]): Promise<void> { await this.saveLearned(ids, true, 'bulk'); }
  async unmarkAllLearned(ids: string[]): Promise<void> { await this.saveLearned(ids, false, 'bulk'); }

  private async saveLearned(ids: string[], learned: boolean, source: 'manual' | 'bulk'): Promise<void> {
    if (!this.isCurrentStudent()) throw new Error('Akun murid berubah.');
    const studentId = this.activeStudentId, session = this.studentSession;
    const unique = [...new Set(ids.filter(Boolean))];
    for (let offset = 0; offset < unique.length; offset += 100) {
      const batch = unique.slice(offset, offset + 100);
      batch.forEach(id => this.markProgressMutation(`studentProgress:${id}`));
      const result = await this.api.post<{ changed: string[]; progress: Array<{ flashcardId: string; learned: boolean; learnedSource: string }> }>('progress', { ids: batch, learned, source });
      if (!this.isCurrentStudent(studentId) || session !== this.studentSession) throw new Error('Akun murid berubah.');
      this.learnedIds.update(current => {
        const next = new Set(current);
        result.progress.forEach(row => row.learned ? next.add(row.flashcardId) : next.delete(row.flashcardId));
        return next;
      });
      this.bulkLearnedIds.update(current => {
        const next = new Set(current);
        result.progress.forEach(row => row.learned && row.learnedSource === 'bulk' ? next.add(row.flashcardId) : next.delete(row.flashcardId));
        return next;
      });
      this.lastFlashcardId.set(result.changed.at(-1) ?? this.lastFlashcardId());
    }
    this.activityCache.clear();
    const today = new Date();
    await this.loadActivityRange(`${this.monthId(today)}-01`, this.dateId(today));
  }

  async addTestResult(_points: number, detail: TestResultDetail = {}): Promise<boolean> {
    if (!this.isCurrentStudent() || !this.pointsLoaded() || this.starSaving()) return false;
    const studentId = this.activeStudentId, session = this.studentSession;
    this.starSaving.set(true); this.starError.set('');
    try {
      if (!detail.sessionId) throw new Error('Sesi latihan tidak ditemukan.');
      await this.api.post('practice-finish', { sessionId: detail.sessionId });
      if (!this.isCurrentStudent(studentId) || session !== this.studentSession) return false;
      this.activityCache.clear();
      const now = new Date();
      await this.loadActivityRange(`${this.monthId(now)}-01`, this.dateId(now));
      return true;
    } catch (error) {
      if (this.isCurrentStudent(studentId) && session === this.studentSession) this.starError.set(error instanceof Error ? error.message : 'Bintang belum tersimpan.');
      return false;
    } finally { if (session === this.studentSession) this.starSaving.set(false); }
  }

  async beginPracticeSession(
    unitId: string, _grade: number, anchorQuestionIds: Record<QuestionCategory, string>, questionIds: string[], sessionId: string,
  ): Promise<PracticeSessionAllocation> {
    if (!this.isCurrentStudent() || !this.pointsLoaded() || this.starSaving()) throw new Error('Sesi latihan belum siap.');
    this.starSaving.set(true); this.starError.set('');
    try {
      return await this.api.post<PracticeSessionAllocation>('practice-start', { sessionId, unitId, anchorQuestionIds, questionIds });
    } catch (error) {
      this.starError.set(error instanceof Error ? error.message : 'Sesi belum dapat dimulai.');
      throw error;
    } finally { this.starSaving.set(false); }
  }

  previewPracticeReward(questionId: string, basePoint: number, correct: boolean): number {
    return practiceReward(basePoint, correct, this.questionProgress()[questionId]?.rewardCorrectAttemptsR3 ?? 0);
  }

  async recordPracticeAnswer(input: PracticeAnswerEventInput): Promise<{ awardedPoint: number; correct: boolean }> {
    const studentId = this.activeStudentId, session = this.studentSession;
    if (!this.isCurrentStudent(studentId)) throw new Error('Akun murid berubah.');
    this.markProgressMutation(`studentQuestionProgress:${input.questionId}`);
    const result = await this.api.post<{ awardedPoint: number; correct: boolean; progress: StudentQuestionProgress }>('practice-answer', {
      sessionId: input.sessionId, questionOrder: input.questionOrder, response: input.response, skipped: input.skipped,
      writingMistakes: input.writingMistakes, writingStrokes: input.writingStrokes,
    });
    if (!this.isCurrentStudent(studentId) || session !== this.studentSession) throw new Error('Akun murid berubah.');
    this.markProgressMutation(`studentQuestionProgress:${input.questionId}`);
    this.questionProgress.update(current => ({ ...current, [input.questionId]: result.progress }));
    return result;
  }

  async abandonPracticeSession(sessionId: string): Promise<void> {
    if (sessionId && this.isCurrentStudent()) await this.api.post('practice-abandon', { sessionId });
  }

  questionWeight(questionId: string): number {
    const status = this.questionProgress()[questionId]?.status ?? 'unseen';
    return status === 'correct' ? 1 : status === 'wrong' ? 2 : 3;
  }

  /** Read progress only for flashcards the student opened. Document IDs are deterministic. */
  async loadProgressForCards(flashcardIds: string[]): Promise<void> {
    await this.loadScopedProgress(flashcardIds, this.loadedProgressCards, 'studentProgress', 'flashcardId', rows => {
      const learned = new Set(this.learnedIds());
      const bulkLearned = new Set(this.bulkLearnedIds());
      let latestId = this.lastFlashcardId();
      let latestTime = this.lastLearnedAtSeconds;
      rows.forEach((data, id) => {
        if (data['learned'] !== true) return;
        learned.add(id);
        if (data['learnedSource'] === 'bulk') bulkLearned.add(id);
        else bulkLearned.delete(id);
        const seconds = typeof data['updatedAt']?.seconds === 'number' ? data['updatedAt'].seconds : 0;
        if (seconds > latestTime) { latestId = id; latestTime = seconds; }
      });
      this.learnedIds.set(learned);
      this.bulkLearnedIds.set(bulkLearned);
      this.lastLearnedAtSeconds = latestTime;
      if (latestId) this.lastFlashcardId.set(latestId);
    });
  }

  /** Load question history only for questions in the practice session. */
  async loadQuestionProgress(questionIds: string[]): Promise<void> {
    await this.loadScopedProgress(questionIds, this.loadedProgressQuestions, 'studentQuestionProgress', 'questionId', rows => {
      const progress = { ...this.questionProgress() };
      rows.forEach((data, id) => {
        const status = data['status'] === 'correct' || data['status'] === 'wrong' ? data['status'] : 'unseen';
        progress[id] = { questionId: id, status, attempts: this.numberValue(data['attempts']),
          correctAttempts: this.numberValue(data['correctAttempts']), wrongAttempts: this.numberValue(data['wrongAttempts']),
          rewardCorrectAttemptsR3: Math.floor(this.numberValue(data['rewardCorrectAttemptsR3'])),
          lastAnsweredAtSeconds: this.timestampSeconds(data['lastAnsweredAt']) ?? this.numberValue(data['lastAnsweredAtSeconds']) };
      });
      this.questionProgress.set(progress);
    });
  }

  private markProgressMutation(key: string): void {
    this.progressMutations.set(key, (this.progressMutations.get(key) ?? 0) + 1);
  }

  private async loadScopedProgress(
    requested: string[], loaded: Set<string>, name: string, field: string,
    apply: (rows: Map<string, DocumentData>) => void,
  ): Promise<void> {
    const studentId = this.activeStudentId;
    if (!this.isCurrentStudent(studentId)) return;
    const session = this.studentSession;
    const key = (id: string) => `${session}:${name}:${id}`;
    const ids = [...new Set(requested)].filter(id => id && !loaded.has(id));
    const missing = ids.filter(id => !this.progressRequests.has(key(id)));
    for (let offset = 0; offset < missing.length; offset += 30) {
      const batch = missing.slice(offset, offset + 30);
      const mutations = new Map(batch.map(id => [id, this.progressMutations.get(`${name}:${id}`) ?? 0]));
      const request = Promise.resolve().then(() => {
        if (session !== this.studentSession || !this.isCurrentStudent(studentId)) return null;
        return getDocs(query(collection(firestore, name), where('studentId', '==', studentId), where(field, 'in', batch)));
      }).then(snapshot => {
        if (!snapshot || session !== this.studentSession || !this.isCurrentStudent(studentId)) return;
        const rows = new Map<string, DocumentData>();
        snapshot.docs.forEach(item => {
          const data = item.data(), id = data[field];
          if (typeof id === 'string' && batch.includes(id) && mutations.get(id) === (this.progressMutations.get(`${name}:${id}`) ?? 0)) rows.set(id, data);
        });
        apply(rows);
        batch.forEach(id => loaded.add(id));
      }).finally(() => batch.forEach(id => { if (this.progressRequests.get(key(id)) === request) this.progressRequests.delete(key(id)); }));
      batch.forEach(id => this.progressRequests.set(key(id), request));
    }
    await Promise.all(ids.map(id => this.progressRequests.get(key(id))));
  }

  /** Read only the selected date range, partitioned by month for simple equality queries. */
  async loadActivityRange(startDateId: string, endDateId: string): Promise<void> {
    const studentId = this.activeStudentId;
    if (!this.isCurrentStudent(studentId) || startDateId > endDateId) return;
    const session = this.studentSession;
    const start = this.parseDateId(startDateId);
    const end = this.parseDateId(endDateId);
    if (!start || !end) return;
    const months: string[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= last) { months.push(this.monthId(cursor)); cursor.setMonth(cursor.getMonth() + 1); }
    const missing = months.filter(month => !this.activityCache.has(`${studentId}:${month}`));
    let snapshots: QuerySnapshot<DocumentData>[] = [];
    try {
      snapshots = await Promise.all(missing.map(month => {
        const key = `${session}:${studentId}:${month}`;
        let request = this.activityRequests.get(key);
        if (!request) {
          request = getDocs(query(collection(firestore, 'studentActivityLogs'),
            where('studentId', '==', studentId), where('monthId', '==', month)))
            .finally(() => this.activityRequests.delete(key));
          this.activityRequests.set(key, request);
        }
        return request;
      }));
      this.activityError.set('');
    } catch {
      if (session === this.studentSession) this.activityError.set('Riwayat periode ini belum dapat dimuat. Coba lagi nanti.');
      return;
    }
    if (session !== this.studentSession || !this.isCurrentStudent(studentId)) return;
    snapshots.forEach((snapshot, index) => {
      const month = missing[index];
      const logs = snapshot.docs.map(item => this.mapActivityLog(item.id, item.data())).filter((log): log is StudentActivityLog => !!log);
      this.activityCache.set(`${studentId}:${month}`, logs);
    });
    const merged = new Map([...this.activityCache.values()].flat().map(log => [log.id, log]));
    this.activityLogs.set([...merged.values()].sort((a, b) => b.createdAtSeconds - a.createdAtSeconds));
  }

  async buyOrEquip(id: string): Promise<void> {
    if (!this.isCurrentStudent() || !this.pointsLoaded() || this.starSaving()) return;
    const item = this.accessories().find(item => item.id === id);
    if (!item) return;
    const studentId = this.activeStudentId, session = this.studentSession;
    this.clearAccessoryPreview(); this.starSaving.set(true); this.starError.set('');
    try {
      await this.api.post('accessory', { accessoryId: id, equipped: !item.equipped });
    } catch (error) {
      if (this.isCurrentStudent(studentId) && session === this.studentSession) this.starError.set(error instanceof Error ? error.message : 'Pembelian belum tersimpan.');
    } finally { if (session === this.studentSession) this.starSaving.set(false); }
  }

  previewAccessory(id: string): void {
    this.previewAccessoryId.update((current) => current === id ? null : id);
  }

  clearAccessoryPreview(): void {
    this.previewAccessoryId.set(null);
  }

  private watchStudent(studentId: string): void {
    if (this.activeStudentId === studentId) return;
    this.activeStudentId = studentId;
    const session = ++this.studentSession;
    this.pointsUnsubscribe?.();
    this.studentAccessoryUnsubscribe?.();
    this.totalStarsEarned.set(0);
    this.starBalance.set(0);
    this.starSaving.set(false);
    this.starError.set('');
    this.pointsLoaded.set(false);
    this.completedQuestions.set(0);
    this.learnedIds.set(new Set());
    this.bulkLearnedIds.set(new Set());
    this.lastFlashcardId.set(null);
    this.lastLearnedAtSeconds = -1;
    this.questionProgress.set({});
    this.activityLogs.set([]);
    this.activityError.set('');
    this.loadedProgressCards.clear();
    this.loadedProgressQuestions.clear();
    this.progressRequests.clear();
    this.progressMutations.clear();
    this.activityRequests.clear();
    this.activityCache.clear();
    this.ownedAccessories.set({});
    this.clearAccessoryPreview();
    this.syncAccessories();
    if (!studentId) return;
    const isCurrentSession = () => this.studentSession === session && this.isCurrentStudent(studentId);

    this.pointsUnsubscribe = onSnapshot(doc(firestore, 'studentPoints', studentId), { includeMetadataChanges: true },
      (snapshot) => {
        if (!isCurrentSession()) return;
        const data = snapshot.data();
        const account = readStarAccount(data);
        this.totalStarsEarned.set(account.totalStarsEarned);
        this.starBalance.set(account.starBalance);
        if (!hasStarAccount(data)) this.pointsLoaded.set(false);
        // A missing cached document is not proof that this account has a zero balance.
        // Preserve readiness for local writes only after this session has received server data.
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
          if (hasStarAccount(data)) {
            this.pointsLoaded.set(true);
            this.starError.set('');
          }
          else if (this.starMigrationSession !== session) {
            this.starMigrationSession = session;
            void this.migrateLegacyStars(studentId, session);
          }
        }
      },
      (error) => {
        if (!isCurrentSession()) return;
        this.pointsLoaded.set(false);
        this.starError.set('Star belum dapat dimuat. Periksa koneksi dan muat ulang halaman.');
        console.error('Gagal membaca poin murid:', error);
      },
    );

    this.studentAccessoryUnsubscribe = onSnapshot(
      query(collection(firestore, 'studentAccessories'), where('studentId', '==', studentId)),
      (snapshot) => {
        if (!isCurrentSession()) return;
        const owned: Record<string, { owned: boolean; equipped: boolean }> = {};
        snapshot.docs.forEach((item) => {
          const data = item.data();
          const accessoryId = typeof data['accessoryId'] === 'string' ? data['accessoryId'] : '';
          if (!accessoryId) return;
          owned[accessoryId] = {
            equipped: data['equipped'] === true,
            owned: data['owned'] === true,
          };
        });
        this.ownedAccessories.set(owned);
        this.syncAccessories();
      },
    );

    const today = new Date();
    void this.loadActivityRange(`${this.monthId(today)}-01`, this.dateId(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  }

  private async migrateLegacyStars(studentId: string, session: number): Promise<void> {
    try { await this.api.post('initialize'); }
    catch (error) {
      if (this.isCurrentStudent(studentId) && session === this.studentSession) {
        this.pointsLoaded.set(false);
        this.starError.set(error instanceof Error ? error.message : 'Data bintang belum dapat disiapkan.');
      }
    }
  }

  private isCurrentStudent(studentId = this.activeStudentId): boolean {
    const profile = this.auth.profile();
    return !!studentId && this.activeStudentId === studentId && profile?.role === 'student' && profile.uid === studentId;
  }

  private watchAccessoryCatalog(): void {
    this.accessoryCatalogUnsubscribe?.();
    this.accessoryCatalogUnsubscribe = onSnapshot(collection(firestore, 'accessories'), (snapshot) => {
      const remoteItems = snapshot.docs
        .map<AccessoryCatalogItem | null>((item) => {
          const data = item.data();
          if (data['active'] === false || data['deleted'] === true) return null;
          const name = typeof data['name'] === 'string' ? data['name'] : item.id;
          return {
            id: item.id,
            icon: typeof data['icon'] === 'string' ? data['icon'] : name.charAt(0).toUpperCase(),
            name,
            price: typeof data['price'] === 'number' ? data['price'] : 0,
            previewUrl: typeof data['previewUrl'] === 'string' ? data['previewUrl'] : undefined,
            previewPublicId: typeof data['previewPublicId'] === 'string' ? data['previewPublicId'] : undefined,
            accessoryUrl: typeof data['accessoryUrl'] === 'string' ? data['accessoryUrl'] : undefined,
            accessoryPublicId: typeof data['accessoryPublicId'] === 'string' ? data['accessoryPublicId'] : undefined,
            category: typeof data['category'] === 'string' ? data['category'] : undefined,
            layer: typeof data['layer'] === 'string' ? data['layer'] : undefined,
            sortOrder: typeof data['sortOrder'] === 'number' ? data['sortOrder'] : 0,
          };
        })
        .filter((item): item is AccessoryCatalogItem => item !== null)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.price - b.price || a.name.localeCompare(b.name));
      const remoteIds = new Set(snapshot.docs.map((item) => item.id));
      const items = [
        ...remoteItems,
        ...this.localAccessoryCatalog.filter((item) => {
          if (remoteIds.has(item.id)) return false;
          if (item.id === 'starclip' && remoteIds.has('star')) return false;
          if (item.id === 'star' && remoteIds.has('starclip')) return false;
          return true;
        }),
      ].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.price - b.price || a.name.localeCompare(b.name));
      this.catalogLoaded = true;
      this.catalog.set(items);
      this.syncAccessories();
    });
  }

  private syncAccessories(): void {
    const owned = this.ownedAccessories();
    const source = this.catalogLoaded
      ? this.catalog()
      : this.accessories().map(({ id, icon, name, price }) => ({ id, icon, name, price }));
    const equippedId = source.find((item) => owned[item.id]?.equipped)?.id;
    this.accessories.set(
      source.map((item) => ({
        ...item,
        equipped: item.id === equippedId,
        owned: owned[item.id]?.owned ?? item.price === 0,
      })),
    );
  }

  monthlyReport(monthId = this.currentMonthId()): StudentMonthlyReport {
    const [year, month] = monthId.split('-').map(Number);
    const startDateId = `${year}-${this.pad(month)}-01`;
    const endDate = new Date(year, month, 0);
    const endDateId = this.dateId(endDate);
    return this.dateRangeReport(startDateId, endDateId);
  }

  dateRangeReport(startDateId: string, endDateId: string): StudentMonthlyReport {
    if (!this.parseDateId(startDateId) || !this.parseDateId(endDateId) || startDateId > endDateId) {
      return this.emptyReport();
    }

    const logs = this.activityLogs().filter((log) => log.dateId >= startDateId && log.dateId <= endDateId);
    return this.reportFromLogs(logs);
  }

  private reportFromLogs(logs: StudentActivityLog[]): StudentMonthlyReport {
    const learned = new Set(logs.filter((log) => log.type === 'learn_flashcard' && log.flashcardId).map((log) => log.flashcardId));
    const categoryTotals = this.emptyCategoryCounts();
    let questions = 0;
    let earnedPoints = 0;

    logs.forEach((log) => {
      questions += log.questionCount;
      earnedPoints += log.pointEarned;
      (Object.keys(categoryTotals) as QuestionCategory[]).forEach((category) => {
        categoryTotals[category] += log.categoryCounts[category] ?? 0;
      });
    });

    return {
      vocabulary: learned.size,
      questions,
      earnedPoints,
      categories: (Object.keys(categoryTotals) as QuestionCategory[]).map((category) => ({
        name: this.categoryLabel(category),
        total: categoryTotals[category],
      })),
    };
  }

  private timestampSeconds(value: unknown): number | undefined {
    if (typeof value === 'object' && value !== null && 'seconds' in value) {
      const seconds = (value as { seconds?: unknown }).seconds;
      return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : undefined;
    }
    return undefined;
  }

  private numberValue(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private emptyReport(): StudentMonthlyReport {
    return {
      vocabulary: 0,
      questions: 0,
      earnedPoints: 0,
      categories: (Object.keys(this.emptyCategoryCounts()) as QuestionCategory[]).map((category) => ({
        name: this.categoryLabel(category),
        total: 0,
      })),
    };
  }

  monthLabel(monthId: string): string {
    const [year, month] = monthId.split('-').map(Number);
    return `${this.monthName((month || 1) - 1)} ${year || ''}`.trim();
  }

  weekLabel(weekId: string): string {
    const [year, week] = weekId.split('-W');
    return `Minggu ${Number(week || 0)} (${year})`;
  }



  private mapActivityLog(id: string, data: Record<string, unknown>): StudentActivityLog | null {
    const studentId = typeof data['studentId'] === 'string' ? data['studentId'] : '';
    const type = data['type'] === 'learn_flashcard' || data['type'] === 'test_session' ? data['type'] : null;
    const createdAt = data['createdAt'] as { seconds?: unknown } | undefined;
    const createdAtSeconds = typeof createdAt?.seconds === 'number' ? createdAt.seconds : 0;
    const logDate = this.resolveLogDate(id, data, createdAtSeconds);
    if (!studentId || !type) return null;
    if (!logDate) return null;
    return {
      id,
      categoryCounts: this.normalizeCategoryCounts(data['categoryCounts'] as Partial<CategoryCounts> | undefined),
      createdAtSeconds,
      dateId: typeof data['dateId'] === 'string' ? data['dateId'] : this.dateId(logDate),
      dayIndex: typeof data['dayIndex'] === 'number' ? data['dayIndex'] : this.dayIndex(logDate),
      flashcardId: typeof data['flashcardId'] === 'string' ? data['flashcardId'] : undefined,
      monthId: typeof data['monthId'] === 'string' ? data['monthId'] : this.monthId(logDate),
      pointEarned: typeof data['pointEarned'] === 'number' ? data['pointEarned'] : 0,
      questionCount: typeof data['questionCount'] === 'number' ? data['questionCount'] : 0,
      studentId,
      type,
      unitId: typeof data['unitId'] === 'string' ? data['unitId'] : undefined,
      weekId: typeof data['weekId'] === 'string' ? data['weekId'] : this.weekId(logDate),
    };
  }

  private resolveLogDate(id: string, data: Record<string, unknown>, createdAtSeconds: number): Date | null {
    if (typeof data['dateId'] === 'string') {
      const date = this.parseDateId(data['dateId']);
      if (date) return date;
    }
    const idDate = id.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (idDate) {
      const date = this.parseDateId(idDate);
      if (date) return date;
    }
    return createdAtSeconds ? new Date(createdAtSeconds * 1000) : null;
  }

  private normalizeCategoryCounts(source?: Partial<CategoryCounts>): CategoryCounts {
    return {
      writing: Number(source?.writing ?? 0),
      listening: Number(source?.listening ?? 0),
      speaking: Number(source?.speaking ?? 0),
      reading: Number(source?.reading ?? 0),
    };
  }

  private emptyCategoryCounts(): CategoryCounts {
    return { writing: 0, listening: 0, speaking: 0, reading: 0 };
  }

  private categoryLabel(category: QuestionCategory): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  private dateId(date: Date): string {
    return `${date.getFullYear()}-${this.pad(date.getMonth() + 1)}-${this.pad(date.getDate())}`;
  }

  private monthId(date: Date): string {
    return `${date.getFullYear()}-${this.pad(date.getMonth() + 1)}`;
  }

  private weekId(date: Date): string {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${target.getUTCFullYear()}-W${this.pad(week)}`;
  }

  private weekStartId(date: Date): string {
    return this.dateId(this.startOfWeek(date));
  }

  private calendarWeeksForMonth(monthId: string): Date[] {
    const [year, month] = monthId.split('-').map(Number);
    const safeYear = year || new Date().getFullYear();
    const safeMonth = month || 1;
    const monthIndex = safeMonth - 1;
    const firstDay = new Date(safeYear, monthIndex, 1);
    const lastDay = new Date(safeYear, monthIndex + 1, 0);
    const weeks: Date[] = [];
    let cursor = this.startOfWeek(firstDay);

    while (cursor <= lastDay) {
      weeks.push(new Date(cursor));
      cursor = this.addDays(cursor, 7);
    }

    return weeks;
  }

  private weekDatesFromStartId(weekStartId: string): Date[] {
    const start = this.parseDateId(weekStartId) ?? this.startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, index) => this.addDays(start, index));
  }

  private startOfWeek(date: Date): Date {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - this.dayIndex(start));
    return start;
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private parseDateId(dateId: string): Date | null {
    const [year, month, day] = dateId.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  private dayIndex(date: Date): number {
    return (date.getDay() + 6) % 7;
  }

  private monthName(index: number): string {
    return ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][index] ?? 'Januari';
  }

  private pad(value: number): string {
    return String(value).padStart(2, '0');
  }
}
