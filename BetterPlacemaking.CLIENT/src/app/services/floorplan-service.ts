import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ErrorHandlerService } from './error-handler-service';

export interface FloorplanItem {
  Id: string;
  Nickname: string;
  ImageDownloadUrl: string | null;
  ImageWidth: number;
  ImageHeight: number;
  CreatedAtUtc: string;
  ProjectId: string | null;
}

@Injectable({ providedIn: 'root' })
export class FloorplanService {
  constructor(
    private readonly http: HttpClient,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  getLibrary(projectId: string): Observable<FloorplanItem[]> {
    return this.http
      .get<FloorplanItem[]>(`${environment.apiBaseUrl}/api/floorplan-library?projectId=${projectId}`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load floorplans')));
  }

  upload(file: File, nickname: string, projectId: string): Observable<FloorplanItem> {
    const form = new FormData();
    form.append('Image', file);
    form.append('Nickname', nickname);
    form.append('ProjectId', projectId);
    return this.http
      .post<FloorplanItem>(`${environment.apiBaseUrl}/api/floorplan-library/upload`, form)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to upload floorplan')));
  }

  delete(id: string): Observable<void> {
    return this.http
      .delete<void>(`${environment.apiBaseUrl}/api/floorplan-library/${id}`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to delete floorplan')));
  }
}
