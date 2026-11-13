import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { firestore } from '../firebase/firebase';
import { AuthService } from './auth.service';

/** Return the full Monday-to-Sunday range for the selected week. */
export function activityCalendarRange(weekId: string): [string, string] {
  const weekStart = new Date(`${weekId}T12:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const toDateId = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return [toDateId(weekStart), toDateId(weekEnd)];
}

export function activityPeriodQuery(startId: string, endId: string) {
  return query(collection(firestore, 'studentActivityLogs'),
    where('dateId', '>=', startId), where('dateId', '<=', endId));
}

@Injectable({ providedIn: 'root' })
export class ActivityLogPeriodService {
  private readonly auth = inject(AuthService);
  private readonly firstYear = signal(new Date().getFullYear());
  readonly error = signal('');
  readonly yearOptions = computed(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: Math.max(1, current - this.firstYear() + 1) }, (_, index) => {
      const year = String(current - index);
      return { label: year, value: year };
    });
  });

  constructor() {
    effect((onCleanup) => {
      const profile = this.auth.profile();
      this.firstYear.set(new Date().getFullYear());
      this.error.set('');
      if (!profile || !['admin', 'teacher'].includes(profile.role)) return;
      // One oldest log keeps historical years selectable without loading all history.
      let active = true;
      const stop = onSnapshot(query(collection(firestore, 'studentActivityLogs'), orderBy('dateId'), limit(1)), (snapshot) => {
        if (!active) return;
        const year = Number(String(snapshot.docs[0]?.data()['dateId'] ?? '').slice(0, 4));
        if (year >= 1900 && year <= new Date().getFullYear()) this.firstYear.set(year);
      }, () => {
        if (active) this.error.set('Pilihan tahun riwayat belum dapat dimuat. Coba muat ulang halaman.');
      });
      onCleanup(() => { active = false; stop(); });
    });
  }
}
