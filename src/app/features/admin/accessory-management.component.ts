import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { collection, doc, onSnapshot, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { firestore } from '../../core/firebase/firebase';
import { MediaUploadService } from '../../core/services/media-upload.service';
import { ActivatedRoute } from '@angular/router';

interface AccessoryAdminRow {
  id: string;
  name: string;
  icon?: string;
  price: number;
  previewUrl?: string;
  accessoryUrl?: string;
  category?: string;
  layer?: string;
  sortOrder?: number;
  active: boolean;
}

@Component({
  selector: 'app-accessory-management',
  imports: [FormsModule],
  templateUrl: './accessory-management.component.html',
  styleUrl: './accessory-management.component.scss',
})
export class AccessoryManagementComponent implements OnDestroy {
  private readonly mediaUpload = inject(MediaUploadService);
  protected readonly dashboardLabel = inject(ActivatedRoute).snapshot.data['dashboardLabel'] ?? 'Dashboard Admin';
  protected readonly editingItem = signal<AccessoryAdminRow | null>(null);
  protected readonly pendingDelete = signal<AccessoryAdminRow | null>(null);
  private knownIds = new Set<string>();
  protected readonly items = signal<AccessoryAdminRow[]>([]);
  protected readonly error = signal('');
  protected readonly status = signal('');
  protected readonly saving = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly draggingId = signal<string | null>(null);
  protected form = { id: '', name: '', price: 0, icon: '', category: 'other', layer: 'head', sortOrder: 0, active: true };
  private unsubscribe: (() => void) | null = null;
  private previewFile: File | null = null;
  private accessoryFile: File | null = null;
  protected previewName = 'Belum ada gambar preview';
  protected accessoryName = 'Belum ada gambar aksesoris';

  constructor() {
    this.unsubscribe = onSnapshot(collection(firestore, 'accessories'), (snapshot) => {
      this.knownIds = new Set(snapshot.docs.map((item) => item.id));
      const rows = snapshot.docs.filter((item) => item.data()['deleted'] !== true).map((item) => {
        const data = item.data();
        return { id: item.id, name: String(data['name'] ?? item.id), icon: String(data['icon'] ?? ''), price: Number(data['price'] ?? 0), previewUrl: String(data['previewUrl'] ?? ''), accessoryUrl: String(data['accessoryUrl'] ?? ''), category: String(data['category'] ?? 'other'), layer: String(data['layer'] ?? 'head'), sortOrder: Number(data['sortOrder'] ?? 0), active: data['active'] !== false };
      });
      rows.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.name.localeCompare(right.name));
      this.items.set(rows);
    }, () => this.error.set('Katalog aksesoris belum bisa dibaca. Periksa izin Firestore.'));
  }

  ngOnDestroy(): void { this.unsubscribe?.(); }

  protected openForm(item?: AccessoryAdminRow): void {
    if (this.saving()) return;
    this.reset();
    this.editingItem.set(item ?? null);
    if (item) {
      this.form = { id: item.id, name: item.name, price: item.price, icon: item.icon ?? '',
        category: item.category ?? 'other', layer: item.layer ?? 'head', sortOrder: item.sortOrder ?? 0,
        active: item.active };
      this.previewName = item.previewUrl ? 'Gunakan gambar preview saat ini' : 'Belum ada gambar preview';
      this.accessoryName = item.accessoryUrl ? 'Gunakan gambar aksesoris saat ini' : 'Belum ada gambar aksesoris';
    }
    this.error.set(''); this.status.set(''); this.formOpen.set(true);
  }

  protected closeForm(): void { if (!this.saving()) this.formOpen.set(false); }

  protected startDrag(id: string): void { this.draggingId.set(id); }

  protected endDrag(): void { this.draggingId.set(null); }

  protected async dropOn(id: string): Promise<void> {
    if (this.saving()) return;
    const sourceId = this.draggingId();
    this.draggingId.set(null);
    if (!sourceId || sourceId === id) return;

    const source = this.items().find((item) => item.id === sourceId);
    if (!source) return;
    const reordered = [...this.items()];
    const sourceIndex = reordered.findIndex((item) => item.id === sourceId);
    const targetIndex = reordered.findIndex((item) => item.id === id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const nextItems = reordered.map((item, index) => ({ ...item, sortOrder: index }));
    const updated = new Map(nextItems.map((item) => [item.id, item]));
    this.items.set(this.items().map((item) => updated.get(item.id) ?? item));
    try {
      await Promise.all(nextItems.map((item) => setDoc(doc(firestore, 'accessories', item.id), { sortOrder: item.sortOrder, updatedAt: serverTimestamp() }, { merge: true })));
    } catch {
      this.error.set('Urutan kabinet belum berhasil disimpan. Coba lagi.');
    }
  }

  protected choosePreview(event: Event): void {
    this.previewFile = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.previewName = this.previewFile?.name ?? 'Belum ada gambar preview';
  }

  protected chooseAccessory(event: Event): void {
    this.accessoryFile = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.accessoryName = this.accessoryFile?.name ?? 'Belum ada gambar aksesoris';
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.error.set(''); this.status.set('');
    const editing = this.editingItem();
    if (!/^[a-z0-9-]+$/.test(this.form.id)) return this.error.set('ID hanya boleh berisi huruf kecil, angka, dan tanda hubung.');
    if (editing && this.form.id !== editing.id) return this.error.set('ID aksesoris tidak dapat diubah.');
    if (!editing && this.knownIds.has(this.form.id)) return this.error.set('ID aksesoris sudah digunakan. Gunakan ID lain.');
    if (!this.form.name.trim()) return this.error.set('Nama wajib diisi.');
    if (!editing && (!this.previewFile || !this.accessoryFile)) return this.error.set('Kedua gambar wajib diisi untuk aksesoris baru.');
    if (!Number.isInteger(this.form.price) || this.form.price < 0) return this.error.set('Harga harus berupa bilangan bulat minimal 0.');
    this.saving.set(true);
    try {
      if (this.previewFile) this.validatePreview(this.previewFile);
      if (this.accessoryFile) await this.validateAccessory(this.accessoryFile);
      const preview = this.previewFile ? await this.mediaUpload.uploadAccessoryImage(this.previewFile, 'preview') : null;
      const accessory = this.accessoryFile ? await this.mediaUpload.uploadAccessoryImage(this.accessoryFile, 'accessory') : null;
      const reference = doc(firestore, 'accessories', this.form.id);
      const payload = { ...this.form, name: this.form.name.trim(),
        ...(preview ? { previewUrl: preview.url, previewPublicId: preview.publicId } : {}),
        ...(accessory ? { accessoryUrl: accessory.url, accessoryPublicId: accessory.publicId } : {}),
        sortOrder: editing ? this.form.sortOrder : this.items().length, updatedAt: serverTimestamp() };
      await runTransaction(firestore, async (transaction) => {
        const current = await transaction.get(reference);
        if (!editing && current.exists()) throw new Error('ID aksesoris sudah digunakan. Gunakan ID lain.');
        if (editing && (!current.exists() || current.data()['deleted'] === true)) throw new Error('Aksesoris sudah dihapus. Muat ulang katalog.');
        transaction.set(reference, payload, { merge: true });
      });
      this.status.set(editing ? 'Perubahan aksesoris berhasil disimpan.' : 'Aksesoris berhasil ditambahkan.');
      this.reset();
      this.formOpen.set(false);
    } catch (value) {
      this.error.set(value instanceof Error ? value.message : 'Aksesoris gagal disimpan.');
    } finally { this.saving.set(false); }
  }

  protected async toggleActive(item: AccessoryAdminRow): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true); this.error.set(''); this.status.set('');
    try {
      await this.updateExisting(item.id, { active: !item.active });
      this.status.set(item.active ? 'Aksesoris dinonaktifkan.' : 'Aksesoris diaktifkan.');
    } catch (value) { this.error.set(value instanceof Error ? value.message : 'Status gagal diperbarui.'); }
    finally { this.saving.set(false); }
  }

  protected requestDelete(item: AccessoryAdminRow): void {
    if (this.saving()) return;
    this.error.set(''); this.status.set(''); this.pendingDelete.set(item);
  }

  protected closeDelete(): void { if (!this.saving()) this.pendingDelete.set(null); }

  protected async deleteAccessory(): Promise<void> {
    const item = this.pendingDelete();
    if (!item || this.saving()) return;
    this.saving.set(true); this.error.set('');
    try {
      // Keep the ID as a tombstone so built-in fallback items cannot reappear.
      await this.updateExisting(item.id, { deleted: true, active: false, deletedAt: serverTimestamp() });
      this.pendingDelete.set(null);
      this.status.set('Aksesoris dihapus dari katalog.');
    } catch (value) { this.error.set(value instanceof Error ? value.message : 'Aksesoris gagal dihapus.'); }
    finally { this.saving.set(false); }
  }

  private async updateExisting(id: string, changes: Record<string, unknown>): Promise<void> {
    const reference = doc(firestore, 'accessories', id);
    await runTransaction(firestore, async (transaction) => {
      const current = await transaction.get(reference);
      if (!current.exists() || current.data()['deleted'] === true) throw new Error('Aksesoris sudah dihapus. Muat ulang katalog.');
      transaction.set(reference, { ...changes, updatedAt: serverTimestamp() }, { merge: true });
    });
  }
  private reset(): void {
    this.form = { id: '', name: '', price: 0, icon: '', category: 'other', layer: 'head', sortOrder: 0, active: true };
    this.editingItem.set(null);
    this.previewFile = null; this.accessoryFile = null;
    this.previewName = 'Belum ada gambar preview'; this.accessoryName = 'Belum ada gambar aksesoris';
  }

  private validatePreview(file: File): void {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Preview harus JPG, PNG, atau WebP.');
    if (file.size > 1 * 1024 * 1024) throw new Error('Ukuran preview maksimal 1 MB.');
  }

  private async validateAccessory(file: File): Promise<void> {
    if (!['image/png', 'image/webp'].includes(file.type)) throw new Error('Aksesoris harus PNG atau WebP transparan.');
    if (file.size > 1 * 1024 * 1024) throw new Error('Ukuran aksesoris maksimal 1 MB.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Gambar aksesoris tidak dapat dibaca.')); });
      if (image.naturalWidth !== 2000 || image.naturalHeight !== 2000) throw new Error('Gambar aksesoris wajib berukuran tepat 2000 × 2000 px.');
      const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 40;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Browser tidak mendukung pemeriksaan transparansi.');
      context.drawImage(image, 0, 0, 40, 40);
      const pixels = context.getImageData(0, 0, 40, 40).data;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 255) return;
      throw new Error('Gambar aksesoris wajib memiliki background transparan.');
    } finally { URL.revokeObjectURL(url); }
  }
}
