import { Component } from '@angular/core';
import { ProjectService } from '../../../services/project-service';

@Component({
  selector: 'app-projects-list',
  imports: [],
  templateUrl: './projects-list.html',
  styleUrl: './projects-list.scss',
})
export class ProjectsList {
  private constructor(private projectService: ProjectService) {}

  ngOnInit(): void {
    // Example usage of ProjectService
    this.projectService.DoStuff();
  }
}
