import { Routes } from '@angular/router';
import { DefaultLayout } from './layouts/default-layout/default-layout';
import { Login } from './views/login/login';

export const routes: Routes = [
    // Landing route: show Login at root
    {
        path: '',
        component: Login,
    },
    // Other app routes rendered inside the default layout
    {
        path: 'app',
        component: DefaultLayout,
        children: [
            // add child routes here, e.g. { path: 'dashboard', loadComponent: () => import('./views/dashboard/dashboard').then(m => m.Dashboard) }
        ]
    }
];
