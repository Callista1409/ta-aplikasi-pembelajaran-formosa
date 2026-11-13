import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentDataService } from '../../core/services/content-data.service';
import { StudentLearningService } from './student-learning.service';
import { StudentCommentsService } from '../../core/services/student-comments.service';
import { UiSelectComponent } from '../../shared/ui-select.component';
import { MascotDisplayComponent } from './mascot-display.component';

@Component({
  selector: 'app-student-dashboard',
  imports: [RouterLink, UiSelectComponent, MascotDisplayComponent],
  templateUrl: './student-dashboard.component.html',
  styleUrl: './student-dashboard.component.scss',
})
export class StudentDashboardComponent {
  private readonly data = inject(ContentDataService);
  protected readonly learning = inject(StudentLearningService);
  protected readonly comments = inject(StudentCommentsService);
  protected readonly selectedYearId = signal(this.learning.currentYearId());
  protected readonly selectedMonthId = signal(this.learning.currentMonthId());
  protected readonly selectedWeekId = signal(this.learning.currentWeekStartId());
  protected readonly student = computed(() => this.data.students().find((item) => item.id === this.data.currentUserId()));
  protected readonly studentName = computed(() => this.student()?.displayName ?? 'Emily');
  protected readonly gradeLabel = computed(() => (this.student()?.grade ? `SD ${this.student()?.grade}` : 'SD -'));
  protected readonly yearOptions = computed(() => this.learning.yearOptions());
  protected readonly monthOptions = computed(() => this.learning.monthOptionsForYear(this.selectedYearId()));
  protected readonly weekOptions = computed(() => this.learning.weekOptionsForMonth(this.selectedMonthId()));
  protected readonly weeklyTrack = computed(() => this.learning.weeklyTrackFor(this.selectedWeekId()));
  protected readonly weeklyTotal = computed(() => this.learning.weeklyTotalFor(this.selectedWeekId()));
  protected readonly unreadComments = computed(() => this.comments.comments().filter((comment) => !comment.readAt));

  protected openComment(): void {
    // Murid dapat membaca komentar, tetapi hanya guru yang menandainya sebagai sudah dinot.
  }

  constructor() {
    effect(() => {
      const options = this.weekOptions();
      if (!options.some((option) => option.value === this.selectedWeekId())) {
        this.selectedWeekId.set(this.defaultWeekFor(this.selectedMonthId()));
      }
    });
  }

  protected changeYear(yearId: string): void {
    this.selectedYearId.set(yearId);
    const currentMonthId = this.learning.currentMonthId();
    const monthId = currentMonthId.startsWith(yearId) ? currentMonthId : `${yearId}-01`;
    this.selectedMonthId.set(monthId);
    this.selectedWeekId.set(this.defaultWeekFor(monthId));
  }

  protected changeMonth(monthId: string): void {
    this.selectedMonthId.set(monthId);
    this.selectedWeekId.set(this.defaultWeekFor(monthId));
  }

  protected changeWeek(weekId: string): void {
    this.selectedWeekId.set(weekId);
  }

  private defaultWeekFor(monthId: string): string {
    const options = this.learning.weekOptionsForMonth(monthId);
    const currentWeekStartId = this.learning.currentWeekStartId();
    return options.some((option) => option.value === currentWeekStartId) ? currentWeekStartId : options[0]?.value ?? currentWeekStartId;
  }

}
