import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-home',
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  projects: { name: string; clusters: number; cameras: number }[] = [
    { name: 'UCF VAB Art Gallery', clusters: 2, cameras: 12 },
    { name: 'Downtown Orlando Central Park', clusters: 5, cameras: 20 },
    { name: 'Italian Square', clusters: 7, cameras: 26 },
    { name: 'UCF Memory Mall', clusters: 5, cameras: 18 },
  ];

  newProject() {
    console.log('New project action');
  }

  editProject(project: { name: string; clusters: number; cameras: number }) {
    console.log('Edit project', project);
  }
}
