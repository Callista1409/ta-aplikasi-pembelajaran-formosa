import { posttestAnswerScore } from '../core/content/posttest-plan';
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContentDataService } from '../core/services/content-data.service';
import { PosttestArchiveService } from '../core/services/posttest-archive.service';

@Component({
  selector: 'app-posttest-archive',
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './posttest-archive.component.html',
  styleUrl: './posttest-archive.component.scss',
})
export class PosttestArchiveComponent {
  protected readonly posttestAnswerScore = posttestAnswerScore;
  protected readonly archive = inject(PosttestArchiveService);
  private readonly data = inject(ContentDataService);
  protected readonly selectedStudent = signal('');
  protected readonly students = computed(() => this.data.students());
  protected readonly entries = computed(() => this.archive.entries().filter((entry) =>
    !this.selectedStudent() || entry.studentId === this.selectedStudent()));
  protected studentName(id: string): string {
    return this.data.users().find((user) => user.id === id)?.displayName ?? 'Murid';
  }
}