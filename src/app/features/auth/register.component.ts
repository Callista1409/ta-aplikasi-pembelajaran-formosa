import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { RegistrationRole } from '../../core/models/auth.models';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected displayName = '';
  protected email = '';
  protected role: RegistrationRole = 'student';
  protected grade = 1;
  protected password = '';
  protected confirmPassword = '';
  protected showPassword = false;
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly success = signal(false);

  protected async submit(): Promise<void> {
    this.errorMessage.set('');

    if (!this.displayName.trim() || !this.email.trim() || !this.password || !this.confirmPassword) {
      this.errorMessage.set('Lengkapi semua data pendaftaran terlebih dahulu.');
      return;
    }
    if (this.password.length < 6) {
      this.errorMessage.set('Password minimal 6 karakter.');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.errorMessage.set('Konfirmasi password belum sama.');
      return;
    }

    this.submitting.set(true);
    try {
      await this.auth.registerAccount(
        this.displayName,
        this.email,
        this.role,
        this.role === 'student' ? this.grade : null,
        this.password,
      );
      this.success.set(true);
    } catch (error) {
      this.errorMessage.set(this.readableError(error));
    } finally {
      this.submitting.set(false);
    }
  }


  private readableError(error: unknown): string {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (code.includes('email-already-in-use')) return 'Email ini sudah terdaftar.';
    if (code.includes('invalid-email')) return 'Format email belum benar.';
    if (code.includes('weak-password')) return 'Password terlalu mudah. Gunakan minimal 6 karakter.';
    if (code.includes('network-request-failed')) return 'Koneksi ke Firebase gagal. Periksa internet kamu.';
    if (code.includes('permission-denied')) return 'Pendaftaran belum diizinkan oleh aturan Firebase.';
    return error instanceof Error ? error.message : 'Pendaftaran gagal. Silakan coba kembali.';
  }

}
