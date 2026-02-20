import { Routes } from '@angular/router';
import { DefaultLayout } from './layouts/default-layout/default-layout';
import { Login } from './views/login/login';
import { SelectProject } from './views/projects/select-project/select-project';
import { Dashboard } from './views/projects/selected/dashboard/dashboard';
import { Permissions } from './views/admin/permissions/permissions';
import { ProjectsList } from './views/admin/projects/projects-list/projects-list';
import { DevicesList } from './views/admin/devices/devices-list/devices-list';
import { authGuard } from './guards/auth-guard';
import { UserSettings } from './views/user-settings/user-settings';
import { Scanner } from './views/admin/devices/scanner/scanner';
import { ForgotPassword } from './views/forgot-password/forgot-password';

const admin: Routes = [
  { path: 'permissions', component: Permissions },
  { path: 'projects', component: ProjectsList },
  { path: 'devices', component: DevicesList},
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
      { path: 'admin', children: admin },
      {
        path: ':projectId',
        children: [
          { path: '', component: Dashboard },
          { path: 'admin', children: admin },
          { path: 'model', component: Scanner },
          { path: 'dashboard', component: Dashboard },
        ],
      },
    ],
  },
];
