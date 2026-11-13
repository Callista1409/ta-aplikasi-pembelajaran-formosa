import { Component, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/services/auth.service';

export interface RoleNavigationItem {
  label: string;
  path: string;
}

@Component({
  selector: 'app-role-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './role-layout.component.html',
  styleUrl: './role-layout.component.scss',
})
export class RoleLayoutComponent {
  protected readonly menuOpen = signal(false);
  @ViewChild('menuToggle') private menuToggle?: ElementRef<HTMLButtonElement>;

  protected closeMenu(restoreFocus = false): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    if (restoreFocus) this.menuToggle?.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  protected dismissMenu(): void {
    this.closeMenu(true);
  }

  private audioContext: AudioContext | null = null;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  protected readonly roleLabel = this.route.snapshot.data['roleLabel'] as string;
  protected readonly consoleLabel = this.route.snapshot.data['consoleLabel'] as string;
  protected readonly navigation = this.route.snapshot.data['navigation'] as RoleNavigationItem[];
  protected readonly userName = computed(
    () => this.auth.profile()?.displayName ?? (this.route.snapshot.data['userName'] as string),
  );
  protected readonly initials = computed(() =>
    this.userName()
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join(''),
  );

  protected async logout(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }

  @HostListener('click', ['$event'])
  protected playStudentClick(event: Event): void {
    if (this.roleLabel !== 'Murid') return;
    const target = event.target as HTMLElement | null;
    const control = target?.closest('button, a');
    if (!control || control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') return;

    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    this.audioContext ??= new AudioContextClass();
    if (this.audioContext.state === 'suspended') void this.audioContext.resume();

    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const now = this.audioContext.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(620, now);
    oscillator.frequency.exponentialRampToValueAtTime(460, now + 0.07);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    oscillator.connect(gain).connect(this.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.07);
  }
}
