import { Injectable, OnDestroy, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDocsFromServer as getDocs,
  getDocFromServer,
  increment,
  limit,
  orderBy,
  onSnapshot,
  or,
  query,
  serverTimestamp,
  setDoc,
  type WriteBatch,
  where,
  writeBatch,
} from 'firebase/firestore';
import { firestore } from '../firebase/firebase';
import { AppUser, Flashcard, LearningUnit, Question, QuestionCategory, QuestionPointRule, UserRole } from '../models/content.models';
import { AuthService } from './auth.service';
import { ContentReadCache } from './content-read-cache';
import { pretestListeningQuestion } from '../content/listening-question';

@Injectable({ providedIn: 'root' })
export class ContentDataService implements OnDestroy {
  private contentScope = '';
  private destroyed = false;
  private contentSession = 0;
  private readonly contentCache = new ContentReadCache(
    `formosa-content-v2-${firestore.app.options.projectId ?? 'default'}`,
    async () => {
      const snapshot = await getDocFromServer(doc(firestore, 'contentMetadata', 'catalog'));
      return String(snapshot.data()?.['revision'] ?? 0);
    },
  );
  private readonly auth = inject(AuthService);
  private readonly unsubscribers: Array<() => void> = [];
  private usersUnsubscribe: (() => void) | null = null;
  private activeUserScope = '';
  private basicsRequest: { session: number; promise: Promise<void> } | null = null;
  readonly contentLoading = signal(false);
  readonly contentLoaded = signal(false);
  readonly contentError = signal('');
  readonly totals = signal<{ flashcards: number; questions: number } | null>(null);
  readonly dashboardCounts = signal<Record<string, { flashcards: number; questions: number }>>({});
  readonly contentYears = signal<Array<{ label: string; value: string }>>([{ label: String(new Date().getFullYear()), value: String(new Date().getFullYear()) }]);
  readonly production = signal<Record<string, { flashcards: number; questions: number }>>({});

  readonly currentUserId = signal('');
  readonly users = signal<AppUser[]>([]);
  readonly units = signal<LearningUnit[]>([]);
  readonly flashcards = signal<Flashcard[]>([]);
  readonly loadedUnits = signal<Set<string>>(new Set());
  private readonly sourceQuestions = signal<Question[]>([]);
  readonly questions = computed(() => {
    const cards = new Map(this.flashcards().map((card) => [card.id, card]));
    const grades = new Map(this.units().map((unit) => [unit.id, unit.grade]));
    return this.sourceQuestions().map((question) => {
      const card = cards.get(question.flashcardId);
      return card ? pretestListeningQuestion(question, card, grades.get(card.unitId)) : question;
    });
  });
  readonly questionPointRules = signal<QuestionPointRule[]>([]);

  readonly teachers = computed(() => this.teacherRoster());
  readonly students = computed(() => this.users().filter((user) => user.role === 'student' && !user.hiddenFromRoster));

  constructor() {
    effect(() => {
      const profile = this.auth.profile();
      queueMicrotask(() => {
        if (this.destroyed || this.auth.profile() !== profile) return;
        this.watchContentForProfile(profile);
        this.watchUsersForProfile(profile);
        this.currentUserId.set(profile?.uid ?? '');
      });
    });
  }

  private watchContentForProfile(profile: ReturnType<AuthService['profile']>): void {
    const scope = profile ? `${profile.uid}:${profile.role}` : '';
    if (scope === this.contentScope) return;
    this.contentScope = scope;
    this.contentSession++;
    this.basicsRequest = null;
    this.contentLoading.set(false);
    this.contentLoaded.set(false);
    this.contentError.set('');
    this.unsubscribers.splice(0).forEach((stop) => stop());
    this.units.set([]);
    this.flashcards.set([]);
    this.loadedUnits.set(new Set());
    this.sourceQuestions.set([]);
    this.questionPointRules.set([]);
    if (!profile) return;
    void this.loadBasics().catch(error => console.error('Gagal memuat data dasar:', error));
  }

  /** Load small shared lookup tables, reusing content while its revision is unchanged. */
  async loadBasics(): Promise<void> {
    const profile = this.auth.profile();
    if (!profile) return;
    const session = this.contentSession;
    if (this.basicsRequest?.session === session) return this.basicsRequest.promise;
    this.contentLoading.set(true);
    this.contentError.set('');
    const promise = (async () => {
      try {
        const [units, questionRules] = await Promise.all([
          this.readCachedCollection('units', collection(firestore, 'units'), (id, data) => this.mapUnit(id, data), (a, b) => a.grade - b.grade || a.name.localeCompare(b.name)),
          this.readCachedCollection('questionPointRules', collection(firestore, 'questionPointRules'), (id, data) => this.mapQuestionPointRule(id, data)),
        ]);
        if (session !== this.contentSession || this.auth.profile()?.uid !== profile.uid) return;
        this.units.set(units);
        this.questionPointRules.set(questionRules);
        this.contentLoaded.set(true);
      } catch (error) {
        if (session === this.contentSession && this.auth.profile()?.uid === profile.uid) {
          this.contentLoaded.set(false);
          this.contentError.set('Materi belum dapat dimuat. Coba lagi atau hubungi pengelola jika masalah berlanjut.');
        }
        throw error;
      } finally {
        if (session === this.contentSession) {
          this.contentLoading.set(false);
          this.basicsRequest = null;
        }
      }
    })();
    this.basicsRequest = { session, promise };
    return promise;
  }

  /** Fetch one unit's cards; persist them until the catalog revision changes. */
  async loadUnitCards(unitId: string): Promise<void> {
    if (!unitId || !this.auth.profile()) return;
    const session = this.contentSession;
    const applyCards = (cards: Flashcard[]) => {
      if (session === this.contentSession) this.flashcards.update(current => [...current.filter(card => card.unitId !== unitId), ...cards]);
    };
    const cards = await this.contentCache.read(`cards:${unitId}`, async () => {
      const snapshot = await getDocs(query(collection(firestore, 'flashcards'),
        or(where('unitId', '==', unitId), where('unitID', '==', unitId))));
      const rows = new Map<string, Flashcard>();
      snapshot.docs.forEach((item) => {
        const value = this.mapFlashcard(item.id, item.data());
        if (value) rows.set(value.id, value);
      });
      return [...rows.values()].sort((a, b) => a.meaning.localeCompare(b.meaning));
    });
    if (session !== this.contentSession) return;
    applyCards(cards);
    this.loadedUnits.update(current => new Set([...current, unitId]));
  }

  /** Used only on the explicit content-management pages, not on staff dashboards. */
  async loadAllFlashcards(): Promise<void> {
    if (!this.auth.profile()) return;
    const session = this.contentSession;
    const cards = await this.readCachedCollection('all-flashcards', collection(firestore, 'flashcards'), (id, data) => this.mapFlashcard(id, data), (a, b) => a.meaning.localeCompare(b.meaning));
    if (session === this.contentSession) {
      this.flashcards.set(cards);
      this.loadedUnits.set(new Set(this.units().map(unit => unit.id)));
    }
  }

  /** Used only when a staff member opens question management. */
  async loadAllQuestions(): Promise<void> {
    if (!this.auth.profile() || this.auth.profile()?.role === 'student') return;
    const session = this.contentSession;
    const questions = await this.readCachedCollection('all-questions', collection(firestore, 'questions'), (id, data) => this.mapQuestion(id, data), (a, b) => a.category.localeCompare(b.category));
    if (session === this.contentSession) this.sourceQuestions.set(questions);
  }

  async loadDashboardCounts(ownerId?: string): Promise<{ flashcards: number; questions: number }> {
    const key = `dashboard-counts:${ownerId ?? 'all'}`;
    const applyCounts = (values: { flashcards: number; questions: number }) => {
      const ownerKey = ownerId ?? 'all';
      this.dashboardCounts.update(current => ({ ...current, [ownerKey]: values }));
      if (!ownerId) this.totals.set(values);
    };
    const values = await this.contentCache.read(key, async () => {
      const filters = ownerId ? [where('createdBy', '==', ownerId)] : [];
      const [flashcards, inactiveFlashcards, questions, inactiveQuestions] = await Promise.all([
        getCountFromServer(query(collection(firestore, 'flashcards'), ...filters)),
        getCountFromServer(query(collection(firestore, 'flashcards'), ...filters, where('active', '==', false))),
        getCountFromServer(query(collection(firestore, 'questions'), ...filters)),
        getCountFromServer(query(collection(firestore, 'questions'), ...filters, where('active', '==', false))),
      ]);
      return { flashcards: flashcards.data().count - inactiveFlashcards.data().count, questions: questions.data().count - inactiveQuestions.data().count };
    });
    applyCounts(values);
    return values;
  }

  async loadContentYears(): Promise<void> {
    const years = await this.contentCache.read(`content-years:${new Date().getFullYear()}`, async () => {
      const first = await Promise.all(['flashcards', 'questions'].flatMap(name => ['createdAt', 'updatedAt'].map(field =>
        getDocs(query(collection(firestore, name), orderBy(field), limit(1))).then(snapshot => snapshot.docs[0]?.data()[field]))));
      const values = first.map(value => this.timestampSeconds(value)).filter((value): value is number => value !== undefined)
        .map(seconds => new Date(seconds * 1000).getFullYear());
      return Array.from({ length: Math.max(1, new Date().getFullYear() - Math.min(new Date().getFullYear(), ...values) + 1) }, (_, index) => {
        const year = String(new Date().getFullYear() - index);
        return { label: year, value: year };
      });
    });
    this.contentYears.set(years);
  }

  private async readCachedCollection<T>(
    key: string,
    source: ReturnType<typeof collection>,
    mapper: (id: string, data: Record<string, unknown>) => T | null,
    sorter?: (a: T, b: T) => number,
  ): Promise<T[]> {
    return this.contentCache.read(key, async () => {
      const snapshot = await getDocs(source);
      const values = snapshot.docs.map(item => mapper(item.id, item.data())).filter((item): item is T => item !== null);
      if (sorter) values.sort(sorter);
      return values;
    });
  }

  async loadPracticeQuestions(flashcardIds: string[]): Promise<void> {
    const profile = this.auth.profile();
    if (!profile || profile.role !== 'student') throw new Error('Akun murid tidak aktif.');
    const session = this.contentSession;
    const assertSession = () => {
      if (this.destroyed || session !== this.contentSession || this.auth.profile()?.uid !== profile.uid || this.auth.profile()?.role !== 'student') {
        throw new Error('Akun murid berubah. Muat ulang latihan.');
      }
    };
    const ids = [...new Set(flashcardIds)].filter(Boolean).sort();
    const values = await this.contentCache.readMany<Question[]>(ids.map(id => `questions:${id}`), async keys => {
      const result = new Map<string, Question[]>();
      for (let offset = 0; offset < keys.length; offset += 30) {
        assertSession();
        const batch = keys.slice(offset, offset + 30).map(key => key.slice('questions:'.length));
        const snapshot = await getDocs(query(collection(firestore, 'questions'), where('flashcardId', 'in', batch)));
        assertSession();
        const questions = snapshot.docs.map(item => this.mapQuestion(item.id, item.data())).filter((item): item is Question => item !== null);
        batch.forEach(id => result.set(`questions:${id}`, questions.filter(item => item.flashcardId === id)));
      }
      return result;
    });
    assertSession();
    this.sourceQuestions.update(current => [...current.filter(item => !ids.includes(item.flashcardId)), ...values.flat()]);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.contentSession++;
    this.unsubscribers.splice(0).forEach((stop) => stop());
    this.usersUnsubscribe?.();
  }

  async saveUser(user: AppUser): Promise<void> {
    if (!user.id) return;
    const email = user.email ?? this.emailForUser(user);
    const username = this.cleanUsername(user.username);
    const previousUsername = this.users().find((item) => item.id === user.id)?.username;
    await setDoc(
      doc(firestore, 'users', user.id),
      {
        active: user.active,
        displayName: user.displayName,
        email,
        grade: user.role === 'student' ? Number(user.grade || 1) : null,
        role: user.role,
        username,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await this.saveLoginUsername({ ...user, email, username });
    const oldUsername = previousUsername ? this.cleanUsername(previousUsername) : '';
    if (oldUsername && oldUsername !== username) {
      await deleteDoc(doc(firestore, 'loginUsernames', oldUsername));
    }
  }

  deleteUser(id: string): void {
    const user = this.users().find((item) => item.id === id);
    void setDoc(doc(firestore, 'users', id), { active: false, updatedAt: serverTimestamp() }, { merge: true });
    if (user) {
      void setDoc(
        doc(firestore, 'loginUsernames', this.cleanUsername(user.username)),
        { active: false, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
  }

  async saveUnit(unit: LearningUnit): Promise<void> {
    if (!unit.id) return;
    await this.saveContent(
      'units', unit.id,
      {
        active: true,
        description: unit.description,
        grade: Number(unit.grade),
        name: unit.name.trim(),
        updatedAt: serverTimestamp(),
      },
    );
    this.units.update(items => [...items.filter(item => item.id !== unit.id), unit].sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name)));
  }

  deleteUnit(id: string): void {
    void this.deleteUnitWithChildren(id);
  }

  async saveFlashcard(flashcard: Flashcard): Promise<void> {
    if (!flashcard.id) return;
    const unit = this.units().find((item) => item.id === flashcard.unitId);
    await this.saveContent(
      'flashcards', flashcard.id,
      {
        active: true,
        audioMode: flashcard.audioMode ?? 'tts',
        createdBy: flashcard.createdBy,
        grade: unit?.grade ?? null,
        hanzi: flashcard.hanzi,
        imagePublicId: flashcard.imagePublicId ?? null,
        imageUrl: flashcard.imageUrl ?? null,
        meaning: flashcard.meaning,
        pinyin: flashcard.pinyin,
        ttsText: flashcard.ttsText ?? flashcard.hanzi,
        unitId: flashcard.unitId,
        unitID: deleteField(),
        updatedAt: serverTimestamp(),
      },
    );
    this.flashcards.update(cards => [...cards.filter(card => card.id !== flashcard.id), flashcard]);
  }

  deleteFlashcard(id: string): void {
    void this.deleteFlashcardWithQuestions(id);
  }

  async saveQuestion(question: Question): Promise<void> {
    if (!question.id) return;
    const flashcard = this.flashcards().find((item) => item.id === question.flashcardId);
    const audioText = question.audioText?.trim();
    const payload: Record<string, unknown> = {
      active: true,
      answerMode: this.answerModeForCategory(question.category),
      audioText: question.category === 'listening' ? audioText || flashcard?.hanzi || null : null,
      category: question.category,
      correctAnswer: question.correctAnswer,
      correctOption: question.correctOption ?? null,
      createdBy: question.createdBy,
      flashcardId: question.flashcardId,
      passage: question.category === 'reading' ? question.passage ?? flashcard?.hanzi ?? null : null,
      prompt: question.prompt,
      unitId: flashcard?.unitId ?? null,
      updatedAt: serverTimestamp(),
    };
    if (question.options?.length) payload['options'] = question.options;
    if (question.maximumPoint) payload['maximumPoint'] = Number(question.maximumPoint);

    await this.saveContent('questions', question.id, payload);
    this.sourceQuestions.update(items => [...items.filter(item => item.id !== question.id), question]);
  }

  deleteQuestion(id: string): void {
    const batch = writeBatch(firestore);
    batch.delete(doc(firestore, 'questions', id));
    void this.commitContent(batch).then(() => {
      this.sourceQuestions.update(items => items.filter(item => item.id !== id));
    });
  }

  userName(id: string): string {
    return this.users().find((user) => user.id === id)?.displayName ?? this.knownTeacherName(id) ?? 'Unknown';
  }

  pointForCategory(category: QuestionCategory): number {
    const fallback: Record<QuestionCategory, number> = {
      writing: 10,
      listening: 3,
      speaking: 6,
      reading: 7,
    };
    return fallback[category];
  }

  writingScore(totalMistakes: number, totalStrokes: number): number {
    const maximum = this.pointForCategory('writing');
    if (totalStrokes <= 0) return 0;
    return Math.max(0, Math.round(maximum * (1 - Math.max(0, totalMistakes) / totalStrokes)));
  }

  private watchCollection<T>(
    name: string,
    target: WritableSignal<T[]>,
    mapper: (id: string, data: Record<string, unknown>) => T | null,
    sorter?: (a: T, b: T) => number,
  ): void {
    const session = this.contentSession;
    const unsubscribe = onSnapshot(
      collection(firestore, name),
      (snapshot) => {
        if (session !== this.contentSession || this.auth.profile()?.uid !== this.contentScope.split(':')[0]) return;
        const values = snapshot.docs
          .map((item) => mapper(item.id, item.data()))
          .filter((item): item is T => item !== null);
        if (sorter) values.sort(sorter);
        target.set(values);
      },
      (error) => {
        console.error(`Gagal membaca collection ${name}:`, error);
      },
    );
    this.unsubscribers.push(unsubscribe);
  }

  private watchUsersForProfile(profile: ReturnType<AuthService['profile']>): void {
    const scope = profile ? `${profile.role}:${profile.uid}` : 'signed-out';
    if (this.activeUserScope === scope) return;
    this.activeUserScope = scope;
    this.usersUnsubscribe?.();
    this.usersUnsubscribe = null;
    this.users.set([]);

    if (!profile) return;

    const applyUsers = (items: AppUser[]) => {
      items.sort((a, b) => a.displayName.localeCompare(b.displayName));
      this.users.set(items);
    };

    if (profile.role === 'admin') {
      this.usersUnsubscribe = onSnapshot(
        collection(firestore, 'users'),
        (snapshot) => applyUsers(snapshot.docs.map((item) => this.mapUser(item.id, item.data())).filter((item): item is AppUser => item !== null)),
        (error) => console.error('Gagal membaca collection users:', error),
      );
      return;
    }

    if (profile.role === 'teacher') {
      this.usersUnsubscribe = onSnapshot(
        query(collection(firestore, 'users'), where('role', 'in', ['student', 'teacher'])),
        (snapshot) => applyUsers(snapshot.docs.map((item) => this.mapUser(item.id, item.data())).filter((item): item is AppUser => item !== null)),
        (error) => console.error('Gagal membaca data murid:', error),
      );
      return;
    }

    this.usersUnsubscribe = onSnapshot(
      doc(firestore, 'users', profile.uid),
      (snapshot) => {
        const user = snapshot.exists() ? this.mapUser(snapshot.id, snapshot.data()) : null;
        applyUsers(user ? [user] : []);
      },
      (error) => console.error('Gagal membaca profil murid:', error),
    );
  }

  private teacherRoster(): AppUser[] {
    const map = new Map<string, AppUser>();
    this.defaultTeacherRoster().forEach((teacher) => map.set(teacher.id, teacher));
    this.users()
      .filter((user) => user.role === 'teacher' && !user.hiddenFromRoster)
      .forEach((teacher) => map.set(teacher.id, teacher));
    [...this.flashcards().map((card) => card.createdBy), ...this.questions().map((question) => question.createdBy)]
      .filter((id) => id.startsWith('teacher-') && !map.has(id))
      .forEach((id) =>
        map.set(id, {
          id,
          active: true,
          displayName: this.knownTeacherName(id) ?? id,
          role: 'teacher',
          username: id,
        }),
      );
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  private defaultTeacherRoster(): AppUser[] {
    return [
      ['082yGwETpjet0oxaKQqjkhLjYCw2', 'Sir Steven'],
      ['tpgoyvAd9PbO9mDMovH2Y62bnyU2', 'Miss Clarista'],
      ['vkMaxzQ8FkR4dmWRXPQaFax9c3E3', 'Miss Callista'],
      ['xprqBZmPuuekvKfrRJoM7gerd1C2', 'Miss Fiedya'],
    ].map(([id, displayName]) => ({
      id,
      active: true,
      displayName,
      role: 'teacher' as const,
      username: id,
    }));
  }

  private knownTeacherName(id: string): string | null {
    return this.defaultTeacherRoster().find((teacher) => teacher.id === id)?.displayName ?? null;
  }

  private mapUser(id: string, data: Record<string, unknown>): AppUser | null {
    const role = this.safeRole(data['role']);
    if (!role) return null;
    const email = this.toString(data['email']);
    return {
      id,
      active: data['active'] !== false,
      email,
      displayName: this.toString(data['displayName'], email || id),
      grade: role === 'student' ? this.toNumber(data['grade'], 1) : undefined,
      hiddenFromRoster: data['hiddenFromRoster'] === true,
      deletionStatus: data['deletionStatus'] === 'deleting' || data['deletionStatus'] === 'failed' ? data['deletionStatus'] : undefined,
      role,
      username: this.toString(data['username'], email ? email.split('@')[0] : id),
    };
  }

  private mapUnit(id: string, data: Record<string, unknown>): LearningUnit | null {
    if (data['active'] === false) return null;
    return {
      id,
      description: this.toString(data['description']),
      grade: this.toNumber(data['grade'], 1),
      name: this.toString(data['name'], id),
    };
  }

  private mapFlashcard(id: string, data: Record<string, unknown>): Flashcard | null {
    if (data['active'] === false) return null;
    return {
      id,
      audioMode: data['audioMode'] === 'tts' ? 'tts' : undefined,
      audioUrl: this.optionalString(data['audioUrl']),
      createdBy: this.toString(data['createdBy']),
      createdAtSeconds: this.timestampSeconds(data['createdAt']),
      hanzi: this.toString(data['hanzi']),
      imagePublicId: this.optionalString(data['imagePublicId']),
      imageUrl: this.optionalString(data['imageUrl']),
      meaning: this.toString(data['meaning']),
      pinyin: this.toString(data['pinyin']),
      ttsText: this.optionalString(data['ttsText']),
      unitId: this.toString(data['unitId'] ?? data['unitID']),
      updatedAtSeconds: this.timestampSeconds(data['updatedAt']),
    };
  }

  private mapQuestion(id: string, data: Record<string, unknown>): Question | null {
    if (data['active'] === false) return null;
    const category = this.safeCategory(data['category']);
    if (!category) return null;
    return {
      id,
      audioText: this.optionalString(data['audioText']),
      category,
      correctAnswer: this.toString(data['correctAnswer']),
      correctOption: this.safeOption(data['correctOption']),
      createdBy: this.toString(data['createdBy']),
      createdAtSeconds: this.timestampSeconds(data['createdAt']),
      flashcardId: this.toString(data['flashcardId']),
      maximumPoint: this.toNumber(data['maximumPoint'] ?? data['point'], 0),
      options: Array.isArray(data['options']) ? data['options'].map((item) => String(item)) : undefined,
      passage: this.optionalString(data['passage']),
      prompt: this.toString(data['prompt']),
      updatedAtSeconds: this.timestampSeconds(data['updatedAt']),
    };
  }

  private mapQuestionPointRule(id: string, data: Record<string, unknown>): QuestionPointRule | null {
    const category = this.safeCategory(data['category'] ?? id);
    if (!category) return null;
    return {
      id,
      active: data['active'] !== false,
      category,
      point: this.toNumber(data['point'] ?? data['maximumPoint'], 0),
    };
  }

  private async deleteUnitWithChildren(id: string): Promise<void> {
    const batch = writeBatch(firestore);
    batch.delete(doc(firestore, 'units', id));
    const cards = this.flashcards().filter((card) => card.unitId === id);
    const cardIds = cards.map((card) => card.id);
    cards.forEach((card) => batch.delete(doc(firestore, 'flashcards', card.id)));
    for (const cardId of cardIds) {
      const questions = await getDocs(query(collection(firestore, 'questions'), where('flashcardId', '==', cardId)));
      questions.docs.forEach(question => batch.delete(question.ref));
    }
    await this.commitContent(batch);
    this.units.update(items => items.filter(unit => unit.id !== id));
    this.flashcards.update(items => items.filter(card => card.unitId !== id));
    this.sourceQuestions.update(items => items.filter(question => !cardIds.includes(question.flashcardId)));
  }

  private async deleteFlashcardWithQuestions(id: string): Promise<void> {
    const batch = writeBatch(firestore);
    batch.delete(doc(firestore, 'flashcards', id));
    const questions = await getDocs(query(collection(firestore, 'questions'), where('flashcardId', '==', id)));
    questions.docs.forEach(question => batch.delete(question.ref));
    await this.commitContent(batch);
    this.flashcards.update(items => items.filter(card => card.id !== id));
    this.sourceQuestions.update(items => items.filter(question => question.flashcardId !== id));
  }

  private async saveContent(name: string, id: string, value: Record<string, unknown>): Promise<void> {
    const batch = writeBatch(firestore);
    batch.set(doc(firestore, name, id), value, { merge: true });
    await this.commitContent(batch);
  }

  /** Content and its revision publish together, including edits, moves and deletions. */
  private async commitContent(batch: WriteBatch): Promise<void> {
    batch.set(doc(firestore, 'contentMetadata', 'catalog'), {
      revision: increment(1), updatedAt: serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    this.contentCache.invalidate();
  }

  private answerModeForCategory(category: QuestionCategory): string {
    if (category === 'writing') return 'strokeOrder';
    if (category === 'speaking') return 'speech';
    return 'multipleChoice';
  }

  private safeRole(value: unknown): UserRole | null {
    return value === 'admin' || value === 'teacher' || value === 'student' ? value : null;
  }

  private safeCategory(value: unknown): QuestionCategory | null {
    return value === 'writing' || value === 'listening' || value === 'speaking' || value === 'reading' ? value : null;
  }

  private safeOption(value: unknown): 'A' | 'B' | 'C' | 'D' | undefined {
    return value === 'A' || value === 'B' || value === 'C' || value === 'D' ? value : undefined;
  }

  private toString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }

  private emailForUser(user: Pick<AppUser, 'role' | 'username'>): string {
    const username = this.cleanUsername(user.username);
    if (username.includes('@')) return username;
    const domain = user.role === 'teacher' ? 'formosa.teacher' : user.role === 'student' ? 'formosa.student' : 'formosa.admin';
    return `${username}@${domain}`;
  }

  private async saveLoginUsername(user: AppUser): Promise<void> {
    const username = this.cleanUsername(user.username);
    const email = (user.email ?? this.emailForUser(user)).trim().toLowerCase();
    if (!username || !email) return;
    await setDoc(
      doc(firestore, 'loginUsernames', username),
      {
        active: user.active,
        displayName: user.displayName,
        email,
        role: user.role,
        uid: user.id,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  private cleanUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  private timestampSeconds(value: unknown): number | undefined {
    if (typeof value === 'object' && value !== null && 'seconds' in value) {
      const seconds = (value as { seconds?: unknown }).seconds;
      return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : undefined;
    }
    if (typeof value === 'string') {
      const millis = Date.parse(value);
      return Number.isFinite(millis) ? Math.floor(millis / 1000) : undefined;
    }
    return undefined;
  }

  private toNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }
}
