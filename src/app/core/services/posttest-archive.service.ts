import { Injectable, effect, inject, signal } from '@angular/core';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { firestore } from '../firebase/firebase';
import { AuthService } from './auth.service';
import { PosttestArchiveEntry, posttestArchiveEntry } from '../content/posttest-archive';

@Injectable({ providedIn: 'root' })
export class PosttestArchiveService {
  private readonly auth = inject(AuthService);
  readonly entries = signal<PosttestArchiveEntry[]>([]);
  readonly loaded = signal(false);
  readonly error = signal('');

  constructor() {
    effect((onCleanup) => {
      const profile = this.auth.profile();
      this.entries.set([]);
      this.loaded.set(false);
      this.error.set('');
      if (!profile) return;
      if (profile.role !== 'teacher') {
        this.loaded.set(true);
        return;
      }
      const source = query(collection(firestore, 'testSessions'), where('mode', '==', 'posttest'));
      const unsubscribe = onSnapshot(source, (snapshot) => {
        if (this.auth.profile()?.uid !== profile.uid || this.auth.profile()?.role !== profile.role) return;
        this.entries.set(snapshot.docs.flatMap((document) => {
          const entry = posttestArchiveEntry(document.id, document.data());
          return entry ? [entry] : [];
        }).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || a.id.localeCompare(b.id)));
        this.loaded.set(true);
      }, () => {
        if (this.auth.profile()?.uid !== profile.uid || this.auth.profile()?.role !== profile.role) return;
        this.entries.set([]);
        this.error.set('Arsip posttest belum dapat dimuat. Periksa koneksi lalu muat ulang halaman.');
        this.loaded.set(true);
      });
      onCleanup(unsubscribe);
    });
  }
}