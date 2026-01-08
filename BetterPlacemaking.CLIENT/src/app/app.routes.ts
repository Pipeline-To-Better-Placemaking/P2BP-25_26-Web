import { Routes } from '@angular/router';
import { DefaultLayout } from './layouts/default-layout/default-layout';
import { Login } from './views/login/login';
import { ProjectsList } from './views/projects/projects-list/projects-list';
import { Dashboard } from './views/projects/selected/dashboard/dashboard';
import { DevicesList } from './views/admin/devices/devices-list/devices-list';
import { authGuard } from './guards/auth-guard';

const admin: Routes = [
  { path: 'devices', component: DevicesList}
];

export const routes: Routes = [
  { path: 'login', component: Login },

  {
    path: '',
    component: DefaultLayout,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'projects', pathMatch: 'full' },
      { path: 'projects', component: ProjectsList },
      { path: 'admin', children: admin },
      {
        path: ':projectId',
        children: [
          { path: '', component: Dashboard },
          { path: 'admin', children: admin },
        ],
      },
    ],
  },
];
