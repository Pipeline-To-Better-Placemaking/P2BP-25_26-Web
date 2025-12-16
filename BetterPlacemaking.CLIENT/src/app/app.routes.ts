import { Routes } from '@angular/router';
import { DefaultLayout } from './layouts/default-layout/default-layout';
import { Login } from './views/login/login';
import { ProjectsList } from './views/projects/projects-list/projects-list';
import { Dashboard } from './views/projects/selected/dashboard/dashboard';

const admin: Routes = [
  // { path: '', data: { subtree: 'admin-root' }, children: [] },
  // { path: 'users', data: { subtree: 'admin-users' }, children: [] },
  // { path: 'settings', data: { subtree: 'admin-settings' }, children: [] },
];

export const routes: Routes = [
  { path: 'login', component: Login },

  {
    path: '',
    component: DefaultLayout,
    children: [
      { path: '', redirectTo: 'projects', pathMatch: 'full' },
      { path: 'projects', component: ProjectsList },
      { path: ':projectId', children: [{ path: '', component: Dashboard }] },
      // { path: 'admin', children: admin },

      // {
      //   path: 'project/:projectId',
      //   children: [
      //     { path: '', },
      //     { path: 'overview', },
      //     { path: 'tasks', },
      //     { path: 'settings', },

      //     { path: 'admin', children: admin },
      //   ],
      // },
    ],
  },
];
