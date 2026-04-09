import { Routes } from '@angular/router';
import { DefaultLayout } from './layouts/default-layout/default-layout';
import { Login } from './views/login/login';
import { SelectProject } from './views/projects/select-project/select-project';
import { Dashboard } from './views/projects/selected/dashboard/dashboard';
import { authGuard } from './guards/auth-guard';
import { puzzleReadyGuard } from './guards/puzzle-ready-guard';
import { ForgotPassword } from './views/forgot-password/forgot-password';
import { Permissions } from './views/admin/permissions/permissions';
import { ProjectsList } from './views/admin/projects/projects-list/projects-list';
import { DevicesList } from './views/admin/devices/devices-list/devices-list';
import { UserSettings } from './views/user-settings/user-settings';
import { Scanner } from './views/admin/devices/scanner/scanner';
import { Vision } from './views/projects/selected/vision/vision';
import { ProjectPermissions } from './views/admin/project-permissions/project-permissions';

const admin: Routes = [
  {
    path: 'users',
    component: Permissions,
  },
  {
    path: 'projects',
    component: ProjectsList,
  },
  {
    path: 'devices',
    component: DevicesList,
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
      { path: 'user-settings', component: UserSettings },
      { path: 'admin/permissions', redirectTo: 'admin/users', pathMatch: 'full' },
      { path: 'admin', children: admin },
      {
        path: ':projectId',
        children: [
          { path: '', component: Dashboard },
          { path: 'projects', component: SelectProject },
          { path: 'user-settings', component: UserSettings },
          { path: 'admin/permissions', component: ProjectPermissions },
          { path: 'admin', children: admin },
          { path: 'model', component: Scanner },
          { path: 'dashboard', component: Dashboard },
          {
            path: 'vision',
            loadComponent: () => import('./views/projects/selected/vision/vision').then((m) => m.Vision),
          },
          
          {
            path: 'fusion',
            loadComponent: () =>
              import('./views/projects/selected/fusion/fusion').then((m) => m.Fusion),
          },

          {
            path: 'calibration/puzzle',
            canActivate: [puzzleReadyGuard],
            loadComponent: () =>
              import('./views/projects/selected/calibration/puzzle/puzzle.component').then((m) => m.PuzzleComponent),
          },
        ],
      },
    ],
  },
];
