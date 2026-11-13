import { Routes } from '@angular/router';
import { RoleLayoutComponent } from '../../layout/role-layout.component';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: RoleLayoutComponent,
    data: {
      roleLabel: 'Admin',
      userName: 'Miss Callista',
      consoleLabel: 'Admin Console',
      navigation: [
        { label: 'Dashboard', path: 'dashboard' },
        { label: 'Pendaftaran Akun', path: 'registrations' },
        { label: 'Manajemen Siswa', path: 'students' },
        { label: 'Manajemen Guru', path: 'teachers' },
        { label: 'Poin Murid', path: 'points' },
        { label: 'Manajemen Unit', path: 'units' },
        { label: 'Manajemen Flashcard', path: 'flashcards' },
        { label: 'Manajemen Soal', path: 'questions' },
        { label: 'Manajemen Aksesoris', path: '/admin/accessories' },
      ],
    },
    children: [
      { path: 'dashboard', loadComponent: () => import('./admin-dashboard.component').then((m) => m.AdminDashboardComponent) },
      { path: 'registrations', loadComponent: () => import('./registration-management.component').then((m) => m.RegistrationManagementComponent) },
      { path: 'profile', loadComponent: () => import('../profile/profile.component').then((m) => m.ProfileComponent) },
      { path: 'teachers', loadComponent: () => import('../users/user-management.component').then((m) => m.UserManagementComponent), data: { userRole: 'teacher', editable: true } },
      { path: 'students', loadComponent: () => import('../users/user-management.component').then((m) => m.UserManagementComponent), data: { userRole: 'student', editable: true } },
      {
        path: 'points',
        loadComponent: () => import('../teacher/teacher-points.component').then((m) => m.TeacherPointsComponent),
        data: {
          dashboardLabel: 'Dashboard Admin',
          pageTitle: 'Daftar Poin Murid',
          pageSubtitle: 'Pilih murid untuk melihat rincian progress, poin, dan aktivitas pada rentang tanggal.',
        },
      },
      { path: 'units', loadComponent: () => import('../content/unit-management.component').then((m) => m.UnitManagementComponent) },
      { path: 'flashcards', loadComponent: () => import('../content/flashcard-management.component').then((m) => m.FlashcardManagementComponent), data: { adminMode: true } },
      { path: 'accessories', loadComponent: () => import('./accessory-management.component').then((m) => m.AccessoryManagementComponent) },
      { path: 'accessory-management', redirectTo: 'accessories' },
      { path: 'questions', loadComponent: () => import('../content/question-management.component').then((m) => m.QuestionManagementComponent), data: { adminMode: true } },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
];
