import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface UploadedMedia {
  url: string;
  publicId: string;
}

@Injectable({ providedIn: 'root' })
export class MediaUploadService {
  readonly configured = Boolean(
    environment.cloudinary.cloudName && environment.cloudinary.uploadPreset,
  );

  async uploadFlashcardImage(file: File): Promise<UploadedMedia> {
    return this.uploadImage(file, environment.cloudinary.folder || 'flashcards');
  }

  async uploadAccessoryImage(file: File, kind: 'preview' | 'accessory'): Promise<UploadedMedia> {
    return this.uploadImage(file, `accessories/${kind}`);
  }

  private async uploadImage(file: File, folder: string): Promise<UploadedMedia> {
    if (!this.configured) {
      throw new Error('Cloudinary belum dikonfigurasi. Isi cloudName dan upload preset terlebih dahulu.');
    }

    const body = new FormData();
    body.append('file', file);
    body.append('upload_preset', environment.cloudinary.uploadPreset);
    body.append('folder', folder);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${environment.cloudinary.cloudName}/image/upload`,
      { method: 'POST', body },
    );
    const result = (await response.json()) as {
      secure_url?: string;
      public_id?: string;
      error?: { message?: string };
    };

    if (!response.ok || !result.secure_url || !result.public_id) {
      throw new Error(result.error?.message ?? 'Upload gambar gagal.');
    }
    return { url: result.secure_url, publicId: result.public_id };
  }
}
