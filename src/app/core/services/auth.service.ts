import { Injectable, computed, signal } from '@angular/core';
import {
  User,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { firebaseAuth, firestore } from '../firebase/firebase';
import { RegistrationRole, UserProfile, UserRole } from '../models/auth.models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userState = signal<User | null>(null);
  private readonly profileState = signal<UserProfile | null>(null);
  private readonly readyState = signal(false);
  private readonly initialization: Promise<void>;
  private resolveInitialization!: () => void;

  readonly user = this.userState.asReadonly();
  readonly profile = this.profileState.asReadonly();
  readonly ready = this.readyState.asReadonly();
  readonly authenticated = computed(() => this.userState() !== null && this.profileState() !== null);

  constructor() {
    this.initialization = new Promise<void>((resolve) => {
      this.resolveInitialization = resolve;
    });

    void setPersistence(firebaseAuth, browserLocalPersistence);
    onAuthStateChanged(firebaseAuth, async (user) => {
      try {
        const profile = user ? await this.fetchProfile(user) : null;
        if (profile && !profile.active) {
          await firebaseSignOut(firebaseAuth);
          this.userState.set(null);
          this.profileState.set(null);
          return;
        }

        this.userState.set(user);
        this.profileState.set(profile);
      } catch {
        this.profileState.set(null);
      } finally {
        this.markReady();
      }
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.initialization;
  }

  async signIn(username: string, password: string): Promise<UserProfile> {
    const credential = await this.signInWithUsername(username, password);
    const profile = await this.fetchProfile(credential.user);

    if (!profile) {
      const registration = await this.fetchPendingRegistration(credential.user.uid);
      await firebaseSignOut(firebaseAuth);
      if (registration) {
        if (registration.status === 'pending') {
          throw new Error('Pendaftaran sudah diterima dan sedang menunggu persetujuan admin.');
        }
        if (registration.status === 'rejected') {
          throw new Error('Pendaftaran akun ini ditolak oleh admin.');
        }
      }
      throw new Error('Profil pengguna tidak ditemukan di Firestore.');
    }
    if (!profile.active) {
      await firebaseSignOut(firebaseAuth);
      throw new Error('Akun ini sedang dinonaktifkan.');
    }

    this.userState.set(credential.user);
    this.profileState.set(profile);
    return profile;
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(firebaseAuth);
    this.userState.set(null);
    this.profileState.set(null);
  }

  async sendPasswordReset(identifier: string): Promise<void> {
    const email = await this.resolveLoginEmail(identifier);
    await sendPasswordResetEmail(firebaseAuth, email);
  }

  async registerAccount(
    displayName: string,
    email: string,
    role: RegistrationRole,
    grade: number | null,
    password: string,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const credential = await createUserWithEmailAndPassword(
      firebaseAuth,
      normalizedEmail,
      password,
    );

    try {
      await setDoc(doc(firestore, 'pendingRegistrations', credential.user.uid), {
        displayName: displayName.trim(),
        email: normalizedEmail,
        role,
        ...(role === 'student' ? { grade: Number(grade ?? 1) } : {}),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      await deleteUser(credential.user).catch(() => undefined);
      throw error;
    } finally {
      await firebaseSignOut(firebaseAuth).catch(() => undefined);
    }
  }

  homeForRole(role: UserRole): string {
    return role === 'admin'
      ? '/admin/dashboard'
      : role === 'teacher'
        ? '/teacher/dashboard'
        : '/student/dashboard';
  }

  readableError(error: unknown): string {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (code.includes('invalid-credential') || code.includes('wrong-password')) {
      return 'Username atau password tidak sesuai.';
    }
    if (code.includes('too-many-requests')) {
      return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
    }
    if (code.includes('network-request-failed')) {
      return 'Koneksi ke Firebase gagal. Periksa internet kamu.';
    }
    return error instanceof Error ? error.message : 'Login gagal. Silakan coba kembali.';
  }

  private async signInWithUsername(username: string, password: string) {
    const candidates = await this.loginEmailCandidates(username);
    let lastError: unknown = null;

    for (const email of candidates) {
      try {
        return await signInWithEmailAndPassword(firebaseAuth, email, password);
      } catch (error) {
        lastError = error;
        const code =
          typeof error === 'object' && error && 'code' in error
            ? String(error.code)
            : '';

        if (
          !code.includes('invalid-credential') &&
          !code.includes('user-not-found') &&
          !code.includes('wrong-password')
        ) {
          throw error;
        }
      }
    }

    throw lastError ?? new Error('Username atau password tidak sesuai.');
  }

  private async loginEmailCandidates(username: string): Promise<string[]> {
    const value = username.trim().toLowerCase();
    if (value.includes('@')) return [value];

    const mappedEmail = await this.lookupUsernameEmail(value);
    if (mappedEmail) return [mappedEmail];

    return [
      `${value}@formosa.student`,
      `${value}@formosa.teacher`,
      `${value}@formosa.admin`,
    ];
  }

  private async resolveLoginEmail(identifier: string): Promise<string> {
    const value = identifier.trim().toLowerCase();
    if (!value) throw new Error('Masukkan username atau email akun.');
    if (value.includes('@')) return value;

    const mappedEmail = await this.lookupUsernameEmail(value);
    if (!mappedEmail) throw new Error('Username tidak ditemukan.');
    return mappedEmail;
  }

  private async lookupUsernameEmail(username: string): Promise<string | null> {
    try {
      const snapshot = await getDoc(doc(firestore, 'loginUsernames', username));
      if (!snapshot.exists()) return null;

      const data = snapshot.data();
      if (data['active'] === false) throw new Error('Akun ini sedang dinonaktifkan.');

      const email = String(data['email'] ?? '').trim().toLowerCase();
      return email.includes('@') ? email : null;
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      if (code.includes('permission-denied')) return null;
      throw error;
    }
  }


  private async fetchProfile(user: User): Promise<UserProfile | null> {
    const snapshot = await getDoc(doc(firestore, 'users', user.uid));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    const role = data['role'] as UserRole;
    if (!['admin', 'teacher', 'student'].includes(role)) return null;
    return {
      uid: user.uid,
      displayName: String(data['displayName'] ?? user.email ?? 'Pengguna'),
      username: String(data['username'] ?? ''),
      email: String(data['email'] ?? user.email ?? ''),
      role,
      active: data['active'] !== false,
      grade: data['grade'] === null || data['grade'] === undefined ? null : Number(data['grade']),
    };
  }

  private async fetchPendingRegistration(uid: string): Promise<{ status: string } | null> {
    const snapshot = await getDoc(doc(firestore, 'pendingRegistrations', uid));
    if (!snapshot.exists()) return null;
    return { status: String(snapshot.data()['status'] ?? 'pending') };
  }

  private markReady(): void {
    if (this.readyState()) return;
    this.readyState.set(true);
    this.resolveInitialization();
  }
}
