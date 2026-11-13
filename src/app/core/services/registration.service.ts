import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { firestore } from '../firebase/firebase';
import { PendingRegistration, RegistrationStatus } from '../models/auth.models';
import { AdminApiService } from './admin-api.service';

@Injectable({ providedIn: 'root' })
export class RegistrationService implements OnDestroy {
  private readonly adminApi = inject(AdminApiService);
  private readonly unsubscribe = onSnapshot(
    collection(firestore, 'pendingRegistrations'),
    (snapshot) => {
      const registrations = snapshot.docs
        .map((item) => this.mapRegistration(item.id, item.data()))
        .filter((item): item is PendingRegistration => item !== null)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      this.registrations.set(registrations);
    },
    (error) => {
      console.error('Gagal membaca pendaftaran akun:', error);
      this.registrations.set([]);
    },
  );

  readonly registrations = signal<PendingRegistration[]>([]);

  async updateStatus(uid: string, status: Exclude<RegistrationStatus, 'pending'>): Promise<void> {
    await setDoc(
      doc(firestore, 'pendingRegistrations', uid),
      { status, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  async assignUsername(registration: PendingRegistration, username: string): Promise<void> {
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(normalizedUsername)) {
      throw new Error('Username harus 3-30 karakter dan hanya boleh memakai huruf, angka, titik, garis bawah, atau tanda hubung.');
    }
    const usernameReference = doc(firestore, 'loginUsernames', normalizedUsername);
    const existingUsername = await getDoc(usernameReference);
    if (existingUsername.exists()) throw new Error('Username tersebut sudah digunakan.');

    const batch = writeBatch(firestore);
    batch.set(doc(firestore, 'users', registration.uid), {
      active: true,
      displayName: registration.displayName,
      email: registration.email,
      ...(registration.role === 'student' ? { grade: Number(registration.grade ?? 1) } : { grade: null }),
      role: registration.role,
      username: normalizedUsername,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    batch.set(usernameReference, {
      active: true,
      email: registration.email,
      role: registration.role,
      uid: registration.uid,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(firestore, 'pendingRegistrations', registration.uid), {
      status: 'approved',
      username: normalizedUsername,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    this.adminApi.invalidateRoster();
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }

  private mapRegistration(uid: string, data: Record<string, unknown>): PendingRegistration | null {
    const status = data['status'];
    if (status !== 'pending' && status !== 'approved' && status !== 'rejected') return null;
    return {
      uid,
      displayName: String(data['displayName'] ?? 'Tanpa nama'),
      email: String(data['email'] ?? ''),
      role: data['role'] === 'teacher' ? 'teacher' : 'student',
      grade: data['role'] === 'teacher' ? undefined : Number(data['grade'] ?? 1),
      status,
      username: typeof data['username'] === 'string' ? data['username'] : undefined,
    };
  }
}
