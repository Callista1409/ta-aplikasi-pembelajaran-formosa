import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected username = '';
  protected password = '';
  protected resetEmail = '';
  protected showPassword = false;
  protected readonly submitting = signal(false);
  protected readonly resetting = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly resetMessage = signal('');
  protected readonly showResetHelp = signal(false);

  async ngOnInit(): Promise<void> {
    await this.auth.waitUntilReady();
    const profile = this.auth.profile();
    if (profile) await this.router.navigateByUrl(this.auth.homeForRole(profile.role));
  }

  protected async submit(): Promise<void> {
    if (!this.username.trim() || !this.password) {
      this.errorMessage.set('Username dan password wajib diisi.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');
    this.resetMessage.set('');
    this.showResetHelp.set(false);
    try {
      const profile = await this.auth.signIn(this.username, this.password);
      const requestedUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      const destination = requestedUrl?.startsWith(`/${profile.role === 'teacher' ? 'teacher' : profile.role}`)
        ? requestedUrl
        : this.auth.homeForRole(profile.role);
      await this.router.navigateByUrl(destination);
    } catch (error) {
      this.errorMessage.set(this.auth.readableError(error));
      this.showResetHelp.set(true);
    } finally {
      this.submitting.set(false);
    }
  }

  protected async resetPassword(): Promise<void> {
    if (!this.resetEmail.trim()) {
      this.resetMessage.set('Masukkan username atau email akun untuk menerima link reset password.');
      return;
    }

    this.resetting.set(true);
    this.resetMessage.set('');
    try {
      await this.auth.sendPasswordReset(this.resetEmail);
      this.resetMessage.set('Link reset password sudah dikirim.');
    } catch (error) {
      this.resetMessage.set(error instanceof Error ? error.message : 'Reset password gagal. Coba lagi nanti.');
    } finally {
      this.resetting.set(false);
    }
  }
}
