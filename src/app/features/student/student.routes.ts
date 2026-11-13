import { Routes } from '@angular/router';
import { RoleLayoutComponent } from '../../layout/role-layout.component';

export const STUDENT_ROUTES: Routes = [
  {
    path: '',
    component: RoleLayoutComponent,
    data: {
      roleLabel: 'Murid',
      userName: 'Emily Young',
      consoleLabel: 'Student Console',
      navigation: [
        { label: 'Dashboard', path: 'dashboard' },
        { label: 'Mulai Pelajaran', path: 'lesson' },
        { label: 'Kelola Maskot', path: 'shop' },
        { label: 'Rapor', path: 'report' },
      ],
    },
    children: [
      { path: 'posttest-archive', pathMatch: 'full', redirectTo: 'posttest' },
      { path: 'dashboard', loadComponent: () => import('./student-dashboard.component').then((m) => m.StudentDashboardComponent) },
      { path: 'profile', loadComponent: () => import('../profile/profile.component').then((m) => m.ProfileComponent) },
      { path: 'progress', pathMatch: 'full', redirectTo: 'report' },
      { path: 'report', loadComponent: () => import('./student-report.component').then((m) => m.StudentReportComponent) },
      { path: 'lesson', loadComponent: () => import('./student-lesson.component').then((m) => m.StudentLessonComponent) },
      { path: 'posttest', data: { posttest: true }, loadComponent: () => import('./student-lesson.component').then((m) => m.StudentLessonComponent) },
      { path: 'shop', loadComponent: () => import('./student-shop.component').then((m) => m.StudentShopComponent) },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
];
