import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'admin',
    canActivate: [authGuard, roleGuard('admin')],
    loadChildren: () => import('./features/admin/admin.routes').then((routes) => routes.ADMIN_ROUTES),
  },
  {
    path: 'teacher',
    canActivate: [authGuard, roleGuard('teacher')],
    loadChildren: () =>
      import('./features/teacher/teacher.routes').then((routes) => routes.TEACHER_ROUTES),
  },
  {
    path: 'student',
    canActivate: [authGuard, roleGuard('student')],
    loadChildren: () =>
      import('./features/student/student.routes').then((routes) => routes.STUDENT_ROUTES),
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' },
];
