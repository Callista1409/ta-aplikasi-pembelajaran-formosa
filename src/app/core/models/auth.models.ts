export type UserRole = 'admin' | 'teacher' | 'student';
export type RegistrationRole = Extract<UserRole, 'teacher' | 'student'>;

export interface UserProfile {
  uid: string;
  displayName: string;
  username: string;
  email: string;
  role: UserRole;
  active: boolean;
  grade?: number | null;
}


export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

export interface PendingRegistration {
  uid: string;
  displayName: string;
  email: string;
  role: RegistrationRole;
  grade?: number;
  status: RegistrationStatus;
  username?: string;
}
