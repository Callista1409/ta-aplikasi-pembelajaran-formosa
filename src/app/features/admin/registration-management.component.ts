import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PendingRegistration, RegistrationStatus } from '../../core/models/auth.models';
import { RegistrationService } from '../../core/services/registration.service';

@Component({
  selector: 'app-registration-management',
  imports: [FormsModule],
  templateUrl: './registration-management.component.html',
  styleUrl: './registration-management.component.scss',
})
export class RegistrationManagementComponent {
  private readonly registrationsService = inject(RegistrationService);

  protected readonly registrations = this.registrationsService.registrations;
  protected readonly statusFilter = signal<RegistrationStatus | 'all'>('all');
  protected readonly statusOptions: Array<{ value: RegistrationStatus | 'all'; label: string }> = [
    { value: 'all', label: 'Semua' },
    { value: 'pending', label: 'Menunggu persetujuan' },
    { value: 'rejected', label: 'Ditolak' },
    { value: 'approved', label: 'Disetujui' },
  ];
  protected readonly visibleRegistrations = computed(() => {
    const filter = this.statusFilter();
    const priority: Record<RegistrationStatus, number> = { pending: 0, rejected: 1, approved: 2 };
    return this.registrations()
      .filter((registration) => filter === 'all' || registration.status === filter)
      .sort((a, b) => priority[a.status] - priority[b.status] || a.displayName.localeCompare(b.displayName, 'id'));
  });
  protected readonly selected = signal<PendingRegistration | null>(null);
  protected readonly savingUid = signal('');
  protected readonly actionError = signal('');
  protected username = '';
  protected readonly pendingCount = computed(
    () => this.registrations().filter((registration) => registration.status === 'pending').length,
  );

  protected setStatusFilter(status: RegistrationStatus | 'all'): void {
    this.statusFilter.set(status);
    const selected = this.selected();
    if (selected && status !== 'all' && selected.status !== status) {
      this.selected.set(null);
      this.username = '';
      this.actionError.set('');
    }
  }

  protected select(registration: PendingRegistration): void {
    this.selected.set(registration);
    this.username = '';
    this.actionError.set('');
  }

  protected async assignUsername(registration: PendingRegistration): Promise<void> {
    const username = this.username.trim().toLowerCase();
    this.savingUid.set(registration.uid);
    this.actionError.set('');
    try {
      await this.registrationsService.assignUsername(registration, username);
      this.selected.set({ ...registration, status: 'approved', username });
      this.username = '';
    } catch (error) {
      this.actionError.set(error instanceof Error ? error.message : 'Username gagal disimpan.');
    } finally {
      this.savingUid.set('');
    }
  }

  protected statusLabel(status: RegistrationStatus): string {
    if (status === 'approved') return 'Disetujui';
    if (status === 'rejected') return 'Ditolak';
    return 'Menunggu persetujuan';
  }

  protected async updateStatus(registration: PendingRegistration, status: Exclude<RegistrationStatus, 'pending'>): Promise<void> {
    this.savingUid.set(registration.uid);
    this.actionError.set('');
    try {
      await this.registrationsService.updateStatus(registration.uid, status);
      this.selected.set({ ...registration, status });
    } catch (error) {
      this.actionError.set(error instanceof Error ? error.message : 'Status pendaftar gagal diperbarui.');
    } finally {
      this.savingUid.set('');
    }
  }

  protected sendUsernameEmail(registration: PendingRegistration): void {
    if (!registration.username) return;
    const subject = 'Akun Formosa Mandarin Disetujui';
    const body = [
      `Halo ${registration.displayName},`,
      '',
      'Pendaftaran akun Formosa Mandarin kamu sudah disetujui.',
      `Username kamu: ${registration.username}`,
      '',
      'Silakan gunakan username tersebut untuk masuk ke web Formosa Mandarin.',
      '',
      'Terima kasih.',
    ].join('\n');
    const gmailDraftUrl = [
      'https://mail.google.com/mail/?view=cm&fs=1',
      `to=${encodeURIComponent(registration.email)}`,
      `su=${encodeURIComponent(subject)}`,
      `body=${encodeURIComponent(body)}`,
    ].join('&');
    window.open(gmailDraftUrl, '_blank', 'noopener,noreferrer');
  }
}
