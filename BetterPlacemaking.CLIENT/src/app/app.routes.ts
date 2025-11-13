import { Routes } from '@angular/router';
import { DefaultLayoutComponent } from './layouts/default-layout/default-layout.component';
import { HomeComponent } from './views/home/home.component';
import { ProjectEditComponent } from './views/project-edit/project-edit.component';

export const routes: Routes = [
  {
    path: '',
    component: DefaultLayoutComponent,
    children: [
      {
        path: '',
        component: HomeComponent,
      },
      {
        path: 'edit',
        component: ProjectEditComponent,
      }
    ],
  },
];
