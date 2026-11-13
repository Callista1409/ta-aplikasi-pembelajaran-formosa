import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LearningUnit } from '../../core/models/content.models';
import { ContentDataService } from '../../core/services/content-data.service';

@Component({
  selector: 'app-unit-management',
  imports: [FormsModule],
  templateUrl: './unit-management.component.html',
  styleUrl: './unit-management.component.scss',
})
export class UnitManagementComponent {
  protected readonly data = inject(ContentDataService);
  protected readonly formOpen = signal(false);
  protected readonly saveError = signal('');
  protected readonly saving = signal(false);
  protected readonly selectedUnitId = signal<string | null>(null);
  protected readonly pendingDelete = signal<LearningUnit | null>(null);
  protected editingId = '';
  protected form: LearningUnit = this.emptyUnit();
  protected readonly levels = [1, 2, 3, 4, 5, 6];
  constructor() {
    void this.data.loadAllFlashcards().catch(error => console.error('Gagal memuat flashcard:', error));
    void this.data.loadAllQuestions().catch(error => console.error('Gagal memuat bank soal:', error));
  }
  protected readonly selectedUnit = computed(() => this.data.units().find((unit) => unit.id === this.selectedUnitId()) ?? null);
  protected readonly selectedFlashcards = computed(() => this.data.flashcards().filter((card) => card.unitId === this.selectedUnitId()));

  protected unitsAtGrade(grade: number): LearningUnit[] {
    return this.data.units().filter((unit) => unit.grade === grade);
  }

  protected countFlashcards(unitId: string): number {
    return this.data.flashcards().filter((card) => card.unitId === unitId).length;
  }

  protected countQuestions(unitId: string): number {
    const ids = this.data.flashcards().filter((card) => card.unitId === unitId).map((card) => card.id);
    return this.data.questions().filter((question) => ids.includes(question.flashcardId)).length;
  }

  protected openCreate(): void {
    this.editingId = '';
    this.form = this.emptyUnit();
    this.saveError.set('');
    this.formOpen.set(true);
  }

  protected openEdit(unit: LearningUnit, event: Event): void {
    event.stopPropagation();
    this.editingId = unit.id;
    this.form = { ...unit };
    this.saveError.set('');
    this.formOpen.set(true);
  }

  protected async save(): Promise<void> {
    const name = this.form.name.trim();
    if (!name) return;

    this.saveError.set('');
    this.saving.set(true);
    try {
      await this.data.saveUnit({
        ...this.form,
        id: this.editingId || `unit-${Date.now()}`,
        name,
        grade: Number(this.form.grade),
      });
      this.formOpen.set(false);
    } catch (error) {
      console.error('Gagal menyimpan unit:', error);
      this.saveError.set('Unit gagal disimpan. Periksa koneksi atau izin akun admin, lalu coba lagi.');
    } finally {
      this.saving.set(false);
    }
  }

  protected confirmDelete(): void {
    const unit = this.pendingDelete();
    if (unit) this.data.deleteUnit(unit.id);
    this.pendingDelete.set(null);
  }

  private emptyUnit(): LearningUnit {
    return { id: '', grade: 1, name: '', description: '' };
  }
}
