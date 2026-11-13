import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AdminApiService, AuthRosterResponse } from '../../core/services/admin-api.service';
import { ContentDataService } from '../../core/services/content-data.service';

interface AdminActivityLog {
  studentId: string;
  pointEarned: number;
}

interface StudentPointBar {
  id: string;
  name: string;
  grade: number;
  points: number;
  height: number;
}

interface TeacherProductionBar {
  id: string;
  label: string;
  flashcards: number;
  flashcardHeight: number;
  questions: number;
  questionHeight: number;
  total: number;
}

@Component({
  selector: 'app-admin-dashboard',
  imports: [],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss',
})
export class AdminDashboardComponent implements OnDestroy {
  private readonly router = inject(Router);
  private readonly adminApi = inject(AdminApiService);
  protected readonly data = inject(ContentDataService);
  protected readonly studentStartDateId = signal(this.dateId(this.startOfMonth(new Date())));
  protected readonly studentEndDateId = signal(this.dateId(new Date()));
  protected readonly contentStartDateId = signal(this.dateId(this.startOfMonth(new Date())));
  protected readonly contentEndDateId = signal(this.dateId(new Date()));
  protected readonly dataWarning = signal('');
  protected readonly activityLogs = signal<AdminActivityLog[]>([]);
  private readonly authIdentities = signal<AuthRosterResponse>({ students: [], teachers: [] });
  protected readonly authRoster = computed<AuthRosterResponse>(() => {
    const profiles = new Map(this.data.users().map(user => [user.id, user]));
    const enrich = (entries: AuthRosterResponse['students']) => entries.map(entry => {
      const profile = profiles.get(entry.id);
      return { ...entry, displayName: profile?.displayName || entry.displayName, grade: profile?.grade ?? entry.grade };
    });
    return { students: enrich(this.authIdentities().students), teachers: enrich(this.authIdentities().teachers) };
  });
  protected readonly refreshVersion = signal(0);
  protected readonly reportLoading = signal(false);
  protected readonly reportUpdated = signal('');
  private pendingReports = 0;
  protected readonly authRosterLoading = signal(true);
  protected readonly authRosterError = signal(false);

  private readonly unsubscribers: Array<() => void> = [];

  protected readonly studentPointBars = computed<StudentPointBar[]>(() => {
    const studentsInAuth = this.authRoster().students;
    const pointsByStudent = new Map(studentsInAuth.map((student) => [student.id, 0]));
    this.activityLogs().forEach((log) => {
      pointsByStudent.set(log.studentId, (pointsByStudent.get(log.studentId) ?? 0) + log.pointEarned);
    });
    const students = studentsInAuth.map((student) => ({
      id: student.id,
      name: student.displayName,
      grade: Number(student.grade ?? 0),
      points: pointsByStudent.get(student.id) ?? 0,
      height: 0,
    })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    const maxPoints = Math.max(0, ...students.map((student) => student.points));
    return students.map((student) => ({
      ...student,
      height: maxPoints ? Math.max(8, Math.round((student.points / maxPoints) * 100)) : 0,
    }));
  });

  protected readonly stats = computed(() => [
    { label: 'Jumlah Siswa', value: this.authRosterLoading() ? '…' : this.authRosterError() ? '—' : String(this.authRoster().students.length), description: 'Akun Firebase Authentication' },
    { label: 'Jumlah Guru', value: this.authRosterLoading() ? '…' : this.authRosterError() ? '—' : String(this.authRoster().teachers.length), description: 'Akun Firebase Authentication' },
    { label: 'Jumlah Unit', value: String(this.data.units().length), description: 'Unit pembelajaran' },
    { label: 'Flashcard', value: String(this.data.dashboardCounts()['all']?.flashcards ?? '…'), description: 'Kosa kata tersedia' },
    { label: 'Jumlah Soal', value: String(this.data.dashboardCounts()['all']?.questions ?? '…'), description: 'Empat kategori' },
  ]);

  protected readonly studentDateRange = computed(() => this.formatDateRange(this.studentStartDateId(), this.studentEndDateId()));
  protected readonly contentDateRange = computed(() => this.formatDateRange(this.contentStartDateId(), this.contentEndDateId()));

  protected readonly periodStudentTotal = computed(() => this.studentPointBars().reduce((sum, student) => sum + student.points, 0));
  protected readonly teacherProductionTotal = computed(() => this.teacherProductionBars().reduce((sum, teacher) => sum + teacher.total, 0));
  protected readonly teacherProductionBars = computed<TeacherProductionBar[]>(() => {
    const production = this.data.production();
    const teachers = this.authRoster().teachers.map((teacher) => {
      const flashcards = production[teacher.id]?.flashcards ?? 0;
      const questions = production[teacher.id]?.questions ?? 0;
      return {
        id: teacher.id,
        label: teacher.displayName.replace(/^Miss\s+|^Sir\s+/i, ''),
        flashcards,
        flashcardHeight: 0,
        questions,
        questionHeight: 0,
        total: flashcards + questions,
      };
    }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    const maxFlashcards = Math.max(0, ...teachers.map((teacher) => teacher.flashcards));
    const maxQuestions = Math.max(0, ...teachers.map((teacher) => teacher.questions));
    return teachers.map((teacher) => ({
      ...teacher,
      flashcardHeight: maxFlashcards ? Math.max(8, Math.round((teacher.flashcards / maxFlashcards) * 100)) : 0,
      questionHeight: maxQuestions ? Math.max(8, Math.round((teacher.questions / maxQuestions) * 100)) : 0,
    }));
  });
  protected readonly teacherFlashcardBars = computed(() =>
    [...this.teacherProductionBars()].sort((a, b) => b.flashcards - a.flashcards || a.label.localeCompare(b.label)),
  );
  protected readonly teacherQuestionBars = computed(() =>
    [...this.teacherProductionBars()].sort((a, b) => b.questions - a.questions || a.label.localeCompare(b.label)),
  );

  constructor() {
    let lastActivityRefresh = 0, lastContentRefresh = 0;
    void this.adminApi.getAuthRoster()
      .then((roster) => this.authIdentities.set(roster))
      .catch((error: unknown) => {
        this.authRosterError.set(true);
        this.dataWarning.set(error instanceof Error ? error.message : 'Daftar akun Authentication belum dapat dimuat.');
      })
      .finally(() => this.authRosterLoading.set(false));
    void this.data.loadDashboardCounts().catch(() => this.dataWarning.set('Ringkasan konten belum dapat dimuat.'));
    effect((onCleanup) => {
      const start = this.studentStartDateId(), end = this.studentEndDateId();
      const ids = this.authRoster().students.map(user => user.id);
      const version = this.refreshVersion();
      const refresh = version !== lastActivityRefresh; lastActivityRefresh = version;
      let active = true;
      onCleanup(() => { active = false; });
      untracked(() => {
        this.activityLogs.set([]);
        this.beginReport();
        void this.adminApi.getDashboardReport('activity', start, end, ids, refresh)
          .then(report => { if (active) {
            this.activityLogs.set(Object.entries(report.rows).map(([studentId, row]) => ({ studentId, pointEarned: row.pointEarned })));
            this.reportUpdated.set(new Date(report.generatedAt).toLocaleTimeString());
          } }).catch(() => { if (active) this.dataWarning.set('Ringkasan aktivitas belum dapat dimuat. Tekan Perbarui laporan untuk mencoba lagi.'); })
          .finally(() => this.endReport());
      });
    });
    effect((onCleanup) => {
      const start = this.contentStartDateId(), end = this.contentEndDateId();
      const ids = this.authRoster().teachers.map(user => user.id);
      const version = this.refreshVersion();
      const refresh = version !== lastContentRefresh; lastContentRefresh = version;
      let active = true;
      onCleanup(() => { active = false; });
      untracked(() => {
        this.data.production.set({});
        this.beginReport();
        void this.adminApi.getDashboardReport('content', start, end, ids, refresh)
          .then(report => { if (active) {
            this.data.production.set(Object.fromEntries(Object.entries(report.rows).map(([id, row]) => [id, { flashcards: row.flashcards ?? 0, questions: row.questions ?? 0 }])));
            this.reportUpdated.set(new Date(report.generatedAt).toLocaleTimeString());
          } }).catch(() => { if (active) this.dataWarning.set('Ringkasan produksi belum dapat dimuat. Tekan Perbarui laporan untuk mencoba lagi.'); })
          .finally(() => this.endReport());
      });
    });
  }

  private beginReport(): void { this.pendingReports++; this.reportLoading.set(true); }
  private endReport(): void { this.pendingReports--; this.reportLoading.set(this.pendingReports > 0); }
  protected refreshReports(): void {
    this.dataWarning.set(''); this.refreshVersion.update(value => value + 1);
    this.authRosterLoading.set(true);
    void this.adminApi.getAuthRoster(true).then(roster => { this.authIdentities.set(roster); this.authRosterError.set(false); })
      .catch(() => { this.authRosterError.set(true); this.dataWarning.set('Daftar akun belum dapat diperbarui.'); })
      .finally(() => this.authRosterLoading.set(false));
  }

  ngOnDestroy(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  protected changeStudentStartDate(dateId: string): void {
    if (!dateId) return;
    this.studentStartDateId.set(dateId);
    if (this.studentEndDateId() < dateId) this.studentEndDateId.set(dateId);
  }

  protected changeStudentEndDate(dateId: string): void {
    if (!dateId) return;
    this.studentEndDateId.set(dateId);
    if (dateId < this.studentStartDateId()) this.studentStartDateId.set(dateId);
  }

  protected changeContentStartDate(dateId: string): void {
    if (!dateId) return;
    this.contentStartDateId.set(dateId);
    if (this.contentEndDateId() < dateId) this.contentEndDateId.set(dateId);
  }

  protected openStudentPoints(id: string): void {
    void this.router.navigate(['/admin/points'], { queryParams: { studentId: id } });
  }

  protected changeContentEndDate(dateId: string): void {
    if (!dateId) return;
    this.contentEndDateId.set(dateId);
    if (dateId < this.contentStartDateId()) this.contentStartDateId.set(dateId);
  }

  private formatDateRange(startId: string, endId: string): string {
    const format = (id: string) => {
      const [year, month, day] = id.split('-').map(Number);
      return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
        .format(new Date(year, month - 1, day, 12));
    };
    return `${format(startId)} – ${format(endId)}`;
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private dateId(date: Date): string {
    return `${date.getFullYear()}-${this.pad(date.getMonth() + 1)}-${this.pad(date.getDate())}`;
  }

  private pad(value: number): string {
    return String(value).padStart(2, '0');
  }

  private toNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
}
