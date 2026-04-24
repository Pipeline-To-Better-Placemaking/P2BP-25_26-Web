import { Injectable } from '@angular/core';
import { HttpClient, HttpParams  } from '@angular/common/http';
import { Observable, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ErrorHandlerService } from './error-handler-service';
import {
  FusionRunDto,
  FusionConfigDto,
  TriggerFusionDto,
  UpdateFusionConfigDto,
} from '../models/FusionDtos';

@Injectable({ providedIn: 'root' })
export class FusionService {
  constructor(
    private readonly http: HttpClient,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  getHistory(projectId: string, limit = 50): Observable<FusionRunDto[]> {
    return this.http
      .get<FusionRunDto[]>(`${environment.apiBaseUrl}/api/fusion/history`, { params: { projectId, limit } })
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load fusion history')));
  }

  triggerFusion(payload: TriggerFusionDto): Observable<FusionRunDto> {
    let params = new HttpParams();
    if (payload.ProjectId) params = params.set('projectId', payload.ProjectId);

    return this.http
      .post<FusionRunDto>(`${environment.apiBaseUrl}/api/fusion/trigger`, payload, { params })
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to trigger fusion')));
  }

  deleteRun(runId: string): Observable<void> {
    return this.http
      .delete<void>(`${environment.apiBaseUrl}/api/fusion/${runId}`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to delete run')));
  }

  getDownloadUrl(runId: string): Observable<{ url: string }> {
    return this.http
      .get<{ url: string }>(`${environment.apiBaseUrl}/api/fusion/${runId}/download-url`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to get download URL')));
  }
  
  downloadRun(runId: string): Observable<Blob> {
    return this.http
      .get(`${environment.apiBaseUrl}/api/fusion/${runId}/download`, { responseType: 'blob' })
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to download fusion run')));
  }

  cancelRun(runId: string): Observable<{ status: string }> {
  return this.http
    .post<{ status: string }>(
      `${environment.apiBaseUrl}/api/fusion/${runId}/cancel`,
      {},
    )
    .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to cancel fusion run')));
}


  getConfig(projectId?: string): Observable<FusionConfigDto> {
    let params = new HttpParams();
    if (projectId) params = params.set('projectId', projectId);
    return this.http
      .get<FusionConfigDto>(`${environment.apiBaseUrl}/api/fusion/config`, { params })
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load fusion config')));
  }

  updateConfig(payload: UpdateFusionConfigDto): Observable<FusionConfigDto> {
    let params = new HttpParams();
    if (payload.ProjectId) params = params.set('projectId', payload.ProjectId);

    return this.http
      .put<FusionConfigDto>(`${environment.apiBaseUrl}/api/fusion/config`, payload, { params })
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to update fusion config')));
  }
}
