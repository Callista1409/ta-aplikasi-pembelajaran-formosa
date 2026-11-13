import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { AppUser } from '../../core/models/content.models';
import { ContentDataService } from '../../core/services/content-data.service';
import { AuthService } from '../../core/services/auth.service';
import { AdminApiService, DashboardReportRow } from '../../core/services/admin-api.service';


interface StudentProgressBar {
  id: string;
  label: string;
  gradeLabel: string;
  learnedCount: number;
  points: number;
  questionCount: number;
  height: number;
}

interface StudentSummary {
  id: string;
  name: string;
  grade: number;
  totalPoints: number;
  monthlyPoints: number;
  periodPoints: number;
  weeklyPoints: number;
  learnedCount: number;
  questionCount: number;
}

@Component({
  selector: 'app-teacher-dashboard',
  imports: [],
  templateUrl: './teacher-dashboard.component.html',
  styleUrl: './teacher-dashboard.component.scss',
})
export class TeacherDashboardComponent implements OnDestroy {
  protected readonly data = inject(ContentDataService);
  private readonly adminApi = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  protected readonly selectedStudentId = signal('');
  protected readonly startDateId = signal(this.firstDayOfCurrentMonth());
  protected readonly endDateId = signal(this.todayId());
  protected readonly reportRows = signal<Record<string, DashboardReportRow>>({});
  protected readonly refreshVersion = signal(0);
  protected readonly reportLoading = signal(false);
  protected readonly reportUpdated = signal('');
  protected readonly dataWarning = signal('');

  private readonly unsubscribers: Array<() => void> = [];

  protected readonly students = computed(() =>
    [...this.data.students()].sort((a, b) => Number(a.grade ?? 0) - Number(b.grade ?? 0) || a.displayName.localeCompare(b.displayName)),
  );

  protected readonly summaries = computed<StudentSummary[]>(() =>
    this.students().map((student) => this.buildStudentSummary(student)),
  );

  protected readonly selectedStudent = computed(() =>
    this.students().find((student) => student.id === this.selectedStudentId()) ?? this.students()[0],
  );

  protected readonly selectedSummary = computed(() => {
    const student = this.selectedStudent();
    return student ? this.buildStudentSummary(student) : null;
  });

  protected readonly studentProgressBars = computed<StudentProgressBar[]>(() => {
    const summaries = [...this.summaries()].sort((a, b) => b.periodPoints - a.periodPoints || a.name.localeCompare(b.name));
    const max = Math.max(0, ...summaries.map((student) => student.periodPoints));
    return summaries.map((student) => ({
      id: student.id,
      gradeLabel: `SD ${student.grade || '-'}`,
      height: max ? Math.max(8, Math.round((student.periodPoints / max) * 100)) : 0,
      label: student.name,
      learnedCount: student.learnedCount,
      points: student.periodPoints,
      questionCount: student.questionCount,
    }));
  });

  protected readonly stats = computed(() => [
    { label: 'Jumlah Siswa', value: String(this.students().length), description: 'Data dapat dilihat' },
    {
      label: 'Flashcard Saya',
      value: String(this.data.dashboardCounts()[this.auth.profile()?.uid ?? '']?.flashcards ?? '…'),
      description: 'Dibuat oleh Anda',
    },
    {
      label: 'Soal Saya',
      value: String(this.data.dashboardCounts()[this.auth.profile()?.uid ?? '']?.questions ?? '…'),
      description: 'Writing, Listening, Speaking, Reading',
    },
    {
      label: 'Poin Periode',
      value: String(this.summaries().reduce((sum, student) => sum + student.periodPoints, 0)),
      description: 'Total pada rentang tanggal pilihan',
    },
  ]);

  protected readonly periodStudentTotal = computed(() => this.summaries().reduce((sum, student) => sum + student.periodPoints, 0));
  protected readonly dateRangeLabel = computed(() => this.formatDateRange(this.startDateId(), this.endDateId()));

  constructor() {
    let lastRefresh = 0;
    effect(() => {
      const uid = this.auth.profile()?.uid;
      if (uid) void this.data.loadDashboardCounts(uid).catch(() => this.dataWarning.set('Ringkasan konten belum dapat dimuat.'));
    });
    effect((onCleanup) => {
      const start = this.startDateId(), end = this.endDateId();
      const ids = this.students().map(student => student.id);
      const version = this.refreshVersion();
      const refresh = version !== lastRefresh; lastRefresh = version;
      let active = true;
      onCleanup(() => { active = false; });
      untracked(() => {
        this.reportRows.set({}); this.reportLoading.set(true);
        void this.adminApi.getDashboardReport('activity', start, end, ids, refresh, true)
          .then(report => { if (active) {
            this.reportRows.set(report.rows);
            this.reportUpdated.set(new Date(report.generatedAt).toLocaleTimeString());
            this.dataWarning.set('');
          } }).catch(() => { if (active) this.dataWarning.set('Ringkasan aktivitas belum dapat dimuat. Tekan Perbarui laporan untuk mencoba lagi.'); })
          .finally(() => { if (active) this.reportLoading.set(false); });
      });
    });
    effect(() => {
      const students = this.students();
      if (!students.length || this.selectedStudentId()) return;
      queueMicrotask(() => this.selectedStudentId.set(students[0].id));
    });
  }

  ngOnDestroy(): void { this.unsubscribers.forEach(stop => stop()); }
  protected selectStudent(id: string): void { this.selectedStudentId.set(id); }
  protected changeStartDate(id: string): void {
    if (!id) return;
    this.startDateId.set(id); if (id > this.endDateId()) this.endDateId.set(id);
  }
  protected changeEndDate(id: string): void {
    if (!id) return;
    this.endDateId.set(id); if (id < this.startDateId()) this.startDateId.set(id);
  }
  protected refreshReports(): void { this.dataWarning.set(''); this.refreshVersion.update(value => value + 1); }
  protected gradeLabel(student?: AppUser): string { return 'SD ' + (student?.grade ?? '-'); }

  private buildStudentSummary(student: AppUser): StudentSummary {
    const row = this.reportRows()[student.id];
    const periodPoints = row?.pointEarned ?? 0;
    return { id: student.id, grade: Number(student.grade ?? 0), name: student.displayName,
      learnedCount: row?.learnedCount ?? 0, questionCount: row?.questionCount ?? 0,
      monthlyPoints: periodPoints, periodPoints, weeklyPoints: periodPoints, totalPoints: row?.totalPoints ?? 0 };
  }
  private dateId(date: Date): string {
    return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
  }
  private firstDayOfCurrentMonth(): string {
    const now = new Date(); return this.dateId(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  private todayId(): string { return this.dateId(new Date()); }
  private formatDateRange(start: string, end: string): string {
    const format = (id: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(id+'T12:00:00'));
    return format(start) + ' – ' + format(end);
  }
}
