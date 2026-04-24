import { Component, OnInit } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { ProjectDto } from '../../../../models/ProjectDto';
import { ProjectService } from '../../../../services/project-service';
import { catchError, of } from 'rxjs';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ProjectForm } from '../project-form/project-form';
import { PermissionDirective } from '../../../../directives/permission.directive';

@Component({
  selector: 'app-projects-list',
  imports: [TableModule, ButtonModule, ConfirmDialogModule, PermissionDirective],
  providers: [DialogService, ConfirmationService],
  templateUrl: './projects-list.html',
  styleUrl: './projects-list.scss',
})
export class ProjectsList implements OnInit {
  public projects: ProjectDto[] = [];

  private formRef: DynamicDialogRef<ProjectForm> | null = null;

  public constructor(
    private readonly projectService: ProjectService,
    private readonly dialogService: DialogService,
    private readonly confirmationService: ConfirmationService,
  ) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  private loadProjects(): void {
    this.projectService
      .getProjects()
      .pipe(catchError(() => of([] as ProjectDto[])))
      .subscribe({
        next: (projects) => {
          this.projects = projects ?? [];
        },
        error: (err) => {
          // ErrorHandlerService already surfaces a toast; keep console for debugging.
          console.error('Error loading projects:', err);
        },
      });
  }

  public addProject(): void {
    this.formRef = this.dialogService.open(ProjectForm, {
      header: 'Add Project',
      width: '50vw',
      modal: true,
      breakpoints: {
        '960px': '75vw',
        '640px': '90vw',
      },
      closable: true,
    });

    this.formRef?.onClose.subscribe((project: ProjectDto | undefined) => {
      if (!project) return;

      this.projectService.addProject(project).subscribe({
        next: () => this.loadProjects(),
        error: (err) => console.error('Error adding project:', err),
      });
    });
  }

  public editProject(project: ProjectDto): void {
    this.formRef = this.dialogService.open(ProjectForm, {
      header: 'Edit Project',
      width: '50vw',
      modal: true,
      data: project,
      breakpoints: {
        '960px': '75vw',
        '640px': '90vw',
      },
      closable: true,
    });

    this.formRef?.onClose.subscribe((updatedProject: ProjectDto | undefined) => {
      if (!updatedProject) return;

      this.projectService.updateProject(updatedProject).subscribe({
        next: () => this.loadProjects(),
        error: (err) => console.error('Error updating project:', err),
      });
    });
  }

  public deleteProject(project: ProjectDto): void {
    if (!project.Id) return;

    this.confirmationService.confirm({
      header: 'Delete Project',
      message: `Delete project "${project.Title || project.Id}"? This cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        this.projectService.deleteProject(project.Id!).subscribe({
          next: () => this.loadProjects(),
          error: (err) => console.error('Error deleting project:', err),
        });
      },
    });
  }
}
