import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class StudentApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  async post<T>(action: string, body: unknown = {}): Promise<T> {
    const user = this.auth.user();
    if (!user || this.auth.profile()?.role !== 'student' || !environment.adminApiUrl) throw new Error('Layanan murid belum siap.');
    const token = await user.getIdToken();
    if (this.auth.user() !== user || this.auth.profile()?.role !== 'student') throw new Error('Akun berubah. Muat ulang halaman.');
    try {
      const result = await firstValueFrom(this.http.post<T>(`${environment.adminApiUrl}/student/${action}`, body, {
        headers: { Authorization: `Bearer ${token}` },
      }).pipe(timeout(90_000)));
      if (this.auth.user() !== user) throw new Error('Akun berubah. Muat ulang halaman.');
      return result;
    } catch (cause) {
      if (cause instanceof HttpErrorResponse) throw new Error(typeof cause.error?.message === 'string' ? cause.error.message : 'Penyimpanan belum berhasil. Coba lagi.');
      throw cause;
    }
  }
}
