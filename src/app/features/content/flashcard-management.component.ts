import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Flashcard, LearningUnit } from '../../core/models/content.models';
import { matchesVocabulary } from '../../core/content/vocabulary-search';
import { ContentDataService } from '../../core/services/content-data.service';
import { MediaUploadService } from '../../core/services/media-upload.service';
import { UiSelectComponent, UiSelectOption } from '../../shared/ui-select.component';

@Component({ selector: 'app-flashcard-management', imports: [FormsModule, UiSelectComponent], templateUrl: './flashcard-management.component.html', styleUrl: './flashcard-management.component.scss' })
export class FlashcardManagementComponent {
  protected readonly data = inject(ContentDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly mediaUpload = inject(MediaUploadService);
  protected readonly adminMode = this.route.snapshot.data['adminMode'] as boolean;
  protected readonly search = signal('');
  protected readonly grade = signal('all');
  protected readonly unitId = signal('all');
  protected readonly ownerId = signal('all');
  protected readonly formGrade = signal('1');
  protected readonly formOpen = signal(false);
  protected readonly readerOpen = signal<Flashcard | null>(null);
  protected readonly pendingDelete = signal<Flashcard | null>(null);
  protected readonly imagePreview = signal<string | null>(null);
  protected readonly imageName = signal('Belum ada gambar dipilih');
  protected readonly mediaError = signal('');
  protected readonly saving = signal(false);
  protected readonly openUnits = signal<Set<string>>(new Set());
  protected editingId = '';
  protected form: Flashcard = this.emptyCard();
  private pendingImage: File | null = null;
  private localPreviewUrl = '';
  constructor() {
    void this.data.loadAllFlashcards().catch(error => console.error('Gagal memuat flashcard:', error));
    void this.data.loadAllQuestions().catch(error => console.error('Gagal memuat bank soal:', error));
  }
  protected readonly levels = [1, 2, 3, 4, 5, 6];
  protected readonly gradeOptions: UiSelectOption[] = [
    { label: 'Semua kelas', value: 'all' },
    ...this.levels.map((level) => ({ label: `SD ${level}`, value: String(level) })),
  ];
  protected readonly formGradeOptions: UiSelectOption[] = this.levels.map((level) => ({ label: `SD ${level}`, value: String(level) }));
  protected readonly unitOptions = computed<UiSelectOption[]>(() => {
    const selectedGrade = this.grade();
    const units = this.unitsForGrade(selectedGrade);
    return [
      { label: 'Semua kategori bab', value: 'all' },
      ...units.map((unit) => ({
        label: selectedGrade === 'all' ? `SD ${unit.grade} - ${this.unitDisplayName(unit)}` : this.unitDisplayName(unit),
        value: unit.id,
      })),
    ];
  });
  protected readonly formUnitOptions = computed<UiSelectOption[]>(() => {
    return this.unitsForGrade(this.formGrade()).map((unit) => ({ label: this.unitDisplayName(unit), value: unit.id }));
  });
  protected readonly ownerOptions = computed<UiSelectOption[]>(() => [
    { label: 'Semua user', value: 'all' },
    ...this.data.teachers().map((teacher) => ({ label: teacher.displayName, value: teacher.id })),
  ]);

  protected readonly visibleUnits = computed(() => this.data.units()
    .filter((unit) => this.grade() === 'all' || String(unit.grade) === this.grade())
    .filter((unit) => this.unitId() === 'all' || unit.id === this.unitId())
    .filter((unit) => !this.search().trim() || this.cardsInUnit(unit.id).length > 0));
  protected readonly totalFiltered = computed(() => this.visibleUnits().reduce((total, unit) => total + this.cardsInUnit(unit.id).length, 0));

  protected changeGrade(value: string): void {
    this.grade.set(value);
    if (this.unitId() === 'all') return;
    const unitStillAvailable = this.unitsForGrade(value).some((unit) => unit.id === this.unitId());
    if (!unitStillAvailable) this.unitId.set('all');
  }
  protected changeUnit(value: string): void { this.unitId.set(value); }
  protected changeOwner(value: string): void { this.ownerId.set(value); }
  protected changeFormGrade(value: string): void {
    if (!this.formGradeOptions.some((option) => option.value === value)) return;
    this.formGrade.set(value);
    const units = this.unitsForGrade(value);
    if (!units.some((unit) => unit.id === this.form.unitId)) this.form.unitId = units[0]?.id ?? '';
  }
  protected changeFormUnit(value: string): void {
    if (this.unitsForGrade(this.formGrade()).some((unit) => unit.id === value)) this.form.unitId = value;
  }
  protected isUnitOpen(id: string): boolean { return !!this.search().trim() || this.openUnits().has(id); }
  protected toggleUnit(id: string): void {
    this.openUnits.update((value) => {
      const next = new Set(value);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  protected cardsInUnit(id: string): Flashcard[] {
    return this.data.flashcards().filter((card) =>
      card.unitId === id
      && matchesVocabulary(card, this.search())
      && (this.ownerId() === 'all' || card.createdBy === this.ownerId()),
    );
  }
  protected gradeCount(level: number): number {
    const unitIds = this.data.units().filter((unit) => unit.grade === level).map((unit) => unit.id);
    return this.data.flashcards().filter((card) => unitIds.includes(card.unitId)).length;
  }
  protected openCreate(): void {
    this.resetMedia();
    this.editingId = '';
    this.form = this.emptyCard();
    this.formGrade.set(String(this.data.units().find((unit) => unit.id === this.form.unitId)?.grade ?? (this.grade() === 'all' ? 1 : Number(this.grade()))));
    this.formOpen.set(true);
  }
  protected openRead(card: Flashcard): void { this.readerOpen.set(card); }
  protected openEdit(card: Flashcard): void { this.readerOpen.set(null); this.resetMedia(); this.editingId = card.id; this.form = { ...card }; this.formGrade.set(String(this.unitGrade(card.unitId))); this.imagePreview.set(card.imageUrl ?? null); this.imageName.set(card.imageUrl ? 'Gambar tersimpan' : 'Belum ada gambar dipilih'); this.formOpen.set(true); }
  protected canEdit(card: Flashcard): boolean { return this.adminMode || card.createdBy === this.data.currentUserId(); }
  protected unitName(id: string): string {
    const unit = this.data.units().find((item) => item.id === id);
    return unit ? this.unitDisplayName(unit) : '-';
  }
  protected unitDisplayName(unit: LearningUnit): string { return unit.name.replace(/^\s*Pelajaran\s+\d+\s*:\s*/i, '').trim() || unit.name; }
  protected unitGrade(id: string): number { return this.data.units().find((unit) => unit.id === id)?.grade ?? 0; }
  protected questionCount(id: string): number { return this.data.questions().filter((question) => question.flashcardId === id).length; }

  protected selectImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.mediaError.set('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.mediaError.set('Gunakan gambar JPG, PNG, atau WebP.');
      input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.mediaError.set('Ukuran gambar maksimal 5 MB.');
      input.value = '';
      return;
    }
    if (this.localPreviewUrl) URL.revokeObjectURL(this.localPreviewUrl);
    this.localPreviewUrl = URL.createObjectURL(file);
    this.pendingImage = file;
    this.imagePreview.set(this.localPreviewUrl);
    this.imageName.set(file.name);
  }

  protected closeForm(): void {
    this.resetMedia();
    this.formOpen.set(false);
  }

  protected async save(): Promise<void> {
    if (!this.form.hanzi.trim() || !this.unitsForGrade(this.formGrade()).some((unit) => unit.id === this.form.unitId)) return;
    this.saving.set(true);
    this.mediaError.set('');
    try {
      let imageUrl = this.form.imageUrl;
      let imagePublicId = this.form.imagePublicId;
      if (this.pendingImage) {
        const uploaded = await this.mediaUpload.uploadFlashcardImage(this.pendingImage);
        imageUrl = uploaded.url;
        imagePublicId = uploaded.publicId;
      }
      await this.data.saveFlashcard({ ...this.form, imageUrl, imagePublicId, audioMode: 'tts', ttsText: this.form.hanzi.trim(), id: this.editingId || `fc-${Date.now()}`, createdBy: this.editingId ? this.form.createdBy : this.data.currentUserId() });
      this.closeForm();
    } catch (error) {
      this.mediaError.set(error instanceof Error ? error.message : 'Gagal menyimpan flashcard.');
    } finally {
      this.saving.set(false);
    }
  }

  protected confirmDelete(): void { const card = this.pendingDelete(); if (card) this.data.deleteFlashcard(card.id); this.pendingDelete.set(null); }
  private unitsForGrade(grade: string) { return this.data.units().filter((unit) => grade === 'all' || String(unit.grade) === grade); }
  private resetMedia(): void { if (this.localPreviewUrl) URL.revokeObjectURL(this.localPreviewUrl); this.localPreviewUrl = ''; this.pendingImage = null; this.imagePreview.set(null); this.imageName.set('Belum ada gambar dipilih'); this.mediaError.set(''); }
  private defaultUnitId(): string {
    const selectedUnit = this.data.units().find((unit) => unit.id === this.unitId() && (this.grade() === 'all' || String(unit.grade) === this.grade()));
    if (selectedUnit) return selectedUnit.id;
    return (this.grade() === 'all' ? this.data.units() : this.unitsForGrade(this.grade()))[0]?.id ?? this.data.units()[0]?.id ?? '';
  }
  private emptyCard(): Flashcard { return { id: '', unitId: this.defaultUnitId(), hanzi: '', pinyin: '', meaning: '', audioMode: 'tts', createdBy: this.data.currentUserId() }; }
}
