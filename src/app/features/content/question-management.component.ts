import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Question, QuestionCategory } from '../../core/models/content.models';
import { matchesVocabulary } from '../../core/content/vocabulary-search';
import { ContentDataService } from '../../core/services/content-data.service';
import { UiSelectComponent, UiSelectOption } from '../../shared/ui-select.component';

@Component({ selector: 'app-question-management', imports: [FormsModule, UiSelectComponent], templateUrl: './question-management.component.html', styleUrl: './question-management.component.scss' })
export class QuestionManagementComponent {
  protected readonly data = inject(ContentDataService);
  private readonly route = inject(ActivatedRoute);
  protected readonly adminMode = this.route.snapshot.data['adminMode'] as boolean;
  protected readonly levels = [1, 2, 3, 4, 5, 6];
  protected readonly search = signal('');
  protected readonly grade = signal('all');
  protected readonly unitId = signal('all');
  protected readonly ownerId = signal('all');
  protected readonly category = signal('all');
  protected readonly builderOpen = signal(false);
  protected readonly flashcardSearchInput = signal('');
  protected readonly flashcardSearch = signal('');
  protected readonly readerOpen = signal<Question | null>(null);
  protected readonly pendingDelete = signal<Question | null>(null);
  protected readonly openUnits = signal<Set<string>>(new Set(['salutation']));
  protected editingId = '';
  protected optionA = '';
  protected optionB = '';
  protected optionC = '';
  protected optionD = '';
  protected correctOption: 'A' | 'B' | 'C' | 'D' = 'A';
  protected form: Question = this.emptyQuestion();
  protected readonly categories: QuestionCategory[] = ['writing', 'listening', 'speaking', 'reading'];

  constructor() {
    void this.data.loadAllFlashcards().catch(error => console.error('Gagal memuat flashcard:', error));
    void this.data.loadAllQuestions().catch(error => console.error('Gagal memuat bank soal:', error));
  }

  protected readonly visibleUnits = computed(() => this.data.units()
    .filter((unit) => this.grade() === 'all' || String(unit.grade) === this.grade())
    .filter((unit) => this.unitId() === 'all' || unit.id === this.unitId())
    .filter((unit) => !this.search().trim() || this.cardsInUnit(unit.id).length > 0));
  protected readonly totalFiltered = computed(() =>
    this.visibleUnits().reduce(
      (unitTotal, unit) =>
        unitTotal + this.cardsInUnit(unit.id).reduce((cardTotal, card) => cardTotal + this.questionsForCard(card.id).length, 0),
      0,
    ),
  );
  protected readonly gradeOptions: UiSelectOption[] = [
    { label: 'Semua level', value: 'all' },
    ...this.levels.map((level) => ({ label: `SD ${level}`, value: String(level) })),
  ];
  protected readonly unitOptions = computed<UiSelectOption[]>(() => {
    const selectedGrade = this.grade();
    const units = this.data.units().filter((unit) => selectedGrade === 'all' || String(unit.grade) === selectedGrade);
    return [
      { label: 'Semua unit', value: 'all' },
      ...units.map((unit) => ({
        label: selectedGrade === 'all' ? `SD ${unit.grade} - ${unit.name}` : unit.name,
        value: unit.id,
      })),
    ];
  });
  protected readonly ownerOptions = computed<UiSelectOption[]>(() => [
    { label: 'Semua user', value: 'all' },
    ...this.data.teachers().map((teacher) => ({ label: teacher.displayName, value: teacher.id })),
  ]);
  protected readonly categoryOptions: UiSelectOption[] = [
    { label: 'Semua kategori', value: 'all' },
    ...this.categories.map((item) => ({ label: this.categoryLabel(item), value: item })),
  ];
  protected readonly flashcardOptions = computed<UiSelectOption[]>(() =>
    this.flashcardsForCurrentScope().filter((card) => matchesVocabulary(card, this.flashcardSearch())).map((card) => {
      const unit = this.data.units().find((item) => item.id === card.unitId);
      return { label: `${unit ? `SD ${unit.grade} - ${unit.name} | ` : ''}${card.hanzi} - ${card.meaning}`, value: card.id };
    }),
  );

  protected cardsInUnit(id: string) { return this.data.flashcards().filter((card) => card.unitId === id && matchesVocabulary(card, this.search())); }
  protected isUnitOpen(id: string): boolean { return !!this.search().trim() || this.openUnits().has(id); }
  protected questionsForCard(id: string) { return this.data.questions().filter((q) => q.flashcardId === id && this.matchesQuestion(q)); }
  protected gradeCount(level: number): number { const cardIds = this.data.flashcards().filter((card) => this.data.units().find((unit) => unit.id === card.unitId)?.grade === level).map((card) => card.id); return this.data.questions().filter((q) => cardIds.includes(q.flashcardId)).length; }
  protected categoryCount(level: number, category: QuestionCategory): number { const cardIds = this.data.flashcards().filter((card) => this.data.units().find((unit) => unit.id === card.unitId)?.grade === level).map((card) => card.id); return this.data.questions().filter((q) => cardIds.includes(q.flashcardId) && q.category === category).length; }
  protected canEdit(q: Question): boolean { return this.adminMode || q.createdBy === this.data.currentUserId(); }
  protected categoryLabel(category: QuestionCategory): string { return category.charAt(0).toUpperCase() + category.slice(1); }
  protected usesMultipleChoice(category: QuestionCategory): boolean { return category === 'listening' || category === 'reading'; }
  protected toggleUnit(id: string): void { this.openUnits.update((value) => { const next = new Set(value); next.has(id) ? next.delete(id) : next.add(id); return next; }); }

  protected changeGrade(value: string): void {
    this.grade.set(value);
    const selectedUnit = this.unitId();
    if (selectedUnit === 'all') return;
    const unitStillAvailable = this.data.units().some((unit) => unit.id === selectedUnit && (value === 'all' || String(unit.grade) === value));
    if (!unitStillAvailable) this.unitId.set('all');
  }

  protected changeUnit(value: string): void { this.unitId.set(value); }
  protected changeOwner(value: string): void { this.ownerId.set(value); }
  protected changeCategoryFilter(value: string): void { this.category.set(this.isQuestionCategory(value) ? value : 'all'); }

  protected openCreate(): void { this.resetFlashcardSearch(); this.editingId = ''; this.form = this.emptyQuestion(); this.resetOptions(); this.builderOpen.set(true); }
  protected openCreateForCard(id: string): void { this.openCreate(); this.form.flashcardId = id; this.fillDefaultAnswerFromFlashcard(); }
  protected openRead(question: Question): void { this.readerOpen.set(question); }
  protected openEdit(question: Question): void {
    this.resetFlashcardSearch();
    this.readerOpen.set(null);
    this.editingId = question.id;
    this.form = { ...question, maximumPoint: this.systemPoint(question.category) };
    [this.optionA, this.optionB, this.optionC, this.optionD] = question.options ?? ['', '', '', ''];
    this.correctOption = question.correctOption ?? this.optionLetterForAnswer(question);
    this.fillDefaultAnswerFromFlashcard();
    this.builderOpen.set(true);
  }

  protected changeCategory(category: string): void {
    if (!this.isQuestionCategory(category)) return;
    this.form.category = category;
    this.form.maximumPoint = this.systemPoint(category);
    this.fillDefaultAnswerFromFlashcard();
  }

  protected changeFlashcard(id: string): void {
    this.form.flashcardId = id;
    this.fillDefaultAnswerFromFlashcard();
  }

  protected searchFlashcards(): void {
    this.flashcardSearch.set(this.flashcardSearchInput().trim());
  }

  private resetFlashcardSearch(): void {
    this.flashcardSearchInput.set('');
    this.flashcardSearch.set('');
  }

  protected async save(): Promise<void> {
    if (!this.form.flashcardId || !this.form.prompt.trim()) return;
    const maximumPoint = this.systemPoint(this.form.category);
    const options = this.usesMultipleChoice(this.form.category) ? [this.optionA, this.optionB, this.optionC, this.optionD] : undefined;
    const correctAnswer = this.usesMultipleChoice(this.form.category) ? this.optionValue(this.correctOption) : this.autoCorrectAnswer();
    if (!correctAnswer.trim()) return;
    await this.data.saveQuestion({
      ...this.form,
      correctAnswer,
      correctOption: this.usesMultipleChoice(this.form.category) ? this.correctOption : undefined,
      createdBy: this.editingId ? this.form.createdBy : this.data.currentUserId(),
      id: this.editingId || `q-${Date.now()}`,
      maximumPoint,
      options,
    });
    this.builderOpen.set(false);
  }

  protected confirmDelete(): void { const q = this.pendingDelete(); if (q) this.data.deleteQuestion(q.id); this.pendingDelete.set(null); }
  protected systemPoint(category: QuestionCategory): number { return this.data.pointForCategory(category); }
  protected optionValue(letter: 'A' | 'B' | 'C' | 'D'): string {
    return { A: this.optionA, B: this.optionB, C: this.optionC, D: this.optionD }[letter] ?? '';
  }
  protected changeCorrectOption(value: string): void {
    if (value === 'A' || value === 'B' || value === 'C' || value === 'D') this.correctOption = value;
  }
  protected answerOptionOptions(): UiSelectOption[] {
    return [
      { label: `A - ${this.optionA || 'Pilihan A belum diisi'}`, value: 'A' },
      { label: `B - ${this.optionB || 'Pilihan B belum diisi'}`, value: 'B' },
      { label: `C - ${this.optionC || 'Pilihan C belum diisi'}`, value: 'C' },
      { label: `D - ${this.optionD || 'Pilihan D belum diisi'}`, value: 'D' },
    ];
  }
  protected optionRows(question: Question): Array<{ letter: 'A' | 'B' | 'C' | 'D'; value: string }> {
    const options = question.options ?? [];
    return (['A', 'B', 'C', 'D'] as const).map((letter, index) => ({ letter, value: options[index] ?? '' })).filter((item) => item.value);
  }
  protected correctAnswerLabel(question: Question): string {
    if (!this.usesMultipleChoice(question.category)) return question.correctAnswer;
    const letter = question.correctOption ?? this.optionLetterForAnswer(question);
    const value = this.optionRows(question).find((item) => item.letter === letter)?.value ?? question.correctAnswer;
    return `${letter}. ${value}`;
  }
  protected selectedFlashcardLabel(question: Question): string {
    const card = this.data.flashcards().find((item) => item.id === question.flashcardId);
    return card ? `${card.hanzi} - ${card.meaning}` : question.flashcardId;
  }
  protected audioTextLabel(question: Question): string {
    const card = this.data.flashcards().find((item) => item.id === question.flashcardId);
    return question.audioText || card?.hanzi || '-';
  }

  private matchesQuestion(q: Question): boolean { return (this.ownerId() === 'all' || q.createdBy === this.ownerId()) && (this.category() === 'all' || q.category === this.category()); }
  private isQuestionCategory(value: string): value is QuestionCategory {
    return value === 'writing' || value === 'listening' || value === 'speaking' || value === 'reading';
  }
  private resetOptions(): void { this.optionA = ''; this.optionB = ''; this.optionC = ''; this.optionD = ''; this.correctOption = 'A'; }
  private flashcardsForCurrentScope(includeSelected = true) {
    const grade = this.grade();
    const unitId = this.unitId();
    const scopedCards = this.data.flashcards().filter((card) => {
      const unit = this.data.units().find((item) => item.id === card.unitId);
      return (grade === 'all' || String(unit?.grade) === grade) && (unitId === 'all' || card.unitId === unitId);
    });
    const selectedCard = includeSelected && this.form?.flashcardId
      ? this.data.flashcards().find((card) => card.id === this.form.flashcardId)
      : undefined;
    return includeSelected && selectedCard && !scopedCards.some((card) => card.id === selectedCard.id) ? [selectedCard, ...scopedCards] : scopedCards;
  }
  private emptyQuestion(): Question {
    const category: QuestionCategory = 'writing';
    return { id: '', flashcardId: this.flashcardsForCurrentScope(false)[0]?.id ?? this.data.flashcards()[0]?.id ?? '', category, prompt: '', correctAnswer: '', maximumPoint: this.systemPoint(category), createdBy: this.data.currentUserId() };
  }
  private optionLetterForAnswer(question: Question): 'A' | 'B' | 'C' | 'D' {
    const letters = ['A', 'B', 'C', 'D'] as const;
    const exactIndex = (question.options ?? []).findIndex((option) => option === question.correctAnswer);
    if (exactIndex >= 0) return letters[exactIndex];
    const normalized = question.correctAnswer.trim().toUpperCase();
    return letters.find((letter) => letter === normalized) ?? 'A';
  }
  private autoCorrectAnswer(): string {
    const card = this.data.flashcards().find((item) => item.id === this.form.flashcardId);
    return card?.hanzi ?? this.form.correctAnswer;
  }
  private fillDefaultAnswerFromFlashcard(): void {
    if (this.usesMultipleChoice(this.form.category)) return;
    this.form.correctAnswer = this.autoCorrectAnswer();
  }
}
