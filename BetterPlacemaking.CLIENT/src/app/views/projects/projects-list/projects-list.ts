import { Component } from '@angular/core';
import { TableModule } from 'primeng/table';
import { RouterModule } from '@angular/router';
import { ProjectService } from '../../../services/project-service';
import { ButtonModule } from 'primeng/button';
import { SampleService } from '../../../services/sample-service';
import { AuthService } from '../../../services/auth-service';

@Component({
  selector: 'app-projects-list',
  imports: [TableModule, RouterModule, ButtonModule],
  templateUrl: './projects-list.html',
  styleUrl: './projects-list.scss',
})
export class ProjectsList {
  public projects = [
    { title: 'SVAD Art Gallery', description: 'Art gallery at UCF', size: '3' },
    { title: 'Orlando Downtown Plaza', description: 'Public plaza with lighting and seating', size: '6' },
    { title: 'TEST ITEM', description: 'TEST', size: '4' }
  ];
  public constructor(private projectService: ProjectService, private sampleService: SampleService, private authService: AuthService) {}

  ngOnInit(): void {
    // Example usage of ProjectService
    this.projectService.DoStuff();
  }

  public testPing(): void {
    // this.sampleService.samplePing().subscribe({
    //   next: (res) => console.log('samplePing response:', res),
    //   error: (err) => console.error('Error during samplePing:', err),
    // });
    this.authService.logout().subscribe({
      next: () => console.log('Logged out successfully'),
      error: (err) => console.error('Error during logout:', err),
    });
  }
}
