import { Injectable, OnDestroy, effect, inject, signal } from '@angular/core';
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc, where, query } from 'firebase/firestore';
import { firestore } from '../firebase/firebase';
import { StudentComment } from '../models/student-comment.models';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class StudentCommentsService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private unsubscribe: (() => void) | null = null;
  private activeScope = '';

  readonly comments = signal<StudentComment[]>([]);

  constructor() {
    effect(() => {
      const profile = this.auth.profile();
      queueMicrotask(() => this.watchComments(profile?.role, profile?.uid));
    });
  }

  async addComment(studentId: string, comment: string, commentDate: string): Promise<void> {
    const profile = this.auth.profile();
    if (!profile || profile.role !== 'teacher') throw new Error('Hanya guru yang dapat menambahkan komentar.');
    const value = comment.trim();
    if (!value) throw new Error('Komentar belum diisi.');
    await addDoc(collection(firestore, 'studentComments'), {
      studentId,
      teacherId: profile.uid,
      teacherName: profile.displayName,
      comment: value,
      commentDate,
      createdAt: serverTimestamp(),
      readAt: null,
    });
  }

  async markAsNoted(commentId: string): Promise<void> {
    if (this.auth.profile()?.role !== 'teacher') throw new Error('Hanya guru yang dapat menandai komentar.');
    await updateDoc(doc(firestore, 'studentComments', commentId), { readAt: serverTimestamp() });
  }

  canDelete(comment: StudentComment): boolean {
    const profile = this.auth.profile();
    return profile?.role === 'teacher' && profile.uid === comment.teacherId;
  }

  async deleteComment(comment: StudentComment): Promise<void> {
    if (!this.canDelete(comment)) throw new Error('Kamu hanya dapat menghapus komentar buatanmu sendiri.');
    await deleteDoc(doc(firestore, 'studentComments', comment.id));
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  private watchComments(role?: string, uid?: string): void {
    const scope = `${role ?? 'signed-out'}:${uid ?? ''}`;
    if (scope === this.activeScope) return;
    this.activeScope = scope;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.comments.set([]);
    if (!uid || !role) return;

    const source = role === 'student'
      ? query(collection(firestore, 'studentComments'), where('studentId', '==', uid))
      : collection(firestore, 'studentComments');
    this.unsubscribe = onSnapshot(source, (snapshot) => {
      const comments = snapshot.docs
        .map((item) => this.mapComment(item.id, item.data()))
        .filter((item): item is StudentComment => item !== null)
        .sort((a, b) => b.commentDate.localeCompare(a.commentDate) || b.createdAtSeconds - a.createdAtSeconds);
      this.comments.set(comments);
    }, (error) => {
      console.error('Gagal membaca komentar murid:', error);
      this.comments.set([]);
    });
  }

  private mapComment(id: string, data: Record<string, unknown>): StudentComment | null {
    const studentId = typeof data['studentId'] === 'string' ? data['studentId'] : '';
    const teacherId = typeof data['teacherId'] === 'string' ? data['teacherId'] : '';
    const comment = typeof data['comment'] === 'string' ? data['comment'] : '';
    if (!studentId || !teacherId || !comment) return null;
    const createdAt = data['createdAt'] as { seconds?: unknown } | undefined;
    const readAt = data['readAt'] as { seconds?: unknown } | null | undefined;
    return {
      id,
      studentId,
      teacherId,
      teacherName: typeof data['teacherName'] === 'string' ? data['teacherName'] : 'Guru',
      comment,
      commentDate: typeof data['commentDate'] === 'string' ? data['commentDate'] : '',
      readAt: typeof readAt?.seconds === 'number' ? readAt.seconds : null,
      createdAtSeconds: typeof createdAt?.seconds === 'number' ? createdAt.seconds : 0,
    };
  }
}
