import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { collection, onSnapshot } from 'firebase/firestore';
import { activityPeriodQuery } from '../../core/services/activity-log-period.service';
import { firestore } from '../../core/firebase/firebase';
import { QuestionCategory } from '../../core/models/content.models';
import { ContentDataService } from '../../core/services/content-data.service';
import { StudentCommentsService } from '../../core/services/student-comments.service';

type CategoryCounts = Record<QuestionCategory, number>;

interface StudentPointRecord {
  totalPoints: number;
}

interface TeacherActivityLog {
  id: string;
  studentId: string;
  type: 'learn_flashcard' | 'test_session';
  dateId: string;
  monthId: string;
  dayIndex: number;
  pointEarned: number;
  questionCount: number;
  categoryCounts: CategoryCounts;
  unitId?: string;
  createdAtSeconds: number;
}

interface StudentSummary {
  id: string;
  name: string;
  grade: number;
  totalPoints: number;
  periodPoints: number;
  questionCount: number;
}

@Component({
  selector: 'app-teacher-points',
  imports: [FormsModule],
  templateUrl: './teacher-points.component.html',
  styleUrls: ['./teacher-dashboard.component.scss', './teacher-points.component.scss'],
})
export class TeacherPointsComponent implements OnDestroy {
  protected readonly data = inject(ContentDataService);
  protected readonly comments = inject(StudentCommentsService);
  private readonly route = inject(ActivatedRoute);
  protected readonly dashboardLabel = String(this.route.snapshot.data['dashboardLabel'] ?? 'Dashboard Guru');
  protected readonly pageTitle = String(this.route.snapshot.data['pageTitle'] ?? 'Daftar Poin Murid');
  protected readonly pageSubtitle = String(
    this.route.snapshot.data['pageSubtitle'] ?? 'Pilih murid untuk melihat rincian progress, poin, dan aktivitas pada rentang tanggal.',
  );
  protected readonly selectedStudentId = signal('');
  protected readonly startDateId = signal(this.firstDayOfCurrentMonth());
  protected readonly endDateId = signal(this.todayId());
  protected readonly pointRecords = signal<Record<string, StudentPointRecord>>({});
  protected readonly activityLogs = signal<TeacherActivityLog[]>([]);
  protected readonly dataWarning = signal('');
  protected readonly commentStudentId = signal('');
  protected readonly commentComposerStudentId = signal('');
  protected commentText = '';
  protected commentDate = this.todayId();
  protected readonly commentError = signal('');
  protected readonly savingComment = signal(false);

  private readonly unsubscribers: Array<() => void> = [];
  private readonly requestedStudentId = this.route.snapshot.queryParamMap.get('studentId');

  protected readonly students = computed(() =>
    this.data.students().sort((a, b) => Number(a.grade ?? 0) - Number(b.grade ?? 0) || a.displayName.localeCompare(b.displayName)),
  );

  protected readonly summaries = computed<StudentSummary[]>(() =>
    this.students().map((student) => this.buildStudentSummary(student)),
  );

  protected readonly selectedSummary = computed(() => {
    const id = this.selectedStudentId();
    return id ? this.summaries().find((student) => student.id === id) ?? null : null;
  });

  protected readonly periodDetail = computed(() => {
    const selected = this.selectedSummary();
    const logs = selected ? this.logsForStudent(selected.id).filter((log) => this.isInSelectedRange(log.dateId)) : [];
    const learned = new Set(logs.filter((log) => log.type === 'learn_flashcard').map((log) => log.id));
    const categories = this.emptyCategoryCounts();
    let earnedPoints = 0;
    let questionCount = 0;

    logs.forEach((log) => {
      earnedPoints += log.pointEarned;
      questionCount += log.questionCount;
      (Object.keys(categories) as QuestionCategory[]).forEach((category) => {
        categories[category] += log.categoryCounts[category] ?? 0;
      });
    });

    return {
      categories: (Object.keys(categories) as QuestionCategory[]).map((category) => ({
        label: this.categoryLabel(category),
        value: categories[category],
      })),
      earnedPoints,
      learnedCount: learned.size,
      questionCount,
    };
  });

  constructor() {
    this.watchStudentPoints();
    effect(() => {
      const student = this.students().find((item) => item.id === this.requestedStudentId);
      if (student && this.selectedStudentId() !== student.id) this.selectStudent(student.id);
    });
    effect((onCleanup) => {
      const start = this.startDateId();
      const end = this.endDateId();
      this.activityLogs.set([]);
      if (!start || !end || start > end) {
        this.dataWarning.set('Pilih rentang tanggal yang lengkap dan valid.');
        return;
      }
      this.dataWarning.set('');
      onCleanup(this.watchActivityLogs(start, end));
    });
  }

  ngOnDestroy(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  protected selectStudent(id: string): void {
    this.selectedStudentId.set(id);
    this.commentStudentId.set(id);
  }

  protected openComments(studentId: string): void {
    this.selectedStudentId.set(studentId);
    this.commentStudentId.set(studentId);
    this.commentComposerStudentId.set(studentId);
    this.commentText = '';
    this.commentDate = this.todayId();
    this.commentError.set('');
  }

  protected closeComments(): void {
    this.commentComposerStudentId.set('');
  }

  protected async deleteComment(commentId: string): Promise<void> {
    const comment = this.comments.comments().find((item) => item.id === commentId);
    if (!comment || !this.comments.canDelete(comment)) return;
    await this.comments.deleteComment(comment);
  }

  protected async markCommentAsNoted(commentId: string): Promise<void> {
    const comment = this.comments.comments().find((item) => item.id === commentId);
    if (!comment || comment.readAt) return;
    await this.comments.markAsNoted(commentId);
  }

  protected commentCount(studentId: string): number {
    return this.comments.comments().filter((comment) => comment.studentId === studentId).length;
  }

  protected commentsForStudent(studentId: string) {
    return this.comments.comments().filter((comment) => comment.studentId === studentId);
  }

  protected studentNameFor(studentId: string): string {
    return this.data.users().find((user) => user.id === studentId)?.displayName ?? 'Murid';
  }

  protected async addComment(): Promise<void> {
    const studentId = this.commentComposerStudentId();
    if (!studentId) return;
    this.savingComment.set(true);
    this.commentError.set('');
    try {
      await this.comments.addComment(studentId, this.commentText, this.commentDate);
      this.commentText = '';
    } catch (error) {
      this.commentError.set(error instanceof Error ? error.message : 'Komentar gagal disimpan.');
    } finally {
      this.savingComment.set(false);
    }
  }

  private todayId(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  protected changeStartDate(dateId: string): void {
    this.startDateId.set(dateId);
    if (dateId > this.endDateId()) this.endDateId.set(dateId);
  }

  protected changeEndDate(dateId: string): void {
    this.endDateId.set(dateId);
    if (dateId < this.startDateId()) this.startDateId.set(dateId);
  }

  private watchStudentPoints(): void {
    const unsubscribe = onSnapshot(
      collection(firestore, 'studentPoints'),
      (snapshot) => {
        const records: Record<string, StudentPointRecord> = {};
        snapshot.docs.forEach((item) => {
          const data = item.data();
          records[item.id] = {
            totalPoints: this.toNumber(data['totalStarsEarned'] ?? data['totalPoints']),
          };
        });
        this.pointRecords.set(records);
      },
      (error) => {
        this.dataWarning.set(`Data poin belum dapat dibaca: ${error.message}`);
      },
    );
    this.unsubscribers.push(unsubscribe);
  }

  private watchActivityLogs(start: string, end: string): () => void {
    let active = true;
    const unsubscribe = onSnapshot(
      activityPeriodQuery(start, end),
      (snapshot) => {
        if (!active) return;
        const logs = snapshot.docs
          .map((item) => this.mapActivityLog(item.id, item.data()))
          .filter((item): item is TeacherActivityLog => item !== null)
          .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
        this.activityLogs.set(logs);
        this.dataWarning.set('');
      },
      (error) => {
        if (!active) return;
        this.dataWarning.set(`Data aktivitas belum dapat dibaca: ${error.message}`);
      },
    );
    return () => { active = false; unsubscribe(); };
  }

  private buildStudentSummary(student: { id: string; displayName: string; grade?: number }): StudentSummary {
    const points = this.pointRecords()[student.id] ?? { totalPoints: 0 };
    const periodLogs = this.logsForStudent(student.id).filter((log) => this.isInSelectedRange(log.dateId));
    return {
      id: student.id,
      grade: Number(student.grade ?? 0),
      name: student.displayName,
      periodPoints: periodLogs.reduce((sum, log) => sum + log.pointEarned, 0),
      questionCount: periodLogs.reduce((sum, log) => sum + log.questionCount, 0),
      totalPoints: points.totalPoints,
    };
  }

  private logsForStudent(studentId: string): TeacherActivityLog[] {
    return this.activityLogs().filter((log) => log.studentId === studentId);
  }

  private isInSelectedRange(dateId: string): boolean {
    return dateId >= this.startDateId() && dateId <= this.endDateId();
  }

  private mapActivityLog(id: string, data: Record<string, unknown>): TeacherActivityLog | null {
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
      monthId: typeof data['monthId'] === 'string' ? data['monthId'] : this.monthId(logDate),
      pointEarned: this.toNumber(data['pointEarned']),
      questionCount: this.toNumber(data['questionCount']),
      studentId,
      type,
      unitId: typeof data['unitId'] === 'string' ? data['unitId'] : undefined,
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

  private parseDateId(dateId: string): Date | null {
    const [year, month, day] = dateId.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  private dayIndex(date: Date): number {
    return (date.getDay() + 6) % 7;
  }

  private firstDayOfCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${this.pad(now.getMonth() + 1)}-01`;
  }

  private pad(value: number): string {
    return String(value).padStart(2, '0');
  }

  private toNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
}
