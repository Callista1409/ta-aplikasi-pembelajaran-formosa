import { Component, HostListener, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Flashcard, LearningUnit, Question, QuestionCategory } from '../../core/models/content.models';
import { ContentDataService } from '../../core/services/content-data.service';
import { WebSpeechService } from '../../core/services/web-speech.service';
import { StudentLearningService } from './student-learning.service';
import type { PracticeAnswerEventInput } from './student-learning.service';
import { UiSelectComponent, UiSelectOption } from '../../shared/ui-select.component';
import { MascotDisplayComponent } from './mascot-display.component';
import { StudentPosttestService } from './student-posttest.service';
import { PosttestAnswer, buildPosttestPlan, posttestAnswerScore, posttestWritingScore } from '../../core/content/posttest-plan';
import { posttestRequirements, unitChapter } from '../../core/content/posttest-curriculum';
import { curriculumHanziForms, curriculumVocabularyOrder, normalizeHanziOrder } from '../../core/content/curriculum-vocabulary-order';
import { unitTopicTitle } from '../../core/content/unit-topic-titles';
import HanziWriter, { HanziWriterInstance } from 'hanzi-writer/dist/index.esm.js';

type LessonStep = 'intro' | 'units' | 'cards' | 'test' | 'result';
type WritingStrokeData = {
  strokeNum: number;
  mistakesOnStroke: number;
  totalMistakes: number;
  strokesRemaining: number;
};
type WritingCompleteData = { character: string; totalMistakes: number };
type WritingHanziWriter = HanziWriterInstance & {
  quiz(options?: {
    leniency?: number;
    showHintAfterMisses?: number | false;
    highlightOnComplete?: boolean;
    onCorrectStroke?: (stroke: WritingStrokeData) => void;
    onMistake?: (stroke: WritingStrokeData) => void;
    onComplete?: (result: WritingCompleteData) => void;
  }): Promise<unknown>;
  cancelQuiz(): void;
};

@Component({ selector: 'app-student-lesson', imports: [RouterLink, UiSelectComponent, MascotDisplayComponent], templateUrl: './student-lesson.component.html', styleUrls: ['./student-lesson.component.scss', './student-posttest.component.scss', './student-stroke-order.scss'] })
export class StudentLessonComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly strokeWriters = new Map<number, HanziWriterInstance>();
  private readonly writingWriters = new Map<number, WritingHanziWriter>();
  private correctAudioContext: AudioContext | null = null;
  protected readonly data = inject(ContentDataService);
  protected readonly learning = inject(StudentLearningService);
  protected readonly speech = inject(WebSpeechService);
  protected readonly posttest = inject(StudentPosttestService);
  protected readonly posttestMode = inject(ActivatedRoute).snapshot.data['posttest'] === true;
  protected readonly posttestSavePending = signal(false);
  protected readonly posttestStudyConfirmed = signal(false);
  protected readonly practiceLoading = signal(false);
  protected readonly practiceError = signal('');
  private destroyed = false;
  protected readonly posttestStartError = signal('');
  protected readonly markingAllLearned = signal(false);
  protected readonly markAllLearnedError = signal('');
  protected readonly bulkMarkRequested = signal(false);
  protected readonly bulkPosttestChecked = computed(() => this.bulkMarkRequested() || this.cards().some((card) => this.learning.bulkLearnedIds().has(card.id)));
  protected readonly posttestAnswerScore = posttestAnswerScore;
  private pendingPosttestAnswer: PosttestAnswer | null = null;
  protected readonly step = signal<LessonStep>('intro');
  protected readonly selectedUnitId = signal('salutation');
  protected readonly cardIndex = signal(0);
  protected readonly flipped = signal(false);
  protected readonly cardFormat = signal<'image' | 'hanzi'>('hanzi');
  protected readonly wordListOpen = signal(false);
  protected readonly strokeMode = signal(false);
  protected readonly playingStroke = signal<number | null>(null);
  protected readonly orderMode = signal<'ordered' | 'random'>('ordered');
  protected readonly questionNumber = signal(1);
  private readonly testPlan = signal<Array<{ card: Flashcard; category: QuestionCategory; questionId: string; question?: Question }>>([]);
  protected readonly score = signal(0);
  protected readonly practiceSavePending = signal(false);
  protected readonly practiceAnswerSaving = signal(false);
  protected readonly practiceAnswerLogError = signal('');
  private pendingPracticeAnswer: PracticeAnswerEventInput | null = null;
  private practiceSessionId = '';
  private practiceSessionOrder = 0;
  private practiceSessionOfDay = 0;
  private practiceSessionKind: 'scheduled' | 'additional' = 'scheduled';
  private practiceAnchorQuestionIds: Record<QuestionCategory, string> | null = null;
  private practiceSessionCompleted = false;
  private advanceAfterPracticeAnswerSave = false;
  protected readonly answered = signal(false);
  protected readonly answerCorrect = signal(false);
  protected readonly practiceQuestionSkipped = signal(false);
  protected readonly selectedChoice = signal<string | null>(null);
  protected readonly feedback = signal('');
  protected readonly celebrationStars = Array.from({ length: 20 }, (_, index) => index);
  protected readonly speakingCardId = signal<string | null>(null);
  protected readonly recognizingSpeech = signal(false);
  protected readonly recognizedText = signal('');
  protected readonly recognitionConfidence = signal<number | null>(null);
  protected readonly recognitionConfidencePercent = computed(() =>
    Math.round((this.recognitionConfidence() ?? 0) * 100),
  );
  protected readonly speechError = signal('');
  protected readonly writingActiveIndex = signal(0);
  protected readonly writingCompleted = signal<Set<number>>(new Set());
  protected readonly writingMistakes = signal(0);
  protected readonly writingStatus = signal('Ikuti urutan goresan pada kotak pertama.');
  private readonly writingStrokeCounts = new Map<number, number>();
  private writingMistakesBeforeCharacter = 0;
  private writingActiveCharacterMistakes = 0;
  private writingGeneration = 0;
  protected readonly categories: QuestionCategory[] = ['writing', 'listening', 'speaking', 'reading'];
  protected readonly orderOptions: UiSelectOption[] = [
    { label: 'Berurutan', value: 'ordered' },
    { label: 'Acak', value: 'random' },
  ];

  protected readonly currentStudent = computed(() => this.data.users().find((user) => user.id === this.data.currentUserId() && user.role === 'student'));
  protected readonly availableUnits = computed(() => {
    const grade = this.currentStudent()?.grade;
    const units = this.data.units().filter((unit) => !grade || unit.grade === grade);
    return this.sortUnits(units.length ? units : this.data.units());
  });
  protected readonly selectedUnit = computed<LearningUnit | undefined>(() => this.availableUnits().find((unit) => unit.id === this.selectedUnitId()) ?? this.availableUnits()[0]);
  protected readonly cards = computed(() => {
    if (this.posttestMode) return this.posttest.studyCards();
    const unit = this.selectedUnit();
    const unitId = unit?.id ?? this.selectedUnitId();
    const cards = this.data.flashcards().filter((card) => card.unitId === unitId);
    const sourceOrder = unit ? curriculumVocabularyOrder(unit.grade, unitChapter(unit) ?? 0) : undefined;
    if (!sourceOrder) return cards;
    const order = new Map<string, number>();
    sourceOrder.forEach((hanzi, index) => {
      curriculumHanziForms(hanzi).forEach(form => {
        const key = normalizeHanziOrder(form);
        if (!order.has(key)) order.set(key, index);
      });
    });
    return [...cards].sort((first, second) => {
      const firstOrder = Math.min(...curriculumHanziForms(first.hanzi)
        .map(form => order.get(normalizeHanziOrder(form)) ?? Number.MAX_SAFE_INTEGER));
      const secondOrder = Math.min(...curriculumHanziForms(second.hanzi)
        .map(form => order.get(normalizeHanziOrder(form)) ?? Number.MAX_SAFE_INTEGER));
      return firstOrder - secondOrder || first.meaning.localeCompare(second.meaning);
    });
  });
  protected readonly activeCard = computed(() => this.cards()[this.cardIndex()] ?? this.cards()[0]);
  protected readonly allAvailablePosttestLearned = computed(() => this.cards().length > 0 && this.cards().every((card) => this.learning.learnedIds().has(card.id)));
  protected readonly learnedCards = computed(() => this.cards().filter((card) => this.learning.learnedIds().has(card.id)));
  protected readonly canTest = computed(() => this.posttestMode
    ? this.posttest.loaded() && !this.posttest.saving() && (this.posttest.session()?.status === 'completed' || (this.posttest.ready() && (this.posttestStudyConfirmed() || !!this.posttest.session())))
    : this.learnedCards().length >= 5);
  protected readonly testCard = computed(() => this.testPlan()[this.questionNumber() - 1]?.card);
  protected readonly testLength = computed(() => this.testPlan().length || 10);
  protected readonly testCategory = computed(() => this.testPlan()[this.questionNumber() - 1]?.category ?? 'writing');
  protected readonly testMaximumPoint = computed(() => this.posttestMode ? 1 : this.data.pointForCategory(this.testCategory()));
  protected readonly writingStrokeTotal = signal(0);
  protected readonly practiceAwardedPoint = signal(0);
  protected readonly currentQuestionPoint = computed(() => {
    if (!this.posttestMode && this.answered()) return this.practiceAwardedPoint();
    if (this.practiceQuestionSkipped()) return 0;
    if (this.testCategory() === 'writing') {
      return this.data.writingScore(this.writingMistakes(), this.writingStrokeTotal());
    }
    return this.answered() && this.answerCorrect() ? this.testMaximumPoint() : 0;
  });
  protected readonly currentQuestionHistory = computed(() => {
    const questionId = this.testQuestion()?.id;
    return questionId ? this.learning.questionProgress()[questionId]?.status ?? 'unseen' : 'unseen';
  });
  protected readonly debugCategoryPoints = [
    { category: 'Reading', point: this.data.pointForCategory('reading') },
    { category: 'Listening', point: this.data.pointForCategory('listening') },
    { category: 'Speaking', point: this.data.pointForCategory('speaking') },
    { category: 'Writing', point: this.data.pointForCategory('writing') },
  ];
  protected readonly testQuestion = computed(() => {
    const item = this.testPlan()[this.questionNumber() - 1];
    if (item?.question) return item.question;
    const card = this.testCard();
    if (!card) return undefined;
    const question = item?.questionId
      ? this.data.questions().find((question) => question.id === item.questionId)
      : this.data.questions().find((question) => question.flashcardId === card.id && question.category === this.testCategory());
    if (!question) return undefined;
    return question;
  });
  protected readonly usesPretestListening = computed(() =>
    this.testCategory() === 'listening' && (this.posttestMode || [5, 6].includes(this.selectedUnit()?.grade ?? 0)),
  );
  protected readonly correctChoice = computed(() => this.testQuestion()?.correctAnswer || this.testCard()?.meaning || '');
  protected readonly choices = computed(() => {
    const question = this.testQuestion();
    if (question?.options?.length) return question.options.slice(0, 4);
    const correct = question?.correctAnswer || this.testCard()?.meaning || '';
    const values = [correct, ...this.data.flashcards().map((card) => card.meaning).filter((meaning) => meaning !== correct)];
    return [...new Set(values)].slice(0, 4);
  });

  protected categoryLabel(category: QuestionCategory): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  constructor() {
    effect(() => {
      const units = this.data.units();
      const loaded = this.data.loadedUnits();
      const targets = this.posttestMode
        ? units.filter(unit => posttestRequirements(this.posttest.grade()).some(row => row.grade === unit.grade && row.chapter === unitChapter(unit)))
        : this.step() === 'cards' ? units.filter(unit => unit.id === this.selectedUnitId()) : [];
      targets.forEach(unit => {
        if (loaded.has(unit.id)) {
          void this.learning.loadProgressForCards(this.data.flashcards().filter(card => card.unitId === unit.id).map(card => card.id))
            .catch(error => this.practiceError.set(error instanceof Error ? error.message : 'Progres unit belum dapat dimuat.'));
          return;
        }
        void this.data.loadUnitCards(unit.id).catch(error => {
          if (!this.posttestMode) this.practiceError.set(error instanceof Error ? error.message : 'Materi belum dapat dimuat.');
        });
      });
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = params.get('step');
      let next: LessonStep = requested === 'units' || requested === 'cards' || requested === 'test' || requested === 'result' ? requested : 'intro';
      // A refreshed URL cannot restore an in-memory practice attempt.
      if ((next === 'test' || next === 'result') && !this.testPlan().length) next = this.posttestMode ? 'intro' : 'cards';
      if (this.posttestMode && (next === 'units' || next === 'cards')) next = 'intro';
      const previous = this.step();
      if (previous === 'test' && next !== 'test') {
        this.resetQuestionState();
        this.speech.cancelSpeech();
      }
      if (params.get('unit')) this.selectedUnitId.set(params.get('unit')!);
      this.step.set(next);
      const open = params.get('dialog') === 'strokes' && (next === 'cards' || (this.posttestMode && next === 'intro'));
      if (!open) this.clearStrokeOrder();
      else if (!this.strokeMode()) {
        this.strokeMode.set(true);
        window.setTimeout(() => {
          if (!this.strokeMode()) return;
          this.initializeStrokeWriters();
          document.querySelector<HTMLButtonElement>('.stroke-close')?.focus();
        });
      }
      if (next !== previous) {
        window.setTimeout(() => window.scrollTo(0, 0));
        if (next === 'test') this.prepareQuestionAfterRender();
      }
    });
  }

  protected async retryContent(): Promise<void> {
    try { await this.data.loadBasics(); }
    catch { /* The service exposes the load error and keeps retry available. */ }
  }

  protected navigateStep(next: LessonStep, replaceUrl = false): void {
    if (this.practiceSavePending()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step: next === 'intro' ? null : next, unit: this.selectedUnitId(), dialog: null },
      queryParamsHandling: 'merge', replaceUrl,
      state: { lessonParent: replaceUrl ? (this.location.getState() as { lessonParent?: string }).lessonParent : this.step() },
    });
  }

  protected backTo(next: LessonStep): void {
    if (this.practiceSavePending()) return;
    if (this.posttestMode && (this.posttestSavePending() || this.posttest.saving())) return;
    if (this.location.getState() && (this.location.getState() as { lessonParent?: string }).lessonParent === next) this.location.back();
    else this.navigateStep(next, true);
  }

  @HostListener('document:keydown.escape')
  protected dismissStrokeOrder(): void {
    if (this.strokeMode()) this.closeStrokeOrder();
  }

  @HostListener('document:keydown.tab', ['$event'])
  protected keepStrokeFocus(event: Event): void {
    if (!this.strokeMode()) return;
    const controls = document.querySelectorAll<HTMLButtonElement>('.stroke-modal button');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if ((event as KeyboardEvent).shiftKey && document.activeElement === first) {
      event.preventDefault(); last?.focus();
    } else if (!(event as KeyboardEvent).shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.practiceSessionId && !this.practiceSessionCompleted
      && !this.practiceSavePending() && !this.practiceAnswerSaving()) {
      void this.learning.abandonPracticeSession(this.practiceSessionId).catch(() => undefined);
    }
    this.clearStrokeOrder();
    this.resetQuestionState();
    this.speech.cancelSpeech();
  }

  protected async startPosttest(): Promise<void> {
    if (this.posttest.saving() || !this.posttest.loaded()) return;
    this.posttestStartError.set('');
    try {
      let session = this.posttest.session();
      if (session?.status !== 'completed' && !session && (!this.posttestStudyConfirmed() || !this.posttest.ready())) return;
      if (session?.status !== 'completed') session = await this.posttest.begin(this.posttest.plan());
      this.testPlan.set(session.plan);
      this.score.set(this.posttest.summary().earned);
      this.questionNumber.set(Math.min(session.answers.length + 1, session.plan.length));
      this.resetQuestionState();
      this.navigateStep(session.status === 'completed' ? 'result' : 'test');
      window.setTimeout(() => window.scrollTo(0, 0));
    } catch (error) {
      this.posttestStartError.set(error instanceof Error ? error.message : 'Posttest belum dapat dimulai.');
    }
  }

  protected async markAllPosttestLearned(control: HTMLInputElement): Promise<void> {
    const checked = control.checked;
    if (!this.posttestMode || this.markingAllLearned() || !this.cards().length) return;
    this.markingAllLearned.set(true);
    this.markAllLearnedError.set('');
    try {
      const ids = this.cards().map((card) => card.id);
      if (checked) await this.learning.markAllLearned(ids);
      else await this.learning.unmarkAllLearned(ids);
      this.bulkMarkRequested.set(checked);
    } catch (error) {
      this.markAllLearnedError.set(error instanceof Error ? error.message : 'Kosakata belum dapat ditandai. Coba lagi.');
    } finally {
      this.markingAllLearned.set(false);
      control.checked = this.bulkPosttestChecked();
    }
  }

  private async recordPosttestAnswer(correct: boolean, response: string, skipped = false, earnedScore?: number): Promise<void> {
    if (this.answered()) return;
    const isWriting = this.testCategory() === 'writing';
    const mistakes = isWriting ? this.writingMistakes() : 0;
    const strokes = isWriting ? this.writingStrokeTotal() : 0;
    this.pendingPosttestAnswer = { questionId: this.testQuestion()!.id, category: this.testCategory(),
      response, correct, skipped, writingMistakes: mistakes,
      ...(isWriting ? { writingTotalStrokes: strokes, writingStrokes: strokes,
        earnedScore: skipped ? 0 : earnedScore ?? posttestWritingScore(mistakes, strokes),
        score: skipped ? 0 : earnedScore ?? posttestWritingScore(mistakes, strokes) } : {}) };
    this.answerCorrect.set(correct);
    if (isWriting && this.feedback) {
      const points = skipped ? 0 : earnedScore ?? (correct ? 1 : 0);
      this.feedback.set(`Total ${strokes} stroke, ${mistakes} kesalahan. Nilai soal: ${this.posttestScoreLabel(points)}/1.`);
    }
    this.answered.set(true);
    this.posttestSavePending.set(true);
    await this.retryPosttestSave();
  }

  protected posttestScoreLabel(score: number): string {
    return Number(score.toFixed(2)).toString();
  }

  protected async retryPosttestSave(): Promise<void> {
    if (!this.pendingPosttestAnswer || this.posttest.saving()) return;
    try {
      await this.posttest.saveAnswer(this.pendingPosttestAnswer);
      this.pendingPosttestAnswer = null;
      this.posttestSavePending.set(false);
      this.score.set(this.posttest.summary().score);
      this.feedback.set('Jawaban tersimpan. Lanjutkan ke soal berikutnya.');
    } catch {
      this.feedback.set('Jawaban belum tersimpan. Coba simpan lagi sebelum melanjutkan.');
    }
  }

  protected skipPosttestQuestion(): void {
    if (!this.posttestMode || this.answered() || this.recognizingSpeech() || this.speakingCardId()) return;
    this.writingWriters.forEach((writer) => writer.cancelQuiz());
    void this.recordPosttestAnswer(false, '', true);
  }

  protected skipPracticeQuestion(): void {
    if (this.posttestMode || this.answered() || this.recognizingSpeech() || this.practiceAnswerSaving()) return;
    this.speech.cancelSpeech();
    this.speakingCardId.set(null);
    this.writingWriters.forEach((writer) => writer.cancelQuiz());
    this.practiceQuestionSkipped.set(true);
    this.answerCorrect.set(false);
    this.answered.set(true);
    this.feedback.set('Soal dilewati. Nilai soal ini 0. Lanjut ke soal berikutnya.');
    this.advanceAfterPracticeAnswerSave = true;
    this.queuePracticeAnswer(false, this.data.pointForCategory(this.testCategory()), 0, '', true);
    if (!this.pendingPracticeAnswer && !this.practiceAnswerSaving()) this.advanceAfterPracticeAnswerSave = false;
  }

  protected unitDisplayName(unit: LearningUnit | undefined): string {
    if (!unit) return '';
    return unitTopicTitle(unit.grade, unitChapter(unit))
      ?? unit.name.replace(/^\s*Pelajaran\s+\d+\s*:\s*/i, '').trim();
  }

  protected unitNumber(unit: LearningUnit): number | null { return unitChapter(unit); }

  protected posttestCardSource(card: Flashcard): string {
    const unit = this.data.units().find((candidate) => candidate.id === card.unitId);
    return unit ? `SD ${unit.grade} · Bab ${unitChapter(unit) ?? '—'}` : '';
  }

  private sortUnits(units: LearningUnit[]): LearningUnit[] {
    return [...units].sort((first, second) => {
      const firstNumber = unitChapter(first) ?? Number.MAX_SAFE_INTEGER;
      const secondNumber = unitChapter(second) ?? Number.MAX_SAFE_INTEGER;
      return firstNumber - secondNumber || first.grade - second.grade || first.name.localeCompare(second.name);
    });
  }

  protected selectUnit(id: string): void { this.selectedUnitId.set(id); this.cardIndex.set(0); this.flipped.set(false); this.navigateStep('cards'); }
  protected learnedCount(id: string): number { const ids = this.data.flashcards().filter((card) => card.unitId === id).map((card) => card.id); return ids.filter((id) => this.learning.learnedIds().has(id)).length; }
  protected cardCount(id: string): number { return this.data.flashcards().filter((card) => card.unitId === id).length; }
  protected toggleCard(): void { const card = this.activeCard(); if (card) this.learning.toggleLearned(card.id); }
  protected showCard(index: number): void { this.cardIndex.set(index); this.flipped.set(false); this.wordListOpen.set(false); }


  protected nextCard(direction: 1 | -1): void {
    const length = this.cards().length;
    if (!length) return;
    if (this.orderMode() === 'random') this.cardIndex.set(Math.floor(Math.random() * length));
    else this.cardIndex.set((this.cardIndex() + direction + length) % length);
    this.flipped.set(false);
  }

  protected changeOrder(value: string): void {
    this.orderMode.set(value === 'random' ? 'random' : 'ordered');
  }

  protected toggleCardFormat(): void {
    this.cardFormat.update((format) => format === 'image' ? 'hanzi' : 'image');
    this.flipped.set(false);
  }

  protected async playCardAudio(card: Flashcard, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.speechError.set('');
    this.speakingCardId.set(card.id);
    try {
      await this.speech.speakMandarin(card.hanzi);
    } catch (error) {
      this.speechError.set(error instanceof Error ? error.message : 'Suara tidak dapat diputar.');
    } finally {
      this.speakingCardId.set(null);
    }
  }

  protected async playListeningAudio(): Promise<void> {
    const card = this.testCard();
    if (!card || this.speakingCardId()) return;
    const text = this.testQuestion()?.audioText || card.hanzi;
    const questionNumber = this.questionNumber();
    const repetitions = this.usesPretestListening() ? 2 : 1;
    this.speechError.set('');
    this.speakingCardId.set(card.id);
    try {
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        await this.speech.speakMandarin(text);
        if (this.questionNumber() !== questionNumber || this.step() !== 'test') break;
      }
    } catch (error) {
      this.speechError.set(error instanceof Error ? error.message : 'Suara tidak dapat diputar.');
    } finally {
      this.speakingCardId.set(null);
    }
  }

  protected strokeCharacters(): string[] {
    return Array.from(this.activeCard()?.hanzi ?? '');
  }

  protected openStrokeOrder(event: Event): void {
    event.stopPropagation();
    void this.router.navigate([], { relativeTo: this.route, queryParams: { dialog: 'strokes' }, queryParamsHandling: 'merge', state: { lessonDialog: true } });
  }

  protected closeStrokeOrder(): void {
    if ((this.location.getState() as { lessonDialog?: boolean }).lessonDialog) this.location.back();
    else void this.router.navigate([], { relativeTo: this.route, queryParams: { dialog: null }, queryParamsHandling: 'merge', replaceUrl: true });
    document.querySelector<HTMLButtonElement>('.writing-button')?.focus();
  }

  private clearStrokeOrder(): void {
    this.strokeMode.set(false);
    this.playingStroke.set(null);
    this.strokeWriters.clear();
  }

  protected playStroke(index: number): void {
    const writer = this.strokeWriters.get(index);
    if (!writer) return;
    this.playingStroke.set(index);
    void writer.animateCharacter({ onComplete: () => this.playingStroke.set(null) });
  }

  private initializeStrokeWriters(): void {
    this.strokeWriters.clear();
    this.strokeCharacters().forEach((character, index) => {
      const target = document.getElementById(`stroke-target-${index}`);
      if (!target) return;
      target.replaceChildren();
      const size = Math.floor(Math.min(target.clientWidth, target.clientHeight)) || 190;
      const writer = HanziWriter.create(target, character, {
        width: size,
        height: size,
        padding: Math.max(18, Math.round(size * 0.12)),
        showCharacter: false,
        showOutline: true,
        strokeColor: '#555555',
        outlineColor: '#d7d7d7',
        strokeAnimationSpeed: 1,
        delayBetweenStrokes: 180,
      });
      this.strokeWriters.set(index, writer);
    });
  }

  private practiceStartRequestId: string | null = null;
  private practiceStartUnitId = '';

  protected async startTest(): Promise<void> {
    if (this.posttestMode) {
      if (this.canTest()) await this.startPosttest();
      return;
    }
    if (!this.canTest() || this.practiceLoading() || this.practiceSavePending()) return;
    const unitId = this.selectedUnit()?.id;
    const previousStep = this.step();
    this.practiceLoading.set(true);
    this.practiceError.set('');
    try {
      const cardIds = this.learnedCards().map((card) => card.id);
      await this.data.loadPracticeQuestions(cardIds);
      await this.learning.loadQuestionProgress(this.data.questions().filter(question => cardIds.includes(question.flashcardId)).map(question => question.id));
      if (this.destroyed || this.selectedUnit()?.id !== unitId || this.step() !== previousStep || !this.canTest()) return;
      const candidateAnchors = this.choosePracticeAnchorIds();
      this.createTestPlan(candidateAnchors);
      if (this.testPlan().length !== 10) throw new Error('Soal unit ini belum lengkap. Hubungi guru untuk melengkapi soal.');
      if (this.practiceStartUnitId !== unitId) {
        this.practiceStartRequestId = null;
        this.practiceStartUnitId = unitId ?? '';
      }
      const allocation = await this.learning.beginPracticeSession(
        this.selectedUnit()?.id ?? unitId ?? '',
        this.selectedUnit()?.grade ?? this.currentStudent()?.grade ?? 1,
        candidateAnchors,
        this.testPlan().map(item => item.questionId),
        this.practiceStartRequestId ??= crypto.randomUUID(),
      );
      if (this.destroyed || this.selectedUnit()?.id !== unitId || this.step() !== previousStep) {
        this.practiceStartRequestId = null;
        await this.learning.abandonPracticeSession(allocation.sessionId);
        return;
      }
      this.practiceSessionId = allocation.sessionId;
      this.practiceSessionOrder = allocation.sessionOrder;
      this.practiceSessionOfDay = allocation.sessionOfDay;
      this.practiceSessionKind = allocation.sessionKind;
      this.practiceAnchorQuestionIds = allocation.anchorQuestionIds;
      this.practiceSessionCompleted = false;
      this.testPlan.set(allocation.plan);
      this.practiceStartRequestId = null;
      if (this.testPlan().length !== 10) throw new Error('Soal unit ini belum lengkap untuk memuat jangkar dan soal latihan. Hubungi guru.');
      this.pendingPracticeAnswer = null;
      this.practiceAnswerLogError.set('');
      this.questionNumber.set(1);
      this.score.set(0);
      this.resetQuestionState();
      this.navigateStep('test');
    } catch (error) {
      this.practiceError.set(error instanceof Error ? error.message : 'Soal belum dapat dimuat. Coba lagi.');
    } finally {
      this.practiceLoading.set(false);
    }
  }

  protected questionPrompt(): string {
    const card = this.testCard(); const category = this.testCategory(); if (!card) return '';
    const question = this.testQuestion();
    if (question?.prompt) return question.prompt;
    if (category === 'writing') return `Tulis karakter sesuai urutan goresan untuk: ${card.meaning} (${card.pinyin})`;
    if (category === 'listening') return 'Dengarkan audio, lalu pilih arti yang tepat.';
    if (category === 'speaking') return `Ucapkan kosakata berikut: ${card.hanzi}`;
    return `Apa arti dari ${card.hanzi}?`;
  }

  protected writingCharacters(): string[] {
    const hanzi = this.testCard()?.hanzi ?? '';
    return Array.from(hanzi.split(/[\/／]/u)[0] ?? '');
  }

  protected writingProgressLabel(): string {
    return `${this.writingCompleted().size}/${this.writingCharacters().length} karakter selesai`;
  }

  protected enableCorrectSound(): void {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    this.correctAudioContext ??= new AudioContextClass();
    if (this.correctAudioContext.state === 'suspended') {
      void this.correctAudioContext.resume().catch(() => undefined);
    }
  }

  private playCorrectChime(): void {
    this.enableCorrectSound();
    const context = this.correctAudioContext;
    if (!context || context.state !== 'running') return;

    const start = context.currentTime;
    [784, 988, 1175].forEach((frequency, index) => {
      const noteStart = start + index * 0.085;
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      volume.gain.setValueAtTime(0.0001, noteStart);
      volume.gain.exponentialRampToValueAtTime(0.075, noteStart + 0.012);
      volume.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.38);
      oscillator.connect(volume).connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.39);
    });
  }

  protected resetWritingQuestion(): void {
    if (this.testCategory() !== 'writing' || this.answered()) return;
    this.prepareWritingPractice();
  }

  protected answer(choice: string): void {
    if (this.answered()) return;
    this.selectedChoice.set(choice);
    const correctAnswer = this.correctChoice();
    const correct = choice === correctAnswer;
    if (this.posttestMode) {
      void this.recordPosttestAnswer(correct, choice);
      return;
    }
    const question = this.testQuestion();
    const questionId = question?.id;
    const basePoint = this.data.pointForCategory(this.testCategory());
    const awardedPoint = this.learning.previewPracticeReward(questionId ?? '', basePoint, correct);
    this.queuePracticeAnswer(correct, basePoint, awardedPoint, choice);
    if (correct) {
      this.playCorrectChime();
      const points = awardedPoint;
      this.score.update((score) => score + points); this.answerCorrect.set(true); this.answered.set(true); this.feedback.set(`Hebat! Jawaban benar, kamu dapat +${points} poin.`);
    } else {
      this.answerCorrect.set(false);
      this.answered.set(true);
      this.feedback.set('Belum tepat. Kamu bisa lanjut ke soal berikutnya.');
    }
  }

  protected async recordSpeakingAnswer(): Promise<void> {
    if (this.answered() || this.recognizingSpeech()) return;
    this.enableCorrectSound();
    this.recognizingSpeech.set(true);
    this.recognizedText.set('');
    this.recognitionConfidence.set(null);
    this.speechError.set('');
    this.feedback.set('');

    try {
      const result = await this.speech.recognizeMandarin();
      this.recognizedText.set(result.transcript);
      this.recognitionConfidence.set(result.confidence);
      const expectedForms = curriculumHanziForms(this.testCard()?.hanzi ?? '')
        .map(form => this.speech.normalizeMandarin(form));
      const matchingTranscript = result.alternatives.find((alternative) =>
        expectedForms.some(expected => this.speech.matchesMandarin(alternative, expected)),
      );
      const isCorrect = matchingTranscript !== undefined;
      const response = matchingTranscript ?? result.transcript;

      if (this.posttestMode) {
        await this.recordPosttestAnswer(isCorrect, response);
        return;
      }

      if (isCorrect) {
        this.playCorrectChime();
        const basePoint = this.data.pointForCategory('speaking');
        const points = this.learning.previewPracticeReward(this.testQuestion()?.id ?? '', basePoint, true);
        this.queuePracticeAnswer(true, basePoint, points, response);
        this.score.update((score) => score + points);
        this.answerCorrect.set(true);
        this.answered.set(true);
        this.feedback.set(`Hebat! Ucapanmu dikenali dengan benar. Kamu dapat +${points} poin.`);
      } else {
        const points = this.data.pointForCategory('speaking');
        this.queuePracticeAnswer(false, points, 0, response);
        this.answerCorrect.set(false);
        this.answered.set(true);
        this.feedback.set('Belum tepat. Kamu bisa lanjut ke soal berikutnya.');
      }
    } catch (error) {
      this.speechError.set(error instanceof Error ? error.message : 'Ucapan belum dapat dikenali.');
    } finally {
      this.recognizingSpeech.set(false);
    }
  }

  protected async nextQuestion(): Promise<void> {
    if (this.practiceSavePending() || this.practiceAnswerSaving() || this.practiceAnswerLogError()) return;
    if (!this.answered() || (this.posttestMode && (this.posttestSavePending() || this.posttest.saving()))) return;
    this.speech.cancelSpeech();
    this.speakingCardId.set(null);
    if (this.questionNumber() === this.testLength()) {
      if (this.posttestMode) {
        this.navigateStep('result', true);
        window.setTimeout(() => window.scrollTo(0, 0));
        return;
      }
      this.practiceSavePending.set(true);
      const recorded = await this.learning.addTestResult(this.score(), {
        rewardId: this.practiceSessionId,
        sessionId: this.practiceSessionId,
        sessionOrder: this.practiceSessionOrder,
        sessionOfDay: this.practiceSessionOfDay,
        sessionKind: this.practiceSessionKind,
        anchorQuestionIds: this.practiceAnchorQuestionIds ?? undefined,
        categoryCounts: this.testCategorySummary(),
        questionCount: this.testLength(),
        unitId: this.selectedUnitId(),
      });
      this.practiceSavePending.set(false);
      if (this.destroyed || this.step() !== 'test') return;
      if (!recorded) {
        this.feedback.set(this.learning.starError() || 'Star belum tersimpan. Periksa koneksi lalu tekan lanjut lagi.');
        return;
      }
      this.practiceSessionCompleted = true;
      this.navigateStep('result', true);
      return;
    }
    this.questionNumber.update((value) => value + 1);
    this.resetQuestionState();
    this.prepareQuestionAfterRender();
  }

  protected cardLabel(card: Flashcard): string { return `${card.pinyin} - ${card.meaning}`; }
  protected returnToCards(): void {
    if (this.practiceSavePending() || this.practiceAnswerSaving() || this.practiceAnswerLogError()) return;
    if (this.posttestMode && (this.posttestSavePending() || this.posttest.saving())) return;
    if (!this.posttestMode && this.practiceSessionId && !this.practiceSessionCompleted) {
      void this.learning.abandonPracticeSession(this.practiceSessionId).catch(() => undefined);
      this.practiceSessionCompleted = true;
    }
    this.backTo(this.posttestMode ? 'intro' : 'cards');
  }

  private prepareQuestionAfterRender(): void {
    if (this.posttestMode) window.setTimeout(() => window.scrollTo(0, 0));
    if (this.testCategory() === 'writing') {
      const questionId = this.testQuestion()?.id;
      window.setTimeout(() => {
        if (this.step() === 'test' && this.testQuestion()?.id === questionId) this.prepareWritingPractice();
      });
    }
  }

  private prepareWritingPractice(): void {
    this.resetWritingPractice();
    const characters = this.writingCharacters();
    characters.forEach((character, index) => {
      const target = document.getElementById(`writing-target-${index}`);
      if (!target) return;
      target.replaceChildren();
      const size = Math.floor(Math.min(target.clientWidth, target.clientHeight)) || 190;
      const writer = HanziWriter.create(target, character, {
        width: size,
        height: size,
        padding: Math.max(18, Math.round(size * 0.12)),
        showCharacter: false,
        showOutline: true,
        strokeColor: '#555555',
        outlineColor: '#d7d7d7',
        strokeAnimationSpeed: 1,
        delayBetweenStrokes: 180,
      }) as WritingHanziWriter;
      this.writingWriters.set(index, writer);
    });
    this.startWritingCharacter(0);
  }

  private startWritingCharacter(index: number): void {
    if (this.answered() || this.step() !== 'test' || this.testCategory() !== 'writing') return;
    const writer = this.writingWriters.get(index);
    if (!writer) return;
    const generation = this.writingGeneration;
    this.writingActiveIndex.set(index);
    this.writingActiveCharacterMistakes = 0;
    this.writingStatus.set(`Tulis karakter ke-${index + 1} sesuai urutan goresan.`);
    void writer.quiz({
      leniency: 1.15,
      showHintAfterMisses: 2,
      highlightOnComplete: true,
      onCorrectStroke: (stroke) => {
        if (generation !== this.writingGeneration || this.answered()) return;
        if (stroke.strokeNum === 0) {
          this.writingStrokeCounts.set(index, stroke.strokesRemaining + 1);
          this.writingStrokeTotal.set([...this.writingStrokeCounts.values()].reduce((sum, count) => sum + count, 0));
        }
        this.writingStatus.set(`Goresan benar. Sisa ${stroke.strokesRemaining} goresan.`);
        if (!stroke.strokesRemaining) this.writingStatus.set(`Karakter ke-${index + 1} selesai.`);
      },
      onMistake: (stroke) => {
        if (generation !== this.writingGeneration || this.answered()) return;
        this.writingActiveCharacterMistakes = stroke.totalMistakes;
        this.writingMistakes.set(this.writingMistakesBeforeCharacter + stroke.totalMistakes);
        this.writingStatus.set(this.posttestMode ? 'Goresan belum sesuai. Lanjutkan tulisanmu.' : 'Urutan goresannya belum tepat. Coba ikuti arah goresan yang disorot.');
      },
      onComplete: (result) => {
        if (generation === this.writingGeneration) this.completeWritingCharacter(index, result.totalMistakes);
      },
    });
  }

  private completeWritingCharacter(index: number, totalMistakes: number): void {
    if (this.answered()) return;
    this.writingActiveCharacterMistakes = totalMistakes;
    this.writingMistakesBeforeCharacter += totalMistakes;
    this.writingMistakes.set(this.writingMistakesBeforeCharacter);
    this.writingCompleted.update((value) => {
      const next = new Set(value);
      next.add(index);
      return next;
    });
    const nextIndex = index + 1;
    if (nextIndex < this.writingCharacters().length) {
      const generation = this.writingGeneration;
      window.setTimeout(() => {
        if (generation === this.writingGeneration) this.startWritingCharacter(nextIndex);
      }, 350);
      return;
    }
    if (this.answered()) return;
    if (this.posttestMode) {
      const totalStrokes = [...this.writingStrokeCounts.values()].reduce((sum, count) => sum + count, 0);
      const mistakes = this.writingMistakes();
      const earnedScore = totalStrokes > 0 ? Math.max(0, 1 - mistakes / totalStrokes) : 0;
      void this.recordPosttestAnswer(earnedScore === 1, this.testCard()?.hanzi ?? '', false, earnedScore);
      return;
    }
    const totalStrokes = [...this.writingStrokeCounts.values()].reduce((sum, count) => sum + count, 0);
    const basePoint = this.data.writingScore(this.writingMistakes(), totalStrokes);
    const points = this.learning.previewPracticeReward(this.testQuestion()?.id ?? '', basePoint, basePoint > 0);
    this.queuePracticeAnswer(basePoint > 0, basePoint, points, this.testCard()?.hanzi ?? '');
    this.playCorrectChime();
    this.score.update((score) => score + points);
    this.answerCorrect.set(basePoint > 0);
    this.answered.set(true);
    this.feedback.set(`Mantap! Semua karakter selesai ditulis. Kamu dapat +${points} poin.`);
  }

  private resetQuestionState(): void {
    this.practiceAwardedPoint.set(0);
    this.speech.cancelRecognition();
    this.resetWritingPractice();
    this.answered.set(false);
    this.answerCorrect.set(false);
    this.practiceQuestionSkipped.set(false);
    this.selectedChoice.set(null);
    this.feedback.set('');
    this.recognizingSpeech.set(false);
    this.recognizedText.set('');
    this.recognitionConfidence.set(null);
    this.speechError.set('');
  }

  private resetWritingPractice(): void {
    this.writingGeneration += 1;
    this.writingWriters.forEach((writer) => writer.cancelQuiz());
    this.writingWriters.clear();
    this.writingActiveIndex.set(0);
    this.writingCompleted.set(new Set());
    this.writingMistakes.set(0);
    this.writingStrokeCounts.clear();
    this.writingStrokeTotal.set(0);
    this.writingMistakesBeforeCharacter = 0;
    this.writingActiveCharacterMistakes = 0;
    this.writingStatus.set('Ikuti urutan goresan pada kotak pertama.');
  }

  private testCategorySummary(): Partial<Record<QuestionCategory, number>> {
    return this.testPlan().reduce<Partial<Record<QuestionCategory, number>>>((summary, item) => {
      const category = item.category;
      summary[category] = (summary[category] ?? 0) + 1;
      return summary;
    }, {});
  }

  private choosePracticeAnchorIds(): Record<QuestionCategory, string> {
    const categories: QuestionCategory[] = ['reading', 'listening', 'speaking', 'writing'];
    const learnedIds = new Set(this.learnedCards().map(card => card.id));
    const unit = this.selectedUnit();
    const sourceWords = unit ? curriculumVocabularyOrder(unit.grade, unitChapter(unit) ?? 0) : undefined;
    const firstFiveWords = sourceWords?.slice(0, 5);
    const firstFiveCards = firstFiveWords
      ? firstFiveWords.map(word => this.cards().find(card => {
        const expectedForms = curriculumHanziForms(word).map(normalizeHanziOrder);
        return curriculumHanziForms(card.hanzi).some(form => expectedForms.includes(normalizeHanziOrder(form)));
      }))
      : this.cards().slice(0, 5);
    if (firstFiveCards.length < 5) throw new Error('Unit ini belum memiliki lima kosakata pertama untuk sesi penelitian.');
    if (firstFiveCards.some(card => !card)) {
      const missing = firstFiveWords?.filter((word, index) => !firstFiveCards[index]).join(', ');
      throw new Error(`Kosakata urutan sumber belum lengkap pada unit ini${missing ? `: ${missing}` : ''}. Hubungi guru untuk menyesuaikan materi.`);
    }
    const resolvedFirstFive = firstFiveCards as Flashcard[];
    if (resolvedFirstFive.some(card => !learnedIds.has(card.id))) {
      throw new Error('Pelajari dan tandai lima kosakata pertama pada unit ini sebelum memulai sesi penelitian.');
    }
    const questions = this.data.questions().filter(question => learnedIds.has(question.flashcardId));
    const anchorCards: Record<QuestionCategory, Flashcard> = {
      reading: resolvedFirstFive[0],
      listening: resolvedFirstFive[1],
      speaking: resolvedFirstFive[2],
      writing: resolvedFirstFive[3],
    };
    const anchors = {} as Record<QuestionCategory, string>;
    for (const category of categories) {
      const candidate = questions.find(question => question.category === category
        && question.flashcardId === anchorCards[category].id);
      if (!candidate) throw new Error(`Soal jangkar kategori ${category} belum tersedia untuk lima kosakata pertama unit ini.`);
      anchors[category] = candidate.id;
    }
    return anchors;
  }

  private createTestPlan(anchorQuestionIds: Record<QuestionCategory, string>): void {
    const categoryQuotas: Array<{ category: QuestionCategory; count: number }> = [
      { category: 'reading', count: 3 },
      { category: 'listening', count: 2 },
      { category: 'speaking', count: 3 },
      { category: 'writing', count: 2 },
    ];
    const plan: Array<{ card: Flashcard; category: QuestionCategory; questionId: string }> = [];
    const learnedIds = new Set(this.learnedCards().map((card) => card.id));
    const usedQuestionIds = new Set<string>();

    categoryQuotas.forEach(({ category, count }) => {
      const candidates = this.data.questions()
        .filter((question) => question.category === category && learnedIds.has(question.flashcardId))
        .filter((question) => !usedQuestionIds.has(question.id));
      const anchor = candidates.find(question => question.id === anchorQuestionIds[category]);
      if (!anchor) throw new Error(`Soal jangkar kategori ${category} tidak tersedia pada unit ini. Pelajari kembali materi terkait.`);
      const anchorCard = this.data.flashcards().find(item => item.id === anchor.flashcardId);
      if (!anchorCard) throw new Error(`Flashcard untuk soal jangkar kategori ${category} tidak ditemukan.`);
      plan.push({ card: anchorCard, category, questionId: anchor.id });
      usedQuestionIds.add(anchor.id);
      for (let index = 1; index < count; index += 1) {
        const selected = this.weightedQuestionPick(candidates.filter((question) => !usedQuestionIds.has(question.id)));
        if (!selected) break;
        usedQuestionIds.add(selected.id);
        const card = this.data.flashcards().find((item) => item.id === selected.flashcardId);
        if (card) plan.push({ card, category, questionId: selected.id });
      }
    });
    if (plan.length < 10) {
      const remaining = this.data.questions()
        .filter((question) => learnedIds.has(question.flashcardId) && !usedQuestionIds.has(question.id));
      while (plan.length < 10) {
        const selected = this.weightedQuestionPick(remaining.filter((question) => !usedQuestionIds.has(question.id)));
        if (!selected) break;
        usedQuestionIds.add(selected.id);
        const card = this.data.flashcards().find((item) => item.id === selected.flashcardId);
        if (card) plan.push({ card, category: selected.category, questionId: selected.id });
      }
    }
    this.testPlan.set(this.shuffle(plan));
  }

  private weightedQuestionPick<T extends { id: string }>(items: T[]): T | undefined {
    if (!items.length) return undefined;
    const totalWeight = items.reduce((sum, item) => sum + this.learning.questionWeight(item.id), 0);
    let target = Math.random() * totalWeight;
    for (const item of items) {
      target -= this.learning.questionWeight(item.id);
      if (target < 0) return item;
    }
    return items[items.length - 1];
  }

  private queuePracticeAnswer(correct: boolean, basePoint: number, awardedPoint: number, response: string, skipped = false): void {
    this.practiceAwardedPoint.set(awardedPoint);
    const question = this.testQuestion();
    const card = this.testCard();
    if (!question || !card || !this.practiceSessionId || !this.practiceSessionOrder) {
      this.practiceAnswerLogError.set('Catatan jawaban belum lengkap. Jawaban tidak dapat dilanjutkan sebelum tersimpan.');
      return;
    }
    this.pendingPracticeAnswer = {
      sessionId: this.practiceSessionId,
      sessionOrder: this.practiceSessionOrder,
      questionOrder: this.questionNumber(),
      questionId: question.id,
      flashcardId: card.id,
      unitId: this.selectedUnitId(),
      category: this.testCategory(),
      isAnchor: Object.values(this.practiceAnchorQuestionIds ?? {}).includes(question.id),
      correct,
      basePoint,
      awardedPoint,
      response, skipped, writingMistakes: this.writingMistakes(), writingStrokes: this.writingStrokeTotal(),
    };
    void this.persistPendingPracticeAnswer();
  }

  private async persistPendingPracticeAnswer(): Promise<void> {
    const pending = this.pendingPracticeAnswer;
    if (!pending || this.practiceAnswerSaving()) return;
    this.practiceAnswerSaving.set(true);
    this.practiceAnswerLogError.set('');
    try {
      const { awardedPoint, correct } = await this.learning.recordPracticeAnswer(pending);
      if (this.pendingPracticeAnswer === pending) {
        // The transaction is authoritative when another tab answered the same question.
        this.score.update(score => score + awardedPoint - pending.awardedPoint);
        this.practiceAwardedPoint.set(awardedPoint);
        this.answerCorrect.set(correct);
        this.feedback.set(correct ? `Jawaban tersimpan. Kamu mendapat +${awardedPoint} poin.` : 'Jawaban tersimpan dengan nilai 0.');
        this.pendingPracticeAnswer = null;
      }
    } catch {
      this.practiceAnswerLogError.set('Catatan jawaban belum tersimpan. Periksa koneksi, lalu coba simpan kembali.');
    } finally {
      this.practiceAnswerSaving.set(false);
      if (this.advanceAfterPracticeAnswerSave && !this.practiceAnswerLogError()) {
        this.advanceAfterPracticeAnswerSave = false;
        void this.nextQuestion();
      }
    }
  }

  protected retryPracticeAnswer(): void {
    if (!this.practiceAnswerSaving()) void this.persistPendingPracticeAnswer();
  }

  private shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }
}
