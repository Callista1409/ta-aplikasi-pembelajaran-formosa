import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent {
  private readonly auth = inject(AuthService);

  protected readonly profile = this.auth.profile;
  protected readonly roleLabel = computed(() => {
    const role = this.profile()?.role;
    if (role === 'admin') return 'Admin';
    if (role === 'teacher') return 'Guru';
    return 'Murid';
  });

  protected readonly consoleLabel = computed(() => {
    const role = this.profile()?.role;
    if (role === 'admin') return 'Admin Console';
    if (role === 'teacher') return 'Teacher Console';
    return 'Student Console';
  });

  protected readonly gradeLabel = computed(() => {
    const grade = this.profile()?.grade;
    return grade ? `SD ${grade}` : '-';
  });

  protected readonly initials = computed(() =>
    (this.profile()?.displayName ?? 'Pengguna')
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join(''),
  );
}
