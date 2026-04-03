import { Routes } from '@angular/router';
import { DefaultLayout } from './layouts/default-layout/default-layout';
import { Login } from './views/login/login';
import { SelectProject } from './views/projects/select-project/select-project';
import { Dashboard } from './views/projects/selected/dashboard/dashboard';
import { authGuard } from './guards/auth-guard';
import { ForgotPassword } from './views/forgot-password/forgot-password';

const admin: Routes = [
  {
    path: 'permissions',
    loadComponent: () => import('./views/admin/permissions/permissions').then((m) => m.Permissions),
  },
  {
    path: 'projects',
    loadComponent: () => import('./views/admin/projects/projects-list/projects-list').then((m) => m.ProjectsList),
  },
  {
    path: 'devices',
    loadComponent: () => import('./views/admin/devices/devices-list/devices-list').then((m) => m.DevicesList),
  },
];

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: 'forgot-password', component: ForgotPassword },

  {
    path: '',
    component: DefaultLayout,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'projects', pathMatch: 'full' },
      { path: 'projects', component: SelectProject },
      {
        path: 'user-settings',
        loadComponent: () => import('./views/user-settings/user-settings').then((m) => m.UserSettings),
      },
      { path: 'admin', children: admin },
      {
        path: ':projectId',
        children: [
          { path: '', component: Dashboard },
          { path: 'admin', children: admin },
          {
            path: 'model',
            loadComponent: () => import('./views/admin/devices/scanner/scanner').then((m) => m.Scanner),
          },
          { path: 'dashboard', component: Dashboard },
          {
            path: 'vision',
            loadComponent: () => import('./views/projects/selected/vision/vision').then((m) => m.Vision),
          },
        ],
      },
    ],
  },
];
