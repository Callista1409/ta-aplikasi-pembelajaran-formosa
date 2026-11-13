import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AppUser, UserRole } from '../../core/models/content.models';
import { AdminApiService } from '../../core/services/admin-api.service';
import { ContentDataService } from '../../core/services/content-data.service';

@Component({
  selector: 'app-user-management',
  imports: [FormsModule],
  templateUrl: './user-management.component.html',
})
export class UserManagementComponent {
  protected readonly data = inject(ContentDataService);
  private readonly adminApi = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly role = this.route.snapshot.data['userRole'] as UserRole;
  protected readonly editable = this.route.snapshot.data['editable'] as boolean;
  protected readonly title = this.role === 'teacher' ? 'Manajemen Akun Guru' : this.editable ? 'Manajemen Akun Siswa' : 'Data Siswa';
  protected readonly eyebrow = this.editable ? 'Dashboard Admin' : 'Dashboard Guru';
  protected readonly search = signal('');
  protected readonly grade = signal('all');
  protected readonly status = signal('all');
  protected readonly formOpen = signal(false);
  protected readonly readerOpen = signal<AppUser | null>(null);
  protected readonly pendingDelete = signal<AppUser | null>(null);
  protected readonly pendingPermanentDelete = signal<AppUser | null>(null);
  protected readonly deleteConfirmText = signal('');
  protected readonly deleteError = signal('');
  protected readonly deleteSuccess = signal('');
  protected readonly saving = signal(false);
  protected readonly deletingPermanently = signal(false);
  protected readonly formError = signal('');
  protected readonly formInfo = signal('');
  protected editingId = '';
  protected form: AppUser = this.emptyUser();

  protected readonly filteredUsers = computed(() => {
    const query = this.search().trim().toLowerCase();
    return this.data.users().filter((user) => {
      const matchesRole = user.role === this.role;
      const matchesSearch = !query || `${user.displayName} ${user.username}`.toLowerCase().includes(query);
      const matchesGrade = this.grade() === 'all' || String(user.grade) === this.grade();
      const matchesStatus = this.status() === 'all' || String(user.active) === this.status();
      return matchesRole && !user.hiddenFromRoster && matchesSearch && matchesGrade && matchesStatus;
    });
  });

  protected readonly canDeletePermanently = computed(() => this.deleteConfirmText().trim().toUpperCase() === 'HAPUS');

  protected openRead(user: AppUser): void {
    this.readerOpen.set(user);
  }

  protected openEdit(user: AppUser): void {
    if (!this.editable || user.deletionStatus || this.deletingPermanently()) return;
    this.readerOpen.set(null);
    this.editingId = user.id;
    this.form = { ...user };
    this.formError.set('');
    this.formInfo.set('Ubah data akun.');
    this.formOpen.set(true);
  }

  protected async save(): Promise<void> {
    if (!this.editable || !this.editingId || this.saving() || this.deletingPermanently() || this.data.users().find(user => user.id === this.editingId)?.deletionStatus) return;
    if (!this.form.displayName.trim() || !this.form.username.trim()) return;

    this.saving.set(true);
    this.formError.set('');
    const payload: AppUser = {
      ...this.form,
      id: this.editingId,
      role: this.role,
      grade: this.role === 'student' ? Number(this.form.grade || 1) : undefined,
    };

    try {
      await this.data.saveUser(payload);
      this.formOpen.set(false);
    } catch (error) {
      this.formError.set(error instanceof Error ? error.message : 'Perubahan akun belum bisa disimpan. Periksa koneksi dan coba lagi.');
    } finally {
      this.saving.set(false);
    }
  }

  protected confirmDelete(): void {
    const user = this.pendingDelete();
    if (this.editable && user && !user.deletionStatus && !this.deletingPermanently()) this.data.deleteUser(user.id);
    this.pendingDelete.set(null);
  }

  protected openPermanentDelete(user: AppUser): void {
    if (!this.editable || this.deletingPermanently() || !['student', 'teacher'].includes(user.role) || user.id === this.data.currentUserId()) return;
    this.readerOpen.set(null); this.deleteSuccess.set('');
    this.deleteConfirmText.set('');
    this.deleteError.set('');
    this.pendingPermanentDelete.set(user);
  }

  protected closePermanentDelete(): void {
    if (this.deletingPermanently()) return;
    this.pendingPermanentDelete.set(null);
    this.deleteConfirmText.set('');
    this.deleteError.set('');
  }

  protected async confirmPermanentDelete(): Promise<void> {
    const user = this.pendingPermanentDelete();
    if (!this.editable || !user || this.deletingPermanently() || !this.canDeletePermanently()
      || (user.role !== 'student' && user.role !== 'teacher') || user.id === this.data.currentUserId()) return;

    this.deletingPermanently.set(true);
    this.deleteError.set('');
    try {
      const message = await this.adminApi.deleteUser(user.id, user.role, this.deleteConfirmText());
      this.data.users.update(users => users.filter(item => item.id !== user.id));
      this.deleteSuccess.set(message); this.pendingPermanentDelete.set(null);
      this.deleteConfirmText.set('');
    } catch (error) {
      this.deleteError.set(error instanceof Error ? error.message : 'Akun belum bisa dihapus permanen.');
    } finally {
      this.deletingPermanently.set(false);
    }
  }

  private emptyUser(): AppUser {
    return { id: '', displayName: '', username: '', role: this.role, grade: this.role === 'student' ? 1 : undefined, active: true };
  }

}
