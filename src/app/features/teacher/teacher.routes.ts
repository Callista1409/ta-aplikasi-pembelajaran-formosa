import { Routes } from '@angular/router';
import { RoleLayoutComponent } from '../../layout/role-layout.component';

export const TEACHER_ROUTES: Routes = [
  {
    path: '',
    component: RoleLayoutComponent,
    data: {
      roleLabel: 'Guru',
      userName: 'Miss Callista',
      consoleLabel: 'Teacher Console',
      navigation: [
        { label: 'Dashboard', path: 'dashboard' },
        { label: 'Arsip Posttest', path: 'posttest-archive' },
        { label: 'Data Siswa', path: 'students' },
        { label: 'Poin Murid', path: 'points' },
        { label: 'Manajemen Flashcard', path: 'flashcards' },
        { label: 'Manajemen Soal', path: 'questions' },
      ],
    },
    children: [
      { path: 'posttest-archive', loadComponent: () => import('../../shared/posttest-archive.component').then((m) => m.PosttestArchiveComponent) },
      { path: 'dashboard', loadComponent: () => import('./teacher-dashboard.component').then((m) => m.TeacherDashboardComponent) },
      { path: 'profile', loadComponent: () => import('../profile/profile.component').then((m) => m.ProfileComponent) },
      { path: 'students', loadComponent: () => import('../users/user-management.component').then((m) => m.UserManagementComponent), data: { userRole: 'student', editable: false } },
      { path: 'points', loadComponent: () => import('./teacher-points.component').then((m) => m.TeacherPointsComponent) },
      { path: 'flashcards', loadComponent: () => import('../content/flashcard-management.component').then((m) => m.FlashcardManagementComponent), data: { adminMode: false } },
      { path: 'questions', loadComponent: () => import('../content/question-management.component').then((m) => m.QuestionManagementComponent), data: { adminMode: false } },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
];
