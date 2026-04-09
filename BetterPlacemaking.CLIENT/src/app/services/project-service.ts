import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable, catchError } from 'rxjs';
import { ErrorHandlerService } from './error-handler-service';
import { ProjectDto } from '../models/ProjectDto';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  constructor(
    private readonly http: HttpClient,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  public getProjects(): Observable<ProjectDto[]> {
    return this.http
      .get<ProjectDto[]>(`${environment.apiBaseUrl}/api/project`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load projects')));
  }

  public getProject(id: string): Observable<ProjectDto> {
    return this.http
      .get<ProjectDto>(`${environment.apiBaseUrl}/api/project/${id}`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load project')));
  }

  public addProject(project: ProjectDto): Observable<ProjectDto> {
    return this.http
      .post<ProjectDto>(`${environment.apiBaseUrl}/api/project`, project)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to add')));
  }

  public updateProject(project: ProjectDto): Observable<void> {
    if (!project?.Id)
      throw new Error('Project id is required for update');

    return this.http
      .put<void>(`${environment.apiBaseUrl}/api/project/${project.Id}`, project)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to update')));
  }

  public deleteProject(id: string): Observable<void> {
    return this.http
      .delete<void>(`${environment.apiBaseUrl}/api/project/${id}`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to delete')));
  }
}
