import { Routes } from '@angular/router';
import { DefaultLayout } from './layouts/default-layout/default-layout';
import { Login } from './views/login/login';

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
