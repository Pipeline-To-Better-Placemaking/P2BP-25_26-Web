import { Component, OnInit } from '@angular/core';
import { TableModule } from 'primeng/table';
import { RouterModule } from '@angular/router';
import { ProjectService } from '../../../services/project-service';
import { ButtonModule } from 'primeng/button';
import { ProjectDto } from '../../../models/ProjectDto';
import { catchError, finalize, of } from 'rxjs';

@Component({
  selector: 'app-select-project',
  imports: [TableModule, RouterModule, ButtonModule],
  templateUrl: './select-project.html',
  styleUrl: './select-project.scss',
})
export class SelectProject implements OnInit {
  public projects: ProjectDto[] = [];
  public isLoading = false;

  public constructor(private readonly projectService: ProjectService) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  private loadProjects(): void {
    this.isLoading = true;

    this.projectService
      .getProjects()
      .pipe(finalize(() => {this.isLoading = false;}),)
      .subscribe((projects) => {
        this.projects = projects ?? [];
      });
  }
}
