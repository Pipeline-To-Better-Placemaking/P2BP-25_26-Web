import { Routes } from '@angular/router';
import { DefaultLayout } from './layouts/default-layout/default-layout';

export const routes: Routes = [
    {
        path: '',
        component: DefaultLayout,
        children: [
        ]
    }
];
