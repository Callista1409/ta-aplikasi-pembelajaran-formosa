import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { DashboardRequestCache } from './dashboard-report-cache';

export interface DashboardReportRow {
  pointEarned: number;
  questionCount?: number;
  learnedCount?: number;
  totalPoints?: number;
  categoryCounts?: Record<'writing' | 'listening' | 'speaking' | 'reading', number>;
  flashcards?: number;
  questions?: number;
}
export interface DashboardReport { rows: Record<string, DashboardReportRow>; generatedAt: number; }

interface DeleteUserResponse {
  message?: string;
}

export interface AuthRosterEntry {
  id: string;
  displayName: string;
  grade?: number;
}

export interface AuthRosterResponse {
  students: AuthRosterEntry[];
  teachers: AuthRosterEntry[];
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly cache = new DashboardRequestCache();
  private rosterInvalidated = false;
  private cacheScope = '';

  constructor() {
    effect(() => this.updateScope());
  }

  private updateScope(): void {
    const profile = this.auth.profile();
    const scope = `${this.auth.user()?.uid ?? ''}:${profile?.role ?? ''}:${profile?.active ?? false}`;
    if (scope !== this.cacheScope) { this.cacheScope = scope; this.cache.clear(); }
  }

  invalidateRoster(): void { this.cache.clear(); this.rosterInvalidated = true; }

  async getDashboardReport(kind: 'activity' | 'content', start: string, end: string, ids: string[], refresh = false, includeTotals = false): Promise<DashboardReport> {
    this.updateScope();
    const user = this.auth.user();
    if (!user || !environment.adminApiUrl) throw new Error('Layanan laporan belum siap.');
    const unique = [...new Set(ids)].sort();
    const offsetMinutes = -new Date(`${start}T00:00:00`).getTimezoneOffset();
    const reports: DashboardReport[] = [];
    for (let offset = 0; offset < unique.length; offset += 50) {
      const batch = unique.slice(offset, offset + 50);
      const key = JSON.stringify([user.uid, kind, start, end, batch, offsetMinutes, includeTotals]);
      reports.push(await this.cache.read(key, async () => {
        const token = await user.getIdToken();
        return firstValueFrom(this.http.post<DashboardReport>(`${environment.adminApiUrl}/admin/report-summary`,
          { kind, start, end, ids: batch, offsetMinutes, refresh, includeTotals }, { headers: { Authorization: `Bearer ${token}` } }).pipe(timeout(90_000)));
      }, refresh));
    }
    if (this.auth.user()?.uid !== user.uid) throw new Error('Akun berubah. Muat ulang laporan.');
    return { rows: Object.fromEntries(reports.flatMap(report => Object.entries(report.rows))),
      generatedAt: reports.length ? Math.min(...reports.map(report => report.generatedAt)) : Date.now() };
  }

  async getAuthRoster(refresh = false): Promise<AuthRosterResponse> {
    this.updateScope();
    const currentUser = this.auth.user();
    if (!currentUser) throw new Error('Admin belum login.');
    if (!environment.adminApiUrl) throw new Error('URL Admin API belum diatur.');

    refresh ||= this.rosterInvalidated;
    this.rosterInvalidated = false;
    const token = await currentUser.getIdToken();
    try {
      const result = await this.cache.read(`roster:${currentUser.uid}`, () => firstValueFrom(
        this.http.get<AuthRosterResponse>(`${environment.adminApiUrl}/admin/auth-roster${refresh ? '?refresh=1' : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).pipe(timeout(30_000)),
      ), refresh);
      if (this.auth.user()?.uid !== currentUser.uid) throw new Error('Akun berubah. Muat ulang dashboard.');
      return result;
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        const message = typeof error.error?.message === 'string'
          ? error.error.message
          : 'Daftar akun Authentication belum dapat dimuat.';
        throw new Error(message);
      }
      throw error;
    }
  }

  async deleteUser(uid: string, role: 'student' | 'teacher', confirmation: string): Promise<string> {
    const currentUser = this.auth.user();
    if (!currentUser) throw new Error('Admin belum login.');
    if (!environment.adminApiUrl) throw new Error('URL Admin API belum diatur.');

    const token = await currentUser.getIdToken();
    try {
      const response = await firstValueFrom(
        this.http.post<DeleteUserResponse>(
          `${environment.adminApiUrl}/admin/delete-user`,
          { uid, role, confirmation },
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
      this.invalidateRoster();
      return response.message ?? 'Akun berhasil dihapus permanen.';
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        const message =
          typeof error.error?.message === 'string'
            ? error.error.message
            : 'Akun belum bisa dihapus. Pastikan layanan admin sedang aktif.';
        throw new Error(message);
      }
      throw error;
    }
  }
}
